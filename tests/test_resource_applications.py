"""Frozen references use fresh release data and the real IEC saved-study lane.

The public structures and declared research conditions come from seed_release;
no plugin, preflight, input, result or identity is replaced by a solver fixture.
Fault injection below only damages copies to check refusal and atomicity.
"""
from copy import deepcopy
from hashlib import sha256
import importlib.util
import json
from pathlib import Path
from time import monotonic, sleep
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend.domain.guards import pointer
from backend.foundation.contracts import AssetRelease, content_hash
from backend.kernel.workspace import fingerprint
from backend.main import create_app


HUMAN = {'X-CableSim-Actor': 'human'}
PREFIX = '/api/library/resources'


def ok(response, code=200):
    assert response.status_code == code, response.text
    return response.json()


@pytest.fixture(scope='module')
def release_client(tmp_path_factory, release_seed_copy):
    root = tmp_path_factory.mktemp('resource-applications')
    path = Path(__file__).resolve().parents[1] / 'frontend/scripts/seed-engineering-demo.py'
    spec = importlib.util.spec_from_file_location('resource_application_release_seed', path)
    seed = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(seed)
    source_path = release_seed_copy(seed, root / 'source' / 'engineering.sqlite')
    with pytest.MonkeyPatch.context() as env:
        env.setenv('CABLESIM_DATASETS_DIR', str(root / 'datasets'))
        env.setenv('CABLESIM_REPRODUCTION_LIBRARY', str(root / 'source' / 'library'))
        with TestClient(create_app(source_path)) as client:
            yield client


@pytest.fixture
def target_client(tmp_path):
    with TestClient(create_app(tmp_path / 'independent.sqlite')) as client:
        yield client


def source_type(client, name='YJV22-8.7/15 3×300'):
    items = ok(client.get('/api/design/type-workspaces'))
    for item in items:
        if item['name'] == name:
            workspace = ok(client.get('/api/workspaces/' + item['id']))
            if not workspace.get('type_plan_source') and not workspace.get('exchange_origin'):
                return workspace
    pytest.fail('Required actual release type is missing: ' + name)


def source_study(client):
    projects = ok(client.get('/api/index/objects', params={'kind': 'project', 'limit': 100}))['items']
    for item in projects:
        if item['name'] != '城南线路 · 110 kV 直埋单回':
            continue
        workspace = ok(client.get('/api/workspaces/' + item['id']))
        if workspace.get('exchange_origin'):
            continue
        studies = ok(client.get('/api/workspaces/' + item['id'] + '/studies'))
        study = next(s for s in studies if s['definition']['title'] == '城南线路 · 110 kV 直埋单回校核')
        runs = ok(client.get(f"/api/workspaces/{item['id']}/studies/{study['id']}/runs", params={'limit': 100}))['items']
        run = next(r for r in reversed(runs) if r['status'] == 'succeeded' and r['integrity'] == 'verified'
                   and r['freshness'] == 'current' and r['snapshot'].get('module') is None)
        return workspace, study, run
    pytest.fail('Required actual release IEC study is missing')


def selection(workspace, part, *, core=0):
    cable = workspace['domain']['cable_types'][0]
    selected = {'cable_type_id': cable['id'], 'part': part, 'core_id': None, 'layer_index': None}
    if part != 'common_layer':
        selected['core_id'] = cable['cores'][core]['id']
    if part == 'core_layer':
        selected['layer_index'] = next(i for i, item in enumerate(cable['cores'][core]['layers']) if item['role'] == 'insulation')
    if part == 'common_layer':
        selected['layer_index'] = next(i for i, item in enumerate(cable['common_layers']) if item['role'] == 'oversheath')
    return selected


def capture_request(client, kind='component', *, workspace=None, part='conductor'):
    base = {'asset_id': 'test.frozen.' + uuid4().hex, 'name': '真实保存输入参考', 'version': '1.0.0'}
    if kind == 'component':
        workspace = workspace or source_type(client)
        base.update(selection=selection(workspace, part))
    else:
        workspace, study, run = source_study(client)
        base.update(study_id=study['id'], expected_study_revision=study['revision'], source_run_id=run['id'])
    return {**base, 'workspace_id': workspace['id'], 'expected_revision': workspace['revision']}


