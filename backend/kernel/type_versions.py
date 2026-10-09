"""Type branches and human publication over immutable research evidence.

Draft facts remain workspace documents. Published payloads extend assembly assets;
this service formats saved outputs and never performs engineering calculations.
"""
from copy import deepcopy
import json
import getpass
import re
from typing import Literal
from uuid import UUID, uuid4
from threading import Lock

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import Response
from hashlib import sha256
from pydantic import Field, field_validator, model_validator, ValidationError
from jsonschema import Draft202012Validator
from ..plugin_host.registry import PluginHostError

from ..domain.models import CableType, DomainDocument
from ..foundation.contracts import AssetRef, AssetRelease, SourceReference
from ..schemas import StrictModel
from .workspace import fingerprint, stamp
from .rating_table import is_rating_table, rating_rows


from .type_specification import CHANNELS, CHAPTERS, clean_name, render_specification


class Branch(StrictModel):
    expected_revision: int = Field(ge=1)
    request_id: UUID
    name: str = Field(min_length=1, max_length=80)
    document: DomainDocument | None = None

    @field_validator('name')
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError('请输入方案名称。')
        return value.strip()


class Adopt(StrictModel):
    expected_revision: int = Field(ge=1)
    request_id: UUID


class GenerateSpecification(Adopt):
    audience: Literal['customer', 'internal'] = 'customer'
    scope_acknowledged: Literal[True]


class BindResource(Adopt):
    operation: Literal['bind_resource'] = 'bind_resource'
    role: Literal['material', 'standard']
    target_id: str = Field(min_length=1, max_length=200)
    resource_id: UUID | None = None


class MigrateResources(Adopt):
    operation: Literal['migrate_resource_bindings'] = 'migrate_resource_bindings'


class NewType(StrictModel):
    request_id: UUID
    origin: Literal['library', 'standard', 'import', 'blank']
    name: str = Field(min_length=1, max_length=80)
    construction: Literal['single_core', 'three_core'] | None = None
    resource_id: UUID | None = None
    content_sha256: str | None = Field(default=None, pattern=r'^[a-f0-9]{64}$')
    proposal_id: UUID | None = None
    human_confirmed: bool = Field(default=False, strict=True)

    @model_validator(mode='after')
    def choice(self):
        self.name = self.name.strip()
        if not self.name:
            raise ValueError('name：请输入型号名称。')
        if self.origin == 'blank' and self.construction is None or self.origin == 'library' and (self.resource_id is None or self.content_sha256 is None) or self.origin in ('standard', 'import') and (self.proposal_id is None or self.content_sha256 is None):
            raise ValueError('origin：所选起点缺少结构、来源身份或内容摘要。')
        return self


class NewTypeProposal(StrictModel):
    request_id: UUID
    input: dict


class SaveTypeDocument(Adopt):
    operation: Literal['save_type_document'] = 'save_type_document'
    document: dict


def skeleton(construction, name):
    return {'schema_version': 'cablesim.type-draft/1', 'name': name,
        'materials': [{'id': 'material/conductor', 'label': '待选导体材料', 'category': 'conductor'},
                      {'id': 'material/insulation', 'label': '待选绝缘材料', 'category': 'insulation'}],
        'cable_types': [{'id': 'cable_type/design', 'label': name, 'construction': construction,
            'rating': {'u0': None, 'u': None, 'max_conductor_temperature': {}},
            'cores': [{'id': f'core/{i+1}', 'x': None, 'z': None,
                'conductor': {'material': 'material/conductor', 'form': 'unspecified', 'nominal_area': None, 'diameter': None},
                'layers': [{'role': 'insulation', 'material': 'material/insulation', 'thickness': None}]} for i in range(1 if construction == 'single_core' else 3)],
            'common_layers': []}], 'circuits': [], 'sections': [], 'load_cases': [], 'criteria': {}, 'provenance': {}, 'measurements': []}


def structure_context(document):
    """Explicit unit-length display context; contains no operating load or environment."""
    if document['circuits']:
        return
    cable = document['cable_types'][0]
    document['circuits'] = [{'id': 'circuit/structure', 'label': '非运行结构查看', 'system': {'kind': 'dc', 'frequency': 0},
        'cable_type': cable['id'], 'cables': [{'id': 'cable/structure', 'phase': '+'}], 'bonding': {'kind': 'unspecified'}}]
    document['sections'] = [{'id': 'section/structure', 'label': '单位长度结构查看', 'kind': 'air', 'length': 1,
        'medium': {}, 'placements': [{'cable': 'cable/structure', 'x': 0, 'z': 0}], 'enclosures': [], 'soil_layers': [], 'backfill': None}]
    document['load_cases'] = [{'id': 'load/structure', 'kind': 'time_series', 'currents': {}, 'profile': {}, 'base_current': {}}]
    for path in ('/circuits/circuit~1structure', '/sections/section~1structure', '/load_cases/load~1structure'):
        document['provenance'][path] = {'kind': 'derived', 'reference': '单位长度结构查看上下文；无运行负荷、环境或接地方案，不作计算工况。', 'reviewed': False}


def imported_provenance(payload, cable):
    from backend.domain.guards import pointer
    result = {}
    for path, source in payload['sources'].items():
        if not path.startswith('/cable_type/'):
            result[path] = deepcopy(source)
            continue
        parts = path.strip('/').split('/')[1:]
        try:
            if 'cores' in parts:
                index = parts.index('cores') + 1
                core = cable['cores'][int(parts[index])]
                parts[index] = core['id']
                if 'layers' in parts:
                    index = parts.index('layers') + 1
                    parts[index] = core['layers'][int(parts[index])]['role']
            elif 'common_layers' in parts:
                index = parts.index('common_layers') + 1
                parts[index] = cable['common_layers'][int(parts[index])]['role']
            result[pointer('cable_types', cable['id'], *parts)] = deepcopy(source)
        except (ValueError, IndexError):
            raise HTTPException(422, '资料来源路径不属于已批准结构，请重新核对资料版本。') from None
    if payload.get('specification'):
        for core in cable['cores']:
            for field, suffix in [('conductor_diameter', ('conductor','diameter')), ('r20', ('conductor','r20')), ('insulation_thickness', ('layers','insulation','thickness'))]:
                fact = payload['specification']['values'].get(field)
                if fact:
                    result[pointer('cable_types',cable['id'],'cores',core['id'],*suffix)] = deepcopy(payload['sources'][fact['source']])
    return result


def checked_type_document(document):
    """Incomplete drafts use a separate tag; strict solver input remains unchanged."""
    document = deepcopy(document)
    cables = document.get('cable_types', [])
    if len(cables) != 1:
        raise HTTPException(422, {'field': '/cable_types', 'message': '一个型号设计须包含一个电缆型号。'})
    if document.get('schema_version') == 'cablesim.domain/1':
        return DomainDocument.model_validate(document).model_dump(mode='json')
    schema = deepcopy(DomainDocument.model_json_schema())
    schema['properties']['schema_version']['const'] = 'cablesim.type-draft/1'
    for model, fields in [('Conductor', ('nominal_area', 'diameter')), ('Layer', ('thickness',)), ('Core', ('x', 'z')), ('Rating', ('u0',))]:
        for field in fields:
            original = schema['$defs'][model]['properties'][field]
            schema['$defs'][model]['properties'][field] = {'anyOf': [original, {'type': 'null'}]}
    errors = sorted(Draft202012Validator(schema).iter_errors(document), key=lambda e: str(list(e.path)))
    if errors:
        error = errors[0]
        raise HTTPException(422, {'field': '/'+ '/'.join(map(str, error.path)), 'message': '请核对该字段的范围、单位或结构：'+error.message})
    cable = document['cable_types'][0]
    cable.setdefault('common_layers', [])
    for core in cable['cores']:
        core.setdefault('x', None)
        core.setdefault('z', None)
        core.setdefault('layers', [])
    if len(cable['cores']) != (3 if cable['construction'] == 'three_core' else 1):
        raise HTTPException(422, {'field': '/cable_types/0/cores', 'message': '芯数须与单芯 / 三芯结构一致。'})
    materials = [m['id'] for m in document['materials']]
    if len(set(materials)) != len(materials) or len({c['id'] for c in cable['cores']}) != len(cable['cores']):
        raise HTTPException(422, '材料或芯身份重复。')
    refs = [c['conductor']['material'] for c in cable['cores']] + [l['material'] for c in cable['cores'] for l in c['layers']] + [l['material'] for l in cable['common_layers']]
    if any(ref not in materials for ref in refs):
        raise HTTPException(422, {'field': '/materials', 'message': '结构引用的材料未定义，请选择已存在的材料。'})
    missing = cable['rating']['u0'] is None or any(c['conductor']['nominal_area'] is None or c['conductor']['diameter'] is None or c['x'] is None or c['z'] is None or any(l['thickness'] is None for l in c['layers']) for c in cable['cores']) or any(l['thickness'] is None for l in cable['common_layers'])
    if missing:
        document.setdefault('provenance', {})
        return document
    document['schema_version'] = 'cablesim.domain/1'
    return DomainDocument.model_validate(document).model_dump(mode='json')


