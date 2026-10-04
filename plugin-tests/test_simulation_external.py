"""Real independent executable checks; skipped only when the solver is absent."""
from copy import deepcopy
import json
from pathlib import Path
import sys
import numpy as np
import pytest
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'plugins/cablesim.simulation/src'))
from cablesim_simulation.problem import validate
from cablesim_simulation.problem_mesh import build,from_thermal
from cablesim_simulation.solver_runtime import environment,EnvironmentMissing


def require(name,tmp_path):
    try:environment(name,tmp_path)
    except EnvironmentMissing as exc:pytest.skip(str(exc))


def fixture(name):
    return json.loads((ROOT/f'plugins/cablesim.simulation/src/cases/{name}.json').read_text('utf-8'))


def test_getdp_skin_impedance_matches_bessel_and_current_constraint(tmp_path):
    require('getdp',tmp_path)
    from scipy.special import iv
    from cablesim_simulation.getdp_adapter import solve
    d=fixture('eddy-cylinder');p,c=validate(d['input'],d['parameters']['mesh']);m=build(p,c)
    result=solve(p.model_dump(mode='json'),m,tmp_path/'cylinder')
    r=.01;sigma=58e6;gamma=np.sqrt(1j*2*np.pi*50*4*np.pi*1e-7*sigma)
    resistance=(gamma*iv(0,gamma*r)/(2*np.pi*r*sigma*iv(1,gamma*r))).real
    got=result['regions'][0]
    assert got['current_rms_a']==pytest.approx(1,abs=1e-10)
    assert got['ac_resistance_ohm_m']==pytest.approx(resistance,rel=.004)
    assert result['probes'][0]['b_current_integral_rms_t']==pytest.approx(2e-7/.03,rel=2e-4)
    assert result['execution']['returncode']==0


def test_getdp_passive_region_has_eddy_loss_but_no_net_current(tmp_path):
    require('getdp',tmp_path)
    from cablesim_simulation.getdp_adapter import solve
    d=fixture('eddy-induced');d['parameters']['mesh']['size_m']=.00025
    p,c=validate(d['input'],d['parameters']['mesh']);m=build(p,c)
    result=solve(p.model_dump(mode='json'),m,tmp_path/'passive')
    passive=next(r for r in result['regions'] if r['entity']=='passive')
    assert passive['current_rms_a']<1e-7
    assert passive['joule_loss_w_m']>1
    assert passive['ac_resistance_ohm_m'] is None
    for got,expected in zip(result['current_density_probes'],[3714e3,650e3,2321e3]):
        assert got['j_rms_a_m2']==pytest.approx(expected,rel=.02)


def test_getdp_quadratic_raw_field_and_impedance_match_cylinder(tmp_path):
    require('getdp',tmp_path)
    from scipy.special import iv
    from cablesim_simulation.getdp_adapter import solve
    d=fixture('eddy-cylinder');d['parameters']['mesh'].update(size_m=.0005,field_order=2,minimum_circle_segments=128,probe_cell_size_m=.001)
    p,c=validate(d['input'],d['parameters']['mesh']);mesh=build(p,c)
    result=solve(p.model_dump(mode='json'),mesh,tmp_path/'quadratic-cylinder')
    gamma=np.sqrt(1j*2*np.pi*50*4*np.pi*1e-7*58e6)
    exact=(gamma*iv(0,gamma*.01)/(2*np.pi*.01*58e6*iv(1,gamma*.01))).real
    assert result['regions'][0]['ac_resistance_ohm_m']==pytest.approx(exact,rel=.003)
    assert result['probes'][0]['b_rms_t']==pytest.approx(2e-7/.03,rel=.003)
    assert 'b_current_integral_rms_t' not in result['probes'][0]
    assert mesh['probe_cells'][0]['point_m']==[.03,0.]


def test_elmer_steady_matches_existing_solver_on_identical_mesh(tmp_path):
    require('elmer',tmp_path)
    from cablesim_simulation.elmer_adapter import solve
    from cablesim_simulation.thermal import ThermalSystem
    d=fixture('thermal-jorgens');d['parameters']['controls']['mesh_size_m']=.008
    d['parameters']['controls']['far_mesh_size_m']=.4
    p,m,model,cfg=from_thermal(d['input'],d['parameters'])
    result=solve(p,m,tmp_path/'steady')
    shared=(np.asarray(m['points']),np.asarray(m['triangles']),np.asarray(m['domain_ids']),[r['thermal_region'] for r in m['regions']])
    _,field=ThermalSystem(model,cfg,shared).solve()
    assert np.max(np.abs(np.asarray(field['temperature'])-result['snapshots'][0]['temperature_k']))<1e-7
    assert result['mesh_sha256']==m['sha256']


