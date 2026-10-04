"""Branch isolation, sealed report references and credentialed publication gates."""
from copy import deepcopy
import json
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.main import create_app
from backend.kernel.type_versions import CHAPTERS
from backend.kernel.type_versions import Types
from backend.domain.models import CableType
from backend.workbench import fingerprint, stamp
from design.workbench.scenarios import make_router, system_models


@pytest.fixture
def client(tmp_path):
    app = create_app(tmp_path/'types.sqlite')
    app.include_router(make_router(app.state.workspace_store))
    fallback = next(r for r in app.router.routes if getattr(r, 'path', None) == '/api/{path:path}')
    app.router.routes.remove(fallback)
    app.router.routes.append(fallback)
    with TestClient(app) as c:
        yield c


def workspace(c):
    m = next(m for m in system_models() if m['id']=='system.cu-xlpe-al-240')
    r = c.post('/api/design/type-workspaces', json={'model_id': m['id'], 'content_sha256': m['content_sha256']})
    assert r.status_code==201, r.text
    return r.json()


def req(w, **extra):
    return {'expected_revision': w['revision'], 'request_id': str(uuid4()), **extra}


def seed_evidence(c, w, monkeypatch, *, bad_status=False, uncovered=False):
    """Isolated lifecycle fixture, not production engineering evidence.

    Values deliberately stand out as receipt-test data. Real numerical branches
    are exercised separately by the geometry and IEC tests and browser fixture.
    """
    research = c.app.state.research
    method = {'plugin_id':'test.type-lifecycle', 'capability':'fixture', 'version':'1.0.0', 'release_digest':'a'*64}
    runs = {}
    for channel, artifact in (
        ('geometry', {'schema':'cablesim.cad-model/1', 'outer_diameter_m':.042, 'mass_kg_per_km':2400,
                      'layers':[{'role':'conductor','mass_kg_per_km':2150}]}),
        ('electrical', {'schema':'cablesim.type-electrical/1', 'rows':[{'id':'r:dc','title':'receipt fixture R20','status':'available','value':.0000754,'unit':'Ω/m','standard':'fixture','clause':'test'}]}),
        ('short_circuit', {'schema':'cablesim.type-short-circuit/1', 'rows':[{'id':'r:conductor-adiabatic','title':'receipt fixture SC','status':'available','value':34300,'unit':'A','target':{'core_id':'core/demo0'},'standard':'fixture','clause':'test'}]}),
        ('standards', {'schema':'cablesim.standard-check/1', 'counts':{'passed':0 if uncovered else 1,'missing':0,'uncovered':1 if uncovered else 0,'failed':0}, 'rows':[{'id':'r:limit','title':'receipt fixture requirement','verdict':'uncovered' if uncovered else 'passed','reason':'test scope' if uncovered else None,'limit':1,'actual':1,'unit':'mm','standard':'fixture','clause':'test'}]})):
        sid, rid = str(uuid4()), str(uuid4())
        definition = {'input_source':'domain','method':method,'parameters':{},'driver':{'kind':'single'}}
        snapshot = {'workspace_revision':w['revision'],'study_revision':1,'definition':definition,'cases':[{'case_id':'fixture','input':deepcopy(w['domain'])}], 'lock':{'digest':'fixture-lock'}}
        output = {'cases':[{'case_id':'fixture','status':'succeeded','artifacts':{dict(geometry='x-cablesim.cad-model',electrical='x-cablesim.type-electrical',short_circuit='x-cablesim.type-short-circuit',standards='x-cablesim.standard-check')[channel]:artifact}}]}
        with research.store.db(True) as db:
            db.execute('INSERT INTO studies VALUES (?,?,1)', (sid,w['id']))
            db.execute('INSERT INTO study_versions VALUES (?,1,?,?)',(sid,json.dumps(definition),stamp()))
            db.execute('INSERT INTO study_runs(id,workspace,study,request_id,request_digest,input_digest,snapshot,status,output,output_digest,owner_epoch,execution_nonce,created) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
                (rid,w['id'],sid,str(uuid4()),'a'*64,fingerprint(snapshot),json.dumps(snapshot),'failed' if bad_status and channel=='geometry' else 'succeeded',json.dumps(output),fingerprint(output),'fixture',str(uuid4()),stamp()))
        runs[rid]={'id':rid,'workspace':w['id'],'study':sid,'snapshot':snapshot,'output':output,'status':'failed' if bad_status and channel=='geometry' else 'succeeded','freshness':'current','integrity':'verified','input_digest':fingerprint(snapshot),'output_digest':fingerprint(output)}
    # A real archived rating batch shape, with only a successful underground row.
    from design.workbench.type_rating import RatingRow, RatingTableDefinition, table_definition
    definition = table_definition(w, RatingTableDefinition(expected_revision=w['revision'],rows=[RatingRow(case_id='buried',name='receipt fixture buried',layout='trefoil')]),method)
    sid,rid=str(uuid4()),str(uuid4())
    snapshot={'workspace_revision':w['revision'],'study_revision':1,'definition':definition,'cases':[{'case_id':'buried','input':definition['driver']['cases'][0]['input']}], 'lock':{'digest':'fixture-lock'}}
    output={'cases':[{'case_id':'buried','status':'succeeded','results':[{'key':'ampacity','unit':'A','status':'available','value':777.125}]}]}
    with research.store.db(True) as db:
        db.execute('INSERT INTO studies VALUES (?,?,1)',(sid,w['id']))
        db.execute('INSERT INTO study_versions VALUES (?,1,?,?)',(sid,json.dumps(definition),stamp()))
        db.execute('INSERT INTO study_runs(id,workspace,study,request_id,request_digest,input_digest,snapshot,status,output,output_digest,owner_epoch,execution_nonce,created) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
            (rid,w['id'],sid,str(uuid4()),'a'*64,fingerprint(snapshot),json.dumps(snapshot),'succeeded',json.dumps(output),fingerprint(output),'fixture',str(uuid4()),stamp()))
    runs[rid]={'id':rid,'workspace':w['id'],'study':sid,'snapshot':snapshot,'output':output,'status':'succeeded','freshness':'current','integrity':'verified','input_digest':fingerprint(snapshot),'output_digest':fingerprint(output)}
    def get_run(wid,rid,cache=None):
        value=deepcopy(runs[rid])
        if research.store.snapshot(wid)['revision']!=value['snapshot']['workspace_revision']:
            value['freshness']='historical'
        return value
    monkeypatch.setattr(research,'get_run',get_run)
    monkeypatch.setattr(research,'lock',lambda *args: {'digest':'fixture-lock'})
    monkeypatch.setattr(research,'resolve',lambda *args: None)
    return runs