def capture(client, kind='component', **kwargs):
    route = PREFIX + ('/components' if kind == 'component' else '/study-templates')
    body = capture_request(client, kind, **kwargs)
    preview = ok(client.post(route + '/capture-preview', json=body))
    assert preview['persisted'] is False and preview['approval'] == 'not_granted'
    assert preview['trust']['grade'] == 'reference'
    for item in preview['fields']:
        if type(item['value']) in (int, float):
            assert item['unit'] and item['source']['reference'], item
    asset = ok(client.post(route + '/capture', json={**body,
        'preview_digest': preview['preview_digest'], 'human_confirmed': True}, headers=HUMAN), 201)
    assert asset['status'] == 'draft' and asset['release'] == preview['release']
    return asset, preview


def publish(client, asset):
    for action in ('review', 'publish'):
        asset = ok(client.post('/api/foundation/assets/' + asset['id'] + '/transition', json={
            'expected_revision': asset['revision'], 'content_sha256': asset['content_sha256'],
            'action': action, 'note': '逐字段核对来源、方法与限值口径；仅保存输入参考，未批准目标。',
            'acknowledge_sources': True, 'human_confirmed': True}, headers=HUMAN))
    return asset


def branch(client, original):
    value = ok(client.post('/api/types/' + original['id'] + '/plans', json={
        'expected_revision': original['revision'], 'request_id': str(uuid4()), 'name': '独立参考采用方案'}), 201)
    return ok(client.get('/api/workspaces/' + value['workspace_id']))


def exchange(source, target, *, asset=None, workspace=None, format='json'):
    exported = source.post('/api/library/exchange/export', json={
        'asset_ids': [asset['id']] if asset else [], 'workspace_ids': [workspace['id']] if workspace else [], 'format': format})
    assert exported.status_code == 200, exported.text
    assert sha256(exported.content).hexdigest() == exported.headers['x-content-sha256']
    file = {'file': ('references.' + format, exported.content)}
    preview = ok(target.post('/api/library/exchange/preview', files=file))
    receipt = ok(target.post('/api/library/exchange/import', files=file, headers=HUMAN, data={
        'reviewed_sha256': preview['sha256'], 'confirmed': 'true', 'request_id': str(uuid4())}), 201)
    copied_asset = None
    if asset:
        identity = next(item['id'] for item in receipt['assets'] if item['origin_id'] == asset['id'])
        copied_asset = ok(target.get('/api/foundation/assets/' + identity))
    copied_workspace = (ok(target.get('/api/workspaces/' + receipt['projects'][0]['id'])) if workspace else None)
    return copied_asset, copied_workspace


def target_request(asset, workspace):
    return {'resource_id': asset['id'], 'content_sha256': asset['content_sha256'],
            'workspace_id': workspace['id'], 'expected_revision': workspace['revision']}


def adopt_request(body, preview):
    return {**body, 'preview_digest': preview['preview_digest'], 'request_id': str(uuid4()),
            'human_confirmed': True, 'acknowledge_reference_limits': True}


def run_study(client, workspace, study):
    prefix = f"/api/workspaces/{workspace['id']}/studies/{study['id']}"
    check = ok(client.get(prefix + '/preflight', params={
        'expected_revision': workspace['revision'], 'expected_study_revision': study['revision']}))
    assert check['ready'] and not check['partial'], check
    response = client.post(prefix + '/runs', json={
        'expected_revision': workspace['revision'], 'expected_study_revision': study['revision'],
        'request_id': str(uuid4()), 'scope_acknowledged': True, 'lock_digest': check['lock_digest']})
    assert response.status_code in (200, 202), response.text
    run = response.json()
    deadline = monotonic() + 120
    while run['status'] in ('accepted', 'running', 'validating') and monotonic() < deadline:
        sleep(.05)
        run = ok(client.get(prefix + '/runs/' + run['id'], params={'view': 'full'}))
    assert run['status'] == 'succeeded' and run['integrity'] == 'verified' and run['freshness'] == 'current', run
    return run


