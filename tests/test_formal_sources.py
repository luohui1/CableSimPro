"""Formal files read real saved algebra/CAD evidence; no fixture results or FEM solver.

The positive fixtures execute the same public study/specification APIs as users.
Deliberately damaged copies below exercise rejection paths only. Approval tests
use an isolated database and the real local confirmation API; they do not alter
the release seed or create engineering measurements.
"""
from copy import deepcopy
import json
import re
import sqlite3
from uuid import uuid4

from fastapi import HTTPException
from fastapi.testclient import TestClient
import pytest

from backend.main import create_app
from backend.kernel.formal_contracts import canonical_bytes, jsonsha, raw_text, resolve_pointer
from backend.kernel.formal_sources import build_model, _verify_run
from backend.kernel.formal_units import domain_unit, numeric_leaves, parameter_unit
from backend.kernel.type_versions import can_exclude
from test_research import study, request as execution_request
from test_type_specification_generation import create_example, request as generation_request


@pytest.fixture(scope='module')
def saved(tmp_path_factory):
    with TestClient(create_app(tmp_path_factory.mktemp('formal-sources')/'engineering.sqlite')) as client:
        workspace = create_example(client)
        response = client.post(f'/api/types/{workspace["id"]}/specification/generate',
                               json=generation_request(workspace))
        assert response.status_code == 200, response.text
        assert response.json()['status'] == 'generated', response.json()
        assert all(step['status'] == 'calculated' for step in response.json()['steps'])
        specification = client.get(f'/api/types/{workspace["id"]}/specification?audience=internal&view=full').json()
        calculation_workspace, definition = study(client)
        definition_body = deepcopy(definition['definition'])
        definition_body['parameters']['rating_mode'] = 'both'
        definition_body.update(expected_revision=calculation_workspace['revision'],
                               expected_study_revision=definition['revision'])
        changed = client.put(f'/api/workspaces/{calculation_workspace["id"]}/studies/{definition["id"]}',
                             json=definition_body)
        assert changed.status_code == 200, changed.text
        definition = changed.json()
        root, body = execution_request(client, calculation_workspace, definition)
        executed = client.post(root + '/runs', json=body)
        assert executed.status_code == 200, executed.text
        run = client.get(root + '/runs/' + executed.json()['id'] + '?view=full').json()
        assert run['status'] == 'succeeded' and run['integrity'] == 'verified'
        rating_source = next(item for item in specification['payload']['sources'] if item['channel'] == 'rating')
        rating = client.app.state.research.get_run(workspace['id'], rating_source['run_id'])
        yield {'client': client, 'workspace': workspace, 'specification': specification,
               'calculation_workspace': calculation_workspace, 'calculation': run, 'rating_table': rating}


def selected(saved, kind):
    workspace = saved['workspace'] if kind in ('specification', 'rating_table') else saved['calculation_workspace']
    source = {'workspace_id': workspace['id'], 'expected_revision': workspace['revision'],
              'specification_digest': None, 'runs': []}
    if kind == 'specification':
        source['specification_digest'] = saved['specification']['digest']
    else:
        run = saved['rating_table' if kind == 'rating_table' else 'calculation']
        source['runs'] = [{'run_id': run['id'], 'input_digest': run['input_digest'], 'output_digest': run['output_digest']}]
    return {'kind': kind, 'source': source, 'document': {'organization': '正式文件来源回归测试',
            'number': 'SOURCE-CHECK', 'revision': 'A', 'header': '', 'footer': '',
            'issued_on': None, 'logo_data_uri': None}}


def model_for(saved, kind):
    app = saved['client'].app
    return build_model(app.state.research, app.state.types, selected(saved, kind))


def all_cells(model):
    return (cell for table in model['tables'].values() for row in table['rows'] for cell in row['cells'].values())


def visible_body(model):
    for section in model['sections']:
        if section['role'] != 'body':
            continue
        yield section['heading']
        yield from (paragraph['text'] for paragraph in section['paragraphs'])
        for identifier in section['table_ids']:
            table = model['tables'][identifier]
            yield table['title']
            yield from (column['label'] for column in table['columns'])
            yield from (cell['raw_text'] for row in table['rows'] for cell in row['cells'].values())


