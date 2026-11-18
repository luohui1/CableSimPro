"""Sealed D.0.7 cells and strict scope, using explicit synthetic 400 A inputs.

The two ambient rows are independently declared mechanism examples. They are
not a manufacturer benchmark or a temperature curve. No native solver runs.
"""
from copy import deepcopy
from hashlib import sha256
import json
from math import nextafter, inf
from pathlib import Path
import sys
from uuid import uuid4

import pytest
from pydantic import ValidationError

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'plugins/cablesim.gb50217-correction/src'))
from cablesim_gb50217_correction.correction import (
    ARTIFACT, CorrectionError, digest, prepare, query,
)
from cablesim_gb50217_correction.outdoor import (
    CAPABILITY, OutdoorParameters, calculate_outdoor, prepare_outdoor,
)
from backend.plugin_host.executor import Executor
from backend.plugin_host.registry import Registry
from cablesim_sdk.domain import DomainDocument
from test_gb50217_correction import example

BASIS_FILE_SHA = '2610aa10c0e8ac37ed76da600c475f6ff57a2033c7f18cfdab5201cb9ed21f0f'
ORIGINAL_SHA = '5e15e9a4a78e40df66a8b91a2e6f5da3047e92304dc0eb7cb62522e418e09483'
ENVIRONMENT = 'indoor_air_at_outdoor_ambient'
AREAS = (35, 50, 70, 95, 120, 150, 185, 240)
# Independent hand checks of the existing sealed source, not product data.
ROWS = (
    (1000, 3, (None, None, None, .90, .98, .97, .96, .94)),
    (6000, 3, (.96, .95, .94, .93, .92, .91, .90, .88)),
    (6000, 1, (None, None, None, .99, .99, .99, .99, .98)),
)
NUMERIC_THREE_CORE = [
    (voltage, area, row, column, factor, 400. * factor)
    for row, (voltage, cores, factors) in enumerate(ROWS, 1)
    if cores == 3
    for column, (area, factor) in enumerate(zip(AREAS, factors), 1)
    if factor is not None
]


def synthetic_baseline(voltage=1000, area_mm2=95):
    """A fixed two-row input declaration, not an evaluated thermal relation."""
    return {
        'schema': 'cablesim.synthetic-d07-baseline/1',
        'name': 'D.0.7 合成机制基准；不是厂家额定值、实测值或完整行业示例',
        'method': {'id': 'synthetic-mechanism-declaration', 'version': '1.0.0'},
        'purpose': '仅验证拒绝边界和单次原表乘法；30℃和40℃的400 A分别独立声明，不是温度曲线或换算结果。',
        'cable': {'rated_voltage_v': voltage, 'core_count': 3,
                  'nominal_area_m2': area_mm2 * 1e-6,
                  'normal_conductor_temperature_k': 363.15},
        'current_basis_environment': ENVIRONMENT,
        'pages': [{'number': 1, 'rows': [
            {'id': 'ambient-30', 'ambient_temperature_k': 303.15, 'current_a': 400.},
            {'id': 'ambient-40', 'ambient_temperature_k': 313.15, 'current_a': 400.},
        ]}],
        'source_kind': 'demo', 'confidence': 'reference', 'approval': 'not_granted',
    }


def baseline_bytes(original):
    return (json.dumps(original, ensure_ascii=False, sort_keys=True, indent=2) + '\n').encode('utf-8')


