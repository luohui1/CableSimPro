"""Real Slurm research capabilities; independent Bessel and circuit identities."""
from copy import deepcopy
from math import pi
from pathlib import Path
import json
import sys
import time
import numpy as np
import pytest
from scipy.special import jn_zeros,j1
from backend.plugin_host import Executor
from simulation_fixtures import domain,transient_parameters,electromagnetic_parameters,coupled_parameters


def bessel_temperature(time_s,schedule):
    roots=jn_zeros(0,500)
    total=293.15;prior=0.
    for at,factor in schedule:
        if time_s>at:
            response=10/(4*pi*.2)*(1-8*np.sum(np.exp(-.2/2e6*roots**2*(time_s-at)/.005**2)/(roots**3*j1(roots))))
            total+=(factor-prior)*float(response)
        prior=factor
    return total


def execute(tmp_path,capability,value,parameters):
    host=Executor(jobs_root=tmp_path)
    case={'case_id':'research','input':value,'parameters':parameters}
    checked=host.check('cablesim.simulation',capability,[case]).cases[0]
    assert checked.status=='succeeded',checked.error
    result=host.run('cablesim.simulation',capability,[case]).cases[0]
    assert result.status=='succeeded',result.error
    return result


def test_transient_research_bessel_step_curve_peak_and_limit(tmp_path):
    value=domain();result=execute(tmp_path,'transient-temperature',value,transient_parameters(value))
    artifact=result.artifacts['x-cablesim.temperature-history'];curve=artifact['curves'][0]
    assert len(curve['time_s'])==601
    error=max(abs(temp-bessel_temperature(time_s,[(0.,1.),(20.,0.),(40.,1.)]))
              for time_s,temp in zip(curve['time_s'],curve['maximum_temperature_k']))
    assert error<.1,error
    assert curve['peak_temperature_k']==max(curve['maximum_temperature_k'])
    assert curve['limit_status']=='reached' and curve['limit_crossing']['bracket_s'][1]-curve['limit_crossing']['bracket_s'][0]<=.100001
    assert artifact['source']['bundle_sha256']==result.artifact_digests['x-cablesim.simulation-bundle']


@pytest.mark.parametrize('bonding',['single_point','both_ends','cross_bonded'])
def test_sheath_research_native_topology_and_loss_binding(tmp_path,bonding):
    value=domain(True);circuit=value['circuits'][0];circuit['bonding']['kind']=bonding
    if bonding=='cross_bonded':
        circuit['bonding'].update(minor_section_lengths=[80.,100.,120.],section_permutations=[[0,1,2],[1,2,0],[2,0,1]])
    result=execute(tmp_path,'sheath-losses',value,electromagnetic_parameters(value))
    artifact=result.artifacts['x-cablesim.loss-coefficients']
    assert set(artifact['coefficients'])=={'cable/a','cable/b','cable/c'}
    assert all(row['lambda1']==pytest.approx(row['sheath_loss_w_m']/row['conductor_loss_w_m']) for row in artifact['rows'])
    if bonding=='single_point':
        assert max(current['current_rms_a'] for row in result.artifacts['x-cablesim.sheath-losses']['currents'] for current in row['regional_currents'])<1e-6
    errors=result.artifacts['x-cablesim.sheath-losses']['convergence']['current_constraint_errors']
    assert max(row['absolute_error_a'] for row in errors)<1e-5
    assert artifact['domain_input_sha256'] and artifact['producer']['bundle_sha256']==result.artifact_digests['x-cablesim.simulation-bundle']


def test_electrothermal_research_bidirectional_energy_and_temperature(tmp_path):
    value=domain(True);result=execute(tmp_path,'electrothermal-steady',value,coupled_parameters(value))
    bundle=result.artifacts['x-cablesim.simulation-bundle'];solved=bundle['result']
    assert solved['maximum_temperature_k']>293.15
    assert len(solved['iterations'])>1
    last=solved['iterations'][-1]
    assert last['temperature_update_inf_k']<=1e-4 and last['power_relative_update']<=1e-6
    assert last['energy_relative_residual']<1e-5 and last['transfer_relative_error']<1e-5
    field=result.artifacts['x-cablesim.temperature-field']
    assert field['source']['bundle_sha256']==result.artifact_digests['x-cablesim.simulation-bundle']


def evidence(name,value):
    path=Path(__file__).resolve().parents[1]/'artifacts'/name
    path.parent.mkdir(exist_ok=True);path.write_text(json.dumps(value,indent=2),encoding='utf-8')


