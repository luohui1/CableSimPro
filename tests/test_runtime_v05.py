"""Runtime integration tests: actual solvers and storage; no cloud credentials."""
from concurrent.futures import ThreadPoolExecutor
import json
import sqlite3
import time
from uuid import uuid4
import numpy as np
import pytest
from fastapi.testclient import TestClient
from backend.main import create_app
from backend.design_basis import DesignBasis, inspect_basis, STANDARDS
from backend.schemas import Scenario
from backend.engine import calculate
from backend.vertical import Vertical

@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path/'runtime.sqlite')) as c:
        yield c

def project(c):
    r=c.post('/api/workspaces',json={});assert r.status_code==201;return r.json()
def invoke(c,w,cap,args=None,rid=None):
    return c.post(f"/api/runtime/{w['id']}/invoke",json={'request_id':rid or str(uuid4()),'capability':cap,'expected_revision':w['revision'],'arguments':args or {}})
def result(r):
    assert r.status_code==200,r.text
    return r.json()['result']
def approval(c,w,p):
    return c.post(f"/api/workspaces/{w['id']}/proposals/{p['id']}/approve",json={'expected_revision':w['revision']})
def set_basis(c,w,**kwargs):
    p=result(invoke(c,w,'standards.propose',DesignBasis(**kwargs).model_dump()))
    r=approval(c,w,p);assert r.status_code==200,r.text;return r.json()['workspace']


def test_capability_catalog_explicit_schema_and_no_privileged_tools(client):
    manifest=client.get('/api/runtime/capabilities').json()
    names={t['name'] for t in manifest['tools']}
    assert len(names)==12 and {'model.generate','selection.evaluate','analysis.buried','task.plan'}<=names
    assert not names&{'shell','sql','unlock','approve','set_key','http.fetch'}
    for t in manifest['tools']:
        assert t['requires_revision'] and t['input_schema']['additionalProperties'] is False

@pytest.mark.parametrize('cap,args',[('shell',{}),('project.inspect',{'secret':'bad'}),('model.generate',{'path':'../../x'}),('analysis.fields',{'kind':'fake'}),('analysis.fields',{'kind':'electric','resolution':5000}),('selection.evaluate',{'target_current_a':-1}),('parameters.propose',{'changes':[]})])
def test_unregistered_and_invalid_requests_rejected(client,cap,args):
    w=project(client);assert invoke(client,w,cap,args).status_code==422
    assert client.get(f"/api/workspaces/{w['id']}").json()['revision']==1


def test_calc_uses_same_physics_and_persists_runtime_snapshot(client):
    w=project(client);r=invoke(client,w,'analysis.buried');out=result(r)
    baseline=calculate(Scenario.model_validate(w['scenario']))
    assert out['output']['result']['summary']==baseline['summary']
    record=client.get(f"/api/runtime/{w['id']}/tasks/{r.json()['task_id']}").json()
    assert record['status']=='succeeded'
    assert record['input_snapshot']['scenario']==w['scenario']
    assert len(r.json()['input_sha256'])==64
    assert out['output']['result']['design_basis'] is None


def test_idempotent_replay_does_not_compute_twice(client):
    w=project(client);key=str(uuid4());r1=invoke(client,w,'analysis.buried',rid=key);r2=invoke(client,w,'analysis.buried',rid=key)
    assert r1.status_code==r2.status_code==200 and r1.json()==r2.json()
    assert len(client.get(f"/api/workspaces/{w['id']}").json()['runs'])==1
    assert invoke(client,w,'project.inspect',rid=key).status_code==409


def test_repeated_failed_task_stays_failed(client):
    w=project(client);key=str(uuid4());args={'changes':[{'path':'cable.max_temperature_c','value':100}]}
    r1=invoke(client,w,'parameters.propose',args,key);r2=invoke(client,w,'parameters.propose',args,key)
    assert r1.status_code==r2.status_code==422 and r1.json()==r2.json()
    assert client.get(f"/api/runtime/{w['id']}/tasks/{key}").json()['status']=='failed'


def test_parallel_repeated_request_only_one_run(client):
    w=project(client);key=str(uuid4())
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses=list(pool.map(lambda _:invoke(client,w,'analysis.buried',rid=key),range(2)))
    assert all(r.status_code in (200,409) for r in responses)
    assert any(r.status_code==200 for r in responses)
    assert len(client.get(f"/api/workspaces/{w['id']}").json()['runs'])==1


