"""Human adoption of frozen input references through the existing asset/study store.

No solver, second model library, approval inheritance, or guessed input is added.
The source snapshot is evidence; it never overwrites a target's saved project.
"""
from __future__ import annotations

from copy import deepcopy
from dataclasses import asdict
import json
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException
from pydantic import Field, TypeAdapter, ValidationError, field_validator, model_validator

from backend.domain.guards import check_locks, pointer
from backend.domain.models import DomainDocument, Source
from backend.foundation.assets import confirm_reference_write
from backend.foundation.contracts import (AssetRelease, Digest, Identifier, ResourceApplication,
    SourceReference, Version, content_hash, frozen_application_dependencies)
from backend.schemas import StrictModel
from .contracts import CreateStudy, StudyDefinition
from .drivers import cases_for
from .workspace import fingerprint


TRUST = {'grade': 'reference', 'label': '保存输入参考',
         'reason': '保留原输入及其出处；资料核对或发布不构成厂家实测、目标工程验证或批准。'}
LIMITATIONS = ['只采用明确选中的输入；缺项保持缺失，不补默认物性、尺寸或工况。',
              '捕获来源、资料核对与目标工程批准是不同操作；采用后仍须独立预检和人工检查结果。']


def fail(code, message, status=422):
    raise HTTPException(status, {'code': code, 'message': message})


def require_human(actor):
    if actor != 'human':
        fail('HUMAN_RESOURCE_APPLICATION_REQUIRED', 'Agent 只能查看和预览；保存、发布或采用须由人工明确操作。', 403)


def same_json(left, right):
    """Compare explicit JSON facts without treating True as the number one."""
    if isinstance(left, dict) and isinstance(right, dict):
        return set(left) == set(right) and all(same_json(left[key], right[key]) for key in left)
    if isinstance(left, list) and isinstance(right, list):
        return len(left) == len(right) and all(same_json(a, b) for a, b in zip(left, right))
    if type(left) in (int, float) and type(right) in (int, float):
        return left == right
    return type(left) is type(right) and left == right


class CaptureBase(StrictModel):
    asset_id: Identifier
    version: Version
    name: str = Field(min_length=1, max_length=128)
    workspace_id: UUID
    expected_revision: int = Field(ge=1, strict=True)

    @field_validator('name')
    @classmethod
    def nonblank_name(cls, value):
        if not value.strip():
            raise ValueError('资料名称不能为空。')
        return value.strip()


class CaptureConfirmation(StrictModel):
    preview_digest: str = Field(pattern=r'^[a-f0-9]{64}$')
    human_confirmed: Literal[True]

    @field_validator('human_confirmed', mode='before')
    @classmethod
    def strict_human(cls, value):
        if value is not True:
            raise ValueError('须由人工明确确认预览，字符串或数字不能代替确认。')
        return value


class AdoptionBase(StrictModel):
    resource_id: UUID
    content_sha256: str = Field(pattern=r'^[a-f0-9]{64}$')
    workspace_id: UUID
    expected_revision: int = Field(ge=1, strict=True)


class AdoptionConfirmation(CaptureConfirmation):
    request_id: UUID
    acknowledge_reference_limits: Literal[True]

    @field_validator('acknowledge_reference_limits', mode='before')
    @classmethod
    def strict_limits(cls, value):
        return cls.strict_human(value)


class CaptureStudy(CaptureBase):
    study_id: UUID
    expected_study_revision: int = Field(ge=1, strict=True)
    source_run_id: UUID


class CreateStudyTemplate(CaptureStudy, CaptureConfirmation):
    pass


class StudyBindings(StrictModel):
    cable_type_ids: list[str] = Field(min_length=1, max_length=1000)
    circuit_ids: list[str] = Field(min_length=1, max_length=1000)
    cable_ids: list[str] = Field(min_length=1, max_length=1000)

    @model_validator(mode='after')
    def unique_ids(self):
        for field, prefix in (('cable_type_ids', 'cable_type/'), ('circuit_ids', 'circuit/'), ('cable_ids', 'cable/')):
            values = getattr(self, field)
            if len(set(values)) != len(values) or any(not value.startswith(prefix) for value in values):
                raise ValueError('须逐项确认完整、唯一的保存对象标识。')
        return self


