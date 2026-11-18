"""Real Types revisions -> live sealed GB/T 12706.2 lookup -> Executor.

The structures below are explicitly declared conditional designs. They are not
manufacturer measurements or complete products. Original rule receipts come
only from the installed data plugin; no reference is fabricated for a positive
case, and the missing manufacturing criteria must still stop completion.
"""
from copy import deepcopy
from datetime import date
from hashlib import sha256
import json
import math
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from backend.main import create_app
from backend.plugin_host.executor import Executor


HUMAN = {'X-CableSim-Actor': 'human'}
APPLICATION = 'separation_sheath_application'
REQUIRED = 'mv-isolation-applicability/r1/' + APPLICATION
LEAD = 'mv-isolation-applicability/r2/' + APPLICATION
RELATION = 'mv-isolation-applicability/r3/' + APPLICATION
WATER = 'mv-isolation-water-barrier/r1/separation_sheath_water_barrier_exception'


def row(report, key):
    return next(item for item in report['rows'] if item['id'].endswith(':' + key))


def declare(document, name, value, kind='user'):
    cable_id = document['cable_types'][0]['id'].replace('~', '~0').replace('/', '~1')
    pointer = '/cable_types/' + cable_id + '/common_layers/armour/engineering/' + name
    document['provenance'][pointer] = {
        'kind': kind, 'reviewed': False,
        'reference': json.dumps({'schema': 'cablesim.manufacturing-input/1', 'unit': '1',
                                'value': value, 'reference': '条款条件性设计声明；不代表厂家制造或试验合格'}, ensure_ascii=False)}
    return pointer


def add_separator(document, *, replace_bedding=False, after_armour=False):
    common = document['cable_types'][0]['common_layers']
    bedding = next(layer for layer in common if layer['role'] == 'bedding')
    separator = {'role': 'separator', 'form': 'smooth', 'material': bedding['material'],
                 'thickness': .0015}  # Explicit hand input, not a standard-derived dimension.
    if replace_bedding:
        common.remove(bedding)
    armour = next(i for i, layer in enumerate(common) if layer['role'] == 'armour')
    common.insert(armour + int(after_armour), separator)
    return separator


def add_lead(document):
    if not any(material['id'] == 'material/declared_lead' for material in document['materials']):
        document['materials'].append({'id': 'material/declared_lead', 'label': '条件性设计声明的铅套材料',
                                      'category': 'metal', 'standard_kind': 'lead'})
    common = document['cable_types'][0]['common_layers']
    common.insert(0, {'role': 'metallic_sheath', 'form': 'smooth',
                      'material': 'material/declared_lead', 'thickness': .0015})


class Scenario:
    def __init__(self, client, saved):
        self.client, self.saved, self.base = client, saved, deepcopy(saved['domain'])
        self.executor = Executor()

    def document(self):
        return deepcopy(self.base)

    def save(self, document):
        response = self.client.put(f"/api/types/{self.saved['id']}/document", headers=HUMAN,
                                   json={'expected_revision': self.saved['revision'],
                                         'request_id': str(uuid4()), 'document': document})
        assert response.status_code == 200, response.text
        self.saved = response.json()

    def parameters(self):
        response = self.client.post(f"/api/design/type-workspaces/{self.saved['id']}/requirements/basis",
                                    json={'request_id': str(uuid4()), 'expected_revision': self.saved['revision']})
        assert response.status_code == 200, response.text
        return response.json()['parameters']

    def run(self, parameters=None):
        parameters = self.parameters() if parameters is None else parameters
        case = self.executor.run('cablesim.standard-check', 'dimensions', [{
            'case_id': 'separation', 'input': self.saved['domain'],
            'parameters': {'cable_type_id': self.saved['domain']['cable_types'][0]['id'], **parameters}}]).cases[0]
        return case

    def check(self):
        case = self.run()
        assert case.status == 'succeeded', case.error
        report = case.artifacts['x-cablesim.standard-check']
        assert report['method_version'] == '1.8.4'
        assert report['conclusion'] != 'satisfied'
        return report


