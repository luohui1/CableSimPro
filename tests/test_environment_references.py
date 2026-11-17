"""Real IEC environment records enter the existing asset and rating workflow.

Public catalogue values remain manufacturer facts. Every other calculation
condition below is an explicitly named research assumption, not a site reading.
"""
from copy import deepcopy
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from backend.main import create_app
from backend.domain.guards import pointer
from backend.foundation.contracts import content_hash
from backend.kernel.public_catalogues import sample_bytes


HUMAN = {'X-CableSim-Actor': 'human'}
ROOT = '/api/library/resources/environment'
PARAMETERS = {'ks': 1, 'kp': 1, 'eddy': 'ignored', 't4_form': 'exact',
    'reference_basis': 'iec2023', 'solver': {'initial_sheath_temperature_c': 70,
    'current_tolerance_a': 1e-8, 'max_iterations': 300},
    'source': '明示研究工况；IEC参考ks=kp=1、忽略涡流、精确T4；70℃仅是数值迭代初值。'}


@pytest.fixture(scope='module')
def context(tmp_path_factory):
    with TestClient(create_app(tmp_path_factory.mktemp('environment') / 'library.sqlite')) as client:
        uploaded = client.post('/api/type-library/imports/upload', files={
            'file': ('people.xlsx', sample_bytes('people-mv'))})
        assert uploaded.status_code == 201, uploaded.text
        uploaded = uploaded.json()
        declaration = deepcopy(uploaded['declarations'][1])
        declaration.pop('table')
        declaration['series']['name'] = '人民三芯公开结构 · 环境参考研究'
        response = client.post('/api/type-library/imports/preview', json={
            'upload_id': uploaded['upload_id'], **declaration})
        assert response.status_code == 200, response.text
        checked = response.json()
        saved = client.post('/api/type-library/imports/commit', headers=HUMAN, json={
            'preview_id': checked['preview_id'], 'preview_digest': checked['preview_digest'],
            'request_id': str(uuid4()), 'human_confirmed': True})
        assert saved.status_code == 201, saved.text
        series = saved.json()
        spec = client.get('/api/type-library/specs/' + series['specs'][0]['id']).json()['spec']
        workspace = client.get('/api/workspaces/' + spec['workspace_id']).json()
        document = deepcopy(workspace['domain'])
        original_cable = deepcopy(document['cable_types'])
        original_materials = deepcopy(document['materials'])
        circuit = document['circuits'][0]
        assert circuit['system'].get('voltage') is None
        # An explicit ordinary Types revision supplies the research system
        # facts. The reference workflow itself never fills these from rating U.
        circuit['system'].update(kind='ac_three_phase', frequency=50, voltage=15000)
        circuit['cables'][0]['phase'] = 'L1L2L3'
        for key in ('kind', 'frequency', 'voltage'):
            document['provenance'][pointer('circuits', circuit['id'], 'system', key)] = {
                'kind': 'user', 'reviewed': False,
                'reference': '明确研究输入：系统线电压15kV、三相50Hz；不是厂家属性，也不表示现场勘测。'}
        revision = client.put('/api/types/' + spec['workspace_id'] + '/document', json={
            'expected_revision': workspace['revision'], 'request_id': str(uuid4()), 'document': document})
        assert revision.status_code == 200, revision.text
        assert revision.json()['domain']['cable_types'] == original_cable
        assert revision.json()['domain']['materials'] == original_materials
        spec = client.get('/api/type-library/specs/' + spec['id']).json()['spec']
        yield client, series, spec


def selected(client, table_id, record_id, **conditions):
    result = client.get('/api/library/resources/table', params={
        'category': 'environment', 'table_id': table_id})
    assert result.status_code == 200, result.text
    table = result.json()
    record = next(row for row in table['rows'] if row['id'] == record_id)
    return {'release_digest': table['release_digest'], 'data_sha256': table['data_sha256'],
        'standard': record['standard'], 'edition': record['edition'], 'locator': record['table'] or record['clause'],
        'quantity': record['quantity']['key'], 'record_id': record['id'],
        'conditions': {**record['conditions'], **conditions}}


