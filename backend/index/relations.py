"""Edges from saved IDs and pins; absent bindings remain explicitly unresolved."""
import json

from backend.kernel.version_status import methods
from backend.kernel.type_versions import Types
from .contracts import ObjectCard
from .sources import decoded


def pin(reference):
    return {key:value for key,value in {'version':reference.get('version'),
        'revision':reference.get('revision'),'digest':reference.get('content_sha256') or reference.get('release_digest')}.items() if value is not None}


def method_edges(index,card,definition):
    for configuration in [definition,*definition.get('modules',{}).values()]:
        if not configuration.get('method'):
            index.missing((card['kind'],card['id']),'method','保存配置没有完整的方法引用，请在原研究核对。')
            continue
        for method in methods(configuration):
            target=index.get('plugin',method['plugin_id'])
            if target is None:
                target=ObjectCard(kind='plugin',id=method['plugin_id'],name=method['plugin_id'],
                    version=method['version'],status={'code':'unknown','label':'未安装','reason':'保存方法当前未安装。'},updated=None).model_dump(mode='json')
            index.link(card,target,'method',pin=pin(method))


def sources(index,card,values):
    """Structured extraction references contain document IDs, original hashes and pages."""
    rows=values.values() if isinstance(values,dict) else values or []
    for source in rows:
        if not isinstance(source,dict):continue
        reference=source.get('reference')
        if source.get('kind')=='project_input' and isinstance(reference,str) and any(
            release['asset']==card['id'] and reference=='规格书 '+release['submission']+' sha256:'+release['digest']
            for release in index.raw['releases']):
            continue  # The exact saved receipt is consumed by source_specification.
        try:reference=json.loads(reference) if isinstance(reference,str) else reference
        except (ValueError,TypeError):reference=None
        if isinstance(reference,dict) and isinstance(reference.get('source_design'),dict):
            ref=reference['source_design'];target=index.workspace(ref.get('id'))
            if target and target['kind']=='type':index.link(card,target,'source_design',pin=pin(ref),
                freshness='unknown' if ref.get('revision') is None else None,
                reason='保存来源未标明发布修订。' if ref.get('revision') is None else None)
            else:index.missing((card['kind'],card['id']),'source_design','保存的来源型号设计未在本库登记。')
            if not reference.get('document_id'):continue
        if not isinstance(reference,dict) or not reference.get('document_id'):
            index.missing((card['kind'],card['id']),'standard' if source.get('kind')=='standard' else 'source',
                '保存的出处没有关联文档或规则资源的稳定 ID；不能按名称推定关联。')
            continue
        did=reference['document_id'];document=index.get('document',did)
        if document is None:
            document=ObjectCard(kind='document',id=did,name=did,status={'code':'unknown','label':'原件未登记'},updated=None).model_dump(mode='json')
        pages=[reference['page']] if reference.get('page') is not None else [s['page'] for s in reference.get('selections',[]) if 'page' in s]
        reason='来源页码：'+', '.join(map(str,sorted(set(pages)))) if pages else '保存出处未标注页码。'
        index.link(card,document,'source_document',pin={'digest':reference.get('original_sha256')},reason=reason)