@pytest.mark.parametrize('part', ['conductor', 'core_layer', 'common_layer'])
def test_real_component_adopts_only_selected_slot_and_undo(release_client, part):
    client = release_client
    source = source_type(client)
    original = deepcopy(source['domain'])
    asset, captured = capture(client, part=part)
    asset = publish(client, asset)
    if part == 'conductor':
        target = ok(client.post('/api/types', json={'origin': 'blank', 'construction': 'three_core',
            'name': '导体参考采用 · 缺项保持空白', 'request_id': str(uuid4())}), 201)
        material = 'material/adopted_copper'
    else:
        target = branch(client, source)
        material = captured['material']['id']
    before = deepcopy(target['domain'])
    slot = selection(target, part, core=1 if part == 'core_layer' else 0)
    body = {**target_request(asset, target), 'target': slot, 'target_material_id': material}
    preview = ok(client.post(PREFIX + '/components/preview', json=body))
    assert preview['selection'] == captured['selection']
    assert preview['material_action'] == ('create' if part == 'conductor' else 'reuse_identical')
    if part != 'conductor':
        assert all(c['source_action'] == 'unchanged' for c in preview['changes'] if c['path'].startswith('/materials/'))
    else:
        assert all(c['previous_source'] is None for c in preview['changes'] if c['path'].startswith('/materials/'))
    command = adopt_request(body, preview)
    adopted = ok(client.post(PREFIX + '/components/adopt', json=command, headers=HUMAN))
    assert adopted['revision'] == target['revision'] + 1
    assert ok(client.post(PREFIX + '/components/adopt', json=command, headers=HUMAN)) == adopted
    assert client.post(PREFIX + '/components/adopt', json={**command, 'target_material_id': 'material/other'}, headers=HUMAN).status_code == 409
    after = deepcopy(adopted['domain'])
    cable = after['cable_types'][0]
    if part == 'conductor':
        assert cable['cores'][0]['conductor'] == preview['proposed']['component']
        assert cable['cores'][0]['conductor']['r20_basis'] == captured['component']['r20_basis']
        assert any(c['after'] is None for c in preview['changes'])
        cable['cores'][0]['conductor'] = deepcopy(before['cable_types'][0]['cores'][0]['conductor'])
        after['materials'] = [m for m in after['materials'] if m['id'] != material]
    elif part == 'core_layer':
        cable['cores'][1]['layers'][slot['layer_index']] = deepcopy(before['cable_types'][0]['cores'][1]['layers'][slot['layer_index']])
    else:
        cable['common_layers'][slot['layer_index']] = deepcopy(before['cable_types'][0]['common_layers'][slot['layer_index']])
    after['provenance'] = before['provenance']
    assert after == before  # All unselected values, positions, environment and material facts are untouched.
    for change in preview['changes']:
        if change['source_action'] == 'replace':
            source_receipt = adopted['domain']['provenance'][change['path']]
            assert source_receipt['kind'] == 'asset' and source_receipt['reviewed'] is False
            assert json.loads(source_receipt['reference'])['field'] == change
    if part != 'conductor':
        for path, source_ref in before['provenance'].items():
            if path.startswith('/materials'):
                assert adopted['domain']['provenance'][path] == source_ref
    undone = ok(client.post('/api/workspaces/' + target['id'] + '/history/undo', json={'expected_revision': adopted['revision']}))
    assert undone['domain'] == before and undone['revision'] == adopted['revision'] + 1
    assert ok(client.get('/api/workspaces/' + source['id']))['domain'] == original


