"""Hand-derived SL heat balance, source/data gates and controlled TB880 checks."""
from copy import deepcopy
from math import acosh, log, pi, sqrt
from pathlib import Path
import json
import pytest

from cablesim_iec60287.three_core import prepare, operating, filler_factor, steel_tape_loss, steel_wire_loss
from cablesim_iec60287.group import rate_group


def document(armour='tape'):
    # Explicit hand-check design, not a manufacturer's product or approved model.
    d=.02;core_outer=.0322;c=core_outer/sqrt(3)
    mats=[{'id':'material/cu','thermal_resistivity':.0025,'electrical_resistivity_20':1.7241e-8,'temperature_coefficient_20':.00393},
          {'id':'material/xlpe','thermal_resistivity':3.5,'relative_permittivity':2.5,'loss_tangent':.004},
          {'id':'material/semi','thermal_resistivity':2.5}, {'id':'material/fibre','thermal_resistivity':6.},
          {'id':'material/pvc','thermal_resistivity':5.},
          {'id':'material/steel','relative_permeability':300,'temperature_coefficient_20':.0045},
          {'id':'material/soil','thermal_resistivity':1.2}, {'id':'material/duct','thermal_resistivity':6.}]
    cond={'material':'material/cu','form':'stranded_round_compacted','nominal_area':300e-6,'diameter':d,'r20':6.01e-5}
    layers=[{'role':r,'material':m,'thickness':t} for r,m,t in [('conductor_screen','material/semi',.0008),('insulation','material/xlpe',.0045),('insulation_screen','material/semi',.0007)]]
    layers.append({'role':'metallic_screen','material':'material/cu','thickness':.0001,'form':'tape','longitudinal_r20':.002})
    common=[{'role':'filler','material':'material/fibre','thickness':.0005},{'role':'binder','material':'material/fibre','thickness':.0002},{'role':'bedding','material':'material/pvc','thickness':.002}]
    if armour:
        a={'role':'armour','material':'material/steel','thickness':.0016 if armour=='tape' else .003,'form':armour}
        if armour=='tape':a.update(nominal_tape_thickness=.0008,tape_width=.06,tape_gap=.03,tape_count=2,tape_application='two_tape_gap')
        else:a.update(longitudinal_r20=.0002,longitudinal_resistance_basis='power_frequency_ac',longitudinal_resistance_frequency=50.,wire_diameter=.003,wire_count=70,lay_length=1.)
        common.append(a)
    common.append({'role':'oversheath','material':'material/pvc','thickness':.0037})
    return {'schema_version':'cablesim.domain/1','name':'explicit hand calculation','materials':mats,
            'cable_types':[{'id':'cable_type/hand','construction':'three_core','label':'hand','core_lay_length':1.2,
                'rating':{'u0':8700.,'u':15000.,'max_conductor_temperature':{'normal':363.15}},
                'cores':[{'id':'core/'+n,'conductor':deepcopy(cond),'layers':deepcopy(layers),'x':x,'z':z} for n,x,z in [('A',0,c),('B',-core_outer/2,-c/2),('C',core_outer/2,-c/2)]],'common_layers':common}],
            'circuits':[{'id':'circuit/c1','label':'回路 1','cable_type':'cable_type/hand','system':{'kind':'ac_three_phase','frequency':50.},'cables':[{'id':'cable/c1','phase':'L1L2L3'}],'bonding':{'kind':'both_ends'}}],
            'sections':[{'id':'section/ground','kind':'ground','length':100,'label':'ground','medium':{'material':'material/soil','surface_temperature':298.15},'placements':[{'cable':'cable/c1','x':0.,'z':-1.2}], 'enclosures':[]}],
            'load_cases':[{'id':'load/steady','kind':'steady','currents':{'circuit/c1':400.}}],'criteria':{'max_conductor_temperature':363.15},
            'provenance':{'/cable_types/cable_type/hand':{'kind':'user','reference':'Explicit primitive SI hand-check design; screen R20, lay and gaps are given test inputs, not manufacturer facts','reviewed':False}}}


def parameters():
    return {'ks':1.,'kp':1.,'solver':{'initial_sheath_temperature_c':70,'max_iterations':300,'current_tolerance_a':1e-7},'duct':{'u':1.87,'v':.312,'y_per_k':.0037,'initial_mean_air_temperature_c':50.}}