def outdoor_example(*, voltage=1000, area_mm2=95, ambient=303.15,
                    baseline_ambient=303.15, confirmed=True):
    """Explicit saved synthetic Domain; all consumed fields have a declaration."""
    d, _ = example(soil=False, ambient=ambient)
    d['name'] = f'D.0.7 {voltage}V 三芯{area_mm2}mm²合成机制，不是厂家或线路实例'
    cable = d['cable_types'][0]
    cable['label'] = f'D.0.7 三芯{area_mm2}mm²合成机制'
    cable['rating'].update(u0=600. if voltage == 1000 else 3600.,
                           u=float(voltage), um=1200. if voltage == 1000 else 7200.)
    cable['rating']['max_conductor_temperature']['normal'] = 363.15
    for core in cable['cores']:
        core['conductor']['nominal_area'] = area_mm2 * 1e-6
    circuit = d['circuits'][0]
    circuit['system'].update(kind='ac_three_phase', frequency=50., voltage=float(voltage))
    circuit['cables'][0].update(phase='L1L2L3', parallel_index=1)
    section = d['sections'][0]
    section.update(label='户外自然通风合成机制截面', layout_template={})
    section['enclosures'] = []
    section['medium'].update(material=None, air_temperature=float(ambient), surface_temperature=None,
                             ventilation='natural', solar_irradiance=None, wind_speed=None)
    section['placements'][0].update(x=0., z=0., enclosure=None)
    # Discard only the unreferenced soil scaffold of the legacy constructor.
    # The saved SDK contract requires an empty dict for no layout template.
    def references(value, material_id):
        if isinstance(value, dict):
            return any(references(item, material_id) for item in value.values())
        if isinstance(value, list):
            return any(references(item, material_id) for item in value)
        return value == material_id
    used_document = {key: value for key, value in d.items() if key not in ('materials', 'provenance')}
    d['materials'] = [item for item in d['materials']
                      if item['category'] != 'soil' or references(used_document, item['id'])]
    labels = {
        'material/conductor': ('conductor', 'copper', '铜导体（合成机制）'),
        'material/semicon': ('semiconductor', 'v0 semiconductor', '半导电材料（合成机制）'),
        'material/insulation': ('insulation', 'v0 insulation', '绝缘材料（合成机制）'),
        'material/screen': ('metal', 'v0 screen, construction unspecified', '金属屏蔽（结构未指定，合成机制）'),
        'material/jacket': ('polymer', 'v0 oversheath', '外护套聚合物材料（合成机制）'),
    }
    for material in d['materials']:
        if material['id'] in labels:
            category, original_label, chinese_label = labels[material['id']]
            assert (material['category'], material['label']) == (category, original_label)
            material['label'] = chinese_label
    source = dict(kind='demo', reviewed=False,
        reference=f'D.0.7 合成机制输入 v1；{voltage}V、三芯各{area_mm2}mm²、空气{ambient-273.15:g}℃、'
                  '正常温限90℃及保存几何；自然通风、户外明敷无遮阳；全部是明确机制声明，不是厂家或现场数据')
    d['provenance'] = {}
    for group in ('materials', 'cable_types', 'circuits', 'sections', 'load_cases'):
        for item in d[group]:
            pointer = '/' + group + '/' + item['id'].replace('~', '~0').replace('/', '~1')
            d['provenance'][pointer] = deepcopy(source)
    original = synthetic_baseline(voltage, area_mm2)
    basis = Registry(plugin_id='cablesim.standards-basis').get('cablesim.standards-basis')
    p = dict(
        baseline_current_a=400., baseline_ambient_k=float(baseline_ambient),
        baseline_environment=ENVIRONMENT,
        baseline_source=f'D.0.7 合成机制基准 v1，第1页 ambient-{baseline_ambient-273.15:g} 行：'
                        f'{voltage}V、三芯各{area_mm2}mm²、同正常温限90℃、户内空气单根400 A独立声明；'
                        '仅机制输入，不是厂家额定值，30℃与40℃两行不是温度曲线；此前未乘日照或分组系数。',
        baseline_sha256=sha256(baseline_bytes(original)).hexdigest(), baseline_page=1,
        baseline_reviewed=True,
        outdoor_exposure_source=source['reference'],
        outdoor_unshaded_confirmed=confirmed,
        basis_release_digest=digest(basis.manifest.model_dump(mode='json', by_alias=True)),
    )
    DomainDocument.model_validate(d)
    return d, p, original


def parameter_sources(p):
    common = ('D.0.7 合成机制基准 v1，第1页30℃与40℃分别独立声明400 A；'
              '不是温度曲线或厂家额定值；同型号和温限范围见完整原件，'
              '原始UTF-8字节SHA256：' + p['baseline_sha256'])
    result = {}
    for key in p:
        reference = (p['outdoor_exposure_source'] if key.startswith('outdoor_')
                     else p['baseline_source'] if key in ('baseline_ambient_k', 'baseline_source', 'baseline_reviewed')
                     else '实际封签标准依据库的固定发行身份，摘要：' + p[key] if key == 'basis_release_digest'
                     else common)
        result['/parameters/' + key] = dict(kind='demo', reviewed=False, reference=reference)
    return result