def depth_selection(client):
    return selected(client, 'iec60287-3-1-annex-a4', 'iec60287-3-1-annex-a4/r5/value', u_v=15000)


def soil_selection(client):
    return selected(client, 'iec60287-3-1-table2', 'iec60287-3-1-table2/r2/thermal_resistivity')


def asset(client, selection, *, publish=True):
    body = {'asset_id': f'local.installation.reference.{uuid4()}', 'version': '1.0.0',
            'name': '明确研究条件下的环境参考', 'selections': [selection]}
    count = client.get('/api/foundation/assets', params={'kind': 'installation'}).json()['total']
    response = client.post(ROOT + '/draft-preview', json=body, headers={'X-CableSim-Actor': 'agent'})
    assert response.status_code == 200, response.text
    checked = response.json()
    assert checked['approval'] == 'not_granted' and not checked['applied_to_workspace']
    assert client.get('/api/foundation/assets', params={'kind': 'installation'}).json()['total'] == count
    commit = {**body, 'preview_digest': checked['preview_digest'], 'human_confirmed': True}
    assert client.post(ROOT + '/draft', json=commit, headers={'X-CableSim-Actor': 'agent'}).status_code == 403
    assert client.post(ROOT + '/draft', json={**commit, 'preview_digest': '0' * 64}, headers=HUMAN).status_code == 409
    response = client.post(ROOT + '/draft', json=commit, headers=HUMAN)
    assert response.status_code == 201, response.text
    value = response.json()
    assert value['kind'] == 'installation' and value['status'] == 'draft'
    assert not value['applied_to_workspace']
    if publish:
        value = publish_asset(client, value)
    return value


def publish_asset(client, value):
    for action in ('review', 'publish'):
        response = client.post('/api/foundation/assets/' + value['id'] + '/transition', json={
            'expected_revision': value['revision'], 'content_sha256': value['content_sha256'],
            'action': action, 'acknowledge_sources': True,
            'note': '人工核对原表及明确研究条件；保留参考分档，不是现场测量。'})
        assert response.status_code == 200, response.text
        value = response.json()
    return value


def preview_request(spec, value, selection):
    return {'workspace_id': spec['workspace_id'], 'expected_revision': spec['workspace_revision'],
        'row': {'case_id': 'reference-ground', 'name': '明确条件的环境参考研究',
            'layout': 'three_core_buried_single', 'depth_m': .9, 'soil_rho_k_m_w': 1.2,
            'ambient_temperature_c': 25, 'frequency_hz': 50, 'bonding': 'both_ends',
            'rating_basis': 'simultaneous', 'source': '研究假设：中心埋深0.9m、土温25℃、热阻率1.2 K·m/W、50Hz、两端接地；非现场事实，埋深不取自A.4。'},
        'resources': [{'resource_id': value['id'], 'content_sha256': value['content_sha256'],
                       'parameter': value['release']['parameters'][0]['name']}],
        'conditions': deepcopy(selection['conditions'])}


def batch_request(spec, request, result):
    return {'request_id': str(uuid4()), 'operation': 'calculate', 'spec_ids': [spec['id']],
        'expected_versions': {spec['id']: spec['version']},
        'expected_revisions': {spec['id']: spec['workspace_revision']},
        'human_confirmed': True, 'scope_acknowledged': True, 'parameters': PARAMETERS,
        'rows': [result['proposed']], 'environment_references': [
            {**request, 'preview_digest': result['preview_digest'], 'human_confirmed': True}]}


