"""Independent hand products; real sealed basis lookup, no copied data tables."""
from copy import deepcopy
from pathlib import Path
import sys
from uuid import uuid4

import pytest
from pydantic import ValidationError

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
    assert set(trace['baseline']) == set(p)
    assert 'tray_layout' not in trace['actual_conditions']


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


def tray_example(kind='ladder', layers=1, count=7):
    """Explicit synthetic geometry and 400 A; never a manufacturer benchmark."""
    d, p = example(soil=False, ambient=313.15, count=layers*count, gap=1)
    d['name'] = 'D.0.6 合成机制核验，不是厂家或真实线路示例'
    section = d['sections'][0]
    section['medium'].update(solar_irradiance=0., wind_speed=0., ventilation='natural')
    diameter = DomainDocument.model_validate(d).cable_types[0].radius()*2
    for layer in range(layers):
        eid = f'enclosure/tray{layer+1}'
        members = section['placements'][layer*count:(layer+1)*count]
        # This separation is a declared synthetic test dimension, NOT a GB
        # vertical-spacing requirement inferred from the table.
        z = layer*(diameter+.1)
        for i, member in enumerate(members):
            member.update(x=i*diameter, z=z, enclosure=eid)
        section['enclosures'].append(dict(id=eid, type='tray', x=0., z=z,
                                           contains=[m['cable'] for m in members]))
    source = dict(kind='demo', reference='D.0.6 合成机制输入 v1：明确几何、空气40℃、正常温限90℃、10kV；不是厂家或现场数据', reviewed=False)
    d['provenance'] = {}
    for group in ('cable_types', 'circuits', 'sections'):
        for item in d[group]:
            key = '/' + group + '/' + item['id'].replace('~', '~0').replace('/', '~1')
            d['provenance'][key] = deepcopy(source)
    p.update(tray_kind=kind, tray_layout_source='D.0.6 合成机制布局 v1；人工声明桥架类别和各层实际位置；不是工程或厂家凭证',
             tray_layout_confirmed=True)
    DomainDocument.model_validate(d)
    return d, p


@pytest.mark.parametrize('kind,layers,row,factor,expected', [
    # Eight independent hand products against the existing sealed p74/PDF84
    # cells. Production code contains no duplicate coefficient table.
    ('ladder', 1, 1, .80, 320.), ('ladder', 2, 1, .65, 260.),
    ('ladder', 3, 1, .55, 220.), ('ladder', 4, 1, .50, 200.),
    ('tray', 1, 2, .70, 280.), ('tray', 2, 2, .55, 220.),
    ('tray', 3, 2, .50, 200.), ('tray', 4, 2, .45, 180.),
])
def test_d06_eight_real_sealed_cells_with_synthetic_baseline(kind, layers, row, factor, expected):
    d, p = tray_example(kind, layers)
    before = deepcopy(d)
    trace = calculate(d, p)
    assert trace['corrected_current_a'] == pytest.approx(expected, abs=1e-10)
    assert trace['total_factor'] == factor
    assert [item['record']['clause'] for item in trace['coefficients']] == ['D.0.1', 'D.0.6']
    assert [item['factor'] for item in trace['coefficients']] == [1., factor]
    receipt = trace['coefficients'][1]
    record = receipt['record']
    assert record['id'] == f'gb50217-D-0-6/r{row}/c{layers}'
    assert record['printed_page'] == 74 and record['pdf_page'] == 84
    assert record['source_sha256'] == '5e15e9a4a78e40df66a8b91a2e6f5da3047e92304dc0eb7cb62522e418e09483'
    assert record['verification']['status'] == 'verified'
    assert record['quantity']['unit'] == '1' and record['value'] == factor
    assert receipt['release_digest'] == p['basis_release_digest']
    assert len(receipt['request_sha256']) == len(receipt['artifact_sha256']) == 64
    assert receipt['query']['conditions'] == dict(tray_kind=kind, layer_count=layers,
        cable_spacing_condition='no_gap', horizontal_parallel_cable_count=7)
    layout = trace['actual_conditions']['tray_layout']
    assert layout['layer_count'] == layers
    assert [item['cable_count'] for item in layout['layers']] == [7]*layers
    assert layout['source_kind'] == 'declared' and layout['confidence'] == 'reference'
    assert layout['approval'] == 'not_granted' and layout['method_version'] == '1.1.0'
    assert layout['layout_source'] == p['tray_layout_source']
    assert layout['geometry_sources']
    for item in layout['geometry_sources']:
        assert item['source'] == d['provenance'][item['source_path']]
        assert item['source']['kind'] == 'demo' and item['source']['reviewed'] is False
    assert trace['domain_input_sha256'] == digest(d)
    assert trace['baseline'] == p and d == before


