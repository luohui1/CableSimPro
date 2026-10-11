"""Sealed UI contracts, bounded answers, analytical fields and ephemeral execution."""
from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from backend.plugin_host.manifest import Manifest
from cablesim_sdk.parameter_units import translate
from test_research import client, study, request

ROOT=Path(__file__).resolve().parents[1]


def test_all_capabilities_are_sealed_self_describing_and_assets_match(client):
    methods=client.get('/api/methods').json()
    contracts=client.get('/api/input-contracts').json()
    assert len(methods)==12 and len(contracts)==55
    # Four-core creation advertises version 2; saved version-1 requests remain
    # exercised through the real creation API in test_type_creation.py.
    assert {'cablesim.cable-design-request/2','cablesim.core-layout-request/2'} <= {item['input_schema'] for item in contracts}
    for item in methods:
        declared=json.loads((ROOT/'plugins'/item['method']['plugin_id']/'plugin.json').read_text('utf-8'))
        assert item['method']['version']==declared['version']
        capabilities={cap['id']:cap for cap in declared['capabilities']}
        assert all(cap['method_version']==capabilities[cap['id']]['method_version'] for cap in item['capabilities'])
        for asset in item['resources']:
            response=client.get(asset['url'])
            assert response.status_code==200,response.text
            assert sha256(response.content).hexdigest()==asset['sha256']
            assert client.get(asset['url'].split('?')[0]+'?sha256='+'0'*64).status_code==409
    raw=json.loads((ROOT/'plugins/cablesim.type-electrical/plugin.json').read_text('utf-8'))
    invalid=deepcopy(raw)
    invalid['capabilities'][0]['parameter_schema']['properties']['temperature_k'].pop('x-range-basis')
    with pytest.raises(ValidationError):Manifest.model_validate(invalid)
    raw['capabilities'][0]['parameter_schema']['properties']['temperature_k']['title']='temperature'
    with pytest.raises(ValidationError):Manifest.model_validate(raw)
    invalid=json.loads((ROOT/'plugins/cablesim.simulation/plugin.json').read_text('utf-8'))
    thermal=next(cap for cap in invalid['capabilities'] if cap['id']=='elmer-heat')
    units=thermal['input_contract']['standalone_schema']['$defs']['contract_Excitation']['properties']['value']['x-unit-by']
    units['cases'].pop('heat_w_m')
    with pytest.raises(ValidationError):Manifest.model_validate(invalid)


def test_preview_keeps_unsaved_input_and_results_out_of_database(client,monkeypatch):
    w,s=study(client)
    root=f'/api/workspaces/{w["id"]}/studies/{s["id"]}'
    draft=deepcopy(s['definition']['method_input'])
    draft['load_cases'][0]['currents']['circuit/c1']=160
    response=client.post(root+'/preview',json={'expected_revision':w['revision'],
        'expected_study_revision':s['revision'],'method_input':draft,'parameters':s['definition']['parameters']})
    assert response.status_code==200,response.text
    value=response.json()
    assert value['preview'] and value['persisted'] is False and value['engineering_approval'] is False
    assert value['status']=='succeeded' and value['elapsed_ms']>0
    assert client.get(root+'/runs').json()['items']==[]
    assert client.get(root).json()['definition']==s['definition']
    assert client.post(root+'/preview',json={'expected_revision':w['revision'],
        'expected_study_revision':s['revision'],'parameters':{'source_bundle':{}}}).status_code==422
    with monkeypatch.context() as patch:
        def timeout(*args,**kwargs):
            from backend.plugin_host import PluginHostError
            assert kwargs['timeout_s']==8
            raise PluginHostError('TIMEOUT','预览超时，进程已终止。',504)
        patch.setattr(client.app.state.research.executor,'run',timeout)
        assert client.post(root+'/preview',json={'expected_revision':w['revision'],
            'expected_study_revision':s['revision']}).status_code==504
    assert client.get(root+'/runs').json()['items']==[]
    method=next(m['method'] for m in client.get('/api/methods').json() if m['method']['plugin_id']=='cablesim.cable-geometry')
    updated=client.put(root,json={**s['definition'],'method':{**method,'capability':'concentric-model'},
        'parameters':{'cable_type_id':draft['cable_types'][0]['id']},'expected_revision':w['revision'],
        'expected_study_revision':s['revision']})
    assert updated.status_code==200,updated.text
    assert client.post(root+'/preview',json={'expected_revision':w['revision'],
        'expected_study_revision':updated.json()['revision']}).status_code==422


