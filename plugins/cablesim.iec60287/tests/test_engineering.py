"""Public invented geometry; resistance hand check and GB nominal-size branch."""
from copy import deepcopy
from math import pi, sqrt
import pytest
from cablesim_iec60287.engineering import complete, nominal_steel_gauge
from cablesim_iec60287.engineering_contract import EngineeringParameters, FORM_FIELDS


def specification():
    dimensions={'conductor_diameter':.0206,'conductor_screen_thickness':.0008,
      'insulation_thickness':.0045,'insulation_screen_thickness':.0007,
      'metallic_screen_tape_thickness':.0001,'metallic_screen_tape_width':.04,
      'binder_tape_thickness':.0002,'bedding_thickness':.002,
      'armour_tape_thickness':.0008,'armour_tape_width':.06,
      'oversheath_thickness':.0037,'outer_diameter':.0861}
    values={k:{'value':v,'unit':'m','basis':'manufacturer','source':'/fixture'} for k,v in dimensions.items()}
    values['r20']={'value':6.01e-5,'unit':'ohm/m','basis':'standard_limit','source':'/fixture'}
    return {'name':'公开构造手算','version':'1','specification':{'cores':3,'designation':'YJV22',
      'u0_v':8700,'voltage_v':15000,'conductor':'copper_bare','area_m2':.0003,'values':values},
      'sources':{'/fixture':{'kind':'demo','reference':'公开自定义输入；不作为厂家样本','reviewed':False}}}


def parameters():
    return {'values':{f['key']:{'value':f['example'],'unit':f['unit'],'reference':f['reference']}
                     for f in FORM_FIELDS if 'example' in f}}


def test_continuous_contact_resistance_and_geometry_hand_check():
    source=specification();before=deepcopy(source);value=complete(source,parameters())
    # d_inside=32.6 mm; chosen radial envelope 0.2 mm; d_mean=32.8 mm.
    area=pi*.0328*.0001/.85
    cll=sqrt(1+(pi*1.29*.033/2.152)**2)
    assert value['derived']['copper_tape_area_m2']==pytest.approx(area,abs=1e-16)
    assert value['derived']['screen_longitudinal_r20_ohm_m']==pytest.approx(1.7241e-8/area*cll,abs=1e-14)
    assert value['derived']['model_outer_diameter_m']==pytest.approx(.033*(1+2/sqrt(3))+2*(.0002+.002+.0016+.0037),abs=1e-14)
    assert source==before
    assert value['engineering_parameters']==parameters()
    assert value['sources']['/engineering_parameters/core_lay_length']['kind']=='user'
    assert next(m for m in value['materials'] if m['id']=='material/pvc')['thermal_resistivity']==6


def test_standard_nominal_steel_gauge_uses_fictitious_diameter():
    source=specification();spec=source['specification']
    # Annex A: (19.5+2*4.5+3+0.5)*2.16=69.1; +1.2+1.6=71.9 mm.
    assert nominal_steel_gauge(spec,.0001,.04)==(.0008,71.9)
    del spec['values']['armour_tape_thickness']
    model=complete(source,parameters())
    assert model['cable_type']['common_layers'][2]['nominal_tape_thickness']==.0008
    assert model['sources']['/derived/armour_tape_thickness']['kind']=='standard'


@pytest.mark.parametrize('key,value,unit', [('core_lay_length',0,'m'),('filler_rho',-1,'K*m/W'),
    ('armour_gap_ratio',.6,'1'),('core_lay_length',2,'mm'),('steel_relative_permeability',True,'1')])
def test_bad_parameter_stops_at_field(key,value,unit):
    data=parameters();data['values'][key].update(value=value,unit=unit)
    with pytest.raises(ValueError):EngineeringParameters.model_validate(data)


def test_missing_fields_and_explicit_resistance_model():
    with pytest.raises(ValueError) as missing:
        EngineeringParameters.model_validate({'values':{}})
    assert {('values','core_lay_length'),('values','screen_model'),('values','filler_rho')} <= {
        error['loc'] for error in missing.value.errors()}
    data=parameters();data['values']['screen_model']['value']='given_r20'
    with pytest.raises(ValueError,match='screen_longitudinal_r20'):complete(specification(),data)
    data['values']['screen_longitudinal_r20']={'value':.002,'unit':'ohm/m','reference':'工程师给定试验参考输入'}
    assert complete(specification(),data)['derived']['screen_longitudinal_r20_ohm_m']==.002


def test_source_and_dimension_closure_fail_closed():
    data=parameters();data['values']['core_lay_length']['reference']=' '
    with pytest.raises(ValueError,match='出处'):complete(specification(),data)
    source=specification();source['specification']['values']['outer_diameter']['value']=.07
    with pytest.raises(ValueError,match='screen_radial_factor'):complete(source,parameters())


