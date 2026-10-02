"""Compatibility input and transport adapter; field mathematics lives in a plugin."""
from typing import Literal
from pydantic import Field

from .schemas import StrictModel
from .methods import execute_reference


class FieldRequest(StrictModel):
    expected_revision: int = Field(ge=1)
    kind: Literal['thermal_fd', 'electric', 'magnetic']
    resolution: Literal[65, 129] = 65


def compute_fields(s, kind, n=65):
    return execute_reference('field-analysis', s, {'kind': kind, 'resolution': n}, 'x-cablesim.field')
