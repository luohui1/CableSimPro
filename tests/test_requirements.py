"""Human review persistence, CAS, idempotency and definition changes."""
from copy import deepcopy
import json
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from backend.main import create_app
from backend.kernel.requirements import make_router as requirements_router
from backend.kernel.workspace import fingerprint
from backend.kernel.scenarios import make_router as design_router


@pytest.fixture
def review_context(tmp_path):
    app = create_app(tmp_path / 'requirements.sqlite')
    app.include_router(design_router(app.state.workspace_store))
    app.include_router(requirements_router(app.state.research))
    fallback = next(r for r in app.router.routes if getattr(r, 'path', '') == '/api/{path:path}')
    app.router.routes.remove(fallback)
    app.router.routes.append(fallback)
    with TestClient(app) as client:
        model = client.get('/api/design/cable-models').json()[0]
        workspace = client.post('/api/design/type-workspaces', json={'model_id': model['id'], 'content_sha256': model['content_sha256']}).json()
        case = json.loads((Path(__file__).parent / 'fixtures/standard_check_cases.json').read_text('utf-8'))[0]
        root = '/api/workspaces/' + workspace['id']
        saved = client.put(root + '/domain', json={'document': case['input'], 'expected_revision': workspace['revision']}).json()
        method = next(m['method'] for m in client.get('/api/methods').json() if m['method']['plugin_id'] == 'cablesim.standard-check')
        def calculate():
            current = client.get(root).json()
            study = client.post(root + '/studies', json={'title': '审批验证', 'input_source': 'domain', 'method': {**method, 'capability': 'dimensions'}, 'parameters': case['parameters'], 'expected_revision': current['revision']}).json()
            sr = root + '/studies/' + study['id']
            check = client.get(sr + '/preflight', params={'expected_revision': current['revision'], 'expected_study_revision': study['revision']}).json()
            assert check['ready']
            result = client.post(sr + '/runs', json={'request_id': str(uuid4()), 'expected_revision': current['revision'], 'expected_study_revision': study['revision'], 'lock_digest': check['lock_digest'], 'scope_acknowledged': True})
            assert result.status_code == 200, result.text
            return result.json()
        run = calculate()
        route = '/api/design/type-workspaces/' + workspace['id'] + '/requirements'
        yield client, app.state.workspace_store, root, route, case['input'], run, calculate


def command(client, route, run, rows):
    catalog = client.get(route, params={'run_id': run['id']}).json()
    return {'request_id': str(uuid4()), 'run_id': run['id'], 'row_ids': rows,
            'expected_workspace_revision': run['snapshot']['workspace_revision'],
            'expected_requirements_revision': catalog['revision'], 'reviewer': '测试工程师', 'human_confirmed': True}


def rows(run):
    return run['output']['cases'][0]['artifacts']['x-cablesim.standard-check']['rows']


def test_review_is_persistent_idempotent_and_does_not_change_model_or_run(review_context):
    client, store, root, route, document, run, _ = review_context
    body = command(client, route, run, [rows(run)[1]['id']])
    response = client.post(route + '/reviews', json=body)
    assert response.status_code == 201, response.text
    receipt = response.json()
    assert client.post(route + '/reviews', json=body).json() == receipt
    assert client.get(root).json()['revision'] == run['snapshot']['workspace_revision']
    saved = client.get(root + '/studies/' + run['study'] + '/runs/' + run['id'], params={'view': 'full'}).json()
    assert saved['output'] == run['output'] and saved['freshness'] == 'current'
    catalog = client.get(route, params={'run_id': run['id']}).json()
    assert catalog['revision'] == 1 and catalog['approved_count'] == 1
    assert catalog['items'][1]['approval']['reviewer'] == '测试工程师'
    with store.db() as db:
        assert db.execute('SELECT COUNT(*) FROM requirement_reviews').fetchone()[0] == 1
    changed = deepcopy(body)
    changed['reviewer'] = '另一审批人'
    assert client.post(route + '/reviews', json=changed).status_code == 409


def test_explicit_human_confirmation_unbound_rows_and_approval_cas(review_context):
    client, _, _, route, _, run, _ = review_context
    valid = command(client, route, run, [rows(run)[1]['id']])
    assert client.post(route + '/reviews', json={**valid, 'human_confirmed': False}).status_code == 422
    assert client.post(route + '/reviews', json={**valid, 'reviewer': ' '}).status_code == 422
    unbound = next(r['id'] for r in rows(run) if r['verdict'] == 'uncovered')
    assert client.post(route + '/reviews', json={**valid, 'row_ids': [unbound]}).status_code == 422
    assert client.get(route, params={'run_id': run['id']}).json()['revision'] == 0
    assert client.post(route + '/reviews', json=valid).status_code == 201
    assert client.post(route + '/reviews', json={**valid, 'request_id': str(uuid4())}).status_code == 409


def test_changed_definition_conflicts_but_measurements_and_array_order_do_not(review_context):
    client, _, root, route, document, run, calculate = review_context
    minimum = next(r for r in rows(run) if r['id'].endswith(':insulation-minimum'))
    body = command(client, route, run, [minimum['id']])
    assert client.post(route + '/reviews', json=body).status_code == 201
    # The definition is bound to the stable core ID, not its array position.
    changed = deepcopy(document)
    changed['cable_types'][0]['cores'].reverse()
    changed['cable_types'][0]['cores'][-1]['layers'][0]['minimum_thickness'] = .004
    revision = client.get(root).json()['revision']
    assert client.put(root + '/domain', json={'document': changed, 'expected_revision': revision}).status_code == 200
    reordered = calculate()
    catalog = client.get(route, params={'run_id': reordered['id']}).json()
    approved = next(p for p in catalog['items'] if p['id'] == 'requirement/' + fingerprint({'rule': 'insulation-minimum', 'target': minimum['target'], 'standard': minimum['standard'], 'clause': minimum['clause']}))
    assert approved['state'] == 'approved'
    assert client.post(route + '/reviews', json={**body, 'request_id': str(uuid4())}).status_code == 409
    changed['cable_types'][0]['cores'][-1]['layers'][0]['thickness'] = .005
    for core in changed['cable_types'][0]['cores']:
        core['x'] *= 1.2
        core['z'] *= 1.2
    revision = client.get(root).json()['revision']
    assert client.put(root + '/domain', json={'document': changed, 'expected_revision': revision}).status_code == 200
    next_run = calculate()
    next_catalog = client.get(route, params={'run_id': next_run['id']}).json()
    conflict = next(p for p in next_catalog['items'] if p['id'] == approved['id'])
    assert conflict['state'] == 'conflict'
    assert conflict['definition']['limit'] == 4.4
    assert conflict['approval']['definition']['limit'] == 3.95


def test_receipt_corruption_is_not_displayed_as_approval(review_context):
    client, store, _, route, _, run, _ = review_context
    body = command(client, route, run, [rows(run)[1]['id']])
    assert client.post(route + '/reviews', json=body).status_code == 201
    with store.db(True) as db:
        db.execute("UPDATE requirement_reviews SET receipt='{}'")
    assert client.get(route, params={'run_id': run['id']}).status_code == 409
