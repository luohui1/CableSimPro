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
          {'id':'material/pvc','thermal_resistivity':6.},
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


@pytest.mark.parametrize('rho,individual,common,limiter', [
    (.6,434.994053841,417.384415865,0),
    (.8,315.085220337,386.973172426,1),
    (1.,None,362.238246202,1),
])
def test_three_duct_soil_sweep_distinguishes_conditional_and_common_capacity(rho,individual,common,limiter):
    # Numeric regression of saved inquiry eeb471e6-7909-4b8c-a8ef-2a08a2c71b95;
    # manufacturer dimensions plus declared engineering parameters, not a rating table.
    doc=document(); typ=doc['cable_types'][0];typ['core_lay_length']=2.152
    typ['common_layers']=[layer for layer in typ['common_layers'] if layer['role']!='binder']
    typ['common_layers'][0]['thickness']=.0002
    for core,(x,z) in zip(typ['cores'],[(0,.033/sqrt(3)),(-.0165,-.033/(2*sqrt(3))),(.0165,-.033/(2*sqrt(3)))]):
        core.update(x=x,z=z);core['conductor']['diameter']=.0206
        core['layers'][-1].update(thickness=.0002,longitudinal_r20=.0014249338001803575)
    for mat in doc['materials']:
        if mat['id']=='material/pvc':mat['thermal_resistivity']=6.
        if mat['id']=='material/soil':mat['thermal_resistivity']=rho
    circuit=doc['circuits'][0];section=doc['sections'][0]
    doc['circuits']=[];section['placements']=[];section['enclosures']=[]
    for index,x in enumerate([-.25,0.,.25]):
        c=deepcopy(circuit);cid=f'cable/{index}';c['id']=f'circuit/{index}';c['cables'][0]['id']=cid
        doc['circuits'].append(c)
        section['placements'].append({'cable':cid,'x':x,'z':-1.2,'enclosure':f'enclosure/{index}'})
        section['enclosures'].append({'id':f'enclosure/{index}','type':'duct','material':'material/duct','x':x,'z':-1.2,'inner_diameter':.14,'outer_diameter':.16,'contains':[cid]})
    doc['load_cases'][0]['currents']={c['id']:400. for c in doc['circuits']}
    result=rate_group(prepare(doc,{**parameters(),'rating_mode':'both'}))
    individual_result=result['circuit_ratings'][0];rated=result['simultaneous_rating']
    if individual is None:
        assert individual_result['ampacity_a'] is None
        assert not individual_result.get('cable_states')
    else:
        assert individual_result['ampacity_a']==pytest.approx(individual,abs=2e-5)
    assert individual_result['limiting_cable']==f'cable/{limiter}'
    assert rated['ampacity_a']==pytest.approx(common,abs=2e-5)
    assert rated['limiting_cable']=='cable/1'
    assert individual_result['rating_basis']['kind']=='conditional_fixed_load'
    assert individual_result['rating_basis']['fixed_currents_a']=={'cable/1':400.,'cable/2':400.}
    assert rated['rating_basis']['kind']=='common_balanced'
    assert rated['rating_basis']['fixed_currents_a']=={}
    # IEC 60287-2-1 image-source self/mutual paths rebuilt from geometry;
    # IEC 60287-1-1 4.2.1 frozen electrical state, whole-cable power (3 cores).
    states=rated['cable_states'];s=states[1]
    self_soil=rho/(2*pi)*acosh(2*1.2/.16)
    mutual=rho/(2*pi)*log(sqrt(.25**2+2.4**2)/.25)
    wall=6/(2*pi)*log(.16/.14)
    outer=.033*(1+2/sqrt(3))+2*(.0002+.002+.0016+.0037)
    air=1.87/(1+.1*(.312+.0037*(s['surface_temperature_c']+s['duct_inner_temperature_c'])/2)*outer*1000)
    cll=sqrt(1+(pi*1.29*.033/2.152)**2)
    t1=(2.5*log(.0222/.0206)+3.5*log(.0312/.0222)+2.5*log(.0326/.0312))/(2*pi*cll)
    x=.0022/.033
    t2=2*(.0142108+1.17533*x-4.49737*x*x+10.6352*x**3)
    t3=6/(2*pi)*log(outer/(outer-.0074))
    assert [s['t1_k_m_w'],s['t2_k_m_w'],s['t3_k_m_w']]==pytest.approx([t1,t2,t3],abs=1e-12)
    wd=3*2*pi*50*(2*pi*8.8541878128e-12*2.5*cll/log(.0312/.0222))*8700**2*.004
    assert s['dielectric_loss_w_m']==pytest.approx(wd,abs=1e-12)
    assert s['t4_self_soil_k_m_w']==pytest.approx(self_soil,abs=1e-12)
    assert s['t4_wall_k_m_w']==pytest.approx(wall,abs=1e-12)
    assert s['t4_air_gap_k_m_w']==pytest.approx(air,abs=1e-9)
    coefficient=constant=0.
    for j,q in enumerate(states):
        path=self_soil+wall+air+s['t3_k_m_w'] if j==1 else mutual
        coefficient+=3*q['ac_resistance_ohm_m']*(1+q['lambda1']+q['lambda2'])*path
        constant+=q['dielectric_loss_w_m']*path
        if j==1:
            coefficient+=q['ac_resistance_ohm_m']*(q['t1_k_m_w']+3*(1+q['lambda1'])*q['t2_k_m_w'])
            constant+=q['dielectric_loss_w_m']*(q['t2_k_m_w']+q['t1_k_m_w']/6)
        assert q['total_loss_w_m']==pytest.approx(3*rated['ampacity_a']**2*q['ac_resistance_ohm_m']*(1+q['lambda1']+q['lambda2'])+q['dielectric_loss_w_m'])
    assert rated['ampacity_a']==pytest.approx(sqrt((90-25-constant)/coefficient),abs=1e-5)


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