def test_real_reference_publication_preview_and_actual_rating_keep_fixed_evidence(context):
    client, series, spec = context
    selection = soil_selection(client)
    value = asset(client, selection, publish=False)
    request = preview_request(spec, value, selection)
    refusal = client.post(ROOT + '/preview', json=request)
    assert refusal.status_code == 422 and refusal.json()['detail']['code'] == 'ENVIRONMENT_ASSET_NOT_PUBLISHED'
    value = publish_asset(client, value)
    request = preview_request(spec, value, selection)
    request['row']['source'] += '本次研究另明示：国家参考资料不可用、土壤湿润、规律降雨；不是厂家产地或现场条件推断。'
    before = client.get('/api/workspaces/' + spec['workspace_id']).json()
    response = client.post(ROOT + '/preview', json=request)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result['before']['soil_rho_k_m_w'] == 1.2 and result['proposed']['soil_rho_k_m_w'] == 1
    assert result['proposed']['depth_m'] == result['before']['depth_m'] == .9
    assert result['trust']['grade'] == 'reference' and result['approval'] == 'not_granted'
    assert result['applied_to_workspace'] is False
    change = result['changes'][0]
    evidence = change['reference_evidence']
    record = evidence['receipt']['record']
    assert evidence['quantity'] == {'value': 1, 'unit': 'K.m/W', 'dimension': 'thermal_resistivity'}
    assert evidence['selection']['conditions'] == {
        'national_reference': 'unavailable', 'soil_moisture': 'moist', 'weather_pattern': 'regular_rain'}
    assert result['target_facts']['frequency']['value'] == 50
    assert (record['value'], record['printed_page'], record['pdf_page']) == (1, 7, 39)
    assert record['source_sha256'] == '618e8d8cd829a15cb0bdcf08af4d73afc0b8928a3ea0eeb42bdc75cc87b08f63'
    assert record['record_sha256'] == evidence['record_sha256'] == 'bcb4c7549feaaaa00890740eb50af37d3fa15ec84f1c3986cd1d2a5b31f6afaa'
    assert evidence['receipt']['method']['method_version'] == '0.9.0'
    body = batch_request(spec, request, result)
    endpoint = '/api/type-library/series/' + series['series_id'] + '/batch'
    assert client.post(endpoint, json=body, headers={'X-CableSim-Actor': 'agent'}).status_code == 403
    executed = client.post(endpoint, json=body, headers=HUMAN)
    assert executed.status_code == 200, executed.text
    batch = executed.json()
    assert batch['status'] == 'succeeded', batch
    item = batch['items'][0]
    assert item['rows'][0]['value_a'] > 0
    assert client.post(endpoint, json=body, headers=HUMAN).json() == batch
    url = f"/api/workspaces/{spec['workspace_id']}/studies/{item['study_id']}/runs/{item['run_id']}"
    saved = client.get(url).json()
    case = saved['snapshot']['definition']['driver']['cases'][0]
    fixed = case['metadata']['environment_references']
    assert fixed['changes'] == result['changes']
    assert fixed['conditions'] == selection['conditions'] and fixed['preview_digest'] == result['preview_digest']
    assert fixed['human_confirmed'] is True and fixed['adopted_to'] == 'saved_rating_condition'
    assert fixed['trust']['grade'] == 'reference' and fixed['approval'] == 'not_granted'
    assert item['rows'][0]['environment_references'] == fixed
    assert any(source['kind'] == 'asset' and evidence['record_sha256'] in source['reference']
               for source in case['input']['provenance'].values())
    after = client.get('/api/workspaces/' + spec['workspace_id']).json()
    assert after['domain'] == before['domain'] and after['revision'] == before['revision']
    # A separately published asset version does not rewrite saved calculations.
    derived = client.post('/api/foundation/assets/' + value['id'] + '/derive', json={
        'expected_revision': value['revision'], 'content_sha256': value['content_sha256'],
        'new_version': '1.1.0'})
    assert derived.status_code == 201, derived.text
    newer = publish_asset(client, derived.json())
    assert newer['content_sha256'] != value['content_sha256']
    assert client.get(url).json()['snapshot'] == saved['snapshot']
    assert fixed['changes'][0]['asset_ref']['version'] == '1.0.0'
    retired = client.post('/api/foundation/assets/' + value['id'] + '/transition', json={
        'expected_revision': value['revision'], 'content_sha256': value['content_sha256'],
        'action': 'deprecate', 'note': '后续研究改用单独发布版本；既有计算回执保持原值。'})
    assert retired.status_code == 200, retired.text
    assert client.post(ROOT + '/preview', json=request).status_code == 422
    assert client.get(url).json()['snapshot'] == saved['snapshot']