def source_identity(source):
    """Structured saved identity only; a display name is never a resource key."""
    try:
        value = json.loads(source.get('reference', ''))
        return value if isinstance(value, dict) else {}
    except (ValueError, TypeError):
        return {}


def declared_execution_standards(document):
    """An explicit edition declaration is distinct from approving any limits.

    The saved source record is written by the ordinary document/CAS workflow.
    Arbitrary reference prose and unaudited declarations never become bindings.
    """
    source = document.get('provenance', {}).get('/execution_standards', {})
    declaration = source_identity(source)
    if (source.get('kind') != 'standard' or source.get('reviewed') is not True
            or declaration.get('schema') != 'cablesim.execution-standards/1'):
        return []
    items = declaration.get('items')
    if not isinstance(items, list) or len(items) > 64:
        return []
    return [{'standard': item['standard'].strip(), 'source_digest': item['source_digest']}
            for item in items if isinstance(item, dict) and isinstance(item.get('standard'), str)
            and 0 < len(item['standard'].strip()) <= 128
            and isinstance(item.get('source_digest'), str)
            and re.fullmatch(r'[a-f0-9]{64}', item['source_digest'])]


class Submit(Adopt):
    specification_digest: str = Field(pattern=r'^[a-f0-9]{64}$')
    acknowledge_checks: bool = Field(strict=True)
    change_summary: str | None = Field(default=None, min_length=1, max_length=500)
    author: str | None = Field(default=None, min_length=1, max_length=120)


class Approval(StrictModel):
    request_id: UUID
    submission_id: UUID
    specification_digest: str = Field(pattern=r'^[a-f0-9]{64}$')
    human_confirmed: Literal[True]

    @field_validator('human_confirmed', mode='before')
    @classmethod
    def human(cls, value):
        if value is not True:
            raise ValueError('必须由人工明确确认。')
        return value


class Publish(StrictModel):
    request_id: UUID
    submission_id: UUID
    specification_digest: str = Field(pattern=r'^[a-f0-9]{64}$')