def test_common_bedding_is_part_of_figure6_not_a_separate_annulus():
    doc=document();layers=doc['cable_types'][0]['common_layers']
    original=prepare(doc,parameters()).cables[0]['model']
    # Same homogeneous region, same physical boundaries, different layer labels.
    layers[0]['thickness']=sum(l['thickness'] for l in layers[:3])
    del layers[1:3]
    merged=prepare(doc,parameters()).cables[0]['model']
    assert merged['t2']==pytest.approx(original['t2'],abs=1e-14)
    assert merged['overall']==pytest.approx(original['overall'],abs=1e-14)
    doc=document();next(m for m in doc['materials'] if m['id']=='material/pvc')['thermal_resistivity']=5.
    with pytest.raises(ValueError) as failure:prepare(doc,parameters())
    assert failure.value.code=='SL_FILLER_MATERIALS'
    assert failure.value.path=='/cable_types/0/common_layers'


@pytest.mark.parametrize('rho,expected',[(1.,565.476149321),(1.5,491.272366047)])
def test_yjv22_300_buried_components_and_independent_heat_balance(rho,expected):
    from backend.kernel.scenarios import system_models
    payload=next(m['payload'] for m in system_models() if m['id']=='system.specification-yjv22-300')
    doc=document();doc['cable_types']=[deepcopy(payload['cable_type'])]
    materials={m['id']:m for m in doc['materials']};materials.update({m['id']:deepcopy(m) for m in payload['materials']})
    materials['material/soil']['thermal_resistivity']=rho;doc['materials']=list(materials.values())
    doc['circuits'][0]['cable_type']=doc['cable_types'][0]['id']
    doc['provenance']={'/cable_types':{'reference':'Huayuan 3x300 public dimensions; declared engineering parameters; IEC 60287:2023'}}
    doc['sections'][0]['medium']['surface_temperature']=293.15
    doc['sections'][0]['placements'][0]['z']=-.8
    rated=rate_group(prepare(doc,parameters()))['circuit_ratings'][0];s=rated['cable_states'][0]
    assert rated['ampacity_a']==pytest.approx(expected,abs=2e-5)
    # Independent dimensions and IEC 2-1 4.1.4.2/5.6 Figure 6; SI throughout.
    x=.0022/.033;t2=2*(.0142108+1.17533*x-4.49737*x*x+10.6352*x**3)
    outer=.033*(1+2/sqrt(3))+2*(.0022+.0016+.0037)
    cll=sqrt(1+(pi*1.29*.033/2.152)**2)
    t1=(2.5*log(.0222/.0206)+3.5*log(.0312/.0222)+2.5*log(.0326/.0312))/(2*pi*cll)
    t3=6/(2*pi)*log(outer/(outer-.0074));t4=rho/(2*pi)*acosh(1.6/outer)
    assert [s['t1_k_m_w'],s['t2_k_m_w'],s['t3_k_m_w'],s['t4_self_soil_k_m_w']]==pytest.approx([t1,t2,t3,t4],abs=1e-12)
    # IEC 1-1 5.4.3.4, Eqs 17-20: lengths in mm in these two expressions.
    rc=s['ac_resistance_ohm_m'];diameter=(outer-.0074-.0016)*1000;delta=2*.8*60/(60+30)
    assert rc==pytest.approx(7.946448663834777e-5,abs=5e-13)
    k=1/(1+diameter/(300*delta))
    l2=33**2*k*k*1e-7/(rc*diameter*delta)+2.25*33**2*k*k*delta*1e-8/(rc*diameter)
    assert s['lambda2']==pytest.approx(l2,abs=1e-12)
    rs=.0014249338001803575*(1+.00393*(s['sheath_temperature_c']-20))
    reactance=2*2*pi*50*1e-7*log(2*.033/.0328)*cll
    l1=1.5*rs/rc/(1+(rs/reactance)**2)
    assert s['lambda1']==pytest.approx(l1,abs=1e-10)
    wd=s['dielectric_loss_per_core_w_m']
    hand=sqrt((70-wd*(.5*t1+3*(t2+t3+t4)))/(rc*(t1+3*(1+l1)*t2+3*(1+l1+l2)*(t3+t4))))
    assert rated['ampacity_a']==pytest.approx(hand,abs=2e-5)


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


