"""Validate each registered action and call the same host application services."""
from copy import deepcopy
from difflib import get_close_matches
import json
from time import time

from fastapi import HTTPException
from fastapi.exceptions import RequestValidationError
from jsonschema import Draft202012Validator
from pydantic import ValidationError

from backend.domain.guards import value_at
from backend.kernel.contracts import PreviewStudy
from backend.kernel.preview import preview
from backend.kernel.workspace import fingerprint
from backend.plugin_host import PluginHostError
from backend.plugin_host.parameter_contracts import schemas

from .contracts import ToolResult,Diagnostic
from .evidence import run_points
from .fields import domain_metadata, displayed
from .security import redact
from .project_digest import project_digest, study_baseline
from .fem import comparisons, propose as propose_fem
from .resilience import retry
from .object_index import read as read_index
from .session_scope import require_tool,is_type


def failure(code,message,path=None,actions=None):
    return ToolResult(status='error',summary=message,
        diagnostics=[Diagnostic(code=code,message=message,path=path,recoverable=True)],
        next_actions=actions or ['根据字段诊断读取原输入和契约，修正后再请求。'])


def outline(document):
    """Stable object identities and explicitly declared physical fields, never guesses."""
    def token(value):return str(value).replace('~','~0').replace('/','~1')
    objects={}
    for collection in ('sections','materials','cable_types','circuits','load_cases'):
        rows=[]
        for item in document.get(collection,[]):
            path='/'+collection+'/'+token(item['id'])
            row={key:item[key] for key in ('id','label','kind','category','construction') if key in item}
            row.update(path=path,fields=[])
            def field(relative,value):
                if value is None or isinstance(value,(dict,list)):return
                full=path+relative
                metadata=domain_metadata(full);unit=metadata['x-unit']
                row['fields'].append({'path':full,'label':metadata['title'],'value':displayed(value,unit),'unit':unit['display']})
            if collection=='materials':
                for key in ('thermal_resistivity','dry_thermal_resistivity'):field('/'+key,item.get(key))
            elif collection=='sections':
                field('/length',item['length'])
                row['medium_material']=item['medium'].get('material')
                for key in ('surface_temperature','air_temperature'):field('/medium/'+key,item['medium'].get(key))
                row['placements']=[{'cable':p['cable'],'path':path+'/placements/'+token(p['cable'])} for p in item['placements']]
            elif collection=='cable_types':
                for core in item['cores']:
                    field('/cores/'+token(core['id'])+'/conductor/nominal_area',core['conductor']['nominal_area'])
                for key,value in item['rating']['max_conductor_temperature'].items():field('/rating/max_conductor_temperature/'+key,value)
            elif collection=='circuits':
                row['cable_type']=item['cable_type'];row['cables']=item['cables']
            elif collection=='load_cases':
                for key,value in item.get('currents',{}).items():field('/currents/'+token(key),value)
                for key in ('duration','period'):field('/'+key,item.get(key))
            rows.append(row)
        objects[collection]=rows
    return {'name':document['name'],'objects':objects,'next_read':'按返回的稳定对象或字段 paths 读取细节。'}


