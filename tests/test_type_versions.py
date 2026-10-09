"""Branch isolation, sealed report references and local human publication gates."""
from copy import deepcopy
import getpass
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
from backend.kernel.workspace import fingerprint, stamp
from backend.foundation.contracts import AssetRelease, SourceReference
from backend.kernel.scenarios import make_router, system_models


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
    from backend.kernel.rating_conditions import RatingRow, RatingTableDefinition, table_definition
    definition = table_definition(w, RatingTableDefinition(expected_revision=w['revision'],rows=[RatingRow(case_id='buried',name='receipt fixture buried',layout='trefoil')]),method)
    sid,rid=str(uuid4()),str(uuid4())
    snapshot={'workspace_revision':w['revision'],'study_revision':1,'definition':definition,'cases':[{'case_id':'buried','input':definition['driver']['cases'][0]['input']}], 'lock':{'digest':'fixture-lock'}}
    entity=snapshot['cases'][0]['input']['circuits'][0]['id']
    output={'cases':[{'case_id':'buried','status':'succeeded','results':[{'key':'ampacity','type':'quantity','entity':entity,'case':'rating','unit':'A','status':'available','value':777.125}]}]}
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
    actual_resolve = research.resolve
    monkeypatch.setattr(research, 'resolve', lambda ref, *args, **kwargs: None if ref['plugin_id'] == method['plugin_id'] else actual_resolve(ref, *args, **kwargs))
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
    return c.get(f"/api/types/{w['id']}/specification").json(),r.json()


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


def resource_fixture(client, asset_id, version='1.0.0', kind='material', name='资源绑定契约测试', source=None):
    """Isolated persistence fixture, not an engineering approval or numerical result."""
    service = client.app.state.types
    with service.store.db(True) as db:
        rid = service.assets._insert(db, AssetRelease(asset_id=asset_id, version=version, kind=kind, name=name,
            sources=(SourceReference(kind='project_input', reference=json.dumps(source or {'test': 'resource identity'}), reviewed=True),)), '隔离测试数据')
        db.execute("UPDATE engineering_assets SET status='published',reviewed_sha256=content_sha256 WHERE id=?", (rid,))
    return rid


def structural_materials(w):
    cable = w['domain']['cable_types'][0]
    ids = {layer['material'] for layer in [*cable['common_layers'], *(layer for core in cable['cores'] for layer in [core['conductor'], *core['layers']])]}
    return [m for m in w['domain']['materials'] if m['id'] in ids]


def test_resource_migration_only_unique_identity_and_never_names(client):
    w = workspace(client)
    material = structural_materials(w)[0]
    unique = resource_fixture(client, material['id'])
    # Same label is insufficient, and two published versions are deliberately ambiguous.
    other = structural_materials(w)[1]
    resource_fixture(client, other['id'])
    resource_fixture(client, other['id'], '1.0.1')
    resource_fixture(client, 'unrelated-material', name=structural_materials(w)[2]['label'])
    before = client.get('/api/types/library').json()
    body = req(w)
    response = client.post(f"/api/types/{w['id']}/resources/migrate", json=body)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result['changed'] == [material['id']]
    assert client.post(f"/api/types/{w['id']}/resources/migrate", json=body).json() == result
    saved = client.get('/api/workspaces/'+w['id']).json()
    assert saved['domain'] == w['domain'] and saved['revision'] == w['revision']+1
    assert saved['type_resource_bindings']['material'][material['id']]['resource_id'] == unique
    assert other['id'] not in saved['type_resource_bindings']['material']
    relations = client.get(f"/api/index/objects/type/{w['id']}/relations")
    assert relations.status_code == 200, relations.text
    edge = next(e for e in relations.json()['uses'] if e['role'] == 'material' and e['target']['id'] == unique)
    assert edge['freshness'] == 'current'
    assert edge['pinned']['version'] == '1.0.0'
    assert edge['pinned']['digest'] == saved['type_resource_bindings']['material'][material['id']]['content_sha256']
    assert client.get('/api/types/library').json() == before  # binding never publishes a design
    historical = client.get(f"/api/workspaces/{w['id']}/revisions/{saved['revision']}").json()
    assert historical['state']['type_resource_bindings'] == saved['type_resource_bindings']
    assert client.post(f"/api/types/{w['id']}/resources/migrate", json=req(w)).status_code == 409