def test_sheath_research_matches_independent_thin_shell_circuit(tmp_path):
    value=domain(True);result=execute(tmp_path,'sheath-losses',value,electromagnetic_parameters(value))
    positions=np.array([-.08,0.,.08]);radius=.0145;omega=2*pi*50
    # Faraday partial inductances and Kirchhoff common-end voltage. The arbitrary
    # 1 m reference cancels because both phase and sheath currents sum to zero.
    matrix=np.empty((3,3))
    for i in range(3):
        for j in range(3):matrix[i,j]=2e-7*np.log(1/(radius if i==j else abs(positions[i]-positions[j])))
    resistance=2.84e-8/(pi*(.015**2-.014**2))
    phase=100*np.exp(1j*np.array([0.,-2*pi/3,2*pi/3]))
    system=np.zeros((4,4),dtype=complex)
    system[:3,:3]=resistance*np.eye(3)+1j*omega*matrix
    system[:3,3]=-1;system[3,:3]=1
    reference=np.linalg.solve(system,np.r_[-1j*omega*matrix@phase,0j])[:3]
    currents=result.artifacts['x-cablesim.sheath-losses']['currents']
    actual=np.array([complex(*row['regional_currents'][0]['current_complex_rms_a']) for row in currents])
    error=float(np.max(np.abs(actual-reference))/np.max(np.abs(reference)))
    evidence('sheath-research-hand-circuit.json',{'reference':'Independent Faraday/Kirchhoff thin-shell circuit; finite-wall GetDP is compared with a declared 3% model-limit tolerance',
        'reference_complex_rms_a':[[z.real,z.imag] for z in reference],'native_complex_rms_a':[[z.real,z.imag] for z in actual],
        'maximum_relative_current_error':error,'tolerance':.03,'engineering_approval':False})
    assert error<.03,error


def test_electrothermal_research_matches_coaxial_resistance_feedback_hand_solution(tmp_path):
    value=domain(True);value['circuits'][0]['system']['frequency']=1e-6
    value['circuits'][0]['bonding']['kind']='single_point'
    # A declared highly conducting thermal exterior tends to the independent
    # coaxial constant-surface problem; copper's internal gradient is retained.
    next(m for m in value['materials'] if m['id']=='material/soil')['thermal_resistivity']=1e-6
    parameters=coupled_parameters(value);parameters['mesh'].update(size_m=.00025,minimum_circle_segments=64)
    result=execute(tmp_path,'electrothermal-steady',value,parameters)
    thermal_mean=np.log(.014/.005)/(2*pi*.2)+np.log(.015/.014)/(2*pi*200)+1/(8*pi*380)
    cold_power=100**2*1.7241e-8/(pi*.005**2)
    power=cold_power/(1-.00393*cold_power*thermal_mean)
    expected=293.15+power*(thermal_mean+1/(8*pi*380))
    solved=result.artifacts['x-cablesim.simulation-bundle']['result']
    actual=solved['maximum_temperature_k'];error=abs(actual-expected)
    evidence('electrothermal-research-hand-coaxial.json',{'reference':'Independent coaxial thermal resistance and I^2 R(T) feedback hand solution in the declared near-DC/high-exterior-conductivity limit',
        'reference_peak_temperature_k':expected,'native_peak_temperature_k':actual,'absolute_error_k':error,
        'reference_conductor_power_w_m':power,'tolerance_k':.03,'iterations':len(solved['iterations']),'engineering_approval':False})
    assert error<.03,error