@pytest.mark.parametrize('kind', ['specification', 'calculation', 'rating_table', 'research_report'])
def test_each_model_is_an_exact_read_only_public_api_projection(saved, kind, monkeypatch):
    client = saved['client']
    store = client.app.state.workspace_store
    with store.db() as db:
        before = list(db.execute('SELECT id,input_digest,output_digest,status FROM study_runs ORDER BY id'))
    def no_solver(*args, **kwargs):
        raise AssertionError('formal exports must only read saved evidence')
    monkeypatch.setattr(client.app.state.research.executor, 'run', no_solver)
    model = model_for(saved, kind)
    assert canonical_bytes(model) == canonical_bytes(model_for(saved, kind))
    assert model['source_digest'] == jsonsha(model['sources'])
    assert model['model_digest'] == jsonsha({key: value for key, value in model.items() if key != 'model_digest'})
    assert [item['role'] for item in model['signatures']] == ['design', 'check', 'review', 'approve']
    assert all(item['name'] is None and item['date'] is None and item['evidence_ref'] is None for item in model['signatures'])
    for source in model['sources'].values():
        response = client.get(source['api_url'])
        assert response.status_code == 200, response.text
        api = response.json()
        if source['kind'] == 'workspace':
            expected = {key: api[key] for key in ('id', 'revision')}
        elif source['kind'] == 'run':
            expected = {'record': {key: api[key] for key in source['payload']['record']},
                        'snapshot': api['snapshot'], 'output': api['output']}
            assert jsonsha(expected['snapshot']) == expected['record']['input_digest']
            assert jsonsha(expected['output']) == expected['record']['output_digest']
        elif source['kind'] == 'specification':
            expected = {'payload': api['payload'], 'digest': api['digest'],
                        'lifecycle': {key: api['lifecycle'].get(key) for key in source['payload']['lifecycle']}}
        else:
            assert source['kind'] == 'rating_projection'
            expected = {'run_id': api['run']['id'], 'input_digest': api['run']['input_digest'],
                        'output_digest': api['run']['output_digest'], 'rows': api['rows']}
        assert canonical_bytes(source['payload']) == canonical_bytes(expected)
        assert source['payload_digest'] == jsonsha(expected)
    for cell in all_cells(model):
        assert cell['raw_text'] == raw_text(cell['value'])
        if cell['value_ref']:
            reference = cell['value_ref']
            actual = resolve_pointer(model['sources'][reference['source_id']]['payload'], reference['pointer'])
            assert canonical_bytes(actual) == canonical_bytes(cell['value'])
        if isinstance(cell['value'], (int, float)) and not isinstance(cell['value'], bool):
            assert cell['value_ref'] is not None
        unit_ref = cell['unit_ref']
        if unit_ref and 'source_id' in unit_ref:
            assert resolve_pointer(model['sources'][unit_ref['source_id']]['payload'], unit_ref['pointer']) == cell['unit']
    assert not re.search(r'(?:x-)?cablesim\.[A-Za-z0-9_.-]+', '\n'.join(visible_body(model)))
    trace = next(section for section in model['sections'] if section['role'] == 'trace')
    assert trace['heading'] == '追溯记录'
    with store.db() as db:
        after = list(db.execute('SELECT id,input_digest,output_digest,status FROM study_runs ORDER BY id'))
    assert [tuple(row) for row in before] == [tuple(row) for row in after]


def test_calculation_retains_each_distinct_rating_condition_and_complete_arrays(saved):
    run = saved['calculation']
    model = model_for(saved, 'calculation')
    source = 'run:' + run['id']
    cells = {(cell['value_ref']['source_id'], cell['value_ref']['pointer']): cell
             for cell in all_cells(model) if cell['value_ref']}
    conditions = set()
    for case_index, case in enumerate(run['output']['cases']):
        for result_index, quantity in enumerate(case['results']):
            if quantity.get('type', 'quantity') == 'quantity' and 'value' in quantity:
                path = f'/output/cases/{case_index}/results/{result_index}/value'
                assert cells[source, path]['value'] == quantity['value']
                assert cells[source, path]['raw_text'] == raw_text(quantity['value'])
                if quantity['key'] == 'ampacity':
                    conditions.add(quantity['case'])
    assert {'rating', 'rating-simultaneous'} <= conditions
    assert model['sources'][source]['payload']['output'] == run['output']
    assert model['sources'][source]['payload']['snapshot'] == run['snapshot']
    # Display-only IEC field evidence must not trigger the FEM proof gate.
    from backend.kernel.convergence import has_temperature_field
    assert not has_temperature_field(run)