def test_material_binding_tracks_facts_and_standard_binding_uses_approved_source(client):
    w = workspace(client)
    material = structural_materials(w)[0]
    rid = resource_fixture(client, 'explicit-copper')
    response = client.post(f"/api/types/{w['id']}/resources/bind", json=req(w, role='material', target_id=material['id'], resource_id=rid))
    assert response.status_code == 200, response.text
    w = client.get('/api/workspaces/'+w['id']).json()
    assert next(t for t in response.json()['targets'] if t['id'] == material['id'])['state'] == 'current'
    document = deepcopy(w['domain']); next(m for m in document['materials'] if m['id'] == material['id'])['label'] += ' 已修改'
    assert client.put(f"/api/workspaces/{w['id']}/domain", json={'expected_revision': w['revision'], 'document': document}).status_code == 200
    view = client.get(f"/api/types/{w['id']}/resources").json()
    assert next(t for t in view['targets'] if t['id'] == material['id'])['state'] == 'outdated'
    # Only approved, hash-verified requirement receipts may contribute execution standards.
    service = client.app.state.types
    standard = 'GB/T 12706.2-2020'; source = 'a'*64
    rule = resource_fixture(client, 'standard-gbt12706-2', kind='rule', source={'source_digest': source})
    with service.store.db(True) as db:
        receipt = {'items': [{'id': 'test-standard', 'definition': {'standard': standard, 'source_digest': source, 'source_status': 'original-verified'}}]}
        db.execute('INSERT INTO requirement_reviews VALUES (?,?,?,?,?,?,?)',
                   (str(uuid4()), w['id'], 1, str(uuid4()), 'b'*64, json.dumps(receipt), fingerprint(receipt)))
    view = client.get(f"/api/types/{w['id']}/resources").json()
    targets = [t for t in view['targets'] if t['role'] == 'standard']
    assert len(targets) == 1 and targets[0]['unique_match'] == rule
    migrated = client.post(f"/api/types/{w['id']}/resources/migrate", json={'request_id': str(uuid4()), 'expected_revision': view['revision']})
    assert migrated.status_code == 200, migrated.text
    assert next(t for t in migrated.json()['targets'] if t['role'] == 'standard')['binding']['version'] == '1.0.0'
    relations = client.get(f"/api/index/objects/type/{w['id']}/relations")
    assert relations.status_code == 200, relations.text
    edge = next(e for e in relations.json()['uses'] if e['role'] == 'standard' and e['target']['id'] == rule)
    assert edge['freshness'] == 'current' and edge['pinned']['version'] == '1.0.0'


def test_published_type_freezes_resource_dependencies(client, monkeypatch):
    w = workspace(client)
    material = structural_materials(w)[0]
    rid = resource_fixture(client, material['id'])
    bound = client.post(f"/api/types/{w['id']}/resources/migrate", json=req(w))
    assert bound.status_code == 200, bound.text
    w = client.get('/api/workspaces/'+w['id']).json()
    seed_evidence(client, w, monkeypatch); adopt(client, w)
    spec, submitted = submit(client, w)
    human = {'X-CableSim-Actor': 'human'}
    approval = {'request_id': str(uuid4()), 'submission_id': submitted['submission_id'], 'specification_digest': spec['digest'], 'human_confirmed': True}
    assert client.post(f"/api/types/{w['id']}/approve", json=approval, headers=human).status_code == 200
    publication = client.post(f"/api/types/{w['id']}/publish", json={**{k:v for k,v in approval.items() if k != 'human_confirmed'}, 'request_id': str(uuid4())}, headers=human)
    assert publication.status_code == 200, publication.text
    release = client.get('/api/foundation/assets/'+publication.json()['asset_id']).json()
    resource = client.get('/api/foundation/assets/'+rid).json()
    assert release['release']['dependencies'] == [{k:resource[k] for k in ('asset_id', 'version', 'content_sha256')}]
    assert spec['payload']['resource_bindings'] == w['type_resource_bindings']
    design_edges = client.get(f"/api/index/objects/type/{w['id']}/relations").json()['used_by']
    assert any(e['role'] == 'source_design' and e['target']['id'] == release['id'] for e in design_edges)
    version_edges = client.get(f"/api/index/objects/cable_version/{release['id']}/relations").json()['used_by']
    assert any(e['role'] == 'published_cable_version' and e['target']['id'] == w['id'] for e in version_edges)
    assert client.post(f"/api/types/{w['id']}/resources/bind", json=req(w, role='material', target_id=material['id'], resource_id=None)).status_code == 409
    assert client.get(f"/api/types/{w['id']}/specification").json()['payload'] == spec['payload']