def slab_exact(x,t):
    n=np.arange(1,1000,2,dtype=float)
    terms=4*1e5*.02**2/(.2*np.pi**3*n**3)*np.sin(n*np.pi*x/.02)
    def step(s):return float(np.sum(terms*(1-np.exp(-.2/2e6*(n*np.pi/.02)**2*max(s,0))))) if s>0 else 0.
    return 293.15+step(t)-step(t-1000)+step(t-2000)-step(t-3000)


def test_elmer_step_cycle_real_times_and_fourier_solution(tmp_path):
    require('elmer',tmp_path)
    from cablesim_simulation.elmer_adapter import solve
    from cablesim_simulation.external import observations
    d=fixture('heat-step-cycle');p,c=validate(d['input'],d['parameters']['mesh']);m=build(p,c)
    result=solve(p.model_dump(mode='json'),m,tmp_path/'cycle')
    obs=observations(p.model_dump(mode='json'),m,result)
    probes=[r for r in obs if r['quantity']=='probe_temperature_k']
    assert probes[-1]['time_s']==4000
    assert probes[0]['time_s']==10
    errors=[abs(r['value']-slab_exact(.01,r['time_s'])) for r in probes]
    assert max(errors)<.25
    assert probes[-1]['value']<300


def test_host_external_protocol_and_environment_artifacts(tmp_path):
    require('getdp',tmp_path)
    from backend.plugin_host import Executor
    d=fixture('eddy-twin')
    d['parameters']['reproduction']={k:d[k] for k in ('citation','scope','targets','frozen_inputs')}
    run=Executor(jobs_root=tmp_path).run('cablesim.simulation','getdp-eddy',[{'case_id':'twin','input':d['input'],'parameters':d['parameters']}])
    case=run.cases[0]
    assert case.status=='succeeded',case.error
    bundle=case.artifacts['x-cablesim.simulation-bundle']
    assert bundle['result']['solver']['name']=='getdp'
    assert bundle['result']['mesh_sha256']==bundle['mesh']['sha256']
    assert bundle['result']['execution']['returncode']==0
    assert 'case.pro' in bundle['result']['solver_files']


def test_host_loss_artifact_has_verified_bundle_hash(tmp_path):
    require('getdp',tmp_path)
    from backend.plugin_host import Executor
    from cablesim_simulation.report import digest
    d=fixture('eddy-lunca')
    d['parameters']['loss_export']={
        'bindings':[{'entity':'cable/'+p,'conductor_regions':[p+'/core'],'sheath_regions':[p+'/sheath'],'armor_regions':[]} for p in 'ABC'],
        'source_domain_sha256':digest(d['input']),
        'topology':{'constraints':[{'regions':e['regions'],'kind':e['kind'],'connection':e.get('connection','parallel'),'value':e['value']} for e in d['input']['excitations']]},
        'material_temperatures_k':{p+'/'+part:t for p in 'ABC' for part,t in [('core',363.15),('sheath',353.15)]},
        'source':'E05 explicit fixed-temperature reproduction; no automatic domain conversion'}
    run=Executor(jobs_root=tmp_path).run('cablesim.simulation','getdp-eddy',[{'case_id':'losses','input':d['input'],'parameters':d['parameters']}])
    case=run.cases[0]
    assert case.status=='succeeded',case.error
    artifact=case.artifacts['x-cablesim.loss-coefficients']
    assert artifact['producer']['bundle_sha256']==case.artifact_digests['x-cablesim.simulation-bundle']
    assert len(artifact['rows'])==3
    assert artifact['rows'][0]['lambda1']==pytest.approx(.1235,abs=.001)
    assert artifact['rows'][0]['lambda2']==0
    assert artifact['validity']['ampacity_iteration_allowed'] is False


