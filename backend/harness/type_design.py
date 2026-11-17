"""Read saved type facts and prepare edits through the ordinary domain editor."""
from copy import deepcopy
import json
from math import isfinite

from fastapi import HTTPException
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError

from backend.domain.editing import DraftDomainDocument, resolve_edit
from backend.domain.guards import describe_locks, pointer, value_at
from backend.kernel.type_versions import Types, check_results
from backend.kernel.workspace import fingerprint
from backend.index import get_index

from .contracts import ToolResult
from .context_builder import fits
from .fields import check_edits, domain_metadata, displayed, stored, target, changed_domain


def reject(code, path, message):
    raise HTTPException(422, {'code': code, 'path': path, 'message': message})


def validate_type(state):
    if not (state.get('type_origin_reference') or state.get('type_creation')) or state.get('study_cable_reference') or len(state.get('domain', {}).get('cable_types', [])) != 1:
        reject('TYPE_WORKSPACE_REQUIRED', '/type_id', '请选择独立的型号设计工作区；工程内锁定的型号版本引用不能作为型号设计修改。')


def metadata(path):
    spec = domain_metadata(path)
    if spec['x-unit']['si'] == 'm':
        spec = {**spec, 'x-unit': {**spec['x-unit'], 'display': 'mm', 'scale': 1000}}
    return spec


def diagnostic_path(error, document, fallback):
    loc = error.errors()[0]['loc']
    tokens = []; current = document
    for token in loc:
        if token in ('body', 'document') and not tokens: continue
        if isinstance(current, list) and isinstance(token, int) and token < len(current):
            child = current[token]; token = child.get('id') or child.get('role') or token
            current = child
        elif isinstance(current, dict) and token in current: current = current[token]
        else: return pointer(*tokens) if tokens else fallback
        tokens.append(token)
    return pointer(*tokens) if tokens else fallback


def candidate(state, changes, proposal_id):
    check_edits(changes); validate_type(state)
    if state['domain'].get('schema_version')!='cablesim.domain/1':
        reject('TYPE_DRAFT_INCOMPLETE',changes[0]['path'],
            '此型号仍是不完整草稿；请先在型号工作台补齐必填结构、额定要求及来源，再提出可保存的型号改动方案。')
    document = deepcopy(state['domain']); edits = []
    cable = document['cable_types'][0]; prefix = pointer('cable_types', cable['id'])
    for change in changes:
        path = change['path']
        if not path.startswith(prefix + '/'):
            reject('TYPE_FIELD_NOT_EDITABLE', path, '型号方案只修改本型号结构与额定要求；不能替换材料物性、来源、工程或整组对象。')
        parent, key = target(document, path, stable=True)
        unit = metadata(path)['x-unit']; value = change['value']
        if unit['si'] and (type(value) not in (int, float) or not isfinite(value) or change.get('unit') is None):
            reject('TYPE_UNIT_REQUIRED', path, '工程量必须给有限数值和明确单位：' + str(unit['display']) + '。')
        try: value = stored(value, unit, change.get('unit'))
        except HTTPException as error:
            raise HTTPException(error.status_code, {**error.detail, 'path': path}) from None
        if key == 'material' and value not in {m['id'] for m in document['materials']}:
            reject('TYPE_MATERIAL_NOT_FOUND', path, '材料引用必须来自此型号文档中已有的明确材料；请先在型号工作台导入并核对所需材料版本。')
        parent[key] = value; edits.append({'path': path, 'value': value})
        document.setdefault('provenance', {})[path] = {'kind': 'user', 'reviewed': False,
            'reference': 'Agent 型号方案 ' + proposal_id + '；设计输入，未自动标为厂家实测或标准符合。'}
    try: resolved = resolve_edit(state, DraftDomainDocument.model_validate(document))
    except (ValidationError, RequestValidationError) as error:
        reject('TYPE_INPUT_INVALID', diagnostic_path(error, document, changes[0]['path']), str(error.errors()[0]['msg']))
    except HTTPException as error:
        path = changes[0]['path']
        for lock in describe_locks(state):
            if lock['path'] in str(error.detail):
                path = next((p for p in lock['targets'] if value_at(state['domain'], p) != value_at(document, p)),
                    next(iter(lock['targets']),path))
        reject('TYPE_FIELD_LOCKED', path, str(error.detail))
    differences = changed_domain(state['domain'], resolved)
    for difference in differences:
        if difference['unit'] == 'm':
            difference.update(before=displayed(difference['before'], {'scale':1000,'offset':0}),
                after=displayed(difference['after'], {'scale':1000,'offset':0}), unit='mm')
    if not differences: reject('TYPE_NO_CHANGE', changes[0]['path'], '方案没有实际字段变化。')
    return resolved, edits, differences