class PreviewStudyTemplate(AdoptionBase):
    title: str = Field(min_length=1, max_length=120)
    bindings: StudyBindings

    @field_validator('title')
    @classmethod
    def title_not_blank(cls, value):
        if not value.strip():
            raise ValueError('新研究名称不能为空。')
        return value.strip()


class AdoptStudyTemplate(PreviewStudyTemplate, AdoptionConfirmation):
    operation: Literal['adopt_resource_study_template'] = 'adopt_resource_study_template'


def source_for(provenance, path, indexed_path=None):
    """Find the nearest explicit original source, preserving the matched path."""
    candidates, frontier = [], [item for item in (path, indexed_path) if item]
    while frontier:
        parents = []
        for item in frontier:
            if item not in candidates:
                candidates.append(item)
            parent = item.rsplit('/', 1)[0]
            if parent:
                parents.append(parent)
        frontier = parents
    candidates.append('/')
    for candidate in candidates:
        value = provenance.get(candidate)
        if value is None:
            continue
        if not isinstance(value, dict) or type(value.get('reviewed')) is not bool:
            fail('RESOURCE_SOURCE_INVALID', '原始来源的核对状态必须是明确布尔值：' + candidate)
        try:
            parsed = Source.model_validate(value)
        except ValidationError:
            fail('RESOURCE_SOURCE_INVALID', '原输入出处格式无效：' + candidate)
        if not (parsed.reference or '').strip():
            continue
        return parsed.model_dump(mode='json'), candidate
    return None, None


def frozen_source(row, state):
    if not isinstance(state.get('domain'), dict):
        fail('RESOURCE_DOMAIN_REQUIRED', '需要明确保存的领域输入，不能从旧演示参数补造结构。')
    return {'workspace_id': row['id'], 'revision': row['revision'],
            'name': state['domain']['name'], 'document_sha256': fingerprint(state['domain']),
            'snapshot': deepcopy(state), 'snapshot_sha256': fingerprint(state)}


def dependencies(state):
    try:
        return frozen_application_dependencies(state)
    except (ValueError, ValidationError):
        fail('RESOURCE_DEPENDENCY_CONFLICT', '原输入的固定资料绑定不完整，或同一资料版本声明了不同摘要。')


def make_release(body, kind, source, payload, method):
    application = ResourceApplication(kind=kind, method=method, source=source,
        payload=payload, payload_sha256=fingerprint(payload))
    return AssetRelease(asset_id=body.asset_id, version=body.version, name=body.name, kind=kind,
        application=application, dependencies=dependencies(source['snapshot']),
        sources=(SourceReference(kind='project_input', reviewed=False,
            reference=f"保存输入 {source['workspace_id']} 修订 {source['revision']}；sha256:{source['snapshot_sha256']}；完整逐项来源见冻结输入。"),))


def resource_summary(resource):
    return {key: resource[key] for key in ('id', 'asset_id', 'version', 'kind', 'name', 'status', 'revision', 'content_sha256')}


def load_application(assets, db, identifier, digest=None, *, kind=None, published=False):
    try:
        resource = assets._detail(db, assets._load(db, str(identifier)))
    except ValidationError:
        fail('RESOURCE_APPLICATION_INVALID', '保存的应用资料合同或固定依赖损坏，不能继续读取或采用。', 409)
    application = resource['release'].get('application')
    if not application or kind is not None and application['kind'] != kind:
        fail('RESOURCE_APPLICATION_MISSING', '该版本没有可用的完整输入载荷；旧摘要不能推测成部件或研究。')
    declared = {(item['asset_id'], item['version']): item for item in resource['release']['dependencies']}
    if any(declared.get((ref.asset_id, ref.version)) != ref.model_dump(mode='json')
           for ref in dependencies(application['source']['snapshot'])):
        fail('RESOURCE_APPLICATION_DEPENDENCIES_MISMATCH', '资料依赖缺失或被替换，与冻结输入的固定绑定不一致。', 409)
    if digest is not None and resource['content_sha256'] != digest:
        fail('RESOURCE_APPLICATION_CHANGED', '资料内容摘要已变化，请重新核对固定版本。', 409)
    if published and (resource['status'] != 'published' or resource['issues']):
        fail('RESOURCE_APPLICATION_NOT_PUBLISHED', '资料或其依赖不是可新引用的已发布版本。', 409)
    return resource, application


