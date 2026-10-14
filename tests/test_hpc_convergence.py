"""Lightweight orchestration and saved evidence tests; no native solver runs."""
from contextlib import contextmanager
from copy import deepcopy
from types import SimpleNamespace
from uuid import uuid4
import json
import sqlite3
import pytest
from fastapi import HTTPException
from backend.kernel.batch_convergence import RefineRequest, Refinements, next_parameters, verdict
from backend.kernel.batch_field_chapter import compare, field_png, chapter
from backend.kernel.batch_files import atomic


def saved_fixture():
    params={'mesh':{'size_m':.004,'far_size_m':.5,'minimum_circle_segments':32,'max_nodes':120000},
            'domain_options':{'bounds_m':[-8,-8,8,0]},'iec':{'operation':'both'}}
    original={'case_id':'case-0','input':{'load_a':400},'parameters':params}
    field={'association':'node','temperature_unit':'K','mesh':{'points':[[0,0],[1,0],[0,1]],'triangles':[[0,1,2]]},
           'temperature_k':[300.,310.,320.],'hotspot':{'temperature_k':320.,'point_m':[0,1]}}
    case={'case_id':'case-0','status':'succeeded','results':[
        {'key':'conductor_temperature','unit':'K','case':'operating','entity':'circuit/1','status':'available','value':320.},
        {'key':'ampacity','unit':'A','case':'rating-simultaneous','entity':'circuit/1','status':'available','value':400.}],
        'artifacts':{'x-cablesim.temperature-field':field},'artifact_digests':{'x-cablesim.temperature-field':'a'*64}}
    run={'id':str(uuid4()),'study':str(uuid4()),'workspace':str(uuid4()),'sequence':3,'created':'2026-10-08T12:00:00Z',
         'status':'succeeded','integrity':'verified','output_digest':'b'*64,'snapshot':{'definition':{'title':'公开平面线性场核验',
         'method':{'plugin_id':'cablesim.simulation','capability':'iec-thermal-field','version':'1.0.1','release_digest':'c'*64}},'cases':[original]},
         'output':{'cases':[case]},'artifact_status':{'case-0':{'x-cablesim.temperature-field':{'status':'verified'}}}}
    iec=deepcopy(run);iec['id']=str(uuid4());iec['snapshot']['definition']['method']['plugin_id']='cablesim.iec60287'
    iec['snapshot']['cases'][0]['parameters']=deepcopy(params['iec']);iec['output']['cases'][0]['results'][0]['value']=319.
    return run,iec


def service(tmp_path,monkeypatch):
    run,_=saved_fixture();connection=sqlite3.connect(tmp_path/'db.sqlite');connection.row_factory=sqlite3.Row
    connection.execute('CREATE TABLE workspaces(id TEXT,revision INT)');connection.execute('INSERT INTO workspaces VALUES (?,1)',(run['workspace'],));connection.commit();connection.close()
    @contextmanager
    def db(write=False):
        connection=sqlite3.connect(tmp_path/'db.sqlite');connection.row_factory=sqlite3.Row
        try:yield connection;connection.commit()
        except Exception:connection.rollback();raise
        finally:connection.close()
    profile=tmp_path/'profile.json';atomic(profile,{})
    jobs=[];research=SimpleNamespace(store=SimpleNamespace(db=db),owner_epoch='owner',background=SimpleNamespace(submit=lambda *a:jobs.append(a)),
        get_run=lambda *a:run,resolve=lambda _: (SimpleNamespace(manifest=None),None),
        executor=SimpleNamespace(required=lambda *a:True,profile=profile,resources=lambda *a:{},execution_status=lambda *a,**k:None),
        save=lambda *a,**k:{'id':str(uuid4()),'revision':1})
    monkeypatch.setattr('backend.kernel.batch_convergence.allocation_estimate',lambda *a:{'upper_core_hours':1})
    manager=Refinements(research)
    return manager,run,jobs