def test_specification_has_five_engineering_sections_and_frozen_geometry_refs(saved):
    model = model_for(saved, 'specification')
    sections = {section['id']: section for section in model['sections']}
    assert {'specification:' + name for name in ('geometry', 'electrical', 'rating', 'short_circuit', 'standards')} <= sections.keys()
    figures = sections['specification:geometry']['figures']
    assert figures and figures[0]['kind'] == 'cable_section'
    for name in ('geometry_ref', 'input_ref'):
        reference = figures[0][name]
        frozen = resolve_pointer(model['sources'][reference['source_id']]['payload'], reference['pointer'])
        assert isinstance(frozen, dict) and frozen
    geometry = resolve_pointer(model['sources'][figures[0]['geometry_ref']['source_id']]['payload'],
                               figures[0]['geometry_ref']['pointer'])
    assert any(cell['value'] == geometry['outer_diameter_m'] and cell['unit'] == 'm' for cell in all_cells(model))
    assert sections['product']['table_ids']
    assert any(cell['unit'] == 'V' for table_id in sections['product']['table_ids']
               for row in model['tables'][table_id]['rows'] for cell in row['cells'].values())
    assert model['coverage']['policy'] == 'complete-frozen-payloads'


def test_research_report_keeps_separate_real_runs_and_method_traces(saved):
    request = selected(saved, 'specification')
    request['kind'] = 'research_report'
    request['source']['specification_digest'] = None
    chosen = [item for item in saved['specification']['payload']['sources']
              if item['channel'] in ('electrical', 'short_circuit')]
    request['source']['runs'] = [{key: item[key] for key in ('run_id', 'input_digest', 'output_digest')}
                                 for item in chosen]
    client = saved['client']
    model = build_model(client.app.state.research, client.app.state.types, request)
    assert [item['run_id'] for item in model['source_identity']['pins']] == [item['run_id'] for item in chosen]
    for item in chosen:
        source = 'run:' + item['run_id']
        assert source in model['sources']
        assert source + ':trace' in model['tables']
        assert any(section['id'] == source and section['table_ids'] for section in model['sections'])


def test_a_single_calculation_cannot_be_mislabelled_as_a_saved_rating_table(saved):
    request = selected(saved, 'calculation')
    request['kind'] = 'rating_table'
    with pytest.raises(HTTPException) as error:
        build_model(saved['client'].app.state.research, saved['client'].app.state.types, request)
    assert error.value.detail['code'] == 'FORMAL_NOT_RATING_TABLE'


def test_saved_temperature_limits_and_current_map_leaves_keep_their_identity(saved):
    model = model_for(saved, 'rating_table')
    seen = set()
    for table in model['tables'].values():
        for row in table['rows']:
            cell = row['cells'].get('value', {})
            reference = cell.get('value_ref')
            if not reference or '/snapshot/cases/' not in reference['pointer']:
                continue
            path = reference['pointer']
            label = row['cells']['item']['value']
            if '/max_conductor_temperature/normal' in path:
                assert '持续工况' in label
                seen.add('normal')
            if '/max_conductor_temperature/short_circuit' in path:
                assert '短路工况' in label
                seen.add('short_circuit')
            if '/currents/' in path:
                run_source = model['sources'][reference['source_id']]['payload']
                case_index = int(path.split('/')[3])
                document = run_source['snapshot']['cases'][case_index]['input']
                circuit_id = path.rsplit('/', 1)[-1].replace('~1', '/').replace('~0', '~')
                circuit = next(item for item in document['circuits'] if item['id'] == circuit_id)
                assert circuit['label'] in label
                seen.add('current')
    assert seen == {'normal', 'short_circuit', 'current'}


def test_inactive_duct_conditions_stay_archived_without_implying_they_were_used(saved):
    model = model_for(saved, 'rating_table')
    source = 'rating:' + saved['rating_table']['id']
    references = {(cell['value_ref']['source_id'], cell['value_ref']['pointer'])
                  for cell in all_cells(model) if cell['value_ref']}
    archived = {(item['source_id'], item['pointer']) for item in model['coverage']['additional_inputs']}
    layouts = set()
    for index, row in enumerate(model['sources'][source]['payload']['rows']):
        duct = row['condition']['layout'] in ('ducts', 'three_core_ducts_horizontal')
        layouts.add(duct)
        for key in ('duct_inner_m', 'duct_outer_m', 'duct_rho_k_m_w'):
            if key not in row['condition']:
                continue
            reference = (source, f'/rows/{index}/condition/{key}')
            if duct:
                assert reference in references
            else:
                assert reference not in references and reference in archived
    assert layouts == {False, True}


@pytest.mark.parametrize('damage,code', [('revision', 'FORMAL_REVISION_CHANGED'),
                                      ('input_digest', 'FORMAL_SOURCE_CHANGED'),
                                      ('output_digest', 'FORMAL_SOURCE_CHANGED')])