def test_same_identifier_scoped_by_project(client):
    a,b=project(client),project(client);key=str(uuid4())
    assert result(invoke(client,a,'project.inspect',rid=key))['id']==a['id']
    assert result(invoke(client,b,'project.inspect',rid=key))['id']==b['id']
    assert client.get(f"/api/runtime/{a['id']}/tasks/{uuid4()}").status_code==404


def test_obsolete_revision_cannot_start(client):
    w=project(client)
    client.post(f"/api/workspaces/{w['id']}/edit",json={'expected_revision':1,'changes':[{'path':'cable.area_mm2','value':400}]})
    assert invoke(client,w,'analysis.buried').status_code==409


def test_generated_geometry_matches_cable_and_needs_approval(client):
    w=project(client);c={**w['scenario']['cable'],'area_mm2':400,'insulation_mm':6.0}
    p=result(invoke(client,w,'model.generate',{'cable':c}))
    assert p['action']=='import' and len(p['changes'])==2
    assert len(p['geometry']['layers'])==6
    radii=Scenario.model_validate(p['scenario']).cable.radii_mm()
    assert p['geometry']['diameter_mm']==2*radii[-1]
    for i,l in enumerate(p['geometry']['layers']):
        assert l['outer_radius_mm']==radii[i]
        assert l['geometric_area_mm2']>0
        if i:assert l['inner_radius_mm']==radii[i-1]
    assert client.get(f"/api/workspaces/{w['id']}").json()['revision']==1
    r=approval(client,w,p).json();assert r['workspace']['scenario']['cable']['area_mm2']==400
    assert r['output'] is None # geometry generation does not launch an unrelated solver.


def test_generator_retained_manufacturer_resistance_requires_ack(client):
    w=project(client);w=client.post(f"/api/workspaces/{w['id']}/edit",json={'expected_revision':1,'changes':[{'path':'cable.r20_ohm_km','value':.0754}]}).json()
    c={**w['scenario']['cable'],'area_mm2':400}
    assert invoke(client,w,'model.generate',{'cable':c}).status_code==422
    assert invoke(client,w,'model.generate',{'cable':{**c,'r20_ohm_km':None}}).status_code==200
    assert invoke(client,w,'model.generate',{'cable':c,'acknowledge_retained_r20':True}).status_code==200


def test_generated_model_cannot_change_locked_limit(client):
    w=project(client);c={**w['scenario']['cable'],'max_temperature_c':100}
    assert invoke(client,w,'model.generate',{'cable':c}).status_code==422


def test_design_basis_approved_only_records_reference_not_material_changes(client):
    w=project(client);old=w['scenario']
    w=set_basis(client,w,reference_ids=['iec60228','iec60502-2','gb12706-2'])
    assert w['scenario']==old and w['revision']==2
    assert w['design_basis']['reference_ids']==['iec60228','iec60502-2','gb12706-2']
    r=result(invoke(client,w,'analysis.buried'))
    assert r['output']['result']['design_basis']==w['design_basis']
    old_result=calculate(Scenario.model_validate(old))
    assert r['output']['result']['summary']==old_result['summary']
    undone=client.post(f"/api/workspaces/{w['id']}/history/undo",json={'expected_revision':2}).json()
    assert undone.get('design_basis') is None

@pytest.mark.parametrize('settings',[{'reference_ids':['unknown']},{'reference_ids':['iec60228','iec60228']},{'highest_voltage_kv':10,'rated_voltage_kv':20},{'environment':'duct'},{'environment':'shaft_bundle'},{'reference_ids':['iec60364-5-52']},{'reference_ids':['iec60853-2']},{'reference_ids':['iec60502-2'],'rated_voltage_kv':35,'highest_voltage_kv':40.5}])
def test_unsupported_standards_or_domains_cannot_be_approved(client,settings):
    w=project(client);assert invoke(client,w,'standards.propose',settings).status_code==422
    assert client.get(f"/api/workspaces/{w['id']}").json()['revision']==1


def test_scope_inspection_is_not_compliance_certificate(client):
    w=project(client);r=result(invoke(client,w,'standards.inspect',{'reference_ids':['iec60287-1-1','iec60228']}))
    assert r['can_record'] and r['compliance']=='not_assessed'
    assert any(f['code']=='CLAUSES_NOT_VERIFIED' for f in r['findings'])
    registry=client.get('/api/runtime/standards').json()
    assert not registry['normative_tables_included']
    assert len(registry['items'])==8
    assert '2026' in next(s for s in registry['items'] if s['id']=='iec60502-2')['designation']


