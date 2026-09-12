"""Real Gmsh/scikit-fem tests; explicitly run with the optional native environment.

Not collected by ordinary host testpaths. No missing-dependency skip, mocked PDE,
current-to-loss assumptions, or manufactured certification claims.
"""
import json
from pathlib import Path
import numpy as np
import pytest
from backend.schemas import Scenario
from backend.foundation.contracts import CircularLayer, CircularRecipe
from backend.plugins.buried import buried_mesh, solve_buried, assemble_conduction
from backend.plugins.buried_contract import validate_buried_projection


def recipe(scenario):
    radii = scenario.cable.radii_mm()
    roles = ('conductor', 'conductor_screen', 'insulation', 'insulation_screen', 'metallic_screen', 'jacket')
    return CircularRecipe(length_m=.25, layers=tuple(
        CircularLayer(uid=f'cable/{role}', role=role, inner_radius_m=0 if i == 0 else radii[i-1]/1000,
                      outer_radius_m=radii[i]/1000) for i, role in enumerate(roles))).model_dump(mode='json')


def arguments(**changes):
    return dict(conductor_powers_w_m=[20, 20, 20], conductor_k_w_m_k=380,
                metal_screen_k_w_m_k=380, domain_scale=8, resolution=16) | changes


@pytest.fixture(scope='module')
def domain(tmp_path_factory):
    import os
    scenario = Scenario()
    directory = tmp_path_factory.mktemp('buried')
    before = Path.cwd()
    try:
        os.chdir(directory)
        mesh = buried_mesh(recipe(scenario), scenario.model_dump(mode='json'), arguments())
    finally:
        os.chdir(before)
    return scenario.model_dump(mode='json'), mesh


def test_real_buried_energy_phase_symmetry_and_boundary(domain):
    scenario, mesh = domain
    field, summary = solve_buried(mesh, scenario, arguments())
    validate_buried_projection(field, summary)
    assert summary['ampacity_a'] is None
    assert set(field['domain_ids']) == set(range(1, 20))
    assert summary['energy_relative_residual'] < 1e-6
    assert summary['boundary_heat_w_m'] == pytest.approx(60, abs=6e-5)
    a, b, c = summary['conductor_max_temperatures_c']
    assert b > a > summary['ambient_temperature_c']
    # Unstructured Gmsh meshes are not exactly left-right symmetric.
    assert a == pytest.approx(c, abs=.01)
    assert min(field['values']) == pytest.approx(298.15, abs=1e-7)


def test_zero_heat_and_linear_superposition(domain):
    scenario, mesh = domain
    args = arguments(); args['conductor_powers_w_m'] = [0, 0, 0]
    field, summary = solve_buried(mesh, scenario, args)
    assert field['values'] == pytest.approx([298.15]*len(field['points']), abs=1e-10)
    assert summary['energy_relative_residual'] is None
    a, _ = solve_buried(mesh, scenario, arguments())
    args['conductor_powers_w_m'] = [40, 40, 40]
    changed = json.loads(json.dumps(scenario)); changed['installation']['ambient_temperature_c'] = 35
    b, _ = solve_buried(mesh, changed, args)
    assert np.asarray(b['values'])-308.15 == pytest.approx(2*(np.asarray(a['values'])-298.15), abs=1e-7)


def test_shared_assembly_manufactured_solution_converges():
    from skfem import MeshTri, LinearForm, Functional, asm, solve, condense
    errors = []
    for n in (9, 17, 33):
        mesh = MeshTri.init_tensor(np.linspace(0, 1, n), np.linspace(0, 1, n))
        data = {'points': np.column_stack((mesh.p.T, np.zeros(mesh.nvertices))),
                'triangles': mesh.t.T, 'domain_ids': [1]*mesh.nelements,
                'boundary_nodes': mesh.boundary_nodes()}
        basis, matrix = assemble_conduction(data, {1: 3.0})
        @LinearForm
        def source(v, w):
            return 6*np.pi**2*np.sin(np.pi*w.x[0])*np.sin(np.pi*w.x[1])*v
        numerical = solve(*condense(matrix, asm(source, basis), D=mesh.boundary_nodes()))
        @Functional
        def l2(w):
            return (w.uh-np.sin(np.pi*w.x[0])*np.sin(np.pi*w.x[1]))**2
        errors.append(float(np.sqrt(asm(l2, basis, uh=basis.interpolate(numerical)))))
    assert errors[1] < errors[0]/3 and errors[2] < errors[1]/3
    assert errors[-1] < .002


