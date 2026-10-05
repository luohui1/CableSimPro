"""2023 clauses: analytic image checks, unequal loads, ducts and backfill."""
from copy import deepcopy
from math import acosh, exp, log, pi, sqrt

import pytest

from backend.domain.migration import convert
from backend.domain.models import DomainDocument
from backend.schemas import Scenario
from backend.kernel.scenarios import METHOD_DEFAULTS, apply_layout, system_models
from cablesim_iec60287.domain import prepare
from cablesim_iec60287.group import _loss_factors, operating, rate_group
from cablesim_iec60287.method import RatingRefused
from cablesim_iec60287.soil import geometric_factor, resistance_matrix


def document(kind='double_trefoil',model='system.cu-xlpe-al-400'):
    d = convert(Scenario().model_dump())['document']
    m = next(m for m in system_models() if m['id'] == model)
    d['cable_types'] = [deepcopy(m['payload']['cable_type'])]
    material_ids = {m['id'] for m in m['payload']['materials']}
    d['materials'] = [m for m in d['materials'] if m['id'] not in material_ids]+deepcopy(m['payload']['materials'])
    d['circuits'][0]['cable_type'] = d['cable_types'][0]['id']
    d['circuits'][0]['bonding']['kind'] = 'both_ends'
    d['load_cases'][0]['currents'][d['circuits'][0]['id']] = 250.0
    return apply_layout(d,kind,depth=1.2)


def parameters(d=None):
    p = deepcopy(METHOD_DEFAULTS['cablesim.iec60287'])
    if d and len(d['circuits']) > 1:
        p['per_cable_losses'] = {c['id']:{'ac_extra_factor':.04,'lambda1':.1}
                                for circuit in d['circuits'] for c in circuit['cables']}
        p['loss_input_source'] = '合成热路验证：显式给定交流附加0.04/护套0.1，非工程电磁结果'
    return p


def test_image_matrix_matches_closed_two_cable_formula_and_reciprocity():
    # IEC 60287-2-1:2023 4.2.3.3.2, equal depth/diameter row.
    depth, radius, spacing, rho = 1.0,.025,.2,1.2
    matrix,_ = resistance_matrix([(-spacing/2,-depth),(spacing/2,-depth)],[radius]*2,rho)
    self_r = rho/(2*pi)*log(depth/radius+sqrt((depth/radius)**2-1))
    mutual = rho/(4*pi)*log(1+4*depth**2/spacing**2)
    assert matrix[0][0] == pytest.approx(self_r,rel=1e-12)
    assert matrix[0][1] == pytest.approx(mutual,rel=1e-12)
    assert matrix[0][1] == matrix[1][0]
    assert sum(matrix[0])*12 == pytest.approx((self_r+mutual)*12,rel=1e-12)


def test_unequal_depths_and_losses_use_each_source_and_its_image():
    points = [(0,-.8),(.3,-1.2),(-.45,-1.0),(.8,-.9)]
    radii = [.02,.025,.03,.025]
    losses = [8,17,2,11]
    matrix,_ = resistance_matrix(points,radii,1.3)
    for i,(xi,zi) in enumerate(points):
        expected = 0
        for j,(xj,zj) in enumerate(points):
            factor = acosh(-zi/radii[i]) if i == j else .5*log(((xi-xj)**2+(zi+zj)**2)/((xi-xj)**2+(zi-zj)**2))
            expected += 1.3/(2*pi)*factor*losses[j]
        assert sum(v*w for v,w in zip(matrix[i],losses)) == pytest.approx(expected,rel=1e-12)


def test_table_2_nodes_interpolation_and_common_backfill_correction():
    # IEC 2023 Table 2: hb/wb=0.5, LG/hb=2 => Gb=1.51.
    assert geometric_factor(1.2,.6,1.2) == pytest.approx(1.51)
    assert geometric_factor(1.5,.6,1.2) == pytest.approx((1.51+1.92)/2)
    points, radii = [(-.15,-1.2),(.15,-1.2)],[.025]*2
    fill = {'x':0,'z':-1.2,'width':1.2,'height':.6,'rho':.8}
    matrix,trace = resistance_matrix(points,radii,1.2,fill)
    plain,_ = resistance_matrix(points,radii,.8)
    rb = 1.2/exp(1.51)
    correction = .4/(2*pi)*acosh(1.2/rb)
    assert trace['equivalent_radius_m'] == pytest.approx(rb)
    for i in range(2):
        for j in range(2):
            assert matrix[i][j] == pytest.approx(plain[i][j]+correction)
    assert sum((matrix[0][j]-plain[0][j])*w for j,w in enumerate([10,20])) == pytest.approx(correction*30)


