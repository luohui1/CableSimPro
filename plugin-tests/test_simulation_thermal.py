"""统一热入口的解析、非线性、分区、领域适配与论文工件回归。"""
from copy import deepcopy
import json
from math import pi,log
from pathlib import Path
import sys
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'plugins/cablesim.simulation/src'))
from cablesim_simulation.thermal_input import prepare, ThermalModel, Controls
from cablesim_simulation.thermal import solve_thermal


def controls(operation='temperature'):
    return {'operation':operation,'mesh_size_m':.002,'far_mesh_size_m':.01,'mesh_transition_m':.06,
            'max_nodes':40000,'tolerance_k':1e-6,'max_iterations':100,'relaxation':.7,
            'current_upper_a':600,'current_tolerance_a':.01,'rated_circuit':'circuit/one'}


def circular():
    return {'schema_version':'cablesim.thermal-model/1','cables':[{
        'uid':'cable/one','circuit':'circuit/one','x_m':0,'z_m':0,
        'layers':[{'uid':'layer/core','role':'conductor','outer_radius_m':.01,'k_w_m_k':200.,'fixed_heat_w_m':10.},
                  {'uid':'layer/insulation','role':'insulation','outer_radius_m':.02,'k_w_m_k':.4,'fixed_heat_w_m':0.}],
        'current_a':0.,'electrical':None,'prescribed_core_temperature_k':None,'temperature_limit_k':363.15,'duct':None}],
        'environment':{'kind':'isolated_cables','background':None,'soil_layers':[],'backfills':[],
                       'boundaries':{'surface':{'kind':'convection','temperature_k':293.15,'h_w_m2_k':10.,'emissivity':0.}}},
        'provenance':{'fixture':{'source':'合成圆柱解析回归，非论文/厂家数据'}},'assumptions':['无限长圆柱']}


def test_generic_circle_and_temperature_boundary():
    model = circular()
    a,b,k0,k1,h,q = .01,.02,200,.4,10,10
    expected = 293.15+q*(1/(4*pi*k0)+log(b/a)/(2*pi*k1)+1/(2*pi*b*h))
    result,field = solve_thermal(*prepare(model,{'controls':controls()}))
    assert result['cables'][0]['conductor_max_temperature_k'] == pytest.approx(expected,abs=.08)
    assert result['energy_relative_residual'] < 1e-7
    fixed = deepcopy(model)
    fixed['cables'][0]['layers'][0].update(k_w_m_k=None,fixed_heat_w_m=0)
    fixed['cables'][0]['prescribed_core_temperature_k'] = 350.
    prescribed,_ = solve_thermal(*prepare(fixed,{'controls':controls()}))
    exact_power = (350-293.15)/(log(b/a)/(2*pi*k1)+1/(2*pi*b*h))
    assert prescribed['prescribed_temperature_heat_w_m'] == pytest.approx(exact_power,rel=.004)
    assert prescribed['cables'][0]['conductor_max_temperature_k'] == 350


def test_nonlinear_resistance_and_current_inversion():
    model = circular()
    cable = model['cables'][0]
    cable['layers'][0]['fixed_heat_w_m'] = 0
    cable['current_a'] = 300.
    cable['electrical'] = {'r20_ohm_m':.0001,'alpha20_per_k':.004,'ac_extra_factor':0.,
                           'sheath_loss_factor':0.,'sheath_layer_uid':None,'source':'合成圆柱解析对拍'}
    resistance_mean = 1/(8*pi*200)+log(2)/(2*pi*.4)+1/(2*pi*.02*10)
    q = 300**2*.0001/(1-300**2*.0001*.004*resistance_mean)
    operating,_ = solve_thermal(*prepare(model,{'controls':controls()}))
    assert operating['cables'][0]['conductor_joule_heat_w_m'] == pytest.approx(q,rel=.004)
    # 以显式较低温限确保给定600A上界仍处稳定区，二分得到可行端点。
    cable['temperature_limit_k'] = 323.15
    cfg = controls('ampacity');cfg['current_upper_a'] = 600
    rated,_ = solve_thermal(*prepare(model,{'controls':cfg}))
    assert 0 < rated['rating']['ampacity_a'] < 600
    assert rated['cables'][0]['conductor_max_temperature_k'] <= 323.15+1e-5
    assert 323.15-rated['cables'][0]['conductor_max_temperature_k'] < .02


