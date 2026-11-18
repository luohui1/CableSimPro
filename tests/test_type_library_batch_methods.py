"""Real library batches preserve the pinned method and plugin release separately."""
from copy import deepcopy
import json
import shutil
from uuid import uuid4

from fastapi import HTTPException
from fastapi.testclient import TestClient
import pytest

from backend.main import create_app
from backend.kernel.type_library_operations import _run
from backend.kernel.workspace import fingerprint
from backend.plugin_host import Registry
from backend.plugin_host.dependencies import host_dependencies
from test_type_library import HUMAN, import_series


@pytest.fixture(scope='module')
def context(tmp_path_factory):
    root = tmp_path_factory.mktemp('library-batch-methods')
    app = create_app(root / 'engineering.sqlite')
    with TestClient(app) as client:
        imported, _ = import_series(client)
        response = client.get('/api/type-library/series/' + imported['series_id'])
        assert response.status_code == 200, response.text
        yield client, imported['series_id'], response.json()['specs']


def batch_request(specs):
    return {'request_id': str(uuid4()), 'operation': 'check',
            'spec_ids': [spec['id'] for spec in specs],
            'expected_versions': {spec['id']: spec['version'] for spec in specs},
            'expected_revisions': {spec['id']: spec['workspace_revision'] for spec in specs},
            'human_confirmed': True, 'scope_acknowledged': True}


def saved_counts(client):
    with client.app.state.workspace_store.db() as db:
        return {table: db.execute('SELECT count(*) FROM ' + table).fetchone()[0]
                for table in ('studies', 'study_versions', 'study_runs', 'type_submissions',
                              'domain_cable_models', 'workspace_revisions')}


def test_real_standard_batch_keeps_capability_version_and_saved_run_identity(context):
    client, series_id, specs = context
    research = client.app.state.research
    plugin = research.registry('cablesim.standard-check').get('cablesim.standard-check')
    capability = plugin.manifest.capability('dimensions')
    # This real release fixes transport/identity handling without changing math.
    assert plugin.manifest.version == '1.8.6'
    assert capability.method_version == '1.8.5'
    before = saved_counts(client)
    request = batch_request(specs[:2])
    endpoint = '/api/type-library/series/' + series_id + '/batch'
    response = client.post(endpoint, json=request, headers=HUMAN)
    assert response.status_code == 200, response.text
    batch = response.json()
    assert batch['status'] == 'succeeded', batch
    assert len(batch['items']) == 2
    for item in batch['items']:
        assert item['method_name'] == plugin.manifest.name
        assert item['method_version'] == capability.method_version
        assert item['plugin_version'] == plugin.manifest.version
        assert item['confidence'] == 'reference'
        url = (f"/api/workspaces/{item['workspace_id']}/studies/{item['study_id']}"
               f"/runs/{item['run_id']}?view=full")
        response = client.get(url)
        assert response.status_code == 200, response.text
        saved = response.json()
        assert saved['status'] == 'succeeded' and saved['integrity'] == 'verified'
        assert saved['snapshot']['definition']['method'] == {
            **research.pin(plugin), 'capability': 'dimensions'}
        assert saved['output']['plugin_version'] == item['plugin_version']
        assert saved['output']['method_version'] == item['method_version']
        assert saved['input_digest'] == item['input_digest'] == fingerprint(saved['snapshot'])
        assert saved['output_digest'] == item['output_digest'] == fingerprint(saved['output'])
        assert item['checks'] == [row for case in saved['output']['cases']
                                 for row in case['artifacts']['x-cablesim.standard-check']['rows']]
    after = saved_counts(client)
    assert after == {**before, 'studies': before['studies'] + 2,
                     'study_versions': before['study_versions'] + 2,
                     'study_runs': before['study_runs'] + 2}
    assert client.post(endpoint, json=request, headers=HUMAN).json() == batch
    assert saved_counts(client) == after


@pytest.mark.parametrize('invalid', ['missing', 'empty', 'null', 'seal'])
def test_invalid_capability_version_refuses_batch_without_relabeling_or_saved_runs(
        context, tmp_path, monkeypatch, invalid):
    client, series_id, specs = context
    research = client.app.state.research
    plugin = research.registry('cablesim.standard-check').get('cablesim.standard-check')
    raw = json.loads((plugin.directory / 'plugin.json').read_bytes())
    directory = tmp_path / 'plugins' / plugin.manifest.id
    if invalid == 'seal':
        shutil.copytree(plugin.directory, directory, ignore=shutil.ignore_patterns('__pycache__', 'tests'))
        for dependency in host_dependencies(plugin.directory):
            source = plugin.directory.parent.parent / dependency['path']
            target = tmp_path / dependency['path']
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        Registry(directory.parent).get(plugin.manifest.id).verify()
        entry = directory / plugin.manifest.runtime.entry
        entry.write_bytes(entry.read_bytes() + b'\n# Damaged test package; its old seal must refuse execution.\n')
    else:
        capability = next(row for row in raw['capabilities'] if row['id'] == 'dimensions')
        if invalid == 'missing':
            capability.pop('method_version')
        else:
            capability['method_version'] = '' if invalid == 'empty' else None
        directory.mkdir(parents=True)
        (directory / 'plugin.json').write_text(json.dumps(raw, ensure_ascii=False), 'utf-8')
    # Only an isolated package is damaged. The ordinary registry and seal gate
    # must reject it before saving a study; no solver result is replaced.
    before = saved_counts(client)
    request = batch_request(specs[:1])
    with monkeypatch.context() as isolated:
        isolated.setattr(research.executor.registry, 'root', directory.parent)
        endpoint = '/api/type-library/series/' + series_id + '/batch'
        response = client.post(endpoint, json=request, headers=HUMAN)
        assert response.status_code == 200, response.text
        batch = response.json()
        assert batch['status'] == 'failed', batch
        item, = batch['items']
        assert item['status'] == 'failed'
        if invalid == 'seal':
            assert item['detail']['code'] == 'PACKAGE_DIGEST_MISMATCH'
            assert plugin.manifest.runtime.entry in item['detail']['message']
        else:
            assert item['detail']['code'] == 'PLUGIN_MANIFEST_INVALID'
            assert 'method_version' in item['detail']['message']
        assert not {'method_version', 'plugin_version', 'study_id', 'run_id'} & item.keys()
        assert client.post(endpoint, json=request, headers=HUMAN).json() == batch
    assert saved_counts(client) == before
    with research.store.db() as db:
        receipt = db.execute('SELECT status,payload FROM type_library_batches WHERE request=?',
                             (request['request_id'],)).fetchone()
        assert receipt['status'] == 'failed' and json.loads(receipt['payload']) == batch


@pytest.mark.parametrize('change,status', [('version', 409), ('release_digest', 409), ('capability', 422)])
def test_batch_run_resolves_exact_pin_before_saving_a_study(context, change, status):
    client, _, specs = context
    service = client.app.state.type_library
    plugin = service.research.registry('cablesim.standard-check').get('cablesim.standard-check')
    method = {**service.research.pin(plugin), 'capability': 'dimensions'}
    method[change] = {'version': '0.0.0', 'release_digest': '0' * 64, 'capability': 'not-declared'}[change]
    definition = {'title': '损坏发行引用不能建立研究', 'method': method,
                  'input_source': 'domain', 'parameters': {}, 'driver': {'kind': 'single'}}
    before = saved_counts(client)
    with pytest.raises(HTTPException) as refused:
        _run(service, specs[0], deepcopy(definition), uuid4())
    assert refused.value.status_code == status
    assert saved_counts(client) == before
