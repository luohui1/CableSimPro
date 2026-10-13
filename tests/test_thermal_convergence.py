"""Numerical evidence gates: independent differences, binding and delivery refusal."""
from contextlib import contextmanager
import pytest
from backend.kernel.convergence import temperature_convergence
from backend.kernel.contracts import ThermalConvergence


def evidence(peaks=(320.1,320.04,320.,320.02)):
    ids=['case-0','case-1','case-2','case-3']
    inputs=[];outputs=[];statuses={}
    for i,(h,t) in enumerate(zip([.012,.006,.003,.003],peaks)):
        params={'controls':{'mesh_size_m':h,'max_nodes':60000,'tolerance_k':.001},
                'domain_options':{'bounds_m':[-6,-6,6,0] if i<3 else [-12,-12,12,0],'source':'analytic heat test'}}
        inputs.append({'case_id':ids[i],'input':{'schema_version':'cablesim.domain/1','load':400},'parameters':params})
        outputs.append({'case_id':ids[i],'status':'succeeded','artifacts':{'x-cablesim.temperature-field':{'hotspot':{'temperature_k':t},'mesh':{'points':[[0,0]]*(100+i)}}}})
        statuses[ids[i]]={'x-cablesim.temperature-field':{'status':'verified'}}
    return {'snapshot':{'definition':{'verification':{'mesh_case_ids':ids[:3],'domain_case_id':ids[3],'tolerance_k':.1}},'cases':inputs},'output':{'cases':outputs},'artifact_status':statuses}


def test_last_grid_and_independent_domain_both_required():
    result=temperature_convergence(evidence())
    assert result['status']=='converged'
    assert result['grid_change_k']==pytest.approx(.04)
    assert result['domain_change_k']==pytest.approx(.02)
    assert result['reference_case_id']=='case-2'
    assert temperature_convergence(evidence((320.2,320.04,320.,320.11)))['status']=='unconverged'
    assert temperature_convergence(evidence((320.3,320.2,320.,320.02)))['status']=='unconverged'
    assert temperature_convergence(evidence((330.,320.,320.05,320.07)))['status']=='unconverged'


@pytest.mark.parametrize('change',['heat','bounds','mesh','integrity'])
def test_cannot_promote_unrelated_or_unverified_evidence(change):
    r=evidence()
    if change=='heat':r['snapshot']['cases'][2]['input']['load']=410
    if change=='bounds':r['snapshot']['cases'][3]['parameters']['domain_options']['bounds_m']=[-12,-8,12,0]
    if change=='mesh':r['snapshot']['cases'][1]['parameters']['controls']['mesh_size_m']=.02
    if change=='integrity':r['artifact_status']['case-1']['x-cablesim.temperature-field']['status']='unavailable'
    assert temperature_convergence(r)['status']=='unconverged'


@pytest.mark.parametrize('bounds_key',['domain_options','electromagnetic_options'])
def test_new_simulation_mesh_contract_keeps_same_convergence_gate(bounds_key):
    r=evidence()
    for case in r['snapshot']['cases']:
        params=case['parameters'];controls=params.pop('controls')
        params['mesh']={'size_m':controls['mesh_size_m'],'far_size_m':controls['mesh_size_m']*4,'max_nodes':60000,'field_order':1}
        bounds=params.pop('domain_options');params[bounds_key]=bounds
    result=temperature_convergence(r)
    assert result['status']=='converged' and result['domain_change_k']==pytest.approx(.02)
    r['snapshot']['cases'][1]['parameters']['mesh']['field_order']=2
    assert temperature_convergence(r)['status']=='unconverged'


def test_threshold_cannot_be_relaxed_and_single_run_is_unconverged():
    with pytest.raises(ValueError):ThermalConvergence(mesh_case_ids=['case-0','case-1','case-2'],domain_case_id='case-3',tolerance_k=.2)
    r=evidence();r['snapshot']['definition']['verification']=None
    assert temperature_convergence(r)['status']=='unconverged'


def test_unconverged_field_refused_by_delivery_service(monkeypatch):
    from backend.kernel.research import Research
    from fastapi import HTTPException
    class Snapshot:
        def execute(self,*a):return self
        def fetchone(self):return None
    class Store:
        @contextmanager
        def read_snapshot(self):yield Snapshot()
        def load(self,db,wid,*a,**k):return {'revision':1},{}
    service=object.__new__(Research)
    service.store=Store()
    monkeypatch.setattr(service,'verified_runs',lambda *a,display=False:[evidence()])
    with pytest.raises(HTTPException) as caught:service.deliver('workspace',['run'])
    assert caught.value.status_code==422
    assert '未收敛' in caught.value.detail
