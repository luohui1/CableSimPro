"""Algebra tests locally; native FEM benchmark only on dg83."""
import os
import sys
from pathlib import Path
import numpy as np
import pytest

ROOT=Path(__file__).resolve().parents[3]
sys.path[:0]=[str(ROOT/'plugins/cablesim.simulation/src')]
from cablesim_simulation.far_boundary import image_rise, loss_sources, ThermalParameters, default_boundary_reason


def test_default_far_field_scope_and_explicit_saved_boundary():
    section=dict(kind='ground',soil_layers=[],backfill=None,medium=dict(surface_temperature=293.15))
    assert default_boundary_reason(section,dict(kind='steady')) is None
    assert ThermalParameters.model_fields['outer_boundary'].default=='kennelly_image'
    assert ThermalParameters.model_fields['outer_boundary'].annotation is not None
    assert default_boundary_reason({**section,'soil_layers':[{}]},dict(kind='steady'))
    assert default_boundary_reason({**section,'backfill':{}},dict(kind='steady')) is None
    assert default_boundary_reason({**section,'backfill':{'material':'x'}},dict(kind='steady'))
    assert default_boundary_reason(section,dict(kind='transient'))
    assert default_boundary_reason({**section,'medium':dict(surface_temperature=None)},dict(kind='steady'))


def test_default_rejects_unsupported_scope_before_any_native_work():
    sys.path[:0]=[str(ROOT/'plugin-tests')]
    from test_three_core_thermal import case
    from cablesim_simulation.three_core_thermal import prepare
    d,p=case();p.pop('outer_boundary',None)
    prepared=prepare(d,p)
    assert prepared[0].outer_boundary=='kennelly_image'
    assert prepare(d,{**p,'outer_boundary':'ambient_truncated'})[0].outer_boundary=='ambient_truncated'
    from copy import deepcopy
    layered=deepcopy(d);layered['sections'][0]['soil_layers']=[dict(id='region/layer',label='验证土层',material=layered['sections'][0]['medium']['material'],top_z=0.,bottom_z=-10.)]
    with pytest.raises(ValueError,match='显式选择'):prepare(layered,p)


def test_saved_comparison_reads_actual_boundary_and_preserves_legacy_snapshot():
    sys.path.insert(0,str(ROOT/'tests'))
    from test_hpc_convergence import saved_fixture
    from backend.kernel.batch_field_chapter import compare
    from copy import deepcopy
    run,iec=saved_fixture();original=deepcopy(run)
    assert compare(run,iec)['outer_boundary']=='ambient_truncated'
    assert run==original
    run['output']['cases'][0]['artifacts']['x-cablesim.simulation-bundle']={'result':{'outer_boundary':{'kind':'kennelly_image'}}}
    assert compare(run,iec)['outer_boundary']=='kennelly_image'
    run['snapshot']['cases'][0]['parameters']['outer_boundary']='ambient_truncated'
    assert compare(run,iec)['outer_boundary']=='kennelly_image'


def test_image_green_function_ground_and_superposition():
    sources=[{'center_m':[0.,-1.],'loss_w_m':10.}]
    assert image_rise(np.array([[0.,2.],[0.,0.]]),sources,1.).tolist()==[0.,0.]
    assert image_rise(np.array([[0.],[-2.]]),sources,1.)[0]==pytest.approx(10/(2*np.pi)*np.log(3))
    assert image_rise(np.array([[0.],[-2.]]),sources*2,1.)[0]==pytest.approx(20/(2*np.pi)*np.log(3))
    with pytest.raises(ValueError):image_rise(np.array([[0.],[-1.]]),sources,1.)


def test_actual_loss_sources_conserve_all_components():
    state=dict(conductor_joule_heat_w_m=30.,screen_heat_w_m=3.,dielectric_heat_w_m=6.,armour_heat_w_m=4.)
    binding=dict(entity='cable',centers=[[0.,-1.],[.1,-1.],[-.1,-1.]],center_m=[0.,-1.])
    assert sum(s['loss_w_m'] for s in loss_sources([state],[binding]))==43.


