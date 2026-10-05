"""Real Gmsh/P1 source jobs compared against an independent half-space equation."""
from pathlib import Path
from uuid import uuid4
import json
import os
import pytest
from backend.schemas import Scenario
from backend.foundation.contracts import CircularLayer, CircularRecipe
from cablesim_native.buried import buried_mesh, solve_buried
from cablesim_native.line_source import compare_line_source
from backend.plugin_host.line_source_contract import validate_line_source


def recipe(s):
    radii=s.cable.radii_mm();roles=('conductor','conductor_screen','insulation','insulation_screen','metallic_screen','jacket')
    return CircularRecipe(length_m=.25,layers=tuple(CircularLayer(uid=f'cable/{role}',role=role,
        inner_radius_m=0 if i==0 else radii[i-1]/1000,outer_radius_m=radii[i]/1000) for i,role in enumerate(roles))).model_dump(mode='json')


def arguments(scale):
    return {'conductor_powers_w_m':[20.,20.,20.],'conductor_k_w_m_k':380.,'metal_screen_k_w_m_k':380.,'domain_scale':scale,'resolution':16}


def context(args,scale):
    return {'job_id':f'00000000-0000-0000-0000-0000000000{scale:02d}',
        'plugin':{'plugin_id':'cablesim.buried-reference','version':'0.2.0','release_sha256':'0'*64},
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
    from native_workflow import run, bundle, reference, download, create_study
    with TestClient(create_app(tmp_path/'crosscheck.sqlite')) as c:
        w=c.post('/api/workspaces',json={}).json()
        source,_,_,_=run(c,w,'fixed-power',arguments(8))
        result,study,root,body=run(c,w,'line-source-crosscheck',{'native_source_reference':reference(source)})
        report=validate_line_source(bundle(result)['summary'])
        assert report.source_job_id==source['id'] and .4<report.maximum_absolute_difference_k<.7
        assert report.source_plugin_id=='cablesim.native-reference'
        assert validate_line_source(download(c,w,result,'line-source.json').json())==report
        assert c.post(root+'/runs',json=body).json()['id']==result['id']
        saved=c.get('/api/workspaces/'+w['id']).json()
        assert saved['revision']==w['revision'] and saved['scenario']==w['scenario']
        other=c.post('/api/workspaces',json={}).json()
        assert download(c,other,result,'line-source.json').status_code==404
        changed=c.post('/api/workspaces/'+w['id']+'/edit',json={'expected_revision':1,'changes':[{'path':'installation.spacing_m','value':.2}]}).json()
        assert c.post(root+'/runs',json=body).json()['id']==result['id']
        study,root=create_study(c,changed,'line-source-crosscheck',{'native_source_reference':reference(source)})
        stale=c.get(root+'/preflight',params={'expected_revision':changed['revision'],'expected_study_revision':study['revision']})
        assert stale.status_code==409
