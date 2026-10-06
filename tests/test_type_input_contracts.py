"""Installed form identity, parameter admission and R20 data/limit provenance."""
from hashlib import sha256
import importlib.util
from pathlib import Path

from fastapi.testclient import TestClient
from pydantic import ValidationError
import pytest

from backend.kernel.input_contracts import model_for
from backend.kernel.scenarios import make_router
from backend.main import create_app

ROOT = Path(__file__).resolve().parents[1]


def test_installed_type_contracts_match_plugin_pins(tmp_path):
    app = create_app(tmp_path/'contract.sqlite')
    app.include_router(make_router(app.state.workspace_store))
    fallback = next(route for route in app.router.routes if getattr(route, 'path', '') == '/api/{path:path}')
    app.router.routes.remove(fallback)
    app.router.routes.append(fallback)
    with TestClient(app) as client:
        response = client.get('/api/input-contracts')
        assert response.status_code == 200, response.text
        contracts = [item for item in response.json() if item['method']['plugin_id'] == 'cablesim.type-electrical']
        assert {item['method']['capability'] for item in contracts} == {'electrical', 'short-circuit'}
        for item in contracts:
            assert item['method']['version'] == '1.0.0'
            assert len(item['method']['release_digest']) == 64
            assert item['parameter_source_sha256'] == sha256((ROOT/item['parameter_source']).read_bytes()).hexdigest()
            assert item['parameter_schema']['additionalProperties'] is False
            assert 'cable_type_id' in item['parameter_schema']['required']
        temperature = next(item for item in contracts if item['method']['capability'] == 'electrical')['parameter_schema']['properties']['temperature_k']
        assert temperature['x-unit'] == {'si':'K','display':'°C','scale':1.0,'offset':-273.15}
        assert temperature['x-source-required'] is True
        assert temperature['default'] is None


@pytest.mark.parametrize('capability,values', [
    ('electrical', {'temperature_k': True}),
    ('electrical', {'frequency_hz': 101}),
    ('electrical', {'made_up_default': 1}),
    ('short-circuit', {'duration_s': 0}),
    ('short-circuit', {'interest_times_s': [6]}),
    ('short-circuit', {'initial_temperature_k': 523.15, 'final_temperature_k': 363.15}),
])
def test_contract_rejects_outside_range_and_invalid_shapes(capability, values):
    model, _ = model_for('cablesim.type-electrical', capability)
    with pytest.raises(ValidationError):
        model.model_validate({'cable_type_id':'cable/a', **values})


def test_r20_standard_table_is_limit_reference_not_manufactured_measurement():
    spec = importlib.util.spec_from_file_location('electrical_reference_test', ROOT/'tests/test_type_electrical.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    document = module.tb_document()
    conductor = document['cable_types'][0]['cores'][0]['conductor']
    conductor['conductor_class'] = 2
    pointer = '/cable_types/0/cores/0/conductor/r20'
    document['provenance'][pointer] = {'kind':'standard','reference':'CIGRE TB 880 B1 case 0-1 validation input','reviewed':False}
    value = module.row(module.plugin.calculate(document, module.params(), 'electrical'), 'r20')
    assert value['basis'] == 'design'
    assert value['data_origin'] == '设计输入'
    assert value['value'] == 2.83e-5
    assert value['input_source']['reference'] == document['provenance'][pointer]['reference']
    assert value['formula'] is None
    assert value['reference_table']['table'] == '表 2'
    assert value['reference_table']['semantics'] == 'standard_limit_reference'
    assert value['reference_table']['pdf_pages'] == [7, 8]
    conductor['conductor_class'] = 5
    value = module.row(module.plugin.calculate(document, module.params(), 'electrical'), 'r20')
    assert 'reference_table' not in value
