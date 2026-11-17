"""Series and table imports over the existing type/workspace/candidate store.

There is one engineering payload: domain_cable_models and the ordinary Types
workspace. The additional tables only hold series membership, immutable import
receipts, and references to those existing identities.
"""
from copy import deepcopy
from hashlib import sha256
import json
from threading import RLock
from typing import Literal
from uuid import UUID, uuid4, uuid5, NAMESPACE_URL

from fastapi import APIRouter, File, Header, UploadFile, HTTPException
from fastapi.responses import Response
from pydantic import Field, field_validator, model_validator

from backend.schemas import StrictModel
from .workspace import fingerprint, stamp
from . import candidates, factory_tables as tables
from .published_guidance import validate_published_guidance
from .type_import_models import SeriesDeclaration, build_rows
from .type_versions import NewType, Branch
from .environment_references import EnvironmentAdoption


def encoded(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True)


class Preview(StrictModel):
    upload_id: UUID
    sheet: str = Field(min_length=1, max_length=120)
    first_data_row: int = Field(ge=1, le=tables.MAX_ROWS)
    mapping: dict[str, int] = Field(min_length=1, max_length=tables.MAX_COLUMNS)
    series: SeriesDeclaration


class Commit(StrictModel):
    preview_id: UUID
    preview_digest: str = Field(pattern=r'^[0-9a-f]{64}$')
    request_id: UUID
    human_confirmed: Literal[True]
    skip_errors: bool = Field(default=False, strict=True)

    @field_validator('human_confirmed', mode='before')
    @classmethod
    def human(cls, value):
        if value is not True:
            raise ValueError('须由人工确认这份预览后入库。')
        return value


class Mapping(StrictModel):
    name: str = Field(min_length=1, max_length=80)
    mapping: dict[str, int] = Field(min_length=1, max_length=80)
    headers: dict[str, str] = Field(default_factory=dict, max_length=80)

    @model_validator(mode='after')
    def columns(self):
        self.name = self.name.strip()
        if not self.name or 'area' not in self.mapping or set(self.mapping) - set(tables.FIELDS):
            raise ValueError('映射须有名称、截面及有效字段。')
        if len(set(self.mapping.values())) != len(self.mapping) or any(v < 0 or v >= tables.MAX_COLUMNS for v in self.mapping.values()):
            raise ValueError('映射列不能重复或越界。')
        return self


class CatalogueComparison(StrictModel):
    reference_scenario_confirmed: bool = Field(default=False, strict=True)


class Batch(StrictModel):
    request_id: UUID
    operation: Literal['check', 'calculate', 'review']
    spec_ids: list[UUID] = Field(min_length=1, max_length=100)
    expected_versions: dict[str, int] = Field(min_length=1, max_length=100)
    expected_revisions: dict[str, int] = Field(min_length=1, max_length=100)
    human_confirmed: Literal[True]
    scope_acknowledged: Literal[True]
    parameters: dict = Field(default_factory=dict)
    rows: list[dict] = Field(default_factory=list, max_length=100)
    environment_references: list[EnvironmentAdoption] = Field(default_factory=list, max_length=300)
    action: Literal['submit', 'approve', 'publish'] = 'submit'
    note: str = Field(default='', max_length=1000)

    @field_validator('human_confirmed', 'scope_acknowledged', mode='before')
    @classmethod
    def human(cls, value):
        return Commit.human(value)

    @model_validator(mode='after')
    def exact_versions(self):
        keys = {str(key) for key in self.spec_ids}
        if len(keys) != len(self.spec_ids) or keys != set(self.expected_versions) or keys != set(self.expected_revisions):
            raise ValueError('须为每个所选规格指定唯一且准确的型号版本和保存修订号。')
        if self.operation == 'review' and not self.note.strip():
            raise ValueError('批量审核须填写意见。')
        if self.environment_references:
            if self.operation != 'calculate':
                raise ValueError('环境参考只能用于载流量计算工况。')
            targets = [(str(item.workspace_id), item.row.case_id) for item in self.environment_references]
            if len(targets) != len(set(targets)):
                raise ValueError('同一型号和工况只能确认一份环境预览。')
        return self