def test_convergence_cannot_mix_truncated_and_far_field_runs():
    from backend.kernel.batch_convergence import verdict,RefineRequest
    rows=[dict(kind='mesh',mesh_size_m=.004/2**i,bounds_m=[-8.,-8.,8.,0.],hotspot_k=380.+i*.01,
               outer_boundary='kennelly_image') for i in range(3)]
    rows.extend(dict(kind='domain',mesh_size_m=.001,bounds_m=[-size,-size,size,0.],hotspot_k=380.03+i*.01,
                     outer_boundary='kennelly_image') for i,size in enumerate((16.,32.,64.)))
    assert verdict(rows,.1)['status']=='converged'
    rows[0].pop('outer_boundary')
    assert verdict(rows,.1)['status']=='unconverged'
    with pytest.raises(ValueError):RefineRequest.model_validate(dict(request_id='00000000-0000-4000-8000-000000000001',
        source_run_id='00000000-0000-4000-8000-000000000002',minimum_domain_levels=1))


def test_progress_atomic_replace_survives_windows_reader_collision(tmp_path,monkeypatch):
    from backend.kernel import batch_files
    target=tmp_path/'execution.json';batch_files.atomic(target,{'job_id':'42','state':'running'})
    original=batch_files.os.replace;attempts=[]
    def collision(source,destination):
        attempts.append(1)
        if len(attempts)<3:
            assert batch_files.read(target)['state']=='running'
            error=PermissionError('Windows reader holds DELETE sharing');error.winerror=5;raise error
        return original(source,destination)
    monkeypatch.setattr(batch_files.os,'replace',collision)
    batch_files.atomic(target,{'job_id':'42','state':'succeeded'})
    assert len(attempts)==3 and batch_files.read(target)['state']=='succeeded'
    assert not list(tmp_path.glob('*.part'))


def test_selecting_saved_domain_cannot_relax_convergence():
    from backend.kernel.batch_convergence import verified_domain_prefix
    rows=[dict(kind='mesh',mesh_size_m=.004/2**i,bounds_m=[-8.,-8.,8.,0.],hotspot_k=380.+i*.01,
               outer_boundary='kennelly_image') for i in range(3)]
    rows.extend(dict(kind='domain',mesh_size_m=.001,bounds_m=[-size,-size,size,0.],hotspot_k=380.03+i*.01,
                     outer_boundary='kennelly_image') for i,size in enumerate((16.,32.,64.)))
    assert len(verified_domain_prefix(rows,2,.1))==5
    assert len(rows)==6
    rows[4]['hotspot_k']+=.1
    with pytest.raises(ValueError):verified_domain_prefix(rows,2,.1)


def test_terminal_failure_keeps_recoverable_host_io_distinct():
    from backend.kernel.batch_convergence import failure_state
    assert failure_state(['FAILED'],False)=='failed'
    assert failure_state(['TIMEOUT'],False,True)=='failed'
    assert failure_state(['COMPLETED'],False,True)=='interrupted'
    assert failure_state(['RUNNING'],False)=='interrupted'
    assert failure_state(['COMPLETED'],True)=='cancelled'


@pytest.mark.skipif(not os.environ.get('SLURM_JOB_ID'),reason='native FEM requires Slurm dg83')
def test_iteration_far_boundary_and_same_mesh_reuse():
    from copy import deepcopy
    sys.path[:0]=[str(ROOT/'plugin-tests'),str(ROOT/'plugins/cablesim.iec60287/tests'),str(ROOT/'plugins/cablesim.iec60287/src')]
    from test_three_core_thermal import case
    from cablesim_simulation.three_core_thermal import prepare,solve
    d,p=case();p['outer_boundary']='kennelly_image';p['mesh']['field_order']=2
    prepared=prepare(d,p);cache={}
    first,_,_,_=solve(prepared,_cache=cache)
    modified=deepcopy(prepared);modified[2].cables[0]['current']=200.
    reused,_,_,_=solve(modified,_cache=cache,_export_field=False)
    independent,_,_,_=solve(modified)
    assert reused['cables'][0]['conductor_max_temperature_k']==pytest.approx(independent['cables'][0]['conductor_max_temperature_k'],abs=1e-6)
    assert sum(s['loss_w_m'] for s in reused['outer_boundary']['sources'])==pytest.approx(reused['source_heat_w_m'])
    assert reused['outer_boundary']['feedback_residual_k']<p.get('tolerance_k',1e-5)
    assert reused['source_heat_w_m']<first['source_heat_w_m']