class ToolBroker:
    def __init__(self,research,tasks,registry,proposals):
        self.research,self.tasks,self.registry,self.proposals=research,tasks,registry,proposals

    def changed_method(self,task,args):
        sid=self.study_id(task,args)
        with self.research.store.db() as db:study=self.research.definition(db,task['workspace_id'],sid)
        selected=self.research.module_definition(study['definition'],args.get('module'))
        methods=[selected['method'],*[row['method'] for row in selected.get('crosschecks',[])],
            *[row['method'] for row in selected.get('candidate_completions',{}).values()]]
        changes=[]
        for saved in methods:
            plugin=self.research.registry(saved['plugin_id']).get(saved['plugin_id'])
            installed=self.research.pin(plugin)
            if installed!={key:saved[key] for key in ('plugin_id','version','release_digest')}:
                changes.append({'saved_method':saved,'installed_method':installed,'method_name':plugin.manifest.name})
        if not changes:return None
        title=study['definition']['title']
        reasons=[row['method_name']+' '+row['saved_method']['version']+' → '+row['installed_method']['version']
            if row['saved_method']['version']!=row['installed_method']['version'] else row['method_name']+' 的发行内容已更新（版本号未变）'
            for row in changes]
        location='型号工作台' if is_type(task) else '研究工作台'
        action='在'+location+'打开“'+title+'”，先用“升级方法”选择当前安装的发行并核对参数，保存后重新预检；需要更新结论时再由人确认并运行。旧运行保留为历史。'
        summary='“'+title+'”保存的方法发行已变化：'+'；'.join(reasons)+'。预检未执行，因此尚不能判断还缺哪些输入；这不是已确认的输入缺项。'
        return ToolResult(status='error',summary=summary,
            data={'study_id':sid,'study_title':title,'module':args.get('module'),'method_changes':changes,
                'preflight_executed':False,'retry_requires_human':True},
            diagnostics=[Diagnostic(code='METHOD_RELEASE_CHANGED',message=summary,recoverable=True,
                details={'method_changes':changes,'retry_requires_human':True})],next_actions=[action])

    def study_id(self,task,args):
        sid=args.get('study_id') or task['study_id']
        if args.get('run_id'):
            with self.research.store.db() as db:
                row=db.execute('SELECT study FROM study_runs WHERE workspace=? AND id=?',
                    (task['workspace_id'],args['run_id'])).fetchone()
            if row is None:raise HTTPException(404,{'code':'RUN_NOT_FOUND','message':'本工程中没有此保存运行。','path':'/run_id'})
            if sid and sid!=row['study']:raise HTTPException(422,{'code':'SCOPE_VIOLATION','message':'保存运行与指定研究不一致。','path':'/run_id'})
            sid=row['study']
        if sid is None:raise HTTPException(422,{'code':'STUDY_REQUIRED','message':'请明确选择本工程内的已保存研究。'})
        if task['study_id'] and sid!=task['study_id']:
            raise HTTPException(422,{'code':'SCOPE_VIOLATION','message':'此会话已绑定另一研究，请新建相应研究的会话。'})
        return sid

    @staticmethod
    def field_points(document,paths):
        fields=[]
        for path in paths:
            value=ToolBroker.path_value(document,path)
            metadata=domain_metadata(path) if document.get('schema_version')=='cablesim.domain/1' and not isinstance(value,(dict,list)) else None
            fields.append({'path':path,'label':metadata['title'] if metadata else '保存输入字段',
                'value':displayed(value,metadata['x-unit']) if metadata else value,
                'unit':metadata['x-unit']['display'] if metadata else None})
        return fields

    @staticmethod
    def path_value(document,path):
        try:return value_at(document,path)
        except (ValueError,KeyError,IndexError,TypeError,HTTPException):
            roots=['/'+key.replace('~','~0').replace('/','~1') for key in document]
            candidates=roots[:]
            for root in roots:
                rows=document[root[1:].replace('~1','/').replace('~0','~')]
                if isinstance(rows,list):
                    for row in rows:
                        if isinstance(row,dict) and row.get('id'):
                            candidates.append(root+'/'+row['id'].replace('~','~0').replace('/','~1'))
            normalized=path.removeprefix('/input')
            closest=get_close_matches(normalized,candidates,n=3,cutoff=.2)
            raise HTTPException(422,{'code':'PATH_NOT_FOUND','path':path,
                'message':'输入路径不存在。可用顶层路径：'+', '.join(roots)+'；最接近路径：'+', '.join(closest),
                'next_actions':['使用 '+candidate+'，或 workspace_read 不带 paths 读取稳定字段路径。' for candidate in closest]}) from None

    def identity(self,task,node,tool):
        require_tool(task,node['tool'])
        args=node['arguments'];identity=deepcopy(node['input_identity'])
        if tool and (tool.method or tool.name in ('study_read','run_list','run_read','study_baseline','sensitivity_inputs','propose_method_parameters','study_preflight','study_preview')):
            sid=self.study_id(task,args) if args.get('run_id') else args.get('study_id') or task['study_id']
            if sid:
                with self.research.store.db() as db:
                    study=self.research.definition(db,task['workspace_id'],sid)
                identity.update(study_id=sid,study_revision=study['revision'])
                if tool.method is None:identity['method']=self.research.module_definition(study['definition'],args.get('module'))['method']
        if args.get('run_id'):identity['run_id']=args['run_id']
        if tool and tool.name in ('platform_read','platform_prepare') and args.get('operation'):
            contract=self.platform.schema(args['operation'])
            identity.update(platform_operation=args['operation'],platform_contract_digest=contract['contract_digest'])
        if tool and tool.name in ('run_read','study_read') and args.get('run_id'):
            with self.research.store.db() as db:
                row=db.execute('SELECT revision FROM workspaces WHERE id=?',(task['workspace_id'],)).fetchone()
                original=db.execute("SELECT json_extract(snapshot,'$.definition.method') AS method,json_extract(snapshot,'$.module') AS module,json_extract(snapshot,'$.study_revision') AS revision FROM study_runs WHERE workspace=? AND id=?",
                    (task['workspace_id'],args['run_id'])).fetchone()
            identity['current_workspace_revision']=row['revision']
            identity.update(method=json.loads(original['method']),run_module=original['module'],run_study_revision=original['revision'])
        if tool:identity['tool_contract_digest']=fingerprint(tool.parameters)
        return identity

    def execute(self,task,node,tool):
        try:
            require_tool(task,node['tool'])
            if tool is None:return failure('TOOL_NOT_ALLOWED','此工具未注册；模型不能调用批准、发布或任意命令。')
            errors=sorted(Draft202012Validator(tool.model()['function']['parameters']).iter_errors(node['arguments']),key=lambda item:str(list(item.path)))
            if errors:
                error=errors[0];path='/'+ '/'.join(str(part) for part in error.absolute_path)
                return failure('TOOL_ARGUMENTS_INVALID','工具参数不符合声明契约：'+error.validator+'。',path)
            recovered=[]
            action=lambda:self.dispatch(task,node['arguments'],tool,node['input_identity'])
            try:value=retry(action,lambda kind,attempt:recovered.append({'category':kind,'attempt':attempt})) if tool.kind=='read' else action()
            finally:
                if recovered:self.tasks.emit(task['id'],'runtime.retry',{'tool':tool.name,'exceptions':recovered,'read_only':True})
            return ToolResult.model_validate(redact(value.model_dump(mode='json'))) if isinstance(value,ToolResult) else ToolResult.model_validate(redact(value))
        except HTTPException as error:
            if error.status_code==409 and tool.name in ('study_preflight','study_preview'):
                changed=self.changed_method(task,node['arguments'])
                if changed:return changed
            detail=error.detail
            return failure(detail.get('code','HOST_REQUEST_REJECTED') if isinstance(detail,dict) else 'HOST_REQUEST_REJECTED',
                redact(detail.get('message') or str(detail)) if isinstance(detail,dict) else redact(str(detail)),
                detail.get('path') if isinstance(detail,dict) else None,
                detail.get('next_actions') if isinstance(detail,dict) else None)
        except PluginHostError as error:
            return failure(error.code,redact(error.message),getattr(error,'path',None))
        except (ValidationError,RequestValidationError) as error:
            issues=error.errors();first=issues[0]
            return failure('INPUT_INVALID',redact(str(first['msg'])),'/'+ '/'.join(str(part) for part in first['loc']))
        except (ValueError,KeyError,TypeError,IndexError):
            return failure('TOOL_INPUT_INVALID','工具输入或来源格式不合法；未生成替代结果。')

    def dispatch(self,task,args,tool,identity):
        wid=task['workspace_id'];name=tool.name
        if name in ('draft_read','draft_update','draft_geometry','simulation_prepare','draft_propose'):
            from .drafts import Drafts
            operation={'draft_read':'read','draft_update':'update','draft_geometry':'geometry',
                'simulation_prepare':'simulation','draft_propose':'propose'}[name]
            return getattr(Drafts(self),operation)(task,args)
        if name=='platform_capabilities':return self.platform.discover(task,args)
        if name=='platform_read':return self.platform.read(task,args)
        if name=='platform_prepare':return self.platform.prepare(task,args)
        if name=='task_plan':
            from .progress import update
            return update(self.tasks,self.registry,task,args)
        if name=='inbox_read':
            from .inbox import read
            return read(self.research,args)
        if name in ('object_find','object_relations'):return read_index(self.research,name,args)
        if name=='type_read':
            from .type_design import read
            return read(self.research,task,args)
        if name=='propose_type_changes':
            type_id=args.get('type_id',wid)
            public=self.proposals.type_changes(task,type_id,args['changes'],args['reason'])
            from backend.index import get_index
            return ToolResult(status='ok',summary='型号字段方案已生成，等待人工保存；未改变型号输入或发布。',
                data={'proposal':public,'object':get_index(self.research).snapshot().cards.get(('type',type_id))},
                next_actions=['审阅字段差异后人工批准或拒绝；保存后在型号工作台更新受影响的运行。'])
        if name=='workspace_list':
            with self.research.store.db() as db:
                rows=[{'id':row['id'],'revision':row['revision'],'name':row['name'],'updated':row['updated']}
                    for row in db.execute("SELECT id,revision,COALESCE(json_extract(state,'$.domain.name'),json_extract(state,'$.scenario.name')) AS name,updated FROM workspaces ORDER BY updated DESC")]
            return ToolResult(status='ok',summary='已读取工程身份与修订。',data={'workspaces':rows})
        if name=='workspace_read':
            current,state,_=self.proposals.source(task)
            document=state.get('domain')
            if document is None:return failure('DOMAIN_INPUT_REQUIRED','工程尚未转换为领域输入，请在工作台显式转换。')
            paths=args.get('paths')
            if paths:
                fields=[]
                for path in paths:
                    value=self.path_value(document,path)
                    if isinstance(value,(dict,list)):
                        fields.append({'path':path,'value':value,'unit':None})
                    else:
                        metadata=domain_metadata(path);unit=metadata['x-unit']
                        fields.append({'path':path,'label':metadata['title'],'value':displayed(value,unit),'unit':unit['display']})
                data={'fields':fields}
            else:
                data={**outline(document),'locks':state.get('locks',[])}
            return ToolResult(status='ok',summary='已读取会话固定版本的工程输入。',data={**data,
                'workspace_id':wid,'workspace_revision':task['workspace_revision'],'current_revision':current['revision'],
                'freshness':'current' if current['revision']==task['workspace_revision'] else 'historical'})
        if name=='study_list':
            studies=self.research.list_studies(wid)
            return ToolResult(status='ok',summary='已读取本工程研究。',data={'studies':[
                {key:row[key] for key in ('id','revision','latest_run_id','version_status')} |
                {'title':row['definition']['title'],'method':row['definition']['method'],'driver':row['definition']['driver']['kind']}
                for row in studies]})
        if name=='project_digest':
            return project_digest(self.research,task,args)
        if name=='fem_comparison_read':return comparisons(self.research,task,args)
        if name=='propose_fem_verification':return propose_fem(self.research,self.proposals,task,args)
        if name=='study_baseline':
            return study_baseline(self.research,task,args)
        if name=='sensitivity_inputs':
            sid=self.study_id(task,args)
            _,state,study=self.proposals.source(task,sid)
            selected=self.research.module_definition(study['definition'],args.get('module'))
            _,cap=self.research.resolve(selected['method'])
            source=selected['method_input'] if selected['input_source']=='study' else state.get('domain')
            if source is None:raise HTTPException(422,'研究缺少明确输入，不能提出敏感性范围。')
            schema,_=schemas(cap,source)
            fields=[]
            for key,spec in schema.get('properties',{}).items():
                if spec.get('readOnly') or (spec.get('x-bind') or {}).get('read_only'):continue
                unit=spec.get('x-unit') or {}
                fields.append({'path':'/parameters/'+key,'value':selected['parameters'].get(key),
                    'unit':unit.get('si'),'schema':spec})
            return ToolResult(status='ok',summary='已读取保存参数与封签约束；未计算敏感性，不补造建议范围。',
                data={'study_id':sid,'method':selected['method'],'fields':fields,
                    'limitations':['定量敏感性需明确候选值、保持同工况并取得试算或人工正式运行证据。']})
        if name=='study_read':
            sid=self.study_id(task,args)
            _,_,study=self.proposals.source(task,sid)
            module=args.get('module')
            if args.get('run_id'):
                with self.tasks.db() as db:
                    original=db.execute("SELECT json_extract(snapshot,'$.study_revision') AS revision,json_extract(snapshot,'$.workspace_revision') AS workspace_revision,json_extract(snapshot,'$.module') AS module,json_array_length(snapshot,'$.cases') AS case_count,json_extract(snapshot,'$.cases[0].case_id') AS first_case FROM study_runs WHERE workspace=? AND id=?",
                        (wid,args['run_id'])).fetchone()
                    study=self.research.definition(db,wid,sid,original['revision'])
                module=module if module is not None else original['module']
            definition=self.research.module_definition(study['definition'],module)
            data={'study_id':sid,'revision':study['revision'],'workspace_revision':task['workspace_revision'],
                'definition':{key:definition[key] for key in ('title','task','method','parameters','input_source')},
                'driver':{key:value for key,value in definition['driver'].items() if key!='cases'},
                'cases':[{'case_id':case['case_id'],'label':case['label'],'parameters':case.get('parameters',{})}
                    for case in definition['driver'].get('cases',[])]}
            if args.get('run_id'):data.update(run_id=args['run_id'],workspace_revision=original['workspace_revision'])
            if args.get('input_paths'):
                _,state,_=self.proposals.source(task)
                if args.get('run_id'):
                    cid=args.get('case_id') or (original['first_case'] if original['case_count']==1 else None)
                    if cid is None:raise HTTPException(422,{'code':'CASE_REQUIRED','message':'读取原运行输入须指定保存工况。','path':'/case_id'})
                    from backend.kernel.run_details import case_input
                    source=case_input(self.research,wid,sid,args['run_id'],cid)['input']
                    data['case_id']=cid
                elif definition['driver']['kind']=='batch':
                    case=next((case for case in definition['driver']['cases'] if case['case_id']==args.get('case_id')),None)
                    if case is None:raise HTTPException(422,'读取批量保存输入须明确已有case_id。')
                    source=case['input']
                else:source=definition['method_input'] if definition['input_source']=='study' else state.get('domain')
                if source is None:raise HTTPException(422,'此研究缺少保存输入。')
                data['input_fields']=self.field_points(source,args['input_paths'])
            return ToolResult(status='ok',summary='已读取保存研究的定义与工况。',data=data)
        if name=='run_list':
            if not (args.get('study_id') or task['study_id']):
                return project_digest(self.research,task,args)
            sid=self.study_id(task,args)
            page=self.research.list_runs(wid,sid,args.get('after',0),args.get('limit',5),view='summary')
            return ToolResult(status='ok',summary='已读取保存运行摘要；空结论没有补默认值。',data=page)
        if name=='run_read':
            sid=self.study_id(task,args);run=self.research.get_run(wid,args['run_id'])
            if run['study']!=sid:raise HTTPException(404,'运行不属于此会话研究。')
            data=run_points(self.research,run,args.get('case_id'),entity=args.get('entity'),key=args.get('key'))
            if args.get('input_paths'):
                if not args.get('case_id'):raise HTTPException(422,'读取原运行输入须明确已有case_id。')
                from backend.kernel.run_details import case_input
                original=case_input(self.research,wid,sid,args['run_id'],args['case_id'])
                data['input_fields']=self.field_points(original['input'],args['input_paths'])
                data['case_input_digest']=original['input_digest']
            refs=data.pop('artifact_refs')
            return ToolResult(status='ok',summary='已读取保存运行的量值与分项证据；完整性通过不代表工程批准。',
                data=data,artifact_refs=refs,execution_ref={'run_id':run['id'],'study_id':sid,'status':run['status']})
        if name=='plugin_inspect':
            from backend.kernel.input_contracts import contracts
            entries=contracts(self.research)
            if args.get('tool'):
                requested=self.registry.tools().get(args['tool'])
                if requested is None or requested.plugin_id is None:raise HTTPException(404,'指定工具不是已安装插件能力。')
                if args.get('plugin_id') and args['plugin_id']!=requested.plugin_id or args.get('capability') and args['capability']!=requested.method['capability']:
                    raise HTTPException(422,'工具名与插件能力筛选不一致。')
                args={**args,'plugin_id':requested.plugin_id,'capability':requested.method['capability']}
            selected=[entry for entry in entries if (not args.get('plugin_id') or entry['method']['plugin_id']==args['plugin_id'])
                and (not args.get('capability') or entry['method']['capability']==args['capability'])]
            if not selected:raise HTTPException(404,'没有匹配的已安装插件能力。')
            enabled=[tool.name for tool in self.registry.tools().values() if tool.method==selected[0]['method']] if not is_type(task) and len(selected)==1 and args.get('capability') else []
            if args.get('schema_path'):
                if len(selected)!=1:raise HTTPException(422,'按字段读取契约须明确一个插件能力。')
                spec=selected[0]
                return ToolResult(status='ok',summary='已按字段读取封签输入契约。',data={
                    'enabled_tools':enabled,'method':spec['method'],'path':args['schema_path'],'schema':value_at(spec,args['schema_path'])})
            if not args.get('capability'):
                selected=[{key:entry[key] for key in ('method','input_schema','input_sources','preview','reference_only')} for entry in selected]
            return ToolResult(status='ok',summary='已读取封签插件能力与输入契约。',data={'enabled_tools':enabled,'contracts':selected})
        if name=='cable_model_read':
            from backend.kernel.scenarios import system_models
            from backend.kernel.candidates import read
            model=next((item for item in system_models() if item['id']==args['model_id']),None)
            if model is None:
                with self.research.store.db() as db:model=read(db,args['model_id'])
            if args.get('path'):model={'model_id':args['model_id'],'path':args['path'],'value':value_at(model,args['path'])}
            return ToolResult(status='ok',summary='已读取型号结构和来源；未采用或批准型号。',data={'model':model})
        if name=='propose_domain_changes':
            public=self.proposals.domain(task,args['changes'],args.get('title') or '调整工程输入')
            return ToolResult(status='ok',summary='领域输入方案已生成，等待人工批准。',data={'proposal':public},next_actions=['在工作台审阅字段差异并批准或拒绝。'])
        if name=='propose_method_parameters':
            sid=self.study_id(task,args)
            public=self.proposals.parameters(task,sid,args.get('module'),args['changes'],args.get('title') or '调整方法参数')
            return ToolResult(status='ok',summary='方法参数方案已生成，等待人工批准。',data={'proposal':public},next_actions=['在工作台审阅字段差异并批准或拒绝。'])
        if name in ('study_preflight','study_preview') or tool.method:
            if tool.method and not (args.get('study_id') or task['study_id']):
                if args.get('module'):raise HTTPException(422,'新建研究方案不能引用尚不存在的模块。')
                public=self.proposals.study(task,tool.method,args.get('parameters'),args.get('title') or tool.title)
                return ToolResult(status='ok',summary='新建研究方案已生成，等待人工批准；未执行插件。',
                    data={'proposal':public},next_actions=['在工作台审阅并保存研究，再预检或运行。'])
            sid=self.study_id(task,args)
            _,_,study=self.proposals.source(task,sid)
            if study['revision']!=identity.get('study_revision',study['revision']):raise HTTPException(409,'研究在工具意图登记后已变化。')
            selected=self.research.module_definition(study['definition'],args.get('module'))
            plugin,cap=self.research.resolve(selected['method'])
            if tool.method and selected['method']!=tool.method:
                return failure('METHOD_MISMATCH','此插件工具与已保存研究方法不一致；请人工配置并保存对应研究。')
            hpc=bool(hasattr(self.research.executor,'required') and self.research.executor.required(plugin.manifest.id,cap.id))
            methods=[entry['method'] for entry in selected.get('crosschecks',[])]
            methods.extend(entry['method'] for entry in selected.get('candidate_completions',{}).values())
            remote_dependencies=any(hasattr(self.research.executor,'required') and self.research.executor.required(entry['plugin_id'],entry['capability']) for entry in methods)
            if hpc or remote_dependencies or not cap.preview:
                return failure('HUMAN_EXECUTION_REQUIRED','此能力需要正式或超算运行，由人在工作台确认；未提交作业。',
                    actions=['在工作台核对方法范围与预算，人工批准正式运行。'])
            if name=='study_preflight':
                data=self.research.preflight(wid,sid,task['workspace_revision'],study['revision'],args.get('module'))
                issues=[row.get('error') for row in [*data.get('cases',[]),*data.get('crosschecks',[])] if row.get('error')]
                return ToolResult(status='ok' if data['ready'] else 'error',summary='研究预检通过。' if data['ready'] else '研究预检未通过，请补齐明确缺项。',
                    data=data,diagnostics=[Diagnostic(code=issue.get('code','PREFLIGHT_FAILED'),message=issue.get('message','预检失败。'),path=issue.get('path'),recoverable=True) for issue in issues],
                    next_actions=[] if data['ready'] else ['根据预检路径读取输入，生成修正方案；不要猜测物性。'])
            overrides={}
            if args.get('proposal_id') or args.get('run_id') or selected['driver']['kind']!='single':
                overrides=self.proposals.preview_inputs(task,sid,args.get('module'),args.get('proposal_id'),args.get('run_id'),args.get('case_id'))
            else:overrides['parameters']=args.get('parameters')
            body=PreviewStudy(expected_revision=task['workspace_revision'],expected_study_revision=study['revision'],
                module=args.get('module'),**overrides)
            with self.research.store.db() as db:budget=self.tasks.load(db,task['id'])
            data=preview(self.research,wid,sid,body,max_timeout_s=min((budget['limits']['max_active_ms']-budget['elapsed_ms'])/1000,budget['deadline']-time()))
            refs=[{'execution_id':data['execution_id'],'case_id':case['case_id'],'artifact_type':kind,'sha256':digest,
                    'verification':data.get('artifact_status',{}).get(case['case_id'],{}).get(kind,{}).get('status','unknown')}
                for case in data['cases'] for kind,digest in case.get('artifact_digests',{}).items()]
            result={key:data[key] for key in ('preview','persisted','engineering_approval','status','elapsed_ms','input_digest','headlines')}
            result['proposal_id']=args.get('proposal_id');result['source_run_id']=args.get('run_id');result['source_case_id']=args.get('case_id')
            result['cases']=[{key:case.get(key) for key in ('case_id','status','results','error','warnings')} for case in data['cases']]
            errors=[case['error'] for case in data['cases'] if case.get('error')]
            return ToolResult(status='ok' if data['status']=='succeeded' else 'error',summary='快速预览已完成；未保存运行，未批准工程结果。' if data['status']=='succeeded' else '快速预览失败，未返回替代数值。',
                data=result,artifact_refs=refs,diagnostics=[Diagnostic(code=issue['code'],message=issue['message'],path=issue.get('path'),recoverable=True) for issue in errors],
                execution_ref={'type':'preview','execution_id':data['execution_id'],'input_digest':data['input_digest'],'persisted':False},
                next_actions=['需要交付证据时，在工作台人工确认并保存正式运行。'])
        return failure('TOOL_NOT_ALLOWED','此动作未登记为 Agent 工具。')
