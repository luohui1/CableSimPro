"""Contract failures only; native numerical evidence is in plugin-tests."""
from pathlib import Path
import json
import pytest
from backend.schemas import Scenario
from backend.plugins.electrothermal_contract import ElectrothermalArgs, ElectrothermalSummary, preflight


def args(**changes):
    return dict(mode='ampacity',alpha20_per_k=.00393,conductor_k_w_m_k=380.,metal_screen_k_w_m_k=380.,
        coefficient_basis='Synthetic test inputs; not manufacturer data',acknowledged_coefficient_model=True) | changes


@pytest.mark.parametrize('change',[
    {'alpha20_per_k':True},{'alpha20_per_k':float('nan')},{'alpha20_per_k':-.1},
    {'alpha20_per_k':.02},{'conductor_k_w_m_k':0},{'metal_screen_k_w_m_k':True},
    {'acknowledged_coefficient_model':1},{'acknowledged_coefficient_model':False},
    {'coefficient_basis':'     '},{'coefficient_basis':'abc'}, {'mode':'IEC-certified'},
    {'r20_ohm_km':.0754},{'current_a':700},{'maximum_search_current_a':float('inf')},
    {'maximum_search_current_a':0},{'compare_domain_scale':8},
    {'mode':'operating-point','compare_domain_scale':16},
    {'domain_scale':16,'compare_domain_scale':8},
])
def test_invalid_electrothermal_arguments_rejected(change):
    with pytest.raises(ValueError):
        ElectrothermalArgs.model_validate(args(**change))


def test_missing_r20_never_uses_the_legacy_area_fallback():
    with pytest.raises(ValueError,match='R20_REQUIRED'):
        preflight(Scenario(),args())
    s=Scenario();s.cable.r20_ohm_km=.0754
    assert preflight(s,args())[0].cable.r20_ohm_km==.0754


def test_required_basis_alpha_and_consent_have_no_defaults():
    with pytest.raises(ValueError):ElectrothermalArgs(mode='ampacity')


def test_checked_in_electrothermal_summary_schema():
    path=Path(__file__).resolve().parents[2]/'plugin-spec/electrothermal-summary.schema.json'
    assert json.loads(path.read_text('utf-8'))==ElectrothermalSummary.model_json_schema()
