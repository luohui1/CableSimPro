"""Native integration gate. Requires optional deps; no skip or mocked solver.

Outside the existing testpaths. The dedicated native CI explicitly runs this file.
"""
import json
import math
from pathlib import Path
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from backend.main import create_app



def prepare(c,w,p):
    plan=c.post('/api/plugins/install-plan',json={'plugin_id':p,'version':'0.1.0'}).json()
    approval={k:plan[k] for k in ('plugin_id','version','state_revision','plan_sha256')}|{'approved':True,'license_acknowledged':True,'grants':{i['plugin_id']:i['permissions'] for i in plan['plugins']}}
    r=c.post('/api/plugins/install',json=approval);assert r.status_code==200,r.text
    lock=c.get(f'/api/plugins/workspaces/{w["id"]}/lock').json()
    r=c.post(f'/api/plugins/workspaces/{w["id"]}/enable',json={'plugin_id':p,'expected_revision':w['revision'],'lock_revision':lock['lock']['lock_revision'],'enabled':True,'approved':True});assert r.status_code==200,r.text

def run(c,w,p,command,args={}):
    lock=c.get(f'/api/plugins/workspaces/{w["id"]}/lock').json()
    response=c.post(f'/api/plugins/workspaces/{w["id"]}/invoke',json={'plugin_id':p,'command':command,'request_id':str(uuid4()),'expected_revision':w['revision'],'lock_sha256':lock['lock_sha256'],'arguments':args,'confirmed':True})
    assert response.status_code==200,response.text
    assert response.json()['status']=='succeeded',response.text
    return response.json()

def download(c,w,out,name):return c.get(f'/api/plugins/workspaces/{w["id"]}/jobs/{out["job_id"]}/artifacts/{name}')


def test_cadquery_real_brep_step_roundtrip(tmp_path):
    import cadquery as cq
    with TestClient(create_app(tmp_path/'cad.sqlite')) as c:
        w=c.post('/api/workspaces',json={}).json();prepare(c,w,'cablesim.cadquery')
        out=run(c,w,'cablesim.cadquery','cadquery.cable-step',{'preview_length_m':.25})
        r=download(c,w,out,'cable.step');assert r.status_code==200 and b'ISO-10303-21' in r.content
        path=tmp_path/'roundtrip.step';path.write_bytes(r.content)
        shape=cq.importers.importStep(str(path));assert len(shape.solids().vals())==6
        assert all(s.isValid() for s in shape.solids().vals())
        assert out['result']['summary']['solid_count']==6
        other=c.post('/api/workspaces',json={}).json()
        assert download(c,other,out,'cable.step').status_code==404


def test_gmsh_skfem_meshio_pyvista_chain_and_refinement(tmp_path):
    with TestClient(create_app(tmp_path/'fem.sqlite')) as c:
        w=c.post('/api/workspaces',json={}).json();prepare(c,w,'cablesim.pyvista')
        baseline=c.get(f'/api/workspaces/{w["id"]}').json();errors=[];sizes=[]
        for resolution in [16,24,32]:
            mesh=run(c,w,'cablesim.gmsh','gmsh.cable-section',{'resolution':resolution})
            converted=run(c,w,'cablesim.meshio','meshio.to-vtu',{'source_job_id':mesh['job_id']})
            assert download(c,w,converted,'section.vtu').status_code==200
            thermal=run(c,w,'cablesim.thermal2d','skfem.radial-thermal',{'source_job_id':mesh['job_id'],'heat_w_m':20,'surface_temperature_c':30,'conductor_k_w_m_k':380,'metal_screen_k_w_m_k':380})
            s=thermal['result']['summary'];errors.append(s['analytic_temperature_rise_relative_error']);sizes.append(s['elements'])
            assert s['ampacity_a'] is None and s['energy_relative_residual']<1e-6
            assert s['maximum_temperature_c']>30 and errors[-1]<.03
            assert len(json.loads(download(c,w,mesh,'mesh.json').content)['domains'])==6
        assert sizes[0]<sizes[1]<sizes[2]
        assert errors[-1]<errors[0] and errors[-1]<.01
        post=run(c,w,'cablesim.pyvista','pyvista.field-summary',{'source_job_id':thermal['job_id']})
        assert post['result']['summary']['temperature_max_c']==s['maximum_temperature_c']
        assert download(c,w,post,'isotherm.vtp').status_code==200
        assert c.get(f'/api/workspaces/{w["id"]}').json()==baseline
        evidence={'fixture':'explicit 20 W/m; surface 30 C; metals 380 W/(m K)','elements':sizes,'relative_temperature_rise_errors':errors,'last_summary':s}
        output=Path('artifacts');output.mkdir(exist_ok=True);(output/'native-thermal-validation.json').write_text(json.dumps(evidence,indent=2))
        # Stale and tampered upstream data are rejected, not silently consumed.
        changed=c.post(f'/api/workspaces/{w["id"]}/edit',json={'expected_revision':1,'changes':[{'path':'cable.area_mm2','value':300}],'label':'test new geometry'});assert changed.status_code==200
        fresh=changed.json();lock=c.get(f'/api/plugins/workspaces/{w["id"]}/lock').json()
        r=c.post(f'/api/plugins/workspaces/{w["id"]}/invoke',json={'plugin_id':'cablesim.meshio','command':'meshio.to-vtu','request_id':str(uuid4()),'expected_revision':fresh['revision'],'lock_sha256':lock['lock_sha256'],'arguments':{'source_job_id':mesh['job_id']},'confirmed':True})
        assert r.status_code==409 and r.json()['detail']['code']=='STALE_SOURCE'
        path=c.app.state.plugins.directory/w['id']/mesh['job_id']/'mesh.json';path.write_text('{}')
        assert download(c,w,mesh,'mesh.json').status_code==409
