"""Immutable scalar edit proposals; only the human route calls ordinary save services."""
from copy import deepcopy
import getpass
import json
from time import time
from uuid import uuid4

from fastapi import HTTPException

from backend.domain.editing import DraftDomainDocument, resolve_edit
from backend.domain.router import SaveDomain, save_domain
from backend.domain.guards import check_locks
from backend.kernel.contracts import UpdateStudy,CreateStudy
from backend.kernel.workspace import fingerprint, stamp
from backend.plugin_host.parameter_contracts import validate_case, schemas

from .fields import check_edits, target, domain_metadata, unit_for, stored, displayed, schema_at, changed_domain


class Proposals:
    def __init__(self,research,tasks):
        self.research,self.tasks,self.workspace = research,tasks,research.store

    def source(self,task,study_id=None):
        with self.workspace.db() as db:
            current,_=self.workspace.load(db,task['workspace_id'])
            saved=db.execute('SELECT state,digest FROM workspace_revisions WHERE workspace=? AND revision=?',
                (task['workspace_id'],task['workspace_revision'])).fetchone()
            if saved is None:raise HTTPException(409,'会话所绑定的工程输入版本没有档案。')
            state=json.loads(saved['state'])
            if fingerprint(state)!=saved['digest']:raise HTTPException(409,'会话工程输入档案完整性失败。')
            study=None
            if study_id:
                expected=task['study_revision'] if task['study_id']==study_id else None
                study=self.research.definition(db,task['workspace_id'],study_id,expected)
        return current,state,study

    def domain(self,task,changes,title):
        check_edits(changes)
        _,state,_=self.source(task)
        if 'domain' not in state:raise HTTPException(422,'请先在工作台将工程显式转换为领域输入。')
        document=deepcopy(state['domain']);edits=[];pid=str(uuid4())
        for change in changes:
            parent,key=target(document,change['path'],stable=True)
            metadata=domain_metadata(change['path']);unit=metadata['x-unit']
            value=stored(change['value'],unit,change.get('unit'))
            parent[key]=value
            document.setdefault('provenance',{})[change['path']]={'kind':'user','reviewed':False,
                'reference':'Agent 输入方案 '+pid+'；非厂家实测，物性来源尚待人工核对。'}
            edits.append({'path':change['path'],'value':value})
        candidate=resolve_edit(state,DraftDomainDocument.model_validate(document))
        differences=changed_domain(state['domain'],candidate)
        if not differences:raise HTTPException(422,'方案没有实际字段变化。')
        proposal={'id':pid,'kind':'domain','workspace_revision':task['workspace_revision'],'study_id':None,
            'edits':edits,'candidate_digest':fingerprint(candidate),'expires':time()+3600,
            'public':{'id':pid,'title':title,'changes':differences,'checks':[
                '领域结构、引用、几何与锁校验通过。','保存前仍须核对工程修订；新输入来源未自动标为已核对。','未运行算法，未批准工程结果。']}}
        self.persist(task,proposal)
        return proposal['public']

    def parameters(self,task,study_id,module,changes,title):
        check_edits(changes)
        _,state,study=self.source(task,study_id)
        definition=deepcopy(study['definition'])
        selected=self.research.module_definition(definition,module)
        plugin,cap=self.research.resolve(selected['method'])
        source=selected['method_input'] if selected['input_source']=='study' else state.get('domain')
        if source is None:raise HTTPException(422,'研究缺少明确输入。')
        schema,_=schemas(cap,source)
        parameters=deepcopy(selected['parameters']);edits=[];differences=[]
        for change in changes:
            path=change['path'].removeprefix('/parameters')
            if not path.startswith('/'):raise HTTPException(422,'参数路径须为 /parameters/...。')
            root_field=path.split('/')[1]
            if root_field in ('source_bundle','source_metadata','external_loss_artifact','_artifact_reuse_sha256'):
                raise HTTPException(422,'宿主绑定的来源正文不能由模型修改。')
            parent,key=target(parameters,path,stable=False)
            metadata=schema_at(schema,path)
            binding=metadata.get('x-bind') or {}
            if metadata.get('readOnly') or binding.get('read_only') or key in ('source_bundle','source_metadata','external_loss_artifact','_artifact_reuse_sha256'):
                raise HTTPException(422,'宿主绑定的来源或只读参数不能由模型修改。')
            unit=unit_for(metadata,parameters,path);before=parent[key]
            after=stored(change['value'],unit,change.get('unit'))
            parent[key]=after
            if before!=after:
                prefix='/modules/'+module+'/parameters' if module else '/parameters'
                differences.append({'path':prefix+path,'label':metadata['title'],'before':displayed(before,unit),
                    'after':displayed(after,unit),'unit':unit['display']})
                edits.append({'path':path,'value':after})
        if not differences:raise HTTPException(422,'方案没有实际参数变化。')
        if selected['input_source']=='domain' and state.get('domain'):check_locks(state,source,parameters)
        validate_case(cap,{'input':source,'parameters':parameters})
        pid=str(uuid4())
        proposal={'id':pid,'kind':'parameters','workspace_revision':task['workspace_revision'],
            'study_id':study_id,'study_revision':study['revision'],'module':module,'method':selected['method'],
            'schema_digest':fingerprint(schema),'edits':edits,'expires':time()+3600,
            'public':{'id':pid,'title':title,'changes':differences,'checks':[
                '所选方法的封签参数契约与工程锁校验通过。','方法适用性仍需预检；未求解，未批准工程结果。']}}
        self.persist(task,proposal)
        return proposal['public']

    def study(self,task,method,parameters,title,*,method_input=None,source_ref=None):
        _,state,_=self.source(task)
        document=deepcopy(method_input) if method_input is not None else state.get('domain')
        source='study' if method_input is not None else 'domain'
        if document is None:raise HTTPException(422,'新研究方案需要明确保存输入，请先在工作台显式转换。')
        _,cap=self.research.resolve(method)
        if cap.input_contract is None or source not in cap.input_contract.input_sources:
            raise HTTPException(422,'此能力需要独立输入或来源对象，本轮不从领域工程猜测另一份输入。')
        schema=cap.parameter_schema.model_dump(mode='json',by_alias=True,exclude_none=True)
        parameters=deepcopy(parameters) if parameters is not None else {
            name:deepcopy(field['default']) for name,field in schema.get('properties',{}).items() if 'default' in field}
        forbidden={'source_bundle','source_metadata','external_loss_artifact','_artifact_reuse_sha256'}
        if forbidden & parameters.keys():raise HTTPException(422,'新研究来源正文须由宿主绑定，不能由模型注入。')
        if source=='domain':check_locks(state,document,parameters)
        validate_case(cap,{'input':document,'parameters':parameters})
        config=CreateStudy(expected_revision=task['workspace_revision'],title=title,method=method,input_source=source,
            method_input=document if source=='study' else None,parameters=parameters)
        definition=config.model_dump(mode='json',exclude={'expected_revision'})
        pid=str(uuid4())
        differences=[{'path':'/studies/title','label':'研究名称','before':None,'after':title,'unit':None},
            {'path':'/studies/method','label':'研究方法','before':None,'after':method,'unit':None}]
        def fields(value,path=''):
            if isinstance(value,dict):
                for name,child in value.items():fields(child,path+'/'+name.replace('~','~0').replace('/','~1'))
            elif isinstance(value,list):
                for index,child in enumerate(value):fields(child,path+'/'+str(index))
            else:
                metadata=schema_at(schema,path);unit=unit_for(metadata,parameters,path)
                differences.append({'path':'/studies/parameters'+path,'label':metadata.get('title') or '参数条目',
                    'before':None,'after':displayed(value,unit),'unit':unit['display']})
        fields(parameters)
        proposal={'id':pid,'kind':'study','workspace_revision':task['workspace_revision'],'definition':definition,
            'study_id':None,'method':method,'schema_digest':fingerprint(schema),'expires':time()+3600,
            'public':{'id':pid,'title':'新建研究 · '+title,'changes':differences,
                'checks':['引用当前工程领域输入与准确封签方法；参数结构和锁校验通过。',
                    '批准仅保存研究；未预检、未求解、未批准工程结果。']}}
        if source_ref:
            proposal['source_ref']=source_ref
            proposal['public']['checks']=['引用原保存工况输入与封签有限元方法；参数结构和锁校验通过。',
                '人工保存研究后仍须预检、确认核时并提交超算；未提交作业，未批准工程结果。']
        self.persist(task,proposal)
        return proposal['public']

    def persist(self,task,proposal):
        self.tasks.add_plan(task['id'],{'kind':'proposal','proposal':proposal},proposal['id'])
        self.tasks.emit(task['id'],'proposal.created',proposal['public'])

    def preview_inputs(self,task,sid,module,proposal_id,run_id=None,case_id=None):
        """Replay a reviewed draft against a verified original case, without saving."""
        _,state,study=self.source(task,sid)
        selected=self.research.module_definition(study['definition'],module)
        trial_state=deepcopy(state)
        pinned_case=None
        document=deepcopy(selected['method_input'] if selected['input_source']=='study' else state.get('domain'))
        parameters=deepcopy(selected['parameters'])
        if selected['driver']['kind']!='single' and not (run_id and case_id):
            raise HTTPException(422,'选择、扫描或批量研究试算须指定原 run_id 与 case_id；不会以默认工程冒充推荐工况。')
        if bool(run_id)!=bool(case_id):raise HTTPException(422,'原运行和工况必须一起指定。')
        if run_id:
            run=self.research.get_run(task['workspace_id'],run_id)
            if run['study']!=sid or run['integrity']!='verified' or run['freshness']!='current':
                raise HTTPException(409,'原运行归属、完整性或新鲜度未通过，拒绝试算。')
            if run['snapshot'].get('module')!=module:raise HTTPException(409,'原运行不属于指定研究模块。')
            original=run['snapshot']['definition']
            if original['method']!=selected['method']:raise HTTPException(409,'原工况与当前方法身份不一致。')
            case=next((value for value in run['snapshot']['cases'] if value['case_id']==case_id),None)
            if case is None:raise HTTPException(404,'原运行没有指定工况。')
            document=deepcopy(case['input']);parameters=deepcopy(case['parameters'])
            if selected['driver'].get('candidate_ids'):
                # Same candidate experiment scope as Research.snapshot: retain manual
                # locks, replace only the saved model binding with the verified case.
                binding=trial_state.get('study_cable_reference') or {}
                trial_state['locks']=[path for path in trial_state.get('locks',[]) if path not in binding.get('locks',[])]
                trial_state.pop('study_cable_reference',None)
                pinned_case=deepcopy(document)
        original_document=deepcopy(document)
        if proposal_id:
            with self.workspace.db() as db:owner,proposal,decision=self.tasks.proposal(db,proposal_id)
            if owner['id']!=task['id'] or proposal['workspace_revision']!=task['workspace_revision'] or decision or time()>proposal['expires']:
                raise HTTPException(409,'试算只接受本会话、同版本、未决定且未过期的方案。')
            if proposal['kind']=='domain':
                if selected['input_source']!='domain':raise HTTPException(422,'领域修改方案不能覆盖独立研究输入。')
                # Recheck the immutable proposal against its original domain/editor rules.
                base=deepcopy(state['domain'])
                for change in proposal['edits']:
                    parent,key=target(base,change['path'],stable=True);parent[key]=change['value']
                    base.setdefault('provenance',{})[change['path']]={'kind':'user','reviewed':False,
                        'reference':'Agent 输入方案 '+proposal_id+'；非厂家实测，物性来源尚待人工核对。'}
                if fingerprint(resolve_edit(state,DraftDomainDocument.model_validate(base)))!=proposal['candidate_digest']:
                    raise HTTPException(409,'方案领域校验规则已变化，请重新提出方案。')
                for change in proposal['edits']:
                    parent,key=target(document,change['path'],stable=True);parent[key]=change['value']
                    document.setdefault('provenance',{})[change['path']]=base['provenance'][change['path']]
                document=resolve_edit({**trial_state,'domain':original_document},DraftDomainDocument.model_validate(document))
            elif proposal['kind']=='parameters':
                if proposal['study_id']!=sid or proposal['study_revision']!=study['revision'] or proposal['module']!=module or proposal['method']!=selected['method']:
                    raise HTTPException(409,'方法参数方案与试算研究不一致。')
                _,cap=self.research.resolve(selected['method']);schema,_=schemas(cap,document)
                if fingerprint(schema)!=proposal['schema_digest']:raise HTTPException(409,'方案参数契约已变化。')
                for change in proposal['edits']:
                    parent,key=target(parameters,change['path'],stable=False);parent[key]=change['value']
            else:raise HTTPException(422,'新建研究方案须先由人工保存研究，再请求试算。')
        if pinned_case:
            if document['cable_types']!=pinned_case['cable_types']:raise HTTPException(422,'原候选型号结构不能被试算方案修改。')
            referenced=set()
            def materials(value):
                if isinstance(value,dict):
                    if isinstance(value.get('material'),str):referenced.add(value['material'])
                    for child in value.values():materials(child)
                elif isinstance(value,list):
                    for child in value:materials(child)
            materials(pinned_case['cable_types'])
            before={value['id']:value for value in pinned_case['materials'] if value['id'] in referenced}
            after={value['id']:value for value in document['materials'] if value['id'] in referenced}
            if before!=after:raise HTTPException(422,'原候选型号材料事实不能被试算方案修改。')
        if selected['input_source']=='domain':check_locks(trial_state,document,parameters)
        _,cap=self.research.resolve(selected['method'])
        validate_case(cap,{'input':document,'parameters':parameters})
        return {'domain' if selected['input_source']=='domain' else 'method_input':document,'parameters':parameters}

    def decide(self,pid,decision):
        # The public human route is the only caller; no decision exists in the broker registry.
        marker='human-decision:'+pid
        with self.workspace.db(True) as db:
            task,proposal,previous=self.tasks.proposal(db,pid)
            if previous:
                if previous['status']!=decision:raise HTTPException(409,'此方案已经完成另一项人工决定。')
                return {'status':decision}
            if task['active_turn']:raise HTTPException(409,'请等待当前 Agent 消息处理完成后再决定方案。')
            if decision=='approved' and time()>proposal['expires']:raise HTTPException(409,'此方案已过期，请重新读取输入并生成方案。')
            db.execute('UPDATE agent_tasks SET active_turn=?,owner_epoch=?,updated=? WHERE id=?',
                (marker,self.tasks.owner_epoch,stamp(),task['id']))
            self.tasks.event(db,task['id'],'proposal.decision.intent',{'id':pid,'status':decision,
                'operation_id':pid,'actor':getpass.getuser(),'source':'human.route','engineering_approval':False})
        try:
            return self.apply_decision(pid,decision,marker)
        finally:
            with self.workspace.db(True) as db:
                db.execute('UPDATE agent_tasks SET active_turn=NULL,updated=? WHERE active_turn=?',(stamp(),marker))

    def apply_decision(self,pid,decision,marker):
        with self.workspace.db(True) as db:
            task,proposal,previous=self.tasks.proposal(db,pid)
            if previous:
                if previous['status']!=decision:raise HTTPException(409,'此方案已经完成另一项人工决定。')
                return {'status':decision}
            if task['active_turn']!=marker:raise HTTPException(409,'人工决定的执行身份已变化。')
            receipt={}
            if decision=='approved':
                row,state=self.workspace.load(db,task['workspace_id'],proposal['workspace_revision'],allow_domain=True)
                self.workspace.assert_mutable(db,task['workspace_id'])
                if proposal['kind']=='domain':
                    document=deepcopy(state['domain'])
                    for change in proposal['edits']:
                        parent,key=target(document,change['path'],stable=True);parent[key]=change['value']
                        document.setdefault('provenance',{})[change['path']]={'kind':'user','reviewed':False,
                            'reference':'Agent 输入方案 '+pid+'；非厂家实测，物性来源尚待人工核对。'}
                    draft=DraftDomainDocument.model_validate(document)
                    if fingerprint(resolve_edit(state,draft))!=proposal['candidate_digest']:
                        raise HTTPException(409,'领域校验或派生规则已变化，请重新生成可审阅方案。')
                    saved=save_domain(self.workspace,task['workspace_id'],SaveDomain(expected_revision=proposal['workspace_revision'],document=draft),db)
                    receipt={'workspace_revision':saved['revision']}
                elif proposal['kind']=='study':
                    _,cap=self.research.resolve(proposal['method'])
                    schema=cap.parameter_schema.model_dump(mode='json',by_alias=True,exclude_none=True)
                    if fingerprint(schema)!=proposal['schema_digest']:raise HTTPException(409,'方法参数契约已变化。')
                    request=CreateStudy.model_validate({**proposal['definition'],'expected_revision':proposal['workspace_revision']})
                    saved=self.research.save(task['workspace_id'],request,connection=db)
                    receipt={'study_id':saved['id'],'study_revision':saved['revision']}
                else:
                    study=self.research.definition(db,task['workspace_id'],proposal['study_id'],proposal['study_revision'])
                    definition=deepcopy(study['definition']);selected=self.research.module_definition(definition,proposal['module'])
                    if selected['method']!=proposal['method']:raise HTTPException(409,'所选方法已变化，请重新生成方案。')
                    _,cap=self.research.resolve(selected['method'])
                    source=selected['method_input'] if selected['input_source']=='study' else state['domain']
                    schema,_=schemas(cap,source)
                    if fingerprint(schema)!=proposal['schema_digest']:raise HTTPException(409,'方法参数契约已变化。')
                    for change in proposal['edits']:
                        parent,key=target(selected['parameters'],change['path'],stable=False);parent[key]=change['value']
                    request=UpdateStudy.model_validate({**definition,'expected_revision':proposal['workspace_revision'],
                        'expected_study_revision':proposal['study_revision']})
                    saved=self.research.save(task['workspace_id'],request,proposal['study_id'],connection=db)
                    receipt={'study_id':saved['id'],'study_revision':saved['revision']}
            self.tasks.event(db,task['id'],'proposal.decision',{'id':pid,'status':decision,'actor':getpass.getuser(),
                'source':'human.route','engineering_approval':False,**receipt})
            if decision=='approved':
                if proposal['kind']=='domain':
                    db.execute('UPDATE agent_tasks SET workspace_revision=? WHERE id=?',(receipt['workspace_revision'],task['id']))
                elif proposal['kind']=='study' and task['study_id'] is None:
                    db.execute('UPDATE agent_tasks SET study_id=?,study_revision=? WHERE id=?',(receipt['study_id'],receipt['study_revision'],task['id']))
                elif task['study_id']==receipt.get('study_id'):
                    db.execute('UPDATE agent_tasks SET study_revision=? WHERE id=?',(receipt['study_revision'],task['id']))
                self.tasks.event(db,task['id'],'task.context.adopted',{'source':'human.route','proposal_id':pid,**receipt})
            pending=db.execute("SELECT 1 FROM agent_plan_revisions p WHERE p.task_id=? AND p.proposal_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM agent_events e WHERE e.task_id=p.task_id AND e.type='proposal.decision' AND json_extract(e.data,'$.id')=p.proposal_id) LIMIT 1",(task['id'],)).fetchone()
            db.execute('UPDATE agent_tasks SET state=?,waiting_reason=?,active_turn=NULL,updated=? WHERE id=?',
                ('reviewing' if pending else 'completed','human_review' if pending else None,stamp(),task['id']))
        return {'status':decision}