def test_failed_source_not_selected_and_uncovered_blocks_approval(client,monkeypatch):
    w=workspace(client);seed_evidence(client,w,monkeypatch,bad_status=True,uncovered=True);adopt(client,w)
    spec,submitted=submit(client,w)
    assert spec['payload']['chapters']==CHAPTERS
    assert any(c['id']=='geometry/missing' for c in spec['payload']['checks'])
    assert any(c['id'].startswith('standards/') for c in spec['payload']['checks'])
    body={'request_id':str(uuid4()),'submission_id':submitted['submission_id'],'specification_digest':spec['digest'],'human_confirmed':True}
    assert client.post(f"/api/types/{w['id']}/approve",json=body,headers={'X-CableSim-Actor':'human'}).status_code==422


def test_local_identity_human_confirmation_and_immutable_release(client,monkeypatch):
    w=workspace(client);runs=seed_evidence(client,w,monkeypatch);adopt(client,w)
    spec,submitted=submit(client,w)
    assert spec['ready']
    assert spec['html'].count('<section id="chapter-')==8
    assert '<td>777</td>' in spec['html']
    assert spec['payload']['results']['rating']['rows'][0]['value_a']==777.125
    approval={'request_id':str(uuid4()),'submission_id':submitted['submission_id'],'specification_digest':spec['digest'],'human_confirmed':True}
    for actor in ('ai','plugin','unknown'):
        assert client.post(f"/api/types/{w['id']}/approve",json=approval,headers={'X-CableSim-Actor':actor}).status_code==403
    human={'X-CableSim-Actor':'human'}
    assert spec['lifecycle']['operator']['username'] == getpass.getuser()
    assert client.post(f"/api/types/{w['id']}/approve",json={**approval,'reviewer':'forged'},headers=human).status_code==422
    assert client.post(f"/api/types/{w['id']}/approve",json={**approval,'human_confirmed':False},headers=human).status_code==422
    approved=client.post(f"/api/types/{w['id']}/approve",json=approval,headers=human)
    assert approved.status_code==200,approved.text
    assert approved.json()['reviewer']==getpass.getuser() and approved.json()['approved_at']
    assert approved.json()['sources'] == spec['payload']['sources']
    assert client.post(f"/api/types/{w['id']}/approve",json=approval,headers=human).json()==approved.json()
    publish={'request_id':str(uuid4()),'submission_id':submitted['submission_id'],'specification_digest':spec['digest']}
    released=client.post(f"/api/types/{w['id']}/publish",json=publish,headers=human)
    assert released.status_code==200,released.text
    assert released.json()['asset_reference']['version']=='1.0.3'
    assert released.json()['source_design'] == {'id': w['id'], 'revision': w['revision']}
    assert client.post(f"/api/types/{w['id']}/publish",json=publish,headers=human).json()==released.json()
    assert client.get('/api/types/library').json()['items'][0]['status']=='published'
    assert client.get('/api/types/library').json()['items'][0]['source_design'] == released.json()['source_design']
    asset=client.get('/api/foundation/assets/'+released.json()['asset_id']).json()
    assert client.post('/api/foundation/assets/'+asset['id']+'/derive',json={'expected_revision':asset['revision'],'content_sha256':asset['content_sha256'],'new_version':'1.0.4'}).status_code==409
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
    body={'request_id':str(uuid4()),'submission_id':submitted['submission_id'],'specification_digest':spec['digest'],'human_confirmed':True}
    assert client.post(f"/api/types/{w['id']}/approve",json=body,headers={'X-CableSim-Actor':'human'}).status_code==409