class Types:
    def __init__(self, research, assets):
        self.research, self.store, self.assets = research, research.store, assets
        self.generation_lock = Lock()
        self.creation_lock = Lock()

    def creation_options(self):
        methods = []
        for plugin in self.research.registry().plugins.values():
            for cap in plugin.manifest.capabilities:
                if any(a.type == 'x-cablesim.cable-design-proposal' for a in cap.artifacts):
                    methods.append({'method': {**self.research.pin(plugin), 'capability': cap.id},
                        'title': cap.title, 'schema': cap.input_contract.standalone_schema.model_dump(mode='json', by_alias=True, exclude_none=True)})
        with self.store.db() as db:
            imports = [{'id': r['id'], 'name': json.loads(r['payload'])['draft']['name'], 'version': json.loads(r['payload'])['draft']['version'],
                        'content_sha256': r['digest'], 'document_id': r['document']} for r in db.execute("SELECT * FROM document_proposals WHERE status='approved' ORDER BY rowid DESC")]
        return {'library': self.library()['items'], 'imports': imports, 'generation': methods}

    def _proposal_method(self, artifact):
        choices = [(plugin, cap) for plugin in self.research.registry().plugins.values() for cap in plugin.manifest.capabilities if any(a.type == artifact for a in cap.artifacts)]
        if len(choices) != 1:
            raise HTTPException(501, {'code': 'PROPOSAL_METHOD_UNAVAILABLE', 'message': '没有唯一的已安装结构提案方法；请检查插件安装。'})
        plugin, cap = choices[0]
        method = {**self.research.pin(plugin), 'capability': cap.id}
        self.research.resolve(method)
        return plugin, cap, method

    def _invoke_proposal(self, artifact, values):
        plugin, cap, method = self._proposal_method(artifact)
        result = self.research.executor.run(plugin.manifest.id, cap.id, [{'case_id': 'design', 'input': values, 'parameters': {}}], timeout_s=10, expected_manifest=plugin.manifest)
        case = result.cases[0]
        if case.status != 'succeeded' or artifact not in case.artifacts:
            raise HTTPException(422, case.error or {'code': 'PROPOSAL_MISSING', 'message': '方法未提供结构提案，未创建草稿。'})
        return case.artifacts[artifact], {'method': method, 'input_digest': result.request_sha256, 'output_digest': case.artifact_digests[artifact]}

    def propose_type(self, body):
        digest = fingerprint(body.model_dump(mode='json'))
        with self.creation_lock:
            with self.store.db() as db:
                prior = db.execute('SELECT * FROM type_creation_proposals WHERE request_id=?', (str(body.request_id),)).fetchone()
                if prior:
                    if prior['request_digest'] != digest:
                        raise HTTPException(409, '提案请求标识已用于其他输入。')
                    return json.loads(prior['payload'])
            proposal, standard = self._invoke_proposal('x-cablesim.cable-design-proposal', body.input)
            geometry, layout = self._invoke_proposal('x-cablesim.core-layout-proposal', proposal['next_input'])
            document = deepcopy(proposal['document'])
            for change in geometry['changes']:
                target = document
                parts = change['path'].strip('/').split('/')
                for part in parts[:-1]:
                    target = target[int(part)] if isinstance(target, list) else target[part]
                target[parts[-1]] = change['value']
            from backend.domain.guards import pointer
            for core in document['cable_types'][0]['cores']:
                for key in ('conductor/diameter', 'conductor/form', 'x', 'z'):
                    path = pointer('cable_types', document['cable_types'][0]['id'], 'cores', core['id'])+'/'+key
                    document['provenance'][path] = {'kind': 'derived' if body.input['form'] == 'solid_round' or key in ('x', 'z') else 'user',
                        'reference': json.dumps({'method': layout['method'], 'output_digest': layout['output_digest'], 'limitations': geometry['limitations']}, ensure_ascii=False), 'reviewed': False}
            for key in ('rating/u0', 'rating/u', 'construction'):
                document['provenance']['/cable_types/cable_type~1design/'+key] = {'kind': 'user', 'reference': '工程师在新建型号对话框选择', 'reviewed': False}
            structure_context(document)
            document = checked_type_document(document)
            payload = {'document': document, 'rows': proposal['rows'] + geometry['rows'], 'limitations': proposal['limitations'] + geometry['limitations'], 'methods': [standard, layout]}
            pid = str(uuid4())
            result = {'id': pid, 'content_sha256': fingerprint(payload), **payload}
            with self.store.db(True) as db:
                db.execute('INSERT INTO type_creation_proposals VALUES (?,?,?,?,?,?)', (pid, str(body.request_id), digest, json.dumps(result, ensure_ascii=False), result['content_sha256'], stamp()))
            return result

    def create_type(self, body, actor):
        digest = fingerprint(body.model_dump(mode='json'))
        with self.store.db(True) as db:
            prior = db.execute('SELECT * FROM type_create_requests WHERE request_id=?', (str(body.request_id),)).fetchone()
            if prior:
                if prior['request_digest'] != digest:
                    raise HTTPException(409, '新建请求标识已用于其他输入。')
                return self.store.snapshot(prior['workspace'], db)
            source, bindings = None, {}
            if body.origin == 'library':
                row = db.execute('SELECT a.*,t.payload,t.digest,t.receipt FROM engineering_type_releases t JOIN engineering_assets a ON a.id=t.asset WHERE a.id=?', (str(body.resource_id),)).fetchone()
                if not row or row['status'] != 'published' or row['content_sha256'] != body.content_sha256:
                    raise HTTPException(409, '请重新选择已发布的固定型号版本及摘要。')
                self.assets._detail(db, self.assets._load(db, row['id']))
                self._receipt(row['receipt'])
                saved = json.loads(row['payload'])
                if fingerprint(saved) != row['digest']:
                    raise HTTPException(409, '发布记录摘要不一致。')
                document = deepcopy(saved['document'])
                bindings = deepcopy(saved.get('resource_bindings', {}))
                source = {'id': row['id'], 'asset_id': row['asset_id'], 'name': row['name'], 'version': row['version'], 'content_sha256': row['content_sha256'], 'source': 'published_type'}
            elif body.origin == 'standard':
                reviewer = self._human(actor)
                if not body.human_confirmed:
                    raise HTTPException(409, '请人工确认标准值、推导条件与缺项后建立草稿。')
                row = db.execute('SELECT * FROM type_creation_proposals WHERE id=?', (str(body.proposal_id),)).fetchone()
                if not row or row['digest'] != body.content_sha256:
                    raise HTTPException(409, '结构提案不存在或摘要不一致。')
                saved = json.loads(row['payload'])
                if fingerprint({k:v for k,v in saved.items() if k not in ('id', 'content_sha256')}) != row['digest']:
                    raise HTTPException(409, '结构提案正文摘要不一致。')
                for method in saved['methods']:
                    self.research.resolve(method['method'])
                document = deepcopy(saved['document'])
                source = {'proposal_id': saved['id'], 'content_sha256': row['digest'], 'methods': saved['methods'], 'rows': saved['rows'], 'limitations': saved['limitations'], 'reviewer': reviewer, 'confirmed_at': stamp()}
            elif body.origin == 'import':
                row = db.execute("SELECT * FROM document_proposals WHERE id=? AND status='approved'", (str(body.proposal_id),)).fetchone()
                if not row or row['digest'] != body.content_sha256 or not row['new_model']:
                    raise HTTPException(409, '资料提案须已批准，且引用其固定摘要。')
                saved = json.loads(row['payload']); approval = json.loads(row['approval'])
                original = db.execute('SELECT * FROM source_documents WHERE id=?', (row['document'],)).fetchone()
                if fingerprint(saved) != row['digest'] or approval['proposal_sha256'] != row['digest'] or not original or sha256(bytes(original['original'])).hexdigest() != original['sha256']:
                    raise HTTPException(409, '资料原件、提案或批准摘要不一致。')
                from .candidates import read
                model = read(db, row['new_model'])
                if model['payload'] != saved['draft']:
                    raise HTTPException(409, '已批准资料版本与提案不一致。')
                payload = model['payload']
                if payload.get('cable_type'):
                    document = skeleton(payload['cable_type']['construction'], body.name)
                    document['cable_types'] = [deepcopy(payload['cable_type'])]
                    document['materials'] = deepcopy(payload['materials'])
                else:
                    spec = payload['specification']
                    if spec['cores'] not in (1, 3):
                        raise HTTPException(422, '当前新建入口只覆盖单芯 / 三芯；资料中的其他结构未覆盖。')
                    document = skeleton('single_core' if spec['cores'] == 1 else 'three_core', body.name)
                    cable = document['cable_types'][0]
                    cable['rating'].update(u0=spec['u0_v'], u=spec['voltage_v'])
                    document['materials'][0].update(label='铜' if spec['conductor'].startswith('copper') else '铝', standard_kind=spec['conductor'])
                    for core in cable['cores']:
                        core['conductor']['nominal_area'] = spec['area_m2']
                        for name, target, key in [('conductor_diameter', core['conductor'], 'diameter'), ('insulation_thickness', core['layers'][0], 'thickness')]:
                            if name in spec['values']:
                                target[key] = spec['values'][name]['value']
                        if 'r20' in spec['values']:
                            fact = spec['values']['r20']
                            # A declared catalogue limit is retained as a limit;
                            # it must not silently become a measured resistance.
                            core['conductor']['r20'] = fact['value']
                            core['conductor']['r20_basis'] = 'manufacturer_limit' if fact['basis'] in ('manufacturer', 'standard_limit') else 'design'
                    if spec['cores'] == 1:
                        cable['cores'][0].update(x=0., z=0.)
                document['provenance'] = imported_provenance(payload, document['cable_types'][0])
                source = {'id': model['id'], 'version': payload['version'], 'name': payload['name'], 'content_sha256': model['digest'], 'source': 'manufacturer', 'document_id': row['document'], 'proposal_id': row['id'], 'references': payload['sources']}
                source['declared_specification'] = deepcopy(payload.get('specification'))
                structure_context(document)
            else:
                document = skeleton(body.construction, body.name)
                structure_context(document)
            document['name'] = body.name
            document['cable_types'][0]['label'] = body.name
            document = checked_type_document(document)
            wid, now = str(uuid4()), stamp()
            state = {'scenario': {'name': body.name}, 'domain': document, 'locks': [], 'sources': [],
                     'type_creation': {'id': wid, 'kind': body.origin, 'source': source, 'initial_document_sha256': fingerprint(document), 'created': now}}
            if body.origin in ('library', 'import'):
                state['type_origin_reference'] = deepcopy(source)
            if bindings:
                state['type_resource_bindings'] = bindings
            encoded = json.dumps(state, ensure_ascii=False, allow_nan=False)
            db.execute('INSERT INTO workspaces VALUES (?,?,?,?,?,?)', (wid, 1, 0, encoded, now, now))
            db.execute('INSERT INTO workspace_history VALUES (?,?,?,?)', (wid, 0, encoded, '新建型号设计'))
            self.store.archive(db, wid, 1, state)
            self.store.audit(db, wid, 1, '新建型号设计', json.dumps(state['type_creation'], ensure_ascii=False))
            self._register(db, wid, state)
            db.execute('INSERT INTO type_create_requests VALUES (?,?,?)', (str(body.request_id), digest, wid))
            return self.store.snapshot(wid, db)

    def save_document(self, wid, body):
        with self.store.db(True) as db:
            replay = self._replay(db, wid, body)
            if replay:
                return replay
            row, state = self._type(db, wid, body.expected_revision)
            if not state.get('type_creation'):
                raise HTTPException(422, '既有型号请使用完整领域文档保存接口。')
            document = checked_type_document(body.document)
            if document['cable_types'][0]['id'] != state['domain']['cable_types'][0]['id']:
                raise HTTPException(422, '不能更换型号身份。')
            state['domain'] = document
            state['scenario']['name'] = document['name']
            self.store.commit(db, row, state, '保存新建型号草稿')
            result = self.store.snapshot(wid, db)
            self._remember(db, wid, body, result)
            return result

    def _resource_targets(self, db, wid, state):
        used = {layer['material'] for cable in state['domain']['cable_types'] for layer in
                [*cable['common_layers'], *(layer for core in cable['cores'] for layer in [core['conductor'], *core['layers']])]}
        materials = [{'role': 'material', 'id': m['id'], 'name': m['label'], 'input_digest': fingerprint(m),
                      'identity': source_identity(state['domain'].get('provenance', {}).get('/materials/'+str(i), {})) or {'asset_id': m['id']}}
                     for i, m in enumerate(state['domain']['materials']) if m['id'] in used]
        standards = {}
        for item in declared_execution_standards(state['domain']):
            key = fingerprint(item)
            standards[key] = {'role': 'standard', 'id': key, 'name': item['standard'], 'input_digest': key,
                              'identity': {'source_digest': item['source_digest']}, 'declaration': True}
        latest = {item['id']: item for review in self._requirement_reviews(db, wid) for item in review['receipt']['items']}
        for item in latest.values():
            definition = item['definition']
            digest = definition.get('source_digest')
            if definition.get('source_status') != 'original-verified' or not digest:
                continue
            key = fingerprint({'standard': definition['standard'], 'source_digest': digest})
            standards[key] = {'role': 'standard', 'id': key, 'name': definition['standard'], 'input_digest': key,
                              'identity': {'source_digest': digest}}
        targets = materials + list(standards.values())
        for role in ('material', 'standard'):
            for key, pin in state.get('type_resource_bindings', {}).get(role, {}).items():
                if not any(t['role'] == role and t['id'] == key for t in targets):
                    targets.append({'role': role, 'id': key, 'name': pin['name'], 'input_digest': None, 'identity': {}})
        return targets

    def _resource_catalog(self, db):
        resources = [self.assets._detail(db, r) for r in db.execute(
            "SELECT * FROM engineering_assets WHERE kind IN ('material','rule') AND status='published' ORDER BY asset_id,version")]
        return [r for r in resources if not r['issues'] and r['reviewed_sha256'] == r['content_sha256']]

    def _resources(self, db, wid, row, state):
        catalog = self._resource_catalog(db)
        bindings = state.get('type_resource_bindings', {})
        targets = self._resource_targets(db, wid, state)
        for target in targets:
            pin = bindings.get(target['role'], {}).get(target['id'])
            resource = next((r for r in catalog if pin and r['id'] == pin['resource_id']
                             and all(r[k] == pin[k] for k in ('asset_id', 'version', 'content_sha256'))), None)
            target['binding'] = pin
            target['state'] = 'unbound' if not pin else 'current' if resource and pin['input_digest'] == target['input_digest'] else 'outdated'
            target['reason'] = {'unbound': '未绑定资源；选择已发布的资源版本或核对唯一匹配。',
                                'current': '已固定资源版本与内容摘要。', 'outdated': '输入或资源状态已变化；请重新核对绑定。'}[target['state']]
            if target['input_digest'] is None:
                target['reason'] = '目标已不属于当前型号或已批准标准，请解除该引用。'
            identity = target.pop('identity')
            def matches(resource):
                if resource['kind'] != ('material' if target['role'] == 'material' else 'rule'):
                    return False
                if identity.get('source_digest'):
                    return any(source_identity(s).get('source_digest') == identity['source_digest']
                               for s in resource['release']['sources'])
                return bool(identity.get('asset_id')) and resource['asset_id'] == identity['asset_id'] and all(
                    not identity.get(k) or resource[k] == identity[k] for k in ('version', 'content_sha256'))
            candidates = [r['id'] for r in catalog if matches(r)]
            target['unique_match'] = candidates[0] if len(candidates) == 1 else None
            target['match_reason'] = '唯一身份匹配' if len(candidates) == 1 else '资源身份有多个版本，需人工选择。' if candidates else '没有明确的资源身份匹配；不会按名称猜测。'
        return {'workspace_id': wid, 'revision': row['revision'], 'targets': targets,
                'resources': [{k: r[k] for k in ('id', 'asset_id', 'version', 'kind', 'name', 'content_sha256')} for r in catalog]}

    def resources(self, wid):
        with self.store.db() as db:
            row, state = self._type(db, wid)
            return self._resources(db, wid, row, state)

    def bind_resources(self, wid, body, *, migrate=False):
        with self.store.db(True) as db:
            replay = self._replay(db, wid, body)
            if replay:
                return replay
            row, state = self._type(db, wid, body.expected_revision)
            self.store.assert_mutable(db, wid)
            view = self._resources(db, wid, row, state)
            targets = view['targets'] if migrate else [t for t in view['targets'] if t['role'] == body.role and t['id'] == body.target_id]
            if not targets and not migrate:
                raise HTTPException(422, {'field': body.target_id, 'message': '材料或已批准标准不存在，请刷新后重新选择。'})
            bindings = state.setdefault('type_resource_bindings', {'schema': 'cablesim.type-resource-bindings/1', 'material': {}, 'standard': {}})
            changed = []
            for target in targets:
                if migrate and target['binding']:
                    continue  # migration never overwrites an explicit choice
                resource_id = target['unique_match'] if migrate else str(body.resource_id) if body.resource_id else None
                if migrate and not resource_id:
                    continue
                before = bindings.setdefault(target['role'], {}).get(target['id'])
                if resource_id is None:
                    bindings[target['role']].pop(target['id'], None)
                    if before:
                        changed.append(target['id'])
                    continue
                if target['input_digest'] is None:
                    raise HTTPException(422, {'field': target['id'], 'message': '目标已移除；请解除引用，不能重新绑定。'})
                resource = next((r for r in view['resources'] if r['id'] == resource_id and r['kind'] == ('material' if target['role'] == 'material' else 'rule')), None)
                if not resource:
                    raise HTTPException(422, {'field': target['id'], 'message': '请选择对应类别的已发布资源版本。'})
                pin = {**resource, 'resource_id': resource['id'], 'input_digest': target['input_digest']}
                if pin != before:
                    bindings[target['role']][target['id']] = pin
                    changed.append(target['id'])
            if changed:
                self.store.commit(db, row, state, '核对唯一资源绑定' if migrate else '绑定资源版本')
            row, state = self._type(db, wid)
            result = {**self._resources(db, wid, row, state), 'changed': changed}
            self._remember(db, wid, body, result)
            return result

    def initialize(self):
        with self.store.db(True) as db:
            for sql in (
                '''CREATE TABLE IF NOT EXISTS type_create_requests (request_id TEXT PRIMARY KEY, request_digest TEXT NOT NULL, workspace TEXT NOT NULL)''',
                '''CREATE TABLE IF NOT EXISTS type_creation_proposals (id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL, request_digest TEXT NOT NULL, payload TEXT NOT NULL, digest TEXT NOT NULL, created TEXT NOT NULL)''',
                '''CREATE TABLE IF NOT EXISTS type_families (
                  id TEXT PRIMARY KEY, name TEXT NOT NULL, base_reference TEXT NOT NULL,
                  base_document TEXT NOT NULL, head INTEGER NOT NULL DEFAULT 0)''',
                '''CREATE TABLE IF NOT EXISTS type_plans (
                  workspace TEXT PRIMARY KEY, family TEXT NOT NULL, name TEXT NOT NULL,
                  base_reference TEXT NOT NULL, status TEXT NOT NULL, created TEXT NOT NULL,
                  adopted_revision INTEGER, adopted_digest TEXT)''',
                '''CREATE TABLE IF NOT EXISTS type_submissions (
                  id TEXT PRIMARY KEY, workspace TEXT NOT NULL, payload TEXT NOT NULL,
                  digest TEXT NOT NULL, status TEXT NOT NULL, receipt TEXT, created TEXT NOT NULL,
                  asset TEXT)''',
                '''CREATE TABLE IF NOT EXISTS type_requests (
                  workspace TEXT NOT NULL, request_id TEXT NOT NULL, request_digest TEXT NOT NULL,
                  result TEXT NOT NULL, PRIMARY KEY(workspace,request_id))''',
                '''CREATE TABLE IF NOT EXISTS engineering_type_releases (
                  asset TEXT PRIMARY KEY, family TEXT NOT NULL, sequence INTEGER NOT NULL,
                  workspace TEXT NOT NULL UNIQUE, submission TEXT NOT NULL UNIQUE,
                  payload TEXT NOT NULL, digest TEXT NOT NULL, receipt TEXT NOT NULL,
                  UNIQUE(family,sequence))''',
                '''CREATE TABLE IF NOT EXISTS type_document_revisions (
                  id TEXT PRIMARY KEY, workspace TEXT NOT NULL, submission TEXT NOT NULL UNIQUE,
                  version TEXT NOT NULL, summary TEXT NOT NULL, author TEXT NOT NULL, created TEXT NOT NULL,
                  UNIQUE(workspace,version))'''):
                db.execute(sql)

    def _type(self, db, wid, expected=None):
        row, state = self.store.load(db, wid, expected, allow_domain=True)
        if not state.get('domain') or state.get('study_cable_reference') or len(state['domain']['cable_types']) != 1:
            raise HTTPException(422, '需要独立的单型号文档。')
        return row, state

    @staticmethod
    def _base(state):
        base = state.get('type_origin_reference')
        if not base and state.get('type_creation'):
            creation = state['type_creation']
            return {'id': creation['id'], 'name': state['domain']['name'], 'version': '0.1.0-draft', 'content_sha256': creation['initial_document_sha256'], 'source': creation['kind']}
        if not base or not base.get('id') or not base.get('version') or not base.get('content_sha256'):
            raise HTTPException(422, '方案须基于带内容摘要的明确型号版本。')
        return base

    @classmethod
    def _family_id(cls, state):
        base, cable = cls._base(state), state['domain']['cable_types'][0]
        if state.get('type_creation'):
            return 'type/'+state['type_creation']['id']
        if base.get('source') == 'published_type':
            return base['id']
        # Imported manufacturer documents can originate from the same UI scaffold.
        # Construction/rating/conductor identity keeps different types independent.
        return 'type/'+fingerprint({'origin': base['id'], 'type': cable['id'],
            'construction': cable['construction'], 'u0': cable['rating']['u0'],
            'u': cable['rating'].get('u'), 'cores': [(
                c['conductor'].get('nominal_area') or c['conductor']['area'],
                c['conductor']['material'],
            ) for c in cable['cores']]})[:24]

    def _register(self, db, wid, state):
        plan = db.execute('SELECT * FROM type_plans WHERE workspace=?', (wid,)).fetchone()
        if plan:
            return dict(plan)
        base = self._base(state)
        fid = self._family_id(state)
        db.execute('INSERT OR IGNORE INTO type_families VALUES (?,?,?,?,0)',
                   (fid, clean_name(state['domain']['cable_types'][0]['label']),
                    json.dumps(base, ensure_ascii=False), json.dumps(state['domain'], ensure_ascii=False)))
        db.execute('INSERT INTO type_plans VALUES (?,?,?,?,?,?,?,?)',
                   (wid, fid, '基准方案', json.dumps(base, ensure_ascii=False), 'draft', stamp(), None, None))
        return dict(db.execute('SELECT * FROM type_plans WHERE workspace=?', (wid,)).fetchone())

    @staticmethod
    def _replay(db, wid, body):
        row = db.execute('SELECT * FROM type_requests WHERE workspace=? AND request_id=?', (wid, str(body.request_id))).fetchone()
        if row:
            if row['request_digest'] != fingerprint(body.model_dump(mode='json')):
                raise HTTPException(409, '请求标识已用于其他操作。')
            return json.loads(row['result'])

    @staticmethod
    def _remember(db, wid, body, result):
        db.execute('INSERT INTO type_requests VALUES (?,?,?,?)',
                   (wid, str(body.request_id), fingerprint(body.model_dump(mode='json')), json.dumps(result, ensure_ascii=False)))

    def branch(self, wid, body):
        with self.store.db(True) as db:
            previous = self._replay(db, wid, body)
            if previous:
                return previous
            row, state = self._type(db, wid, body.expected_revision)
            plan = self._register(db, wid, state)
            source = db.execute((
                'SELECT a.id,a.asset_id,a.version,a.content_sha256,t.payload,t.digest,t.receipt FROM '
                'engineering_type_releases t JOIN engineering_assets a ON a.id=t.asset WHERE t.workspace=?'
            ), (wid,)).fetchone()
            if source:
                frozen = json.loads(source['payload'])
                self.assets._detail(db, self.assets._load(db, source['id']))
                self._receipt(source['receipt'])
                if fingerprint(frozen) != source['digest'] or fingerprint(frozen['document']) != fingerprint(state['domain']):
                    raise HTTPException(409, '已发布型号与冻结记录不一致。')
            base = ({'id': source['asset_id'], 'version': source['version'], 'content_sha256': source['content_sha256'],
                     'name': clean_name(state['domain']['cable_types'][0]['label']), 'source': 'published_type'}
                    if source else json.loads(plan['base_reference']))
            cloned = deepcopy(state)
            cloned.pop('type_release', None)
            cloned['type_origin_reference'] = base
            cloned['type_plan_source'] = {'workspace': wid, 'revision': row['revision'], 'document_sha256': fingerprint(state['domain'])}
            if body.document:
                cloned['domain'] = body.document.model_dump(mode='json')
                if cloned['domain']['cable_types'][0]['id'] != state['domain']['cable_types'][0]['id']:
                    raise HTTPException(422, '方案须保留同一型号标识。')
            new_id, now = str(uuid4()), stamp()
            encoded = json.dumps(cloned, ensure_ascii=False, allow_nan=False)
            db.execute('INSERT INTO workspaces VALUES (?,?,?,?,?,?)', (new_id, 1, 0, encoded, now, now))
            db.execute('INSERT INTO workspace_history VALUES (?,?,?,?)', (new_id, 0, encoded, '建立型号方案'))
            self.store.archive(db, new_id, 1, cloned)
            db.execute('INSERT INTO type_plans VALUES (?,?,?,?,?,?,?,?)',
                       (new_id, plan['family'], body.name, json.dumps(base, ensure_ascii=False), 'draft', now, None, None))
            self.store.audit(db, new_id, 1, '建立型号方案', json.dumps(cloned['type_plan_source']))
            result = {'workspace_id': new_id, 'family_id': plan['family'], 'base_reference': base, 'name': body.name}
            self._remember(db, wid, body, result)
            return result

    def adopt(self, wid, body):
        with self.store.db(True) as db:
            previous = self._replay(db, wid, body)
            if previous:
                return previous
            row, state = self._type(db, wid, body.expected_revision)
            self.store.assert_mutable(db, wid)
            plan = self._register(db, wid, state)
            if plan['status'] == 'version_draft':
                raise HTTPException(409, '此方案已采纳为版本草稿。')
            db.execute("UPDATE type_plans SET status='version_draft',adopted_revision=?,adopted_digest=? WHERE workspace=?",
                       (row['revision'], fingerprint(state['domain']), wid))
            self.store.audit(db, wid, row['revision'], '采纳为新版本草稿', plan['name'])
            result = {'workspace_id': wid, 'status': 'version_draft', 'adopted_revision': row['revision']}
            self._remember(db, wid, body, result)
            return result

    def evidence(self, wid):
        with self.store.db() as db:
            row, state = self._type(db, wid)
            ids = [r['id'] for r in db.execute('SELECT id FROM study_runs WHERE workspace=? ORDER BY sequence DESC LIMIT 100', (wid,))]
            versions = {r['revision']:json.loads(r['state']).get('domain') for r in db.execute(
                'SELECT revision,state FROM workspace_revisions WHERE workspace=?',
                (wid,),
            )}
        channels, failures, seen_methods = {}, [], set()
        for rid in ids:
            run = self.research.get_run(wid, rid)
            method = run.get('snapshot', {}).get('definition', {}).get('method', {})
            method_key = (method.get('plugin_id'), method.get('capability'), run.get('snapshot', {}).get('module'))
            if run.get('integrity') != 'verified':
                failures.append({'id': rid, 'message': '运行完整性校验失败。', 'blocking': True})
                continue
            if run.get('status') not in ('succeeded', 'partial'):
                if method_key in seen_methods:
                    continue
                seen_methods.add(method_key)
                reason = (run.get('error') or {}).get('message') or next(
                    ((c.get('error') or {}).get('message') for c in (run.get('output') or {}).get('cases', []) if c.get('error')),
                    '运行未完成。',
                )
                failures.append({'id': rid, 'message': reason, 'blocking': True})
                if is_rating_table(run) and 'rating' not in channels:
                    rows = rating_rows(run)
                    for result in rows:
                        result['value_a'] = None
                        result['reason'] = result['reason'] or reason
                    channels['rating'] = {
                        'run': run, 'rows': rows,
                        'parameters': deepcopy(run['snapshot']['definition']['parameters']),
                    }
                continue
            seen_methods.add(method_key)
            version_document = versions.get(run['snapshot']['workspace_revision'])
            if not version_document or not self._matches_type(run, version_document):
                failures.append({'id': rid, 'message': '运行的型号输入与当前版本不同。', 'blocking': True})
                continue
            for case in (run.get('output') or {}).get('cases', []):
                for channel, artifact_key in CHANNELS.items():
                    if artifact_key in case.get('artifacts', {}) and channel not in channels:
                        channels[channel] = {'run': run, 'artifact': deepcopy(case['artifacts'][artifact_key]), 'case_id': case['case_id']}
            if run['snapshot']['definition']['driver']['kind'] == 'batch' and is_rating_table(run) and 'rating' not in channels:
                channels['rating'] = {
                    'run': run, 'rows': rating_rows(run),
                    'parameters': deepcopy(run['snapshot']['definition']['parameters']),
                }
        return row, state, channels, failures

    @staticmethod
    def _matches_type(run, document):
        target = CableType.model_validate(document['cable_types'][0]).model_dump(mode='json')
        rating = is_rating_table(run)
        if rating:
            for core in target['cores']:
                observed = next((m for m in document.get('measurements', []) if m['cable_type']==target['id']
                                 and m.get('core')==core['id'] and m['quantity']=='r20' and m['basis']=='measurement'), None)
                if observed:
                    core['conductor'].update(r20=observed['value'], r20_basis='measurement')
        inputs = run['snapshot'].get('cases', [])
        def normalized(value):
            try:
                return fingerprint(CableType.model_validate(value).model_dump(mode='json'))
            except ValueError:
                return None
        expected = fingerprint(target)
        return bool(inputs) and all(any(normalized(c)==expected for c in case.get('input',{}).get('cable_types',[])) for case in inputs)

    @staticmethod
    def _source(channel, data):
        run = data['run']
        return {'channel': channel, 'run_id': run['id'], 'study_id': run['study'],
                'input_digest': run['input_digest'], 'output_digest': run['output_digest'],
                'workspace_revision': run['snapshot']['workspace_revision'],
                'study_revision': run['snapshot']['study_revision'], 'method': run['snapshot']['definition']['method'],
                'freshness': run['freshness'], 'status': run['status'], 'version_status': run.get('version_status')}

    def specification(self, wid, audience='customer'):
        row, state, channels, checks = self.evidence(wid)
        d, t = state['domain'], state['domain']['cable_types'][0]
        sources = [self._source(key, data) for key, data in channels.items()]
        check_results(channels, checks)
        data = {key: {k: deepcopy(v) for k, v in item.items() if k != 'run'} for key, item in channels.items()}
        with self.store.db() as db:
            history = self._revisions(db, wid)
            requirement_reviews = self._requirement_reviews(db, wid)
            resource_view = self._resources(db, wid, row, state)
            submitted = db.execute('SELECT * FROM type_submissions WHERE workspace=? ORDER BY rowid DESC LIMIT 1', (wid,)).fetchone()
            published = db.execute('SELECT * FROM engineering_type_releases WHERE workspace=?', (wid,)).fetchone()
            plan = db.execute('SELECT * FROM type_plans WHERE workspace=?', (wid,)).fetchone()
        payload = {'schema': 'cablesim.type-specification/1', 'renderer': 'type-specification/3',
                   'workspace_id': wid, 'revision': row['revision'], 'name': clean_name(t['label']),
                   'purpose': 'demo' if '演示' in t['label'] or '合成验收数据' in t['label'] or any(s.get('kind')=='demo' for s in d.get(
                       'provenance',
                       {},
                   ).values()) else 'engineering',
                   'base_reference': self._base(state), 'document': deepcopy(d), 'chapters': CHAPTERS,
                   'sources': sources, 'results': data, 'checks': checks, 'revisions': history,
                   'requirement_reviews': requirement_reviews,
                   'source_design': {'id': wid, 'revision': row['revision']},
                   'creation_source': deepcopy(state.get('type_creation', {})),
                   'plan_reference': ({'name': plan['name'], 'status': plan['status'],
                                       'adopted_revision': plan['adopted_revision'],
                                       'source': deepcopy(state.get('type_plan_source', {}))} if plan else None),
                   'resource_bindings': deepcopy(state.get('type_resource_bindings', {}))}
        for target in resource_view['targets']:
            if target['state'] == 'outdated':
                checks.append({'id': 'resource/'+target['id'], 'channel': 'resources',
                               'message': target['name']+'：'+target['reason'], 'blocking': True})
        digest = fingerprint(payload)
        lifecycle = {'status': 'draft', 'submission_id': None, 'approval': None, 'stale': False}
        if submitted:
            lifecycle = {'status': submitted['status'], 'submission_id': submitted['id'],
                         'approval': self._receipt(submitted['receipt']) if submitted['receipt'] else None,
                         'stale': submitted['digest'] != digest}
        if published:
            frozen = json.loads(published['payload'])
            if fingerprint(frozen) != published['digest']:
                raise HTTPException(409, '已发布规格书完整性异常。')
            payload, digest = frozen, published['digest']
            lifecycle = {
                'status': 'published',
                'submission_id': published['submission'],
                'approval': self._receipt(published['receipt']),
                'asset_id': published['asset'],
                'stale': False,
            }
        lifecycle['operator'] = {'username': getpass.getuser(), 'authority': 'local_manual_confirmation'}
        from .version_status import cover_status
        lifecycle['version_status'] = cover_status([self.research.get_run(wid, s['run_id']) for s in payload['sources']])
        return {
            'payload': payload,
            'digest': digest,
            'lifecycle': lifecycle,
            'ready': not any(c['blocking'] for c in payload['checks']),
            'html': render_specification(payload, digest, lifecycle, audience),
            'audience': audience,
            'revision_draft': self.revision_draft(wid, payload),
            'generation_endpoint': '/api/types/'+wid+'/specification/generate',
            'export': {'endpoint':'/api/types/'+wid+'/specification/file', 'format':'pdf'},
        }

    def _validate_sources(self, db, wid, payload):
        row, state = self._type(db, wid, payload['revision'])
        if fingerprint(state['domain']) != fingerprint(payload['document']):
            raise HTTPException(409, '型号输入已变化，请重新生成规格书。')
        if state.get('type_resource_bindings', {}) != payload.get('resource_bindings', {}):
            raise HTTPException(409, '资源版本绑定已变化，请重新生成规格书。')
        if any(t['state'] == 'outdated' for t in self._resources(db, wid, row, state)['targets']):
            raise HTTPException(409, '资源绑定已过期，请重新核对后提交。')
        if self._revisions(db, wid) != payload['revisions'] or self._requirement_reviews(db, wid) != payload['requirement_reviews']:
            raise HTTPException(409, '修订记录或要求批准状态已变化，请重新提交。')
        for source in payload['sources']:
            saved = db.execute('SELECT * FROM study_runs WHERE workspace=? AND id=?', (wid, source['run_id'])).fetchone()
            if not saved or saved['input_digest'] != source['input_digest'] or saved['output_digest'] != source['output_digest']:
                raise HTTPException(409, '运行来源已变化。')
            if saved['status'] not in ('succeeded', 'partial'):
                raise HTTPException(409, '源运行未完成，不能用于审核发布。')
            snapshot = json.loads(saved['snapshot'])
            if fingerprint(snapshot) != saved['input_digest'] or fingerprint(json.loads(saved['output'])) != saved['output_digest']:
                raise HTTPException(409, '运行来源完整性异常。')
            study = self.research.definition(db, wid, saved['study'])
            selected = self.research.module_definition(study['definition'], snapshot.get('module'))
            if study['revision'] != source['study_revision'] or self.research.lock(db, wid, row['revision'], selected['method']) != snapshot['lock']:
                raise HTTPException(409, '研究或方法版本已变化，请重新提交。')
            self.research.resolve(selected['method'])
        return row

    def _revisions(self, db, wid):
        _, state = self._type(db, wid)
        base, inherited = self._base(state), []
        if base.get('source') == 'published_type':
            prior = db.execute('SELECT t.payload FROM engineering_type_releases t JOIN engineering_assets a ON a.id=t.asset '
                               'WHERE a.asset_id=? AND a.version=? AND a.content_sha256=?',
                               (base['id'], base['version'], base['content_sha256'])).fetchone()
            if prior:
                inherited = [r for r in json.loads(prior['payload']).get('revisions', []) if 'version' in r and 'summary' in r]
        return inherited + [dict(r) for r in db.execute(
            'SELECT version,summary,author,created FROM type_document_revisions WHERE workspace=? ORDER BY rowid', (wid,))]

    def revision_draft(self, wid, payload):
        from .type_specification import LAYER_NAMES, number
        with self.store.db() as db:
            count = db.execute('SELECT COUNT(*) FROM type_document_revisions WHERE workspace=?', (wid,)).fetchone()[0]
            prior = db.execute('SELECT payload FROM type_submissions WHERE workspace=? ORDER BY rowid DESC LIMIT 1', (wid,)).fetchone()
            plan = db.execute('SELECT f.base_document FROM type_plans p JOIN type_families f ON f.id=p.family WHERE p.workspace=?', (wid,)).fetchone()
        before = json.loads(prior['payload'])['document'] if prior else json.loads(plan['base_document']) if plan else None
        changes = []
        if before:
            old, new = before['cable_types'][0], payload['document']['cable_types'][0]
            old_layers = [*old['common_layers'], *(layer for core in old['cores'] for layer in core['layers'])]
            new_layers = [*new['common_layers'], *(layer for core in new['cores'] for layer in core['layers'])]
            for left, right in zip(old_layers, new_layers):
                if left['role'] == right['role'] and left['thickness'] != right['thickness']:
                    changes.append(LAYER_NAMES.get(right['role'], '结构层')+'厚度 '+number(left['thickness'],1,1000)+'→'+number(right['thickness'],1,1000)+' mm')
        return {'version':next_version(payload['base_reference']['version'])+'-r'+str(count+1),
                'summary':'；'.join(changes[:8]) or ('更新型号声明与计算依据' if prior else '首次编制产品规格书'),
                'author':getpass.getuser()}

    @staticmethod
    def _requirement_reviews(db, wid):
        if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='requirement_reviews'").fetchone():
            return []
        result = []
        for row in db.execute('SELECT id,revision,receipt,digest FROM requirement_reviews WHERE workspace=? ORDER BY revision', (wid,)):
            receipt = json.loads(row['receipt'])
            if fingerprint(receipt) != row['digest']:
                raise HTTPException(409, '要求批准记录完整性异常。')
            result.append({'id':row['id'], 'revision':row['revision'], 'digest':row['digest'], 'receipt':receipt})
        return result

    def submit(self, wid, body):
        with self.store.db() as db:
            previous = self._replay(db, wid, body)
            if previous:
                return previous
        spec = self.specification(wid)
        if spec['digest'] != body.specification_digest:
            raise HTTPException(409, '规格书内容已变化，请查看最新清单。')
        if spec['payload']['checks'] and not body.acknowledge_checks:
            raise HTTPException(422, {'message': '请核对提交前清单。', 'checks': spec['payload']['checks']})
        proposed = self.revision_draft(wid, spec['payload'])
        with self.store.db(True) as db:
            previous = self._replay(db, wid, body)
            if previous:
                return previous
            self.store.assert_mutable(db, wid)
            row, state = self._type(db, wid, body.expected_revision)
            self._validate_sources(db, wid, spec['payload'])
            plan = self._register(db, wid, state)
            if plan['status'] != 'version_draft':
                raise HTTPException(422, '请先采纳方案为新版本草稿。')
            sid = str(uuid4())
            summary = (body.change_summary or proposed['summary']).strip()
            author = (body.author or proposed['author']).strip()
            if not summary or not author:
                raise HTTPException(422, '请填写文档变更摘要和编制人。')
            created = stamp()
            db.execute('INSERT INTO type_document_revisions VALUES (?,?,?,?,?,?,?)',
                       (str(uuid4()), wid, sid, proposed['version'], summary, author, created))
            spec['payload']['revisions'] = self._revisions(db, wid)
            spec['digest'] = fingerprint(spec['payload'])
            db.execute('INSERT INTO type_submissions VALUES (?,?,?,?,?,?,?,?)',
                       (sid, wid, json.dumps(spec['payload'], ensure_ascii=False), spec['digest'], 'submitted', None, created, None))
            self.store.audit(db, wid, row['revision'], '提交规格书审核', sid)
            result = {'submission_id': sid, 'digest': spec['digest'], 'status': 'submitted', 'checks': spec['payload']['checks']}
            self._remember(db, wid, body, result)
            return result

    @staticmethod
    def _human(actor):
        """Local operator identity; replace this seam for enterprise authentication."""
        if actor != 'human':
            raise HTTPException(403, '此操作限本机人工确认；AI 和插件仅可提交审核。')
        return getpass.getuser()

    def _submission(self, db, wid, sid, digest):
        row = db.execute('SELECT * FROM type_submissions WHERE workspace=? AND id=?', (wid, str(sid))).fetchone()
        if not row:
            raise HTTPException(404, '审核提交不存在。')
        payload = json.loads(row['payload'])
        if fingerprint(payload) != row['digest'] or row['digest'] != digest:
            raise HTTPException(409, '审核内容摘要不一致。')
        return row, payload

    @staticmethod
    def _receipt(encoded):
        try:
            receipt = json.loads(encoded)
            digest = receipt['receipt_digest']
            if fingerprint({k:v for k,v in receipt.items() if k != 'receipt_digest'}) != digest:
                raise ValueError('digest')
            return receipt
        except (ValueError, KeyError, TypeError):
            raise HTTPException(409, '人工批准记录完整性异常。') from None

    def approve(self, wid, body, actor):
        reviewer = self._human(actor)
        with self.store.db(True) as db:
            previous = self._replay(db, wid, body)
            if previous:
                return previous
            submission, payload = self._submission(db, wid, body.submission_id, body.specification_digest)
            if submission['status'] != 'submitted':
                raise HTTPException(409, '当前提交不处于待审核状态。')
            self._validate_sources(db, wid, payload)
            if any(c['blocking'] for c in payload['checks']):
                raise HTTPException(422, {'message': '请解决提交清单中的缺项后重新提交。', 'checks': payload['checks']})
            receipt = {'id': str(uuid4()), 'reviewer': reviewer, 'approved_at': stamp(),
                       'decision': 'approved', 'authority': 'local_manual_confirmation',
                       'submission_id': submission['id'], 'specification_digest': submission['digest'],
                       'workspace_revision': payload['revision'], 'sources': payload['sources']}
            receipt['receipt_digest'] = fingerprint(receipt)
            db.execute(
                "UPDATE type_submissions SET status='approved',receipt=? WHERE id=?",
                (json.dumps(receipt, ensure_ascii=False), submission['id']),
            )
            self.store.audit(db, wid, payload['revision'], '人工批准规格书', json.dumps(receipt, ensure_ascii=False))
            self._remember(db, wid, body, receipt)
            return receipt

    def publish(self, wid, body, actor):
        self._human(actor)
        with self.store.db(True) as db:
            previous = self._replay(db, wid, body)
            if previous:
                return previous
            submission, payload = self._submission(db, wid, body.submission_id, body.specification_digest)
            if submission['status'] != 'approved' or not submission['receipt']:
                raise HTTPException(409, '须先取得当前内容的人工批准。')
            self._validate_sources(db, wid, payload)
            receipt = self._receipt(submission['receipt'])
            if receipt['specification_digest'] != submission['digest'] or any(c['blocking'] for c in payload['checks']):
                raise HTTPException(409, '人工批准不属于可发布的当前内容。')
            plan = db.execute('SELECT * FROM type_plans WHERE workspace=?', (wid,)).fetchone()
            family = db.execute('SELECT * FROM type_families WHERE id=?', (plan['family'],)).fetchone()
            base = json.loads(plan['base_reference'])
            latest = db.execute((
                'SELECT a.* FROM engineering_type_releases t JOIN engineering_assets a ON a.id=t.asset WHERE '
                't.family=? ORDER BY t.sequence DESC LIMIT 1'
            ), (plan['family'],)).fetchone()
            if latest and (
                base.get('id'),
                base.get('version'),
                base.get('content_sha256'),
            ) != (latest['asset_id'], latest['version'], latest['content_sha256']):
                raise HTTPException(409, '型号库已有后续版本，请基于最新发布版本建立草稿。')
            version = next_version(base['version'])
            pins = { (p['asset_id'], p['version']): p for role in ('material', 'standard')
                     for p in payload.get('resource_bindings', {}).get(role, {}).values() }
            asset = self.assets._insert(db, AssetRelease(asset_id=plan['family'], version=version, kind='assembly', name=payload['name'],
                  dependencies=tuple(AssetRef(**{k: p[k] for k in ('asset_id','version','content_sha256')}) for p in pins.values()),
                  sources=(SourceReference(
                      kind='project_input',
                      reference='规格书 '+submission['id']+' sha256:'+submission['digest'],
                      reviewed=True,
                  ), SourceReference(kind='project_input', reference=json.dumps({'source_design': {'id': wid, 'revision': payload['revision']}}, separators=(',', ':')), reviewed=True))), '人工批准的型号规格书', managed_type=True)
            db.execute('INSERT INTO engineering_type_releases VALUES (?,?,?,?,?,?,?,?)',
                       (
                           asset,
                           plan['family'],
                           family['head']+1,
                           wid,
                           submission['id'],
                           submission['payload'],
                           submission['digest'],
                           submission['receipt'],
                       ))
            digest = self.assets._load(db, asset)['content_sha256']
            for action, status in (('review', 'reviewed'), ('publish', 'published')):
                db.execute(
                    'UPDATE engineering_assets SET status=?,revision=revision+1,reviewed_sha256=?,updated=? WHERE id=?',
                    (status, digest, stamp(), asset),
                )
                self.assets._event(db, self.assets._load(db, asset), action, '批准人 '+receipt['reviewer']+'；'+receipt['approved_at'])
            db.execute('UPDATE type_families SET head=head+1 WHERE id=?', (plan['family'],))
            db.execute("UPDATE type_plans SET status='published' WHERE workspace=?", (wid,))
            db.execute("UPDATE type_submissions SET status='published',asset=? WHERE id=?", (asset, submission['id']))
            self.store.audit(db, wid, payload['revision'], '发布型号版本', asset)
            result = {
                'status': 'published',
                'asset_id': asset,
                'asset_reference': {'id': plan['family'], 'version': version, 'content_sha256': digest},
                'approval': receipt,
                'source_design': {'id': wid, 'revision': payload['revision']},
            }
            self._remember(db, wid, body, result)
            return result

    def comparison(self, wid):
        with self.store.db() as db:
            _, state = self._type(db, wid)
            current = db.execute('SELECT * FROM type_plans WHERE workspace=?', (wid,)).fetchone()
            base = self._base(state)
            fid = current['family'] if current else self._family_id(state)
            family = db.execute('SELECT * FROM type_families WHERE id=?', (fid,)).fetchone()
            plans = [dict(p) for p in db.execute('SELECT * FROM type_plans WHERE family=? ORDER BY created', (fid,))]
        if not any(p['workspace'] == wid for p in plans):
            plans.insert(0, {'workspace': wid, 'family': fid, 'name': '基准方案', 'status': 'draft', 'base_reference': json.dumps(base)})
        items = []
        requirements = {}
        for plan in plans:
            row, state, channels, failures = self.evidence(plan['workspace'])
            with self.store.db() as db:
                reviews = self._requirement_reviews(db, plan['workspace'])
            checked = channels.get('standards')
            requirement_values = {}
            if checked:
                source = self._source('standards', checked)
                for result in checked.get('artifact', {}).get('rows', []):
                    identity = comparison_requirement(result)
                    requirements.setdefault(identity['id'], identity)
                    requirement_values[identity['id']] = {
                        'verdict': result.get('verdict', 'uncovered'),
                        'state': 'current' if source['freshness'] == 'current' else 'historical',
                        'actual': result.get('actual'), 'margin': result.get('margin'),
                        'unit': result.get('unit'), 'reason': result.get('reason'), 'source': source,
                    }
            for review in reviews:
                for requirement in review.get('items', []):
                    definition = requirement.get('definition', {})
                    identity = {'id': requirement['id'], **{key: definition.get(key) for key in ('title', 'standard', 'clause', 'target')}}
                    requirements.setdefault(identity['id'], identity)
            values = {}
            handlers = {
                'geometry': geometry_metrics, 'rating': rating_metrics,
                'short_circuit': short_circuit_metrics, 'standards': standard_metrics,
            }
            for channel, item in channels.items():
                if channel in handlers:
                    values.update(handlers[channel](state, item, self._source(channel, item)))
            for key, unit in (('outer_diameter','m'),('mass','kg/km'),('copper_mass','kg/km')):
                values.setdefault(key, metric(None, unit, None))
            items.append({**plan, 'base_reference': json.loads(plan['base_reference']), 'revision': row['revision'],
                          'document': state['domain'], 'values': values, 'requirements': requirement_values,
                          'is_baseline': not bool(state.get('type_plan_source')),
                          'sources': [self._source(
                              k,
                              v,
                          ) for k,v in channels.items()], 'issues': failures})
        # Compare the union of bound requirements and every saved check row. A
        # shorter artifact must never silently improve a candidate's coverage.
        for item in items:
            for identity in requirements:
                item['requirements'].setdefault(identity, {
                    'state': 'unrun', 'verdict': None, 'actual': None, 'margin': None,
                    'unit': None, 'reason': '本方案尚无此要求的保存判定；请执行标准核对。', 'source': None,
                })
            if 'standards' in item['values']:
                item['values']['standards']['total'] = len(requirements)
        return {'family_id': fid, 'name': family['name'] if family else clean_name(base.get('name', '型号')),
                'items': items, 'requirements': list(requirements.values())}

    def library(self):
        with self.store.db() as db:
            rows = db.execute(
                'SELECT a.*,t.workspace,t.family,t.submission,t.receipt,t.payload,t.digest '
                'FROM engineering_type_releases t JOIN engineering_assets a ON a.id=t.asset '
                "WHERE a.status='published' ORDER BY a.created DESC"
            ).fetchall()
            result = []
            for row in rows:
                payload = json.loads(row['payload'])
                if fingerprint(payload) != row['digest']:
                    raise HTTPException(409, '型号库版本内容完整性异常。')
                self.assets._detail(db, self.assets._load(db, row['id']))
                result.append({**self.assets._summary(row), 'workspace_id':row['workspace'],
                               'purpose':payload['purpose'], 'specification_digest':row['digest'],
                               'source_design': {'id': row['workspace'], 'revision': payload['revision']},
                               'definition_endpoint':'/api/types/'+row['workspace']+'/specification',
                               'approval':self._receipt(row['receipt'])})
        return {'items': result}