@pytest.mark.parametrize('field,value', [
    ('tray_kind', None), ('tray_kind', 'rack'), ('tray_kind', True),
    ('tray_layout_source', None), ('tray_layout_source', '    '), ('tray_layout_source', '字'*2001),
    ('tray_layout_confirmed', None), ('tray_layout_confirmed', False),
    ('tray_layout_confirmed', 1), ('tray_layout_confirmed', 'true'),
])
def test_d06_explicit_invalid_values_are_not_treated_as_absent(field, value):
    d, p = tray_example()
    p[field] = value
    with pytest.raises(ValidationError) as error:
        prepare(d, p)
    assert error.value.errors()[0]['loc'] == (field,)


@pytest.mark.parametrize('missing', ['tray_kind', 'tray_layout_source', 'tray_layout_confirmed'])
def test_d06_partial_parameters_refuse_without_fallback(missing):
    d, p = tray_example()
    del p[missing]
    with pytest.raises(CorrectionError) as error:
        prepare(d, p)
    assert error.value.field == '/parameters/' + missing
    # An existing study without any new parameter still refuses a tray Domain;
    # it must never acquire a guessed ladder/tray classification.
    p = {key: value for key, value in p.items() if not key.startswith('tray_')}
    with pytest.raises(CorrectionError):
        prepare(d, p)


@pytest.mark.parametrize('change', [
    'six-per-layer', 'five-layers', 'gap', 'non-horizontal', 'different-row',
    'unequal-count', 'missing-binding', 'rack', 'mixed-type', 'mixed-voltage',
    'missing-source', 'empty-source', 'missing-coordinate', 'solar-missing',
    'solar-present', 'wind-present', 'forced-ventilation', 'boolean-voltage',
])
def test_d06_unsupported_or_unsourced_saved_layouts_refuse(change):
    d, p = tray_example(layers=5 if change == 'five-layers' else 2,
                        count=6 if change == 'six-per-layer' else 7)
    section = d['sections'][0]
    if change == 'gap':
        section['placements'][6]['x'] += .01
    elif change == 'non-horizontal':
        section['placements'][6]['z'] += .01
    elif change == 'different-row':
        for item in section['placements'][7:]:
            item['x'] += .01
    elif change == 'unequal-count':
        removed = d['circuits'].pop()
        section['placements'].pop()
        section['enclosures'][-1]['contains'].pop()
        del d['load_cases'][0]['currents'][removed['id']]
    elif change == 'missing-binding':
        section['placements'][0]['enclosure'] = None
        section['enclosures'][0]['contains'].pop(0)
    elif change == 'rack':
        section['enclosures'][0]['type'] = 'rack'
    elif change == 'mixed-type':
        other = deepcopy(d['cable_types'][0]); other['id'] = 'cable_type/another'
        d['cable_types'].append(other)
        d['circuits'][0]['cable_type'] = other['id']
    elif change == 'mixed-voltage':
        d['circuits'][0]['system']['voltage'] = 6000.
    elif change == 'missing-source':
        d['provenance'] = {}
    elif change == 'empty-source':
        sid = section['id'].replace('/', '~1')
        d['provenance'][f'/sections/{sid}/medium/solar_irradiance'] = dict(kind='user', reference='', reviewed=False)
    elif change == 'missing-coordinate':
        del d['cable_types'][0]['cores'][0]['z']
    elif change == 'solar-missing':
        del section['medium']['solar_irradiance']
    elif change == 'solar-present':
        section['medium']['solar_irradiance'] = 100.
    elif change == 'wind-present':
        section['medium']['wind_speed'] = 1.
    elif change == 'forced-ventilation':
        section['medium']['ventilation'] = 'forced'
    elif change == 'boolean-voltage':
        for circuit in d['circuits']:
            circuit['system']['voltage'] = True
    before = deepcopy(d)
    with pytest.raises(CorrectionError) as error:
        prepare(d, p)
    assert error.value.field.startswith('/input/')
    if change in ('missing-source', 'empty-source'):
        assert error.value.code == 'CORRECTION_SOURCE_REQUIRED'
    assert d == before