@pytest.fixture(scope='module')
def scenario(tmp_path_factory):
    with TestClient(create_app(tmp_path_factory.mktemp('separation') / 'types.sqlite')) as client:
        response = client.post('/api/types/creation-proposals', json={'request_id': str(uuid4()), 'input': {
            'schema_version': 'cablesim.cable-design-request/2', 'voltage': '8700/15000',
            'area_m2': 240e-6, 'construction': 'three_core', 'conductor': 'copper_bare',
            'form': 'solid_round', 'generation_mode': 'complete', 'screened': 'yes',
            'armour': 'steel_tape', 'gap_m': 0, 'conductor_screen_thickness_m': .0007,
            'insulation_screen_thickness_m': .0007, 'screen_tape_thickness_m': .0001,
            'screen_tape_width_m': .1}})
        assert response.status_code == 200, response.text
        proposal = response.json()
        response = client.post('/api/types', headers=HUMAN, json={
            'request_id': str(uuid4()), 'origin': 'standard', 'name': '隔离套条款条件性设计核对',
            'proposal_id': proposal['id'], 'content_sha256': proposal['content_sha256'],
            'human_confirmed': True})
        assert response.status_code == 201, response.text
        yield Scenario(client, response.json())


def assert_reference(item, identity, conditions, printed=11, pdf=19):
    ref = item['basis_reference']
    assert ref['record']['id'] == ref['query']['record_id'] == identity
    assert ref['query']['conditions'] == conditions
    assert item['source_status'] == 'original-verified'
    assert (item['printed_page'], item['pdf_page']) == (printed, pdf)
    assert ref['record']['verification']['status'] == 'verified'
    assert len(ref['record']['verification']['methods']) == 2
    assert len(ref['record_sha256']) == len(ref['release_digest']) == len(ref['request_sha256']) == 64


def test_required_separator_cannot_be_supplied_by_a_bedding_or_confirmation(scenario):
    document = scenario.document()
    declare(document, 'longitudinal_water_barrier', False)
    declare(document, 'separator_compound_confirmed', True)
    declare(document, 'separator_material_reference', '条件性材料记录，尚未按14.2独立核对')
    declare(document, 'separator_spark_test_reference', '条件性记录文字，尚未核对试验方法和判据')
    scenario.save(document)
    item = row(scenario.check(), 'armour-separation')
    assert_reference(item, REQUIRED, {'metal_layer_relation': 'different',
                                    'longitudinal_water_barrier': False, 'lead_sheath_present': False})
    assert item['verdict'] == 'missing' and '普通光滑内衬' in item['reason']
    assert {spec['label'] for spec in item['engineering_inputs']} >= {
        '金属层间纵向阻水隔层', '隔离层材料已确认符合隔离套要求'}
    add_separator(document)
    scenario.save(document)
    item = row(scenario.check(), 'armour-separation')
    assert item['verdict'] == 'missing' and '最薄点实测' in item['reason']
    response = scenario.client.post(f"/api/types/{scenario.saved['id']}/measurements", json={
        'expected_revision': scenario.saved['revision'], 'request_id': str(uuid4()),
        'origin': 'teaching', 'sample_id': 'CONDITIONAL-SEPARATOR', 'measured_on': date.today().isoformat(),
        'method': '明确标注的教学测量记录，用于验证拒绝路径', 'reference': '不代表厂家产品或材料试验',
        'acknowledge_measured': True,
        'values': [{'core': None, 'role': 'separator', 'quantity': 'minimum_thickness', 'value': 1.3, 'unit': 'mm'}]})
    assert response.status_code == 200, response.text
    scenario.saved = response.json()
    item = row(scenario.check(), 'armour-separation')
    assert item['verdict'] == 'uncovered'
    assert all(part in item['reason'] for part in ('13.3.3', '14.2', '火花试验'))
    assert all(dependency['verdict'] == 'uncovered' for dependency in item['separation_dependencies'])
    document = deepcopy(scenario.saved['domain'])
    declare(document, 'separator_compound_confirmed', False)
    scenario.save(document)
    assert row(scenario.check(), 'armour-separation')['verdict'] == 'failed'


