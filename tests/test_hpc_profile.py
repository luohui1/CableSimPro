"""Capability placement and read-only configuration API, without SSH or solvers."""
from copy import deepcopy
import json
from pathlib import Path
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator
from pydantic import ValidationError
import pytest

from backend.kernel.hpc_executor import HpcExecutor
from backend.kernel.hpc_jobs import make_router
from backend.plugin_host.manifest import Capability, Manifest

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def capability():
    manifest = json.loads((ROOT/'plugins/cablesim.hybrid-rating/plugin.json').read_text('utf-8'))
    return manifest['capabilities'][0]


def test_solver_schema_and_legacy_identity(capability):
    schema = Capability.model_json_schema()
    generated = json.loads((ROOT/'plugin-spec/manifest.schema.json').read_text('utf-8'))['$defs']['Capability']
    assert generated['properties']['solver'] == schema['properties']['solver']
    assert 'solver' not in generated['required']
    assert schema['properties']['solver']['enum'] == ['local', 'slurm', 'either']
    assert schema['properties']['solver']['default'] == 'local'
    assert 'solver' not in schema['required']
    for solver in ('local', 'slurm', 'either'):
        value = {**capability, 'solver': solver}
        Draft202012Validator(schema).validate(value)
        model = Capability.model_validate(value)
        assert model.solver == solver
        assert model.model_dump(mode='json')['solver'] == solver
    old = deepcopy(capability)
    old.pop('solver')
    model = Capability.model_validate(old)
    assert model.solver == 'local'
    assert 'solver' not in model.model_dump(mode='json', by_alias=True)
    assert 'solver' not in json.loads(model.model_dump_json(by_alias=True))
    with pytest.raises(ValidationError):
        Capability.model_validate({**capability, 'solver': 'cloud'})
    with pytest.raises(ValidationError):
        Capability.model_validate({**capability, 'solver': None})


def test_owned_capabilities_declare_actual_solver_locations():
    simulation = Manifest.model_validate_json((ROOT/'plugins/cablesim.simulation/plugin.json').read_text('utf-8'))
    hybrid = Manifest.model_validate_json((ROOT/'plugins/cablesim.hybrid-rating/plugin.json').read_text('utf-8'))
    assert len(simulation.capabilities) == 17
    assert {cap.solver for cap in simulation.capabilities} == {'slurm'}
    assert {cap.id: cap.solver for cap in hybrid.capabilities} == {
        'training-sample': 'slurm', 'train-model': 'slurm',
        'physics-comparison': 'slurm', 'steady-rating': 'either'}


@pytest.fixture
def profile_api(tmp_path, monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError('profile GET must not prepare inputs, touch the DB or submit jobs')
    monkeypatch.setattr('backend.kernel.hpc_executor.SlurmBackend', forbidden)
    monkeypatch.setattr(HpcExecutor, 'run', forbidden)
    executor = HpcExecutor(SimpleNamespace(registry=None), profile=tmp_path/'profile.json',
                           root=tmp_path/'jobs', ledger=tmp_path/'budget.sqlite')
    research = SimpleNamespace(executor=executor, store=SimpleNamespace(db=forbidden), prepare=forbidden)
    app = FastAPI()
    app.include_router(make_router(research))
    with TestClient(app) as client:
        yield client, executor
    assert not executor.root.exists()
    assert not executor.ledger.exists()


def save_profile(executor, value):
    executor.profile.write_text(json.dumps(value), encoding='utf-8')


def valid_profile():
    return {'ssh_alias': 'private-cluster', 'remote_root': '/private/cablesim',
            'python': '/private/python', 'remote_plugins': ['cablesim.simulation'],
            'remote_capabilities': {'cablesim.hybrid-rating': ['train-model', 'training-sample']}}


def test_profile_not_configured(profile_api):
    client, executor = profile_api
    response = client.get('/api/hpc/profile')
    assert response.status_code == 200
    assert response.json() == {
        'configured': False, 'status': 'not_configured', 'connection_checked': False,
        'remote_plugins': [], 'remote_capabilities': {}, 'configuration_file': None,
        'configuration_note': '宿主使用外部指定的超算配置文件；连接参数在文件中配置。'}
    assert not executor.profile.exists()


def test_profile_allowlist_no_credentials_and_no_side_effects(profile_api):
    client, executor = profile_api
    private = valid_profile()
    private.update(password='password-secret', token='token-secret', ssh_config='private-key-file',
                   host_key='host-key-secret', environment={'ACCESS_KEY': 'env-secret'})
    save_profile(executor, private)
    before = executor.profile.read_bytes()
    for _ in range(2):
        response = client.get('/api/hpc/profile')
        assert response.status_code == 200
        value = response.json()
        assert value['configured'] is True and value['status'] == 'configured'
        assert value['connection_checked'] is False
        assert value['remote_plugins'] == ['cablesim.simulation']
        assert value['remote_capabilities'] == {'cablesim.hybrid-rating': ['train-model', 'training-sample']}
        assert set(value) == {'configured', 'status', 'connection_checked', 'remote_plugins',
                              'remote_capabilities', 'configuration_file', 'configuration_note'}
        for secret in ('password-secret', 'token-secret', 'private-key-file', 'host-key-secret',
                       'env-secret', 'private-cluster', '/private/'):
            assert secret not in response.text
    assert executor.profile.read_bytes() == before


@pytest.mark.parametrize('change', [
    {'ssh_alias': None}, {'python': '/private/../python'},
    {'remote_plugins': 'password-secret'},
    {'remote_plugins': ['password=secret']},
    {'remote_capabilities': {'cablesim.simulation': ['capability/password-secret']}},
    {'remote_capabilities': {'password-secret': ['run']}},
])
def test_profile_invalid_configuration_is_safe(profile_api, change):
    client, executor = profile_api
    save_profile(executor, {**valid_profile(), **change})
    response = client.get('/api/hpc/profile')
    assert response.status_code == 200
    assert response.json()['configured'] is False
    assert response.json()['status'] == 'invalid'
    assert 'password' not in response.text


@pytest.mark.parametrize('raw', ['{invalid password-secret', 'null', '[]'])
def test_profile_corrupt_file_does_not_break_settings(profile_api, raw):
    client, executor = profile_api
    executor.profile.write_text(raw, encoding='utf-8')
    response = client.get('/api/hpc/profile')
    assert response.status_code == 200
    assert response.json()['configured'] is False
    assert response.json()['status'] == 'invalid'
    assert 'password-secret' not in response.text


def test_profile_location_and_routes_are_configuration_not_runtime(tmp_path, monkeypatch):
    executor = HpcExecutor(SimpleNamespace(registry=None), profile=tmp_path/'config.json')
    monkeypatch.setattr('backend.kernel.hpc_executor.ROOT', tmp_path)
    monkeypatch.setenv('SLURM_JOB_ID', 'fixture-job')
    save_profile(executor, valid_profile())
    value = executor.profile_status()
    assert value['configuration_file'] == 'config.json'
    assert value['configured'] is True
    assert value['remote_plugins'] == ['cablesim.simulation']
