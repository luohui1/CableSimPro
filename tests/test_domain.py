"""Domain conversion and unsupported-method refusals use synthetic inputs only."""
from copy import deepcopy

import pytest
from fastapi.testclient import TestClient

from backend.domain.migration import convert
from backend.domain.models import DomainDocument
from backend.main import create_app
from backend.schemas import Scenario
from cablesim_thermal_network.domain import prepare
from cablesim_thermal_network.network import calculate


def converted():
    s = Scenario().model_dump()
    s['cable']['r20_ohm_km'] = .0754
    return s, convert(s)


def test_conversion_preserves_units_coordinates_and_numbers():
    s, result = converted()
    d = result['document']
    assert d['sections'][0]['placements'][0]['z'] == -.8
    assert d['cable_types'][0]['cores'][0]['conductor']['r20'] == pytest.approx(.0000754)
    assert d['circuits'][0]['bonding']['kind'] == 'unspecified'
    assert d['circuits'][0]['system']['voltage'] is None
    assert d['cable_types'][0]['rating']['u0'] == s['cable']['u0_kv'] * 1000
    assert d['cable_types'][0]['cores'][0]['conductor']['form'] == 'unspecified'
    restored = prepare(d, result['method_parameters'])
    from cablesim_thermal_network.inputs import Scenario as PluginScenario
    assert calculate(restored)['summary']['ampacity_a'] == pytest.approx(calculate(PluginScenario.model_validate(s))['summary']['ampacity_a'], rel=1e-12)


def test_domain_geometry_and_references_fail_closed():
    _, result = converted()
    for mutation in ('overlap', 'material', 'ground'):
        d = deepcopy(result['document'])
        if mutation == 'overlap':
            d['sections'][0]['placements'][1]['x'] = d['sections'][0]['placements'][0]['x']
        elif mutation == 'material':
            d['cable_types'][0]['cores'][0]['conductor']['material'] = 'material/missing'
        else:
            d['sections'][0]['placements'][0]['z'] = 0
        with pytest.raises(ValueError):
            DomainDocument.model_validate(d)


def test_multi_circuit_can_be_described_but_simplified_method_refuses():
    _, result = converted()
    d = deepcopy(result['document'])
    other = deepcopy(d['circuits'][0])
    other['id'] = 'circuit/c2'
    for c in other['cables']:
        c['id'] = c['id'].replace('c1', 'c2')
    d['circuits'].append(other)
    DomainDocument.model_validate(d)
    with pytest.raises(ValueError, match='单回路'):
        prepare(d, result['method_parameters'])


def test_explicit_conversion_keeps_original_revision_and_blocks_v0_writes(tmp_path):
    with TestClient(create_app(tmp_path / 'domain.sqlite')) as client:
        s, _ = converted()
        w = client.post('/api/workspaces', json={'scenario': s}).json()
        root = f'/api/workspaces/{w["id"]}'
        before = client.get(root).json()
        assert client.get(root + '/domain/conversion').status_code == 200
        assert client.get(root).json() == before
        r = client.post(root + '/domain/conversion', json={'expected_revision': 1})
        assert r.status_code == 200, r.text
        assert r.json()['revision'] == 2
        assert client.get(root + '/revisions/1').json()['state']['scenario'] == s
        assert client.post(root + '/edit', json={'expected_revision': 2, 'changes': [{'path': 'installation.depth_m', 'value': 1}]}).status_code == 409
        assert client.post(root + '/calculate', json={'expected_revision': 2}).status_code == 409
        assert client.get(root).json()['scenario'] == s


def test_locks_survive_conversion_and_nonfinite_facts_are_rejected():
    from backend.domain.guards import check_locks
    from fastapi import HTTPException
    _, result = converted()
    original = result['document']
    changed = deepcopy(original)
    changed['cable_types'][0]['cores'][0]['conductor']['r20'] *= 2
    with pytest.raises(HTTPException):
        check_locks({'domain': original, 'locks': ['cable.r20_ohm_km']}, changed)
    changed = deepcopy(original)
    changed['sections'][0]['placements'][0]['x'] = float('nan')
    with pytest.raises(ValueError):
        DomainDocument.model_validate(changed)