@pytest.mark.parametrize('area,dc,bedding,outer,diameter',[(70,10.,1.5,2.8,59.2),(150,14.6,1.7,3.2,70.3),(240,18.5,1.9,3.5,79.7)])
def test_public_rounding_and_manufacturing_allowance_restore_candidates(area,dc,bedding,outer,diameter):
    source=specification();spec=source['specification'];spec['area_m2']=area*1e-6
    spec['values']['r20']['value']={70:.268,150:.124,240:.0754}[area]/1000
    for key,value in {'conductor_diameter':dc,'bedding_thickness':bedding,'armour_tape_thickness':.5,
                      'oversheath_thickness':outer,'outer_diameter':diameter}.items():
        spec['values'][key]['value']=value/1000
    reference=f'江苏华远 YJV22 公开网页 四、结构尺寸 3×{area} 行；HTML无PDF页码'
    source['sources']['/fixture']={'kind':'asset','reference':reference,'reviewed':False}
    original=deepcopy(source)
    core=dc+2*(.8+4.5+.7+.1*2)
    derived=core*(1+2/sqrt(3))+2*(.2+bedding+1.+outer)
    result=complete(source,parameters())
    assert result['derived']['model_outer_diameter_m']==pytest.approx(derived/1000)
    assert result['derived']['diameter_closure_tolerance_m']==pytest.approx(.00005+max(.0005,.01*diameter/1000))
    assert result['derived']['reported_outer_diameter_m']==diameter/1000
    assert source==original
    # Completion must restore a runnable candidate, not merely suppress the error.
    from test_three_core import document, parameters as rating_parameters
    from cablesim_iec60287.three_core import prepare
    from cablesim_iec60287.group import rate_group
    domain=document();cable=deepcopy(result['cable_type']);cable['id']=domain['cable_types'][0]['id']
    domain['cable_types']=[cable]
    domain['materials']=list({m['id']:m for m in [*domain['materials'],*result['materials']]}.values())
    domain['load_cases'][0]['currents']={'circuit/c1':0.}
    assert rate_group(prepare(domain,rating_parameters()))['circuit_ratings'][0]['ampacity_a']>0


def test_true_radial_conflict_is_still_rejected():
    from cablesim_iec60287.electrical import RatingRefused
    source=specification();source['specification']['values']['outer_diameter']['value']=.07
    with pytest.raises(RatingRefused) as error:complete(source,parameters())
    assert error.value.code=='RADIAL_DIMENSIONS_CONFLICT'
    assert error.value.path=='/parameters/values/screen_radial_factor/value'


def test_unarmoured_model_needs_no_steel_parameters():
    source=specification();source['specification']['designation']='YJV'
    given=parameters()
    for key in ('armour_gap_ratio','steel_relative_permeability'):given['values'].pop(key)
    model=complete(source,given)
    assert all(layer['role']!='armour' for layer in model['cable_type']['common_layers'])
    assert not any(material['id']=='material/steel' for material in model['materials'])
    source['specification']['designation']='YJV22'
    with pytest.raises(ValueError,match='armour_gap_ratio.*steel_relative_permeability'):complete(source,given)


def test_three_core_common_load_uses_all_heat_sources_and_matches_hand_current():
    from backend.domain.migration import convert
    from backend.schemas import Scenario
    from backend.kernel.scenarios import apply_layout, METHOD_DEFAULTS
    from cablesim_iec60287.domain import prepare
    from cablesim_iec60287.group import rate_group
    from cablesim_iec60287.three_core import verify
    model=complete(specification(),parameters());d=convert(Scenario().model_dump())['document']
    d['cable_types']=[model['cable_type']]
    d['provenance']['/cable_types/'+model['cable_type']['id']]={'kind':'demo','reference':'Public explicit complete geometry and sourced engineering examples for heat-balance validation','reviewed':False}
    ids={m['id'] for m in model['materials']}
    d['materials']=[m for m in d['materials'] if m['id'] not in ids]+model['materials']
    d['circuits'][0]['cable_type']=model['cable_type']['id']
    d['circuits'][0]['bonding']['kind']='both_ends'
    d['circuits'][0]['cables']=[{'id':d['circuits'][0]['cables'][0]['id'],'phase':'L1L2L3'}]
    d=apply_layout(d,'three_core_ducts_horizontal',1.2)
    for c in d['circuits']:d['load_cases'][0]['currents'][c['id']]=350.
    next(m for m in d['materials'] if m['id']==d['sections'][0]['medium']['material'])['thermal_resistivity']=1.
    d['sections'][0]['medium']['surface_temperature']=298.15
    p=deepcopy(METHOD_DEFAULTS['cablesim.iec60287']);p.update(rating_mode='both')
    p['solver']['max_iterations']=300
    group=prepare(d,p);trace=rate_group(group);common=trace['simultaneous_rating']
    assert min(r['ampacity_a'] for r in trace['circuit_ratings'])==pytest.approx(369.491512,abs=1e-5)
    assert common['ampacity_a']==pytest.approx(362.238246,abs=1e-5)
    hand=verify(group,trace['operating'],[{**common,'entity':'all-circuits'}])
    assert hand['passed'] and abs(hand['rows'][-1]['difference'])<1e-5