def test_d06_indexed_sources_and_actual_count_are_preserved():
    d, p = tray_example(count=8)
    # The existing indexed provenance convention is accepted explicitly, with
    # the exact matched source path retained; no source is invented.
    sources = d['provenance']; d['provenance'] = {}
    for group in ('cable_types', 'circuits', 'sections'):
        for i, item in enumerate(d[group]):
            d['provenance'][f'/{group}/{i}'] = sources['/' + group + '/' + item['id'].replace('/', '~1')]
    _, _, actual = prepare(d, p)
    layout = actual['tray_layout']
    assert layout['horizontal_parallel_cable_count'] == 8
    assert all(item['source_path'] in d['provenance'] for item in layout['geometry_sources'])
    assert any(item['source_path'] == '/sections/0' for item in layout['geometry_sources'])


@pytest.mark.parametrize('field', ['/sections/0/medium/solar_irradiance', '/cable_types/0/cores/0/conductor/diameter'])
@pytest.mark.parametrize('reference', ['', '明确字段研究输入 v2；比父级来源更具体，不是厂家实测'])
def test_d06_indexed_field_source_precedes_wider_stable_parent(field, reference):
    d, p = tray_example()
    broad = dict(kind='demo', reference='合成机制父级输入 v1，不能覆盖字段具体出处', reviewed=False)
    d['provenance'] = {path: deepcopy(broad) for path in ('/sections', '/cable_types', '/circuits')}
    exact = dict(kind='user', reference=reference, reviewed=False)
    d['provenance'][field] = exact
    if not reference:
        with pytest.raises(CorrectionError) as error:
            prepare(d, p)
        assert error.value.code == 'CORRECTION_SOURCE_REQUIRED'
        assert error.value.field == '/input' + field
    else:
        _, _, actual = prepare(d, p)
        evidence = next(row for row in actual['tray_layout']['geometry_sources'] if row['indexed_path'] == field)
        assert evidence['source_path'] == field and evidence['source'] == exact


def test_d06_explicitly_null_source_is_rejected_by_domain_schema():
    d, p = tray_example()
    path = '/sections/0/medium/solar_irradiance'
    d['provenance'][path] = None
    with pytest.raises(ValidationError) as error:
        prepare(d, p)
    assert error.value.errors()[0]['loc'] == ('provenance', path)


