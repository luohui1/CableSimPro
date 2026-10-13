"""Original IEC 60287-3-3:2007 Annex A Table A.1/A.2, pp.13/14.

Published rounded validation values, not manufacturer dimensions or test ratings.
"""
from math import pi, sqrt
import pytest
from cablesim_iec60287.crossing import derate, sources_for, apply
from cablesim_iec60287.three_core import prepare
from cablesim_iec60287.group import rate_group
from cablesim_iec60287.method import RatingRefused
from test_three_core import document, parameters


def example(angle=pi/2,depth=.9):
    return derate(current_a=665,resistance_ohm_m=.0781e-3,alpha20_per_k=.00393,
        area_m2=300e-6,conductor_rho_k_m_w=.0026,cores=1,t1=.214,t2=0,t3=.104,t4=1.427,
        lambda1=.089,lambda2=0,dielectric_w_m=0,limit_c=90,ambient_c=25,depth_m=1.2,soil_rho_k_m_w=.8,
        sources=[{'label':'132 kV cable','depth_m':depth,'diameter_m':.1,'angle_rad':angle,'heat_w_m':3*25.90,'source':'IEC 60287-3-3:2007 Table A.1 p.13'}])


def test_annex_a2_intermediate_values_and_printed_factor():
    value=example()
    assert value['longitudinal_resistance_k_per_w_m']==pytest.approx(8.6666666667)
    assert value['radial_resistance_k_m_w']==pytest.approx(1.745)
    assert value['weighted_resistance_k_m_w']==pytest.approx(1.881259)
    # Table A.2 truncates its first estimate to 19.2; Eq.(13) with A.1 inputs:
    assert value['first_estimate_rise_k']==pytest.approx(19.251027775205653,abs=1e-10)
    assert value['crossing_rise_k']==pytest.approx(14.1,abs=.05)
    # Printed 0.89 is coarser than the printed 14.1 K substituted in Eq.(1).
    # Validate the equation and propagated temperature rounding, not a widened DF tolerance.
    assert value['derating_factor']==pytest.approx(sqrt(1-value['crossing_rise_k']/65),abs=1e-12)
    assert value['derating_factor']==pytest.approx(sqrt(1-14.1/65),abs=.05/(2*65*.88))
    assert all(s['dz_m']*value['history'][-1]['gamma_per_m']<.01 for s in value['sources'])
    assert sum(s['omitted_rise_bound_k'] for s in value['sources'])<1e-8


def test_distance_and_crossing_angle_limits():
    orthogonal=example();oblique=example(pi/12);far=example(depth=1e6)
    assert 0<oblique['derating_factor']<orthogonal['derating_factor']<1
    assert far['derating_factor']==pytest.approx(1,abs=1e-6)


def test_integrated_rating_and_scope_gates_keep_baseline_evidence(tmp_path):
    doc=document();doc['materials'][0]['standard_kind']='copper_bare'
    source={'label':'热力管','depth_m':.6,'diameter_m':.1,'angle_rad':pi/2,'heat_w_m':50,'source':'工程师给定手算测试'}
    group=prepare(doc,{**parameters(),'rating_mode':'both','crossing_heat_sources':[source]})
    original=rate_group(group);baseline=original['circuit_ratings'][0]['ampacity_a']
    value=apply(group,original);result=value['crossing_derating'][0]
    assert result['baseline_current_a']==baseline
    assert value['circuit_ratings'][0]['ampacity_a']==pytest.approx(baseline*result['derating_factor'])
    assert not value['operating']['cable_states']  # Never label the uncorrected 2D temperature as crossing temperature.
    group.parameters['crossing_heat_sources'].append(dict(source))
    combined=apply(group,rate_group(group))['crossing_derating'][0]
    assert combined['derating_factor']<result['derating_factor']
    assert len(combined['sources'])==2
    from backend.plugin_host import Executor
    executed=Executor(jobs_root=tmp_path).run('cablesim.iec60287','steady-rating',[
        {'case_id':'crossing','input':doc,'parameters':{**parameters(),'crossing_heat_sources':[source]}}])
    actual=executed.cases[0]
    assert actual.status=='succeeded',actual.error
    assert actual.value('ampacity','circuit/c1')==pytest.approx(result['derated_current_a'])
    assert 'x-cablesim.temperature-field' not in actual.artifacts
    from backend.plugin_host.registry import Registry
    version = Registry(plugin_id='cablesim.iec60287').get('cablesim.iec60287').manifest.version
    assert actual.artifacts['x-cablesim.iec60287-trace']['source']['plugin_version'] == version
    from backend.kernel.drivers import compare
    from dataclasses import asdict
    saved={'id':'a','snapshot':{'cases':[{'input':doc,'parameters':{}}],'definition':{'method':{}}},
           'output':{'cases':[asdict(case) for case in executed.cases]}}
    compared=compare([saved,{**saved,'id':'b'}])['differences'][0]['quantities']
    assert next(row for row in compared if row['key']=='x-cablesim.iec60287.crossing.derating_factor')['title']=='交叉热源降额系数'
    group.parameters['crossing_heat_sources'][0]['depth_m']=1.2
    with pytest.raises(RatingRefused,match='正净距'):sources_for(group)