@pytest.mark.parametrize('args',[(.5,.6,20),(1,.1,.005),(9,3,1)])
def test_table_out_of_range_or_damaged_cell_is_refused(args):
    with pytest.raises(RatingRefused):
        geometric_factor(*args)


@pytest.mark.parametrize('kind',['trefoil','flat','double_trefoil','double_flat','ducts','ducts_2x3','ducts_3x3','backfill','duct_bank'])
def test_each_template_solves_and_passes_independent_heat_balance(kind):
    d = document(kind)
    g = prepare(d,parameters(d))
    result = rate_group(g)
    states = result['operating']['cable_states']
    assert len(states) == len(d['sections'][0]['placements'])
    assert len(result['heat_contributions']) == len(states)**2
    assert len(result['circuit_ratings']) == len(d['circuits'])
    assert result['verification']['passed']
    assert max(abs(r['difference']) for r in result['verification']['rows']) < 1e-3
    hottest = max(states,key=lambda s:s['conductor_temperature_c'])
    assert result['operating']['hottest_cable'] == hottest['entity']
    for rated in result['circuit_ratings']:
        assert rated['ampacity_a'] > 0
        assert min(s['margin_k'] for s in rated['cable_states']) == pytest.approx(0,abs=1e-3)
        for entity,current in rated['held_currents_a'].items():
            assert current == next(c['current'] for c in g.cables if c['id'] == entity)


def test_increasing_neighbour_load_heats_first_circuit_and_lowers_its_limit():
    d = document()
    first,other = d['circuits']
    d['load_cases'][0]['currents'][other['id']] = 100
    low = rate_group(prepare(d,parameters(d)))
    d['load_cases'][0]['currents'][other['id']] = 350
    high = rate_group(prepare(d,parameters(d)))
    assert high['circuit_ratings'][0]['ampacity_a'] < low['circuit_ratings'][0]['ampacity_a']
    assert high['operating']['cable_states'][0]['conductor_temperature_c'] > low['operating']['cable_states'][0]['conductor_temperature_c']
    contribution = next(c for c in high['heat_contributions'] if c['target'] == first['cables'][0]['id'] and c['source'] == other['cables'][0]['id'])
    assert contribution['temperature_rise_k'] > 0


def test_simultaneous_balanced_current_matches_independent_frozen_heat_balance():
    d = document('ducts_3x3')
    p = parameters(d);p['rating_mode']='both'
    for c in d['circuits']:
        d['load_cases'][0]['currents'][c['id']]=200.
    group = prepare(d,p);trace=rate_group(group);common=trace['simultaneous_rating']
    assert common['ampacity_a'] < min(r['ampacity_a'] for r in trace['circuit_ratings'])
    assert set(common['cable_currents_a'].values()) == {common['ampacity_a']}
    assert common['held_currents_a']=={}
    # Hand substitution of converged R, lambda and duct air in the IEC heat balance.
    states=common['cable_states'];hand=[]
    for i,s in enumerate(states):
        weights=[(group.matrix[i][j] + (s['t3_k_m_w']+s['t4_air_gap_k_m_w']+s['t4_wall_k_m_w'] if i==j else 0)) for j in range(len(states))]
        coefficient=s['ac_resistance_ohm_m']*s['t1_k_m_w']+sum(w*t['ac_resistance_ohm_m']*(1+t['lambda1']) for w,t in zip(weights,states))
        dielectric=.5*s['t1_k_m_w']*s['dielectric_loss_w_m']+sum(w*t['dielectric_loss_w_m'] for w,t in zip(weights,states))
        hand.append(sqrt((s['temperature_limit_c']-group.ambient-dielectric)/coefficient))
    assert common['ampacity_a']==pytest.approx(min(hand),abs=2e-5)
    assert min(s['margin_k'] for s in states)==pytest.approx(0.,abs=1e-3)


