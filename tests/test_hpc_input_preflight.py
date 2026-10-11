"""Offline input admission must never prepare a native solver or submit SSH."""
from contextlib import contextmanager
from copy import deepcopy
from types import SimpleNamespace
from uuid import uuid4
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from backend.kernel.hpc_jobs import make_router
from backend.kernel.hpc_preflight import input_issues
from backend.plugin_host.registry import Registry
from simulation_fixtures import domain, coupled_parameters


@pytest.fixture
def capability():
    return Registry(plugin_id='cablesim.simulation').get('cablesim.simulation').manifest.capability('electrothermal-steady')


def test_offline_schema_check_lists_every_missing_parameter_and_range(capability):
    value = domain(True)
    missing = input_issues(capability, {'input': value, 'parameters': {}})
    paths = {row['path'] for row in missing}
    assert {'/parameters/electromagnetic_options', '/parameters/mesh', '/parameters/thermal_boundaries'} <= paths
    assert all('required' not in row['message'] for row in missing)
    parameters = coupled_parameters(value)
    parameters['initial_temperature_k'] = -1
    assert '/parameters/initial_temperature_k' in {row['path'] for row in input_issues(capability, {'input': value, 'parameters': parameters})}


def test_input_preflight_is_readonly_and_works_without_hpc(capability):
    value = domain(True)
    definition = {'method': {'plugin_id': 'cablesim.simulation', 'capability': capability.id},
                  'driver': {'candidate_ids': []}, 'crosschecks': []}
    snapshot = {'definition': definition, 'lock': {'digest': 'saved-lock'},
                'cases': [{'case_id': 'case-0', 'input': value, 'parameters': coupled_parameters(value)}]}
    @contextmanager
    def database(*args):
        assert not args, 'local admission cannot open a write transaction'
        yield SimpleNamespace(execute=lambda query: query == 'BEGIN' or pytest.fail(query))
    def forbidden(*args, **kwargs):
        pytest.fail('Solver/plugin/executor must not be invoked by input preflight')
    observed = []
    def prepare(db, wid, sid, revision, study_revision, module):
        observed.append((revision, study_revision, module))
        return deepcopy(snapshot)
    research = SimpleNamespace(store=SimpleNamespace(db=database),
        definition=lambda *args: {'definition': definition}, module_definition=lambda value, module: value,
        prepare=prepare, resolve=lambda method: (None, capability),
        executor=SimpleNamespace(run=forbidden, check=forbidden, required=forbidden))
    app = FastAPI(); app.include_router(make_router(research))
    url = f'/api/hpc/workspaces/{uuid4()}/studies/{uuid4()}/input-preflight?expected_revision=7&expected_study_revision=3&module=thermal-field'
    with TestClient(app) as client:
        response = client.get(url)
    assert response.status_code == 200
    data = response.json()
    assert data['input_ready'] is True, data
    assert data['ready'] is False and data['local_only'] is True
    assert observed == [(7, 3, 'thermal-field')]


def test_comsol_solver_declaration_matches_native_guard():
    manifest = Registry(plugin_id='cablesim.comsol-bridge').get('cablesim.comsol-bridge').manifest
    assert len(manifest.capabilities) == 3
    assert all(capability.solver == 'slurm' for capability in manifest.capabilities)