@pytest.mark.parametrize('format', ['json', 'xlsx'])
def test_real_study_exchange_adopts_saved_definition_then_explicitly_runs(release_client, target_client, format):
    source, target = release_client, target_client
    project, study, original_run = source_study(source)
    asset, captured = capture(source, 'study_template')
    asset = publish(source, asset)
    transferred, copied = exchange(source, target, asset=asset, workspace=project, format=format)
    assert transferred['release'] == asset['release'] and transferred['content_sha256'] == asset['content_sha256']
    assert transferred['status'] == 'draft' and transferred['reviewed_sha256'] is None
    assert copied['id'] != project['id'] and copied['revision'] == 1 and copied['domain'] == project['domain']
    assert ok(target.get('/api/workspaces/' + copied['id'] + '/studies')) == []
    transferred = publish(target, transferred)
    frozen = ok(target.get(PREFIX + '/applications/' + transferred['id'] + '/evidence'))
    assert frozen['source'] == captured['source'] and frozen['definition'] == study['definition']
    body = {**target_request(transferred, copied), 'title': '独立工程 · 明确采用固定研究输入', 'bindings': frozen['bindings']}
    preview = ok(target.post(PREFIX + '/study-templates/preview', json=body))
    assert preview['source_run_status'] == 'external_declared_run'
    assert preview['preflight']['ready'] and preview['run_started'] is False
    command = adopt_request(body, preview)
    adopted = ok(target.post(PREFIX + '/study-templates/adopt', json=command, headers=HUMAN), 201)
    assert ok(target.post(PREFIX + '/study-templates/adopt', json=command, headers=HUMAN), 201) == adopted
    assert adopted['run_started'] is False and adopted['approval'] == 'not_granted'
    current = ok(target.get('/api/workspaces/' + copied['id']))
    assert current['domain'] == copied['domain'] and current['revision'] == copied['revision']
    assert not current['runs']
    saved = adopted['study']
    assert saved['definition']['parameters'] == study['definition']['parameters']
    assert saved['definition']['method'] == study['definition']['method']
    assert len(ok(target.get('/api/workspaces/' + copied['id'] + '/studies'))) == 1
    assert ok(target.get(f"/api/workspaces/{copied['id']}/studies/{saved['id']}/runs"))['items'] == []
    executed = run_study(target, copied, saved)
    actual = [(case['case_id'], case['results']) for case in executed['output']['cases']]
    expected = [(case['case_id'], case['results']) for case in original_run['output']['cases']]
    assert actual == expected  # Same full saved input, same real IEC method, no copied result.
    assert executed['id'] != original_run['id']
    recapture_body = {'asset_id': 'test.recapture.' + uuid4().hex, 'name': '保留原采用链的固定研究', 'version': '1.0.0',
        'workspace_id': copied['id'], 'expected_revision': copied['revision'], 'study_id': saved['id'],
        'expected_study_revision': saved['revision'], 'source_run_id': executed['id']}
    recapture = ok(target.post(PREFIX + '/study-templates/capture-preview', json=recapture_body))
    recaptured = ok(target.post(PREFIX + '/study-templates/capture', json={**recapture_body,
        'preview_digest': recapture['preview_digest'], 'human_confirmed': True}, headers=HUMAN), 201)
    recaptured = publish(target, recaptured)
    next_body = {**target_request(recaptured, copied), 'title': '保留完整采用链的新研究', 'bindings': recapture['bindings']}
    next_preview = ok(target.post(PREFIX + '/study-templates/preview', json=next_body))
    assert next_preview['source_run_status'] == 'verified_local_run'
    receipt = json.loads(next_preview['definition']['input_sources']['/resource_application']['reference'])
    assert receipt['previous_application_source'] == saved['definition']['input_sources']['/resource_application']
    assert ok(source.get('/api/workspaces/' + project['id']))['domain'] == project['domain']