def test_all_24_original_cells_stay_exact_in_real_sealed_lookup():
    path = ROOT / 'plugins/cablesim.standards-basis/src/cablesim_standards_basis/records-installation.json'
    assert sha256(path.read_bytes()).hexdigest() == BASIS_FILE_SHA
    cases, expected = [], []
    for row, (voltage, cores, factors) in enumerate(ROWS, 1):
        for column, (area, factor) in enumerate(zip(AREAS, factors), 1):
            conditions = dict(u_v=voltage, core_count=cores, area_m2=area*1e-6,
                              outdoor_unshaded='yes', current_basis_environment=ENVIRONMENT)
            cases.append(dict(case_id=f'{row}-{column}', input=query('表D.0.7', conditions)))
            expected.append((row, column, factor, conditions))
    output = Executor().run('cablesim.standards-basis', 'lookup', cases)
    assert len(output.cases) == 24
    statuses = []
    for case, (row, column, factor, conditions) in zip(output.cases, expected, strict=True):
        assert case.status == 'succeeded', case.error
        answer = case.artifacts['x-cablesim.standards-basis']
        statuses.append(answer['status'])
        assert answer['status'] == ('explicit_not_applicable' if factor is None else 'resolved')
        assert len(answer['records']) == 1
        record = answer['records'][0]
        assert record['id'] == f'gb50217-D-0-7/r{row}/c{column}'
        assert record['value'] == factor and record['quantity']['unit'] == '1'
        assert record['printed_page'] == 74 and record['pdf_page'] == 84
        assert record['source_sha256'] == ORIGINAL_SHA
        assert record['verification']['status'] == 'verified'
        assert record['clause'] == 'D.0.7'
        for key, value in conditions.items():
            assert record['conditions'][key]['eq'] == pytest.approx(value) if isinstance(value, float) else record['conditions'][key]['eq'] == value
        assert len(case.artifact_digests['x-cablesim.standards-basis']) == 64
    assert statuses.count('resolved') == 18
    assert statuses.count('explicit_not_applicable') == 6


@pytest.mark.parametrize('voltage,area,row,column,factor,current', NUMERIC_THREE_CORE)
def test_thirteen_real_three_core_cells_apply_only_one_factor(voltage, area, row, column, factor, current):
    d, p, original = outdoor_example(voltage=voltage, area_mm2=area)
    before = deepcopy(d)
    trace = calculate_outdoor(d, p)
    assert trace['corrected_current_a'] == pytest.approx(current, abs=1e-10)
    assert trace['total_factor'] == factor
    assert len(trace['coefficients']) == 1
    receipt = trace['coefficients'][0]
    record = receipt['record']
    assert record['id'] == f'gb50217-D-0-7/r{row}/c{column}'
    assert record['clause'] == 'D.0.7' and record['value'] == factor
    assert record['source_sha256'] == ORIGINAL_SHA and record['verification']['status'] == 'verified'
    assert receipt['release_digest'] == p['basis_release_digest']
    assert len(receipt['request_sha256']) == len(receipt['artifact_sha256']) == 64
    assert receipt['query']['conditions'] == dict(u_v=voltage, core_count=3, area_m2=area*1e-6,
        outdoor_unshaded='yes', current_basis_environment=ENVIRONMENT)
    actual = trace['actual_conditions']
    assert actual['nominal_voltage_v'] == actual['voltage_v'] == voltage
    assert actual['ambient_temperature_k'] == p['baseline_ambient_k'] == 303.15
    assert actual['cable_count'] == 1 and actual['core_count'] == 3
    assert actual['source_kind'] == 'declared' and actual['confidence'] == 'reference'
    assert actual['approval'] == 'not_granted' and actual['method_version'] == '1.0.0'
    assert actual['input_sources']
    for item in actual['input_sources']:
        assert item['source'] == d['provenance'][item['source_path']]
        assert item['source']['kind'] == 'demo' and item['source']['reviewed'] is False
    assert not {'solar_irradiance', 'wind_speed', 'tray_layout', 'soil_rho'} & actual.keys()
    assert trace['baseline'] == p and trace['domain_input_sha256'] == digest(d)
    assert p['baseline_sha256'] == sha256(baseline_bytes(original)).hexdigest()
    assert d == before


