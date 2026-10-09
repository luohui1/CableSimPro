"""Saved evidence gates and the independently calculable linear-field values."""
from copy import deepcopy
from types import SimpleNamespace
from uuid import uuid4
import pytest
from fastapi import HTTPException
from backend.kernel.fem_evidence import proof,values,conclusion,FemConclusion
from backend.kernel.batch_convergence import observation
from backend.kernel.fem_evidence import workflow_for
from test_hpc_convergence import saved_fixture


def evidence_fixture():
    run,_=saved_fixture();runs={};rows=[]
    for i,(h,b,t,kind) in enumerate([(0.008,8,320.10,'mesh'),(.004,8,320.04,'mesh'),(.002,8,320.,'mesh'),(.002,16,320.02,'domain'),(.002,32,320.04,'domain')]):
        saved=deepcopy(run);saved['id']=str(uuid4());saved['snapshot']['cases'][0]['parameters']['mesh']['size_m']=h
        saved['snapshot']['cases'][0]['parameters']['domain_options']['bounds_m']=[-b,-b,b,0]
        saved['output']['cases'][0]['artifacts']['x-cablesim.temperature-field']['hotspot']['temperature_k']=t
        runs[saved['id']]=saved;rows.append(observation(saved,'case-0',kind))
    final=saved;workflow={'id':str(uuid4()),'workspace':final['workspace'],'status':'completed','request':{'tolerance_k':.1},'rows':rows}
    return final,workflow,runs


def test_bound_mesh_and_domain_proof_is_verified_not_just_status(monkeypatch):
    run,workflow,runs=evidence_fixture();research=SimpleNamespace(get_run=lambda wid,rid:deepcopy(runs[rid]))
    monkeypatch.setattr('backend.kernel.fem_evidence.workflow_for',lambda *a:deepcopy(workflow))
    result=proof(research,run)
    assert result['status']=='converged' and result['grid_change_k']==pytest.approx(.04) and result['domain_change_k']==pytest.approx(.02)
    workflow['rows'][-1]['hotspot_k']=400
    with pytest.raises(HTTPException) as caught:proof(research,run)
    assert caught.value.status_code==409


def test_no_convergence_never_returns_numeric_conclusion(monkeypatch):
    run,_=saved_fixture();run['convergence']={'status':'unconverged','reason':'缺扩域验证','tolerance_k':.1}
    monkeypatch.setattr('backend.kernel.fem_evidence.workflow_for',lambda *a:None)
    data=FemConclusion.model_validate(conclusion(SimpleNamespace(get_run=lambda *a:run),run['workspace'],run['id']))
    assert data.status=='unconverged' and data.allowable_current_a is None and data.hottest_temperature_k is None and data.margin_k is None
    assert not data.comparison


def test_first_screen_does_not_start_image_renderer_but_report_can_prepare(monkeypatch):
    import sqlite3
    from contextlib import nullcontext
    run,_=saved_fixture()
    run['snapshot']['cases'][0]['input'].update(cable_types=[],circuits=[])
    db=sqlite3.connect(':memory:');db.row_factory=sqlite3.Row
    db.execute('CREATE TABLE study_runs(id TEXT,workspace TEXT,status TEXT,snapshot TEXT,sequence INTEGER)')
    queued=[]
    research=SimpleNamespace(store=SimpleNamespace(db=lambda:nullcontext(db)),
        delivery_jobs=SimpleNamespace(worker=SimpleNamespace(submit=lambda *args:queued.append(args))),
        resolve=lambda _: (SimpleNamespace(manifest=SimpleNamespace(capabilities=[SimpleNamespace(id='iec-thermal-field',parameter_schema={})])),None))
    monkeypatch.setattr('backend.kernel.fem_evidence.display_read',lambda *args:deepcopy(run))
    monkeypatch.setattr('backend.kernel.fem_evidence.proof',lambda *args,**kw:{'status':'converged','tolerance_k':.1,'reference_case_id':'case-0'})
    try:
        first=conclusion(research,run['workspace'],run['id'])
        assert not queued
        report=conclusion(research,run['workspace'],run['id'],prepare_report=True)
        assert report==first and len(queued)==1
        assert queued[0][1]==run['output']['cases'][0]['artifacts']['x-cablesim.temperature-field']
    finally:db.close()


