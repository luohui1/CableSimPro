"""Two-machine transport of real, explicitly scoped teaching publications.

All five source channels run the installed methods; no fabricated solver output,
receipt insertion, or patched method verification. Source binding uses the same
published model reader and lock-preserving attacher as existing version adoption.
The normal study catalogue does not yet list published Types releases.
"""
from copy import deepcopy
import importlib.util
import json
from hashlib import sha256
import os
from pathlib import Path
import sqlite3
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from backend.main import create_app
from backend.kernel.published_project_proof import MAX_PROOF_BYTES, RUN_EVIDENCE, SCHEMA
from backend.kernel.resource_exchange import MAX_BYTES, PROJECT_LIMIT, encoded, parse_file, workbook_bytes
from backend.kernel.scenarios import attach_model
from backend.kernel.version_status import latest_model
from backend.kernel.workspace import fingerprint
from frontend.scripts.engineering_resources import publish_resources
from test_type_release_scope import declare_actual_scope, real_teaching_parameters, run_release_modules
from test_type_versions import adopt, submit


HUMAN = {'X-CableSim-Actor': 'human'}


def ok(response, status=200):
    assert response.status_code == status, response.text[:2000]
    return response.json()


def publish(client, workspace, electrical, short):
    runs = run_release_modules(client, workspace, electrical, short)
    assert len(runs) == 5 and all(r['status'] == 'succeeded' and r['integrity'] == 'verified' for r in runs)
    declare_actual_scope(client, workspace)
    adopt(client, workspace)
    spec, submission = submit(client, workspace)
    body = {'request_id': str(uuid4()), 'submission_id': submission['submission_id'],
            'specification_digest': spec['digest']}
    ok(client.post('/api/types/' + workspace['id'] + '/approve', headers=HUMAN,
                   json={**body, 'human_confirmed': True}))
    result = ok(client.post('/api/types/' + workspace['id'] + '/publish', headers=HUMAN,
                           json={**body, 'request_id': str(uuid4())}))
    frozen = ok(client.get('/api/types/' + workspace['id'] + '/specification'))
    assert frozen['payload'] == spec['payload'] and frozen['digest'] == spec['digest']
    assert frozen['payload']['release_exclusions']  # Teaching limits remain visible.
    return result, frozen


