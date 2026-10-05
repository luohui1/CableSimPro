"""Published dimensions and independent mean-diameter/thermal-path checks."""
from copy import deepcopy
from math import log, pi, sqrt
import pytest
from cablesim_iec60287.inputs import Rating
from cablesim_iec60287.method import geometry, t1, t3, dielectric_path, electrical
from cablesim_iec60287.domain import prepare
from cablesim_iec60287.group import rate_group
from test_iec60287_group import document, parameters


def qifan_document():
    """Qifan public 800 mm² dimensions, plus explicitly declared reference properties.

    Source product table: https://www.qifandl.com/products_detail/c-_detailId=1266420897496969216.html
    Buffer/air conductivity references: Liu et al., Zhejiang Electric Power 2021,
    40(11), pp.54-59, Table2 p.56 (0.17 and 0.023 W/m/K).
    Pitch reference: Wang et al., TCES 2020, 35(16), Appendix Table1 (800 mm²:25mm).
    Contact at the installed buffer OD and a uniform mean-diameter gap are
    declared engineering conditions, not measured Qifan thermal performance.
    """
    doc=document('trefoil');typ=doc['cable_types'][0]
    typ['rating'].update(u0=64000.,u=110000.)
    core=typ['cores'][0];core['conductor'].update(diameter=.034,r20=.0221/1000,r20_basis='manufacturer_limit',nominal_area=800e-6,form='stranded_round_compacted')
    materials={m['id']:m for m in doc['materials']}
    materials[core['conductor']['material']].update(temperature_coefficient_20=.00393)
    ids={'conductor_screen':'material/semi','insulation':'material/insulation-qifan','insulation_screen':'material/semi',
         'bedding':'material/buffer-qifan','metallic_sheath':'material/al-qifan','separator':'material/bitumen-qifan','oversheath':'material/pe-qifan'}
    doc['materials'] += [
        {'id':'material/semi','label':'半导电材料参考','category':'semiconductor','thermal_resistivity':2.5},
        {'id':'material/insulation-qifan','label':'XLPE标准参考','category':'insulation','thermal_resistivity':3.5,'relative_permittivity':2.5,'loss_tangent':.001},
        {'id':'material/buffer-qifan','label':'缓冲带文献参考','category':'filler','thermal_resistivity':1/.17},
        {'id':'material/al-qifan','label':'铝护套标准参考','category':'metal','electrical_resistivity_20':2.84e-8,'temperature_coefficient_20':.00403},
        {'id':'material/bitumen-qifan','label':'沥青标准参考','category':'polymer','thermal_resistivity':6.},
        {'id':'material/pe-qifan','label':'PE标准参考','category':'polymer','thermal_resistivity':3.5}]
    doc['materials']=list({m['id']:m for m in doc['materials']}.values())
    core['layers']=[{'role':role,'material':ids[role],'thickness':thickness} for role,thickness in [
        ('conductor_screen',.00135),('insulation',.0162),('insulation_screen',.001),('bedding',.004),
        ('metallic_sheath',.002),('separator',.00025),('oversheath',.0045)]]
    core['layers'][4].update(form='corrugated',corrugation_depth=.004,corrugation_pitch=.025)
    typ['common_layers']=[]
    # Approximate layer diameters are the modelling basis, not nominal thicknesses.
    spacing=.1006;sec=doc['sections'][0]
    for q,(x,z) in zip(sec['placements'],[(0,-.8+spacing/sqrt(3)),(-spacing/2,-.8-spacing/(2*sqrt(3))),(spacing/2,-.8-spacing/(2*sqrt(3)))]):q.update(x=x,z=z)
    sec['medium']['surface_temperature']=298.15
    next(m for m in doc['materials'] if m['id']==sec['medium']['material'])['thermal_resistivity']=1.
    doc['load_cases'][0]['currents']={doc['circuits'][0]['id']:600.}
    p=parameters();p['solver']['max_iterations']=300;p['rating_mode']='both'
    p['corrugated_gap']={typ['id']:{'rho_k_m_w':1/.023,
        'source':'Engineering reference: Liu et al. 2021 Table2 p56, air k=0.023 W/m/K; uniform effective annulus, not manufacturer validation',
        'geometry_source':'Qifan public 800 structure table; 4mm radial depth derived with declared trough contact at buffer OD79.1mm; pitch25mm from Wang et al.2020 AppendixTable1, not Qifan measured pitch'}}
    return doc,p


