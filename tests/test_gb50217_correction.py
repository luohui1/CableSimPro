"""Independent hand products; real sealed basis lookup, no copied data tables."""
from copy import deepcopy
from pathlib import Path
import sys

import pytest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'plugins/cablesim.gb50217-correction/src'))
from cablesim_gb50217_correction.correction import calculate, prepare, digest, CorrectionError, ARTIFACT
from backend.plugin_host.executor import Executor
from backend.plugin_host.registry import Registry
from backend.domain.migration import convert
from backend.schemas import Scenario
from cablesim_sdk.domain import DomainDocument


def example(*, soil=True, ambient=293.15, rho=1.2, count=1, gap=.1, pvc=False):
    d=convert(Scenario().model_dump())['document']
    cable=d['cable_types'][0]
    core=deepcopy(cable['cores'][0])
    core['layers']=[deepcopy(l) for l in cable['common_layers'] if l['role']=='insulation']
    cable['common_layers']=[l for l in cable['common_layers'] if l['role']!='insulation']
    cable['construction']='three_core'
    cable['cores']=[dict(deepcopy(core),id=f'core/k{i}',x=x,z=z) for i,(x,z) in enumerate([(-.04,0),(.04,0),(0,.07)])]
    cable['rating']['max_conductor_temperature']['normal']=343.15 if pvc else 363.15
    if pvc:
        for material in d['materials']:
            if any(material['id']==l['material'] and l['role']=='insulation' for l in core['layers']):material['standard_kind']='PVC'
    original=d['circuits'][0];d['circuits']=[]
    section=d['sections'][0];section['kind']='ground' if soil else 'air'
    section['enclosures']=[];section['placements']=[]
    section['medium']['surface_temperature']=ambient if soil else None
    section['medium']['air_temperature']=None if soil else ambient
    for material in d['materials']:
        if material['id']==section['medium']['material']:material['thermal_resistivity']=rho
    diameter=DomainDocument.model_validate(dict(d,sections=[dict(section,placements=[{'cable':original['cables'][0]['id'],'x':0,'z':-.8}])],circuits=[original])).cable_types[0].radius()*2
    for i in range(count):
        c=deepcopy(original);c['id']=f'circuit/c{i+1}';c['label']=f'回路 {i+1}'
        c['system']['voltage']=1000 if pvc else 10000
        c['cables']=[dict(id=f'cable/p{i+1}',phase='L1L2L3',parallel_index=1)]
        d['circuits'].append(c)
        section['placements'].append(dict(cable=c['cables'][0]['id'],x=i*(diameter+gap if soil else diameter*gap),z=-.8 if soil else 0))
    d['load_cases'][0]['currents']={c['id']:300 for c in d['circuits']}
    DomainDocument.model_validate(d)
    basis=Registry(plugin_id='cablesim.standards-basis').get('cablesim.standards-basis')
    p=dict(baseline_current_a=400.,baseline_ambient_k=298.15 if soil else 313.15,baseline_soil_rho=1.2,
        baseline_kind='gb_c012' if pvc else 'manufacturer',baseline_source='手算核验用人工给定基准；单根、同温限及埋深；不是厂家额定值',
        baseline_sha256=digest({'synthetic_baseline_a':400}),baseline_page=1,baseline_depth_m=.8,baseline_reviewed=True,
        basis_release_digest=digest(basis.manifest.model_dump(mode='json',by_alias=True)))
    return d,p