def test_environment_guard_same_for_runtime_and_legacy_routes(client):
    w=set_basis(client,project(client),environment='vertical_air')
    assert invoke(client,w,'analysis.buried').status_code==422
    assert client.post(f"/api/workspaces/{w['id']}/calculate",json={'expected_revision':w['revision']}).status_code==422
    assert invoke(client,w,'analysis.fields',{'kind':'thermal_fd'}).status_code==422
    assert invoke(client,w,'selection.evaluate',{'target_current_a':300}).status_code==422
    assert invoke(client,w,'analysis.fields',{'kind':'electric'}).status_code==200
    v=Vertical(cells=10).model_dump()
    r=result(invoke(client,w,'analysis.vertical',{'configuration':v,'compare_mesh':False}))
    assert r['domain']=='vertical_air' and r['ampacity_a']>0
    assert r['design_basis']==w['design_basis']


def test_modified_voltage_invalidates_previous_basis(client):
    w=set_basis(client,project(client),rated_voltage_kv=20,highest_voltage_kv=24)
    w=client.post(f"/api/workspaces/{w['id']}/edit",json={'expected_revision':2,'changes':[{'path':'cable.u0_kv','value':26}]}).json()
    assert invoke(client,w,'analysis.buried').status_code==422


def test_runtime_selection_enumerates_actual_model(client):
    w=project(client);r=result(invoke(client,w,'selection.evaluate',{'target_current_a':300,'include_demo':True,'reserve_percent':10}))
    assert len(r['candidates'])==12 and r['feasible_count']>0
    for candidate in r['candidates']:
        if candidate['feasible']:assert candidate['ampacity_a']>=330
    assert client.get(f"/api/workspaces/{w['id']}").json()['scenario']==w['scenario']


def test_task_plan_then_approval_uses_actual_parameters(client):
    w=project(client);p=result(invoke(client,w,'task.plan',{'message':'截面积改为 400 mm²，重新计算'}))
    assert p['ready'] and p['scenario']['cable']['area_mm2']==400
    r=approval(client,w,p);assert r.status_code==200
    assert r.json()['output']['result']['input']['cable']['area_mm2']==400


def test_read_only_inspection_and_search_dont_mutate(client):
    w=project(client)
    assert result(invoke(client,w,'project.inspect'))['id']==w['id']
    assert result(invoke(client,w,'documents.search',{'query':'不存在的资料'}))['hits']==[]
    assert client.get(f"/api/workspaces/{w['id']}").json()['revision']==1


def test_provenance_preserves_original_quote_and_historical_status(client):
    w=project(client);p=client.post(f"/api/workspaces/{w['id']}/evidence",json={'expected_revision':1,'title':'参数节选','text':'截面积 300 mm²','page':7}).json()
    w=approval(client,w,p).json()['workspace'];invoke(client,w,'project.inspect')
    trace=client.get(f"/api/runtime/{w['id']}/provenance").json()
    assert any(e.get('quote')=='截面积 300 mm²' and e['page']==7 and e['relation']=='当前数值引用' for e in trace['edges'])
    w=client.post(f"/api/workspaces/{w['id']}/edit",json={'expected_revision':w['revision'],'changes':[{'path':'cable.area_mm2','value':400}]}).json()
    trace=client.get(f"/api/runtime/{w['id']}/provenance").json()
    assert any(e.get('quote')=='截面积 300 mm²' and e['relation']=='历史数值引用' for e in trace['edges'])


def test_runtime_records_survive_restart(tmp_path):
    path=tmp_path/'restart.sqlite';key=str(uuid4())
    with TestClient(create_app(path)) as c:
        w=project(c);r=invoke(c,w,'analysis.buried',rid=key).json()
    with TestClient(create_app(path)) as c:
        assert invoke(c,w,'analysis.buried',rid=key).json()==r
        assert len(c.get(f"/api/runtime/{w['id']}/provenance").json()['tasks'])==1


def test_report_uses_original_basis_and_escapes_project_note(client):
    w=set_basis(client,project(client),reference_ids=['iec60228'],note='<script>alert(1)</script>')
    first=result(invoke(client,w,'analysis.buried'))
    rid=first['output']['run_id']
    w=set_basis(client,w,reference_ids=['gb3956'],note='later basis')
    report=result(invoke(client,w,'reports.render',{'run_id':rid}))
    assert 'iec60228' in report['html'] and 'gb3956' not in report['html']
    assert '&lt;script&gt;' in report['html'] and '<script>alert(1)</script>' not in report['html']
    assert report['source_revision']==2
    other=project(client)
    assert invoke(client,other,'reports.render',{'run_id':rid}).status_code==404