def test_simultaneous_capacity_survives_runaway_target_and_is_load_independent():
    doc=document()
    for n in (2,3):
        circuit=deepcopy(doc['circuits'][0]);circuit.update(id=f'circuit/c{n}',label=f'回路 {n}',cables=[{'id':f'cable/c{n}','phase':'L1L2L3'}])
        doc['circuits'].append(circuit)
        doc['sections'][0]['placements'].append({'cable':f'cable/c{n}','x':.25*(n-1),'z':-1.2})
    params={**parameters(),'rating_mode':'both'}
    values=[]
    for target in (100.,1000.):
        doc['load_cases'][0]['currents']={c['id']:target for c in doc['circuits']}
        result=rate_group(prepare(doc,params));common=result['simultaneous_rating']
        values.append(common['ampacity_a'])
        assert common['ampacity_a']>0 and result['verification']['passed']
        assert max(s['conductor_temperature_c'] for s in common['cable_states'])==pytest.approx(90,abs=1e-4)
        if target==1000:
            assert result['operating']['status']=='unavailable'
            assert result['operating']['cable_states']==[]
            assert all(r['ampacity_a'] is None for r in result['circuit_ratings'])
    assert values[0]==values[1]


def test_worker_keeps_capacity_when_target_has_no_temperature_solution(tmp_path):
    from backend.plugin_host import Executor
    doc=document();doc['load_cases'][0]['currents']['circuit/c1']=1000.
    result=Executor(jobs_root=tmp_path).run('cablesim.iec60287','steady-rating',[
        {'case_id':'overload','input':doc,'parameters':{**parameters(),'rating_mode':'both'}}])
    case=result.cases[0]
    assert case.status=='succeeded',case.error
    assert next(r for r in case.results if r.get('case')=='rating-simultaneous')['value']>0
    trace=case.artifacts['x-cablesim.iec60287-trace']
    assert trace['operating']['status']=='unavailable' and trace['operating']['cable_states']==[]