def comparison_requirement(result):
    from .requirements import Requirements
    try:
        identity = Requirements.proposal(result, {})['id']
    except (KeyError, TypeError, ValueError, AttributeError):
        # Incomplete older artifacts remain visible but cannot become bound
        # requirements. Preserve their row identity without inventing targets.
        identity = 'check/'+fingerprint({key: result.get(key) for key in ('id', 'target', 'standard', 'clause')})
    return {'id': identity, **{key: result.get(key) for key in ('title', 'standard', 'clause', 'target')}}


def geometry_metrics(state, item, source):
    artifact, values = item.get('artifact', {}), {}
    values['outer_diameter'] = metric(artifact.get('outer_diameter_m'), 'm', source)
    values['mass'] = metric(artifact.get('mass_kg_per_km'), 'kg/km', source)
    copper = [r for r in artifact.get('layers', []) if r.get('role') == 'conductor']
    conductor = state['domain']['cable_types'][0]['cores'][0]['conductor']
    material = next((m for m in state['domain']['materials'] if m['id'] == conductor['material']), {})
    is_copper = material.get('standard_kind') in (
        'copper',
        'copper_bare',
        'copper_coated',
    ) or material.get('label', '').lower() in ('copper', '铜', 'cu')
    cu_mass = copper[0].get('mass_kg_per_km') if copper and is_copper else None
    values['copper_mass'] = metric(cu_mass, 'kg/km', source)
    return values


