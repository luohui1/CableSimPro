"""Startup and immediate metadata refresh through ordinary host operations."""
import json
import os
from hashlib import sha256
from pathlib import Path
import shutil
from copy import deepcopy
from threading import Event
from time import perf_counter, time
from uuid import uuid4

from fastapi.testclient import TestClient
from backend.main import create_app
from backend.index import get_index
from backend.index.service import Index
from backend.kernel.verified_executor import VerifiedExecutor
from backend.plugin_host.registry import Registry
from test_research import client, study, request
from test_index import object_card, relations


def test_startup_prebuild_bounds_wait_and_first_inbox_is_ready(tmp_path,monkeypatch):
    entered,release=Event(),Event();original=Index.load
    def delayed(index):
        entered.set()
        assert release.wait(10)
        return original(index)
    with monkeypatch.context() as patch:
        patch.setattr(Index,'load',delayed)
        app=create_app(tmp_path/'blocked.sqlite')
        with TestClient(app) as c:
            index=get_index(app.state.research)
            assert entered.wait(3)
            try:
                started=perf_counter();response=c.get('/api/index/inbox');elapsed=perf_counter()-started
                assert response.status_code==503,response.text
                assert response.json()['detail']['code']=='INDEX_BUILDING'
                assert response.headers['Retry-After']=='1' and elapsed<=3.1
                assert 'items' not in response.json()
            finally:release.set()
            assert index.warm_done.wait(5) and index.warm_state=='ready'
            assert c.get('/api/index/inbox').status_code==200
            from backend.plugin_host import Executor
            from test_harness_resilience import saved_run
            app.state.research.executor=Executor()
            _,_,saved=saved_run(c)
    # A fresh host prebuilds without any index request. Only metadata is read.
    app=create_app(tmp_path/'blocked.sqlite')
    # Scheduler receipt identity must also be ready before the first request;
    # otherwise learning the saved run IDs changes the cache key after prebuild.
    monkeypatch.setattr(app.state.research.executor,'execution_status',lambda rid,*args:
        {'state':'succeeded','started':'isolated receipt fixture'} if rid==saved['id'] else None)
    started=perf_counter()
    with TestClient(app) as c:
        index=get_index(app.state.research)
        assert index.warm_done.wait(max(0,5-(perf_counter()-started)))
        ready_s=perf_counter()-started
        assert index.warm_state=='ready' and ready_s<=5
        def forbidden():raise AssertionError('First inbox rebuilt instead of using startup metadata')
        if os.name=='nt':monkeypatch.setattr(index,'load',forbidden)
        started=perf_counter();response=c.get('/api/index/inbox');inbox_ms=(perf_counter()-started)*1000
        assert response.status_code==200,response.text
        assert os.name!='nt' or inbox_ms<=300
        assert set(response.json()['counts'])=={'review','stale','missing','running'}
        print('\n索引冷启动 '+json.dumps({'ready_s':round(ready_s,3),'first_inbox_ms':round(inbox_ms,3),
            'busy_wait_s':round(elapsed,3)},ensure_ascii=False))


