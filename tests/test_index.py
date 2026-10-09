"""Read-only cards, reference pins and pending queues over real host storage."""
import json
from test_index_reproductions import library
import sqlite3
from uuid import uuid4

import pytest
from backend.kernel.workspace import fingerprint, stamp
from test_research import client, study, request


def object_card(client,kind,id):
    page=client.get('/api/index/objects',params={'kind':kind,'q':id})
    assert page.status_code==200,page.text
    return next(card for card in page.json()['items'] if card['id']==id)


def relations(client,kind,id):
    response=client.get(f'/api/index/objects/{kind}/{id}/relations')
    assert response.status_code==200,response.text
    return response.json()


def test_canonical_states_pinned_relations_and_no_large_contents(client,monkeypatch):
    w,s=study(client);root,body=request(client,w,s)
    assert object_card(client,'study',s['id'])['status']['code']=='not_run'
    run=client.post(root+'/runs',json=body).json();assert run['status']=='succeeded'
    assert object_card(client,'study',s['id'])['status']['code']=='current'
    assert client.app.state.research.get_run(w['id'],run['id'])['freshness']=='current'
    delivery=client.post(f'/api/workspaces/{w["id"]}/deliveries',json={'run_ids':[run['id']]}).json()
    research=client.app.state.research
    def forbidden(*args,**kwargs):pytest.fail('index read a result body, original or invoked a solver')
    monkeypatch.setattr(research,'get_run',forbidden);monkeypatch.setattr(research.executor,'run',forbidden)
    monkeypatch.setattr(client.app.state.documents,'original',forbidden)
    # SQLite prevents accidental SELECT * / large result reads, even if a new
    # index adapter bypasses the public application readers.
    import backend.index.sources as sources
    project=sources.project
    def small(db):
        def authorize(action,table,column,*unused):
            if action==sqlite3.SQLITE_READ and (table,column) in {
                ('study_runs','output'),('source_documents','original'),('deliveries','html'),('agent_steps','result')}:
                return sqlite3.SQLITE_DENY
            return sqlite3.SQLITE_OK
        db.set_authorizer(authorize)
        return project(db)
    monkeypatch.setattr(sources,'project',small)
    # service keeps a local import of the projection function.
    monkeypatch.setattr('backend.index.service.project',small)
    run_edges=relations(client,'run',run['id'])
    assert {'study','input_snapshot','method','delivery'}<={edge['role'] for edge in run_edges['uses']}
    snapshot=next(edge for edge in run_edges['uses'] if edge['role']=='input_snapshot')
    assert snapshot['pinned']['digest']==run['input_digest'] and snapshot['freshness']=='current'
    source=next(edge for edge in relations(client,'delivery',delivery['id'])['uses'] if edge['role']=='source_run')
    assert source['target']==object_card(client,'run',run['id']) and source['pinned']['digest']==run['output_digest']
    method=next(edge for edge in relations(client,'study',s['id'])['uses'] if edge['role']=='method')
    assert method['pinned']['version']==s['definition']['method']['version'] and method['freshness']=='current'
    assert any(edge['role']=='study' and edge['target']['id']==run['id'] for edge in relations(client,'study',s['id'])['used_by'])
    edit=client.post(f'/api/workspaces/{w["id"]}/edit',json={'expected_revision':w['revision'],
        'changes':[{'path':'installation.depth_m','value':1.1},{'path':'installation.soil_rho_k_m_w','value':1.3}]})
    assert edit.status_code==200,edit.text
    stale=object_card(client,'study',s['id']);assert stale['status']['code']=='outdated' and '修订' in stale['status']['reason']
    inbox=client.get('/api/index/inbox').json()
    assert inbox['counts']['stale']==1 and next(i for i in inbox['items'] if i['category']=='stale')['object']==stale
    # Installed method pin changes are the host's own version-currentness rule.
    original_pin=research.pin
    monkeypatch.setattr(research,'pin',lambda p:{**original_pin(p),'version':'99.0.0'})
    # Real plugin publication emits SourceWatch invalidation. The synthetic pin
    # override above has no filesystem publication, so invalidate its old receipt.
    with research.read_responses.lock:research.read_responses.entries.clear();research.read_responses.bytes=0
    stale=object_card(client,'study',s['id'])
    assert stale['status']['code']=='outdated' and '99.0.0' in stale['status']['reason']
    assert next(e for e in relations(client,'study',s['id'])['uses'] if e['role']=='method')['freshness']=='outdated'
    assert client.get('/api/index/objects',params={'limit':0}).status_code==422
    assert client.get('/api/index/objects',params={'kind':'invented'}).status_code==422
    assert client.get('/api/index/objects/study/absent/relations').status_code==404
    assert client.post('/api/index/inbox',json={}).status_code in (404,405)
    # Scheduler receipts can change without SQLite commits. Their local cached
    # content must invalidate the common projection as well.
    receipt={'state':'queued'}
    monkeypatch.setattr(research.executor,'execution_status',lambda *args:dict(receipt),raising=False)
    with research.store.db(True) as db:
        db.execute("UPDATE study_runs SET status='accepted',finished=NULL WHERE id=?",(run['id'],))
    assert object_card(client,'job',run['id'])['status']['code']=='queued'
    receipt['state']='running'
    assert object_card(client,'job',run['id'])['status']['code']=='running'