def test_start_is_idempotent_and_consent_budget_are_enforced(tmp_path,monkeypatch):
    manager,run,jobs=service(tmp_path,monkeypatch)
    args=dict(request_id=uuid4(),source_run_id=run['id'],budget_confirmed=True)
    first=manager.start(run['workspace'],run['study'],RefineRequest(**args))
    assert manager.start(run['workspace'],run['study'],RefineRequest(**args))['id']==first['id'] and len(jobs)==1
    with pytest.raises(HTTPException) as caught:manager.start(run['workspace'],run['study'],RefineRequest(**{**args,'max_core_hours':3}))
    assert caught.value.status_code==409
    with pytest.raises(HTTPException):manager.start(run['workspace'],run['study'],RefineRequest(**{**args,'budget_confirmed':False}))
    with pytest.raises(ValueError):RefineRequest(**args,tolerance_k=.2)
    manager.active.clear()
    with pytest.raises(HTTPException):manager.start(run['workspace'],run['study'],RefineRequest(**{**args,'request_id':uuid4(),'max_core_hours':1}))
    run['convergence']={'tolerance_k':.01}
    with pytest.raises(HTTPException,match='不能放宽'):manager.start(run['workspace'],run['study'],RefineRequest(**{**args,'request_id':uuid4()}))


def test_half_mesh_and_double_domain_keep_physics_and_field_order():
    run,_=saved_fixture();parameters=run['snapshot']['cases'][0]['parameters'];finer=next_parameters(parameters,'mesh')
    assert finer['mesh']['size_m']==.002 and parameters['mesh']['size_m']==.004
    assert finer['iec']==parameters['iec'] and finer['domain_options']==parameters['domain_options']
    assert next_parameters(parameters,'domain')['domain_options']['bounds_m']==[-16,-16,16,0]


def test_continue_keeps_saved_expansions_and_original_final_rating(tmp_path,monkeypatch):
    from backend.kernel.batch_convergence import observation
    manager,run,_=service(tmp_path,monkeypatch)
    first=manager.start(run['workspace'],run['study'],RefineRequest(request_id=uuid4(),source_run_id=run['id'],budget_confirmed=True))
    first.update(status='blocked',study=run['study'])
    run['snapshot']['cases'][0]['parameters']['iec']['operation']='temperature'
    expanded=deepcopy(run);expanded['id']=str(uuid4())
    expanded['snapshot']['cases'][0]['parameters']['domain_options']['bounds_m']=[-16,-16,16,0]
    first['rows'].append(observation(expanded,'case-0','domain'))
    manager.save(first);manager.active.clear()
    manager.research.get_run=lambda wid,rid:expanded if rid==expanded['id'] else run
    result=manager.start(run['workspace'],run['study'],RefineRequest(request_id=uuid4(),source_run_id=run['id'],
        continue_from=first['id'],budget_confirmed=True))
    assert len(result['rows'])==2
    assert result['domain_parameters']['domain_options']['bounds_m']==[-16,-16,16,0]
    assert result['definition']['parameters']['iec']['operation']=='both'


def test_hand_calculated_differences_reject_small_domain_and_stale_mesh():
    rows=[{'kind':'mesh','hotspot_k':t,'mesh_size_m':h,'bounds_m':[-8,-8,8,0]} for h,t in ((.008,320.1),(.004,320.04),(.002,320.))]
    rows.append({'kind':'domain','hotspot_k':320.02,'mesh_size_m':.002,'bounds_m':[-16,-16,16,0],'change_k':0})
    assert not verdict(rows,.1)['domain_passed']
    rows.append({'kind':'domain','hotspot_k':320.04,'mesh_size_m':.002,'bounds_m':[-32,-32,32,0],'change_k':0})
    actual=verdict(rows,.1)
    assert actual['status']=='converged' and actual['grid_change_k']==pytest.approx(.04) and actual['domain_change_k']==pytest.approx(.02)
    rows[-1]['bounds_m']=[-9,-9,9,0]
    assert verdict(rows,.1)['status']=='unconverged'
    rows[-1].update(bounds_m=[-16,-16,16,0],mesh_size_m=.004)
    assert not verdict(rows,.1)['domain_passed']


def test_worker_stops_at_gate_and_budget_without_more_submissions(tmp_path,monkeypatch):
    manager,run,_=service(tmp_path,monkeypatch)
    value=manager.start(run['workspace'],run['study'],RefineRequest(request_id=uuid4(),source_run_id=run['id'],budget_confirmed=True,max_core_hours=2))
    calls=[]
    def level(v,kind):
        calls.append(kind);v['actual_core_hours']=1;v['attempts'].append({'status':'succeeded'});manager.save(v)
    monkeypatch.setattr(manager,'step',level);manager.work(value['id'])
    result=manager.load(value['id']);assert result['status']=='budget_exhausted' and calls==['mesh']
    result['verdict']=verdict(result['rows'],.1)
    assert result['verdict']['status']=='unconverged'