def adopt(c,w):
    r=c.post(f"/api/types/{w['id']}/adopt",json=req(w))
    assert r.status_code==200,r.text


def submit(c,w):
    s=c.get(f"/api/types/{w['id']}/specification").json()
    body=req(w,specification_digest=s['digest'],acknowledge_checks=True)
    r=c.post(f"/api/types/{w['id']}/submissions",json=body)
    assert r.status_code==201,r.text
    assert c.post(f"/api/types/{w['id']}/submissions",json=body).json()['submission_id']==r.json()['submission_id']
    return s,r.json()


def test_branch_isolation_fixed_base_and_idempotence(client):
    w=workspace(client)
    original=deepcopy(w['domain'])
    body=req(w,name='绝缘方案 B')
    r=client.post(f"/api/types/{w['id']}/plans",json=body)
    assert r.status_code==201,r.text
    created=r.json()
    assert client.post(f"/api/types/{w['id']}/plans",json=body).json()==created
    assert client.post(f"/api/types/{w['id']}/plans",json={**body,'name':'other'}).status_code==409
    child=client.get('/api/workspaces/'+created['workspace_id']).json()
    assert child['domain']==original and child['type_origin_reference']==w['type_origin_reference']
    assert client.get('/api/workspaces/'+w['id']).json()['domain']==original
    d=deepcopy(child['domain']);d['cable_types'][0]['common_layers'][1]['thickness']+=.0005
    r=client.put(f"/api/workspaces/{child['id']}/domain",json={'expected_revision':child['revision'],'document':d})
    assert r.status_code==200,r.text
    ps=client.get(f"/api/types/{w['id']}/comparison").json()['items']
    assert len(ps)==2 and ps[0]['document']!=ps[1]['document']
    assert ps[0]['base_reference']==ps[1]['base_reference']
    assert client.post(f"/api/types/{w['id']}/plans",json=req(w,name='stale',expected_revision=w['revision']-1)).status_code==409