@pytest.mark.parametrize('voltage', [None, 110000, {'gt': 1000, 'lte': 35000}])
def test_actual_voltage_must_match_fixed_reference_not_rating_or_predicate(context, voltage):
    client, _, spec = context
    selection = depth_selection(client)
    request = preview_request(spec, asset(client, selection), selection)
    if voltage is None:
        request['conditions'].pop('u_v')
    else:
        request['conditions']['u_v'] = voltage
    response = client.post(ROOT + '/preview', json=request)
    assert response.status_code == 422, response.text
    assert response.json()['detail']['code'] == 'ENVIRONMENT_SYSTEM_FACT_CONFLICT'


@pytest.mark.parametrize('change,code', [
    ('missing_voltage', 'ENVIRONMENT_SYSTEM_FACT_MISSING'),
    ('missing_source', 'ENVIRONMENT_SYSTEM_FACT_MISSING'),
    ('actual_high_voltage', 'ENVIRONMENT_SYSTEM_FACT_CONFLICT'),
    ('rated_high_voltage', 'ENVIRONMENT_RATED_VOLTAGE_OUTSIDE'),
    ('frequency', 'ENVIRONMENT_SYSTEM_FACT_CONFLICT'),
    ('multiple_circuits', 'ENVIRONMENT_SYSTEM_CONTEXT_AMBIGUOUS'),
])
def test_saved_domain_facts_cannot_be_bypassed_with_matching_client_claims(context, change, code):
    client, _, spec = context
    selection = depth_selection(client)
    value = asset(client, selection)
    workspace = client.get('/api/workspaces/' + spec['workspace_id']).json()
    document = deepcopy(workspace['domain'])
    circuit = document['circuits'][0]
    voltage_path = pointer('circuits', circuit['id'], 'system', 'voltage')
    if change == 'missing_voltage':
        circuit['system']['voltage'] = None
    elif change == 'missing_source':
        document['provenance'].pop(voltage_path)
    elif change == 'actual_high_voltage':
        circuit['system']['voltage'] = 110000
    elif change == 'frequency':
        circuit['system']['frequency'] = 60
    elif change == 'multiple_circuits':
        another = deepcopy(circuit)
        another['id'] = 'circuit/second-reference'
        another['cables'][0]['id'] = 'cable/second-reference'
        another['system']['voltage'] = 110000
        document['circuits'].append(another)
        document['sections'][0]['placements'].append({
            **deepcopy(document['sections'][0]['placements'][0]),
            'cable': another['cables'][0]['id'], 'x': 2})
        for key in ('frequency', 'voltage'):
            document['provenance'][pointer('circuits', another['id'], 'system', key)] = {
                'kind': 'user', 'reviewed': False,
                'reference': '明确拒绝反例：第二回路设为110kV；验证不自动取第一回路的15kV。'}
    else:
        # A deliberately edited negative case, not asserted manufacturer data.
        cable = document['cable_types'][0]
        cable['rating'].update(u0=64000, u=110000, um=123000)
        document['provenance'][pointer('cable_types', cable['id'], 'rating')] = {
            'kind': 'user', 'reviewed': False, 'reference': '错误注入反例：将电压等级改成110kV验证范围拒绝；不是厂家数据。'}
    branched = client.post('/api/types/' + spec['workspace_id'] + '/plans', json={
        'expected_revision': workspace['revision'], 'request_id': str(uuid4()),
        'name': '环境依据适用性拒绝反例', 'document': document})
    assert branched.status_code == 201, branched.text
    branch = client.get('/api/workspaces/' + branched.json()['workspace_id']).json()
    request = preview_request(spec, value, selection)
    request.update(workspace_id=branch['id'], expected_revision=branch['revision'])
    # The same apparently matching client claim is insufficient in every case.
    assert request['conditions']['u_v'] == 15000
    response = client.post(ROOT + '/preview', json=request)
    assert response.status_code == 422, response.text
    assert response.json()['detail']['code'] == code