def test_public_qifan_dimensions_and_corrugated_thermal_paths():
    doc,p=qifan_document();group=prepare(doc,p);r=group.cables[0]['rating'];g=geometry(r)
    # Qifan table items 3/4/5/6/7/8/10/11: independently transcribed diameters.
    assert [g.conductor_m,g.over_inner_screen_m,g.over_insulation_m,g.over_outer_screen_m,g.over_sheath_m+.004,g.overall_m]==pytest.approx([.034,.0367,.0691,.0711,.0911,.1006],abs=1e-12)
    assert r.conductor.r20_ohm_m==pytest.approx(.0221/1000)
    mean=(.0911+.0791)/2
    assert g.sheath_mean_m==pytest.approx(mean)
    assert electrical(r,g).sheath_r20_ohm_m==pytest.approx(2.84e-8/(pi*mean*.002))
    core=(2.5*log(.0367/.034)+3.5*log(.0691/.0367)+2.5*log(.0711/.0691))/(2*pi)
    buffer=(log(.0791/.0711)/.17+log((mean-.002)/.0791)/.023)/(2*pi)
    serving=(6*log(.0916/(mean+.002))+3.5*log(.1006/.0916))/(2*pi)
    assert t1(r,g)==pytest.approx(core+buffer,abs=1e-12)
    assert dielectric_path(r,g)==pytest.approx(.5*core+buffer,abs=1e-12)
    assert t3(r,g)==pytest.approx(serving,abs=1e-12)
    result=rate_group(group)
    assert result['verification']['passed']
    assert result['simultaneous_rating']['ampacity_a']>0
    assert result['corrugated_sheaths'][0]['mean_diameter_m']==pytest.approx(mean)


def test_published_mean_diameter_inductance_parameter():
    # Wang et al. 2020 Appendix Table1 / Table1, 800 mm²:
    # trough inner radius37.95mm, crest outer radius45.95mm, wall2mm;
    # their equivalent-cylinder solution is 9.537 nH/m (not full circuit reactance).
    doc,p=qifan_document();r=prepare(doc,p).cables[0]['rating']
    values=r.model_dump();values['sheath']['corrugation']['depth_m']=.006
    values['sheath']['corrugation']['buffer_layers']=[{'thickness_m':(.0759-.0711)/2,'rho_k_m_w':6.}]
    g=geometry(Rating.model_validate(values));mean=g.sheath_mean_m
    inductance=2e-7*log((mean+.002)/(mean-.002))
    assert mean==pytest.approx((.0759+.0919)/2)
    assert inductance*1e9==pytest.approx(9.537,abs=.0005)


@pytest.mark.parametrize('key',['corrugation_depth','corrugation_pitch'])
def test_missing_corrugation_geometry_stops_at_domain_field(key):
    doc,p=qifan_document();del doc['cable_types'][0]['cores'][0]['layers'][4][key]
    with pytest.raises(ValueError) as error:prepare(doc,p)
    assert error.value.field_path==('cable_types',0,'cores',0,'layers',4,key)


def test_unknown_gap_property_is_not_replaced_by_buffer_material():
    doc,p=qifan_document();p.pop('corrugated_gap')
    with pytest.raises(ValueError) as error:prepare(doc,p)
    assert error.value.field_path[:2]==('parameters','corrugated_gap')


@pytest.mark.parametrize('key,value',[('rho_k_m_w',0),('rho_k_m_w',float('nan')),('source',' '),('geometry_source','')])
def test_invalid_corrugated_reference_points_to_exact_parameter(key,value):
    doc,p=qifan_document();type_id=doc['cable_types'][0]['id']
    p['corrugated_gap'][type_id][key]=value
    with pytest.raises(ValueError) as error:prepare(doc,p)
    assert error.value.field_path==('parameters','corrugated_gap',type_id,key)


def test_pitch_is_provenance_not_an_invented_iec_correction():
    doc,p=qifan_document();first=prepare(doc,p).cables[0]['rating']
    doc['cable_types'][0]['cores'][0]['layers'][4]['corrugation_pitch']=.03
    second=prepare(doc,p).cables[0]['rating']
    assert geometry(first)==geometry(second)
    assert t1(first,geometry(first))==t1(second,geometry(second))