def test_changed_pins_are_rejected_before_rendering(saved, damage, code):
    request = selected(saved, 'calculation')
    if damage == 'revision':
        request['source']['expected_revision'] += 1
    else:
        request['source']['runs'][0][damage] = '0' * 64
    with pytest.raises(HTTPException) as error:
        build_model(saved['client'].app.state.research, saved['client'].app.state.types, request)
    assert error.value.status_code == 409 and error.value.detail['code'] == code


def test_cross_workspace_source_cannot_be_exported(saved):
    request = selected(saved, 'calculation')
    request['source'].update(workspace_id=saved['workspace']['id'], expected_revision=saved['workspace']['revision'])
    with pytest.raises(HTTPException) as error:
        build_model(saved['client'].app.state.research, saved['client'].app.state.types, request)
    assert error.value.status_code == 404 and error.value.detail['code'] == 'FORMAL_RUN_UNAVAILABLE'


def pin(run):
    return {'run_id': run['id'], 'input_digest': run['input_digest'], 'output_digest': run['output_digest']}


@pytest.mark.parametrize('damage', ['output', 'snapshot', 'method_manifest'])
def test_damaged_frozen_records_never_use_current_method_defaults(saved, damage):
    run = deepcopy(saved['calculation'])
    if damage == 'output':
        run['output']['cases'][0]['results'][0]['value'] += 1
        code = 'FORMAL_SOURCE_INTEGRITY'
    elif damage == 'snapshot':
        del run['snapshot']['cases'][0]['input']
        run['input_digest'] = jsonsha(run['snapshot'])
        code = 'FORMAL_FULL_SOURCE_REQUIRED'
    else:
        run['snapshot']['method_manifests'] = {}
        run['input_digest'] = jsonsha(run['snapshot'])
        code = 'FORMAL_METHOD_EVIDENCE'
    with pytest.raises(HTTPException) as error:
        _verify_run(saved['client'].app.state.research, run['workspace'], run, pin(run))
    assert error.value.detail['code'] == code


def test_fem_source_requires_existing_converged_proof_without_solving(saved, monkeypatch):
    run = deepcopy(saved['calculation'])
    # A negative input: falsely relabeling saved IEC data as a FEM module cannot
    # gain an engineering delivery without actual convergence evidence.
    run['snapshot']['module'] = 'thermal-field'
    run['input_digest'] = jsonsha(run['snapshot'])
    called = []
    def absent_proof(research, actual):
        called.append(actual['id'])
        return {'status': 'unconverged', 'reason': 'No saved workflow in this negative test.'}
    monkeypatch.setattr('backend.kernel.fem_evidence.proof', absent_proof)
    with pytest.raises(HTTPException) as error:
        _verify_run(saved['client'].app.state.research, run['workspace'], run, pin(run))
    assert error.value.detail['code'] == 'FORMAL_FEM_UNCONVERGED'
    assert called == [run['id']]


@pytest.mark.parametrize('verified,valid,code', [(False, True, 'FORMAL_COMPARISON_INTEGRITY'),
                                              (True, False, 'FORMAL_COMPARISON_INVALID')])
def test_comparison_needs_both_verified_artifact_and_saved_validity(saved, verified, valid, code):
    run = deepcopy(saved['calculation'])
    case = run['output']['cases'][0]
    case.setdefault('artifacts', {})['x-cablesim.iec-fem-comparison'] = {'valid': valid}
    run['output_digest'] = jsonsha(run['output'])
    run.setdefault('artifact_status', {}).setdefault(case['case_id'], {})['x-cablesim.iec-fem-comparison'] = {
        'status': 'verified' if verified else 'corrupt'}
    with pytest.raises(HTTPException) as error:
        _verify_run(saved['client'].app.state.research, run['workspace'], run, pin(run))
    assert error.value.detail['code'] == code