def test_research_sheath_temperature_artifact_is_consumed_by_iec_saved_reference(tmp_path):
    from fastapi.testclient import TestClient
    from uuid import uuid4
    from backend.main import create_app
    from backend.kernel.scenarios import METHOD_DEFAULTS
    value=json.loads((Path(__file__).resolve().parents[1]/'plugins/cablesim.simulation/src/cases/thermal-iec.json').read_text('utf-8'))
    conductor=value['cable_types'][0]['cores'][0]['conductor']
    conductor['form']='solid_round';conductor['nominal_area']=pi*(conductor['diameter']/2)**2
    conductor['r20']=1.7241e-8/conductor['nominal_area']
    for layer in value['cable_types'][0]['cores'][0]['layers']:layer['form']='smooth'
    for material in value['materials']:material['relative_permeability']=1.
    for load in value['load_cases']:load['currents']={key:30. for key in load['currents']}
    circuit=value['circuits'][0]
    circuit['electrical_topology']={'phase_sequence':'ABC','reference_angle_rad':0.,'source':{'kind':'demo','reference':'Explicit IEC external-loss integration benchmark'}}
    circuit['bonding']['source']={'kind':'demo','reference':'Explicit ideal both-end bonding benchmark'}
    options={'section_id':'section/ground','load_id':'load/steady','bounds_m':[-2.,-3.,2.,1.],
        'background':{'conductivity_s_m':0.,'relative_permeability':1.,'source':'Explicit nonconducting benchmark exterior'},
        'material_states':{'material/'+name:{'temperature_k':293.15,'nonconducting':name not in ('cu','sheath'),'source':'Explicit 20 C benchmark state'} for name in ('cu','semicon','xlpe','sheath','pvc')},
        'probes_m':[],'source':'Six independent conductor/sheath axes; synthetic low-current IEC integration'}
    axes=[];laws={}
    for cable in circuit['cables']:
        for state,suffix in [('conductor_temperature_c','conductor'),('sheath_temperature_c','layer-3')]:
            uid=cable['id']+'/'+suffix
            axes.append({'entity':cable['id'],'state':state,'regions':[uid],'values_c':[20.,40.]})
            laws[uid]={'reference_temperature_k':293.15,'alpha_per_k':.00393,'minimum_temperature_k':293.15,'maximum_temperature_k':313.15,'source':'Explicit saved copper law; no extrapolation'}
    parameters={'electromagnetic_options':options,'mesh':{'size_m':.002,'far_size_m':.25,'transition_m':.8,'minimum_circle_segments':96,'max_nodes':60000},
        'temperature_table':{'axes':axes,'resistivity_laws':laws,'current_scale_range':[0.,2.],'maximum_validation_absolute_error':.003}}
    with TestClient(create_app(tmp_path/'external-loss.sqlite')) as client:
        workspace=client.post('/api/workspaces',json={}).json()
        methods=client.get('/api/methods').json()
        def saved(plugin,capability,settings):
            method={**next(item['method'] for item in methods if item['method']['plugin_id']==plugin),'capability':capability}
            response=client.post('/api/workspaces/'+workspace['id']+'/studies',json={
                'expected_revision':workspace['revision'],'title':'External loss integration '+capability,
                'input_source':'study','method_input':value,'method':method,'parameters':settings,
                'task':'sheath-losses' if capability=='sheath-losses' else None})
            assert response.status_code==201,response.text
            study=response.json();url='/api/workspaces/'+workspace['id']+'/studies/'+study['id']
            check=client.get(url+'/preflight',params={'expected_revision':workspace['revision'],'expected_study_revision':study['revision']})
            assert check.status_code==200 and check.json()['ready'],check.text
            request={'request_id':str(uuid4()),'expected_revision':workspace['revision'],'expected_study_revision':study['revision'],
                     'lock_digest':check.json()['lock_digest'],'scope_acknowledged':True}
            result=client.post(url+'/runs',json=request).json()
            deadline=time.monotonic()+600
            while result['status'] in ('accepted','running','validating') and time.monotonic()<deadline:
                time.sleep(.25);result=client.get(url+'/runs/'+result['id']).json()
            assert result['status']=='succeeded',result.get('error') or result.get('output')
            return result
        produced=saved('cablesim.simulation','sheath-losses',parameters)
        row=produced['output']['cases'][0];artifact=row['artifacts']['x-cablesim.loss-coefficients']
        assert len(artifact['temperature_table']['rows'])==64 and len(artifact['temperature_table']['validation_points'])==1
        settings=deepcopy(METHOD_DEFAULTS['cablesim.iec60287']);settings['operation']='temperature'
        settings['external_loss_reference']={'run_id':produced['id'],'case_id':row['case_id'],
            'artifact_type':'x-cablesim.loss-coefficients','artifact_sha256':row['artifact_digests']['x-cablesim.loss-coefficients']}
        consumed=saved('cablesim.iec60287','steady-rating',settings)
        assert consumed['integrity']=='verified'
        trace=consumed['output']['cases'][0]['artifacts']['x-cablesim.iec60287-trace']
        assert trace['external_loss_source']['artifact_sha256']==row['artifact_digests']['x-cablesim.loss-coefficients']
        book=client.post('/api/workspaces/'+workspace['id']+'/deliveries/current',json={'run_ids':[consumed['id']]}).json()
        assert row['artifact_digests']['x-cablesim.loss-coefficients'] in book['html']
        evidence('sheath-research-iec-integration.json',{'producer_run':produced['id'],'consumer_run':consumed['id'],
            'artifact_sha256':row['artifact_digests']['x-cablesim.loss-coefficients'],'table_nodes':64,'independent_cell_centres':1,
            'interpolation_error':artifact['temperature_table']['error'],'results':consumed['output']['cases'][0]['results'],
            'engineering_approval':False})