def test_unavailable_rating_does_not_discard_valid_overtemperature_result():
    d = document('ducts_3x3')
    for c in d['circuits']:
        d['load_cases'][0]['currents'][c['id']] = 600
    result = rate_group(prepare(d,parameters(d)))
    assert max(s['conductor_temperature_c'] for s in result['operating']['cable_states']) > 90
    assert any(r['ampacity_a'] is None and r['error']['code'] == 'NO_POSITIVE_RATING' for r in result['circuit_ratings'])
    assert result['verification']['passed']


def test_arbitrary_n_and_unequal_per_cable_currents_require_sourced_losses():
    d,p = document('flat'),parameters()
    d['circuits'][0]['cables'] = d['circuits'][0]['cables'][:2]
    d['sections'][0]['placements'] = d['sections'][0]['placements'][:2]
    ids = [c['id'] for c in d['circuits'][0]['cables']]
    d['load_cases'][0]['currents'].update(dict(zip(ids,[150,240])))
    DomainDocument.model_validate(d)
    with pytest.raises(ValueError,match='逐根提供'):
        prepare(d,p)
    p['per_cable_losses'] = {cid:{'ac_extra_factor':.04,'lambda1':.1} for cid in ids}
    with pytest.raises(ValueError,match='来源'):
        prepare(d,p)
    p['loss_input_source'] = '合成解析检验的已知损耗输入；非测量'
    result = rate_group(prepare(d,p))
    assert [s['current_a'] for s in result['operating']['cable_states']] == [150,240]
    assert result['verification']['passed']


def test_layered_soil_and_unbalanced_auto_losses_are_explicit_refusals():
    d = document('flat')
    soil = d['sections'][0]['medium']['material']
    d['sections'][0]['soil_layers'] = [{'id':'region/top','material':soil,'label':'上层','top_z':0,'bottom_z':-2}]
    with pytest.raises(RatingRefused,match='数值热传导'):
        prepare(d,parameters())
    d['sections'][0]['soil_layers'] = []
    d['load_cases'][0]['currents'][d['circuits'][0]['cables'][0]['id']] = 200
    with pytest.raises(ValueError,match='不平衡'):
        prepare(d,parameters())


def test_duct_three_stages_and_temperature_iteration():
    d = document('ducts_3x3')
    g = prepare(d,parameters(d))
    states = operating(g)['cable_states']
    for c,s in zip(g.cables,states):
        d = c['rating'].installation.duct
        wall = 6/(2*pi)*log(.16/.14)
        mean = (s['surface_temperature_c']+s['duct_inner_temperature_c'])/2
        gap = 1.87/(1+.1*(.312+.0037*mean)*c['geometry'].overall_m*1000)
        assert s['t4_wall_k_m_w'] == pytest.approx(wall,rel=1e-12)
        assert s['t4_air_gap_k_m_w'] == pytest.approx(gap,abs=1e-7)
        assert s['surface_temperature_c']-s['duct_inner_temperature_c'] == pytest.approx(s['total_loss_w_m']*gap,abs=1e-5)
        assert s['duct_inner_temperature_c']-s['duct_outer_temperature_c'] == pytest.approx(s['total_loss_w_m']*wall,abs=1e-6)


@pytest.mark.parametrize('bonding',['both_ends','single_point'])
def test_multicircuit_auto_losses_require_an_applicable_electrical_model(bonding):
    d = document('double_trefoil')
    for circuit in d['circuits']:
        circuit['bonding']['kind'] = bonding
    with pytest.raises(RatingRefused) as refused:
        prepare(d,parameters())
    assert refused.value.code == 'MULTICIRCUIT_ELECTRICAL_MODEL_REQUIRED'
    assert 'per_cable_losses' in str(refused.value)
    assert rate_group(prepare(d,parameters(d)))['verification']['passed']


def test_dielectric_heat_uses_half_the_full_t1_including_semiconductors():
    g = prepare(document('trefoil'),parameters())
    s = operating(g,[0,0,0])['cable_states'][0]
    # IEC 60287-1-1:2023 Eq.(1), zero-current energized cable; the assertion
    # includes the two separate screen resistances, which the old path omitted.
    expected = g.ambient+s['total_loss_w_m']*(sum(g.matrix[0])+s['t3_k_m_w'])+.5*s['t1_k_m_w']*s['dielectric_loss_w_m']
    assert s['conductor_temperature_c'] == pytest.approx(expected,abs=1e-6)