def test_ranges_and_different_ground_depth_are_not_adopted(context):
    client, _, spec = context
    source = selected(client, 'iec60287-3-1-annex-a4', 'iec60287-3-1-annex-a4/r1/value')
    count = client.get('/api/foundation/assets', params={'kind': 'installation'}).json()['total']
    refused = client.post(ROOT + '/draft-preview', json={'asset_id': 'local.range', 'version': '1.0.0',
        'name': '不准选择区间中点', 'selections': [source]})
    assert refused.status_code == 422
    assert client.get('/api/foundation/assets', params={'kind': 'installation'}).json()['total'] == count
    source = selected(client, 'iec60287-3-1-table1', 'iec60287-3-1-table1/r3/ground_max_c')
    value = asset(client, source)
    assert value['release']['parameters'][0]['quantity'] == {
        'value': 293.15, 'unit': 'K', 'dimension': 'absolute_temperature'}
    request = preview_request(spec, value, source)
    request['row']['depth_m'] = .7
    request['conditions']['temperature_basis'] = 'ground_max_c'
    refused = client.post(ROOT + '/preview', json=request)
    assert refused.status_code == 422 and refused.json()['detail']['code'] == 'ENVIRONMENT_DEPTH_MISMATCH'
    request['row']['depth_m'] = 1
    valid = client.post(ROOT + '/preview', json=request)
    assert valid.status_code == 200, valid.text
    assert valid.json()['proposed']['ambient_temperature_c'] == 20
    request['conditions'].pop('temperature_basis')
    assert client.post(ROOT + '/preview', json=request).json()['detail']['code'] == 'ENVIRONMENT_TEMPERATURE_BASIS_REQUIRED'
    request['conditions']['temperature_basis'] = 'ground_max_c'
    request['conditions']['national_reference'] = 'available'
    refused = client.post(ROOT + '/preview', json=request)
    assert refused.status_code == 422
    assert '国家参考资料可用性' in refused.json()['detail']['message']
    assert 'national_reference' not in refused.json()['detail']['message']


@pytest.mark.parametrize('ducts', [False, True])
def test_unstated_depth_datum_cannot_become_cable_or_duct_centre_depth(context, ducts):
    client, _, spec = context
    selection = depth_selection(client)
    value = asset(client, selection)
    # The unambiguous original number remains available as a reference asset;
    # neither publication nor a client-supplied datum makes it a centre depth.
    assert value['status'] == 'published'
    assert value['release']['reference_evidence'][0]['receipt']['record']['value'] == .7
    request = preview_request(spec, value, selection)
    request['conditions']['depth_basis'] = 'cable_centre'
    if ducts:
        request['row'].update(layout='three_core_ducts_horizontal', spacing_m=.5,
            duct_inner_m=.14, duct_outer_m=.16, duct_rho_k_m_w=6)
    response = client.post(ROOT + '/preview', json=request)
    assert response.status_code == 422, response.text
    assert response.json()['detail']['code'] == 'ENVIRONMENT_DEPTH_REFERENCE_UNSUPPORTED'
    assert '测量基准' in response.json()['detail']['message']