class Revise(StrictModel):
    request_id: UUID
    expected_version: int = Field(ge=1)
    expected_revision: int = Field(ge=1)
    note: str = Field(min_length=1, max_length=1000)
    human_confirmed: Literal[True]

    @field_validator('human_confirmed', mode='before')
    @classmethod
    def human(cls, value):
        return Commit.human(value)


class TypeLibrary:
    def __init__(self, types):
        self.types, self.store, self.research = types, types.store, types.research
        self.lock = RLock()

    def initialize(self):
        with self.store.db(True) as db:
            candidates.initialize(db)
            for sql in (
                'CREATE TABLE IF NOT EXISTS type_series(id TEXT PRIMARY KEY,name TEXT UNIQUE NOT NULL,declaration TEXT NOT NULL,created TEXT NOT NULL,actor TEXT NOT NULL)',
                'CREATE TABLE IF NOT EXISTS type_series_specs(id TEXT PRIMARY KEY,series TEXT NOT NULL,spec_key TEXT NOT NULL,UNIQUE(series,spec_key))',
                'CREATE TABLE IF NOT EXISTS type_series_versions(spec TEXT NOT NULL,version INTEGER NOT NULL,model TEXT NOT NULL,workspace TEXT NOT NULL,metadata TEXT NOT NULL,created TEXT NOT NULL,PRIMARY KEY(spec,version),UNIQUE(workspace))',
                'CREATE TABLE IF NOT EXISTS type_table_uploads(id TEXT PRIMARY KEY,filename TEXT NOT NULL,digest TEXT NOT NULL,original BLOB NOT NULL,created TEXT NOT NULL)',
                'CREATE TABLE IF NOT EXISTS type_table_previews(id TEXT PRIMARY KEY,upload TEXT NOT NULL,payload TEXT NOT NULL,digest TEXT NOT NULL,created TEXT NOT NULL)',
                'CREATE TABLE IF NOT EXISTS type_table_mappings(name TEXT PRIMARY KEY,payload TEXT NOT NULL,updated TEXT NOT NULL)',
                'CREATE TABLE IF NOT EXISTS type_library_requests(request TEXT PRIMARY KEY,digest TEXT NOT NULL,result TEXT NOT NULL)',
                'CREATE TABLE IF NOT EXISTS type_library_batches(id TEXT PRIMARY KEY,series TEXT NOT NULL,request TEXT NOT NULL,digest TEXT NOT NULL,status TEXT NOT NULL,payload TEXT NOT NULL,created TEXT NOT NULL)',
                'CREATE TABLE IF NOT EXISTS type_library_events(id TEXT PRIMARY KEY,series TEXT NOT NULL,spec TEXT,action TEXT NOT NULL,actor TEXT NOT NULL,detail TEXT NOT NULL,created TEXT NOT NULL)',
            ):
                db.execute(sql)
            # Interrupted jobs keep their saved per-item runs and never restart
            # on startup. The operator can inspect the receipt before retrying.
            db.execute("UPDATE type_library_batches SET status='interrupted' WHERE status='running'")

    @staticmethod
    def _replay(db, request, body):
        row = db.execute('SELECT * FROM type_library_requests WHERE request=?', (str(request),)).fetchone()
        if row:
            if row['digest'] != fingerprint(body):
                tables.fail('LIBRARY_REQUEST_CONFLICT', '同一请求标识已用于不同内容；未重复执行。', 409)
            return json.loads(row['result'])

    @staticmethod
    def _remember(db, request, body, result):
        db.execute('INSERT INTO type_library_requests VALUES(?,?,?)', (str(request), fingerprint(body), encoded(result)))

    @staticmethod
    def _event(db, series, spec, action, actor, detail):
        db.execute('INSERT INTO type_library_events VALUES(?,?,?,?,?,?,?)',
                   (str(uuid4()), series, spec, action, actor, encoded(detail), stamp()))

    def mappings(self):
        with self.store.db() as db:
            return [json.loads(row['payload']) for row in db.execute('SELECT payload FROM type_table_mappings ORDER BY name')]

    def save_mapping(self, body, actor):
        self.types._human(actor)
        value = body.model_dump(mode='json')
        with self.store.db(True) as db:
            db.execute('INSERT INTO type_table_mappings VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET payload=excluded.payload,updated=excluded.updated',
                       (body.name, encoded(value), stamp()))
        return value

    def vocabulary(self):
        from .catalogue_core import structure
        return {'fields': tables.vocabulary(), 'modelling': [{'key': k, 'label': v[0], 'unit': v[1]} for k, v in structure.MODELLING.items()],
                'reference_modelling': structure.reference_modelling(), 'mappings': self.mappings(),
                'method': tables.IMPORT_METHOD,
                'supported_voltages': [{'u0_v': a, 'u_v': b} for a, b in ((600, 1000), (3600, 6000), (8700, 15000), (26000, 35000), (64000, 110000), (127000, 220000))],
                'limitations': ['支持保存各电压级真实表列事实；完整建模与计算按方法适用范围检查。', '资料缺项可以保留，但不能计算或批准为完整工程型号。']}

    def upload(self, filename, content):
        parsed = tables.read(filename, content)
        identifier = str(uuid4())
        with self.store.db(True) as db:
            db.execute('INSERT INTO type_table_uploads VALUES(?,?,?,?,?)',
                       (identifier, parsed['file'], parsed['sha256'], content, stamp()))
        result = {'upload_id': identifier, **tables.inspect(parsed)}
        from .public_catalogues import match_sample
        declarations = match_sample(parsed['sha256'])
        if declarations:
            result['declarations'] = declarations
        return result

    def _upload(self, db, identifier):
        row = db.execute('SELECT * FROM type_table_uploads WHERE id=?', (str(identifier),)).fetchone()
        if row is None:
            tables.fail('TABLE_UPLOAD_UNKNOWN', '上传文件不存在，请重新选择。', 404)
        content = bytes(row['original'])
        if sha256(content).hexdigest() != row['digest']:
            tables.fail('TABLE_SOURCE_CHANGED', '原始文件摘要不一致，已拒绝使用。', 409)
        return tables.read(row['filename'], content)

    def preview(self, body):
        body = Preview.model_validate(body)
        with self.store.db() as db:
            upload = self._upload(db, body.upload_id)
        rows, skipped = tables.mapped_rows(upload, body.sheet, body.first_data_row, body.mapping)
        declaration = body.series.model_dump(mode='json', exclude_none=True)
        from .import_standards import preview_selection
        execution_standards = preview_selection(self.research, declaration['standards'])
        built = build_rows(upload, body.sheet, rows, declaration, body.mapping)
        if not built:
            tables.fail('TABLE_NO_ROWS', '没有可预览的规格行，请核对工作表、起始行和列映射。')
        payload = {'upload_id': str(body.upload_id), 'file': upload['file'], 'sha256': upload['sha256'],
                   'sheet': body.sheet, 'first_data_row': body.first_data_row, 'mapping': body.mapping, 'series': declaration,
                   'rows': built, 'skipped': skipped, 'method': tables.IMPORT_METHOD,
                   'execution_standards': execution_standards,
                   'valid_count': sum(r['status'] != 'error' for r in built),
                   'error_count': sum(r['status'] == 'error' for r in built),
                   'incomplete_count': sum(r['status'] == 'incomplete' for r in built)}
        digest, identifier = fingerprint(payload), str(uuid4())
        with self.store.db(True) as db:
            db.execute('INSERT INTO type_table_previews VALUES(?,?,?,?,?)', (identifier, str(body.upload_id), encoded(payload), digest, stamp()))
        return {'preview_id': identifier, 'preview_digest': digest, **payload}

    def _insert_spec(self, db, series_id, item, actor, request, execution_standards=None):
        spec_id, model_id = str(uuid4()), str(uuid4())
        payload = deepcopy(item['payload'])
        from .import_standards import confirmed_source
        source = confirmed_source(execution_standards or {})
        if source:
            payload.setdefault('sources', {})['/execution_standards'] = source
        digest = fingerprint(payload)
        db.execute('INSERT INTO domain_cable_models VALUES(?,?,?,?,?)',
                   (model_id, encoded(payload), digest, 'incomplete' if payload.get('specification') else 'draft', stamp()))
        workspace = self.types.create_type(NewType(request_id=uuid5(NAMESPACE_URL, str(request) + '/' + spec_id),
                    origin='library', name=item['name'][:80], resource_id=model_id, content_sha256=digest), actor, connection=db)
        db.execute('INSERT INTO type_series_specs VALUES(?,?,?)', (spec_id, series_id, item['key']))
        metadata = {key: deepcopy(value) for key, value in item.items() if key != 'payload'}
        metadata['source_model_digest'] = digest
        db.execute('INSERT INTO type_series_versions VALUES(?,?,?,?,?,?)',
                   (spec_id, 1, model_id, workspace['id'], encoded(metadata), stamp()))
        self._event(db, series_id, spec_id, 'imported', actor, {'model_id': model_id, 'workspace_id': workspace['id'], 'version': 1, 'digest': digest})
        return {'id': spec_id, 'name': item['name'], 'model_id': model_id, 'workspace_id': workspace['id'],
                'version': 1, 'content_sha256': digest, 'state': 'draft'}

    def commit(self, body, actor):
        body = Commit.model_validate(body)
        reviewer = self.types._human(actor)
        request = body.model_dump(mode='json')
        with self.lock, self.store.db(True) as db:
            replay = self._replay(db, body.request_id, request)
            if replay:
                return replay
            saved = db.execute('SELECT * FROM type_table_previews WHERE id=?', (str(body.preview_id),)).fetchone()
            if not saved:
                tables.fail('TABLE_PREVIEW_UNKNOWN', '预览不存在，请重新预览后确认。', 404)
            payload = json.loads(saved['payload'])
            if saved['digest'] != body.preview_digest or fingerprint(payload) != saved['digest']:
                tables.fail('TABLE_PREVIEW_CHANGED', '预览摘要已变化，请重新核对；未写入型号。', 409)
            upload = self._upload(db, payload['upload_id'])
            if upload['sha256'] != payload['sha256']:
                tables.fail('TABLE_SOURCE_CHANGED', '预览与原件不一致；未写入型号。', 409)
            from .import_standards import verify_selection
            verify_selection(self.research, payload.get('execution_standards'))
            if payload['error_count'] and not body.skip_errors:
                tables.fail('TABLE_ROWS_INVALID', '存在错误行；请修正原表，或明确选择跳过错误行后重新确认。')
            good = [row for row in payload['rows'] if row['status'] != 'error']
            if not good:
                tables.fail('TABLE_NO_VALID_ROWS', '没有可入库规格。')
            declaration = payload['series']
            validate_published_guidance(declaration.get('reference', {}))
            if db.execute('SELECT 1 FROM type_series WHERE name=?', (declaration['name'],)).fetchone():
                tables.fail('TYPE_SERIES_EXISTS', '同名系列已存在，请修改系列名称后重新预览。', 409)
            series_id = str(uuid4())
            db.execute('INSERT INTO type_series VALUES(?,?,?,?,?)', (series_id, declaration['name'], encoded(declaration), stamp(), reviewer))
            specs = [self._insert_spec(db, series_id, item, actor, body.request_id,
                                      payload.get('execution_standards')) for item in good]
            result = {'series_id': series_id, 'created': len(specs), 'specs': specs, 'preview_digest': body.preview_digest,
                      'skipped_rows': [r['row_number'] for r in payload['rows'] if r['status'] == 'error'],
                      'state': 'draft', 'message': '已保存为待核对草稿；未审核或发布任何工程型号。'}
            self._remember(db, body.request_id, request, result)
            self._event(db, series_id, None, 'import_confirmed', reviewer,
                        {'preview_digest': body.preview_digest, 'file_sha256': payload['sha256'], 'created': len(specs), 'skipped_rows': result['skipped_rows']})
            return result

    def _series(self, db, identifier):
        row = db.execute('SELECT * FROM type_series WHERE id=?', (str(identifier),)).fetchone()
        if not row:
            tables.fail('TYPE_SERIES_UNKNOWN', '系列不存在。', 404)
        declaration = json.loads(row['declaration'])
        validate_published_guidance(declaration.get('reference', {}))
        return dict(row), declaration

    def _spec(self, db, identifier, version=None):
        row = db.execute('SELECT * FROM type_series_specs WHERE id=?', (str(identifier),)).fetchone()
        if not row:
            tables.fail('TYPE_SPEC_UNKNOWN', '规格不存在。', 404)
        saved = db.execute('SELECT * FROM type_series_versions WHERE spec=? ' + ('AND version=? ' if version else '') + 'ORDER BY version DESC LIMIT 1',
                           (str(identifier), version) if version else (str(identifier),)).fetchone()
        if not saved:
            tables.fail('TYPE_VERSION_UNKNOWN', '规格版本不存在。', 404)
        candidate = candidates.read(db, saved['model'])
        metadata = json.loads(saved['metadata'])
        if candidate['digest'] != metadata['source_model_digest']:
            tables.fail('TYPE_MODEL_CHANGED', '规格与电缆型号版本摘要不一致。', 409)
        workspace, state = self.store.load(db, saved['workspace'], allow_domain=True)
        plan = db.execute('SELECT status FROM type_plans WHERE workspace=?', (saved['workspace'],)).fetchone()
        submission = db.execute('SELECT id,status,digest FROM type_submissions WHERE workspace=? ORDER BY rowid DESC LIMIT 1', (saved['workspace'],)).fetchone()
        status = submission['status'] if submission else plan['status'] if plan else 'draft'
        results = []
        for run in db.execute('SELECT id,study,status,input_digest,created FROM study_runs WHERE workspace=? ORDER BY created DESC', (saved['workspace'],)):
            results.append(dict(run))
        result = {**metadata, 'id': str(identifier), 'series_id': row['series'], 'key': row['spec_key'], 'name': candidate['payload']['name'],
                  'version': saved['version'], 'model_id': saved['model'], 'workspace_id': saved['workspace'],
                  'workspace_revision': workspace['revision'], 'content_sha256': candidate['digest'], 'state': status,
                  'submission': dict(submission) if submission else None, 'results': results}
        # Engineering edits are read from their ordinary workspace. Import cells
        # remain the original evidence, explicitly separate from the current draft.
        result['has_design_changes'] = fingerprint(state['domain']) != metadata.get('version_document_sha256', (state.get('type_creation') or {}).get('initial_document_sha256'))
        return result

    def series_list(self):
        with self.store.db() as db:
            items = []
            for row in db.execute('SELECT * FROM type_series ORDER BY created DESC'):
                declaration = json.loads(row['declaration'])
                validate_published_guidance(declaration.get('reference', {}))
                specs = [self._spec(db, item['id']) for item in db.execute('SELECT id FROM type_series_specs WHERE series=?', (row['id'],))]
                states = {name: sum(s['state'] == name for s in specs) for name in {s['state'] for s in specs}}
                items.append({'id': row['id'], **declaration, 'spec_count': len(specs), 'states': states})
            return {'items': items}

    def series_detail(self, identifier):
        with self.store.db() as db:
            row, declaration = self._series(db, identifier)
            specs = [self._spec(db, item['id']) for item in db.execute('SELECT id FROM type_series_specs WHERE series=? ORDER BY rowid', (str(identifier),))]
            return {'series': {'id': row['id'], **declaration, 'spec_count': len(specs)}, 'declaration': declaration, 'specs': specs}

    def spec_detail(self, identifier, version=None):
        with self.store.db() as db:
            spec = self._spec(db, identifier, version)
            versions = [self._spec(db, identifier, row['version']) for row in db.execute('SELECT version FROM type_series_versions WHERE spec=? ORDER BY version DESC', (str(identifier),))]
            events = [{**dict(row), 'detail': json.loads(row['detail'])} for row in db.execute('SELECT * FROM type_library_events WHERE spec=? ORDER BY created DESC', (str(identifier),))]
            return {'spec': spec, 'versions': versions, 'values': spec['values'], 'missing': spec['missing'], 'results': spec['results'], 'events': events}

    def revise(self, identifier, body, actor):
        """Snapshot the saved design through the ordinary Types branch operation."""
        self.types._human(actor)
        request = {**body.model_dump(mode='json'), 'spec_id': str(identifier)}
        with self.lock, self.store.db(True) as db:
            replay = self._replay(db, body.request_id, request)
            if replay:
                return replay
            current = self._spec(db, identifier)
            if (current['version'], current['workspace_revision']) != (body.expected_version, body.expected_revision):
                tables.fail('TYPE_VERSION_STALE', '规格或保存的设计已变化，请刷新后改版。', 409)
            _, state = self.store.load(db, current['workspace_id'], allow_domain=True)
            document = state['domain']
            if document['schema_version'] != 'cablesim.domain/1':
                tables.fail('TYPE_REVISION_INCOMPLETE', '请先在型号设计中补齐结构缺项并保存，再建立新版本。')
            cable = document['cable_types'][0]
            _, declaration = self._series(db, current['series_id'])
            if (len(cable['cores']) != declaration['cores'] or cable['rating']['u0'] != declaration['u0_v']
                    or cable['rating'].get('u') != declaration['u_v']
                    or abs(cable['cores'][0]['conductor']['nominal_area'] - current['area_m2']) > 1e-12):
                tables.fail('TYPE_REVISION_SERIES_MISMATCH', '改版须保留系列电压、芯数和规格截面；其他型号请另建系列。')
            from backend.domain.guards import pointer
            prefix = pointer('cable_types', cable['id'])
            sources = {('/cable_type' + key[len(prefix):] if key == prefix or key.startswith(prefix + '/') else key):
                       {**deepcopy(value), 'reviewed': False} for key, value in document['provenance'].items()}
            sources['/revision'] = {'kind': 'user', 'reviewed': False, 'reference': encoded({
                'method': {'name': '已保存型号改版', 'version': '1.0.0'}, 'confidence': 'reference',
                'from_model': current['model_id'], 'from_sha256': current['content_sha256'],
                'workspace_revision': body.expected_revision, 'note': body.note})}
            version, model_id = current['version'] + 1, str(uuid4())
            payload = candidates.CableModelVersion(name=current['name'], version=str(version),
                cable_type=cable, materials=document['materials'], sources=sources, confirmed=False).model_dump(mode='json')
            digest = fingerprint(payload)
            branch = self.types.branch(current['workspace_id'], Branch(expected_revision=body.expected_revision,
                request_id=body.request_id, name=(current['name'] + ' · 改版 ' + str(version))[:80]), connection=db)
            db.execute('INSERT INTO domain_cable_models VALUES(?,?,?,?,?)', (model_id, encoded(payload), digest, 'draft', stamp()))
            previous = db.execute('SELECT metadata FROM type_series_versions WHERE spec=? AND version=?',
                                  (str(identifier), current['version'])).fetchone()
            metadata = {**json.loads(previous['metadata']), 'source_model_digest': digest,
                        'version_note': body.note, 'parent_version': current['version'],
                        'version_document_sha256': fingerprint(document), 'missing': [], 'status': 'ready'}
            db.execute('INSERT INTO type_series_versions VALUES(?,?,?,?,?,?)',
                       (str(identifier), version, model_id, branch['workspace_id'], encoded(metadata), stamp()))
            result = {'spec_id': str(identifier), 'version': version, 'model_id': model_id,
                      'workspace_id': branch['workspace_id'], 'family_id': branch['family_id'],
                      'content_sha256': digest, 'state': 'draft', 'message': '已建立独立新版本草稿；旧版本和运行记录保留。'}
            self._remember(db, body.request_id, request, result)
            self._event(db, current['series_id'], str(identifier), 'revised', actor, {**result, 'note': body.note})
            return result

    def batch(self, identifier, body, actor):
        from .type_library_operations import run_batch
        return run_batch(self, str(identifier), Batch.model_validate(body), actor)