def test_four_review_sources_document_lineage_and_unknown_bindings(client,monkeypatch):
    w,s=study(client);h=client.app.state.harness
    from test_harness import session
    tid=session(client,w,s);task=h.tasks.record(tid)
    proposal=h.proposals.parameters(task,s['id'],None,[{'path':'/parameters/ks','value':.8,'unit':'1'}],'参数方案')
    did,cid,pid,pending,aid,submission=(str(uuid4()) for _ in range(6))
    document_hash='a'*64;draft={'name':'缺项厂家型号','version':'1.0.0','specification':{'missing':['导体电阻来源']},
        'sources':{'/specification':{'kind':'manufacturer','reference':json.dumps({'document_id':did,'original_sha256':document_hash,'page':3})}}}
    # Metadata fixtures model the four repositories' persisted receipt states;
    # they are not fake engineering quantities or solver results.
    with h.research.store.db(True) as db:
        db.execute('INSERT INTO source_documents VALUES(?,?,?,?,?,?)',(did,'厂家原件',document_hash,b'unread original','{}',stamp()))
        db.execute('INSERT INTO domain_cable_models VALUES(?,?,?,?,?)',(cid,json.dumps(draft),fingerprint(draft),'incomplete',stamp()))
        payload={'draft':draft};db.execute('INSERT INTO document_proposals VALUES(?,?,?,?,?,?,?)',
            (pid,did,json.dumps(payload),fingerprint(payload),'approved',cid,json.dumps({'approved_at':stamp()})))
        db.execute('INSERT INTO document_proposals VALUES(?,?,?,?,?,?,?)',
            (pending,did,json.dumps(payload),fingerprint(payload),'proposed',None,None))
        release={'dependencies':[],'sources':[]};db.execute('INSERT INTO engineering_assets VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
            (aid,'test.material','1.0.0','material','材料草稿','draft',1,json.dumps(release),'b'*64,None,stamp(),stamp()))
        # Explicit type plan avoids guessing project/design from a name.
        db.execute('INSERT INTO type_plans(workspace,family,name,base_reference,status,created,adopted_digest) VALUES(?,?,?,?,?,?,?)',
            (w['id'],'test.family','型号设计','{}','draft',stamp(),'c'*64))
        spec={'name':'型号设计','revision':w['revision'],'sources':[]}
        db.execute('INSERT INTO type_submissions(id,workspace,payload,digest,status,created) VALUES(?,?,?,?,?,?)',
            (submission,w['id'],json.dumps(spec),fingerprint(spec),'submitted',stamp()))
    inbox=client.get('/api/index/inbox').json()
    assert inbox['counts']=={'review':4,'stale':0,'missing':1,'running':0}
    assert {item['origin'] for item in inbox['items'] if item['category']=='review'}=={'agent','document','asset','type'}
    assert len({(i['category'],i['origin'],i['object']['id']) for i in inbox['items']})==len(inbox['items'])
    lineage=relations(client,'cable_version',cid)
    doc=next(e for e in lineage['uses'] if e['role']=='source_document')
    assert doc['target']['id']==did and doc['pinned']['digest']==document_hash and '3' in doc['reason']
    assert next(e for e in lineage['uses'] if e['role']=='source_proposal')['target']['id']==pid
    assert any(e['target']['id']==pid for e in relations(client,'document',did)['used_by'])
    design=relations(client,'type',w['id'])
    assert {'material','standard','published_cable_version'}<={v['role'] for v in design['unresolved']}
    assert all(v['freshness']=='unknown' for v in design['unresolved'])
    assert next(e for e in design['uses'] if e['role']=='specification')['target']['id']==submission
    # Expiration must invalidate a cached queue without a database commit.
    from time import time
    with monkeypatch.context() as patch:
        patch.setattr('backend.index.service.time',lambda:time()+3700)
        assert client.get('/api/index/inbox').json()['counts']['review']==3
    # Decisions remove pending items immediately; there is no independent queue
    # state or TTL that can leave stale approval prompts behind.
    h.tasks.emit(tid,'proposal.decision',{'id':proposal['id'],'status':'rejected'})
    with h.research.store.db(True) as db:
        db.execute("UPDATE document_proposals SET status='approved' WHERE id=?",(pending,))
        db.execute("UPDATE engineering_assets SET status='published' WHERE id=?",(aid,))
        db.execute("UPDATE type_submissions SET status='published' WHERE id=?",(submission,))
        db.execute("CREATE TABLE hpc_convergence(id TEXT PRIMARY KEY,request_id TEXT UNIQUE,request_digest TEXT,state TEXT)")
        job={'workspace':w['id'],'study':s['id'],'status':'queued','created':stamp()}
        db.execute('INSERT INTO hpc_convergence VALUES(?,?,?,?)',(str(uuid4()),str(uuid4()),'d'*64,json.dumps(job)))
    inbox=client.get('/api/index/inbox').json()
    assert inbox['counts']=={'review':0,'stale':0,'missing':1,'running':1}
    assert next(i for i in inbox['items'] if i['category']=='running')['origin']=='job'