def test_lead_choice_does_not_substitute_inner_covering_or_padding_rules(scenario):
    document = scenario.document()
    add_lead(document)
    declare(document, 'longitudinal_water_barrier', False)
    bedding = next(layer for layer in document['cable_types'][0]['common_layers'] if layer['role'] == 'bedding')
    bedding.update(form='tape', padding_thickness=.0008)
    scenario.save(document)
    item = row(scenario.check(), 'armour-separation')
    assert_reference(item, LEAD, {'lead_sheath_present': True})
    assert item['verdict'] == 'uncovered'
    assert all(part in item['reason'] for part in ('13.3.4', '8.2', '13.7'))
    assert '铅套与铠装之间' in item['rule_actual']
    common = document['cable_types'][0]['common_layers']
    common.remove(bedding)
    common.insert(0, bedding)  # Existing inner covering is inside the lead, not protective bedding outside it.
    scenario.save(document)
    assert row(scenario.check(), 'armour-separation')['verdict'] == 'missing'
    add_separator(document)
    scenario.save(document)
    report = scenario.check()
    assert_reference(row(report, 'armour-separation'), LEAD, {'lead_sheath_present': True})
    assert row(report, 'armour-separation')['verdict'] == 'missing'
    assert row(report, 'armour-separation-relation')['separation_relationship'] == 'additional_to_inner_covering'


def test_relationship_never_proves_qualification_and_checks_actual_layer_order(scenario):
    document = scenario.document()
    declare(document, 'longitudinal_water_barrier', False)
    add_separator(document, replace_bedding=True)
    scenario.save(document)
    report = scenario.check()
    relation = row(report, 'armour-separation-relation')
    assert_reference(relation, RELATION, {})
    assert relation['verdict'] == 'passed' and relation['separation_relationship'] == 'replace_inner_covering'
    assert row(report, 'armour-separation')['verdict'] == 'missing'
    underlayer = row(report, 'armour-underlayer')
    assert underlayer['verdict'] == 'missing'
    assert underlayer['basis_reference']['dependency_references'][0]['record']['id'] == RELATION
    common = document['cable_types'][0]['common_layers']
    separator = next(layer for layer in common if layer['role'] == 'separator')
    common.remove(separator)
    common.insert(next(i for i, layer in enumerate(common) if layer['role'] == 'armour') + 1, separator)
    scenario.save(document)
    report = scenario.check()
    assert row(report, 'armour-separation')['verdict'] == 'failed'
    assert row(report, 'armour-separation-relation')['verdict'] == 'failed'
    assert row(report, 'armour-underlayer')['verdict'] == 'failed'
    document = scenario.document()
    add_lead(document)
    add_separator(document)
    declare(document, 'longitudinal_water_barrier', False)
    common = document['cable_types'][0]['common_layers']
    separator = next(layer for layer in common if layer['role'] == 'separator')
    common.remove(separator)
    common.insert(0, separator)  # A separator below the lead cannot separate the lead and armour.
    scenario.save(document)
    report = scenario.check()
    assert row(report, 'armour-separation')['verdict'] == 'failed'
    assert row(report, 'armour-separation-relation')['verdict'] == 'failed'


def test_mixed_core_lead_and_copper_interfaces_do_not_share_the_lead_choice(scenario):
    document = scenario.document()
    add_lead(document)
    cable = document['cable_types'][0]
    lead = cable['common_layers'].pop(0)
    cable['cores'][0]['layers'].append(lead)
    # Declare 4 mm extra centre spacing so two 1.5 mm sheaths fit. This remains
    # a conditional design and must pass the actual Domain overlap validator.
    cores = cable['cores']
    distance = min(math.hypot(a['x']-b['x'], a['z']-b['z'])
                   for i,a in enumerate(cores) for b in cores[i+1:])
    scale = (distance + .004) / distance
    for core in cores:
        for axis in ('x', 'z'):
            core[axis] *= scale
            path = '/cable_types/' + cable['id'].replace('/', '~1') + '/cores/' + core['id'].replace('/', '~1') + '/' + axis
            document['provenance'][path] = {'kind':'user', 'reviewed':False,
                'reference':'条件性手工设计：保持原排布并增加4 mm芯间距；不是厂家结构数据'}
    declare(document, 'longitudinal_water_barrier', False)
    scenario.save(document)
    item = row(scenario.check(), 'armour-separation')
    assert item['verdict'] == 'uncovered' and item['basis_query'] is None
    assert '各芯相邻金属层同时含铅套与其他金属' in item['reason']
    declare(document, 'longitudinal_water_barrier', True)
    scenario.save(document)
    assert row(scenario.check(), 'armour-separation')['verdict'] == 'uncovered'
    declare(document, 'longitudinal_water_barrier', False)
    for core in cable['cores'][1:]:
        core['layers'].append(deepcopy(lead))
    scenario.save(document)
    item = row(scenario.check(), 'armour-separation')
    assert_reference(item, LEAD, {'lead_sheath_present': True})
    assert item['verdict'] == 'missing'  # All lead interfaces select r2, but supply no qualifying protection.
    # One surrounding common lead sheath also defines an unambiguous boundary,
    # independently of the differing metals inside that sheath.
    for core in cable['cores'][1:]:
        core['layers'].pop()
    add_lead(document)
    scenario.save(document)
    item = row(scenario.check(), 'armour-separation')
    assert_reference(item, LEAD, {'lead_sheath_present': True})
    assert item['verdict'] == 'missing'


