"""Independent half-space line-source comparison for the fixed-power buried study.

This contract reports a difference; it does not turn an analytical approximation
into an engineering acceptance certificate or a replacement FEM result.
"""
from __future__ import annotations

from math import isclose, sqrt
from typing import Literal
from pydantic import Field, model_validator
from ..foundation.contracts import Contract, Digest


Triple = tuple[float, float, float]
Matrix3 = tuple[Triple, Triple, Triple]


class LineSourceArgs(Contract):
    """No client source selector in v0.1.

    The host deterministically binds the newest successful current-revision
    fixed-power buried job and records its exact ID/digest in the result.
    """
    pass


class PhaseComparison(Contract):
    phase: Literal['A', 'B', 'C']
    source_power_w_m: float = Field(ge=0)
    fem_peak_temperature_c: float
    half_space_center_temperature_c: float
    difference_fem_minus_half_space_k: float
    relative_rise_difference_percent: float | None

    @model_validator(mode='after')
    def arithmetic(self):
        difference = self.fem_peak_temperature_c-self.half_space_center_temperature_c
        if not isclose(difference, self.difference_fem_minus_half_space_k, rel_tol=1e-10, abs_tol=1e-10):
            raise ValueError('PHASE_DIFFERENCE_MISMATCH')
        return self


class LineSourceComparison(Contract):
    schema_version: Literal['cablesim.line-source-crosscheck/1'] = 'cablesim.line-source-crosscheck/1'
    method: Literal['Dirichlet half-space line sources + concentric radial cable resistance'] = 'Dirichlet half-space line sources + concentric radial cable resistance'
    source_job_id: str = Field(pattern=r'^[0-9a-f-]{36}$')
    source_plugin_id: Literal['cablesim.buried-reference']
    source_plugin_version: str = Field(pattern=r'^\d+\.\d+\.\d+$')
    source_release_sha256: Digest
    source_project_revision: int = Field(ge=1, strict=True)
    source_model: Literal['three-cable fixed-power P1 FEM'] = 'three-cable fixed-power P1 FEM'
    analytical_geometry: Literal['semi-infinite homogeneous soil; isothermal ground; line-source cables'] = 'semi-infinite homogeneous soil; isothermal ground; line-source cables'
    finite_element_boundary: Literal['ambient temperature on ground, sides and bottom']
    ambient_temperature_c: float
    soil_k_w_m_k: float = Field(gt=0)
    conductor_to_jacket_surface_k_m_w: float = Field(gt=0)
    soil_resistance_matrix_k_m_w: Matrix3
    cable_centers_m: tuple[tuple[float, float], tuple[float, float], tuple[float, float]]
    cable_outer_radius_m: float = Field(gt=0)
    phases: tuple[PhaseComparison, PhaseComparison, PhaseComparison]
    maximum_absolute_difference_k: float = Field(ge=0)
    rms_difference_k: float = Field(ge=0)
    domain_scale: Literal[4, 8, 16]
    resolution: Literal[16, 24, 32]
    finite_domain_half_width_m: float = Field(gt=0)
    finite_domain_bottom_depth_m: float = Field(gt=0)
    independent_equation_family: Literal[True] = True
    experimental_validation: Literal[False] = False
    infinite_domain_accuracy_certified: Literal[False] = False
    mesh_independence_certified: Literal[False] = False
    engineering_acceptance: Literal[False] = False

    @model_validator(mode='after')
    def consistent(self):
        if tuple(p.phase for p in self.phases) != ('A', 'B', 'C'):
            raise ValueError('PHASE_ORDER')
        matrix = self.soil_resistance_matrix_k_m_w
        for i in range(3):
            if matrix[i][i] <= 0:
                raise ValueError('NONPOSITIVE_SELF_RESISTANCE')
            for j in range(3):
                if matrix[i][j] <= 0 or not isclose(matrix[i][j], matrix[j][i], rel_tol=1e-12, abs_tol=1e-12):
                    raise ValueError('INVALID_SOIL_MATRIX')
        powers = [p.source_power_w_m for p in self.phases]
        for i, phase in enumerate(self.phases):
            expected_temperature = self.ambient_temperature_c + powers[i]*self.conductor_to_jacket_surface_k_m_w + sum(matrix[i][j]*powers[j] for j in range(3))
            if not isclose(expected_temperature, phase.half_space_center_temperature_c, rel_tol=1e-10, abs_tol=1e-10):
                raise ValueError('ANALYTICAL_TEMPERATURE_MISMATCH')
            rise = expected_temperature-self.ambient_temperature_c
            expected_relative = 100*phase.difference_fem_minus_half_space_k/rise if rise else None
            if (expected_relative is None) != (phase.relative_rise_difference_percent is None) or expected_relative is not None and not isclose(expected_relative, phase.relative_rise_difference_percent, rel_tol=1e-10, abs_tol=1e-10):
                raise ValueError('RELATIVE_RISE_DIFFERENCE')
        differences = [p.difference_fem_minus_half_space_k for p in self.phases]
        maximum = max(abs(v) for v in differences)
        rms = sqrt(sum(v*v for v in differences)/3)
        if not isclose(maximum, self.maximum_absolute_difference_k, rel_tol=1e-10, abs_tol=1e-10) or not isclose(rms, self.rms_difference_k, rel_tol=1e-10, abs_tol=1e-10):
            raise ValueError('COMPARISON_METRICS')
        return self


def validate_line_source(raw):
    return LineSourceComparison.model_validate(raw)