@pytest.mark.parametrize('area', (35, 50, 70))
def test_three_core_original_null_cells_refuse(area):
    d, p, _ = outdoor_example(area_mm2=area)
    with pytest.raises(CorrectionError) as error:
        calculate_outdoor(d, p)
    assert error.value.code == 'CORRECTION_TABLE_NOT_COVERED'
    assert error.value.field == '/input/cable_types/0/cores/0/conductor/nominal_area'


@pytest.mark.parametrize('area', AREAS)
def test_every_single_core_cell_is_query_only_and_not_a_three_phase_run(area):
    d, p, _ = outdoor_example(voltage=6000, area_mm2=area)
    cable = d['cable_types'][0]
    cable['construction'] = 'single_core'
    cable['cores'] = [cable['cores'][0]]
    d['circuits'][0]['cables'][0]['phase'] = 'L1'
    DomainDocument.model_validate(d)
    with pytest.raises(CorrectionError) as error:
        calculate_outdoor(d, p)
    assert error.value.code == 'CORRECTION_NOT_APPLICABLE'
    assert error.value.field == '/input/cable_types/0/construction'


def test_original_95_to_120_jump_is_not_smoothed_and_30_degrees_is_not_corrected_twice():
    traces = [calculate_outdoor(*outdoor_example(area_mm2=area)[:2]) for area in (95, 120)]
    assert [trace['total_factor'] for trace in traces] == [.90, .98]
    assert [trace['corrected_current_a'] for trace in traces] == [360., 392.]
    assert all([row['record']['clause'] for row in trace['coefficients']] == ['D.0.7'] for trace in traces)
    assert traces[0]['corrected_current_a'] != 400. * .90 * 1.09
    d, p, _ = outdoor_example(baseline_ambient=313.15)
    with pytest.raises(CorrectionError) as error:
        calculate_outdoor(d, p)
    assert error.value.code == 'CORRECTION_BASELINE_MISMATCH'
    assert error.value.field == '/parameters/baseline_ambient_k'


@pytest.mark.parametrize('field', ('baseline_reviewed', 'outdoor_unshaded_confirmed'))
def test_real_false_is_an_unconfirmed_draft_and_never_permission(field):
    d, p, _ = outdoor_example()
    p[field] = False
    OutdoorParameters.model_validate(p)
    with pytest.raises(CorrectionError) as error:
        prepare_outdoor(d, p)
    assert error.value.code == 'CORRECTION_CONFIRMATION_REQUIRED'
    assert error.value.field == '/parameters/' + field


@pytest.mark.parametrize('field', tuple(OutdoorParameters.model_fields))
def test_all_new_parameter_values_are_required_not_defaulted(field):
    d, p, _ = outdoor_example()
    del p[field]
    with pytest.raises(ValidationError) as error:
        prepare_outdoor(d, p)
    assert error.value.errors()[0]['loc'] == (field,)


@pytest.mark.parametrize('field,value', [
    ('baseline_current_a', True), ('baseline_current_a', '400'), ('baseline_current_a', None),
    ('baseline_current_a', float('inf')), ('baseline_current_a', float('nan')),
    ('baseline_current_a', 10**400), ('baseline_ambient_k', 10**400),
    ('baseline_ambient_k', True),
    ('baseline_ambient_k', '303.15'), ('baseline_ambient_k', float('nan')),
    ('baseline_page', True), ('baseline_page', '1'), ('baseline_page', 0),
    ('baseline_source', '    '), ('baseline_source', '字'*2001),
    ('outdoor_exposure_source', '\n\t  '), ('outdoor_exposure_source', '字'*2001),
    ('baseline_sha256', 'z'*64), ('basis_release_digest', 'A'*64),
    ('baseline_environment', 'air'), ('baseline_environment', None),
    ('baseline_reviewed', 1), ('outdoor_unshaded_confirmed', 'true'),
])
def test_strict_parameter_types_blank_sources_and_nonfinite_values_refuse(field, value):
    d, p, _ = outdoor_example()
    p[field] = value
    with pytest.raises(ValidationError) as error:
        prepare_outdoor(d, p)
    assert error.value.errors()[0]['loc'] == (field,)