def test_public_qifan_flat_single_core_group_and_independent_integral(tmp_path):
    """Real published model + declared engineering layout; no synthetic losses.

    Annex A Table A.1 uses the hottest cable's group-effective T4, including
    its two neighbours. Independent Simpson integration of the Kennelly image
    kernel checks Eq.(2), while Eq.(3)/(8)/(9) are iterated separately below.
    This is a cross-check, not a claim to reproduce a Qifan factory rating.
    """
    from copy import deepcopy
    from math import exp, log1p, sin
    from backend.domain.migration import convert
    from backend.schemas import Scenario
    from backend.kernel.model_series import hv_payload, hv_study_document, bundled_hv
    from cablesim_iec60287.domain import prepare as single_prepare
    from backend.plugin_host import Executor
    model=hv_payload();doc=convert(Scenario().model_dump())['document']
    material_ids={m['id'] for m in model['materials']}
    doc['materials']=[m for m in doc['materials'] if m['id'] not in material_ids]+deepcopy(model['materials'])
    doc['cable_types']=[deepcopy(model['cable_type'])]
    doc['circuits'][0]['cable_type']=model['cable_type']['id']
    doc=hv_study_document({'domain':doc})
    doc['load_cases'][0]['currents'][doc['circuits'][0]['id']]=bundled_hv()[0]['scenario']['target_current_a']
    p=deepcopy(bundled_hv()[0]['parameters'])
    heat={'label':'参考热力管','depth_m':1.5,'diameter_m':.1,'angle_rad':pi/2,
          'heat_w_m':20.,'source':'工程师给定正交管道参考工况；非厂家额定值'}
    p.update(rating_mode='simultaneous',crossing_heat_sources=[heat])
    # The release scenario is touching trefoil: no invented derated result.
    with pytest.raises(RatingRefused,match='第 1 条'):
        sources_for(single_prepare(doc,p))
    depth=bundled_hv()[0]['scenario']['centre_depth_m']
    for place,x in zip(doc['sections'][0]['placements'],[-.2,0.,.2]):
        place.update(x=x,z=-depth)
    doc['sections'][0]['layout_template'].update(kind='flat',depth=depth,spacing=.2)
    group=single_prepare(doc,p);base=rate_group(group)['simultaneous_rating']
    state=min(base['cable_states'],key=lambda s:s['margin_k'])
    t4=state['external_temperature_rise_k']/state['total_loss_w_m']
    assert t4>state['t4_self_soil_k_m_w']  # Neighbour losses must not disappear.
    tl=.0026/model['cable_type']['cores'][0]['conductor']['nominal_area']
    tr=state['t1_k_m_w']+state['t3_k_m_w']+t4
    weighted=state['t1_k_m_w']+(1+state['lambda1'])*(state['t3_k_m_w']+t4)
    wd=state['dielectric_loss_w_m']
    budget=state['temperature_limit_c']-group.ambient-wd*(state['t1_k_m_w']/2+state['t3_k_m_w']+t4)
    alpha=group.cables[0]['rating'].conductor.alpha20_per_k
    dw0=state['ac_resistance_ohm_m']*alpha*base['ampacity_a']**2/(1+alpha*(state['temperature_limit_c']-20))
    soil=next(m for m in doc['materials'] if m['id']==doc['sections'][0]['medium']['material'])['thermal_resistivity']
    rise=0.;n=16000;du=32/n
    for _ in range(100):
        gamma=sqrt((1-dw0*(1-rise/budget)*weighted)*tl/tr)
        def integrand(u):
            return exp(-u)*log1p(4*depth*heat['depth_m']/((depth-heat['depth_m'])**2+(u*sin(heat['angle_rad'])/gamma)**2))
        integral=du/3*(integrand(0)+integrand(32)+sum((4 if i%2 else 2)*integrand(i*du) for i in range(1,n)))
        new=heat['heat_w_m']*soil/(4*pi)*integral
        if abs(new-rise)<1e-9:break
        rise=new
    else:raise AssertionError('Independent integral did not converge')
    actual=Executor(jobs_root=tmp_path).run('cablesim.iec60287','steady-rating',[
        {'case_id':'qifan-flat-crossing','input':doc,'parameters':p}]).cases[0]
    assert actual.status=='succeeded',actual.error
    records=actual.artifacts['x-cablesim.iec60287-trace']['crossing_derating']
    common=records[-1]
    assert common['t4_group_effective_k_m_w']==pytest.approx(t4)
    assert common['rated_cable']==state['entity']
    assert common['crossing_rise_k']==pytest.approx(new,abs=.05)
    assert common['derating_factor']==pytest.approx(sqrt(1-new/budget),abs=.0005)
    assert actual.value('ampacity',doc['circuits'][0]['id'])==pytest.approx(common['derated_current_a'])
    print({'baseline_a':common['baseline_current_a'],'derated_a':common['derated_current_a'],
           'factor':common['derating_factor'],'plugin_rise_k':common['crossing_rise_k'],
           'independent_rise_k':new,'t4_self':state['t4_self_soil_k_m_w'],
           't4_group':t4,'TL':tl,'Tr':tr,'weighted':weighted})
