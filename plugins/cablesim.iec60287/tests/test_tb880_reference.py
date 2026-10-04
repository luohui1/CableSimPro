"""Whole reference chains, physical sensitivity and refusal outside the declared scope."""
from pathlib import Path
import json
import pytest
from cablesim_iec60287.tb880_reference import ReferenceRating,rate

FIXTURES=Path(__file__).parent/'fixtures'


def raw(name):return json.loads((FIXTURES/('tb880-'+name+'.json')).read_text('utf-8'))


@pytest.mark.parametrize('name,current,conductor,sheath,armour',[('submarine',838.3399739336,88.78608438409,14.4576402222,37.3481046684),('wire-screen',537.4631099368,28.20166532,1.2271183509,0.)])
def test_published_rating_losses_and_thermal_balance(name,current,conductor,sheath,armour):
    model=ReferenceRating.model_validate(raw(name));r=rate(model)
    assert r['ampacity_a']==pytest.approx(current,abs=5e-5)
    for field,value in [('conductor_loss_w_m',conductor),('sheath_loss_w_m',sheath),('armour_loss_w_m',armour)]:assert r[field]==pytest.approx(value,abs=1e-7)
    n=3 if name=='submarine' else 1;wc=r['conductor_loss_w_m']/n;wd=r['dielectric_loss_per_core_w_m']
    rise=(wc+.5*wd)*r['t1_k_m_w']+n*(wc*(1+r['lambda1'])+wd)*r['t2_k_m_w']+n*(wc*(1+r['lambda1']+r['lambda2'])+wd)*(r['t3_k_m_w']+r['t4_k_m_w'])
    assert rise==pytest.approx(model.data['conductor_temperature_k']-model.data['ambient_temperature_k'],abs=1e-8)
    assert r['history'][-1]['temperature_update_k']<1e-9


@pytest.mark.parametrize('name',['submarine','wire-screen'])
def test_raw_material_and_boundary_changes_recompute(name):
    value=raw(name);base=rate(ReferenceRating.model_validate(value))['ampacity_a']
    value['data']['ambient_temperature_k']+=5
    assert rate(ReferenceRating.model_validate(value))['ampacity_a']<base
    value=raw(name);value['data']['soil_thermal_resistivity_k_m_w']*=1.2
    assert rate(ReferenceRating.model_validate(value))['ampacity_a']<base


@pytest.mark.parametrize('bad',['missing','nan','boolean','topology','coverage','extra'])
def test_invalid_or_unsupported_wire_scope_refused(bad):
    value=raw('wire-screen')
    if bad=='missing':del value['data']['screen_wire_lay_m']
    elif bad=='nan':value['data']['frequency_hz']=float('nan')
    elif bad=='boolean':value['data']['frequency_hz']=True
    elif bad=='topology':value['data']['core_spacing_m']*=2
    elif bad=='coverage':value['wire_count']=100
    elif bad=='extra':value['data']['t1_k_m_w']=.411
    with pytest.raises(ValueError):rate(ReferenceRating.model_validate(value))


def test_host_refuses_cross_capability_schema(tmp_path):
    from backend.plugin_host import Executor
    fixture=json.loads((FIXTURES/'tb880-wire-foil-flat.json').read_text('utf-8'))
    run=Executor(jobs_root=tmp_path).run('cablesim.iec60287','tb880-reference-rating',[{'case_id':'wrong-capability','input':fixture,'parameters':{}}])
    assert run.cases[0].status!='succeeded'
    assert not run.cases[0].artifacts
    assert 'schema' in run.cases[0].error['message']