def read(research, task, args):
    wid = args.get('type_id',task['workspace_id']); view = args.get('view', 'summary')
    types = Types(research, None)
    with research.store.db() as db:
        row, state = types._type(db, wid); validate_type(state)
        if args.get('expected_revision',row['revision'])!=row['revision']:
            raise HTTPException(409,{'code':'TYPE_REVISION_CONFLICT','path':'/expected_revision','message':'型号分页基准修订已变化，请从第一页重读。'})
        if wid == task['workspace_id'] and row['revision'] != task['workspace_revision']:
            raise HTTPException(409, {'code':'TYPE_REVISION_CONFLICT','path':'/type_id',
                'message':'型号修订已变化，请刷新型号并建立当前修订的会话。'})
        plan = db.execute('SELECT family FROM type_plans WHERE workspace=?', (wid,)).fetchone()
        plans = [dict(p) for p in db.execute('SELECT workspace,name,status,base_reference FROM type_plans WHERE family=? ORDER BY created',
            (plan['family'],))] if plan else []
        submitted = db.execute("SELECT id,status,digest,receipt,json_extract(payload,'$.revision') AS revision FROM type_submissions WHERE workspace=? ORDER BY rowid DESC LIMIT 1", (wid,)).fetchone()
        released = db.execute('SELECT asset FROM engineering_type_releases WHERE workspace=?', (wid,)).fetchone()
    card = get_index(research).snapshot().cards.get(('type', wid))
    entries = []; document = state['domain']; cable = document['cable_types'][0]
    source = {'kind':'saved_type_input','type_id':wid,'revision':row['revision'],'digest':fingerprint(document)}
    def add(section, **values): entries.append({'section':section, **values})
    base=state.get('type_origin_reference') or {}
    creation=state.get('type_creation') or {}
    identity_keys=('id','name','version','content_sha256','source','document_id','proposal_id')
    created_source=creation.get('source') or {}
    # Imported provenance and standard proposal tables may be large. The
    # overview carries saved identities, not another copy of those documents.
    creation_summary={key:creation[key] for key in ('id','kind','created') if key in creation}
    if creation:
        creation_summary['source']={key:created_source[key] for key in identity_keys if key in created_source}
        creation_summary['source']['methods']=[item.get('method') for item in created_source.get('methods',[]) if isinstance(item,dict)]
    add('overview', object=card, construction=cable['construction'], base_reference={key:base[key] for key in identity_keys if key in base} or None,
        creation=creation_summary or None,
        locks=describe_locks(state), source=source)
    if view in ('summary', 'input', 'structure', 'review'):
        def fields(item, tokens):
            if isinstance(item, dict):
                for key, child in item.items():
                    if key != 'id': fields(child, [*tokens, key])
            elif isinstance(item, list):
                for child in item: fields(child, [*tokens, child.get('id') or child.get('role')])
            else:
                path = pointer(*tokens)
                try: spec = metadata(path)
                except HTTPException: return  # No guessed unit for unregistered fields.
                if view == 'review' and tokens[-1] not in ('thickness','material','u0','u','um'): return
                if item is None:
                    if document.get('schema_version')=='cablesim.type-draft/1':
                        add('checks',id=path,path=path,label=spec['title'],message='草稿字段尚未填写；请在型号工作台核对所需输入及来源。',blocking=True,source=source)
                    return
                add('structure', path=path, label=spec['title'], value=displayed(item, spec['x-unit']), unit=spec['x-unit']['display'],
                    source={**source,'path':path,'provenance':document.get('provenance',{}).get(path)},
                    material=next(({'id':m['id'],'name':m['label'],'source':document.get('provenance',{}).get(pointer('materials',m['id']))}
                        for m in document['materials'] if m['id']==item), None) if tokens[-1]=='material' else None)
        fields(cable, ['cable_types', cable['id']])
    if view in ('summary','plans'):
        for plan in plans: add('plans', **{**plan, 'base_reference':json.loads(plan['base_reference'])})
        if not plans: add('plans', reason='尚未保存其他型号方案。')
    if view in ('summary','specification','review'):
        lifecycle = {'status':submitted['status'] if submitted else 'draft','submission_id':submitted['id'] if submitted else None,
            'stale':bool(submitted and submitted['revision'] != row['revision']), 'published_asset_id':released['asset'] if released else None}
        if submitted and submitted['receipt']: lifecycle['approval']=types._receipt(submitted['receipt'])
        add('specification', **lifecycle)
    if view in ('summary','structure','requirements','runs','review'):
        evidence_row, evidence_state, channels, checks = types.evidence(wid)
        if evidence_row['revision'] != row['revision'] or fingerprint(evidence_state['domain']) != source['digest']:
            raise HTTPException(409, {'code':'TYPE_REVISION_CONFLICT','path':'/type_id','message':'读取期间型号输入变化，请刷新后重读。'})
        check_results(channels, checks)
        for check in checks: add('checks', **check)
        for channel, item in channels.items():
            run = item['run']; origin = types._source(channel, item)
            add('runs', run_id=run['id'], study_id=run['study'], channel=channel, source=origin)
            if channel == 'standards' and view in ('summary','requirements','review'):
                for check in item['artifact'].get('rows', []):
                    values = {key:check.get(key) for key in ('id','title','target','standard','clause','printed_page','pdf_page','verdict','reason','source_status')}
                    add('requirements', **values, source=origin, quantities=[{'key':key,'value':check.get(key),'unit':check.get('unit')}
                        for key in ('actual','limit')])
            if channel == 'geometry' and view in ('summary','structure'):
                artifact = item['artifact']
                add('diameter_chain', key='outer_diameter', value=artifact.get('outer_diameter_m'), unit='m', source=origin)
                for layer in artifact.get('layers', []):
                    add('diameter_chain', label=layer.get('role'), source=origin, quantities=[{'key':key,'value':layer.get(key),'unit':'m'}
                        for key in ('inner_diameter_m','outer_diameter_m','thickness_m') if key in layer])
    after = args.get('after',0); limit = args.get('limit',20)
    data = {'object':card,'type_id':wid,'type_revision':row['revision'],'view':view,'total':len(entries),'items':[], 'next_page':None}
    summary = ('已读取保存型号输入与草稿缺项；未读取已有运行或标准核对，输入完整不代表计算或符合性通过。'
               if view == 'input' else '已读取保存型号输入及已有运行；缺项、历史结果与标准未覆盖均未推算为通过。')
    result = ToolResult(status='ok', summary=summary, data=data)
    count = 0
    for entry in entries[after:after+limit]:
        result.data['items'].append(entry)
        result.data['next_page']={'type_id':wid,'view':view,'after':after+count+1,'limit':limit,'expected_revision':row['revision']} if after+count+1<len(entries) else None
        if not fits(result.model_dump(mode='json'), 6*1024-256):
            result.data['items'].pop(); break
        count += 1
    result.data['next_page']={'type_id':wid,'view':view,'after':after+count,'limit':limit,'expected_revision':row['revision']} if after+count<len(entries) else None
    if after<len(entries) and not count:
        reject('TYPE_RESULT_TOO_LARGE','/view','单项型号证据超过上下文上限，请在型号工作台查看原记录。')
    if result.data['next_page']: result.next_actions=['按 next_page 原参数继续 type_read；未展示的条目不能声称已检查。']
    return result
