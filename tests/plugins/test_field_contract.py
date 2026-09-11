"""Synthetic structural fixtures only; numerical evidence is in native integration."""
from copy import deepcopy
import pytest
from backend.plugins.field_contract import ThermalField, validate_thermal_projection


def sample():
    return ThermalField(points=[(0,0,0),(1,0,0),(0,1,0)],triangles=[(0,1,2)]*6,
                        domain_ids=[1,2,3,4,5,6],values=[300,310,320]).model_dump(mode='json')


@pytest.mark.parametrize('patch',[
 {'unit':'degC'}, {'coordinate_unit':'mm'}, {'association':'cell'},
 {'values':[300,310]}, {'values':[300,-1,320]}, {'values':[300,float('nan'),320]},
 {'triangles':[(0,1,3)]*6}, {'triangles':[(0,1,1)]*6}, {'domain_ids':[1]*6},
 {'points':[(0,0,0),(1,0,1),(0,1,0)]}, {'certified':True},
 {'triangles':[(False,1,2)]*6},
])
def test_malformed_field_is_not_renderable(patch):
    payload=sample();payload.update(patch)
    with pytest.raises(ValueError):ThermalField.model_validate(payload)


def test_summary_must_match_exact_field():
    payload=sample();summary={'nodes':3,'elements':6,'maximum_temperature_c':46.85}
    assert validate_thermal_projection(payload,summary).values[-1]==320
    with pytest.raises(ValueError,match='SUMMARY_TEMPERATURE'):
        validate_thermal_projection(payload,dict(summary,maximum_temperature_c=100))
    with pytest.raises(ValueError,match='SUMMARY_COUNTS'):
        validate_thermal_projection(payload,dict(summary,nodes=4))