@pytest.mark.parametrize('change,field', [
    ('missing-rated-voltage', '/input/cable_types/0/rating/u'),
    ('wrong-rated-voltage', '/input/cable_types/0/rating/u'),
    ('mismatched-system-voltage', '/input/cable_types/0/rating/u'),
    ('boolean-system-voltage', '/input/circuits/0/system/voltage'),
    ('text-system-voltage', '/input/circuits/0/system/voltage'),
    ('missing-parallel-index', '/input/circuits/0/cables/0/parallel_index'),
    ('boolean-parallel-index', '/input/circuits/0/cables/0/parallel_index'),
    ('missing-enclosures', '/input/sections/0/enclosures'),
    ('unequal-areas', '/input/cable_types/0/cores'),
    ('missing-area', '/input/cable_types/0/cores/0/conductor/nominal_area'),
    ('boolean-area', '/input/cable_types/0/cores/0/conductor/nominal_area'),
    ('missing-ventilation', '/input/sections/0/medium/ventilation'),
    ('none-ventilation', '/input/sections/0/medium/ventilation'),
    ('forced-ventilation', '/input/sections/0/medium/ventilation'),
    ('wind-zero', '/input/sections/0/medium/wind_speed'),
    ('wind-present', '/input/sections/0/medium/wind_speed'),
    ('solar-zero', '/input/sections/0/medium/solar_irradiance'),
    ('solar-present', '/input/sections/0/medium/solar_irradiance'),
])
def test_saved_raw_values_and_qualitative_scope_cannot_be_repaired_by_defaults(change, field):
    d, p, _ = outdoor_example()
    cable, circuit, section = d['cable_types'][0], d['circuits'][0], d['sections'][0]
    if change == 'missing-rated-voltage':
        del cable['rating']['u']
    elif change == 'wrong-rated-voltage':
        cable['rating']['u'] = 15000.
    elif change == 'mismatched-system-voltage':
        circuit['system']['voltage'] = 6000.
    elif change == 'boolean-system-voltage':
        circuit['system']['voltage'] = True
    elif change == 'text-system-voltage':
        circuit['system']['voltage'] = '1000'
    elif change == 'missing-parallel-index':
        del circuit['cables'][0]['parallel_index']
    elif change == 'boolean-parallel-index':
        circuit['cables'][0]['parallel_index'] = True
    elif change == 'missing-enclosures':
        del section['enclosures']
    elif change == 'unequal-areas':
        cable['cores'][2]['conductor']['nominal_area'] = 120e-6
    elif change == 'missing-area':
        del cable['cores'][0]['conductor']['nominal_area']
    elif change == 'boolean-area':
        cable['cores'][0]['conductor']['nominal_area'] = True
    elif change == 'missing-ventilation':
        del section['medium']['ventilation']
    elif change in ('none-ventilation', 'forced-ventilation'):
        section['medium']['ventilation'] = change.split('-')[0]
    elif change.startswith('wind-'):
        section['medium']['wind_speed'] = 0. if change.endswith('zero') else 1.
    elif change.startswith('solar-'):
        section['medium']['solar_irradiance'] = 0. if change.endswith('zero') else 1000.
    before = deepcopy(d)
    if change == 'missing-area':
        with pytest.raises(ValidationError) as error:
            prepare_outdoor(d, p)
        assert error.value.errors()[0]['loc'] == ('cable_types', 0, 'cores', 0, 'conductor', 'nominal_area')
    else:
        with pytest.raises(CorrectionError) as error:
            prepare_outdoor(d, p)
        assert error.value.field == field
    assert d == before


def test_giant_raw_integer_is_a_field_refusal_not_an_overflow_exception():
    d, p, _ = outdoor_example()
    d['circuits'][0]['system']['voltage'] = 10**400
    with pytest.raises((ValidationError, CorrectionError)) as error:
        prepare_outdoor(d, p)
    if isinstance(error.value, ValidationError):
        assert error.value.errors()[0]['loc'] == ('circuits', 0, 'system', 'voltage')
    else:
        assert error.value.field == '/input/circuits/0/system/voltage'


@pytest.mark.parametrize('path', ('/sections/0/medium/air_temperature',
                                  '/cable_types/0/cores/0/conductor/nominal_area'))