def test_actual_human_is_required_across_capture_and_existing_asset_lifecycle(release_client):
    client = release_client
    body = capture_request(client)
    preview = ok(client.post(PREFIX + '/components/capture-preview', json=body))
    command = {**body, 'preview_digest': preview['preview_digest'], 'human_confirmed': True}
    for headers in ({}, {'X-CableSim-Actor': 'agent'}):
        assert client.post(PREFIX + '/components/capture', json=command, headers=headers).status_code == 403
    for value in ('true', 1, False):
        assert client.post(PREFIX + '/components/capture', json={**command, 'human_confirmed': value}, headers=HUMAN).status_code == 422
    for value in ('true', 1):
        assert client.post('/api/foundation/assets/import', json={'release': preview['release'], 'human_confirmed': value}, headers=HUMAN).status_code == 422
    assert client.post('/api/foundation/assets/import', json={'release': preview['release'], 'human_confirmed': True}).status_code == 403
    asset = ok(client.post(PREFIX + '/components/capture', json=command, headers=HUMAN), 201)
    removed = deepcopy(asset['release']); removed.pop('application')
    assert client.put('/api/foundation/assets/' + asset['id'], json={
        'expected_revision': asset['revision'], 'release': removed}).status_code == 403
    transition = {'expected_revision': asset['revision'], 'content_sha256': asset['content_sha256'],
        'action': 'review', 'note': '明确输入参考核对', 'acknowledge_sources': True, 'human_confirmed': True}
    assert client.post('/api/foundation/assets/' + asset['id'] + '/transition', json=transition).status_code == 403
    assert ok(client.get('/api/foundation/assets/' + asset['id'])) == asset
    asset = publish(client, asset)
    derive = {'expected_revision': asset['revision'], 'content_sha256': asset['content_sha256'],
        'new_version': '1.0.1', 'human_confirmed': True}
    assert client.post('/api/foundation/assets/' + asset['id'] + '/derive', json=derive).status_code == 403
    derived = ok(client.post('/api/foundation/assets/' + asset['id'] + '/derive', json=derive, headers=HUMAN), 201)
    assert derived['status'] == 'draft' and derived['release']['application'] == asset['release']['application']