def test_layered_ground_and_backfill_material_partition():
    model = circular(); model['cables'][0]['z_m'] = -.5
    fixed = {'kind':'temperature','temperature_k':293.15,'h_w_m2_k':None,'emissivity':None}
    model['environment'] = {'kind':'ground','background':{'uid':'soil','bounds_m':[-1,-1,1,0],'k_w_m_k':1.},
        'soil_layers':[{'uid':'upper','bounds_m':[-1,-.3,1,0],'k_w_m_k':2.}],
        'backfills':[{'uid':'fill','bounds_m':[-.15,-.65,.15,-.35],'k_w_m_k':3.}],
        'boundaries':{name:fixed for name in ('top','left','right','bottom')}}
    cfg = controls();cfg.update(mesh_size_m=.004,far_mesh_size_m=.12,mesh_transition_m=.2)
    result,field = solve_thermal(*prepare(model,{'controls':cfg}))
    assert {r['uid'] for r in field['regions']} == {'soil','upper','fill','layer/core','layer/insulation'}
    assert result['energy_relative_residual'] < 1e-7
    points,cells = field['points'],field['triangles']
    # 单元内部点的物性标签必须与几何一致，而不是仅检查列表存在。
    regions = {r['id']:r for r in field['regions']}
    for cell,tag in zip(cells,field['domain_ids']):
        x,z = [sum(points[i][axis] for i in cell)/3 for axis in (0,1)]
        if z > -.29:
            assert regions[tag]['uid'] == 'upper'


def test_missing_region_property_and_overlap_fail_closed():
    model = circular()
    model['cables'][0]['layers'][1]['k_w_m_k'] = None
    with pytest.raises(ValueError):
        prepare(model,{'controls':controls()})
    model = circular()
    clone = deepcopy(model['cables'][0]);clone['uid'] = 'cable/two'
    for l in clone['layers']:
        l['uid'] += '-two'
    model['cables'].append(clone)
    with pytest.raises(ValueError,match='重叠'):
        prepare(model,{'controls':controls()})


def test_multiregion_real_host_artifact_and_report(tmp_path):
    from backend.plugin_host import Executor
    host = Executor(jobs_root=tmp_path)
    case = {'case_id':'circle','input':circular(),'parameters':{'controls':controls()}}
    checked = host.check('cablesim.simulation','multiregion-thermal',[case]).cases[0]
    assert checked.status == 'succeeded' and not checked.artifacts and not checked.results
    result = host.run('cablesim.simulation','multiregion-thermal',[case]).cases[0]
    assert result.status == 'succeeded',result.error
    assert result.results[0]['unit'] == 'K'
    report = result.artifacts['x-cablesim.reproduction-report']
    assert report['schema'] == 'cablesim.reproduction-report/1'
    assert report['status'] == 'missing_reference'


def test_domain_and_explicit_model_share_identical_solver_input(tmp_path):
    from backend.plugin_host import Executor
    from cablesim_simulation.iec_compare import inputs,thermal_parameters
    document,iec_parameters = inputs(False)
    host = Executor(jobs_root=tmp_path)
    source = host.run('cablesim.iec60287','steady-rating',[{'case_id':'source','input':document,'parameters':iec_parameters}])
    assert source.cases[0].status == 'succeeded',source.cases[0].error
    parameters = thermal_parameters(document,source,'temperature',.005)
    model,cfg = prepare(document,parameters)
    cases = [{'case_id':'domain','input':document,'parameters':parameters},
             {'case_id':'explicit','input':model.model_dump(mode='json'),'parameters':{'controls':cfg.model_dump(mode='json')}}]
    run = host.run('cablesim.simulation','multiregion-thermal',cases)
    a,b = run.cases
    assert a.status == b.status == 'succeeded',(a.error,b.error)
    assert a.evidence['prepared_input_sha256'] == b.evidence['prepared_input_sha256']
    assert [r['value'] for r in a.results] == pytest.approx([r['value'] for r in b.results],abs=1e-7)
    assert set(a.artifacts) == set(b.artifacts)