@pytest.mark.parametrize('armour',[None,'tape','wires'])
@pytest.mark.parametrize('duct',[False,True])
def test_full_three_core_hand_quadratic_and_power_basis(armour,duct):
    doc=document(armour)
    if duct:
        doc['sections'][0]['enclosures']=[{'id':'enclosure/duct','type':'duct','material':'material/duct','x':0.,'z':-1.2,'inner_diameter':.14,'outer_diameter':.16,'contains':['cable/c1']}]
        doc['sections'][0]['placements'][0]['enclosure']='enclosure/duct'
    group=prepare(doc,parameters());result=rate_group(group);rated=result['circuit_ratings'][0];s=rated['cable_states'][0]
    # Rebuild external path directly from dimensions, without the solver matrix.
    diameter=.16 if duct else group.cables[0]['model']['overall']
    soil=1.2/(2*pi)*acosh(2*1.2/diameter)
    wall=6/(2*pi)*log(.16/.14) if duct else 0.
    mean=(s['surface_temperature_c']+s['duct_inner_temperature_c'])/2
    air=1.87/(1+.1*(.312+.0037*mean)*group.cables[0]['model']['overall']*1000) if duct else 0.
    outer=s['t3_k_m_w']+soil+wall+air
    numerator=65-s['dielectric_loss_per_core_w_m']*(.5*s['t1_k_m_w']+3*(s['t2_k_m_w']+outer))
    denominator=s['ac_resistance_ohm_m']*(s['t1_k_m_w']+3*(1+s['lambda1'])*s['t2_k_m_w']+3*(1+s['lambda1']+s['lambda2'])*outer)
    assert rated['ampacity_a']==pytest.approx(sqrt(numerator/denominator),abs=2e-5)
    assert s['conductor_temperature_c']==pytest.approx(90,abs=1e-5)
    assert s['conductor_loss_w_m']==pytest.approx(3*rated['ampacity_a']**2*s['ac_resistance_ohm_m'])
    assert s['total_loss_w_m']==pytest.approx(s['conductor_loss_w_m']+s['sheath_loss_w_m']+s['armour_loss_w_m']+s['dielectric_loss_w_m'])
    assert len(s['cores'])==3 and result['verification']['passed']


def test_two_circuits_each_real_source_loss_and_other_current_held():
    doc=document();other=deepcopy(doc['circuits'][0]);other.update(id='circuit/c2',label='回路 2',cables=[{'id':'cable/c2','phase':'L1L2L3'}]);doc['circuits'].append(other)
    doc['sections'][0]['placements'].append({'cable':'cable/c2','x':.25,'z':-1.2});doc['load_cases'][0]['currents']={'circuit/c1':300.,'circuit/c2':200.}
    result=rate_group(prepare(doc,parameters()))
    for q in result['circuit_ratings']:
        other_id='cable/c2' if q['entity']=='circuit/c1' else 'cable/c1'
        assert q['held_currents_a'][other_id]==(200 if other_id=='cable/c2' else 300)
    assert result['heat_contributions'][1]['source_loss_w_m']!=result['heat_contributions'][0]['source_loss_w_m']


@pytest.mark.parametrize('change,reason',[
    (lambda d:d['cable_types'][0].pop('core_lay_length'),'core_lay_length'),
    (lambda d:[c['layers'][-1].pop('longitudinal_r20') for c in d['cable_types'][0]['cores']],'longitudinal_r20'),
    (lambda d:d['cable_types'][0]['common_layers'][-2].pop('tape_gap'),'tape_gap'),
    (lambda d:d['circuits'][0]['bonding'].update(kind='single_point'),'连接拓扑'),
    (lambda d:d['cable_types'][0]['common_layers'][-2].update(nominal_tape_thickness=.0012),'两层'),
])
def test_missing_or_unsupported_never_invents_a_result(change,reason):
    d=document();change(d)
    with pytest.raises(ValueError,match=reason):prepare(d,parameters())


@pytest.mark.parametrize('basis,frequency',[(None,50.),('dc',50.),('power_frequency_ac',60.)])
def test_steel_wire_requires_ac_resistance_at_the_circuit_frequency(basis,frequency):
    d=document('wires');layer=d['cable_types'][0]['common_layers'][-2]
    layer.update(longitudinal_resistance_basis=basis,longitudinal_resistance_frequency=frequency)
    with pytest.raises(ValueError,match='工频交流纵向电阻'):prepare(d,parameters())


TB=Path(__file__).resolve().parents[3]/'.data/tb880/fixtures/tb880-three-core.json'


@pytest.mark.skipif(not TB.exists(),reason='controlled TB880 three-core intermediate extraction absent')
def test_tb880_case10_tape_and_case2_wire_intermediates():
    f=json.loads(TB.read_text('utf-8'));t=f['case10'];r=steel_tape_loss(**t['input'])
    for key,value in t['expected'].items():assert r[key]==pytest.approx(value,abs=5e-11 if key=='k_at_50hz' else 2e-12)
    w=f['case2']['wire'];data=dict(w['input']);data['ra']*=1+.0045*(71.30854666589-20);r=steel_wire_loss(**data)
    assert r['total']==pytest.approx(w['expected'],abs=1e-9)
    thermal=f['case2']['thermal'];cll=sqrt(1+(pi*1.29*.0621/2.152)**2)
    layers=[(.03,.0305,6),(.0305,.0325,2.5),(.0325,.0485,3.5),(.0485,.0503,2.5),(.0503,.0525,12)]
    t1=sum(rho/(2*pi)*log(outer/inner) for inner,outer,rho in layers)/cll
    t2=2.5/(2*pi)*log(.0621/.0571)/cll/3+6/(6*pi)*filler_factor((.1373-.1349)/2/.0621)
    t3=6/(2*pi)*log(.1553/.1493);t4=.7/(2*pi)*acosh(2/.1553)
    for key,value in {'cll':cll,'t1':t1,'t2':t2,'t3':t3,'t4':t4}.items():assert value==pytest.approx(thermal[key],abs=1e-9)


def test_tape_frequency_scaling_and_geometry_gate():
    args=(.0001,.03,.08,.001,300)
    a=steel_tape_loss(*args,50.,.0005);b=steel_tape_loss(*args,60.,.0005)
    assert b['total']==pytest.approx(a['total']*1.44)
    with pytest.raises(ValueError,match='0.3'):steel_tape_loss(*args,50.,.0002)
    with pytest.raises(ValueError,match='图6'):filler_factor(.16)