def rating_metrics(state, item, source):
    values = {}
    for r in item['rows']:
        condition = {k:v for k,v in r['condition'].items() if k not in ('case_id','name','source','actual_spacing_m')}
        condition = {k:float(format(v,'.12g')) if isinstance(v,float) else v for k,v in condition.items()}
        # Explicit spacing stays in the key; automatic touching
        # spacing follows the variant OD and is recorded per cell.
        key = 'rating/'+fingerprint(condition)[:24]
        values[key] = metric(r['value_a'], 'A', {**source, 'condition': r['condition'], 'case_id': r['case_id']}, r['name'], r['reason'])
    return values


def short_circuit_metrics(state, item, source):
    artifact, values = item.get('artifact', {}), {}
    conductors = [r for r in artifact.get('rows', []) if r['id'].endswith('conductor-adiabatic')]
    merged = bool(conductors) and all((
        r['status'],
        r.get('value'),
        r.get('unit'),
        r.get('formula_inputs'),
    ) == (conductors[0]['status'],conductors[0].get('value'),conductors[0].get('unit'),conductors[0].get('formula_inputs')) for r in conductors)
    for r in conductors[:1] if merged else conductors:
        if r['id'].endswith('conductor-adiabatic'):
            key = 'short_circuit/conductor' if merged else 'short_circuit/'+r['target']['core_id']
            values[key] = metric(
                r.get('value') if r['status']=='available' else None,
                r.get('unit'),
                {**source, 'conditions': item['run']['snapshot']['definition']['parameters']},
                '导体短路容量（每芯）' if merged else r['title'],
                r.get('reason'),
            )
    return values


