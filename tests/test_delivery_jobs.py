from threading import Event
from types import SimpleNamespace
from uuid import uuid4
from time import monotonic,sleep
import pytest
from fastapi import HTTPException
from backend.kernel.delivery_jobs import DeliveryJobs
from backend.kernel.report_reads import checkpoint,archive_runs
from test_host_api import client


def wait_job(jobs,wid,jid):
    deadline=monotonic()+3
    while monotonic()<deadline:
        state=jobs.read(wid,jid)
        if state['state'] not in ('queued','running'):return state
        sleep(.005)
    pytest.fail('Report formatting did not terminate')


def test_duplicate_request_runs_once_and_cancel_prevents_delivery():
    entered,release=Event(),Event();calls=[];saved=[]
    def deliver(*args,**kwargs):
        calls.append(args);checkpoint('evidence');entered.set();assert release.wait(3)
        checkpoint('save');saved.append('book');return {'id':str(uuid4())}
    jobs=DeliveryJobs(SimpleNamespace(deliver=deliver));wid=str(uuid4())
    body={'request_id':str(uuid4()),'run_ids':[str(uuid4())]}
    try:
        job=jobs.start(wid,body);assert entered.wait(3)
        assert jobs.start(wid,body)['id']==job['id']
        with pytest.raises(HTTPException) as conflict:jobs.start(wid,{**body,'run_ids':[str(uuid4())]})
        assert conflict.value.status_code==409
        assert jobs.cancel(wid,job['id'])['state']=='cancelled'
        release.set();jobs.worker.shutdown(wait=True)
        assert saved==[] and len(calls)==1
        with pytest.raises(HTTPException) as foreign:jobs.read(str(uuid4()),job['id'])
        assert foreign.value.status_code==404
    finally:release.set();jobs.close()


def test_save_commit_cannot_be_cancelled_and_failure_is_explicit():
    entered,release=Event(),Event();did=str(uuid4())
    wid=str(uuid4())
    # Only the cancellation race is simulated; the committed receipt follows
    # the real delivery contract, with no simulated engineering result.
    receipt={'id':did,'workspace':wid,'sources':[],'renderer':'study-pdf/1',
             'digest':'a'*64,'created':'2026-10-11T00:00:00+00:00',
             'version_status':{'status':'current','reasons':[]}}
    def deliver(*args,**kwargs):
        checkpoint('save');entered.set();assert release.wait(3);return receipt
    jobs=DeliveryJobs(SimpleNamespace(deliver=deliver))
    try:
        job=jobs.start(wid,{'request_id':str(uuid4()),'run_ids':[str(uuid4())]});assert entered.wait(3)
        with pytest.raises(HTTPException) as conflict:jobs.cancel(wid,job['id'])
        assert conflict.value.status_code==409
        release.set();committed=wait_job(jobs,wid,job['id'])
        assert committed['delivery_id']==did and committed['delivery_receipt']==receipt
        jobs.research.deliver=lambda *a,**k:(_ for _ in ()).throw(HTTPException(409,'Source changed'))
        failed=jobs.start(wid,{'request_id':str(uuid4()),'run_ids':[str(uuid4())]})
        failed=wait_job(jobs,wid,failed['id'])
        assert failed['state']=='failed' and failed['delivery_id'] is None and failed['error']['message']=='Source changed'
    finally:release.set();jobs.close()


def test_archive_retains_exact_input_results_and_full_field_source_hashes():
    run={'workspace':'w','study':'s','id':'r','snapshot':{'input':'unchanged'},'output':{'cases':[{
        'case_id':'c','results':[{'value':320.123456789}],
        'artifacts':{'x-cablesim.field-points':{'binary':'large'},'x-cablesim.temperature-field':{'hotspot':320.}},
        'artifact_digests':{'x-cablesim.field-points':'a'*64}}]}}
    saved=archive_runs([run])[0]
    assert saved['snapshot']==run['snapshot'] and saved['output']['cases'][0]['results']==run['output']['cases'][0]['results']
    assert 'x-cablesim.field-points' not in saved['output']['cases'][0]['artifacts']
    assert saved['full_field_references'][0]['sha256']=='a'*64
    assert saved['full_field_references'][0]['saved_run_url'].endswith('/studies/s/runs/r')
    assert run['output']['cases'][0]['artifacts']['x-cablesim.field-points']=={'binary':'large'}


def test_host_job_models_poll_cancel_and_conflict(client,monkeypatch):
    entered,release=Event(),Event();writes=[]
    def deliver(*args,**kwargs):
        checkpoint('evidence');entered.set();assert release.wait(3)
        checkpoint('save');writes.append('delivery');return {'id':str(uuid4())}
    monkeypatch.setattr(client.app.state.research,'deliver',deliver)
    root=f'/api/workspaces/{uuid4()}/delivery-jobs'
    payload={'request_id':str(uuid4()),'run_ids':[str(uuid4())]}
    try:
        accepted=client.post(root,json=payload)
        assert accepted.status_code==202 and entered.wait(3)
        job=accepted.json();url=root+'/'+job['id']
        assert client.post(root,json=payload).json()['id']==job['id']
        assert client.get(url).json()['stage']=='evidence'
        assert client.post(root,json={**payload,'run_ids':[str(uuid4())]}).status_code==409
        assert client.post(url+'/cancel').json()['state']=='cancelled'
        release.set();client.app.state.research.delivery_jobs.worker.shutdown(wait=True)
        assert writes==[] and client.get(url).json()['delivery_id'] is None
        schema=client.get('/openapi.json').json()
        assert schema['paths']['/api/workspaces/{wid}/delivery-jobs']['post']['responses']['202']['content']['application/json']['schema']['$ref'].endswith('/DeliveryJob')
    finally:release.set()