def test_domain_temperature_lock_allows_material_edits_and_explicit_unlock(tmp_path):
    with TestClient(create_app(tmp_path / 'domain.sqlite')) as client:
        w = client.post('/api/workspaces', json={}).json()
        root = f'/api/workspaces/{w["id"]}'
        converted = client.post(root + '/domain/conversion', json={'expected_revision': 1}).json()
        assert len(converted['locks'][0]['targets']) == 2
        assert client.get(root).json()['can_undo'] is False
        document = converted['document']
        next(m for m in document['materials'] if m['id'] == 'material/soil')['thermal_resistivity'] = 1.5
        document['materials'].reverse()
        saved = client.put(root + '/domain', json={'expected_revision': 2, 'document': document})
        assert saved.status_code == 200, saved.text
        document['criteria']['max_conductor_temperature'] = 370
        assert client.put(root + '/domain', json={'expected_revision': 3, 'document': document}).status_code == 422
        assert client.post(root + '/lock', json={'expected_revision': 2, 'path': 'cable.max_temperature_c', 'locked': False}).status_code == 409
        assert client.post(root + '/lock', json={'expected_revision': 3, 'path': 'cable.max_temperature_c', 'locked': False}).status_code == 200
        assert client.put(root + '/domain', json={'expected_revision': 4, 'document': document}).status_code == 200
        undo = client.post(root + '/history/undo', json={'expected_revision': 5})
        assert undo.status_code == 200, undo.text
        assert undo.json()['domain']['criteria']['max_conductor_temperature'] == 363.15


def test_domain_locks_follow_identity_and_protect_method_parameters():
    from backend.domain.guards import check_locks, pointer, validate_lock
    from fastapi import HTTPException
    _, result = converted()
    original = result['document']
    path = pointer('materials', 'material/soil', 'thermal_resistivity')
    state = {'domain': original, 'locks': [path, 'cable.screen_loss_factor'],
             'domain_conversion': {'method_parameters': result['method_parameters']}}
    validate_lock(state, path)
    changed = deepcopy(original)
    changed['materials'].reverse()
    check_locks(state, changed, result['method_parameters'])
    with pytest.raises(HTTPException):
        check_locks(state, changed, {**result['method_parameters'], 'screen_loss_factor': 123})
    next(m for m in changed['materials'] if m['id'] == 'material/soil')['thermal_resistivity'] = 9
    with pytest.raises(HTTPException):
        check_locks(state, changed)
    for invalid in ('/materials/0/thermal_resistivity', '/materials', '/name~3'):
        with pytest.raises(HTTPException):
            validate_lock(state, invalid)


def test_iec_domain_mapping_matches_explicit_synthetic_input():
    from math import pi
    from test_plugin_host import SYNTHETIC_IEC
    from cablesim_iec60287.domain import prepare as iec_prepare
    from cablesim_iec60287 import Rating, rate
    s = Scenario().model_dump()
    i = SYNTHETIC_IEC
    c = s['cable']
    c.update(area_mm2=240, fill_factor=240/(pi*(18.5/2)**2), r20_ohm_km=.0754,
             conductor_screen_mm=.6, insulation_mm=5.5, insulation_screen_mm=.7,
             metallic_screen_mm=.8, jacket_mm=2.5, u0_kv=12, relative_permittivity=2.5,
             tan_delta=.001, semicon_rho_k_m_w=2.5, insulation_rho_k_m_w=3.5, jacket_rho_k_m_w=3.5)
    diameter = .0185 + 2*(.0006+.0055+.0007+.0008+.0025)
    s['installation'].update(arrangement='trefoil', spacing_m=diameter+1e-12, ambient_temperature_c=20, soil_rho_k_m_w=1)
    d = convert(s)['document']
    materials = {m['id']: m for m in d['materials']}
    materials['material/conductor']['temperature_coefficient_20'] = .00393
    materials['material/screen'].update(electrical_resistivity_20=2.84e-8, temperature_coefficient_20=.00403)
    d['cable_types'][0]['common_layers'][3].update(role='metallic_sheath', form='smooth')
    d['cable_types'][0]['cores'][0]['conductor']['form'] = 'stranded_round'
    d['circuits'][0]['bonding']['kind'] = 'both_ends'
    DomainDocument.model_validate(d)
    p = {'ks': 1, 'kp': 1, 'eddy': 'ignored', 'solver': i['solver'], 't4_form': 'simplified'}
    actual = rate(iec_prepare(d, p))
    expected = rate(Rating.model_validate(i))
    assert actual.ampacity_a == pytest.approx(expected.ampacity_a, rel=1e-12)
