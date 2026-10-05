"""Resolved three-core thermal geometry and independent total-power check."""
from pathlib import Path
import sys
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT/'plugins/cablesim.simulation/src'),str(ROOT/'plugins/cablesim.iec60287/src'),
               str(ROOT/'plugins/cablesim.iec60287/tests')]
from test_three_core import document,parameters
from cablesim_simulation.three_core_thermal import prepare,solve


def case():
    d = document()
    for material in d['materials']:
        name = material['id'].split('/')[-1]
        material.update(label=name,category={'cu':'conductor','steel':'metal','soil':'soil','duct':'duct',
            'fibre':'filler','semi':'semiconductor','xlpe':'insulation','pvc':'polymer'}[name])
        if name=='steel':material['thermal_resistivity'] = .0133
    s = d['sections'][0]
    s['enclosures'] = [{'id':'enclosure/one','type':'duct','x':0.,'z':-1.2,'material':'material/duct',
                       'inner_diameter':.14,'outer_diameter':.16,'contains':['cable/c1']}]
    s['placements'][0]['enclosure'] = 'enclosure/one'
    d['load_cases'][0]['currents']['circuit/c1'] = 250.
    return d,{'domain_options':{'section_id':s['id'],'load_id':'load/steady','bounds_m':[-4.,-4.,4.,0.],
            'equivalent_layers_acknowledged':True,'source':'Explicit three-core thermal envelope hand-check; steel rho=.0133 K m/W from Alliander samSteel reference.'},
        'iec':parameters(),'mesh':{'size_m':.002,'far_size_m':.3,'transition_m':.3,'max_nodes':120000,'field_order':1,'minimum_circle_segments':64}}


@pytest.mark.parametrize('order',[1,2])
def test_resolved_three_core_heat_is_not_three_separate_single_core_cables(order):
    d,p = case();p['mesh']['field_order'] = order;prepared = prepare(d,p)
    result,mesh,t,samples = solve(prepared)
    cable = result['cables'][0]
    rdc = 6.01e-5*(1+.00393*(cable['conductor_mean_temperature_k']-293.15))
    detail = cable['electrical_details']
    conductor = 3*250**2*rdc*(1+detail['ys']+detail['yp'])
    expected = conductor*(1+cable['lambda1']+cable['lambda2'])+cable['dielectric_heat_w_m']
    assert result['source_heat_w_m'] == pytest.approx(expected,rel=1e-11)
    assert result['boundary_heat_w_m'] == pytest.approx(expected,rel=1e-6)
    assert len(samples)==3 and len({tuple(s['point_m']) for s in samples})==3
    uids = {r['uid'] for r in mesh['regions']}
    assert len([u for u in uids if u.endswith('/conductor')])==3
    assert len([u for u in uids if '/common-' in u])==5
    assert 'enclosure/one/air' in uids
    assert max(t)>298.15
    assert result['physical_residual_inf_w_m']<1e-5