def test_water_exception_needs_a_real_declaration_and_preserves_other_requirements(scenario):
    document = scenario.document()
    declare(document, 'longitudinal_water_barrier', True)
    scenario.save(document)
    report = scenario.check()
    item = row(report, 'armour-separation')
    assert_reference(item, WATER, {'longitudinal_water_barrier': True}, 12, 20)
    assert item['verdict'] == 'passed' and '不证明' in item['reason']
    assert row(report, 'armour-underlayer')['verdict'] != 'passed'
    document = scenario.document()
    add_separator(document)
    scenario.save(document)
    report = scenario.check()
    assert row(report, 'armour-separation')['verdict'] == 'missing'
    assert row(report, 'armour-separation')['source_status'] == 'input-missing'
    assert row(report, 'armour-separation-relation')['verdict'] == 'passed'
    declare(document, 'longitudinal_water_barrier', True)
    screen_material = document['cable_types'][0]['cores'][0]['layers'][-1]['material']
    next(material for material in document['materials'] if material['id'] == screen_material)['standard_kind'] = None
    scenario.save(document)
    assert row(scenario.check(), 'armour-separation')['source_status'] == 'input-missing'
    document = scenario.document()
    declare(document, 'longitudinal_water_barrier', True, kind='standard')
    scenario.save(document)
    response = scenario.client.post(f"/api/design/type-workspaces/{scenario.saved['id']}/requirements/basis",
                                    json={'request_id': str(uuid4()), 'expected_revision': scenario.saved['revision']})
    assert response.status_code == 422 and '标准条款不能代替' in response.text
    for reference in ('   ', 42):
        document = scenario.document()
        pointer = declare(document, 'longitudinal_water_barrier', True)
        source = document['provenance'][pointer]
        receipt = json.loads(source['reference'])
        receipt['reference'] = reference
        source['reference'] = json.dumps(receipt)
        scenario.save(document)
        response = scenario.client.post(f"/api/design/type-workspaces/{scenario.saved['id']}/requirements/basis",
                                        json={'request_id': str(uuid4()), 'expected_revision': scenario.saved['revision']})
        assert response.status_code == 422 and '非空文字出处' in response.text


def test_same_metal_and_common_screen_never_use_relationship_as_an_exemption(scenario):
    document = scenario.document()
    declare(document, 'longitudinal_water_barrier', False)
    add_separator(document)
    cable = document['cable_types'][0]
    armour = next(layer for layer in cable['common_layers'] if layer['role'] == 'armour')
    screen = next(layer for layer in cable['cores'][0]['layers'] if layer['role'] == 'metallic_screen')
    armour['material'] = screen['material']
    scenario.save(document)
    report = scenario.check()
    item = row(report, 'armour-separation')
    assert item['verdict'] == 'uncovered' and item['basis_query'] is None
    assert '独立免除判据' in item['reason']
    assert row(report, 'armour-separation-relation')['verdict'] == 'passed'
    # A common screen is a real adjacent metal; the consumer previously omitted it.
    document = scenario.document()
    declare(document, 'longitudinal_water_barrier', False)
    cable = document['cable_types'][0]
    common_screen = deepcopy(next(layer for layer in cable['cores'][0]['layers'] if layer['role'] == 'metallic_screen'))
    for core in cable['cores']:
        core['layers'] = [layer for layer in core['layers'] if layer['role'] != 'metallic_screen']
    cable['common_layers'].insert(0, common_screen)
    scenario.save(document)
    item = row(scenario.check(), 'armour-separation')
    assert_reference(item, REQUIRED, {'metal_layer_relation': 'different',
                                    'longitudinal_water_barrier': False, 'lead_sheath_present': False})
    assert item['separation_structure']['adjacent_metals'][0]['core_id'] is None
    assert item['verdict'] == 'missing'