def test_d06_saved_v2_study_and_restart_read_original_evidence(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from backend.main import create_app
    from backend.kernel.workspace import fingerprint

    d, p = tray_example('tray', 2)
    database = tmp_path / 'd06-mechanism.sqlite'
    sources = {f'/parameters/{key}': dict(kind='demo', reference=p['tray_layout_source'], reviewed=False)
               for key in ('tray_kind', 'tray_layout_source', 'tray_layout_confirmed')}
    with TestClient(create_app(database)) as client:
        created = client.post('/api/workspaces', json={})
        assert created.status_code == 201, created.text
        workspace = created.json(); prefix = '/api/workspaces/' + workspace['id']
        converted = client.post(prefix + '/domain/conversion', json={'expected_revision': workspace['revision']})
        assert converted.status_code == 200, converted.text
        put = client.put(prefix + '/domain', json={'expected_revision': converted.json()['revision'], 'document': d})
        assert put.status_code == 200, put.text
        workspace = client.get(prefix).json()
        method = dict(next(item['method'] for item in client.get('/api/methods').json()
                      if item['method']['plugin_id'] == 'cablesim.gb50217-correction'), capability='steady-rating')
        assert method['version'] == '1.0.8'
        saved = client.post(prefix + '/studies', json=dict(expected_revision=workspace['revision'],
            title='D.0.6 合成机制核验，不是厂家额定值', method=method, task='rating', input_source='domain',
            parameters=p, input_sources=sources, driver={'kind': 'single'}))
        assert saved.status_code == 201, saved.text
        study = saved.json(); study_root = prefix + '/studies/' + study['id']
        assert study['definition']['parameters'] == p
        assert study['definition']['input_sources'] == sources
        preflight = client.get(study_root + '/preflight', params=dict(expected_revision=workspace['revision'], expected_study_revision=study['revision']))
        assert preflight.status_code == 200, preflight.text
        run_response = client.post(study_root + '/runs', json=dict(request_id=str(uuid4()),
            expected_revision=workspace['revision'], expected_study_revision=study['revision'],
            scope_acknowledged=True, lock_digest=preflight.json()['lock_digest']))
        assert run_response.status_code == 200, run_response.text
        run = run_response.json()
        assert run['status'] == 'succeeded' and run['integrity'] == 'verified', run
        assert run['snapshot']['definition']['parameters'] == p
        assert run['snapshot']['definition']['input_sources'] == sources
        assert run['output']['plugin_version'] == '1.0.8'
        assert run['output']['method_version'] == run['output']['environment']['method'] == '1.1.0'
        case = run['output']['cases'][0]
        trace = case['artifacts'][ARTIFACT]
        assert trace['corrected_current_a'] == pytest.approx(220., abs=1e-10)
        assert trace['actual_conditions']['tray_layout']['method_version'] == '1.1.0'
        assert [item['record']['clause'] for item in trace['coefficients']] == ['D.0.1', 'D.0.6']
        ampacities = [item for item in case['results'] if item['key'] == 'ampacity']
        assert len(ampacities) == 14
        assert all(item['value'] == pytest.approx(220., abs=1e-10) for item in ampacities)
        assert all(item['case'] == 'rating-simultaneous' and item['rating_basis']['kind'] == 'common_balanced' for item in ampacities)
        assert len(case['artifact_digests'][ARTIFACT]) == 64
        after = client.get(prefix).json()
        assert after['domain'] == workspace['domain'] and after['revision'] == workspace['revision']
        assert after['audit'][1:] == workspace['audit']
        assert after['audit'][0]['event'] == '保存研究'
        original_digest = fingerprint(run['output'])
        assert run['output_digest'] == original_digest

    # Reading a frozen result after restart must not call the method or query
    # the current standards library again.
    with TestClient(create_app(database)) as restarted:
        def forbidden(*args, **kwargs):
            raise AssertionError('saved D.0.6 evidence must not be recomputed')
        monkeypatch.setattr(restarted.app.state.research.executor, 'run', forbidden)
        read = restarted.get(study_root + '/runs/' + run['id'], params={'view': 'full'})
        assert read.status_code == 200, read.text
        assert read.json()['output'] == run['output']
        assert fingerprint(read.json()['output']) == original_digest
        assert read.json()['snapshot'] == run['snapshot']
        assert restarted.get(prefix).json() == after
