"""Actual P1 half-space comparison, with unavailable results on failed gates."""
from copy import deepcopy
from math import acosh,pi,sqrt
from pathlib import Path
import sys
import pytest

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'plugins/cablesim.simulation/validation'),str(ROOT/'plugins/cablesim.simulation/src'),str(ROOT/'plugins/cablesim.iec60287/src')]
from iec_fem_example import case
from cablesim_simulation.iec_comparison import prepare,calculate


def test_native_loss_feedback_preserves_r20_and_changes_with_temperature(tmp_path):
    from iec_fem_example import feedback_case
    from cablesim_iec60287.domain import prepare as iec_prepare
    from cablesim_simulation.thermal_input import prepare as thermal_prepare
    from cablesim_simulation.thermal import ThermalSystem
    from cablesim_simulation.constitutive_losses import NativeLossFeedback
    item = feedback_case();d = item['input'];p = item['parameters'];s = d['sections'][0]
    d['circuits'] = d['circuits'][:1];circuit = d['circuits'][0]['id']
    members = {c['id'] for c in d['circuits'][0]['cables']}
    s['placements'] = [q for q in s['placements'] if q['cable'] in members]
    s['enclosures'] = [e for e in s['enclosures'] if e['contains'][0] in members]
    p['iec']['per_cable_losses'] = {u:f for u,f in p['iec']['per_cable_losses'].items() if u in members}
    d['load_cases'][0]['currents'] = {circuit:150.};p['controls']['rated_circuit'] = circuit
    p['bounds_m'] = [-2.,-3.,2.,0.]
    p['controls'].update(element_order=1,mesh_size_m=.002,far_mesh_size_m=.2,near_soil_mesh_size_m=.06,
                         mesh_transition_m=.5,fine_mesh_band_m=.001,max_nodes=100000)
    prepared = prepare(d,p);model,cfg = thermal_prepare(prepared[1],prepared[2])
    system = ThermalSystem(model,cfg)
    group = iec_prepare(prepared[5],p['iec'])
    native = NativeLossFeedback(system,d,group,'Numerical R20-matched continuous uninsulated round conductor; nonmagnetic region means.',tmp_path)
    np = system.np;currents = [150.]*3
    cold = native(currents,np.full(system.basis.N,293.15))
    warm = native(currents,np.full(system.basis.N,343.15))
    rows = {r['entity']:r for r in native.history[-1]['electrical_rows']}
    for cable,a,b in zip(model.cables,cold,warm):
        expected = cable.electrical.r20_ohm_m*(1+cable.electrical.alpha20_per_k*50)
        row = rows[cable.layers[0].uid]
        assert row['dc_resistance_ohm_m'] == pytest.approx(expected,rel=1e-10)
        assert row['current_rms_a'] == pytest.approx(150.,rel=1e-7)
        assert b['conductor'] >= 150**2*expected
        assert b['conductor'] > a['conductor']
        assert a['sheath'] > 0 and b['sheath'] > 0
    system.loss_evaluator = native
    state = system.state(currents)
    assert state['energy_relative_residual'] < 1e-6
    assert len(native.history) > 3


def isolated():
    item=case();d=item['input'];p=item['parameters'];s=d['sections'][0]
    d['circuits']=d['circuits'][:1];d['circuits'][0]['cables']=d['circuits'][0]['cables'][:1]
    uid=d['circuits'][0]['cables'][0]['id'];circuit=d['circuits'][0]['id']
    s['placements']=[{'cable':uid,'x':0.,'z':-1.2,'enclosure':None}]
    s['soil_layers']=[];s['backfill']=None;s['enclosures']=[]
    d['load_cases'][0]['currents']={circuit:150.}
    p['iec']['per_cable_losses']={uid:{'ac_extra_factor':0.,'lambda1':0.}}
    p['controls']['rated_circuit']=circuit
    # Remove dielectric loss for a directly hand-reproducible radial balance.
    for m in d['materials']:
        if m.get('loss_tangent') is not None:m['loss_tangent']=0.
    return item


def test_three_circuit_coupled_small_pilot(tmp_path):
    import json
    from iec_fem_example import feedback_case
    from cablesim_iec60287.domain import prepare as iec_prepare
    from cablesim_simulation.thermal_input import prepare as thermal_prepare
    from cablesim_simulation.thermal import ThermalSystem
    from cablesim_simulation.constitutive_losses import NativeLossFeedback
    item = feedback_case();p = item['parameters']
    p['bounds_m'] = [-8.,-8.,8.,0.]
    p['controls'].update(element_order=2,mesh_size_m=.003,far_mesh_size_m=.7,near_soil_mesh_size_m=.06,
                         mesh_transition_m=2.,fine_mesh_band_m=.0002,max_nodes=200000,
                         tolerance_k=1e-4,current_upper_a=750.,current_tolerance_a=.1)
    prepared = prepare(item['input'],p);model,cfg = thermal_prepare(prepared[1],prepared[2])
    system = ThermalSystem(model,cfg)
    native = NativeLossFeedback(system,prepared[1],iec_prepare(prepared[5],p['iec']),p['feedback']['source'],tmp_path)
    system.loss_evaluator = native
    result,field = system.solve()
    evidence = ROOT/'artifacts/coupled-rating-pilot.json';evidence.parent.mkdir(exist_ok=True)
    evidence.write_text(json.dumps({'input':item,'result':result,'native_loss_history':native.history,
        'mesh':{'nodes':len(field['points']),'triangles':len(field['triangles'])},
        'status':'pilot_only_mesh_and_domain_not_yet_converged'},ensure_ascii=False,indent=2),'utf-8')
    assert result['energy_relative_residual'] < 1e-6
    assert len(result['duct_air_states']) == 9
    assert all(c['conductor_max_temperature_k']<=c['limit_k']+1e-5 for c in result['cables'])
    assert any(c['sheath_joule_heat_w_m']>0 for c in result['cables'])


def test_native_uniform_comparison_matches_hand_halfspace_and_gates():
    item=isolated();prepared=prepare(item['input'],item['parameters'])
    result,bundle=calculate(prepared)
    import json
    evidence=ROOT/'artifacts/iec-fem-hand.json';evidence.parent.mkdir(exist_ok=True)
    evidence.write_text(json.dumps({'comparison':result,'levels':bundle['mesh_history']},ensure_ascii=False,indent=2),'utf-8')
    assert result['valid'],result['convergence']
    state=prepared[4]['cable_states'][0];c=prepared[1]['cable_types'][0]
    radius=c['cores'][0]['conductor']['diameter']/2+sum(l['thickness'] for l in c['cores'][0]['layers']+c['common_layers'])
    t4=.7*acosh(1.2/radius)/(2*pi)
    hand=sqrt((state['temperature_limit_c']-prepared[1]['sections'][0]['medium']['surface_temperature']+273.15)/
        (state['ac_resistance_ohm_m']*(state['t1_k_m_w']+state['t3_k_m_w']+t4)))
    assert result['iec']['ampacity_a']==pytest.approx(hand,rel=1e-5)
    assert result['fem']['ampacity_a']==pytest.approx(hand,rel=.003)
    assert len(bundle['mesh_history'])==4
    tighter=deepcopy(item);tighter['parameters']['ampacity_tolerance_a']=1e-12
    failed,_=calculate(prepare(tighter['input'],tighter['parameters']))
    assert not failed['valid'] and failed['fem']['ampacity_a'] is None
    assert failed['iec_over_fem_percent'] is None and failed['judgment']=='unavailable'