def test_only_real_matching_document_approval_fills_approve_role(saved, tmp_path):
    database = tmp_path/'approval.sqlite'
    with saved['client'].app.state.workspace_store.db() as source, sqlite3.connect(database) as target:
        source.backup(target)
    wid, revision = saved['workspace']['id'], saved['workspace']['revision']
    with TestClient(create_app(database)) as client:
        adopted = client.post(f'/api/types/{wid}/adopt', json={'expected_revision': revision, 'request_id': str(uuid4())})
        assert adopted.status_code == 200, adopted.text
        spec = client.get(f'/api/types/{wid}/specification?audience=internal&view=full').json()
        exclusions = [{'check_id': item['id'], 'reason': '此隔离测试只核对已保存计算及真实签核范围，不声明缺少的测量。'}
                      for item in spec['payload']['checks'] if item['blocking'] and can_exclude(item)]
        if exclusions:
            response = client.post(f'/api/types/{wid}/release-scope', headers={'X-CableSim-Actor': 'human'}, json={
                'expected_revision': revision, 'request_id': str(uuid4()), 'specification_digest': spec['digest'],
                'human_confirmed': True, 'exclusions': exclusions})
            assert response.status_code == 200, response.text
            spec = client.get(f'/api/types/{wid}/specification?audience=internal&view=full').json()
        assert spec['ready'], [item for item in spec['payload']['checks'] if item['blocking']]
        submitted = client.post(f'/api/types/{wid}/submissions', json={'expected_revision': revision,
            'request_id': str(uuid4()), 'specification_digest': spec['digest'], 'acknowledge_checks': True,
            'author': '仅修订作者，不是设计签名', 'change_summary': '真实来源与签栏范围回归测试'})
        assert submitted.status_code == 201, submitted.text
        request = selected(saved, 'specification')
        request['source']['specification_digest'] = submitted.json()['digest']
        pending = build_model(client.app.state.research, client.app.state.types, request)
        assert all(item['name'] is None for item in pending['signatures'])
        approved = client.post(f'/api/types/{wid}/approve', headers={'X-CableSim-Actor': 'human'}, json={
            'request_id': str(uuid4()), 'submission_id': submitted.json()['submission_id'],
            'specification_digest': submitted.json()['digest'], 'human_confirmed': True})
        assert approved.status_code == 200, approved.text
        model = build_model(client.app.state.research, client.app.state.types, request)
        receipt = approved.json()
        assert all(item['name'] is None and item['date'] is None for item in model['signatures'][:3])
        assert model['signatures'][-1]['name'] == receipt['reviewer']
        assert model['signatures'][-1]['date'] == receipt['approved_at']
        reference = model['signatures'][-1]['evidence_ref']
        assert resolve_pointer(model['sources'][reference['source_id']]['payload'], reference['pointer']) == receipt
        # A validly hashed but mismatched receipt scope still must be rejected.
        damaged = deepcopy(receipt)
        damaged['sources'] = []
        damaged['receipt_digest'] = jsonsha({key: value for key, value in damaged.items() if key != 'receipt_digest'})
        with client.app.state.workspace_store.db(True) as db:
            db.execute('UPDATE type_submissions SET receipt=? WHERE id=?',
                       (json.dumps(damaged, ensure_ascii=False), submitted.json()['submission_id']))
        with pytest.raises(HTTPException) as error:
            build_model(client.app.state.research, client.app.state.types, request)
        assert error.value.detail['code'] == 'FORMAL_APPROVAL_SCOPE'


def test_frozen_nested_schema_units_and_json_pointer_escaping():
    schema = {'type': 'object', 'definitions': {'Measure': {'type': 'object', 'properties': {
        'quantity': {'type': 'string'}, 'value': {'type': 'number', 'x-unit-by': {'selector': 'quantity',
            'cases': {'length': {'si': 'm'}, 'temperature': {'si': 'K'}}}}}}},
        'properties': {'a/b~c': {'type': 'array', 'items': {'$ref': '#/$defs/Measure'}},
                       'guessed_mm': {'type': 'number', 'default': 99}}}
    parameters = {'a/b~c': [{'quantity': 'length', 'value': 0.012345678901234567},
                           {'quantity': 'temperature', 'value': 293.15}], 'guessed_mm': 7, 'enabled': True}
    leaves = dict(numeric_leaves(parameters))
    assert set(leaves) == {'/a~1b~0c/0/value', '/a~1b~0c/1/value', '/guessed_mm'}
    for index, expected in enumerate(('m', 'K')):
        result = parameter_unit(schema, parameters, f'/a~1b~0c/{index}/value', 'source')
        assert result['unit'] == expected
        prefix = '/snapshot/input_contract/parameter_schema'
        assert resolve_pointer(schema, result['unit_ref']['pointer'][len(prefix):]) == expected
    assert parameter_unit(schema, parameters, '/guessed_mm', 'source') is None
    assert domain_unit({'unknown_mm': 5}, '/unknown_mm', 'source', '/input') is None


def test_ambiguous_frozen_unit_does_not_choose_an_installed_default():
    schema = {'type': 'object', 'properties': {'value': {'anyOf': [
        {'type': 'number', 'x-unit': {'si': 'm'}}, {'type': 'number', 'x-unit': {'si': 'mm'}}]}}}
    assert parameter_unit(schema, {'value': 3}, '/value', 'source') is None

