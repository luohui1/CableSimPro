"""Domain input transport/refusals; only line-source runs without native libraries."""
from copy import deepcopy

import pytest

from backend.domain.migration import convert
from backend.plugin_host import Executor
from backend.schemas import Scenario
from cablesim_native.domain import prepare


ARGS = {'conductor_powers_w_m': [10, 20, 30], 'conductor_k_w_m_k': 380.,
        'metal_screen_k_w_m_k': 380., 'domain_scale': 4, 'resolution': 16}


def inputs(arrangement='flat'):
    s = Scenario().model_dump(mode='json')
    s['installation']['arrangement'] = arrangement
    s['cable']['r20_ohm_km'] = .0754
    d = convert(s)
    return s, d['document'], {**d['method_parameters'], **ARGS}


@pytest.mark.parametrize('arrangement', ['flat', 'trefoil'])
def test_native_domain_mapping_preserves_all_numerical_inputs(arrangement):
    source, document, parameters = inputs(arrangement)
    restored, args, binding = prepare(document, parameters)
    original = Scenario.model_validate(source)
    assert restored.cable.model_dump() == pytest.approx(original.cable.model_dump())
    assert restored.installation.model_dump() == pytest.approx(original.installation.model_dump())
    assert restored.operating_current_a == original.operating_current_a
    assert restored.installation.positions_m() == original.installation.positions_m()
    assert args == ARGS
    assert binding['section'] == document['sections'][0]['id']


@pytest.mark.parametrize('change', ['coordinates', 'missing-rho', 'extra-circuit', 'missing-assumption', 'conductivity-conflict', 'over-rated-limit', 'hollow'])
def test_unsupported_or_incomplete_native_domain_is_not_silently_simplified(change):
    _, d, p = inputs()
    if change == 'coordinates':
        for place in d['sections'][0]['placements']:
            place['x'] += .5
    elif change == 'missing-rho':
        next(m for m in d['materials'] if m['id'] == 'material/insulation')['thermal_resistivity'] = None
    elif change == 'extra-circuit':
        other = deepcopy(d['circuits'][0])
        other['id'] = 'circuit/other'
        for c in other['cables']:
            c['id'] += '-other'
        d['circuits'].append(other)
    elif change == 'missing-assumption':
        del p['screen_loss_factor']
    elif change == 'conductivity-conflict':
        next(m for m in d['materials'] if m['id'] == 'material/conductor')['thermal_resistivity'] = 1 / 200
    elif change == 'over-rated-limit':
        d['criteria']['max_conductor_temperature'] = 380
    else:
        d['cable_types'][0]['cores'][0]['conductor']['inner_diameter'] = .001
    with pytest.raises((ValueError, KeyError, TypeError)):
        prepare(d, p)


def test_line_source_v2_domain_results_keep_engineering_ids_and_match_v0():
    s, d, p = inputs()
    circuit = d['circuits'][0]
    old = circuit['id']
    circuit['id'] = 'circuit/feeder'
    d['load_cases'][0]['currents'][circuit['id']] = d['load_cases'][0]['currents'].pop(old)
    for index, cable in enumerate(circuit['cables']):
        cid = cable['id']
        cable['id'] = 'cable/feeder-' + str(index)
        next(place for place in d['sections'][0]['placements'] if place['cable'] == cid)['cable'] = cable['id']
    result = Executor().run('cablesim.native-reference', 'line-source', [
        {'case_id': 'v0', 'input': s, 'parameters': ARGS}, {'case_id': 'domain', 'input': d, 'parameters': p}])
    a, b = result.cases
    assert a.status == b.status == 'succeeded', (a.error, b.error)
    assert [r['entity'] for r in b.results] == [c['id'] for c in circuit['cables']]
    assert [r['value'] for r in a.results] == pytest.approx([r['value'] for r in b.results], abs=1e-10)
    assert b.evidence['entity_binding']['circuit'] == circuit['id']
    assert b.evidence['prepared_input_sha256']


def test_fem_preflight_rejects_touching_cables_before_starting_solver():
    s = Scenario().model_dump(mode='json')
    s['installation']['spacing_m'] = 2 * Scenario.model_validate(s).cable.radii_mm()[-1] / 1000
    converted = convert(s)
    result = Executor().check('cablesim.native-reference', 'fixed-power', [
        {'case_id': 'touching', 'input': converted['document'],
         'parameters': {**converted['method_parameters'], **ARGS}}])
    assert result.cases[0].status == 'failed'
    assert 'TOUCHING_CABLES_REQUIRE_DIFFERENT_TOPOLOGY' in result.cases[0].error['message']