def resource_edges(index,card,row):
    bindings=decoded(row['resource_bindings'],{})
    if not isinstance(bindings,dict) or bindings.get('schema')!='cablesim.type-resource-bindings/1':bindings={}
    # Use the same target identities/fingerprints as the type workspace. These
    # projections contain input facts and review receipts, never solver outputs.
    state={'domain':{'materials':decoded(row['material_facts'],[]),
        'cable_types':decoded(row['type_structure'],[])},'type_resource_bindings':{
            role:{key:{**ref,'name':ref.get('name') or key} for key,ref in bindings.get(role,{}).items() if isinstance(ref,dict)}
            for role in ('material','standard') if isinstance(bindings.get(role,{}),dict)}}
    targets=Types(index.research,None)._resource_targets(index.db,row['id'],state)
    for role in ('material','standard'):
        selected=[target for target in targets if target['role']==role]
        if not selected:index.missing(('type',row['id']),role,'未绑定资源：没有保存可识别的'+('材料' if role=='material' else '标准')+'目标。')
        for item in selected:
            ref=state['type_resource_bindings'].get(role,{}).get(item['id'])
            if not ref or not ref.get('resource_id'):
                index.missing(('type',row['id']),role,'未绑定资源：'+item['name']+'（'+item['id']+'）。')
                continue
            target=index.get('asset',ref['resource_id'])
            if target is None:
                target=ObjectCard(kind='asset',id=ref['resource_id'],name=ref['name'],version=ref.get('version'),
                    status={'code':'unknown','label':'资源未登记','reason':'型号保存的资源版本未在本库登记。'},updated=None).model_dump(mode='json')
            freshness=None;reason='型号保存的资源绑定：'+item['id']
            if item['input_digest'] is None:
                freshness='outdated';reason='目标已不属于当前型号或已批准标准，请解除该引用。'
            elif ref.get('input_digest') is None:
                freshness='unknown';reason='绑定未保存输入摘要，无法判断绑定后是否变化。'
            elif ref['input_digest']!=item['input_digest']:
                freshness='outdated';reason='材料参数在绑定后被修改' if role=='material' else '执行标准在绑定后被修改'
            elif target['status']['code'] not in ('published','unknown'):
                freshness='outdated';reason='绑定资源已不处于发布状态，请重新核对。'
            index.link(card,target,role,pin=pin(ref),freshness=freshness,reason=reason)