def test_failed_source_not_selected_and_uncovered_blocks_approval(client,monkeypatch):
    w=workspace(client);seed_evidence(client,w,monkeypatch,bad_status=True,uncovered=True);adopt(client,w)
    spec,submitted=submit(client,w)
    assert spec['payload']['chapters']==CHAPTERS
    assert any(c['id']=='geometry/missing' for c in spec['payload']['checks'])
    assert any(c['id'].startswith('standards/') for c in spec['payload']['checks'])
    monkeypatch.setenv('CABLESIM_TYPE_APPROVER_TOKEN','isolated-test-credential')
    body={'request_id':str(uuid4()),'submission_id':submitted['submission_id'],'specification_digest':spec['digest'],'reviewer':'TEST RECEIPT','human_confirmed':True}
    assert client.post(f"/api/types/{w['id']}/approve",json=body,headers={'X-CableSim-Actor':'human','Authorization':'Bearer isolated-test-credential'}).status_code==422


def test_human_credential_required_stale_approval_and_immutable_release(client,monkeypatch):
    w=workspace(client);runs=seed_evidence(client,w,monkeypatch);adopt(client,w)
    spec,submitted=submit(client,w)
    assert spec['ready']
    assert spec['html'].count('<section id="chapter-')==8
    assert '777.125' in spec['html']
    approval={'request_id':str(uuid4()),'submission_id':submitted['submission_id'],'specification_digest':spec['digest'],'reviewer':'TEST RECEIPT','human_confirmed':True}
    monkeypatch.setenv('CABLESIM_TYPE_APPROVER_TOKEN','isolated-test-credential')
    for actor in ('ai','plugin','human'):
        assert client.post(f"/api/types/{w['id']}/approve",json=approval,headers={'X-CableSim-Actor':actor}).status_code==403
    human={'X-CableSim-Actor':'human','Authorization':'Bearer isolated-test-credential'}
    assert client.post(f"/api/types/{w['id']}/approve",json={**approval,'human_confirmed':False},headers=human).status_code==422
    approved=client.post(f"/api/types/{w['id']}/approve",json=approval,headers=human)
    assert approved.status_code==200,approved.text
    assert approved.json()['reviewer']=='TEST RECEIPT' and approved.json()['approved_at']
    assert client.post(f"/api/types/{w['id']}/approve",json=approval,headers=human).json()==approved.json()
    publish={'request_id':str(uuid4()),'submission_id':submitted['submission_id'],'specification_digest':spec['digest']}
    released=client.post(f"/api/types/{w['id']}/publish",json=publish,headers=human)
    assert released.status_code==200,released.text
    assert released.json()['asset_reference']['version']=='1.0.2'
    assert client.post(f"/api/types/{w['id']}/publish",json=publish,headers=human).json()==released.json()
    assert client.get('/api/types/library').json()['items'][0]['status']=='published'
    asset=client.get('/api/foundation/assets/'+released.json()['asset_id']).json()
    assert client.post('/api/foundation/assets/'+asset['id']+'/derive',json={'expected_revision':asset['revision'],'content_sha256':asset['content_sha256'],'new_version':'1.0.3'}).status_code==409
    frozen=client.get(f"/api/types/{w['id']}/specification").json()
    assert frozen['digest']==spec['digest'] and frozen['payload']==spec['payload']
    assert frozen['lifecycle']['status']=='published'
    assert client.post(f"/api/types/{w['id']}/adopt",json=req(w)).status_code==409
    assert client.post(f"/api/workspaces/{w['id']}/history/undo",json={'expected_revision':w['revision']}).status_code==409
    d=deepcopy(w['domain']);d['name']='frozen edit'
    assert client.put(f"/api/workspaces/{w['id']}/domain",json={'expected_revision':w['revision'],'document':d}).status_code==409
    branch=client.post(f"/api/types/{w['id']}/plans",json=req(w,name='后续版本方案'))
    assert branch.status_code==201,branch.text
    assert branch.json()['base_reference']=={**released.json()['asset_reference'],'name':spec['payload']['name'],'source':'published_type'}