def _study_definition(raw):
    try:
        definition = StudyDefinition.model_validate(raw)
    except (ValidationError, TypeError):
        fail('RESOURCE_STUDY_INCOMPLETE', '研究定义损坏或缺少显式输入，不能补默认值。')
    value = definition.model_dump(mode='json')
    if not same_json(value, raw) or set(raw) != set(StudyDefinition.model_fields):
        fail('RESOURCE_STUDY_INCOMPLETE', '必须捕获完整已保存研究；驱动、输入来源和可选字段不能靠默认值补齐。')
    if (value['method']['plugin_id'] != 'cablesim.iec60287' or value['method']['capability'] != 'steady-rating'
            or value['input_source'] != 'domain' or value['method_input'] is not None
            or value['driver']['kind'] != 'single' or value['modules'] or value['crosschecks']
            or value['candidate_completions'] or value['verification'] is not None):
        fail('RESOURCE_STUDY_UNCOVERED', '当前模板只覆盖固定版本的 IEC 稳态领域单次研究；扫描、候选、模块与外部输入不在范围内。')
    return value


def study_bindings(document):
    return {'cable_type_ids': [item['id'] for item in document['cable_types']],
            'circuit_ids': [item['id'] for item in document['circuits']],
            'cable_ids': [item['id'] for circuit in document['circuits'] for item in circuit['cables']]}


def study_method(research, definition):
    plugin, capability = research.resolve(definition['method'])
    return plugin, capability, {**definition['method'], 'name': capability.title,
                                'method_version': capability.method_version}


def parameter_fields(definition, schema):
    fields, missing = [], []

    def resolved(value):
        ref = value.get('$ref')
        if ref and ref.startswith('#/$defs/'):
            return {**schema.get('$defs', {}).get(ref.removeprefix('#/$defs/'), {}), **value}
        return value

    def visit(value, contract, path):
        contract = resolved(contract)
        if isinstance(value, dict):
            for key, item in value.items():
                shape = contract.get('properties', {}).get(key, contract.get('additionalProperties', {}))
                visit(item, shape if isinstance(shape, dict) else {}, path + pointer(key))
            return
        if isinstance(value, list):
            for index, item in enumerate(value):
                visit(item, contract.get('items', {}), path + '/' + str(index))
            return
        source, source_path = source_for(definition['input_sources'], path)
        if source is None and isinstance(definition['parameters'].get('source'), str) and definition['parameters']['source'].strip():
            source = {'kind': 'user', 'reviewed': False, 'reference': definition['parameters']['source']}
            source_path = '/parameters/source'
        unit = (contract.get('x-unit') or {}).get('si')
        if type(value) in (float, int) and (not isinstance(unit, str) or not unit):
            fail('RESOURCE_PARAMETER_UNIT_MISSING', '固定方法未给该数值参数的 SI 单位：' + path)
        if value is not None and source is None:
            fail('RESOURCE_PARAMETER_SOURCE_MISSING', '保存参数缺少明确出处：' + path)
        if value is None:
            missing.append(path + '：原研究未给出此值。')
        fields.append({'path': path, 'label': contract.get('title') or contract.get('description') or path,
                       'value': deepcopy(value), 'unit': unit, 'source': source, 'source_path': source_path})
    visit(definition['parameters'], schema, '/parameters')
    return fields, missing


def require_domain_sources(document):
    """Every saved numerical input needs its own or an explicit parent source."""
    missing = []

    def visit(value, stable, indexed, embedded_source=None):
        if isinstance(value, dict):
            declared = value.get('source')
            if isinstance(declared, dict) and 'kind' in declared:
                embedded_source, _ = source_for({'/': declared}, '/')
            for key, item in value.items():
                if key not in ('provenance', 'source'):
                    visit(item, stable + pointer(key), indexed + pointer(key), embedded_source)
        elif isinstance(value, list):
            for index, item in enumerate(value):
                identity = (item.get('id') or item.get('role') or item.get('cable')) if isinstance(item, dict) else None
                unique = identity and sum(isinstance(other, dict) and identity in (
                    other.get('id'), other.get('role'), other.get('cable')) for other in value) == 1
                visit(item, stable + pointer(identity if unique else index), indexed + '/' + str(index), embedded_source)
        elif type(value) in (int, float):
            source, _ = source_for(document['provenance'], stable, indexed)
            if source is None and embedded_source is None:
                missing.append(stable)
    visit(document, '', '')
    if missing:
        raise HTTPException(422, {'code': 'RESOURCE_DOMAIN_SOURCE_MISSING',
            'message': '保存领域输入有数值缺少明确出处；请在原输入中逐项补充真实来源或明确研究声明并重新计算，不能以模板自动补来源。',
            'fields': missing})