def test_getdp_temperature_table_matches_bessel_at_nodes_and_validation_points(tmp_path):
    require('getdp',tmp_path)
    from scipy.special import iv
    from cablesim_simulation.loss_table import produce
    d=fixture('eddy-cylinder');p,c=validate(d['input'],d['parameters']['mesh']);m=build(p,c)
    problem=p.model_dump(mode='json')
    options={'bindings':[{'entity':'cable','conductor_regions':['conductor'],'sheath_regions':[],'armor_regions':[]}],
        'source_domain_sha256':'a'*64,'topology':{'constraints':[{'regions':['conductor'],'kind':'current_rms_a','connection':'parallel','value':[1,0]}]},
        'material_temperatures_k':{'conductor':293.15},'source':'Analytic cylinder regression, synthetic temperature law',
        'temperature_table':{'axes':[{'entity':'cable','state':'conductor_temperature_c','regions':['conductor'],'values_c':[20,40,60,80,100]}],
         'resistivity_laws':{'conductor':{'reference_temperature_k':293.15,'alpha_per_k':.00393,'minimum_temperature_k':293.15,'maximum_temperature_k':373.15,'source':'Explicit test law'}},
         'current_scale_range':[0,1000],'maximum_validation_absolute_error':.001}}
    table=produce(problem,m,options,{},tmp_path/'table')
    assert len(table['rows'])==5 and len(table['validation_points'])==4
    for row in table['rows']+table['validation_points']:
        sigma=58e6/(1+.00393*(row['temperature_c'][0]-20))
        gamma=np.sqrt(1j*2*np.pi*50*4*np.pi*1e-7*sigma)
        exact=(gamma*iv(0,gamma*.01)/(2*np.pi*.01*sigma*iv(1,gamma*.01))).real*np.pi*.01**2*sigma-1
        assert row['coefficients']['cable']['ac_extra_factor']==pytest.approx(exact,abs=.0015)
        assert row['execution']['returncode']==0
    assert table['rows'][0]['coefficients']['cable']['ac_extra_factor']>table['rows'][-1]['coefficients']['cable']['ac_extra_factor']
    assert table['error']['maximum_absolute']<.001


def test_host_temperature_artifact_matches_saved_nodal_field(tmp_path):
    from backend.plugin_host import Executor
    d=fixture('thermal-cywinski')
    run=Executor(jobs_root=tmp_path).run('cablesim.simulation','multiregion-thermal',[
        {'case_id':'thermal','input':d['input'],'parameters':d['parameters']}])
    case=run.cases[0]
    assert case.status=='succeeded',case.error
    artifact=case.artifacts['x-cablesim.temperature-field']
    field=case.artifacts['x-cablesim.simulation-bundle']['field']
    assert artifact['source']['bundle_sha256']==case.artifact_digests['x-cablesim.simulation-bundle']
    assert artifact['temperature_k']==field['temperature']
    assert artifact['hotspot']['temperature_k']==max(field['temperature'])
    assert artifact['samples']
    assert artifact['convergence']['mesh_status']=='not_assessed_single_mesh'


def test_domain_and_explicit_problem_share_mesh_and_material_binding():
    from cablesim_simulation.problem_domain import electromagnetic
    from cablesim_simulation.external import prepare
    d=json.loads((ROOT/'plugins/cablesim.simulation/src/cases/thermal-iec.json').read_text('utf-8'))
    d['cable_types'][0]['cores'][0]['conductor']['form']='solid_round'
    for layer in d['cable_types'][0]['cores'][0]['layers']:layer['form']='smooth'
    for m in d['materials']:m['relative_permeability']=1
    used=['cu','semicon','xlpe','sheath','pvc']
    options={'section_id':'section/ground','load_id':'load/steady','bounds_m':[-2,-3,2,1],
             'background':{'conductivity_s_m':0,'relative_permeability':1,'source':'explicit nonconducting test exterior'},
             'material_states':{'material/'+u:{'temperature_k':293.15,'nonconducting':u not in ('cu','sheath'),'source':'test material state'} for u in used},
             'phase_degrees':{'cable/A':-120,'cable/B':0,'cable/C':120},
             'bonded_layers':[['cable/'+p+'/layer-3' for p in 'ABC']], 'probes_m':[], 'source':'domain binding test'}
    mesh={'size_m':.004,'far_size_m':.3,'transition_m':1,'max_nodes':60000}
    explicit=electromagnetic(d,options)
    a,am=prepare(d,{'mesh':mesh,'electromagnetic_options':options},'getdp')
    b,bm=prepare(explicit,{'mesh':mesh},'getdp')
    assert a==b
    assert am['sha256']==bm['sha256']
    d['circuits'][0]['electrical_topology']={'phase_sequence':'ABC','reference_angle_rad':0,
                                           'source':{'kind':'user','reference':'explicit test topology','reviewed':False}}
    with pytest.raises(ValueError,match='phase_degrees'):electromagnetic(d,options)
    options['phase_degrees']={'cable/A':0,'cable/B':-120,'cable/C':120}
    matched=electromagnetic(d,options)
    assert matched['provenance']['electrical_topology'][d['circuits'][0]['id']]['phase']['phase_sequence']=='ABC'
    assert a['excitations'][-1]['regions']==options['bonded_layers'][0]
    assert np.hypot(*a['excitations'][0]['value'])==pytest.approx(400)
