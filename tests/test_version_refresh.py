"""Version drift, immutable historical results and idempotent current-version runs."""
from copy import deepcopy
import json
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend.main import create_app
from backend.kernel.workspace import fingerprint
from backend.kernel.scenarios import system_models, METHOD_DEFAULTS
from test_research import client, study, request


def historical_method(client, wid, sid, rid):
    """Seed an older accepted release identity, leaving the numerical fixture alone."""
    store=client.app.state.workspace_store
    with store.db(True) as db:
        row=db.execute('SELECT snapshot FROM study_runs WHERE id=?',(rid,)).fetchone()
        snapshot=json.loads(row['snapshot'])
        old={**snapshot['definition']['method'],'version':'0.9.0','release_digest':'0'*64}
        snapshot['definition']['method']=old
        snapshot['lock']['method']=old
        snapshot['lock']['digest']=fingerprint({k:v for k,v in snapshot['lock'].items() if k!='digest'})
        db.execute('UPDATE study_runs SET snapshot=?,input_digest=? WHERE id=?',
                   (json.dumps(snapshot),fingerprint(snapshot),rid))
        db.execute('UPDATE study_versions SET definition=? WHERE study=? AND revision=1',
                   (json.dumps(snapshot['definition']),sid))
        return dict(db.execute('SELECT snapshot,output,input_digest,output_digest FROM study_runs WHERE id=?',(rid,)).fetchone())


def rerun_body(w,s):
    return {'request_id':str(uuid4()),'expected_revision':w['revision'],
            'expected_study_revision':s['revision'],'scope_acknowledged':True}


def test_old_method_notice_recalculate_replay_and_historical_cover(client):
    w,s=study(client);root,body=request(client,w,s)
    old=client.post(root+'/runs',json=body).json()
    frozen=historical_method(client,w['id'],s['id'],old['id'])
    details=client.get(root).json()
    reason=details['version_status']['reasons'][0]
    assert details['version_status']['status']=='stale'
    assert (reason['from_version'],reason['to_version'])==('0.9.0',s['definition']['method']['version'])
    assert client.get(f'/api/workspaces/{w["id"]}/studies').json()[0]['latest_run_id']==old['id']
    report=client.post(f'/api/workspaces/{w["id"]}/deliveries',json={'run_ids':[old['id']]}).json()
    assert 'data-version-status="stale"' in report['html']
    assert '基于旧版本方法 0.9.0' in report['html']
    deliveries=client.get(f'/api/workspaces/{w["id"]}/deliveries').json()
    assert deliveries[0]['version_status']['status']=='stale'
    refresh=rerun_body(w,s)
    response=client.post(root+'/recalculate',json=refresh)
    assert response.status_code==200,response.text
    new=response.json()
    assert new['status']=='succeeded' and new['version_status']['status']=='current'
    assert new['id']!=old['id'] and new['snapshot']['study_revision']==2
    assert client.post(root+'/recalculate',json=refresh).json()['id']==new['id']
    assert client.post(root+'/recalculate',json={**refresh,'expected_revision':99}).status_code==409
    assert client.post(root+'/recalculate',json=rerun_body(w,s)).status_code==409
    assert client.get(root).json()['version_status']['status']=='current'
    assert len(client.get(root+'/runs').json()['items'])==2
    with client.app.state.workspace_store.db() as db:
        assert dict(db.execute('SELECT snapshot,output,input_digest,output_digest FROM study_runs WHERE id=?',(old['id'],)).fetchone())==frozen
    # Existing delivery bytes/digest remain immutable after rerun.
    assert client.get(f'/api/workspaces/{w["id"]}/deliveries/{report["id"]}').json()['digest']==report['digest']


