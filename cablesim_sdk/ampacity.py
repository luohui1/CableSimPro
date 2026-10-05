"""Presentation and provenance contract; contains no rating algorithm."""
from typing import Literal
from pydantic import Field, model_validator
from .base import StrictModel


class AmpacityBasis(StrictModel):
    kind: Literal['single_circuit', 'common_balanced', 'conditional_fixed_load'] = Field(description='Single circuit capability, common balanced current in all circuits, or conditional limit with other cable loads fixed.')
    display_name: str = Field(min_length=1, description='Display name including fixed load values where applicable.')
    varied_circuits: list[str] = Field(min_length=1, description='Circuit IDs whose currents vary during the rating search.')
    fixed_currents_a: dict[str, float] = Field(default_factory=dict, description='Fixed RMS currents by physical cable ID, in A; preserves unequal phase loads.')

    @model_validator(mode='after')
    def consistent(self):
        if len(set(self.varied_circuits)) != len(self.varied_circuits):
            raise ValueError('varied_circuits must be unique')
        if self.kind == 'single_circuit' and len(self.varied_circuits) != 1:
            raise ValueError('single_circuit must vary exactly one circuit')
        if any(v < 0 for v in self.fixed_currents_a.values()):
            raise ValueError('fixed_currents_a must be non-negative A')
        if bool(self.fixed_currents_a) != (self.kind == 'conditional_fixed_load'):
            raise ValueError('Only conditional capacity has fixed neighbouring loads')
        return self