@pytest.mark.parametrize('reference', ('', 'D.0.7 字段级合成声明 v2；明确覆盖父级研究出处，不是实测'))
def test_exact_indexed_source_precedes_broad_stable_parent(path, reference):
    d, p, _ = outdoor_example()
    broad = dict(kind='demo', reference='D.0.7 宽父级机制声明 v1；不可替代明确字段出处', reviewed=False)
    d['provenance'] = {key: deepcopy(broad) for key in ('/cable_types', '/circuits', '/sections')}
    exact = dict(kind='user', reference=reference, reviewed=False)
    d['provenance'][path] = exact
    if not reference:
        with pytest.raises(CorrectionError) as error:
            prepare_outdoor(d, p)
        assert error.value.code == 'CORRECTION_SOURCE_REQUIRED'
        assert error.value.field == '/input' + path
    else:
        _, _, actual = prepare_outdoor(d, p)
        evidence = next(item for item in actual['input_sources'] if item['indexed_path'] == path)
        assert evidence['source_path'] == path and evidence['source'] == exact


def test_missing_and_null_sources_are_refused():
    d, p, _ = outdoor_example()
    d['provenance'] = {}
    with pytest.raises(CorrectionError) as error:
        prepare_outdoor(d, p)
    assert error.value.code == 'CORRECTION_SOURCE_REQUIRED'
    d, p, _ = outdoor_example()
    path = '/sections/0/medium/air_temperature'
    d['provenance'][path] = None
    with pytest.raises(ValidationError) as error:
        prepare_outdoor(d, p)
    assert error.value.errors()[0]['loc'] == ('provenance', path)


def test_only_binary_si_noise_is_tolerated_not_a_nearby_engineering_area():
    d, p, _ = outdoor_example()
    p['baseline_ambient_k'] = nextafter(p['baseline_ambient_k'], inf)
    for core in d['cable_types'][0]['cores']:
        core['conductor']['nominal_area'] = nextafter(95e-6, inf)
    trace = calculate_outdoor(d, p)
    assert trace['corrected_current_a'] == 360.
    # This neighbor passes the generic library's relative tolerance, but is
    # outside binary SI representation noise. The outdoor branch must refuse it.
    nearby = 95e-6 * (1 + 5e-13)
    conditions = dict(u_v=1000, core_count=3, area_m2=nearby, outdoor_unshaded='yes',
                      current_basis_environment=ENVIRONMENT)
    lookup = Executor().run('cablesim.standards-basis', 'lookup', [
        dict(case_id='nearby', input=query('表D.0.7', conditions))])
    assert lookup.cases[0].artifacts['x-cablesim.standards-basis']['status'] == 'resolved'
    for core in d['cable_types'][0]['cores']:
        core['conductor']['nominal_area'] = nearby
    with pytest.raises(CorrectionError) as error:
        calculate_outdoor(d, p)
    assert error.value.code == 'CORRECTION_TABLE_NOT_COVERED'
    assert error.value.field == '/input/cable_types/0/cores/0/conductor/nominal_area'
    for core in d['cable_types'][0]['cores']:
        core['conductor']['nominal_area'] = 95.00001e-6
    with pytest.raises(CorrectionError) as error:
        calculate_outdoor(d, p)
    assert error.value.code == 'CORRECTION_TABLE_NOT_COVERED'
    p['baseline_ambient_k'] = 303.15001
    with pytest.raises(CorrectionError) as error:
        prepare_outdoor(d, p)
    assert error.value.code == 'CORRECTION_BASELINE_MISMATCH'


def test_multiple_circuits_and_old_method_parameters_do_not_mix_with_outdoor():
    d, old = example(soil=False, ambient=303.15, count=2, gap=2)
    _, p, _ = outdoor_example()
    with pytest.raises(CorrectionError) as error:
        prepare_outdoor(d, p)
    assert error.value.field == '/input/circuits'
    d, p, _ = outdoor_example()
    with pytest.raises(ValidationError):
        prepare(d, p)
    with pytest.raises(ValidationError):
        prepare_outdoor(d, old)
    p['tray_kind'] = 'ladder'
    with pytest.raises(ValidationError) as error:
        prepare_outdoor(d, p)
    assert error.value.errors()[0]['loc'] == ('tray_kind',)


def test_basis_release_digest_stays_locked():
    d, p, _ = outdoor_example()
    p['basis_release_digest'] = '0'*64
    with pytest.raises(CorrectionError) as error:
        calculate_outdoor(d, p)
    assert error.value.code == 'BASIS_VERSION_CHANGED'
    assert error.value.field == '/parameters/basis_release_digest'


