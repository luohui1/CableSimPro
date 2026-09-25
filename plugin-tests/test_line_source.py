"""Real Gmsh/P1 source jobs compared against an independent half-space equation."""
from pathlib import Path
from uuid import uuid4
import json
import os
import pytest
from backend.schemas import Scenario
from backend.foundation.contracts import CircularLayer, CircularRecipe
from backend.plugins.buried import buried_mesh, solve_buried
from backend.plugins.line_source import compare_line_source
from backend.plugins.line_source_contract import validate_line_source


def recipe(s):
    radii=s.cable.radii_mm();roles=('conductor','conductor_screen','insulation','insulation_screen','metallic_screen','jacket')
    return CircularRecipe(length_m=.25,layers=tuple(CircularLayer(uid=f'cable/{role}',role=role,
        inner_radius_m=0 if i==0 else radii[i-1]/1000,outer_radius_m=radii[i]/1000) for i,role in enumerate(roles))).model_dump(mode='json')


def arguments(scale):
    return {'conductor_powers_w_m':[20.,20.,20.],'conductor_k_w_m_k':380.,'metal_screen_k_w_m_k':380.,'domain_scale':scale,'resolution':16}


def context(args,scale):
    return {'job_id':f'00000000-0000-0000-0000-0000000000{scale:02d}',
        'plugin':{'plugin_id':'cablesim.buried-reference','version':'0.1.0','release_sha256':'0'*64},
        'command':'skfem.buried-reference','arguments':args,'source_sha256':'1'*64,'project_revision':1}


def test_finite_box_solution_approaches_half_space_reference(tmp_path,monkeypatch):
    monkeypatch.chdir(tmp_path);s=Scenario();reports=[]
    for scale in (4,8,16):
        a=arguments(scale);mesh=buried_mesh(recipe(s),s,a);_,summary=solve_buried(mesh,s,a)
        report=compare_line_source(recipe(s),s,summary,context(a,scale));validate_line_source(report)
        reports.append(report)
    differences=[r.maximum_absolute_difference_k for r in reports]
    assert differences[2] < differences[1] < differences[0]
    assert differences[0] > 1 and differences[1] < .7 and differences[2] < .4
    # The half-space equation is unchanged by the artificial side/bottom box.
    for phase in range(3):
        values=[r.phases[phase].half_space_center_temperature_c for r in reports]
        assert values[0]==pytest.approx(values[1],abs=1e-12)==pytest.approx(values[2],abs=1e-12)
    output=Path(__file__).resolve().parents[1]/'artifacts';output.mkdir(exist_ok=True)
    (output/'line-source-domain-trend.json').write_text(json.dumps([r.model_dump(mode='json') for r in reports],indent=2),encoding='utf-8')


def test_real_plugin_chain_persists_an_independent_report_without_editing_project(tmp_path):
    from fastapi.testclient import TestClient
    from backend.main import create_app
    with TestClient(create_app(tmp_path/'crosscheck.sqlite')) as c:
        w=c.post('/api/workspaces',json={}).json();baseline=c.get(f'/api/workspaces/{w["id"]}').json()
        p=c.post('/api/plugins/install-plan',json={'plugin_id':'cablesim.line-source-crosscheck','version':'0.1.0'}).json()
        assert [x['plugin_id'] for x in p['plugins']]==['cablesim.buried-reference','cablesim.line-source-crosscheck']
        approval={k:p[k] for k in ('plugin_id','version','state_revision','plan_sha256')}|{'approved':True,'license_acknowledged':True,'grants':{x['plugin_id']:x['permissions'] for x in p['plugins']}}
        installed=c.post('/api/plugins/install',json=approval);assert installed.status_code==200,installed.text
        lock=c.get(f'/api/plugins/workspaces/{w["id"]}/lock').json()
        enabled=c.post(f'/api/plugins/workspaces/{w["id"]}/enable',json={'plugin_id':'cablesim.line-source-crosscheck','expected_revision':1,'lock_revision':lock['lock']['lock_revision'],'enabled':True,'approved':True})
        assert enabled.status_code==200,enabled.text
        lock=enabled.json()
        body={'plugin_id':'cablesim.line-source-crosscheck','command':'validation.line-source-buried','request_id':str(uuid4()),'expected_revision':1,'lock_sha256':lock['lock_sha256'],'arguments':{},'confirmed':True}
        missing=c.post(f'/api/plugins/workspaces/{w["id"]}/invoke',json=body)
        assert missing.status_code==409 and missing.json()['detail']['code']=='SOURCE_JOB'
        assert not any(j['command']=='validation.line-source-buried' for j in c.get(f'/api/plugins/workspaces/{w["id"]}/jobs').json()['items'])
        source_id=str(uuid4())
        source=c.post(f'/api/plugins/workspaces/{w["id"]}/invoke',json={'plugin_id':'cablesim.buried-reference','command':'skfem.buried-reference','request_id':source_id,'expected_revision':1,'lock_sha256':lock['lock_sha256'],'arguments':arguments(8),'confirmed':True})
        assert source.status_code==200,source.text
        body['request_id']=str(uuid4())
        checked=c.post(f'/api/plugins/workspaces/{w["id"]}/invoke',json=body);assert checked.status_code==200,checked.text
        out=checked.json();report=validate_line_source(out['result']['summary'])
        assert report.source_job_id==source_id and .4<report.maximum_absolute_difference_k<.7
        assert out['promoted_to_current_ampacity'] is False
        artifact=c.get(f'/api/plugins/workspaces/{w["id"]}/jobs/{out["job_id"]}/artifacts/line-source.json')
        assert artifact.status_code==200 and validate_line_source(artifact.json())==report
        assert c.get(f'/api/workspaces/{w["id"]}').json()==baseline
        other=c.post('/api/workspaces',json={}).json()
        assert c.get(f'/api/plugins/workspaces/{other["id"]}/jobs/{out["job_id"]}/artifacts/line-source.json').status_code==404
        changed=c.post(f'/api/workspaces/{w["id"]}/edit',json={'expected_revision':1,'changes':[{'path':'installation.spacing_m','value':.2}]})
        assert changed.status_code==200
        new_lock=c.get(f'/api/plugins/workspaces/{w["id"]}/lock').json()
        body.update(request_id=str(uuid4()),expected_revision=2,lock_sha256=new_lock['lock_sha256'])
        stale=c.post(f'/api/plugins/workspaces/{w["id"]}/invoke',json=body)
        assert stale.status_code==409 and stale.json()['detail']['code']=='STALE_SOURCE'