def test_pinned_record_identity_and_changed_structure_reject_real_receipt_reuse(scenario):
    document = scenario.document()
    add_separator(document)
    declare(document, 'longitudinal_water_barrier', False)
    scenario.save(document)
    parameters = scenario.parameters()
    references = parameters['basis_references']
    required_key = next(key for key in references if key.endswith(':armour-separation'))
    relation_key = next(key for key in references if key.endswith(':armour-separation-relation'))
    tampered = deepcopy(parameters)
    # Both are genuinely returned, individually sealed records. A valid r3
    # nevertheless cannot answer the pinned r1 request, even with a valid hash.
    for name in ('record', 'record_sha256', 'record_id'):
        tampered['basis_references'][required_key][name] = deepcopy(references[relation_key][name])
    rejected = scenario.run(tampered)
    assert rejected.status == 'not_applicable'
    assert '固定记录标识' in rejected.error['message']
    document = deepcopy(scenario.saved['domain'])
    common = document['cable_types'][0]['common_layers']
    separator = next(layer for layer in common if layer['role'] == 'separator')
    common.remove(separator)
    common.insert(next(i for i, layer in enumerate(common) if layer['role'] == 'armour') + 1, separator)
    scenario.save(document)
    rejected = scenario.run(parameters)
    assert rejected.status == 'not_applicable' and '型号输入已变化' in rejected.error['message']


def test_real_rule_receipts_reject_changed_source_wrappers_and_query_types(scenario):
    document = scenario.document()
    add_separator(document)
    declare(document, 'longitudinal_water_barrier', True)
    scenario.save(document)
    parameters = scenario.parameters()
    control = scenario.run(parameters)
    assert control.status == 'succeeded'
    for suffix in ('armour-separation', 'armour-separation-relation'):
        assert row(control.artifacts['x-cablesim.standard-check'], suffix)['verdict'] == 'passed'
    cases = []
    changes = [('citation', 'GB/T 12706.3—2099 其他条款，第 999 页（PDF 第 999 页）'),
               ('nested_sha', '0'*64), ('source_sha256', '0'*64), ('record_id', REQUIRED),
               ('plugin_id', 'cablesim.other'), ('standard', 'GB/T 12706.3'), ('edition', '2099'),
               ('locator', '13.3.4'), ('printed_page', 999), ('pdf_page', 999)]
    for suffix in ('armour-separation', 'armour-separation-relation'):
        key = next(key for key in parameters['basis_references'] if key.endswith(':' + suffix))
        for field, value in changes:
            tampered = deepcopy(parameters)
            reference = tampered['basis_references'][key]
            if field == 'citation': reference['record']['citation'] = value
            elif field == 'nested_sha': reference['record']['record_sha256'] = value
            else: reference[field] = value
            cases.append({'case_id': suffix + '-' + field, 'input': scenario.saved['domain'],
                          'parameters': {'cable_type_id': document['cable_types'][0]['id'], **tampered}})
    water_key = next(key for key in parameters['basis_references'] if key.endswith(':armour-separation'))
    for recompute in (False, True):
        tampered = deepcopy(parameters)
        reference = tampered['basis_references'][water_key]
        reference['query']['conditions']['longitudinal_water_barrier'] = 1
        if recompute:
            reference['query_sha256'] = sha256(json.dumps(reference['query'], ensure_ascii=False,
                sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()
        cases.append({'case_id': 'water-query-type-' + str(recompute).lower(), 'input': scenario.saved['domain'],
                      'parameters': {'cable_type_id': document['cable_types'][0]['id'], **tampered}})
    rejected = scenario.executor.run('cablesim.standard-check', 'dimensions', cases)
    assert len(rejected.cases) == 22
    for case in rejected.cases:
        assert case.status == 'not_applicable' and not case.artifacts, (case.case_id, case.error)
        assert case.error['code'] == 'STANDARD_INPUT_INVALID' and '封签' in case.error['message']
    assert scenario.run(parameters).status == 'succeeded'  # Frozen original receipts remain unchanged.