def validate_study_application(research, application):
    payload, source = application['payload'], application['source']
    if set(payload) != {'definition', 'bindings', 'parameter_schema'}:
        fail('RESOURCE_STUDY_INCOMPLETE', '冻结研究载荷字段不完整。')
    definition = _study_definition(payload['definition'])
    document = source['snapshot']['domain']
    try:
        complete = DomainDocument.model_validate(document).model_dump(mode='json')
        UUID(source['workspace_id']); UUID(source['study_id']); UUID(source['run_id'])
        for key in ('input_digest', 'output_digest'):
            TypeAdapter(Digest).validate_python(source[key])
    except (ValidationError, KeyError, TypeError, ValueError):
        fail('RESOURCE_STUDY_INCOMPLETE', '冻结研究缺少有效领域输入或来源运行身份。')
    if (not same_json(complete, document) or type(source.get('study_revision')) is not int or source['study_revision'] < 1
            or payload['bindings'] != study_bindings(document)):
        fail('RESOURCE_STUDY_IDENTITY', '冻结研究输入、绑定或来源运行摘要不一致。')
    require_domain_sources(document)
    _, capability, method = study_method(research, definition)
    schema = capability.parameter_schema.model_dump(mode='json', by_alias=True)
    if not same_json(method, application['method']) or not same_json(schema, payload['parameter_schema']):
        fail('RESOURCE_METHOD_CHANGED', '固定方法或参数契约不匹配；不能以当前默认值替代。', 409)
    from jsonschema import Draft202012Validator
    errors = list(Draft202012Validator(schema).iter_errors(definition['parameters']))
    if errors:
        fail('RESOURCE_PARAMETERS_INVALID', '冻结参数不符合固定方法契约：' + errors[0].message)
    fields, missing = parameter_fields(definition, schema)
    return {'definition': definition, 'bindings': deepcopy(payload['bindings']), 'fields': fields, 'missing': missing}


def application_evidence(research, application):
    if application['kind'] == 'component':
        from .component_applications import validate_component_application
        details = validate_component_application(application)
    else:
        details = validate_study_application(research, application)
    return {'kind': application['kind'], 'source': deepcopy(application['source']),
            'method': deepcopy(application['method']), **details, 'trust': deepcopy(TRUST),
            'limitations': list(LIMITATIONS), 'approval': 'not_granted', 'read_only': True}


def capture_preview(research, assets, db, body, release):
    issues = assets._issues(db, release)
    if issues:
        fail('RESOURCE_DEPENDENCY_UNAVAILABLE', issues[0]['message'], 409)
    payload = {'schema_version': 'cablesim.resource-capture-preview/1',
               'release': release.model_dump(mode='json'), 'content_sha256': content_hash(release),
               **application_evidence(research, release.application.model_dump(mode='json')), 'persisted': False}
    return {**payload, 'preview_digest': fingerprint(payload)}


def save_capture(assets, db, body, preview, actor):
    if preview['preview_digest'] != body.preview_digest:
        fail('RESOURCE_CAPTURE_PREVIEW_CHANGED', '来源输入、方法或预览已变化，请重新核对。', 409)
    release = AssetRelease.model_validate(preview['release'])
    confirm_reference_write(release, actor=actor, human_confirmed=body.human_confirmed)
    rid = assets._insert(db, release, '人工核对完整固定来源后捕获输入参考草稿；未发布、未采用、未批准。')
    return assets._detail(db, assets._load(db, rid))