def standard_metrics(state, item, source):
    artifact, values = item.get('artifact', {}), {}
    rows = artifact.get('rows', [])
    values['standards'] = metric(sum(r.get('verdict') == 'passed' for r in rows), '项', source, '标准核对通过')
    values['standards']['total'] = len(rows)
    return values


def check_results(channels, checks):
    for key in ('geometry', 'electrical', 'rating', 'short_circuit', 'standards'):
        item = channels.get(key)
        if not item:
            checks.append({
                'id': key+'/missing',
                'channel': key,
                'message': dict(geometry='结构推导', electrical='电气参数', rating='载流量表', short_circuit='短路容量', standards='标准核对')[key]+'尚无保存运行。',
                'blocking': True,
            })
            continue
        if item['run']['freshness'] != 'current':
            checks.append({'id': key+'/historical', 'channel': key, 'message': '所引运行为历史结果，请更新'+key+'。', 'blocking': True})
        if item['run']['status'] not in ('succeeded', 'partial'):
            checks.append({'id': key+'/failed', 'channel': key, 'message': '所引运行未完成，请更新'+key+'。', 'blocking': True})
        artifact = item.get('artifact', {})
        if key in ('electrical', 'short_circuit', 'standards'):
            if not artifact.get('rows'):
                checks.append({'id': key+'/empty', 'channel': key, 'message': '所引运行没有可交付的结果行，请重新计算。', 'blocking': True})
            for result in artifact.get('rows', []):
                unavailable = result.get('verdict') in (
                    'uncovered',
                    'missing',
                    'fail',
                    'failed',
                ) if key == 'standards' else result.get('status') not in ('available',)
                if unavailable:
                    checks.append({
                        'id': key+'/'+result['id'],
                        'channel': key,
                        'message': result.get(
                            'title',
                            result['id'],
                        )+'：'+str(result.get('reason') or result.get('verdict') or result.get('status'))+'。',
                        'blocking': True,
                    })
        if key == 'geometry' and artifact.get('mass_kg_per_km') is None:
            checks.append({'id': 'geometry/mass', 'channel': key, 'message': '单位长度用料缺少完整材料密度或构造输入。', 'blocking': True})
        if key == 'rating':
            if not item.get('rows'):
                checks.append({'id': 'rating/empty', 'channel': key, 'message': '尚无载流量工况结果，请先配置并计算工况。', 'blocking': True})
            for result in item['rows']:
                if result['value_a'] is None:
                    checks.append({
                        'id': 'rating/'+result['case_id'],
                        'channel': key,
                        'message': result['name']+'：'+str(result['reason'] or result['status'])+'。',
                        'blocking': True,
                    })