def test_input_change_marks_comparison_and_rejects_old_submission(client,monkeypatch):
    w=workspace(client);seed_evidence(client,w,monkeypatch);adopt(client,w)
    spec,submitted=submit(client,w)
    d=deepcopy(w['domain']);d['cable_types'][0]['common_layers'][1]['thickness']+=.0005
    r=client.put(f"/api/workspaces/{w['id']}/domain",json={'expected_revision':w['revision'],'document':d})
    assert r.status_code==200,r.text
    changed=client.get(f"/api/types/{w['id']}/specification").json()
    assert changed['lifecycle']['stale'] and not changed['ready']
    values=client.get(f"/api/types/{w['id']}/comparison").json()['items'][0]['values']
    assert values['outer_diameter']['state']=='historical'
    monkeypatch.setenv('CABLESIM_TYPE_APPROVER_TOKEN','isolated-test-credential')
    body={'request_id':str(uuid4()),'submission_id':submitted['submission_id'],'specification_digest':spec['digest'],'reviewer':'TEST RECEIPT','human_confirmed':True}
    assert client.post(f"/api/types/{w['id']}/approve",json=body,headers={'X-CableSim-Actor':'human','Authorization':'Bearer isolated-test-credential'}).status_code==409


def test_comparison_aligns_conditions_after_case_ids_and_order_change(client,monkeypatch):
    w=workspace(client);runs=seed_evidence(client,w,monkeypatch)
    created=client.post(f"/api/types/{w['id']}/plans",json=req(w,name='B')).json()
    child=client.get('/api/workspaces/'+created['workspace_id']).json()
    rating=next(r for r in runs.values() if r['snapshot']['definition']['driver']['kind']=='batch')
    def rows(order):
        return [{'case_id':key,'name':'直埋品字','condition':{'layout':'trefoil','depth_m':depth,'soil_rho_k_m_w':1,'ambient_temperature_c':20,'spacing_m':None,'bonding':'both_ends'},'value_a':value,'reason':None} for key,depth,value in order]
    sources={w['id']:rows([('a',.8,777),('b',1.2,666)]),child['id']:rows([('new-b',1.2,665),('new-a',.8,776)])}
    service=client.app.state.types
    def evidence(wid):
        with service.store.db() as db:
            row,state=service._type(db,wid)
        run=deepcopy(rating);run['workspace']=wid;run['snapshot']['workspace_revision']=row['revision']
        return row,state,{'rating':{'run':run,'rows':sources[wid]}},[]
    monkeypatch.setattr(service,'evidence',evidence)
    items=client.get(f"/api/types/{w['id']}/comparison").json()['items']
    first,second=items
    for key,value in first['values'].items():
        if not key.startswith('rating/'):
            continue
        assert value['source']['condition']==second['values'][key]['source']['condition']
        assert second['values'][key]['value']-value['value']==-1


def test_type_binding_normalizes_nullable_schema_fields_without_accepting_input_changes():
    current = CableType.model_validate(system_models()[0]['payload']['cable_type']).model_dump(mode='json')
    archived = deepcopy(current)
    archived.pop('core_lay_length',None)
    for layer in archived['common_layers']:
        for field in ('tape_gap','longitudinal_r20'):
            layer.pop(field,None)
    document = {'cable_types':[archived],'measurements':[]}
    run = {'snapshot':{'definition':{'driver':{'kind':'single'}},'cases':[{'input':{'cable_types':[current]}}]}}
    assert Types._matches_type(run,document)
    run['snapshot']['cases'][0]['input']['cable_types'][0]['common_layers'][1]['thickness']+=.0005
    assert not Types._matches_type(run,document)
