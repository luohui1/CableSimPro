"""Reference-table excerpts and explicit, unique-only demo resource migration."""
from copy import deepcopy
import json

from fastapi.testclient import TestClient

from backend.main import create_app
from backend.kernel.scenarios import system_models
from frontend.scripts.engineering_resources import definitions, publish_resources, bind_demo_resources


def records(release):
    return [json.loads(source.reference) for source in release.sources]


def test_reference_values_match_iec_tables_and_keep_conditions_and_missing_density():
    library = {release.asset_id: release for release in definitions()}
    copper = {r['property']: r for r in records(library['material/copper-conductor']) if 'property' in r}
    assert copper['electrical_resistivity_20']['value'] == 1.7241e-8
    assert copper['temperature_coefficient_20']['value'] == .00393
    for row in copper.values():
        assert (row['standard'], row['table'], row['printed_page'], row['pdf_page']) == (
            'IEC 60287-1-1:2023', '1', 35, 83)
        assert row['basis'] == 'standard_reference' and len(row['source_digest']) == 64
    xlpe = library['material/xlpe-mv']
    assert xlpe.parameters[0].quantity.value == 3.5
    thermal = next(r for r in records(xlpe) if r.get('property') == 'thermal_resistivity')
    assert (thermal['standard'], thermal['table'], thermal['printed_page'], thermal['pdf_page']) == (
        'IEC 60287-2-1:2023', '1', 33, 89)
    mv = next(r for r in records(xlpe) if r.get('property') == 'loss_tangent')
    hv = next(r for r in records(library['material/xlpe-hv']) if r.get('property') == 'loss_tangent')
    assert mv['value'] == .004 and hv['value'] == .001 and mv['condition'] != hv['condition']
    conductor_al = next(r for r in records(library['material/aluminium-conductor']) if r.get('property') == 'electrical_resistivity_20')
    sheath_al = next(r for r in records(library['material/aluminium-sheath']) if r.get('property') == 'electrical_resistivity_20')
    assert conductor_al['value'] == 2.8264e-8 and sheath_al['value'] == 2.84e-8
    assert len([release for release in library.values() if release.kind == 'rule']) == 7
    for release in library.values():
        if release.kind == 'material':
            assert any('density' in r.get('missing', []) for r in records(release))
            assert not any(r.get('property') == 'density' for r in records(release))


def test_resource_seed_idempotent_migration_unique_only_and_never_approves_requirements(tmp_path, monkeypatch):
    monkeypatch.setenv('CABLESIM_DATASETS_DIR', str(tmp_path/'datasets'))
    with TestClient(create_app(tmp_path/'resources.sqlite')) as client:
        def api(path, method='GET', body=None):
            response = client.request(method, path, json=body)
            assert response.status_code < 400, response.text
            return response.json()

        first = publish_resources(api)
        with client.app.state.types.assets.db() as db:
            events = db.execute('SELECT COUNT(*) FROM engineering_asset_events').fetchone()[0]
        assert publish_resources(api) == first
        with client.app.state.types.assets.db() as db:
            assert db.execute('SELECT COUNT(*) FROM engineering_asset_events').fetchone()[0] == events
        assert events == len(first)*3  # creation, review, publication; no SQL promotion
        copper = next(r for r in definitions() if r.asset_id == 'material/copper-conductor').model_dump(mode='json')
        copper['version'] = '1.0.1'
        second = api('/api/foundation/assets/import', 'POST', {'release': copper})
        for action in ('review', 'publish'):
            second = api('/api/foundation/assets/'+second['id']+'/transition', 'POST', {
                'expected_revision': second['revision'], 'content_sha256': second['content_sha256'],
                'action': action, 'note': '隔离测试：另一固定版本制造身份歧义。', 'acknowledge_sources': True})
        model = next(m for m in system_models() if m['id'] == 'system.specification-yjv22-300')
        workspace = api('/api/design/type-workspaces', 'POST', {
            'model_id': model['id'], 'content_sha256': model['content_sha256']})
        original = deepcopy(workspace['domain'])
        view = bind_demo_resources(api, workspace['id'], 'mv')
        saved = api('/api/workspaces/'+workspace['id'])
        assert next(t for t in view['targets'] if t['id'] == 'material/cu')['state'] == 'unbound'
        assert next(t for t in view['targets'] if t['id'] == 'material/semi')['state'] == 'current'
        assert all(t['state'] == 'current' for t in view['targets'] if t['role'] == 'standard')
        assert saved['domain']['materials'] == original['materials']  # no implicit numerical defaults
        for field in ('cable_types', 'sections', 'circuits', 'load_cases'):
            assert saved['domain'][field] == original[field]
        # This explicit edition declaration neither approves a requirement nor a type.
        with client.app.state.types.store.db() as db:
            assert db.execute('SELECT COUNT(*) FROM requirement_reviews').fetchone()[0] == 0
        assert bind_demo_resources(api, workspace['id'], 'mv')['revision'] == saved['revision']
        assert api('/api/workspaces/'+workspace['id'])['type_resource_bindings'] == saved['type_resource_bindings']
        relations = api('/api/index/objects/type/'+workspace['id']+'/relations')
        assert any(e['role'] == 'material' and e['target']['id'] == first['material/semiconductor-pe']['id'] for e in relations['uses'])
        assert any(e['role'] == 'standard' and e['target']['id'] == first['standard/gb-mv']['id'] for e in relations['uses'])
