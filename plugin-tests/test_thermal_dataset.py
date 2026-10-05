"""Dataset labels must agree with a radial heat balance and reject coarse labels."""
from math import log,pi,sqrt
from pathlib import Path
import sys
import pytest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'plugins/cablesim.simulation/src'))
from test_simulation_thermal import circular,controls


def case():
    value=circular();cable=value['cables'][0]
    cable['layers'][0]['fixed_heat_w_m']=0.
    cable['current_a']=300.;cable['temperature_limit_k']=323.15
    cable['electrical']={'r20_ohm_m':.0001,'alpha20_per_k':.004,'ac_extra_factor':0.,
        'sheath_loss_factor':0.,'sheath_layer_uid':None,'source':'hand radial thermal/resistance law'}
    return {'case_id':'radial','input':value,'parameters':{'controls':controls('ampacity')}}


def test_dataset_real_host_matches_hand_rating_and_retains_mesh_history(tmp_path):
    from backend.plugin_host import Executor
    item=case()
    result=Executor(jobs_root=tmp_path).run('cablesim.simulation','thermal-dataset',[item]).cases[0]
    assert result.status=='succeeded',result.error
    data=result.artifacts['x-cablesim.dataset-sample']
    rmean=1/(8*pi*200)+log(2)/(2*pi*.4)+1/(2*pi*.02*10)
    rmax=rmean+1/(8*pi*200)
    heat=30/rmax
    exact=sqrt(heat/(.0001*(1+.004*heat*rmean)))
    assert data['valid'],data['convergence']
    assert data['rating']['rating']['ampacity_a']==pytest.approx(exact,abs=.5)
    assert data['operating']['cables'][0]['current_a']==300
    assert len(data['mesh_history'])==3
    assert len({r['mesh_sha256'] for r in data['mesh_history']})==3
    assert data['convergence']['energy_relative_residual']<1e-7
    assert {r['case'] for r in result.results}=={'operating','rating'}


def test_nonconverged_mesh_preserves_diagnostics_but_no_available_label(tmp_path):
    from backend.plugin_host import Executor
    item=case();item['parameters']['dataset']={'temperature_tolerance_k':1e-12,'ampacity_tolerance_a':1e-12}
    result=Executor(jobs_root=tmp_path).run('cablesim.simulation','thermal-dataset',[item]).cases[0]
    assert result.status=='succeeded',result.error
    data=result.artifacts['x-cablesim.dataset-sample']
    assert data['status']=='nonconverged' and data['valid'] is False
    assert len(data['mesh_history'])==3
    assert all(r['status']=='unavailable' and 'value' not in r for r in result.results)


@pytest.mark.parametrize('order',[1,2])
def test_constant_matrix_reuse_matches_unmodified_full_assembly(order):
    from cablesim_simulation.thermal_input import prepare
    from cablesim_simulation.thermal import ThermalSystem
    value=case();value['parameters']['controls']['tolerance_k']=1e-10
    value['parameters']['controls']['element_order']=order
    model,cfg=prepare(value['input'],value['parameters'])
    fast=ThermalSystem(model,cfg);full=ThermalSystem(model,cfg);full._constant_matrix=False
    for current in (100.,300.,450.):
        a=fast.state([current]);b=full.state([current])
        assert a['cables'][0]['conductor_max_temperature_k']==pytest.approx(b['cables'][0]['conductor_max_temperature_k'],abs=1e-9)
        assert a['source_heat_w_m']==pytest.approx(b['source_heat_w_m'],abs=1e-10)