def test_cancellation_and_restart_preserve_pending_identity(tmp_path,monkeypatch):
    manager,run,_=service(tmp_path,monkeypatch)
    value=manager.start(run['workspace'],run['study'],RefineRequest(request_id=uuid4(),source_run_id=run['id'],budget_confirmed=True))
    value.update(pending={'request_id':str(uuid4())},owner='previous');manager.save(value)
    assert manager.load(value['id'])['status']=='interrupted'
    cancelled=[];manager.research.executor.request_cancel=lambda *a,**k:cancelled.append((a,k))
    manager.cancel(value['id']);manager.save(value) # stale worker snapshot must not erase cancel intent
    assert manager.load(value['id'])['cancel_requested'] and cancelled[0][1]['phase']=='check'
    manager.work(value['id']);assert manager.load(value['id'])['status']=='cancelled'


@pytest.mark.parametrize('temperature_only',[False,True])
def test_worker_stops_immediately_at_two_mesh_and_domain_thresholds(tmp_path,monkeypatch,temperature_only):
    manager,run,_=service(tmp_path,monkeypatch)
    value=manager.start(run['workspace'],run['study'],RefineRequest(request_id=uuid4(),source_run_id=run['id'],budget_confirmed=True,temperature_only_levels=temperature_only))
    calls=[]
    def step(v,kind):
        if kind=='rating':
            calls.append(kind);v['rating_run_id']='final-rating';manager.save(v);return
        parameters=next_parameters(v[kind+'_parameters'],kind);calls.append(kind)
        row={**v['rows'][-1],'kind':kind,'mesh_size_m':parameters['mesh']['size_m'],'bounds_m':parameters['domain_options']['bounds_m'],
             'hotspot_k':320 + [.04,.06,.07,.075][len(calls)-1]}
        v['rows'].append(row);v[kind+'_parameters']=parameters
        if kind=='mesh':v['domain_parameters']=deepcopy(parameters)
        v['attempts'].append({'status':'succeeded'});v['actual_core_hours']+=.01;manager.save(v)
    monkeypatch.setattr(manager,'step',step);manager.work(value['id'])
    assert calls==['mesh','mesh','domain','domain']+(['rating'] if temperature_only else [])
    assert manager.load(value['id'])['status']=='completed'