def test_changed_pin_edited_number_and_changed_row_refuse_before_saving_study(context):
    client, series, spec = context
    selection = soil_selection(client)
    value = asset(client, selection)
    request = preview_request(spec, value, selection)
    changed = deepcopy(request)
    changed['resources'][0]['content_sha256'] = '0' * 64
    response = client.post(ROOT + '/preview', json=changed)
    assert response.status_code == 409 and response.json()['detail']['code'] == 'ENVIRONMENT_ASSET_CHANGED'
    changed = deepcopy(request)
    changed['expected_revision'] += 1
    response = client.post(ROOT + '/preview', json=changed)
    assert response.status_code == 409 and response.json()['detail']['code'] == 'ENVIRONMENT_TARGET_CHANGED'
    release = deepcopy(value['release'])
    release['asset_id'] += '.edited'
    release['parameters'][0]['quantity']['value'] = .8
    release['reference_evidence'][0]['quantity']['value'] = .8
    imported = client.post('/api/foundation/assets/import', json={'release': release})
    assert imported.status_code == 422 and 'RESOURCE_REFERENCE_QUANTITY_MISMATCH' in imported.text
    # Even a self-consistent forged receipt is insufficient: the sealed
    # provider, rather than a client-supplied digest, owns the published value.
    evidence = release['reference_evidence'][0]
    evidence['receipt']['quantity']['value'] = .8
    record = evidence['receipt']['record']
    record['value'] = .8
    record['record_sha256'] = content_hash({key: value for key, value in record.items()
                                          if key not in ('record_sha256', 'citation')})
    evidence['record_sha256'] = record['record_sha256']
    imported = client.post('/api/foundation/assets/import', json={'release': release})
    assert imported.status_code == 201, imported.text
    altered = publish_asset(client, imported.json())
    changed = preview_request(spec, altered, selection)
    response = client.post(ROOT + '/preview', json=changed)
    assert response.status_code == 409 and response.json()['detail']['code'] == 'RESOURCE_REFERENCE_CHANGED'
    result = client.post(ROOT + '/preview', json=request).json()
    body = batch_request(spec, request, result)
    body['rows'][0]['soil_rho_k_m_w'] = 1.1
    response = client.post('/api/type-library/series/' + series['series_id'] + '/batch', json=body, headers=HUMAN)
    assert response.status_code == 200, response.text
    refusal = response.json()['items'][0]
    assert refusal['status'] == 'failed' and refusal['detail']['code'] == 'ENVIRONMENT_ROW_CHANGED'
    assert 'study_id' not in refusal and 'run_id' not in refusal


def test_missing_conditions_and_cross_kind_assets_cannot_supply_defaults(context):
    client, _, spec = context
    selection = depth_selection(client)
    request = preview_request(spec, asset(client, selection), selection)
    request['row'].pop('frequency_hz')
    assert client.post(ROOT + '/preview', json=request).status_code == 422
    selection['quantity'] = 'solar_intensity'
    selection['record_id'] = 'iec60287-3-1-annex-a4/r9/value'
    response = client.post(ROOT + '/draft-preview', json={'asset_id': 'local.solar', 'version': '1.0.0',
        'name': '太阳辐射不能代替其他环境值', 'selections': [selection]})
    assert response.status_code == 422 and response.json()['detail']['code'] == 'ENVIRONMENT_REFERENCE_UNSUPPORTED'


@pytest.mark.parametrize('format', ['json', 'xlsx'])
def test_installation_reference_exchange_preserves_full_source_and_resets_publication(context, tmp_path, format):
    client, _, _ = context
    value = asset(client, depth_selection(client))
    exported = client.post('/api/library/exchange/export', json={
        'asset_ids': [value['id']], 'workspace_ids': [], 'format': format})
    assert exported.status_code == 200, exported.text
    with TestClient(create_app(tmp_path / 'target.sqlite')) as target:
        upload = {'file': ('environment.' + format, exported.content)}
        checked = target.post('/api/library/exchange/preview', files=upload)
        assert checked.status_code == 200, checked.text
        imported = target.post('/api/library/exchange/import', files=upload, headers=HUMAN, data={
            'request_id': str(uuid4()), 'reviewed_sha256': checked.json()['sha256'], 'confirmed': 'true'})
        assert imported.status_code == 201, imported.text
        receipt = imported.json()
        assert receipt['approval_inherited'] is False
        detail = target.get('/api/foundation/assets/' + receipt['assets'][0]['id']).json()
        assert detail['status'] == 'draft' and detail['kind'] == 'installation'
        assert detail['release'] == value['release']
        assert detail['content_sha256'] == value['content_sha256']
        assert detail['release']['reference_evidence'][0]['receipt']['trust']['grade'] == 'reference'