def make_router(service):
    router = APIRouter(prefix='/api/type-library', tags=['Series and structure tables'])

    @router.get('/vocabulary')
    def vocabulary():
        return service.vocabulary()

    @router.get('/mappings')
    def mappings():
        return service.mappings()

    @router.post('/mappings')
    def mapping(body: Mapping, x_cablesim_actor: str | None = Header(default=None)):
        return service.save_mapping(body, x_cablesim_actor)

    @router.post('/imports/upload', status_code=201)
    async def upload(file: UploadFile = File(...)):
        content = await file.read(tables.MAX_BYTES + 1)
        return service.upload(file.filename or '结构表', content)

    @router.post('/imports/preview')
    def preview(body: Preview):
        return service.preview(body)

    @router.post('/imports/commit', status_code=201)
    def commit(body: Commit, x_cablesim_actor: str | None = Header(default=None)):
        return service.commit(body, x_cablesim_actor)

    @router.get('/series')
    def series():
        return service.series_list()

    @router.get('/series/{identifier}')
    def series_detail(identifier: UUID):
        return service.series_detail(identifier)

    @router.get('/specs/{identifier}')
    def spec(identifier: UUID, version: int | None = None):
        return service.spec_detail(identifier, version)

    @router.post('/specs/{identifier}/revisions', status_code=201)
    def revise(identifier: UUID, body: Revise, x_cablesim_actor: str | None = Header(default=None)):
        return service.revise(identifier, body, x_cablesim_actor)

    @router.post('/series/{identifier}/batch')
    def batch(identifier: UUID, body: Batch, x_cablesim_actor: str | None = Header(default=None)):
        return service.batch(identifier, body, x_cablesim_actor)

    @router.get('/samples')
    def samples():
        from .public_catalogues import sample_manifest
        return sample_manifest()

    @router.get('/samples/{name}.xlsx')
    def sample_xlsx(name: str):
        from .public_catalogues import sample_bytes, SAMPLES
        if name not in SAMPLES:
            tables.fail('PUBLIC_SAMPLE_UNKNOWN', '公开样本不存在。', 404)
        return Response(sample_bytes(name, 'xlsx'), media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        headers={'Content-Disposition': f'attachment; filename="{name}.xlsx"'})

    @router.get('/samples/{name}.csv')
    def sample_csv(name: str, table: str | None = None):
        from .public_catalogues import sample_bytes, SAMPLES
        if name not in SAMPLES:
            tables.fail('PUBLIC_SAMPLE_UNKNOWN', '公开样本不存在。', 404)
        try:
            content = sample_bytes(name, 'csv', table)
        except ValueError as error:
            tables.fail('PUBLIC_SAMPLE_TABLE_UNKNOWN', str(error), 404)
        return Response(content, media_type='text/csv; charset=utf-8',
                        headers={'Content-Disposition': f'attachment; filename="{name}.csv"'})

    @router.post('/catalogue-comparison/{name}')
    def comparison(name: str, body: CatalogueComparison | None = None):
        from .catalogue_agreement import reference_report
        from .public_catalogues import SAMPLES
        if name not in SAMPLES:
            tables.fail('PUBLIC_SAMPLE_UNKNOWN', '公开样本不存在。', 404)
        return reference_report(name, reference_scenario_confirmed=bool(body and body.reference_scenario_confirmed))

    return router