def test_iec_soil_field_and_headlines_are_verified_from_same_case(client):
    w,s=study(client)
    root=f'/api/workspaces/{w["id"]}/studies/{s["id"]}'
    draft=deepcopy(s['definition']['method_input'])
    for i,placement in enumerate(draft['sections'][0]['placements']):
        placement.update(x=i*.3,z=-1.2)
    s=client.put(root,json={**s['definition'],'method_input':draft,'expected_revision':w['revision'],
        'expected_study_revision':s['revision']}).json()
    root,body=request(client,w,s)
    response=client.post(root+'/runs',json=body)
    assert response.status_code==200,response.text
    run=response.json();case=run['output']['cases'][0]
    assert run['status']=='succeeded',run.get('error')
    field=case['artifacts']['x-cablesim.temperature-field']
    assert field['source']['binding']=='iec-trace'
    assert field['source']['trace_sha256']==case['artifact_digests']['x-cablesim.iec60287-trace']
    assert run['artifact_status'][case['case_id']]['x-cablesim.temperature-field']['status']=='verified'
    assert all(row['absolute_error_k']<=.1 for row in field['analytical_soil_view']['surface_checks'])
    assert max(field['temperature_k'])==field['hotspot']['temperature_k']
    summary=client.get(root+'/runs?view=summary').json()['items'][0]
    assert 1<=len(summary['headlines'])<=3,(run['artifact_status'],case.get('method'),case['artifacts'].get('x-cablesim.headline-witness'),run['snapshot']['headline_contract'])
    assert all(answer['value'] is not None and answer['case_id']==case['case_id'] for answer in summary['headlines'])
    damaged=deepcopy(run)
    damaged['output']['cases'][0]['artifacts']['x-cablesim.temperature-field']['source']['trace_sha256']='0'*64
    status=client.app.state.research.artifact_status(damaged)
    assert 'verified' not in str(status.get(case['case_id'],{}).get('x-cablesim.temperature-field'))


def test_explicit_upgrade_normalizes_saved_si_without_rewriting_run(client):
    w,s=study(client)
    root,body=request(client,w,s)
    run=client.post(root+'/runs',json=body).json()
    with client.app.state.workspace_store.db(True) as db:
        row=db.execute('SELECT definition FROM study_versions WHERE study=? AND revision=?',(s['id'],s['revision'])).fetchone()
        definition=json.loads(row['definition'])
        definition['method']['version']='0.8.0';definition['method']['release_digest']='0'*64
        definition['parameters']['duct']={'u':1.87,'v':.1,'y_per_k':.006,'initial_mean_air_temperature_c':20}
        db.execute('UPDATE study_versions SET definition=? WHERE study=? AND revision=?',(json.dumps(definition),s['id'],s['revision']))
    response=client.post(root+'/upgrade-methods',json={'expected_revision':w['revision'],'expected_study_revision':s['revision']})
    assert response.status_code==200,response.text
    definition=response.json()['definition']
    installed=json.loads((ROOT/'plugins/cablesim.iec60287/plugin.json').read_text('utf-8'))
    assert definition['method']['version']==installed['version']
    assert definition['parameters']['duct']==pytest.approx({'u':1.87,'v_per_m':10,'y_per_m_k':.6,'initial_mean_air_temperature_k':293.15})
    saved=client.get(root+'/runs/'+run['id']+'?view=full').json()
    assert saved['snapshot']==run['snapshot'] and saved['output']==run['output']


def test_si_temperature_conversion_is_explicit_and_rejects_dual_units():
    raw=json.loads((ROOT/'plugins/cablesim.iec60287/plugin.json').read_text('utf-8'))
    schema=next(c for c in raw['capabilities'] if c['id']=='reference-rating')['input_contract']['standalone_schema']
    assert translate(schema,{'max_conductor_temperature_c':90})=={'max_conductor_temperature_k':363.15}
    assert translate(schema,{'max_conductor_temperature_k':363.15},to_runtime=True)=={'max_conductor_temperature_c':90}
    with pytest.raises(ValueError):translate(schema,{'max_conductor_temperature_c':90,'max_conductor_temperature_k':363.15})


def test_extension_examples_are_declarations_and_cannot_drop_approval():
    for kind in ['report-template','agent-skill']:
        folder=ROOT/'docs/plugins/examples'/kind
        raw=json.loads((folder/'plugin.json').read_text('utf-8'))
        manifest=Manifest.model_validate(raw)
        assert manifest.runtime is None and manifest.capabilities[0].kind==kind
        for record in manifest.files:
            data=(folder/record.path).read_bytes()
            assert len(data)==record.size_bytes and sha256(data).hexdigest()==record.sha256
        if kind=='agent-skill':
            raw['capabilities'][0]['agent_skill']['human_approval_required_for']=[]
            with pytest.raises(ValidationError):Manifest.model_validate(raw)