def test_model_adoption_preserves_site_and_load_and_does_not_read_draft_candidates(client):
    model=system_models()[0]
    w=client.post('/api/design/study-workspaces',json={'model_id':model['id'],'content_sha256':model['content_sha256']}).json()
    store=client.app.state.workspace_store
    with store.db(True) as db:
        row,state=store.load(db,w['id'])
        ref=state['study_cable_reference'];ref['version']='1.0.1';ref['content_sha256']='1'*64
        # Emulate a saved old system material, retaining its exact binding.
        next(m for m in ref['payload']['materials'] if m['id']=='material/xlpe')['loss_tangent']=.001
        next(m for m in state['domain']['materials'] if m['id']=='material/xlpe')['loss_tangent']=.001
        store.commit(db,row,state,'test fixture: preceding system version')
    w=client.get('/api/workspaces/'+w['id']).json()
    method=next(m['method'] for m in client.get('/api/methods').json() if m['method']['plugin_id']=='cablesim.iec60287')
    body={'expected_revision':w['revision'],'title':'引用型号版本','method':{**method,'capability':'steady-rating'},
          'input_source':'domain','parameters':deepcopy(METHOD_DEFAULTS['cablesim.iec60287'])}
    s=client.post(f'/api/workspaces/{w["id"]}/studies',json=body).json()
    root,run_body=request(client,w,s);old=client.post(root+'/runs',json=run_body).json()
    assert old['status']=='succeeded',old
    reason=old['version_status']['reasons'][0]
    assert reason['kind']=='model' and reason['from_version']=='1.0.1' and reason['to_version']=='1.0.2'
    response=client.post(root+'/recalculate',json=rerun_body(w,s));assert response.status_code==200,response.text
    new=response.json();assert new['version_status']['status']=='current'
    state=client.get('/api/workspaces/'+w['id']).json()
    assert state['domain']['sections']==w['domain']['sections']
    assert state['domain']['load_cases']==w['domain']['load_cases']
    assert next(m for m in state['domain']['materials'] if m['id']=='material/xlpe')['loss_tangent']==.004
    assert state['study_cable_reference']['version']=='1.0.2'
    assert client.get(root+'/runs/'+old['id']).json()['snapshot']['workspace_state']['study_cable_reference']['version']=='1.0.1'


def test_recalculate_preflight_failure_and_network_retry_do_not_duplicate_adoption(client,monkeypatch):
    w,s=study(client);root=f'/api/workspaces/{w["id"]}/studies/{s["id"]}'
    research=client.app.state.research;execute=research.execute
    from fastapi import HTTPException
    def disconnected(*args,**kwargs):
        execute(*args,**kwargs)
        raise HTTPException(503,'Response interrupted after acceptance')
    monkeypatch.setattr(research,'execute',disconnected)
    body=rerun_body(w,s)
    assert client.post(root+'/recalculate',json=body).status_code==503
    monkeypatch.setattr(research,'execute',execute)
    assert client.post(root+'/recalculate',json=body).status_code==200
    assert client.get(root).json()['revision']==2
    assert len(client.get(root+'/runs').json()['items'])==1


def test_empty_status_and_openapi_contract(client):
    w,s=study(client)
    result=client.get(f'/api/workspaces/{w["id"]}/studies/{s["id"]}').json()
    assert result['latest_run_id'] is None and result['version_status']['status']=='empty'
    schema=client.get('/openapi.json').json()
    assert 'VersionStatus' in schema['components']['schemas']
    endpoint=schema['paths']['/api/workspaces/{wid}/studies/{sid}/recalculate']['post']
    assert '202' in endpoint['responses'] and '409' in endpoint['responses']
    assert endpoint['requestBody']['content']['application/json']['schema']['$ref'].endswith('/RecalculateStudy')


def test_same_version_release_digest_and_missing_plugin_are_explicit(client):
    from backend.kernel.version_status import inspect
    research=client.app.state.research
    w,s=study(client)
    snapshot={'definition':deepcopy(s['definition']),'workspace_state':{}}
    snapshot['definition']['method']['release_digest']='f'*64
    result=inspect(research,snapshot)
    assert result['status']=='stale'
    assert result['reasons'][0]['from_version']==result['reasons'][0]['to_version']
    assert result['reasons'][0]['from_digest']!=result['reasons'][0]['to_digest']
    snapshot['definition']['method']['plugin_id']='test.uninstalled'
    result=inspect(research,snapshot)
    assert result['reasons'][0]['code']=='METHOD_UNAVAILABLE'
    assert result['reasons'][0]['to_version'] is None


def test_independent_model_draft_requires_merge_instead_of_overwrite(client):
    from test_type_specification_generation import create_example
    w=create_example(client)
    store=client.app.state.workspace_store
    with store.db(True) as db:
        row,state=store.load(db,w['id'])
        state['type_origin_reference']['version']='1.0.0'
        state['type_origin_reference']['content_sha256']='0'*64
        store.commit(db,row,state,'test old independent draft origin')
    w=client.get('/api/workspaces/'+w['id']).json()
    method=next(m['method'] for m in client.get('/api/methods').json() if m['method']['plugin_id']=='cablesim.iec60287')
    s=client.post(f'/api/workspaces/{w["id"]}/studies',json={
        'title':'Independent draft','expected_revision':w['revision'],'method':{**method,'capability':'steady-rating'},
        'input_source':'domain','parameters':METHOD_DEFAULTS['cablesim.iec60287']}).json()
    root=f'/api/workspaces/{w["id"]}/studies/{s["id"]}'
    response=client.post(root+'/recalculate',json=rerun_body(w,s))
    assert response.status_code==409,response.text
    assert response.json()['detail']['code']=='MODEL_REBASE_REQUIRED'
    assert client.get(root).json()['revision']==s['revision']
    assert client.get('/api/workspaces/'+w['id']).json()['domain']==w['domain']