def test_component_compare_and_swap_digest_material_and_lock_guards_are_atomic(release_client):
    client = release_client
    source = source_type(client)
    asset, captured = capture(client)
    asset = publish(client, asset)
    target = branch(client, source)
    body = {**target_request(asset, target), 'target': selection(target, 'conductor'), 'target_material_id': 'material/new_reference'}
    preview = ok(client.post(PREFIX + '/components/preview', json=body))
    command = adopt_request(body, preview)
    for field in ('preview_digest', 'content_sha256'):
        assert client.post(PREFIX + '/components/adopt', json={**command, field: '0' * 64}, headers=HUMAN).status_code == 409
    for field in ('human_confirmed', 'acknowledge_reference_limits'):
        assert client.post(PREFIX + '/components/adopt', json={**command, field: 1}, headers=HUMAN).status_code == 422
    assert client.post(PREFIX + '/components/adopt', json=command).status_code == 403
    wrong_material = next(m['id'] for m in target['domain']['materials'] if m['category'] == 'insulation')
    refused = client.post(PREFIX + '/components/preview', json={**body, 'target_material_id': wrong_material})
    assert refused.status_code == 422 and refused.json()['detail']['code'] == 'RESOURCE_MATERIAL_CONFLICT'
    assert ok(client.get('/api/workspaces/' + target['id']))['domain'] == target['domain']
    selected = body['target']
    lock_path = pointer('cable_types', selected['cable_type_id'], 'cores', selected['core_id'], 'conductor', 'material')
    locked = ok(client.post('/api/workspaces/' + target['id'] + '/lock', json={
        'expected_revision': target['revision'], 'path': lock_path, 'locked': True}))
    assert client.post(PREFIX + '/components/adopt', json=command, headers=HUMAN).status_code == 409
    assert client.post(PREFIX + '/components/preview', json={**body, 'expected_revision': locked['revision']}).status_code == 422
    assert ok(client.get('/api/workspaces/' + target['id']))['domain'] == target['domain']
    assert captured['source']['document_sha256'] == fingerprint(source['domain'])
    # Real material data, independently versioned: deprecating it must block a
    # new reference even when the component's own digest remains unchanged.
    material_id = ok(client.get('/api/foundation/assets', params={'kind': 'material', 'status': 'published', 'limit': 1}))['items'][0]['id']
    material_release = ok(client.get('/api/foundation/assets/' + material_id))['release']
    material_release['asset_id'] = 'test.dependency.' + uuid4().hex
    dependency = publish(client, ok(client.post('/api/foundation/assets/import', json={
        'release': material_release, 'human_confirmed': True}, headers=HUMAN), 201))
    # The same pin reached first through A and then directly must still compare
    # the direct digest; graph de-duplication must not hide a conflicting pin.
    indirect_release = deepcopy(material_release); indirect_release['asset_id'] = 'test.indirect.' + uuid4().hex
    indirect_release['dependencies'].append({key: dependency[key] for key in ('asset_id', 'version', 'content_sha256')})
    indirect = publish(client, ok(client.post('/api/foundation/assets/import', json={
        'release': indirect_release, 'human_confirmed': True}, headers=HUMAN), 201))
    bad_graph = deepcopy(asset['release']); bad_graph['asset_id'] = 'test.badgraph.' + uuid4().hex
    bad_graph['dependencies'].extend([
        {key: indirect[key] for key in ('asset_id', 'version', 'content_sha256')},
        {key: ('0' * 64 if key == 'content_sha256' else dependency[key]) for key in ('asset_id', 'version', 'content_sha256')}])
    bad = ok(client.post('/api/foundation/assets/import', json={'release': bad_graph, 'human_confirmed': True}, headers=HUMAN), 201)
    assert any(item['code'] == 'ASSET_DEPENDENCY_DIGEST' for item in bad['issues'])
    assert client.post('/api/foundation/assets/' + bad['id'] + '/transition', json={
        'expected_revision': bad['revision'], 'content_sha256': bad['content_sha256'], 'action': 'review',
        'note': '复查双路依赖摘要冲突', 'acknowledge_sources': True, 'human_confirmed': True}, headers=HUMAN).status_code == 422
    release = deepcopy(asset['release']); release['asset_id'] = 'test.dependent.' + uuid4().hex
    release['dependencies'].append({key: dependency[key] for key in ('asset_id', 'version', 'content_sha256')})
    dependent = publish(client, ok(client.post('/api/foundation/assets/import', json={
        'release': release, 'human_confirmed': True}, headers=HUMAN), 201))
    ok(client.post('/api/foundation/assets/' + dependency['id'] + '/transition', json={
        'expected_revision': dependency['revision'], 'content_sha256': dependency['content_sha256'],
        'action': 'deprecate', 'note': '依赖废止负例，原始资料不变', 'human_confirmed': True}, headers=HUMAN))
    refused = client.post(PREFIX + '/components/preview', json={**body, 'expected_revision': locked['revision'],
        'resource_id': dependent['id'], 'content_sha256': dependent['content_sha256']})
    assert refused.status_code == 409 and refused.json()['detail']['code'] == 'RESOURCE_APPLICATION_NOT_PUBLISHED'


def test_frozen_evidence_never_rereads_current_source_and_source_missing_refuses(release_client):
    client = release_client
    source = branch(client, source_type(client))
    asset, captured = capture(client, workspace=source)
    before = ok(client.get(PREFIX + '/applications/' + asset['id'] + '/evidence'))
    document = deepcopy(source['domain']); document['name'] += ' · 后续修订'
    document['provenance'] = {}
    ok(client.put('/api/workspaces/' + source['id'] + '/domain', json={
        'expected_revision': source['revision'], 'document': document}))
    changed = ok(client.get('/api/workspaces/' + source['id']))
    assert changed['domain'] == document
    after = ok(client.get(PREFIX + '/applications/' + asset['id'] + '/evidence'))
    assert after == before and after['source']['snapshot']['domain'] == source['domain']
    refusal = client.post(PREFIX + '/components/capture-preview', json=capture_request(client, workspace=changed))
    assert refusal.status_code == 422 and refusal.json()['detail']['code'] == 'RESOURCE_COMPONENT_SOURCE_MISSING'
    assert captured['source']['revision'] == source['revision']


