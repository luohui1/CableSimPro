"""Published full-case references and independent limiting/energy checks."""
from pathlib import Path
import json
import pytest
from cablesim_iec60287.tb880_wire_foil import WireFoilRating,rate


def raw(kind):return json.loads((Path(__file__).parent/'fixtures'/('tb880-wire-foil-'+kind+'.json')).read_text('utf-8'))


@pytest.mark.parametrize('kind,current',[('trefoil',990.5401450554),('flat',1460.4545417538)])
def test_both_full_reference_arrangements_and_energy_balance(kind,current):
    model=WireFoilRating.model_validate(raw(kind));r=rate(model)
    assert r['ampacity_a']==pytest.approx(current,abs=5e-5)
    expected=([21.7334261256,12.7998446427,4.3814875547],[21.7334261256,12.7998446427,4.3814875547],[21.7334261256,12.7998446427,4.3814875547]) if kind=='trefoil' else ([46.339394097, .4531725789,.2842802473],[45.7747093487,.6331964226,.2133339555],[45.7619829087,.4819647423,.1727253769])
    wd=r['dielectric_loss_per_core_w_m']
    for state,target in zip(r['states'],expected):
        for key,value in zip(('conductor_loss_w_m','screen_loss_w_m','foil_loss_w_m'),target):assert state[key]==pytest.approx(value,abs=1e-7)
        pc,ps,pf=[state[k] for k in ('conductor_loss_w_m','screen_loss_w_m','foil_loss_w_m')]
        rise=(pc+.5*wd)*r['t1_k_m_w']+(pc+ps+wd)*r['t2_k_m_w']+(pc+ps+pf+wd)*(r['t3_k_m_w']+state['t4_k_m_w'])
        assert state['conductor_temperature_k']-model.data['ambient_temperature_k']==pytest.approx(rise,abs=1e-8)
        assert state['conductor_temperature_k']<=model.data['conductor_temperature_k']+1e-8


def test_balanced_cross_bonding_removes_circulating_loss_without_removing_eddy_loss():
    value=raw('flat');value['minor_section_ratios']=[1,1,1];r=rate(WireFoilRating.model_validate(value))
    assert r['cross_bonding_factor']==0
    assert all(s['screen_loss_w_m']==0 and s['foil_loss_w_m']>0 for s in r['states'])


@pytest.mark.parametrize('failure',['missing-ratios','overlap','nan','reference-factor'])
def test_incomplete_or_fake_intermediate_inputs_refused(failure):
    value=raw('flat')
    if failure=='missing-ratios':value['minor_section_ratios']=None
    elif failure=='overlap':value['data']['foil_inner_diameter_m']=.08
    elif failure=='nan':value['minor_section_ratios']=[1,float('nan'),1.2]
    else:value['data']['lambda_foil']=.1
    with pytest.raises(ValueError):rate(WireFoilRating.model_validate(value))