def capture_study(research, assets, db, body):
    wid = str(body.workspace_id)
    row, state = research.store.load(db, wid, body.expected_revision, allow_domain=True)
    saved = research.definition(db, wid, str(body.study_id), body.expected_study_revision)
    definition = _study_definition(saved['definition'])
    run = research.get_run(wid, str(body.source_run_id))
    snapshot = run.get('snapshot') or {}
    record = db.execute('SELECT * FROM study_runs WHERE workspace=? AND id=?', (wid, str(body.source_run_id))).fetchone()
    if (record is None or run.get('status') != 'succeeded' or run.get('integrity') != 'verified'
            or run.get('freshness') != 'current' or run.get('study') != str(body.study_id)
            or any(record[key] != run.get(key) for key in ('status', 'input_digest', 'output_digest'))
            or snapshot.get('workspace_revision') != row['revision']
            or snapshot.get('study_revision') != saved['revision'] or snapshot.get('module') is not None
            or snapshot.get('definition') != definition or snapshot.get('workspace_state') != state):
        fail('RESOURCE_SOURCE_RUN_INVALID', '须选择与当前保存输入及研究修订完全一致、成功且完整性已核验的运行。', 409)
    source = frozen_source(row, state)
    source.update(study_id=str(body.study_id), study_revision=saved['revision'], run_id=run['id'],
                  input_digest=run['input_digest'], output_digest=run['output_digest'])
    _, capability, method = study_method(research, definition)
    payload = {'definition': definition, 'bindings': study_bindings(state['domain']),
               'parameter_schema': capability.parameter_schema.model_dump(mode='json', by_alias=True)}
    release = make_release(body, 'study_template', source, payload, method)
    return capture_preview(research, assets, db, body, release)


def local_run_status(research, db, application):
    source = application['source']
    row = db.execute('SELECT * FROM study_runs WHERE id=?', (source['run_id'],)).fetchone()
    if row is None:
        return 'external_declared_run'
    if row['workspace'] != source['workspace_id'] or row['study'] != source['study_id']:
        fail('RESOURCE_SOURCE_RUN_CORRUPT', '本库已有相同运行 ID，但其原工程或研究身份不同，不能按外部声明放行。', 409)
    run = research.get_run(source['workspace_id'], source['run_id'])
    snapshot = run.get('snapshot') or {}
    if (run.get('integrity') != 'verified' or run.get('status') != 'succeeded'
            or run.get('study') != source['study_id']
            or any(run.get(key) != source[key] for key in ('input_digest', 'output_digest'))
            or snapshot.get('workspace_revision') != source['revision']
            or snapshot.get('study_revision') != source['study_revision']
            or snapshot.get('workspace_state') != source['snapshot']
            or snapshot.get('definition') != application['payload']['definition']):
        fail('RESOURCE_SOURCE_RUN_CORRUPT', '本库来源运行与冻结资料不一致，不能按外部声明降级放行。', 409)
    return 'verified_local_run'


