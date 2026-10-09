"""Saved type identities, partial bindings and publication pins; no solver runs."""
from copy import deepcopy
import json
from uuid import uuid4

from backend.kernel.workspace import fingerprint,stamp
from test_type_versions import client,workspace,req,resource_fixture,structural_materials,seed_evidence,adopt,submit
from test_index import relations


def test_partial_bindings_remain_unknown_and_material_edit_invalidates_immediately(client):
    w=workspace(client);materials=structural_materials(w);material=materials[0]
    rid=resource_fixture(client,'explicit-material')
    # A same-name resource cannot fill an unbound target.
    other=resource_fixture(client,'unrelated',name=materials[1]['label'])
    bound=client.post(f'/api/types/{w["id"]}/resources/bind',json=req(w,role='material',target_id=material['id'],resource_id=rid))
    assert bound.status_code==200,bound.text
    service=client.app.state.types
    standards=['binding-test-standard-A','binding-test-standard-B']
    with service.store.db(True) as db:
        receipt={'items':[{'id':name,'definition':{'standard':name,'source_status':'original-verified','source_digest':str(i+1)*64}}
            for i,name in enumerate(standards)]}
        db.execute('INSERT INTO requirement_reviews VALUES (?,?,?,?,?,?,?)',
            (str(uuid4()),w['id'],1,str(uuid4()),'a'*64,json.dumps(receipt),fingerprint(receipt)))
    view=client.get(f'/api/types/{w["id"]}/resources').json()
    target=next(t for t in view['targets'] if t['role']=='standard' and t['name']==standards[0])
    rule=resource_fixture(client,'explicit-rule',kind='rule')
    response=client.post(f'/api/types/{w["id"]}/resources/bind',json={
        'expected_revision':view['revision'],'request_id':str(uuid4()),'role':'standard','target_id':target['id'],'resource_id':rule})
    assert response.status_code==200,response.text
    edges=relations(client,'type',w['id'])
    assert next(e for e in edges['uses'] if e['role']=='material')['freshness']=='current'
    assert next(e for e in edges['uses'] if e['role']=='standard')['target']['id']==rule
    assert other not in {e['target']['id'] for e in edges['uses']}
    for role,name in [('material',materials[1]['label']),('standard',standards[1])]:
        assert any(e['role']==role and e['freshness']=='unknown' and '未绑定资源' in e['reason'] and name in e['reason'] for e in edges['unresolved'])
    saved=client.get('/api/workspaces/'+w['id']).json();document=deepcopy(saved['domain'])
    selected=next(m for m in document['materials'] if m['id']==material['id'])
    selected['thermal_resistivity']=(selected.get('thermal_resistivity') or 1)+.1
    response=client.put(f'/api/workspaces/{w["id"]}/domain',json={'expected_revision':saved['revision'],'document':document})
    assert response.status_code==200,response.text
    edges=relations(client,'type',w['id'])
    changed=next(e for e in edges['uses'] if e['role']=='material' and e['target']['id']==rid)
    assert changed['freshness']=='outdated' and changed['reason']=='材料参数在绑定后被修改'
    assert next(e for e in edges['uses'] if e['role']=='standard')['freshness']=='current'
    host=client.get(f'/api/types/{w["id"]}/resources').json()
    assert next(t for t in host['targets'] if t['id']==material['id'])['state']=='outdated'


def test_publication_and_library_copy_use_fixed_source_pins_without_unknown_document(client,monkeypatch):
    w=workspace(client);seed_evidence(client,w,monkeypatch);adopt(client,w);spec,submitted=submit(client,w)
    body={'request_id':str(uuid4()),'submission_id':submitted['submission_id'],'specification_digest':spec['digest'],'human_confirmed':True}
    human={'X-CableSim-Actor':'human'}
    approved=client.post(f'/api/types/{w["id"]}/approve',json=body,headers=human)
    assert approved.status_code==200,approved.text
    published=client.post(f'/api/types/{w["id"]}/publish',json={k:v for k,v in {**body,'request_id':str(uuid4())}.items() if k!='human_confirmed'},headers=human)
    assert published.status_code==200,published.text
    asset=client.get('/api/foundation/assets/'+published.json()['asset_id']).json()
    edges=relations(client,'cable_version',asset['id'])
    source=[e for e in edges['uses'] if e['role']=='source_design']
    assert len(source)==1 and source[0]['pinned']['revision']==spec['payload']['revision']
    assert source[0]['pinned']['version'] is None and source[0]['pinned']['digest'] is None
    assert source[0]['freshness']=='current'
    assert not any(e['role']=='source' for e in edges['unresolved'])
    spec_edge=next(e for e in edges['uses'] if e['role']=='source_specification')
    assert spec_edge['pinned']['digest']==spec['digest']
    edge=next(e for e in relations(client,'type',w['id'])['uses'] if e['role']=='published_cable_version')
    assert edge['pinned']['version']==asset['version'] and edge['pinned']['digest']==asset['content_sha256']
    assert edge['pinned']['revision'] is None
    copy=client.post('/api/types',json={'origin':'library','name':'绑定来源版本的独立复制',
        'request_id':str(uuid4()),'resource_id':asset['id'],'content_sha256':asset['content_sha256']})
    assert copy.status_code==201,copy.text
    ref=next(e for e in relations(client,'type',copy.json()['id'])['uses'] if e['role']=='source')
    assert ref['target']['id']==asset['id'] and ref['pinned']==edge['pinned']
    # A structured source without a document ID is a design reference, even
    # outside the releases table. It must not also report a missing document.
    linked=str(uuid4());payload={'name':'来源关联元数据样例','version':'1.0.0','sources':{
        'origin':{'kind':'project_input','reference':json.dumps({'source_design':{'id':w['id'],'revision':w['revision']}})}}}
    with client.app.state.research.store.db(True) as db:
        db.execute('INSERT INTO domain_cable_models VALUES(?,?,?,?,?)',(linked,json.dumps(payload),fingerprint(payload),'incomplete',stamp()))
    linked_edges=relations(client,'cable_version',linked)
    assert not linked_edges['unresolved'] and linked_edges['uses'][0]['role']=='source_design'
    assert linked_edges['uses'][0]['pinned']['revision']==w['revision']
    # Old frozen publication payloads use revision directly, without source_design.
    with client.app.state.research.store.db(True) as db:
        payload=deepcopy(spec['payload']);payload.pop('source_design',None)
        db.execute('UPDATE type_submissions SET payload=?,digest=? WHERE id=?',
            (json.dumps(payload),fingerprint(payload),submitted['submission_id']))
        db.execute('UPDATE engineering_type_releases SET payload=? WHERE asset=?',(json.dumps(payload),asset['id']))
    assert next(e for e in relations(client,'cable_version',asset['id'])['uses'] if e['role']=='source_design')['pinned']==source[0]['pinned']
