from copy import deepcopy
from pathlib import Path
import sys
import pytest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'plugins/cablesim.simulation/src'))
from cablesim_simulation.artifacts import temperature_field,loss_coefficients
from cablesim_sdk.simulation_artifacts import TemperatureField
from cablesim_sdk.simulation_artifacts import LossTemperatureAxis


def source():
    return dict(run_id='run',case_id='case',plugin_id='cablesim.simulation',plugin_version='0.4.0',
                capability='test',input_sha256='a'*64,bundle_sha256='b'*64,manifest_sha256='c'*64)


def test_temperature_contract_preserves_field_and_rejects_misalignment():
    mesh=dict(points=[[0,0],[1,0],[0,1]],triangles=[[0,1,2]],domain_ids=[1],regions=[dict(id=1,uid='soil')])
    field=temperature_field(mesh,[300,310,305],source())
    assert field['hotspot']['temperature_k']==310
    assert field['hotspot']['point_m']==[1,0]
    assert field['convergence']['mesh_status']=='not_assessed_single_mesh'
    field['temperature_k'].pop()
    with pytest.raises(ValueError,match='temperature_k'):TemperatureField.model_validate(field)
    with pytest.raises(ValueError):temperature_field(mesh,[300,float('nan'),305],source())


def inputs():
    problem=dict(physics='magnetic_harmonic',frequency_hz=50,
                 excitations=[dict(regions=['core'],kind='current_rms_a',value=[10,0])])
    result=dict(solver={'name':'getdp'},regions=[
        dict(entity='core',current_rms_a=10,dc_resistance_ohm_m=.1,ac_resistance_ohm_m=.12,joule_loss_w_m=12),
        dict(entity='sheath',joule_loss_w_m=3),dict(entity='armor',joule_loss_w_m=2)],
        magnetic_losses=[dict(entity='armor',magnetic_loss_w_m=1)])
    cfg=dict(bindings=[dict(entity='cable/A',conductor_regions=['core'],sheath_regions=['sheath'],armor_regions=['armor'])],
             source_domain_sha256='d'*64,topology=dict(constraints=[dict(regions=['core'],kind='current_rms_a',connection='parallel',value=[10,0])]),
             material_temperatures_k={'core':350,'sheath':340,'armor':330},source='explicit benchmark mapping')
    return problem,result,cfg


def test_losses_include_magnetic_heat_and_use_conductor_loss_denominator():
    p,r,c=inputs();got=loss_coefficients(p,r,c,source())
    row=got['rows'][0]
    assert row['lambda1']==pytest.approx(.25)
    assert row['lambda2']==pytest.approx(.25)
    assert row['ac_extra_factor']==pytest.approx(.2)
    assert got['validity']['ampacity_iteration_allowed'] is False
    assert got['schema']=='cablesim.loss-coefficients/1'
    assert got['domain_input_sha256']==c['source_domain_sha256']
    assert got['coefficients']['cable/A']['lambda1']==row['lambda1']
    assert got['producer']['bundle_sha256']==source()['bundle_sha256']


@pytest.mark.parametrize('change',['topology','duplicate','zero','missing_temperature'])
def test_losses_refuse_ambiguous_or_invalid_inputs(change):
    p,r,c=inputs()
    if change=='topology':c['topology']['constraints'][0]['value']=[0,10]
    if change=='duplicate':c['bindings'][0]['armor_regions']=['sheath']
    if change=='zero':r['regions'][0]['current_rms_a']=0
    if change=='missing_temperature':c['material_temperatures_k'].pop('core')
    with pytest.raises(ValueError):loss_coefficients(p,r,c,source())


@pytest.mark.parametrize('values',[[20.,float('nan')],[float('-inf'),100.],[20.,float('inf')]])
def test_temperature_axis_rejects_nonfinite_nodes(values):
    with pytest.raises(ValueError):LossTemperatureAxis(entity='cable/A',state='conductor_temperature_c',regions=['core'],values_c=values)


@pytest.mark.parametrize('change',[None,'domain','bundle','topology'])
def test_research_loss_readback_requires_saved_input_and_bundle(change):
    from backend.kernel.research import Research
    from backend.kernel.workspace import fingerprint
    from cablesim_sdk.reproduction import digest
    p,r,c=inputs();s=source();s['input_sha256']=digest(p);c['source_domain_sha256']=fingerprint(p)
    artifact=loss_coefficients(p,r,c,s)
    run={'snapshot':{'cases':[{'case_id':'case','input':p}],
        'definition':{'method':{'plugin_id':s['plugin_id'],'version':s['plugin_version'],'capability':s['capability']}}},
        'output':{'cases':[{'case_id':'case','artifacts':{'x-cablesim.simulation-bundle':{},'x-cablesim.loss-coefficients':artifact},
            'artifact_digests':{'x-cablesim.simulation-bundle':s['bundle_sha256'],'x-cablesim.loss-coefficients':'f'*64}}]}}
    if change=='domain':artifact['domain_input_sha256']='0'*64
    elif change=='bundle':artifact['producer']['bundle_sha256']='0'*64
    elif change=='topology':artifact['topology']['constraints'][0]['value']=[20,0]
    status=Research.artifact_status(run)['case']['x-cablesim.loss-coefficients']['status']
    assert status==('verified' if change is None else 'unavailable')