@pytest.fixture(scope='module')
def published_exchange(tmp_path_factory):
    path = tmp_path_factory.mktemp('published-project-source') / 'source.sqlite'
    source = Path(__file__).resolve().parents[1] / 'frontend/scripts/seed-engineering-demo.py'
    definition = importlib.util.spec_from_file_location('published_project_seed', source)
    seed = importlib.util.module_from_spec(definition)
    definition.loader.exec_module(seed)
    with TestClient(create_app(path)) as client:
        def api(url, method='GET', body=None, headers=None):
            response = client.request(method, url, json=body, headers=headers or {})
            assert response.status_code < 300, response.text[:2000]
            return response.json()
        publish_resources(api)
        created = seed.release_teaching_mv_design(api)
        workspace = api('/api/workspaces/' + created['workspace'])
        workspace, electrical, short = real_teaching_parameters(client, workspace)
        # Bind a genuine already-published standard reference, without changing
        # any physical input. Both material and rule pins must survive transport.
        material = next(item for item in api('/api/foundation/assets?kind=material&limit=100')['items']
                        if item['asset_id'] == 'material/copper-conductor')
        api('/api/types/' + workspace['id'] + '/resources/bind', 'POST', {
            'expected_revision': workspace['revision'], 'request_id': str(uuid4()),
            'role': 'material', 'target_id': 'material/conductor', 'resource_id': material['id']})
        workspace = api('/api/workspaces/' + workspace['id'])
        first, frozen = publish(client, workspace, electrical, short)

        model = next(item for item in api('/api/design/cable-models')
                     if item['id'] == 'system.specification-yjv22-300')
        project = api('/api/design/study-workspaces', 'POST', {
            'model_id': model['id'], 'content_sha256': model['content_sha256'],
            'project_name': '已发布教学型号 · 固定旧版输入搬运'})
        store = client.app.state.workspace_store
        with store.db(True) as db:
            row, state = store.load(db, project['id'], project['revision'], allow_domain=True)
            published = latest_model(db, first['asset_reference'])
            attach_model(state, published, preserve_layout=True)
            store.commit(db, row, state, '交换验收：原生产绑定器引用真实发布版本')
        project = api('/api/workspaces/' + project['id'])

        branch = api('/api/types/' + workspace['id'] + '/plans', 'POST', {
            'expected_revision': workspace['revision'], 'request_id': str(uuid4()), 'name': '后续教学版本'})
        child = api('/api/workspaces/' + branch['workspace_id'])
        second, _ = publish(client, child, electrical, short)
        assert first['asset_reference']['id'] == second['asset_reference']['id']
        assert first['asset_reference']['content_sha256'] != second['asset_reference']['content_sha256']
        with store.db() as db:
            assert latest_model(db, first['asset_reference'])['version'] == second['asset_reference']['version']
        packages = {}
        for format in ('json', 'xlsx'):
            response = client.post('/api/library/exchange/export', json={
                'workspace_ids': [project['id']], 'format': format})
            assert response.status_code == 200, response.text[:2000]
            bundle = parse_file('published.' + format, response.content)
            packages[format] = {'bytes': response.content, 'bundle': bundle}
            proof = bundle['projects'][0]['inputs']['study_cable_reference']['source_snapshot']
            assert proof['schema'] == SCHEMA and proof['run_evidence'] == RUN_EVIDENCE
            assert proof['asset_sha256'] == first['asset_reference']['content_sha256']
            assert proof['specification'] == frozen['payload']
            assert proof['specification_sha256'] == frozen['digest'] == fingerprint(proof['specification'])
            assert proof['asset_sha256'] != proof['specification_sha256']
            assert 1 < len(proof['dependencies']) == len(bundle['assets'])
            assert PROJECT_LIMIT < len(encoded(proof)) <= MAX_PROOF_BYTES
            assert len(encoded(bundle)) <= MAX_BYTES
            assert api('/api/workspaces/' + project['id']) == project
        print('\npublished exchange capacity ' + json.dumps({
            'bundle_bytes': len(encoded(packages['json']['bundle'])),
            'proof_bytes': len(encoded(proof)), 'frozen_payload_bytes': len(encoded(proof['specification'])),
            'source_runs': len(proof['source_runs']), 'dependency_count': len(proof['dependencies'])}))
    # Source host is stopped before any import. Reopening it is not needed for
    # positive target tests, including their subsequent host restart/re-export.
    result = {'source': path, 'project': project, 'first': first, 'second': second, 'packages': packages}
    if output := os.environ.get('CABLESIM_PUBLISHED_EXCHANGE_EVIDENCE'):
        write_browser_source(result, Path(output))
    return result