def build(index):
    for card in list(index.cards.values()):
        if card['kind']=='validation':index.link(index.get('plugin',card['parent']['id']),card,'validation')
    for row in index.raw['assets']:
        card=index.get('asset',row['id']) or index.get('cable_version',row['id'])
        for ref in decoded(row['dependencies'],[]):
            found=next((r for r in index.raw['assets'] if r['asset_id']==ref['asset_id'] and r['version']==ref['version']),None)
            if found:
                target=index.get('asset',found['id']) or index.get('cable_version',found['id'])
                index.link(card,target,'dependency',pin=pin(ref))
            else:index.missing((card['kind'],card['id']),'dependency','资源依赖 '+ref['asset_id']+' '+ref['version']+' 未在本库登记。')
        sources(index,card,decoded(row['sources'],[]))
    for row in index.raw['models']:sources(index,index.get('cable_version',row['id']),decoded(row['sources'],{}))
    for row in index.raw['workspaces']:
        card=index.workspace(row['id'])
        reference=decoded(row['cable_reference'],{})
        if not reference.get('id'):reference=decoded(row['origin_reference'],{})
        if reference.get('id'):index.link(card,index.reference(reference),'source' if card['kind']=='type' else 'cable_version',pin=pin(reference))
        if card['kind']=='type':
            key=('type',row['id'])
            if not any(r['workspace']==row['id'] for r in index.raw['releases']):
                index.missing(key,'published_cable_version','本设计没有保存的发布记录；不能推定其对应的型号版本。')
            resource_edges(index,card,row)
            creation=decoded(row['type_creation'],{})
            source=creation.get('source',{}) if isinstance(creation,dict) else {}
            if creation.get('kind')=='standard':
                if not source.get('methods'):index.missing(key,'method','新建来源未保存完整方法身份。')
                for method in source.get('methods',[]):
                    if isinstance(method,dict) and method.get('method'):method_edges(index,card,{'method':method['method']})
                    else:index.missing(key,'method','新建来源未保存完整方法身份。')
            if creation.get('kind')=='import':
                refs=source.get('references',{})
                sources(index,card,refs)
                if not refs and source.get('document_id'):sources(index,card,[{'reference':source}])
                index.link(card,index.get('proposal',source.get('proposal_id')),'source_proposal')
            if not reference.get('id') and not source:
                index.missing(key,'source','没有保存来源版本；空白设计不推定来源。')
    for row in index.raw['studies']:
        card=index.get('study',row['id']);workspace=index.workspace(row['workspace']);definition=decoded(row['definition'])
        index.link(card,workspace,'workspace')
        method_edges(index,card,definition)
        # Standalone inputs are independent of the project's adopted model.
        if definition['input_source']=='domain':
            source=index.workspaces[row['workspace']];reference=decoded(source['cable_reference'],{})
            if not reference.get('id'):reference=decoded(source['origin_reference'],{})
            if reference.get('id'):index.link(card,index.reference(reference),'cable_version',pin=pin(reference))
            else:index.missing(('study',row['id']),'cable_version','工程输入未绑定型号资源版本。')
        else:index.missing(('study',row['id']),'cable_version','研究采用独立输入，没有保存型号版本绑定。')
    for row in index.raw['runs']:
        card=index.get('run',row['id']);snapshot=index.state(row)['snapshot']
        index.link(card,index.get('study',row['study']),'study',pin={'revision':snapshot.get('study_revision')})
        index.link(card,index.get('input_snapshot',row['id']),'input_snapshot',pin={'digest':row['input_digest']})
        method_edges(index,card,snapshot.get('definition',{}))
        index.link(index.get('job',row['id']),card,'run')
    for row in index.raw['deliveries']+index.raw['submissions']:
        card=index.get('delivery',row['id']);workspace=index.workspace(row['workspace'])
        index.link(card,workspace,'workspace',pin={'revision':row.get('revision')} if 'revision' in row else None)
        if workspace and workspace['kind']=='type':index.link(workspace,card,'specification')
        for source in decoded(row['sources'],[]):
            if not isinstance(source,dict) or not source.get('run_id'):continue
            run=index.get('run',source['run_id'])
            if run:
                index.link(card,run,'source_run',pin={'digest':source.get('output_digest')})
                index.link(run,card,'delivery')
            else:index.missing(('delivery',row['id']),'source_run','交付的保存运行 '+source['run_id']+' 未在本库登记。')
    for row in index.raw['releases']:
        card=index.get('cable_version',row['asset']);design=index.workspace(row['workspace'])
        origin=decoded(row.get('source_design'),{})
        revision=origin.get('revision',row.get('revision'))
        index.link(card,design,'source_design',pin={'revision':revision} if revision is not None else None,
            freshness='unknown' if revision is None else None,reason='发布记录未保存来源修订。' if revision is None else None)
        index.link(card,index.get('delivery',row['submission']),'source_specification',pin={'digest':row['digest']})
        if card:index.link(design,card,'published_cable_version',pin={'version':card['version'],
            'digest':index.meta.get(('cable_version',card['id']),{}).get('digest')})
    for row in index.raw['document_proposals']:
        proposal=index.get('proposal',row['id']);document=index.get('document',row['document'])
        index.link(proposal,document,'source_document')
        if row['new_model']:index.link(index.get('cable_version',row['new_model']),proposal,'source_proposal',pin={'digest':row['digest']})
    for row in index.raw['tasks']:
        card=index.get('agent_task',row['id'])
        index.link(card,index.workspace(row['workspace_id']),'workspace',pin={'revision':row['workspace_revision']})
        index.link(card,index.get('study',row['study_id']),'study')
    for row in index.raw['agent_proposals']:
        card=index.get('proposal',row['id']);task=index.get('agent_task',row['task_id'])
        index.link(card,task,'agent_task')
        if task:
            owner=next(r for r in index.raw['tasks'] if r['id']==row['task_id'])
            index.link(card,index.workspace(owner['workspace_id']),'workspace',pin={'revision':row['revision']})
        index.link(card,index.get('study',row['study_id']),'study')
        if row['type_id']:index.link(card,index.get('type',row['type_id']),'type',pin={'revision':row['revision']})
    for row in index.raw['convergence']:
        index.link(index.get('job','convergence:'+row['id']),index.get('study',row['study']),'study')
    for row in index.raw['datasets']:index.link(index.get('run',row['id']),index.get('study',row['study']),'study')