def test_document_revisions_are_created_by_review_not_model_saves(client):
    w = workspace(client)
    adopt(client, w)
    assert client.get(f"/api/types/{w['id']}/specification").json()['payload']['revisions'] == []
    d = deepcopy(w['domain'])
    layer = next(layer for layer in d['cable_types'][0]['common_layers'] if layer['role'] == 'insulation')
    layer['thickness'] = .0058
    response = client.put(f"/api/workspaces/{w['id']}/domain", json={'expected_revision':w['revision'],'document':d})
    assert response.status_code == 200, response.text
    w = client.get(f"/api/workspaces/{w['id']}").json()
    current = client.get(f"/api/types/{w['id']}/specification").json()
    assert current['payload']['revisions'] == []
    assert current['revision_draft']['summary'] == '绝缘厚度 5.5→5.8 mm'
    body = req(w, specification_digest=current['digest'], acknowledge_checks=True,
               change_summary=current['revision_draft']['summary'], author='文档流程验证编制人')
    submitted = client.post(f"/api/types/{w['id']}/submissions", json=body)
    assert submitted.status_code == 201, submitted.text
    assert client.post(f"/api/types/{w['id']}/submissions", json=body).json() == submitted.json()
    reviewed = client.get(f"/api/types/{w['id']}/specification").json()
    assert reviewed['digest'] == submitted.json()['digest'] and not reviewed['lifecycle']['stale']
    records = reviewed['payload']['revisions']
    assert len(records) == 1 and records[0]['summary'] == '绝缘厚度 5.5→5.8 mm'
    assert records[0]['author'] == body['author'] and records[0]['version'].endswith('-r1')
    d['name'] += ' 文档保存验证'
    assert client.put(f"/api/workspaces/{w['id']}/domain", json={'expected_revision':w['revision'],'document':d}).status_code == 200
    assert client.get(f"/api/types/{w['id']}/specification").json()['payload']['revisions'] == records


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


def test_saved_run_specification_keeps_selected_type_precision_and_escaped_evidence(client,monkeypatch):
    from backend.kernel.report import render
    from backend.kernel.type_specification import payload_from_runs, render_run_specification

    w = workspace(client)
    runs = seed_evidence(client,w,monkeypatch)
    run = deepcopy(next(r for r in runs.values() if 'x-cablesim.cad-model' in r['output']['cases'][0].get('artifacts',{})))
    selected = w['domain']['cable_types'][0]
    other = deepcopy(selected)
    other.update(id='type/other',label='<unselected & type>')
    document = run['snapshot']['cases'][0]['input']
    document['cable_types'].insert(0,other)
    material = next(item for item in document['materials'] if item['id'] == selected['cores'][0]['conductor']['material'])
    material['label'] = '<铜 & 备注>'
    material['standard_kind'] = None
    run['snapshot']['definition']['parameters']['cable_type_id'] = selected['id']
    run['snapshot']['workspace_state'] = w
    original = deepcopy(run)
    payload = payload_from_runs([run])
    assert payload['document']['cable_types'] == [selected]
    html = render([run])
    assert html == render_run_specification([run])
    assert html.count('data-specification-section=') == 8
    assert 'data-specification-evidence' in html
    assert payload['results']['geometry']['artifact']['outer_diameter_m'] == .042
    assert '42.0 mm' in html and '2400' in html
    assert '&lt;铜 &amp; 备注&gt;' in html
    assert '&lt;unselected &amp; type&gt;' not in html
    assert '<unselected & type>' not in html
    assert run['input_digest'] in html and run['output_digest'] in html
    assert '--font-ui' in html and '<link rel="stylesheet"' not in html
    assert run == original
