"""Real v2 CAD/mesh/FEM/postprocessing chain under the Slurm native gate."""
import json
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from backend.main import create_app
from native_workflow import run, bundle, reference, download, create_study


def test_cadquery_real_brep_step_roundtrip(tmp_path):
    import cadquery as cq
    with TestClient(create_app(tmp_path/'cad.sqlite')) as c:
        w=c.post('/api/workspaces',json={}).json()
        result,_,_,_=run(c,w,'cable-step',{'preview_length_m':.25})
        response=download(c,w,result,'cable.step')
        assert response.status_code==200 and b'ISO-10303-21' in response.content
        path=tmp_path/'roundtrip.step';path.write_bytes(response.content)
        shape=cq.importers.importStep(str(path));assert len(shape.solids().vals())==6
        assert all(s.isValid() for s in shape.solids().vals())
        assert bundle(result)['summary']['solid_count']==6
        other=c.post('/api/workspaces',json={}).json()
        assert download(c,other,result,'cable.step').status_code==404


def test_gmsh_skfem_meshio_pyvista_chain_and_refinement(tmp_path):
    with TestClient(create_app(tmp_path/'fem.sqlite')) as c:
        w=c.post('/api/workspaces',json={}).json();errors=[];sizes=[]
        for resolution in [16,24,32]:
            mesh,_,_,_=run(c,w,'section-mesh',{'resolution':resolution})
            converted,_,_,_=run(c,w,'mesh-vtu',{'native_source_reference':reference(mesh)})
            assert download(c,w,converted,'section.vtu').status_code==200
            thermal,_,_,_=run(c,w,'radial-thermal',{'native_source_reference':reference(mesh),'heat_w_m':20,'surface_temperature_c':30,'conductor_k_w_m_k':380,'metal_screen_k_w_m_k':380})
            from backend.plugin_host.field_contract import validate_thermal_projection
            import meshio
            field=download(c,w,thermal,'field.json').json()
            s=bundle(thermal)['summary'];validate_thermal_projection(field,s)
            path=tmp_path/f'temperature-{resolution}.vtu';path.write_bytes(download(c,w,thermal,'temperature.vtu').content)
            vtk=meshio.read(path)
            assert field['values']==pytest.approx((vtk.point_data['temperature_c']+273.15).tolist(),abs=1e-9)
            errors.append(s['analytic_temperature_rise_relative_error']);sizes.append(s['elements'])
            assert s['ampacity_a'] is None and s['energy_relative_residual']<1e-6
            assert s['maximum_temperature_c']>30 and errors[-1]<.03
            assert len(json.loads(download(c,w,mesh,'mesh.json').content)['domains'])==6
        assert sizes[0]<sizes[1]<sizes[2]
        assert errors[-1]<errors[0] and errors[-1]<.01
        post,_,_,_=run(c,w,'field-summary',{'native_source_reference':reference(thermal)})
        assert bundle(post)['summary']['temperature_max_c']==s['maximum_temperature_c']
        assert download(c,w,post,'isotherm.vtp').status_code==200
        saved=c.get('/api/workspaces/'+w['id']).json()
        assert saved['revision']==w['revision'] and saved['scenario']==w['scenario']
        output=Path('artifacts');output.mkdir(exist_ok=True)
        (output/'native-thermal-validation.json').write_text(json.dumps({'fixture':'explicit 20 W/m; surface 30 C; metals 380 W/(m K)','elements':sizes,'relative_temperature_rise_errors':errors,'last_summary':s},indent=2))
        changed=c.post('/api/workspaces/'+w['id']+'/edit',json={'expected_revision':1,'changes':[{'path':'installation.depth_m','value':1.0}]}).json()
        study,root=create_study(c,changed,'mesh-vtu',{'native_source_reference':reference(mesh)})
        assert c.get(root+'/preflight',params={'expected_revision':changed['revision'],'expected_study_revision':study['revision']}).status_code==409
        with c.app.state.workspace_store.db(True) as db:
            db.execute('UPDATE study_runs SET output_digest=? WHERE id=?',('0'*64,mesh['id']))
        study,root=create_study(c,changed,'mesh-vtu',{'native_source_reference':reference(mesh)})
        assert c.get(root+'/preflight',params={'expected_revision':changed['revision'],'expected_study_revision':study['revision']}).status_code==409
        assert c.get('/api/workspaces/'+w['id']+'/studies/'+mesh['study']+'/runs/'+mesh['id']).json()['integrity']=='corrupt'