def write_browser_source(saved, directory):
    """Explicit CI evidence output; default tests create no persistent sample."""
    from backend.kernel.database_ops import snapshot
    directory.mkdir(parents=True, exist_ok=False)
    database = directory / 'source.sqlite'
    receipt = snapshot(saved['source'], database)
    proof = saved['packages']['json']['bundle']['projects'][0]['inputs']['study_cable_reference']['source_snapshot']
    files = {}
    for format, package in saved['packages'].items():
        name = 'published.' + format
        (directory / name).write_bytes(package['bytes'])
        files[name] = {'sha256': sha256(package['bytes']).hexdigest(), 'bytes': len(package['bytes'])}
    with sqlite3.connect(database) as db:
        counts = {table: db.execute('SELECT COUNT(*) FROM ' + table).fetchone()[0]
                  for table in ('workspaces', 'studies', 'study_runs', 'engineering_type_releases')}
    manifest = {'schema': 'cablesim.published-exchange-browser-source/1',
        'database': str(database.resolve()), 'snapshot': receipt, 'source_host_closed': True,
        'project_id': saved['project']['id'], 'project_revision': saved['project']['revision'],
        'old_publication': {key: saved['first'][key] for key in ('asset_id', 'asset_reference', 'source_design')},
        'new_publication': {key: saved['second'][key] for key in ('asset_id', 'asset_reference', 'source_design')},
        'specification_sha256': proof['specification_sha256'], 'asset_sha256': proof['asset_sha256'],
        'source_run_count': len(proof['source_runs']), 'source_runs': proof['source_runs'],
        'dependencies': [{key: item[key] for key in ('origin_id', 'content_sha256')} | {
            'asset_id': item['release']['asset_id'], 'version': item['release']['version']} for item in proof['dependencies']],
        'bundle_bytes': len(encoded(saved['packages']['json']['bundle'])),
        'proof_bytes': len(encoded(proof)), 'proof_schema': SCHEMA, 'run_evidence': RUN_EVIDENCE,
        'counts': counts, 'files': files}
    (directory / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def upload(client, data, bundle, format, request_id=None):
    file = {'file': ('published.' + format, data)}
    preview = ok(client.post('/api/library/exchange/preview', files=file))
    assert preview['approval_inherited'] is False
    proof = bundle['projects'][0]['inputs']['study_cable_reference']['source_snapshot']
    evidence = preview['projects'][0]['published_model']
    assert evidence['version'] == proof['origin']['version']
    assert evidence['asset_sha256'] == proof['asset_sha256']
    assert evidence['specification_sha256'] == proof['specification_sha256']
    assert evidence['run_evidence'] == RUN_EVIDENCE and evidence['approval_inherited'] is False
    body = {'reviewed_sha256': bundle['sha256'], 'confirmed': 'true',
            'request_id': request_id or str(uuid4())}
    return ok(client.post('/api/library/exchange/import', files=file, data=body, headers=HUMAN), 201)


@pytest.mark.parametrize('format', ['json', 'xlsx'])
def test_real_published_old_version_roundtrip_after_source_stop_and_target_restart(published_exchange, tmp_path, format):
    saved = published_exchange
    package = saved['packages'][format]
    inputs = package['bundle']['projects'][0]['inputs']
    path = tmp_path / 'target.sqlite'
    with TestClient(create_app(path)) as target:
        request_id = str(uuid4())
        receipt = upload(target, package['bytes'], package['bundle'], format, request_id)
        assert upload(target, package['bytes'], package['bundle'], format, request_id) == receipt
        identifier = receipt['projects'][0]['id']
        assert identifier != saved['project']['id']
        copied = ok(target.get('/api/workspaces/' + identifier))
        assert copied['revision'] == 1 and copied['exchange_origin']['approval_inherited'] is False
        assert all(copied[key] == value for key, value in inputs.items())
        assert copied['study_cable_reference']['id'].startswith('exchange-model:')
        assert copied['study_cable_reference']['state'] == 'draft'
        for asset in receipt['assets']:
            item = ok(target.get('/api/foundation/assets/' + asset['id']))
            assert item['status'] == 'draft' and item['reviewed_sha256'] is None
        assert ok(target.get('/api/types/library'))['items'] == []
        assert ok(target.get('/api/workspaces/' + identifier + '/studies')) == [] and copied['runs'] == []
        with target.app.state.workspace_store.db() as db:
            assert all(db.execute('SELECT COUNT(*) FROM ' + table).fetchone()[0] == 0 for table in
                       ('studies', 'study_runs', 'type_submissions', 'engineering_type_releases'))
    with TestClient(create_app(path)) as target:
        copied = ok(target.get('/api/workspaces/' + identifier))
        assert all(copied[key] == value for key, value in inputs.items())
        response = target.post('/api/library/exchange/export', json={'workspace_ids': [identifier], 'format': format})
        assert response.status_code == 200, response.text[:2000]
        again = parse_file('published.' + format, response.content)
        assert again['projects'][0]['inputs'] == inputs
        assert again['projects'][0]['inputs']['study_cable_reference']['source_snapshot']['run_evidence'] == RUN_EVIDENCE
        changed = deepcopy(copied['domain'])
        changed['cable_types'][0]['cores'][0]['conductor']['r20'] *= 1.01
        refusal = target.put('/api/workspaces/' + identifier + '/domain', json={
            'expected_revision': copied['revision'], 'document': changed})
        assert refusal.status_code == 422, refusal.text
        assert ok(target.get('/api/workspaces/' + identifier)) == copied


def rehash(bundle):
    for project in bundle['projects']:
        project['input_sha256'] = fingerprint(project['inputs'])
    bundle['sha256'] = fingerprint({key: value for key, value in bundle.items() if key != 'sha256'})
    return encoded(bundle)


def empty(client):
    assert ok(client.get('/api/workspaces')) == []
    assert ok(client.get('/api/types/library'))['items'] == []
    assert ok(client.get('/api/foundation/assets'))['total'] == 0


def refuse(client, bundle, status, code, *, data=None):
    wire = data if data is not None else rehash(bundle)
    for endpoint in ('preview', 'import'):
        response = client.post('/api/library/exchange/' + endpoint,
            files={'file': ('published.json', wire)}, headers=HUMAN,
            data={'reviewed_sha256': bundle['sha256'], 'confirmed': 'true', 'request_id': str(uuid4())})
        assert response.status_code == status, (endpoint, response.text[:1000])
        assert response.json()['detail']['code'] == code, response.text[:1000]


def test_rehashed_published_proof_tampering_never_partially_imports(published_exchange, tmp_path):
    original = published_exchange['packages']['json']['bundle']
    changes = ('asset_digest', 'specification_value', 'specification_digest', 'specification_missing_results', 'approval_relation',
               'dependency_missing', 'dependency_value', 'run_method', 'projection', 'projection_bool',
               'local_identity', 'approval_inherited', 'method_defaults', 'origin_submission', 'source_kind')
    with TestClient(create_app(tmp_path / 'rejected.sqlite')) as target:
        for change in changes:
            bundle = deepcopy(original)
            binding = bundle['projects'][0]['inputs']['study_cable_reference']
            proof = binding['source_snapshot']
            if change == 'asset_digest':
                proof['asset_sha256'] = fingerprint(binding['payload'])
            elif change == 'specification_value':
                proof['specification']['document']['cable_types'][0]['cores'][0]['conductor']['r20'] *= 1.01
            elif change == 'specification_digest':
                proof['specification_sha256'] = 'a' * 64
            elif change == 'specification_missing_results':
                proof['specification'].pop('results')
                proof['specification_sha256'] = fingerprint(proof['specification'])
            elif change == 'approval_relation':
                proof['approval']['workspace_revision'] += 1
                proof['approval']['receipt_digest'] = fingerprint({k: v for k, v in proof['approval'].items() if k != 'receipt_digest'})
            elif change == 'dependency_missing':
                proof['dependencies'].pop()
            elif change == 'dependency_value':
                proof['dependencies'][0]['release']['name'] += ' changed'
            elif change == 'run_method':
                proof['source_runs'][0]['method']['version'] = '999.0.0'
            elif change.startswith('projection'):
                conductor = binding['payload']['cable_type']['cores'][0]['conductor']
                if change == 'projection_bool':
                    binding['payload']['cable_type']['cores'][0]['x'] = False
                else:
                    conductor['r20'] *= 1.01
            elif change == 'local_identity':
                binding['id'] = proof['origin']['family']
            elif change == 'approval_inherited':
                binding['state'] = 'reviewed'
            elif change == 'method_defaults':
                binding['method_defaults'] = {}
            elif change == 'origin_submission':
                proof['origin']['submission'] = str(uuid4())
            else:
                proof['kind'] = 'candidate'
            refuse(target, bundle, 422, 'EXCHANGE_PUBLISHED_MODEL_PROOF')
            empty(target)


def test_complete_proof_does_not_bypass_input_bundle_or_dependency_limits(published_exchange, tmp_path):
    original = published_exchange['packages']['json']['bundle']
    with TestClient(create_app(tmp_path / 'limits.sqlite')) as target:
        missing = deepcopy(original)
        missing['assets'] = []
        refuse(target, missing, 409, 'EXCHANGE_DEPENDENCY')
        empty(target)
        oversized = deepcopy(original)
        oversized['projects'][0]['inputs']['sources'].append({'reference': 'x' * PROJECT_LIMIT})
        # The HTTP file ceiling is independently checked before decoding.
        refuse(target, oversized, 413, 'EXCHANGE_TOO_LARGE')
        empty(target)
        # A 1 MiB ordinary input cannot hide behind a valid 8 MiB proof budget.
        from backend.kernel.resource_exchange import _project_inputs
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as error:
            _project_inputs(oversized['projects'][0]['inputs'])
        assert error.value.status_code == 413 and error.value.detail['code'] == 'EXCHANGE_PROJECT_TOO_LARGE'


def test_dependency_same_version_conflict_preserves_existing_data(published_exchange, tmp_path):
    original = published_exchange['packages']['json']['bundle']
    with TestClient(create_app(tmp_path / 'conflict.sqlite')) as target:
        release = deepcopy(original['assets'][0]['release'])
        release['name'] += ' 本机不同内容'
        existing = ok(target.post('/api/foundation/assets/import', json={'release': release}), 201)
        refuse(target, deepcopy(original), 409, 'EXCHANGE_VERSION_CONFLICT')
        assert ok(target.get('/api/foundation/assets/' + existing['id'])) == existing
        assert ok(target.get('/api/foundation/assets'))['total'] == 1
        assert ok(target.get('/api/workspaces')) == []


def copy_database(source, target):
    with sqlite3.connect(source) as original, sqlite3.connect(target) as copied:
        original.backup(copied)


def test_published_source_with_explicit_null_proof_exports_the_same_fixed_identity(published_exchange, tmp_path):
    saved = published_exchange
    path = tmp_path / 'null-proof-source.sqlite'
    copy_database(saved['source'], path)
    with TestClient(create_app(path)) as source:
        store = source.app.state.workspace_store
        with store.db(True) as db:
            row, state = store.load(db, saved['project']['id'], allow_domain=True)
            state['study_cable_reference']['source_snapshot'] = None
            store.commit(db, row, state, '旧绑定明确保存空来源快照')
        before = ok(source.get('/api/workspaces/' + saved['project']['id']))
        response = source.post('/api/library/exchange/export', json={'workspace_ids': [saved['project']['id']]})
        assert response.status_code == 200, response.text[:1000]
        exported = parse_file('published.json', response.content)
        assert exported['projects'][0]['inputs'] == saved['packages']['json']['bundle']['projects'][0]['inputs']
        assert ok(source.get('/api/workspaces/' + saved['project']['id'])) == before


def test_source_integrity_and_existing_local_run_conflicts_are_not_downgraded(published_exchange, tmp_path):
    saved = published_exchange
    proof = saved['packages']['json']['bundle']['projects'][0]['inputs']['study_cable_reference']['source_snapshot']
    path = tmp_path / 'source-copy.sqlite'
    copy_database(saved['source'], path)
    with TestClient(create_app(path)) as source:
        store = source.app.state.workspace_store
        with store.db(True) as db:
            run = db.execute('SELECT * FROM study_runs WHERE id=?', (proof['source_runs'][0]['run_id'],)).fetchone()
            db.execute('UPDATE study_runs SET output_digest=? WHERE id=?', ('f' * 64, run['id']))
        response = source.post('/api/library/exchange/export', json={'workspace_ids': [saved['project']['id']]})
        assert response.status_code == 409, response.text[:1000]
        # The same ID exists locally with corrupt content: import cannot call it
        # an unavailable external run and bypass its actual verification.
        before = ok(source.get('/api/workspaces'))
        refuse(source, deepcopy(saved['packages']['json']['bundle']), 409, 'EXCHANGE_PUBLISHED_RUN_CONFLICT')
        assert ok(source.get('/api/workspaces')) == before


def test_local_release_conflict_and_large_export_do_not_change_the_source(published_exchange, tmp_path):
    saved = published_exchange
    package = saved['packages']['json']
    path = tmp_path / 'collision.sqlite'
    copy_database(saved['source'], path)
    with TestClient(create_app(path)) as source:
        # Import a second independent copy through the normal human API. Both
        # complete, valid projects together exceed the unchanged 8 MiB ceiling.
        receipt = upload(source, package['bytes'], package['bundle'], 'json')
        before = ok(source.get('/api/workspaces'))
        response = source.post('/api/library/exchange/export', json={
            'workspace_ids': [saved['project']['id'], receipt['projects'][0]['id']]})
        assert response.status_code == 413 and response.json()['detail']['code'] == 'EXCHANGE_TOO_LARGE'
        assert ok(source.get('/api/workspaces')) == before
        proof = package['bundle']['projects'][0]['inputs']['study_cable_reference']['source_snapshot']
        with source.app.state.workspace_store.db(True) as db:
            db.execute('UPDATE engineering_type_releases SET sequence=sequence+100 WHERE asset=?',
                       (proof['origin']['asset'],))
        # Even identical payload hashes do not excuse a conflicting local
        # release record. Check before inserting another draft or project.
        refuse(source, deepcopy(package['bundle']), 409, 'EXCHANGE_PUBLISHED_MODEL_CONFLICT')
        assert ok(source.get('/api/workspaces')) == before