def test_study_current_run_bindings_and_existing_corruption_refuse(release_client):
    client = release_client
    source, study, run = source_study(client)
    request = capture_request(client, 'study_template')
    assert client.post(PREFIX + '/study-templates/capture-preview', json={**request, 'expected_study_revision': study['revision'] + 1}).status_code == 409
    assert client.post(PREFIX + '/study-templates/capture-preview', json={**request, 'source_run_id': str(uuid4())}).status_code == 404
    asset, frozen = capture(client, 'study_template')
    asset = publish(client, asset)
    _, target = exchange(client, client, workspace=source)
    body = {**target_request(asset, target), 'title': '同库固定研究输入', 'bindings': frozen['bindings']}
    preview = ok(client.post(PREFIX + '/study-templates/preview', json=body))
    assert preview['source_run_status'] == 'verified_local_run'
    missing_binding = deepcopy(body); missing_binding['bindings']['cable_ids'] = []
    assert client.post(PREFIX + '/study-templates/preview', json=missing_binding).status_code == 422
    changed_binding = deepcopy(body); changed_binding['bindings']['cable_ids'][0] = 'cable/undeclared'
    assert client.post(PREFIX + '/study-templates/preview', json=changed_binding).status_code == 422
    command = adopt_request(body, preview)
    assert client.post(PREFIX + '/study-templates/adopt', json={**command, 'preview_digest': '0' * 64}, headers=HUMAN).status_code == 409
    assert client.post(PREFIX + '/study-templates/adopt', json=command, headers={'X-CableSim-Actor': 'agent'}).status_code == 403
    store = client.app.state.workspace_store
    with store.db(True) as db:
        original = db.execute('SELECT output_digest FROM study_runs WHERE id=?', (run['id'],)).fetchone()['output_digest']
        db.execute('UPDATE study_runs SET output_digest=? WHERE id=?', ('0' * 64, run['id']))
    try:
        refused = client.post(PREFIX + '/study-templates/preview', json=body)
        assert refused.status_code == 409 and refused.json()['detail']['code'] == 'RESOURCE_SOURCE_RUN_CORRUPT'
        refused_capture = client.post(PREFIX + '/study-templates/capture-preview', json=request)
        assert refused_capture.status_code == 409
    finally:
        with store.db(True) as db:
            db.execute('UPDATE study_runs SET output_digest=? WHERE id=?', (original, run['id']))
    assert ok(client.get('/api/workspaces/' + target['id'] + '/studies')) == []
    assert ok(client.get('/api/workspaces/' + target['id']))['domain'] == target['domain']
    # Successful arithmetic is not a source-completeness certificate. Keep
    # every real physical value, remove only the sources in an independent copy,
    # then obtain a real new IEC run through the ordinary saved-study endpoints.
    unreferenced = deepcopy(target['domain']); unreferenced['provenance'] = {}
    ok(client.put('/api/workspaces/' + target['id'] + '/domain', json={
        'expected_revision': target['revision'], 'document': unreferenced}))
    unreferenced = ok(client.get('/api/workspaces/' + target['id']))
    assert unreferenced['domain']['provenance'] == {}
    saved = ok(client.post('/api/workspaces/' + target['id'] + '/studies', json={
        **study['definition'], 'expected_revision': unreferenced['revision'], 'title': '真实输入无领域出处拒绝用例'}), 201)
    rerun = run_study(client, unreferenced, saved)
    refusal = client.post(PREFIX + '/study-templates/capture-preview', json={
        'asset_id': 'test.no-source.' + uuid4().hex, 'version': '1.0.0', 'name': '无出处不捕获',
        'workspace_id': target['id'], 'expected_revision': unreferenced['revision'],
        'study_id': saved['id'], 'expected_study_revision': saved['revision'], 'source_run_id': rerun['id']})
    assert refusal.status_code == 422 and refusal.json()['detail']['code'] == 'RESOURCE_DOMAIN_SOURCE_MISSING'
    assert refusal.json()['detail']['fields']