def test_committed_operations_immediately_refresh_cards_relations_and_inbox(client,monkeypatch):
    from test_harness import session
    from test_datasheet_import import upload,extract,seed_model
    from test_type_versions import adopt,submit
    from backend.foundation.contracts import AssetRelease,SourceReference
    index=get_index(client.app.state.research)
    assert index.warm_done.wait(5)
    time_at_start=time()  # Frozen expiration clock: changes cannot be detected by a TTL.
    monkeypatch.setattr('backend.index.service.time',lambda:time_at_start)
    steps=[]
    def pending(id):return any(i['object']['id']==id and i['category']=='review' for i in client.get('/api/index/inbox').json()['items'])
    w,s=study(client);root,body=request(client,w,s)
    assert object_card(client,'study',s['id'])['status']['code']=='not_run'
    run=client.post(root+'/runs',json=body).json()
    assert run['status']=='succeeded'
    assert object_card(client,'study',s['id'])['status']['code']=='current'
    assert object_card(client,'run',run['id'])['status']['code']=='current';steps.append('run_completed')
    document=deepcopy(s['definition']['method_input'])
    currents=document['load_cases'][0]['currents'];currents[next(iter(currents))]+=10
    changed=client.put(root,json={**s['definition'],'expected_revision':w['revision'],
        'expected_study_revision':s['revision'],'method_input':document})
    assert changed.status_code==200,changed.text
    s=changed.json();card=object_card(client,'study',s['id'])
    assert card['revision']==s['revision'] and card['status']['code']=='outdated'
    assert card['status']['reason'];steps.append('study_input_saved')
    h=client.app.state.harness
    for decision,value in [('approve',.85),('reject',.8)]:
        tid=session(client,w,s);task=h.tasks.record(tid)
        proposal=h.proposals.parameters(task,s['id'],None,[{'path':'/parameters/ks','value':value,'unit':'1'}],'索引刷新验收')
        assert pending(proposal['id'])
        response=client.post('/api/agent/proposals/'+proposal['id']+'/'+decision)
        assert response.status_code==200,response.text
        assert object_card(client,'proposal',proposal['id'])['status']['code']==('approved' if decision=='approve' else 'rejected')
        assert not pending(proposal['id'])
        s=client.get(root).json();steps.append('agent_'+decision)
    # Real extraction and human approval preserve original numeric cells (20.6 mm).
    document=upload(client);extraction,_=extract(client,document['id']);base=seed_model(client)
    assert extraction['status']=='succeeded'
    review=client.post(f'/api/documents/{document["id"]}/extractions/{extraction["id"]}/reviews',json={
        'request_id':str(uuid4()),'reviewer':'索引审核验收','expected_revision':0,
        'decisions':[{'candidate_id':c['id'],'action':'accept','reason':'核对隔离测试原件数值单元格'} for c in extraction['result']['candidates']]})
    assert review.status_code==200,review.text
    proposal=client.post(f'/api/documents/{document["id"]}/proposals',json={'request_id':str(uuid4()),
        'extraction_id':extraction['id'],'expected_review_revision':1,'target_model_id':base['id'],
        'expected_model_sha256':base['digest'],'version':'2'})
    assert proposal.status_code==201,proposal.text
    proposal=proposal.json();assert pending(proposal['id'])
    approved=client.post(f'/api/documents/{document["id"]}/proposals/{proposal["id"]}/approval',json={
        'request_id':str(uuid4()),'proposal_sha256':proposal['sha256'],'approver':'索引审核验收','human_approved':True})
    assert approved.status_code==200,approved.text
    cid=approved.json()['new_model_id']
    assert object_card(client,'proposal',proposal['id'])['status']['code']=='approved' and not pending(proposal['id'])
    edges=relations(client,'cable_version',cid)['uses']
    assert {'source_document','source_proposal'}<={e['role'] for e in edges}
    candidate=next(m for m in client.get('/api/domain-cable-models').json() if m['id']==cid)
    assert candidate['payload']['specification']['values']['conductor_diameter']['value']==.0206
    steps.append('manufacturer_approved')
    release=AssetRelease(asset_id='test.index.material',version='1.0.0',kind='material',name='索引生命周期样本资源',
        sources=(SourceReference(kind='project_input',reference='隔离测试身份；不是工程材料物性',reviewed=True),))
    asset=client.post('/api/foundation/assets/import',json={'release':release.model_dump(mode='json')})
    assert asset.status_code==201,asset.text
    asset=asset.json();assert pending(asset['id'])
    for action,status in [('review','reviewed'),('publish','published')]:
        response=client.post('/api/foundation/assets/'+asset['id']+'/transition',json={
            'expected_revision':asset['revision'],'content_sha256':asset['content_sha256'],'action':action,
            'note':'人工核对隔离测试资源身份','acknowledge_sources':True})
        assert response.status_code==200,response.text
        asset=response.json();assert object_card(client,'asset',asset['id'])['status']['code']==status
    assert not pending(asset['id']);steps.append('asset_published')
    import importlib.util
    seed_spec=importlib.util.spec_from_file_location('real_release_seed',Path(__file__).resolve().parents[1]/'frontend/scripts/seed-engineering-demo.py')
    seed=importlib.util.module_from_spec(seed_spec);seed_spec.loader.exec_module(seed)
    def real_api(path,method='GET',body=None,headers=None):
        response=client.request(method,path,json=body,headers=headers or {})
        assert response.status_code<300,response.text
        return response.json()
    from frontend.scripts.engineering_resources import publish_resources
    publish_resources(real_api)
    created=seed.release_teaching_mv_design(real_api)
    design=client.get('/api/workspaces/'+created['workspace']).json()
    assert object_card(client,'type',design['id'])['status']['code']=='draft'
    targets=client.get(f'/api/types/{design["id"]}/resources').json()['targets']
    material=next(t for t in targets if t['role']=='material')
    bound=client.post(f'/api/types/{design["id"]}/resources/bind',json={'expected_revision':design['revision'],
        'request_id':str(uuid4()),'role':'material','target_id':material['id'],'resource_id':asset['id']})
    assert bound.status_code==200,bound.text
    design=client.get('/api/workspaces/'+design['id']).json()
    binding=next(e for e in relations(client,'type',design['id'])['uses'] if e['role']=='material')
    assert binding['target']['id']==asset['id'] and binding['pinned']['digest']==asset['content_sha256']
    # Save all five channels through the actual host and installed algebra
    # plugins. No receipt insertion, patched get_run, or synthetic approval.
    from test_type_release_scope import declare_actual_scope,real_teaching_parameters,run_release_modules
    design,electrical,short=real_teaching_parameters(client,design)
    assert client.get(f'/api/types/{design["id"]}/workspace').json()==client.get('/api/workspaces/'+design['id']).json()
    runs=run_release_modules(client,design,electrical,short)
    assert len(runs)==5 and all(r['status']=='succeeded' and r['integrity']=='verified' for r in runs)
    # Ordinary views read their own full result, plus verified peer status.
    # The historical trace must still return the original input and all rows.
    full=client.get(f'/api/types/{design["id"]}/display-runs').json()['items']
    projected=client.get(f'/api/types/{design["id"]}/display-runs?recent=true&module=electrical')
    assert projected.status_code==200,projected.text
    originals={run['id']:run for run in full}
    for item in projected.json()['items']:
        pin=item['snapshot']['definition']['method']
        if pin['plugin_id'] not in ('cablesim.type-electrical','cablesim.standard-check'):
            continue
        source=originals[item['id']]
        for case,original in zip(item['output']['cases'],source['output']['cases']):
            for key,artifact in case['artifacts'].items():
                if pin['capability']=='electrical':
                    if 'rows' in original['artifacts'][key]:
                        assert len(artifact['rows'])==len(original['artifacts'][key]['rows'])
                    else:
                        assert artifact==original['artifacts'][key]
                    assert 'display_status_only' not in artifact
                else:
                    assert artifact['display_status_only'] and 'rows' not in artifact
                    assert artifact['rows_ref']['output_sha256']==source['output_digest']
                    archived=client.get(artifact['rows_ref']['url'])
                    assert archived.status_code==200,archived.text
                    archive=archived.json()
                    assert archive['output_digest']==source['output_digest']
                    # The full archive additionally keeps preflight details;
                    # every displayed historical output field stays identical.
                    for field,value in source['output'].items():
                        assert archive['output'][field]==value
        if pin['capability']!='electrical':
            assert item['snapshot']['definition']['parameters_ref']['input_sha256']==source['input_digest']
    scoped=declare_actual_scope(client,design)
    assert scoped['payload']['sources'] and all(s['freshness']=='current' for s in scoped['payload']['sources'])
    adopt(client,design)
    spec,submitted=submit(client,design)
    assert object_card(client,'type',design['id'])['status']['code']=='submitted'
    assert object_card(client,'delivery',submitted['submission_id'])['status']['code']=='submitted'
    assert pending(submitted['submission_id']);steps.append('type_submitted')
    human={'X-CableSim-Actor':'human'}
    approval=client.post(f'/api/types/{design["id"]}/approve',headers=human,json={'request_id':str(uuid4()),
        'submission_id':submitted['submission_id'],'specification_digest':spec['digest'],'human_confirmed':True})
    assert approval.status_code==200,approval.text
    assert approval.json()['release_exclusions']==spec['payload']['release_exclusions']
    assert object_card(client,'type',design['id'])['status']['code']=='approved' and pending(submitted['submission_id'])
    published=client.post(f'/api/types/{design["id"]}/publish',headers=human,json={'request_id':str(uuid4()),
        'submission_id':submitted['submission_id'],'specification_digest':spec['digest']})
    assert published.status_code==200,published.text
    published=published.json()
    assert object_card(client,'type',design['id'])['status']['code']=='published'
    assert object_card(client,'cable_version',published['asset_id'])['status']['code']=='published'
    frozen=client.get(f'/api/types/{design["id"]}/specification?view=detail')
    assert frozen.status_code==200,frozen.text
    assert frozen.json()['digest']==spec['digest'] and frozen.json()['lifecycle']['status']=='published'
    assert frozen.json()['payload']['release_exclusions']==spec['payload']['release_exclusions']
    assert frozen.json()['ready'] and '本次发布不含项' in frozen.json()['html']
    # Real generated geometry uses identical unrounded coordinates in the
    # lightweight browser SVG and the customer PDF's ReportLab drawing.
    from backend.kernel.type_specification_drawing import section_svg,section_drawing
    from reportlab.graphics.shapes import Circle
    from xml.etree import ElementTree
    import pytest
    payload=frozen.json()['payload']
    svg=ElementTree.fromstring(section_svg(payload));drawing=section_drawing(payload,font='Helvetica')
    circles=svg.findall('.//{http://www.w3.org/2000/svg}circle')
    printed=[shape for shape in drawing.contents if isinstance(shape,Circle)]
    assert circles and len(circles)==len(printed)
    for browser,pdf in zip(circles,printed):
        assert float(browser.attrib['cx'])==pytest.approx(pdf.cx,abs=1e-10)
        assert float(browser.attrib['cy'])==pytest.approx(drawing.height-pdf.cy,abs=1e-10)
        assert float(browser.attrib['r'])==pytest.approx(pdf.r,abs=1e-10)
    assert not pending(submitted['submission_id'])
    assert next(e for e in relations(client,'type',design['id'])['uses'] if e['role']=='published_cable_version')['target']['id']==published['asset_id']
    # The cached type-input transport must preserve every input/source and
    # immediately expose the newly published, read-only lifecycle.
    assert client.get(f'/api/types/{design["id"]}/workspace').json()==client.get('/api/workspaces/'+design['id']).json()
    steps.append('type_published')
    print('\n立即刷新覆盖 '+json.dumps(steps,ensure_ascii=False))