@pytest.mark.parametrize('kwargs,factors,expected',[
    # D.0.1 (90 °C, air 30 °C, baseline 40 °C), p72: 400 × 1.09 = 436 A.
    ({'soil':False,'ambient':303.15},[1.09],436.),
    # C.0.1-2 PVC70 °C; D.0.1 soil20 °C =1.05, D.0.3 rho1.5 =.93;
    # p72/73: 400 × 1.05 × .93 = 390.6 A. Synthetic baseline tests the product only.
    ({'pvc':True,'ambient':293.15,'rho':1.5},[1.05,.93],390.6),
    # D.0.1 soil30 °C (90 °C)=.96; D.0.4 three cables / net .1m=.85;
    # p72/73: 400 × .96 × .85 = 326.4 A.
    ({'ambient':303.15,'count':3,'gap':.1},[.96,.85],326.4),
    # D.0.1 air30 °C =1.09; D.0.5 three cables / S=2d =.98 (p74).
    # 400 × 1.09 × .98 = 427.28 A; centre-spacing ratio, not net gap.
    ({'soil':False,'ambient':303.15,'count':3,'gap':2},[1.09,.98],427.28),
])
def test_hand_products_and_frozen_basis(kwargs,factors,expected):
    d,p=example(**kwargs);before=deepcopy(d)
    trace=calculate(d,p)
    assert trace['corrected_current_a']==pytest.approx(expected,abs=1e-10)
    assert [r['factor'] for r in trace['coefficients']]==factors
    for r in trace['coefficients']:
        assert r['factor']==r['record']['value']
        assert r['record']['quantity']['unit']=='1'
        assert r['record']['printed_page'] in (72,73,74)
        assert len(r['artifact_sha256'])==len(r['record']['source_sha256'])==64
    assert d==before


def test_table_refusals_scope_and_standard_formula():
    d,p=example(count=3,gap=.15)
    with pytest.raises(CorrectionError) as error:calculate(d,p)
    assert error.value.code=='CORRECTION_TABLE_NOT_COVERED'
    assert error.value.field=='/input/sections/0/placements'
    d,p=example(rho=1.5)
    with pytest.raises(CorrectionError,match='任意厂家'):prepare(d,p)
    d,p=example(pvc=True,rho=1.7)
    with pytest.raises(CorrectionError):calculate(d,p)
    d,p=example(ambient=300.15)
    # D.0.2, p72 explicitly permits other ambient temperatures:
    # sqrt((90-27)/(90-25)), NOT interpolation of D.0.1 cells.
    trace=calculate(d,p)
    assert trace['total_factor']==pytest.approx((63/65)**.5,abs=1e-12)
    assert trace['coefficients'][0]['record']['clause']=='D.0.2'
    p['basis_release_digest']='0'*64
    with pytest.raises(CorrectionError) as error:calculate(d,p)
    assert error.value.code=='BASIS_VERSION_CHANGED'


def test_temperature_errors_point_to_the_value_that_needs_correction():
    for soil, field in [(True, 'surface_temperature'), (False, 'air_temperature')]:
        d, p = example(soil=soil, ambient=363.15)
        with pytest.raises(CorrectionError) as error:
            prepare(d, p)
        assert error.value.field == '/input/sections/0/medium/' + field
    d, p = example()
    p['baseline_ambient_k'] = 363.15
    with pytest.raises(CorrectionError) as error:
        prepare(d, p)
    assert error.value.field == '/parameters/baseline_ambient_k'
    d['cable_types'][0]['rating']['max_conductor_temperature'] = {}
    with pytest.raises(CorrectionError) as error:
        prepare(d, p)
    assert error.value.field == '/input/cable_types/0/rating/max_conductor_temperature/normal'


def test_v2_executor_and_report_reuse_saved_receipts():
    from backend.kernel.report import artifact_sections
    d,p=example(count=3,ambient=303.15)
    manifest=Registry(plugin_id='cablesim.gb50217-correction').get('cablesim.gb50217-correction').manifest
    assert p['basis_release_digest']==manifest.capabilities[0].parameter_schema.properties['basis_release_digest'].default
    output=Executor().run('cablesim.gb50217-correction','steady-rating',[dict(case_id='hand',input=d,parameters=p)])
    case=output.cases[0]
    assert case.status=='succeeded',case.error
    trace=case.artifacts[ARTIFACT]
    assert trace['corrected_current_a']==pytest.approx(326.4)
    assert case.artifact_digests[ARTIFACT]
    ampacity=next(r for r in case.results if r['key']=='ampacity')
    assert ampacity['case']=='rating-simultaneous'
    assert ampacity['rating_basis']['kind']=='common_balanced'
    html=artifact_sections(dict(artifacts=case.artifacts,evidence=case.evidence))
    assert 'GB 50217' in html and '326.4' in html and '表D.0.4' in html