def test_real_v2_capability_output_has_distinct_method_and_one_circuit():
    from backend.kernel.report import artifact_sections
    d, p, _ = outdoor_example()
    plugin = Registry(plugin_id='cablesim.gb50217-correction').get('cablesim.gb50217-correction')
    assert plugin.manifest.version == '1.0.9'
    assert {cap.id: cap.method_version for cap in plugin.manifest.capabilities} == {
        'steady-rating': '1.1.0', CAPABILITY: '1.0.0'}
    cap = next(cap for cap in plugin.manifest.capabilities if cap.id == CAPABILITY)
    assert set(cap.parameter_schema.required) == set(p)
    assert cap.parameter_schema.properties['basis_release_digest'].default == p['basis_release_digest']
    output = Executor().run(plugin.manifest.id, CAPABILITY, [dict(case_id='mechanism', input=d, parameters=p)])
    case = output.cases[0]
    assert case.status == 'succeeded', case.error
    assert output.plugin_version == '1.0.9'
    assert output.method_version == output.environment['method'] == '1.0.0'
    trace = case.artifacts[ARTIFACT]
    assert trace['corrected_current_a'] == 360.
    assert [row['record']['clause'] for row in trace['coefficients']] == ['D.0.7']
    values = [row for row in case.results if row['key'] == 'ampacity']
    assert len(values) == 1 and values[0]['value'] == 360.
    assert values[0]['case'] == 'rating-simultaneous'
    assert values[0]['rating_basis']['kind'] == 'single_circuit'
    assert len(case.artifact_digests[ARTIFACT]) == 64
    html = artifact_sections(dict(artifacts=case.artifacts, evidence=case.evidence))
    assert 'D.0.7' in html and '360.0' in html


def save_study(client, d, p, title):
    created = client.post('/api/workspaces', json={})
    assert created.status_code == 201, created.text
    workspace = created.json()
    prefix = '/api/workspaces/' + workspace['id']
    converted = client.post(prefix + '/domain/conversion', json={'expected_revision': workspace['revision']})
    assert converted.status_code == 200, converted.text
    put = client.put(prefix + '/domain', json={'expected_revision': converted.json()['revision'], 'document': d})
    assert put.status_code == 200, put.text
    workspace = client.get(prefix).json()
    method = dict(next(item['method'] for item in client.get('/api/methods').json()
                       if item['method']['plugin_id'] == 'cablesim.gb50217-correction'),
                  capability=CAPABILITY)
    assert method['version'] == '1.0.9'
    sources = parameter_sources(p)
    saved = client.post(prefix + '/studies', json=dict(expected_revision=workspace['revision'],
        title=title, method=method, task='rating', input_source='domain', parameters=p,
        input_sources=sources, driver={'kind': 'single'}))
    assert saved.status_code == 201, saved.text
    study = saved.json()
    assert study['definition']['parameters'] == p
    assert study['definition']['input_sources'] == sources
    return workspace, prefix, study, prefix + '/studies/' + study['id']