def metric(value, unit, source, title=None, reason=None):
    return {'value': value, 'unit': unit, 'source': source, 'title': title, 'reason': reason,
            'state': 'missing' if value is None else 'historical' if source and source['freshness'] != 'current' else 'current'}


def next_version(version):
    match = re.fullmatch(r'(\d+)\.(\d+)\.(\d+)(?:-[A-Za-z0-9.-]+)?', version)
    return f'{match[1]}.{match[2]}.{int(match[3])+1}' if match else '1.0.0'


def make_router(service):
    router = APIRouter(prefix='/api/types', tags=['Type versions'])
    def creation_call(call):
        try:
            return call()
        except PluginHostError as error:
            raise HTTPException(error.status, {'code': error.code, 'message': error.message}) from None
        except ValidationError as error:
            raise HTTPException(422, {'message': '请补齐或修正结构字段。', 'fields': [{'field': '/'+ '/'.join(map(str, e['loc'])), 'message': e['msg']} for e in error.errors()]}) from None
        except ValueError as error:
            raise HTTPException(422, {'message': str(error)}) from None
    @router.get('/creation-options')
    def creation_options():
        return creation_call(service.creation_options)
    @router.post('/creation-proposals')
    def creation_proposal(body: NewTypeProposal):
        return creation_call(lambda: service.propose_type(body))
    @router.post('', status_code=201)
    def create(body: NewType, x_cablesim_actor: str | None = Header(default=None)):
        return creation_call(lambda: service.create_type(body, x_cablesim_actor))
    @router.put('/{wid}/document')
    def save_document(wid: str, body: SaveTypeDocument):
        return creation_call(lambda: service.save_document(wid, body))
    @router.get('/library')
    def library():
        return service.library()
    @router.get('/{wid}/comparison')
    def comparison(wid: str):
        return service.comparison(wid)
    @router.get('/{wid}/resources')
    def resources(wid: str):
        return service.resources(wid)
    @router.post('/{wid}/resources/bind')
    def bind_resource(wid: str, body: BindResource):
        return service.bind_resources(wid, body)
    @router.post('/{wid}/resources/migrate')
    def migrate_resources(wid: str, body: MigrateResources):
        return service.bind_resources(wid, body, migrate=True)
    @router.post('/{wid}/plans', status_code=201)
    def branch(wid: str, body: Branch):
        return service.branch(wid, body)
    @router.post('/{wid}/adopt')
    def adopt(wid: str, body: Adopt):
        return service.adopt(wid, body)
    @router.get('/{wid}/specification')
    def specification(wid: str, audience: Literal['customer', 'internal'] = 'customer'):
        return service.specification(wid, audience)
    @router.post('/{wid}/specification/generate')
    def generate_specification(wid: str, body: GenerateSpecification):
        from .specification_generation import generate
        return generate(service, wid, body)
    @router.get('/{wid}/specification/file')
    def specification_file(wid: str, expected_revision: int, specification_digest: str, audience: Literal['customer', 'internal'] = 'customer'):
        from .specification_pdf import render_pdf
        spec = service.specification(wid, audience)
        if spec['payload']['revision'] != expected_revision or spec['digest'] != specification_digest:
            raise HTTPException(409, '规格书内容或修订已变化，请重新读取后导出。')
        if audience == 'customer':
            from .specification_generation import generation_gap, ORDER
            _, _, channels, _ = service.evidence(wid)
            for channel in ORDER:
                gap = generation_gap(channel, channels.get(channel))
                if gap:
                    raise HTTPException(422, {'message':'请先生成规格书。'+gap, 'channel':channel})
        try:
            data = render_pdf(spec, audience)
        except ImportError:
            raise HTTPException(503, '规格书 PDF 环境缺失，请按宿主依赖清单安装 PyMuPDF 和 ReportLab。') from None
        except ValueError as failure:
            raise HTTPException(422, str(failure)) from None
        return Response(data, media_type='application/pdf', headers={
            'Content-Disposition':'attachment; filename="cable-specification.pdf"',
            'X-Artifact-SHA256':sha256(data).hexdigest(), 'X-Specification-SHA256':spec['digest'],
            'X-Specification-Audience':audience,
            'Cache-Control':'no-store',
        })
    @router.post('/{wid}/submissions', status_code=201)
    def submit(wid: str, body: Submit):
        return service.submit(wid, body)
    @router.post('/{wid}/approve')
    def approve(wid: str, body: Approval, x_cablesim_actor: str | None = Header(default=None)):
        return service.approve(wid, body, x_cablesim_actor)
    @router.post('/{wid}/publish')
    def publish(wid: str, body: Publish, x_cablesim_actor: str | None = Header(default=None)):
        return service.publish(wid, body, x_cablesim_actor)
    return router
