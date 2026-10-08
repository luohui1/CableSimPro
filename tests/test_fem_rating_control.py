"""Root-search control against an analytic I-squared thermal law, no FEM locally."""
from types import SimpleNamespace
import pytest
from cablesim_simulation import three_core_thermal as thermal


@pytest.mark.parametrize('mode,condition',[('individual','rating'),('simultaneous','rating-simultaneous')])
def test_single_circuit_limit_matches_hand_calculation(monkeypatch,mode,condition):
    # T=293.15 + I²/1000 K, limit=333.15 K: I=sqrt(40000)=200 A.
    document={'circuits':[{'id':'circuit/one','cable_type':'type/one'}],
        'cable_types':[{'id':'type/one','rating':{'max_conductor_temperature':{'normal':333.15}}}]}
    group=SimpleNamespace(cables=[{'id':'cable/one','current':100.}])
    prepared=(SimpleNamespace(iec={'rating_mode':mode}),document,group,None,
        [{'entity':'cable/one','circuit':'circuit/one'}],[])
    mesh=object();calls=[]
    def solve(value,saved_mesh):
        assert saved_mesh is mesh
        current=value[2].cables[0]['current'];calls.append(current)
        return {'cables':[{'entity':'cable/one','conductor_max_temperature_k':293.15+current**2/1000}],
            'energy_relative_residual':0.},None,None,None
    monkeypatch.setattr(thermal,'solve',solve)
    rows,trials=thermal.rating(prepared,mesh)
    from cablesim_sdk.ampacity import AmpacityBasis
    assert AmpacityBasis.model_validate(rows[0]['rating_basis']).kind=='single_circuit'
    assert rows[0]['value']==pytest.approx(200.,abs=1e-4)
    assert rows[0]['case']==condition and len(trials)==len(calls)
    assert group.cables[0]['current']==100.