def preview_study_adoption(research, assets, db, body):
    row, state = research.store.load(db, str(body.workspace_id), body.expected_revision, allow_domain=True)
    research.store.assert_mutable(db, row['id'])
    resource, application = load_application(assets, db, body.resource_id, body.content_sha256,
                                            kind='study_template', published=True)
    evidence = application_evidence(research, application)
    source_document = application['source']['snapshot']['domain']
    document = state.get('domain')
    if not isinstance(document, dict):
        fail('RESOURCE_DOMAIN_REQUIRED', '目标必须已有明确保存的领域输入。')
    require_domain_sources(document)
    selected = body.bindings.model_dump(mode='json')
    if selected != evidence['bindings'] or selected != study_bindings(document):
        fail('RESOURCE_BINDINGS_MISMATCH', '须逐项确认相同的完整稳定对象 ID；不按名称猜测或自动重绑定。')
    # A copied study can use new environmental inputs, but not a different cable,
    # material, topology or system hidden behind the same display name.
    for key in ('cable_types', 'materials', 'circuits'):
        if not same_json(document[key], source_document[key]):
            fail('RESOURCE_BINDINGS_MISMATCH', '目标的完整型号、材料或回路事实与模板不一致：' + key)
    definition = deepcopy(evidence['definition'])
    definition['title'] = body.title
    previous_application_source = deepcopy(definition['input_sources'].get('/resource_application'))
    definition['input_sources']['/resource_application'] = {'kind': 'asset', 'reviewed': False,
        'reference': json.dumps({'schema': 'cablesim.adopted-study-reference/1',
            'resource': resource_summary(resource), 'origin': {key: application['source'][key] for key in
                ('workspace_id', 'revision', 'study_id', 'study_revision', 'run_id', 'input_digest', 'output_digest')},
            'previous_application_source': previous_application_source,
            'trust': TRUST, 'approval': 'not_granted'}, ensure_ascii=False)}
    _, capability, _ = study_method(research, definition)
    plugin, _ = research.resolve(definition['method'])
    cases = cases_for(definition, document)
    for case in cases:
        check_locks(state, case['input'], case['parameters'])
    checks = research.check_cases(plugin, capability, cases)
    preflight = {'ready': bool(checks) and all(item.status == 'succeeded' for item in checks),
                 'cases': [asdict(item) for item in checks], 'limitations': capability.limitations}
    if not preflight['ready']:
        raise HTTPException(422, {'code': 'RESOURCE_TARGET_PREFLIGHT',
            'message': '目标输入未通过固定方法预检；缺项或条件不适用，未保存研究。', 'preflight': preflight})
    result = {**evidence, 'schema_version': 'cablesim.study-template-preview/1',
        'workspace_id': row['id'], 'revision': row['revision'], 'document_sha256': fingerprint(document),
        'resource': resource_summary(resource), 'definition': definition, 'bindings': selected,
        'source_run_status': local_run_status(research, db, application), 'preflight': preflight,
        'adoptable': True, 'run_started': False}
    # The real checker has per-execution evidence (run IDs, elapsed timings and
    # seal-cache diagnostics). Bind all frozen/target facts and the readiness
    # decision, not those changing execution receipts. Adoption still performs
    # the full real preflight again and refuses any failed case.
    fixed = {**result, 'preflight': {'ready': preflight['ready'],
        'cases': [{'case_id': case['case_id'], 'status': case['status']} for case in preflight['cases']]}}
    return {**result, 'preview_digest': fingerprint(fixed)}


def make_router(research, assets, types):
    router = APIRouter(prefix='/api/library/resources', tags=['Frozen input references'])

    @router.get('/applications/{resource_id}/evidence')
    def evidence(resource_id: UUID):
        with research.store.read_snapshot() as db:
            resource, application = load_application(assets, db, resource_id)
            return {**application_evidence(research, application), 'resource': resource_summary(resource),
                    'application': deepcopy(application), 'dependencies': resource['release']['dependencies'],
                    'issues': resource['issues']}

    @router.post('/study-templates/capture-preview')
    def study_capture_preview(body: CaptureStudy):
        with research.store.read_snapshot() as db:
            return capture_study(research, assets, db, body)

    @router.post('/study-templates/capture', status_code=201)
    def study_capture(body: CreateStudyTemplate, x_cablesim_actor: str | None = Header(default=None)):
        require_human(x_cablesim_actor)
        with research.store.db(True) as db:
            return save_capture(assets, db, body, capture_study(research, assets, db, body), x_cablesim_actor)

    @router.post('/study-templates/preview')
    def study_preview(body: PreviewStudyTemplate):
        with research.store.read_snapshot() as db:
            return preview_study_adoption(research, assets, db, body)

    @router.post('/study-templates/adopt', status_code=201)
    def study_adopt(body: AdoptStudyTemplate, x_cablesim_actor: str | None = Header(default=None)):
        require_human(x_cablesim_actor)
        with research.store.db(True) as db:
            replay = types._replay(db, str(body.workspace_id), body)
            if replay:
                return replay
            preview = preview_study_adoption(research, assets, db, body)
            if preview['preview_digest'] != body.preview_digest:
                fail('RESOURCE_ADOPTION_PREVIEW_CHANGED', '目标、来源或预览已变化，请重新核对。', 409)
            saved = research.save(str(body.workspace_id), CreateStudy(expected_revision=body.expected_revision,
                **preview['definition']), connection=db)
            result = {'study': saved, 'workspace_id': str(body.workspace_id), 'revision': body.expected_revision,
                      'run_started': False, 'approval': 'not_granted'}
            types._remember(db, str(body.workspace_id), body, result)
            return result

    from .component_applications import component_routes
    router.include_router(component_routes(research, assets, types))
    return router