def test_completed_workflow_lookup_matches_final_saved_run(tmp_path):
    import sqlite3,json
    from contextlib import contextmanager
    run,workflow,_=evidence_fixture()
    database=tmp_path/'evidence.sqlite'
    @contextmanager
    def db():
        with sqlite3.connect(database) as connection:
            connection.row_factory=sqlite3.Row
            yield connection
    with db() as connection:
        connection.execute('CREATE TABLE hpc_convergence(state TEXT)')
        connection.execute('INSERT INTO hpc_convergence VALUES (?)',(json.dumps(workflow),))
    research=SimpleNamespace(store=SimpleNamespace(db=db))
    assert workflow_for(research,run['workspace'],run['id'])==workflow
    assert workflow_for(research,run['workspace'],str(uuid4())) is None
    assert workflow_for(research,str(uuid4()),run['id']) is None


def test_capacity_temperature_margin_hand_check_and_no_borrowed_limits():
    run,_=saved_fixture();domain=run['snapshot']['cases'][0]['input']
    domain.update(cable_types=[{'id':'ct','rating':{'max_conductor_temperature':{'normal':330.}}}],circuits=[{'id':'c','cable_type':'ct','cables':[{'id':'circuit/1'}]}])
    before=deepcopy(run)
    result,_=values(run,{'reference_case_id':'case-0'})
    assert result['allowable_current_a']==400 and result['hottest_temperature_k']==320 and result['margin_k']==10
    assert result['rating_basis']=='rating-simultaneous' and run==before
    domain['cable_types'][0]['rating']={}
    assert values(run,{'reference_case_id':'case-0'})[0]['margin_k'] is None


def test_projection_observation_cache_invalidates_on_database_commit(tmp_path):
    import sqlite3,json
    from contextlib import contextmanager
    from threading import RLock
    from backend.kernel.fem_evidence import source_observation
    from backend.kernel.research import encode
    from backend.kernel.workspace import fingerprint
    from cablesim_sdk.reproduction import digest
    run,_=saved_fixture();case=run['output']['cases'][0];field=case['artifacts']['x-cablesim.temperature-field']
    field['source']={**run['snapshot']['definition']['method'],'plugin_version':'1.0.1','binding':'simulation-bundle',
        'case_id':'case-0','input_sha256':digest(run['snapshot']['cases'][0]['input']),'bundle_sha256':'d'*64}
    field['convergence']={'full_mesh_nodes':3}
    case['artifacts']['x-cablesim.simulation-bundle']={'field_storage':{'nodes':3}}
    case['artifact_digests']['x-cablesim.simulation-bundle']='d'*64
    path=tmp_path/'source.sqlite'
    @contextmanager
    def db():
        connection=sqlite3.connect(path);connection.row_factory=sqlite3.Row
        try:yield connection;connection.commit()
        finally:connection.close()
    with db() as connection:
        connection.execute('CREATE TABLE study_runs(id,workspace,sequence,created,status,snapshot,input_digest,output,output_digest)')
        connection.execute('INSERT INTO study_runs VALUES (?,?,?,?,?,?,?,?,?)',(run['id'],run['workspace'],3,run['created'],'succeeded',encode(run['snapshot']),fingerprint(run['snapshot']),encode(run['output']),fingerprint(run['output'])))
    monitor=sqlite3.connect(path)
    class ResearchStub:pass
    research=ResearchStub();research.store=SimpleNamespace(db=db)
    research.get_run=lambda *args:(_ for _ in ()).throw(HTTPException(409,'Corrupt source bytes'))
    research.read_responses=SimpleNamespace(database=monitor,watch=True,lock=RLock(),generation=lambda _:(monitor.execute('PRAGMA data_version').fetchone()[0],'seal'))
    try:
        first=source_observation(research,run['workspace'],run['id'],'case-0','mesh')
        assert first['hotspot_k']==320 and first['nodes']==3
        assert source_observation(research,run['workspace'],run['id'],'case-0','mesh')==first
        # A changed source cannot reuse a previously verified receipt.
        with db() as connection:connection.execute("UPDATE study_runs SET output=output || ' '")
        with pytest.raises(HTTPException) as corrupt:source_observation(research,run['workspace'],run['id'],'case-0','mesh')
        assert corrupt.value.status_code==409
        case['artifacts']['x-cablesim.simulation-bundle']['field_storage']['nodes']=4
        with db() as connection:connection.execute('UPDATE study_runs SET output=?,output_digest=?',(encode(run['output']),fingerprint(run['output'])))
        with pytest.raises(HTTPException) as caught:source_observation(research,run['workspace'],run['id'],'case-0','mesh')
        assert caught.value.status_code==409
    finally:monitor.close()