def test_plugin_upgrade_and_same_version_reseal_refresh_without_manual_invalidation(tmp_path):
    root=Path(__file__).resolve().parents[1]
    for name in ('backend','cablesim_sdk','plugins/cablesim.thermal-network'):
        shutil.copytree(root/name,tmp_path/name,ignore=shutil.ignore_patterns('__pycache__','*.pyc','tests'))
    app=create_app(tmp_path/'plugins.sqlite')
    (tmp_path/'jobs').mkdir()
    app.state.research.executor=VerifiedExecutor(registry=Registry(tmp_path/'plugins'),jobs_root=tmp_path/'jobs')
    with TestClient(app) as c:
        index=get_index(app.state.research);assert index.warm_done.wait(5)
        initial=object_card(c,'plugin','cablesim.thermal-network')
        w,s=study(c,plugin=initial['id']);run_root,body=request(c,w,s)
        saved=c.post(run_root+'/runs',json=body)
        assert saved.status_code==200 and saved.json()['status']=='succeeded',saved.text
        assert object_card(c,'study',s['id'])['status']['code']=='current'
        manifest_path=tmp_path/'plugins/cablesim.thermal-network/plugin.json'
        manifest=json.loads(manifest_path.read_text('utf-8'));manifest['version']='9.0.0'
        manifest_path.write_text(json.dumps(manifest),encoding='utf-8')
        upgraded=object_card(c,'plugin',initial['id']);assert upgraded['version']=='9.0.0'
        stale=object_card(c,'study',s['id']);assert stale['status']['code']=='outdated' and '9.0.0' in stale['status']['reason']
        method=next(m['method'] for m in c.get('/api/methods').json() if m['method']['plugin_id']==initial['id'])
        changed=c.put(run_root,json={**s['definition'],'method':{**method,'capability':'steady-rating'},
            'expected_revision':w['revision'],'expected_study_revision':s['revision']})
        assert changed.status_code==200,changed.text
        s=changed.json();_,body=request(c,w,s)
        saved=c.post(run_root+'/runs',json=body)
        assert saved.status_code==200 and saved.json()['status']=='succeeded',saved.text
        assert object_card(c,'study',s['id'])['status']['code']=='current'
        source=tmp_path/'plugins/cablesim.thermal-network'/manifest['files'][0]['path']
        source.write_bytes(source.read_bytes()+b'\n# isolated same-version seal fixture\n')
        manifest['files'][0]['sha256']=sha256(source.read_bytes()).hexdigest()
        manifest_path.write_text(json.dumps(manifest),encoding='utf-8')
        resealed=object_card(c,'plugin',initial['id']);assert resealed['version']==upgraded['version']
        stale=object_card(c,'study',s['id'])
        assert stale['status']['code']=='outdated' and '同版本发行摘要变化' in stale['status']['reason']
        assert next(e for e in relations(c,'study',s['id'])['uses'] if e['role']=='method')['freshness']=='outdated'
        assert get_index(app.state.research).snapshot().cards['plugin',initial['id']]==resealed
