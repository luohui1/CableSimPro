"""Scalar constitutive checks; no mesher or FEM is executed on the host."""
from pathlib import Path
import sys
import pytest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'plugins/cablesim.simulation/src'))
from cablesim_simulation.thermal_input import DuctAirLaw


def test_iec_air_resistance_units_and_validity():
    law = DuctAirLaw(u=5.2,v=.91,y_per_k=.01,minimum_temperature_k=273.15,
                    maximum_temperature_k=423.15,source='independent scalar hand calculation')
    # 50 C, 40 mm: denominator 1 + .1*(.91+.5)*40 = 6.64.
    assert law.resistance(323.15,.04) == pytest.approx(5.2/6.64)
    assert law.resistance(373.15,.04) < law.resistance(323.15,.04)
    with pytest.raises(ValueError,match='有效范围'):
        law.resistance(423.16,.04)
    with pytest.raises(ValueError,match='直径'):
        law.resistance(323.15,0)


def test_duct_law_rejects_reversed_range():
    with pytest.raises(ValueError,match='上限'):
        DuctAirLaw(u=5.2,v=.91,y_per_k=.01,minimum_temperature_k=400.,
                   maximum_temperature_k=300.,source='validation test')