@pytest.mark.skipif(not os.environ.get('SLURM_JOB_ID'),reason='native FEM requires Slurm dg83')
def test_single_uniform_cable_against_kennelly_disk_solution():
    """Uniform heated disk (same k as soil), q=20 W/m, rho=1 K m/W.

    At its centre the exact half-space solution is
    q*rho/(2*pi)*(ln(2*h/r)+1/2). The half term is the internal
    uniform-generation contribution; outside the disk it is exactly Kennelly.
    A circular uniform source has the same exterior logarithmic potential as
    a line source at its centre (mean-value property). No fitted reference.
    """
    from skfem import MeshTri,Basis,ElementTriP2,BilinearForm,LinearForm,asm
    from skfem.helpers import dot,grad
    from scipy.sparse.linalg import spsolve
    from cablesim_sdk.simulation import Problem,MeshControls
    from cablesim_simulation.problem_mesh import build
    answers=[];q=20.;rho=1.;radius=.1;depth=1.
    exact=q*rho/(2*np.pi)*(np.log(2*depth/radius)+.5)
    for size,segments in ((.025,64),(.0125,128),(.00625,256)):
        problem=Problem.model_validate(dict(schema_version='cablesim.simulation-problem/1',physics='steady_heat',
            geometry=[dict(uid='soil',kind='rectangle',values=[-2.,-2.,2.,0.],material=dict(k_w_m_k=1.,source='analytic validation')),
                      dict(uid='cable',kind='disk',values=[0.,-depth,radius],material=dict(k_w_m_k=1.,source='analytic validation'))],
            boundaries=[dict(uid='outer',selector='outer',values=[],kind='temperature',value=298.15)],
            excitations=[],provenance={'source':'manufactured uniform disk / Kennelly analytic half-space'},assumptions=[]))
        mesh=build(problem,MeshControls(size_m=size,far_size_m=.12,transition_m=.4,max_nodes=120000,field_order=2,minimum_circle_segments=segments))
        basis=Basis(MeshTri(np.asarray(mesh['points']).T,np.asarray(mesh['triangles']).T),ElementTriP2(),intorder=5)
        @BilinearForm
        def conduction(u,v,w):return dot(grad(u),grad(v))
        @LinearForm
        def heat(v,w):return w.q*v
        rid=next(r['id'] for r in mesh['regions'] if r['uid']=='cable')
        vector=asm(heat,basis,q=(np.asarray(mesh['domain_ids'])==rid)[:,None].astype(float))
        load=vector*q/vector.sum();matrix=asm(conduction,basis)
        D=basis.get_dofs().all();free=np.setdiff1d(np.arange(basis.N),D)
        rise=np.zeros(basis.N);rise[D]=image_rise(basis.doflocs[:,D],[{'center_m':[0.,-depth],'loss_w_m':q}],rho)
        rise[free]=spsolve(matrix[free][:,free],load[free]-matrix[free][:,D]@rise[D])
        center=float((basis.probes(np.array([[0.],[-depth]]))@rise)[0]);answers.append(center)
    errors=[abs(a-exact) for a in answers]
    mesh_error=abs(answers[-1]-answers[-2])
    print({'analytic_center_rise_k':exact,'fem_center_rises_k':answers,'errors_k':errors,'last_mesh_change_k':mesh_error})
    assert errors[-1]<errors[-2]<errors[0]
    assert errors[-1]<mesh_error and errors[-1]<.01