def test_failed_preflight_adopts_once_and_never_invents_a_run(client):
    w,s=study(client)
    root=f'/api/workspaces/{w["id"]}/studies/{s["id"]}'
    invalid={**s['definition'],'expected_revision':w['revision'],'expected_study_revision':s['revision']}
    invalid['parameters']['ks']=-1
    s=client.put(root,json=invalid).json()
    body=rerun_body(w,s)
    for _ in range(2):
        response=client.post(root+'/recalculate',json=body)
        assert response.status_code==422,response.text
    assert client.get(root).json()['revision']==s['revision']+1
    assert client.get(root+'/runs').json()['items']==[]


def test_published_model_head_excludes_unpublished_drafts():
    import sqlite3
    from backend.kernel.version_status import latest_model,model_reason
    db=sqlite3.connect(':memory:');db.row_factory=sqlite3.Row
    db.executescript('CREATE TABLE engineering_assets(id TEXT,version TEXT,content_sha256 TEXT,status TEXT);'
                    'CREATE TABLE engineering_type_releases(asset TEXT,family TEXT,sequence INTEGER,payload TEXT,digest TEXT,workspace TEXT);')
    payload={'name':'published sample','document':{'cable_types':[system_models()[0]['payload']['cable_type']],
                                              'materials':system_models()[0]['payload']['materials']}}
    for n,status in [(1,'published'),(2,'published'),(3,'draft')]:
        db.execute('INSERT INTO engineering_assets VALUES(?,?,?,?)',(str(n),f'1.0.{n}',str(n)*64,status))
        db.execute('INSERT INTO engineering_type_releases VALUES(?,?,?,?,?,?)',(str(n),'type/family',n,json.dumps(payload),fingerprint(payload),'workspace-'+str(n)))
    old={'id':'type/family','version':'1.0.1','content_sha256':'1'*64}
    latest=latest_model(db,old)
    assert latest['version']=='1.0.2'
    assert model_reason(old,latest)['to_digest']=='2'*64
    db.close()


def test_three_core_reference_upgrade_preserves_multicircuit_layout():
    from backend.kernel.scenarios import attach_model, apply_layout
    from backend.domain.migration import convert
    from backend.schemas import Scenario
    model=next(m for m in system_models() if m['id']=='system.specification-yjv22-300')
    state={'domain':convert(Scenario().model_dump())['document'],'locks':[]}
    attach_model(state,model)
    state['domain']=apply_layout(state['domain'],'three_core_ducts_horizontal',1.2)
    prior=deepcopy(state['domain'])
    attach_model(state,{**model,'version':'1.0.1'},preserve_layout=True)
    assert state['domain']['sections']==prior['sections']
    assert state['domain']['circuits']==prior['circuits']
    assert state['domain']['load_cases']==prior['load_cases']


def test_specification_cover_uses_dynamic_source_version_status(client):
    # Verify the shared specification cover adapter with an immutable CAD artifact.
    from test_type_specification_generation import create_example,request as generation_request
    w=create_example(client)
    response=client.post(f'/api/types/{w["id"]}/specification/generate',json=generation_request(w))
    assert response.status_code==200,response.text
    spec=client.get(f'/api/types/{w["id"]}/specification').json()
    source=next(s for s in spec['payload']['sources'] if s['channel']=='electrical')
    historical_method(client,w['id'],source['study_id'],source['run_id'])
    response=client.get(f'/api/types/{w["id"]}/specification')
    assert response.status_code==200,response.text
    spec=response.json()
    assert spec['lifecycle']['version_status']['status']=='stale'
    assert '基于旧版本方法 0.9.0' in spec['html']
    # The existing PDF consumes the same cover bodies; no PDF layout change.
    import fitz
    pdf=client.get(f'/api/types/{w["id"]}/specification/file',params={
        'expected_revision':spec['payload']['revision'],'specification_digest':spec['digest'],'audience':'internal'})
    assert pdf.status_code==200,pdf.text
    with fitz.open(stream=pdf.content,filetype='pdf') as document:
        assert '基于旧版本方法0.9.0' in ''.join(document[0].get_text().split())