def test_buried_mesh_and_far_boundary_sensitivity(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    s = Scenario(); rows = []
    configurations = [(4, 16), (8, 16), (16, 16), (8, 24), (8, 32)]
    for scale, resolution in configurations:
        args = arguments(); args.update(domain_scale=scale, resolution=resolution)
        mesh = buried_mesh(recipe(s), s.model_dump(mode='json'), args)
        field, summary = solve_buried(mesh, s.model_dump(mode='json'), args)
        rows.append(summary)
    # Expanding a zero-rise box should remove artificial cooling. Mesh changes can
    # perturb monotonicity at the last digits, so check useful sensitivity bounds.
    assert rows[2]['maximum_temperature_c'] > rows[0]['maximum_temperature_c']
    increment_1 = rows[1]['maximum_temperature_c']-rows[0]['maximum_temperature_c']
    increment_2 = rows[2]['maximum_temperature_c']-rows[1]['maximum_temperature_c']
    assert 0 < increment_2 < increment_1/2  # Diminishing truncation effect, not a 0.2 K accuracy claim.
    assert rows[1]['elements'] < rows[3]['elements'] < rows[4]['elements']
    assert abs(rows[4]['maximum_temperature_c']-rows[1]['maximum_temperature_c']) < .05
    output = Path(__file__).resolve().parents[1]/'artifacts'; output.mkdir(exist_ok=True)
    (output/'buried-sensitivity.json').write_text(json.dumps({'scope': 'explicit 20 W/m per phase, finite homogeneous soil',
        'independence_certified': False, 'runs': rows}, indent=2), encoding='utf-8')


def test_real_buried_plugin_api_preserves_project_and_vtu(tmp_path):
    import meshio
    from fastapi.testclient import TestClient
    from backend.main import create_app
    from uuid import uuid4
    with TestClient(create_app(tmp_path/'buried.sqlite')) as c:
        w = c.post('/api/workspaces', json={}).json()
        baseline = c.get(f'/api/workspaces/{w["id"]}').json()
        p = c.post('/api/plugins/install-plan', json={'plugin_id': 'cablesim.buried-reference', 'version': '0.1.0'}).json()
        r = c.post('/api/plugins/install', json={k: p[k] for k in ('plugin_id', 'version', 'plan_sha256', 'state_revision')} |
                   {'approved': True, 'license_acknowledged': True, 'grants': {i['plugin_id']: i['permissions'] for i in p['plugins']}})
        assert r.status_code == 200, r.text
        lock = c.get(f'/api/plugins/workspaces/{w["id"]}/lock').json()
        r = c.post(f'/api/plugins/workspaces/{w["id"]}/enable', json={'plugin_id': 'cablesim.buried-reference',
                    'expected_revision': w['revision'], 'lock_revision': lock['lock']['lock_revision'], 'enabled': True, 'approved': True})
        assert r.status_code == 200, r.text
        body = {'plugin_id': 'cablesim.buried-reference', 'command': 'skfem.buried-reference', 'request_id': str(uuid4()),
                'expected_revision': w['revision'], 'lock_sha256': r.json()['lock_sha256'], 'arguments': arguments(), 'confirmed': True}
        r = c.post(f'/api/plugins/workspaces/{w["id"]}/invoke', json=body)
        assert r.status_code == 200, r.text
        job = r.json(); assert job['status'] == 'succeeded'
        root = f'/api/plugins/workspaces/{w["id"]}/jobs/{job["job_id"]}/artifacts'
        field = c.get(root+'/field.json').json(); validate_buried_projection(field, job['result']['summary'])
        path = tmp_path/'temperature.vtu'; path.write_bytes(c.get(root+'/temperature.vtu').content)
        loaded = meshio.read(path)
        assert loaded.point_data['temperature_c']+273.15 == pytest.approx(field['values'], abs=1e-9)
        assert c.get(f'/api/workspaces/{w["id"]}').json() == baseline
        assert job['promoted_to_current_ampacity'] is False
        assert c.post(f'/api/plugins/workspaces/{w["id"]}/invoke', json=body).json()['replayed'] is True
        # Public proposal/approval flow on a generated test project, not user data.
        proposed = c.post(f'/api/runtime/{w["id"]}/invoke', json={'capability':'standards.propose',
            'request_id':str(uuid4()),'expected_revision':1,'arguments':{'environment':'vertical_air'}})
        assert proposed.status_code == 200, proposed.text
        proposal = proposed.json()['result']
        approved = c.post(f'/api/workspaces/{w["id"]}/proposals/{proposal["id"]}/approve',json={'expected_revision':1})
        assert approved.status_code == 200, approved.text
        new_lock = c.get(f'/api/plugins/workspaces/{w["id"]}/lock').json()
        body.update(request_id=str(uuid4()),expected_revision=2,lock_sha256=new_lock['lock_sha256'])
        rejected = c.post(f'/api/plugins/workspaces/{w["id"]}/invoke',json=body)
        assert rejected.status_code == 409 and rejected.json()['detail']['code'] == 'METHOD_SCOPE'


def test_trefoil_with_independent_phase_powers(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    s=Scenario();s.installation.arrangement='trefoil'
    args=arguments(conductor_powers_w_m=[10,20,30])
    mesh=buried_mesh(recipe(s),s.model_dump(mode='json'),args)
    field,summary=solve_buried(mesh,s.model_dump(mode='json'),args)
    assert field['cable_centers_m']==s.installation.positions_m()
    a,b,c=summary['conductor_max_temperatures_c']
    assert c>b>a>s.installation.ambient_temperature_c
    assert summary['source_heat_w_m']==60 and summary['energy_relative_residual']<1e-6
    s.operating_current_a=2000
    other,_=solve_buried(mesh,s.model_dump(mode='json'),args)
    assert other['values']==field['values']  # Explicit powers, not an undeclared electrical solve.