def test_rehashed_payload_cannot_replace_frozen_facts_or_fill_study_defaults(release_client):
    client = release_client
    component, _ = capture(client)
    template, _ = capture(client, 'study_template')
    assert component['release']['dependencies']  # Actual seed bindings, never a dummy dependency.
    stripped = deepcopy(component['release']); stripped['asset_id'] = 'test.stripped.' + uuid4().hex
    stripped['dependencies'] = []
    replaced = deepcopy(component['release']); replaced['asset_id'] = 'test.replaced.' + uuid4().hex
    replaced['dependencies'][0]['content_sha256'] = '0' * 64
    for release in (stripped, replaced):
        refusal = client.post('/api/foundation/assets/import', json={'release': release, 'human_confirmed': True}, headers=HUMAN)
        assert refusal.status_code == 422 and 'RESOURCE_APPLICATION_DEPENDENCIES_MISMATCH' in refusal.text
    mutations = []
    changed = deepcopy(component['release']); changed['application']['payload']['component']['diameter'] *= 2
    mutations.append((changed, 'RESOURCE_COMPONENT_IDENTITY'))
    changed = deepcopy(component['release']); changed['application']['method']['version'] = '9.9.9'
    mutations.append((changed, 'RESOURCE_COMPONENT_IDENTITY'))
    changed = deepcopy(template['release']); changed['application']['payload']['definition'].pop('driver')
    mutations.append((changed, 'RESOURCE_STUDY_INCOMPLETE'))
    changed = deepcopy(template['release']); changed['application']['payload']['definition'].pop('input_source')
    mutations.append((changed, 'RESOURCE_STUDY_INCOMPLETE'))
    changed = deepcopy(template['release']); changed['application']['payload']['parameter_schema']['title'] = '替换参数契约'
    mutations.append((changed, 'RESOURCE_METHOD_CHANGED'))
    for digest in ('input_digest', 'output_digest'):
        changed = deepcopy(template['release']); changed['application']['source']['run_id'] = str(uuid4())
        changed['application']['source'][digest] = 'z' * 64
        mutations.append((changed, 'RESOURCE_STUDY_INCOMPLETE'))
    changed = deepcopy(template['release']); changed['application']['source']['snapshot']['domain']['provenance'] = {}
    changed['application']['source']['document_sha256'] = fingerprint(changed['application']['source']['snapshot']['domain'])
    changed['application']['source']['snapshot_sha256'] = fingerprint(changed['application']['source']['snapshot'])
    mutations.append((changed, 'RESOURCE_DOMAIN_SOURCE_MISSING'))
    for release, expected in mutations:
        release['asset_id'] = 'test.changed.' + uuid4().hex
        release['application']['payload_sha256'] = fingerprint(release['application']['payload'])
        asset = ok(client.post('/api/foundation/assets/import', json={'release': release, 'human_confirmed': True}, headers=HUMAN), 201)
        evidence = client.get(PREFIX + '/applications/' + asset['id'] + '/evidence')
        assert evidence.status_code in (409, 422), evidence.text
        assert evidence.json()['detail']['code'] == expected
    teaching = source_type(client, 'YJV22-8.7/15 3×240 · 完整护层教学草稿')
    refusal = client.post(PREFIX + '/components/capture-preview', json=capture_request(client, workspace=teaching, part='core_layer'))
    assert refusal.status_code == 422 and refusal.json()['detail']['code'] == 'RESOURCE_COMPONENT_OBSERVATION'
    with client.app.state.assets.db() as db:
        records = db.execute('SELECT release_json, content_sha256 FROM engineering_assets').fetchall()
    legacy = [row for row in records if 'application' not in json.loads(row['release_json'])]
    assert legacy
    for row in legacy:
        original = json.loads(row['release_json'])
        parsed = AssetRelease.model_validate(original)
        assert 'application' not in parsed.model_dump(mode='json')
        assert content_hash(parsed) == row['content_sha256'] == content_hash(original)
