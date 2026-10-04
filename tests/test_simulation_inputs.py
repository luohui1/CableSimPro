"""公开基准的拒算边界，不依赖可选原生环境。"""
import importlib.util
import json
from pathlib import Path
import sys
import pytest

PACKAGE = Path(__file__).resolve().parents[1]/'plugins/cablesim.simulation'
spec = importlib.util.spec_from_file_location('simulation_wire_inputs', PACKAGE/'src/cablesim_simulation/wire.py')
wire_module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = wire_module
spec.loader.exec_module(wire_module)


@pytest.fixture
def inputs():
    return json.loads((PACKAGE/'src/cases/insulated-wire.json').read_text('utf-8'))['input']


@pytest.mark.parametrize('key,value', [('source_w_m3', float('nan')), ('source_w_m3', -1),
                                     ('core_k_w_m_k', 0), ('convection_w_m2_k', False),
                                     ('outer_radius_m', 1), ('source_reference', '')])
def test_reject_invalid_physics(inputs, key, value):
    inputs[key] = value
    with pytest.raises(ValueError):
        wire_module.WireInput.parse(inputs)


def test_missing_material_is_not_defaulted(inputs):
    del inputs['insulation_k_w_m_k']
    with pytest.raises(ValueError):
        wire_module.WireInput.parse(inputs)


def test_resource_request_fails_instead_of_coarsening(inputs):
    wire = wire_module.WireInput.parse(inputs)
    with pytest.raises(ValueError):
        wire_module.mesh_size({'mesh_size_m': 1e-8}, wire)
