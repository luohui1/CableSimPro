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


def test_old_boundary_uses_saved_bundle_never_current_defaults():
    from backend.kernel.fem_evidence import saved_boundary
    run,_=saved_fixture();before=deepcopy(run)
    run['snapshot']['cases'][0]['parameters'].pop('outer_boundary',None)
    artifacts=run['output']['cases'][0]['artifacts']
    artifacts['x-cablesim.simulation-bundle']={'result':{'outer_boundary':{'kind':'kennelly_image'}}}
    frozen=deepcopy(run)
    assert saved_boundary(run,'case-0')=='kennelly_image' and run==frozen
    artifacts.pop('x-cablesim.simulation-bundle')
    assert saved_boundary(run,'case-0')=='ambient_truncated'
    run['snapshot']['cases'][0]['parameters']['outer_boundary']='ambient_truncated'
    artifacts['x-cablesim.simulation-bundle']={'result':{'outer_boundary':{'kind':'kennelly_image'}}}
    assert saved_boundary(run,'case-0')=='ambient_truncated'


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
    from backend.plugin_host.manifest import ParameterSchema
    from contextlib import nullcontext
    run,_=saved_fixture()
    run['snapshot']['cases'][0]['input'].update(cable_types=[],circuits=[])
    db=sqlite3.connect(':memory:');db.row_factory=sqlite3.Row
    db.execute('CREATE TABLE study_runs(id TEXT,workspace TEXT,status TEXT,snapshot TEXT,sequence INTEGER)')
    queued=[]
    research=SimpleNamespace(store=SimpleNamespace(db=lambda:nullcontext(db)),
        delivery_jobs=SimpleNamespace(worker=SimpleNamespace(submit=lambda *args:queued.append(args))),
        registry=lambda _: SimpleNamespace(get=lambda _: SimpleNamespace(manifest=SimpleNamespace(capabilities=[SimpleNamespace(id='iec-thermal-field',parameter_schema=ParameterSchema(type='object',properties={}))]))),
        resolve=lambda _: (_ for _ in ()).throw(HTTPException(409,'旧运行不应重新绑定当前方法发行。')))
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


def test_real_saved_display_receipt_survives_unrelated_commit_but_rejects_byte_drift(tmp_path, monkeypatch):
    """Read the actual sealed 811855 field; never synthesize FEM output.

    A no-op database commit models another page saving unrelated data. Corrupt
    bytes model an integrity failure that cannot be produced through normal UI.
    Currentness and source integrity must still be checked on cache hits.
    """
    import sqlite3
    from pathlib import Path
    from backend.kernel.workspace import WorkspaceStore
    from backend.kernel.research import Research
    from backend.kernel.batch_field_projection import read_display
    source=Path('.data/release/engineering.sqlite').resolve()
    if not source.exists():pytest.skip('发布库缺失，不制造保存结果')
    destination=tmp_path/'field.sqlite'
    with sqlite3.connect(source.as_uri()+'?mode=ro',uri=True) as db:
        row=db.execute('SELECT workspace,id FROM study_runs WHERE id=?',('00c54351-4a2c-49f5-bf88-7e86e6a9615f',)).fetchone()
        if row is None:pytest.skip('发布库未包含作业 811855')
        with sqlite3.connect(destination) as private:db.backup(private)
    service=Research(WorkspaceStore(destination));calls=[]
    original=service.artifact_status
    def observe(run):
        calls.append(1)
        return original(run)
    monkeypatch.setattr(service,'artifact_status',observe)
    try:
        first=read_display(service,*row)
        assert first['integrity']=='verified'
        assert first['output']['cases'][0]['artifacts']['x-cablesim.temperature-field']['source']['binding']=='simulation-bundle'
        with service.store.db(True) as db:db.execute('UPDATE workspaces SET revision=revision WHERE id=?',(row[0],))
        second=read_display(service,*row)
        assert second['output']==first['output'] and len(calls)==1
        assert second['freshness']==first['freshness'] and second['version_status']==first['version_status']
        from backend.kernel.fem_evidence import source_observation
        case_id=first['output']['cases'][0]['case_id']
        saved_observation=source_observation(service,*row,case_id,'mesh')
        assert saved_observation['hotspot_k']==381.51532875844487
        # A new host must reuse the byte-bound receipt, not merely a process dict.
        restarted=Research(WorkspaceStore(destination));restart_calls=[]
        original_restart=restarted.artifact_status
        def observe_restart(run):
            restart_calls.append(1);return original_restart(run)
        monkeypatch.setattr(restarted,'artifact_status',observe_restart)
        try:
            reopened=read_display(restarted,*row)
            assert reopened['output']==first['output'] and restart_calls==[]
            assert reopened['version_status']==first['version_status']
            # The actual source row is still rehashed after a host restart;
            # only its already verified immutable observation is reused.
            assert source_observation(restarted,*row,case_id,'mesh')==saved_observation
        finally:restarted.close()
        from backend.kernel.report_reads import saved_scope
        from backend.kernel.fem_evidence import display_read
        from backend.kernel.study_pdf import validate_sources
        @saved_scope
        def check_paper_source():
            verified=display_read(service,*row)
            validate_sources([verified])
            # A display copy is not a license to change the saved quantities.
            verified['output']['cases'][0]['results'][0]['value']+=1
            with pytest.raises(ValueError,match='完整性'):validate_sources([verified])
            unchanged=display_read(service,*row)
            assert unchanged['output']==first['output']
            validate_sources([unchanged])
        check_paper_source()
        with pytest.raises(ValueError,match='完整性'):validate_sources([second])
        # The row's declared output digest is deliberately unchanged.
        with service.store.db(True) as db:db.execute("UPDATE study_runs SET output=replace(output,'381.51532875844487','382.51532875844487') WHERE id=?",(row[1],))
        with pytest.raises(HTTPException) as error:read_display(service,*row)
        assert error.value.status_code==409
        with pytest.raises(HTTPException) as observation_error:
            source_observation(service,*row,case_id,'mesh')
        assert observation_error.value.status_code==409
    finally:service.close()