def test_field_routes_project_without_mutation_and_sample_full_saved_values(tmp_path,monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.kernel.hpc_jobs import make_router
    from io import BytesIO
    import numpy as np
    manager,run,_=service(tmp_path,monkeypatch)
    from backend.kernel.workspace import fingerprint
    run['input_digest']=fingerprint(run['snapshot'])
    artifacts=run['output']['cases'][0]['artifacts']
    artifacts['x-cablesim.temperature-field']['mesh']['domain_ids']=[1]
    artifacts['x-cablesim.field-test']={'binary':'must not travel with view'}
    # Route fixture uses an in-memory saved run; byte-integrity and live database
    # currentness are exercised by test_display_projection_checks_real_bytes.
    from backend.kernel.batch_field_projection import display_only
    monkeypatch.setattr('backend.kernel.batch_field_projection.read_display',lambda research,wid,rid:display_only(research.get_run(wid,rid)))
    manager.research.store.read_snapshot=manager.research.store.db
    # This fixture owns route projection/sample refusal, not host cache timing.
    # Keep the real response/revalidation code, with an uncached adapter whose
    # loader is always called after the fixture changes its integrity state.
    manager.research.read_responses=SimpleNamespace(get=lambda *a:None,
        build=lambda key,model,load,*a,**k:load(),gzip=__import__('gzip').compress)
    with manager.research.store.db() as db:
        db.execute('CREATE TABLE study_runs(id TEXT,workspace TEXT,status TEXT)')
        db.execute('INSERT INTO study_runs VALUES (?,?,?)',(run['id'],run['workspace'],run['status']))
    app=FastAPI();app.include_router(make_router(manager.research))
    url=f"/api/hpc/workspaces/{run['workspace']}/fields/{run['id']}"
    with TestClient(app) as client:
        view=client.get(url+'/view');assert view.status_code==200
        assert 'x-cablesim.field-test' not in view.json()['output']['cases'][0]['artifacts']
        assert 'x-cablesim.field-test' in artifacts
        sampled=client.post(url+'/sample',json=[[.25,.25],[2,2]])
        assert sampled.json()['temperature_k']==[307.5,None] and sampled.json()['mesh']=='full'
        assert client.post(url+'/sample',json=[]).status_code==422
        archive=client.get(url+'/full');assert archive.status_code==200
        with np.load(BytesIO(archive.content),allow_pickle=False) as arrays:
            assert arrays['temperature_k'].tolist()==[300.,310.,320.]
        run['integrity']='tampered'
        assert client.get(url+'/view').status_code==409


def test_scheduler_start_end_are_utc_and_legacy_accounting_still_valid(tmp_path,monkeypatch):
    import sys
    if sys.platform=='win32':monkeypatch.setitem(sys.modules,'fcntl',SimpleNamespace())
    from backend.kernel import batch_remote_agent as remote
    token=str(uuid4());atomic(tmp_path/'submissions'/token/'submission.json',{'job_id':'123','request':{'indices':[0]}})
    monkeypatch.setattr(remote,'command',lambda _: '123_0|COMPLETED|2|30|60|||0:0|2026-10-08T12:00:00|2026-10-08T12:00:30|')
    result=remote.accounting(tmp_path,token)
    assert result['started']=='2026-10-08T12:00:00Z' and result['finished']=='2026-10-08T12:00:30Z' and result['actual_cpu_seconds']==60
    monkeypatch.setattr(remote,'command',lambda _: '123_0|COMPLETED|2|30|60|||0:0|')
    assert remote.accounting(tmp_path,token)['finished'] is None


def test_failed_and_replayed_accounting_is_monotonic():
    value={'actual_core_hours':0}
    Refinements.charge(value,'checks','one',{'actual_cpu_seconds':60})
    Refinements.charge(value,'checks','one',{'actual_cpu_seconds':60})
    Refinements.charge(value,'checks','one',{'actual_cpu_seconds':30})
    Refinements.charge(value,'checks','one',{'actual_cpu_seconds':90})
    assert value['actual_core_hours']==pytest.approx(90/3600)


def test_cancel_disconnect_is_not_reported_as_terminal(tmp_path,monkeypatch):
    from backend.kernel.batch_slurm import RemoteDisconnected
    manager,run,_=service(tmp_path,monkeypatch)
    value=manager.start(run['workspace'],run['study'],RefineRequest(request_id=uuid4(),source_run_id=run['id'],budget_confirmed=True))
    value.update(cancel_requested=True,pending={'request_id':str(uuid4())});manager.save(value)
    executor=manager.research.executor
    executor.execution_status=lambda *a,**k:{'plan_id':'plan','actual_cpu_seconds':10}
    executor.request_cancel=lambda *a,**k:None
    def disconnected(*a,**k):raise RemoteDisconnected('offline; cancellation remains unconfirmed')
    executor.refresh_status=disconnected;manager.work(value['id'])
    saved=manager.load(value['id']);assert saved['status']=='interrupted' and saved['cancel_requested']
    assert saved['actual_core_hours']==pytest.approx(10/3600)


def test_job_list_uses_metadata_and_cancel_arrays_remain_cancellable(tmp_path,monkeypatch):
    from backend.kernel.hpc_jobs import make_router
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    manager,run,_=service(tmp_path,monkeypatch)
    with manager.store.db(True) as db:
        db.execute('ALTER TABLE workspaces ADD COLUMN state TEXT')
        db.execute('UPDATE workspaces SET state=?',(json.dumps({'domain':{'name':'城北变电站'}}),))
        db.execute('CREATE TABLE study_runs(id,workspace,study,sequence,status,created,finished,snapshot)')
        db.execute('INSERT INTO study_runs VALUES (?,?,?,?,?,?,?,?)',(run['id'],run['workspace'],run['study'],3,'running',run['created'],None,json.dumps(run['snapshot'])))
    manager.research.get_run=lambda *a:pytest.fail('GET jobs must not load field archive')
    execution={'job_id':'123','actual_cpu_seconds':60,'slurm_states':['RUNNING','COMPLETED'],'state':'running','budget_core_hours':2,'queue_position':None}
    manager.research.executor.execution_status=lambda *a:execution
    manager.research.executor.refresh_status=lambda *a:{**execution,'started':'2026-10-08T12:00:00Z'}
    app=FastAPI();app.include_router(make_router(manager.research))
    with TestClient(app) as client:
        values=client.get('/api/hpc/jobs').json();assert values['total']==1
        assert values['items'][0]['core_hours']==pytest.approx(1/60) and values['items'][0]['cancellable']
        card=values['items'][0]
        assert card['workspace_id']==run['workspace'] and card['workspace_name']=='城北变电站'
        assert card['study_id']==run['study'] and card['run_id']==run['id'] and card['type']=='single'
        assert card['budget_core_hours']==2 and card['queue_position'] is None and card['missing_fields']==[]
        assert client.post('/api/hpc/jobs/'+run['id']+'/refresh').json()['started'].endswith('Z')


def test_saved_comparison_hand_difference_kelvin_and_input_rejection():
    fem,iec=saved_fixture();value=compare(fem,iec)
    assert value['rows'][0]['delta']==1 and value['rows'][0]['relative_percent']==pytest.approx(100/319)
    assert value['rows'][0]['fem']==320 and not value['engineering_approval']
    iec['snapshot']['cases'][0]['input']['load_a']=401
    with pytest.raises(ValueError,match='领域输入'):compare(fem,iec)


def test_preflight_job_links_only_its_saved_run(tmp_path,monkeypatch):
    from uuid import uuid5,UUID
    from backend.kernel.hpc_jobs import job_cards
    manager,run,_=service(tmp_path,monkeypatch)
    request=str(uuid4());method=run['snapshot']['definition']['method'];workflow_id=str(uuid4())
    plan=str(uuid5(UUID(request),method['plugin_id']+'/'+method['capability']+'/check'))
    workflow={'id':workflow_id,'definition':{'method':method},'rows':[],
              'request':{'max_core_hours':100},'attempts':[{'request_id':request,'run_id':run['id']}]}
    manager.list=lambda:[workflow]
    row={'id':'preflight:'+workflow_id+':'+plan,'kind':'preflight','workspace':run['workspace'],
         'study':run['study'],'core_hours':.01,'execution':{'plan_id':plan,'job_id':'123','budget_core_hours':.1}}
    card=job_cards(manager.research,manager,[row])[0]
    assert card['run_id']==run['id'] and card['type']=='convergence'
    assert card['budget_core_hours']==.1 and card['workflow_budget_core_hours']==100
    row['execution']['plan_id']=str(uuid4())
    assert job_cards(manager.research,manager,[row])[0]['run_id'] is None


def test_historical_comparison_is_readable_but_not_current_report_evidence():
    fem,iec=saved_fixture()
    fem.update(freshness='historical',version_status={'status':'stale'})
    iec.update(freshness='current',version_status={'status':'current'})
    value=compare(fem,iec)
    assert value['rows'][0]['delta']==1
    assert not value['fem']['eligible_current_report']
    assert value['iec']['eligible_current_report']


def test_temperature_only_level_compares_saved_temperatures_without_inventing_rating():
    fem,iec=saved_fixture()
    fem['snapshot']['cases'][0]['parameters']['iec']['operation']='temperature'
    fem['output']['cases'][0]['results']=fem['output']['cases'][0]['results'][:1]
    rows=compare(fem,iec)['rows']
    assert rows[0]['delta']==1
    rating=next(row for row in rows if row['key']=='ampacity')
    assert rating['fem'] is None and rating['iec']==400 and rating['delta'] is None
    fem['snapshot']['cases'][0]['parameters']['iec']['ks']=.9
    with pytest.raises(ValueError,match='电损耗'):compare(fem,iec)


def test_png_is_saved_linear_field_not_a_solver():
    from PIL import Image
    from io import BytesIO
    fem,_=saved_fixture();image=Image.open(BytesIO(field_png(fem['output']['cases'][0]['artifacts']['x-cablesim.temperature-field'])))
    assert image.size==(1000,600)
    # Linear T=300+10x+20z: two interior points at distinct isotherms differ.
    assert image.getpixel((100,500))!=image.getpixel((100,300))
    assert image.getpixel((850,500))==(255,255,255)


def test_router_chapter_and_cross_workspace_guard(tmp_path,monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.kernel.hpc_jobs import make_router,terminal
    manager,fem,_=service(tmp_path,monkeypatch);_,iec=saved_fixture()
    # Same synthetic hand-check input; immutable identities remain distinct.
    manager.research.get_run=lambda wid,rid:fem if rid==fem['id'] else iec
    app=FastAPI();app.include_router(make_router(manager.research))
    with TestClient(app) as client:
        result=client.get(f"/api/hpc/workspaces/{fem['workspace']}/chapters/{fem['id']}?iec_run_id={iec['id']}")
        assert result.status_code==200 and result.json()['chapter_digest']
        assert client.get(result.json()['field']['image_url']).headers['content-type']=='image/png'
    assert not terminal({'slurm_states':['RUNNING','COMPLETED']})
    assert terminal({'slurm_states':['FAILED','COMPLETED']})


def test_report_rechecks_saved_convergence_values(tmp_path,monkeypatch):
    manager,fem,_=service(tmp_path,monkeypatch);_,iec=saved_fixture()
    value=manager.start(fem['workspace'],fem['study'],RefineRequest(request_id=uuid4(),source_run_id=fem['id'],budget_confirmed=True))
    manager.research.get_run=lambda wid,rid:fem if rid==fem['id'] else iec
    value['rows'][0]['hotspot_k']+=1;manager.save(value)
    with pytest.raises(HTTPException) as caught:chapter(manager.research,manager,fem['workspace'],fem['id'],iec['id'],value['id'])
    assert caught.value.status_code==409
    with pytest.raises(HTTPException) as caught:chapter(manager.research,manager,'another-workspace',fem['id'],iec['id'],value['id'])
    assert caught.value.status_code==409


def test_legacy_preflight_is_visible_without_inventing_a_study(tmp_path):
    from backend.kernel.hpc_jobs import unbound_checks
    identifier=str(uuid4());atomic(tmp_path/identifier/'plan.json',{'id':identifier,'phase':'check','operation_id':None})
    atomic(tmp_path/identifier/'execution.json',{'plan_id':identifier,'job_id':'456','slurm_states':['RUNNING'],'actual_cpu_seconds':12})
    research=SimpleNamespace(executor=SimpleNamespace(root=tmp_path))
    row=unbound_checks(research,[])[0]
    assert row['study'] is None and row['cancellable'] and '归属未记录' in row['study_name']
    atomic(tmp_path/identifier/'cancel-request.json',{'requested':True})
    assert unbound_checks(research,[])[0]['execution']['cancel_requested']
    assert unbound_checks(research,[{'execution':{'plan_id':identifier}}])==[]


def test_queue_position_is_observed_priority_order_not_start_prediction(tmp_path,monkeypatch):
    import sys
    if sys.platform=='win32':monkeypatch.setitem(sys.modules,'fcntl',SimpleNamespace())
    from backend.kernel import batch_remote_agent as remote
    token=str(uuid4());atomic(tmp_path/'submissions'/token/'submission.json',{'job_id':'123','request':{'indices':[0]}})
    monkeypatch.setattr(remote,'command',lambda cmd: '99\n99\n123\n456\n' if cmd[0]=='squeue' else '123_0|PENDING|1|0|0|||0:0|Unknown|Unknown|')
    value=remote.accounting(tmp_path,token)
    assert value['queue_position']==2 and value['queue_position_basis']=='partition_priority_order'
    assert value['started'] is None and value['finished'] is None


def test_budget_estimate_does_not_generate_or_solve_a_mesh(tmp_path,monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.kernel.hpc_jobs import make_router
    manager,run,_=service(tmp_path,monkeypatch)
    manager.research.prepare=lambda *args:run['snapshot']
    monkeypatch.setattr('backend.kernel.hpc_jobs.allocation_estimate',lambda *args:{'upper_core_hours':6.2})
    manager.research.executor.check=lambda *args:pytest.fail('estimate must never submit a mesh')
    app=FastAPI();app.include_router(make_router(manager.research))
    with TestClient(app) as client:
        response=client.get(f"/api/hpc/workspaces/{run['workspace']}/studies/{run['study']}/estimate?expected_revision=1&expected_study_revision=1")
        assert response.status_code==200,response.text
        assert response.json()=={'estimated_nodes':None,'node_limit':120000,'estimate_status':'mesh_preflight_required','budget_core_hours':6.2,'case_count':1}