def test_saved_study_run_restart_keep_original_complete_evidence(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from backend.main import create_app
    from backend.kernel.workspace import fingerprint

    database = tmp_path / 'd07-mechanism.sqlite'
    d, p, original = outdoor_example()
    with TestClient(create_app(database)) as client:
        workspace, prefix, study, study_root = save_study(client, d, p, d['name'])
        revisions = dict(expected_revision=workspace['revision'], expected_study_revision=study['revision'])
        assert client.get(study_root + '/runs', params={'view': 'summary'}).json()['items'] == []
        preflight = client.get(study_root + '/preflight', params=revisions)
        assert preflight.status_code == 200, preflight.text
        assert preflight.json()['ready'] is True, preflight.text
        assert client.get(study_root + '/runs', params={'view': 'summary'}).json()['items'] == []
        response = client.post(study_root + '/runs', json=dict(request_id=str(uuid4()),
            **revisions, scope_acknowledged=True, lock_digest=preflight.json()['lock_digest']))
        assert response.status_code == 200, response.text
        run = response.json()
        assert run['status'] == 'succeeded' and run['integrity'] == 'verified', run
        assert run['snapshot']['definition']['parameters'] == p
        assert run['snapshot']['definition']['input_sources'] == parameter_sources(p)
        assert run['output']['plugin_version'] == '1.0.9'
        assert run['output']['method_version'] == run['output']['environment']['method'] == '1.0.0'
        trace = run['output']['cases'][0]['artifacts'][ARTIFACT]
        assert trace['corrected_current_a'] == 360.
        assert trace['baseline']['baseline_sha256'] == sha256(baseline_bytes(original)).hexdigest()
        assert trace['actual_conditions']['approval'] == 'not_granted'
        assert [row['record']['clause'] for row in trace['coefficients']] == ['D.0.7']
        after = client.get(prefix).json()
        assert after['domain'] == workspace['domain'] and after['revision'] == workspace['revision']
        assert after['audit'][1:] == workspace['audit'] and after['audit'][0]['event'] == '保存研究'
        output_digest = fingerprint(run['output'])
        assert run['output_digest'] == output_digest
        assert len(client.get(study_root + '/runs', params={'view': 'summary'}).json()['items']) == 1

    with TestClient(create_app(database)) as restarted:
        def forbidden(*args, **kwargs):
            raise AssertionError('frozen D.0.7 result must not invoke the method or current basis')
        monkeypatch.setattr(restarted.app.state.research.executor, 'run', forbidden)
        read = restarted.get(study_root + '/runs/' + run['id'], params={'view': 'full'})
        assert read.status_code == 200, read.text
        assert read.json()['output'] == run['output'] and read.json()['snapshot'] == run['snapshot']
        assert fingerprint(read.json()['output']) == output_digest
        assert restarted.get(prefix).json() == after


@pytest.mark.parametrize('change,code,field', [
    ('confirmation', 'CORRECTION_CONFIRMATION_REQUIRED', '/parameters/outdoor_unshaded_confirmed'),
    ('temperature', 'CORRECTION_BASELINE_MISMATCH', '/parameters/baseline_ambient_k'),
    ('null-cell', 'CORRECTION_TABLE_NOT_COVERED', '/input/cable_types/0/cores/0/conductor/nominal_area'),
])
def test_saved_preflight_refusals_do_not_start_runs_or_mutate_domain(tmp_path, change, code, field):
    from fastapi.testclient import TestClient
    from backend.main import create_app

    d, p, _ = outdoor_example(area_mm2=35 if change == 'null-cell' else 95,
        baseline_ambient=313.15 if change == 'temperature' else 303.15,
        confirmed=change != 'confirmation')
    with TestClient(create_app(tmp_path / f'{change}.sqlite')) as client:
        workspace, prefix, study, study_root = save_study(client, d, p, d['name'])
        revisions = dict(expected_revision=workspace['revision'], expected_study_revision=study['revision'])
        response = client.get(study_root + '/preflight', params=revisions)
        assert response.status_code == 200, response.text
        result = response.json()
        assert result['ready'] is False, result
        assert any(case.get('error', {}).get('code') == code and case['error']['field'] == field
                   for case in result['cases']), result
        assert client.get(study_root + '/runs', params={'view': 'summary'}).json()['items'] == []
        after = client.get(prefix).json()
        assert after['domain'] == workspace['domain'] and after['revision'] == workspace['revision']


def test_actual_v2_giant_integers_are_structured_field_errors():
    cases, fields = [], []
    for field in ('baseline_current_a', 'baseline_ambient_k'):
        d, p, _ = outdoor_example()
        p[field] = 10**400
        cases.append(dict(case_id=field, input=d, parameters=p))
        fields.append('/parameters/' + field)
    for identity, path in (
        ('rated-voltage', ('cable_types', 0, 'rating', 'u')),
        ('system-voltage', ('circuits', 0, 'system', 'voltage')),
        ('normal-temperature', ('cable_types', 0, 'rating', 'max_conductor_temperature', 'normal')),
    ):
        d, p, _ = outdoor_example()
        value = d
        for part in path[:-1]:
            value = value[part]
        value[path[-1]] = 10**400
        cases.append(dict(case_id=identity, input=d, parameters=p))
        fields.append('/input/' + '/'.join(map(str, path)))
    output = Executor().run('cablesim.gb50217-correction', CAPABILITY, cases)
    assert len(output.cases) == 5
    for case, field in zip(output.cases, fields, strict=True):
        assert case.status == 'failed' and case.error['code'] == 'INPUT_INVALID', case
        assert case.error['field'] == field
        assert not case.results and not case.artifacts
