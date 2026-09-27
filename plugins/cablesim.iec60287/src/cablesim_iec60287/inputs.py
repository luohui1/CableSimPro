"""Input contract for the IEC 60287 single-core buried method.

All quantities are SI (m, Ω/m, Ω·m, K·m/W, V, Hz, °C for absolute temperatures).
There are deliberately no defaults for physical data: a missing value is a refusal,
never a silent assumption. Only solver controls have defaults.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False, frozen=True)


class Conductor(Strict):
    # Milliken (segmental) conductors need other skin/proximity treatment; not implemented.
    construction: Literal['round_stranded'] = 'round_stranded'
    diameter_m: float = Field(gt=0, le=0.2)
    r20_ohm_m: float = Field(gt=0, le=1e-2, description='d.c. resistance at 20 °C')
    alpha20_per_k: float = Field(gt=0, lt=0.01)
    ks: float = Field(gt=0, le=1, description='skin-effect coefficient, supplied by the user from the standard table')
    kp: float = Field(gt=0, le=1, description='proximity-effect coefficient, supplied by the user from the standard table')


class Insulation(Strict):
    inner_screen_thickness_m: float = Field(ge=0, le=0.01)
    thickness_m: float = Field(gt=0, le=0.05)
    outer_screen_thickness_m: float = Field(ge=0, le=0.01)
    relative_permittivity: float = Field(ge=1, le=10)
    tan_delta: float = Field(ge=0, le=0.1)
    inner_screen_rho_k_m_w: float = Field(gt=0, le=20)
    rho_k_m_w: float = Field(gt=0, le=20)
    outer_screen_rho_k_m_w: float = Field(gt=0, le=20)


class Sheath(Strict):
    """Smooth tubular metallic sheath. Wire screens and corrugated sheaths are refused."""
    geometry: Literal['smooth_tube'] = 'smooth_tube'
    thickness_m: float = Field(gt=0, le=0.01)
    resistivity20_ohm_m: float = Field(gt=0, le=1e-6)
    alpha20_per_k: float = Field(gt=0, lt=0.01)


class Oversheath(Strict):
    thickness_m: float = Field(gt=0, le=0.02)
    rho_k_m_w: float = Field(gt=0, le=20)


class Duct(Strict):
    """One cable per duct; ducts touching in trefoil."""
    outer_diameter_m: float = Field(gt=0, le=1)
    inner_diameter_m: float = Field(gt=0, le=1)
    rho_k_m_w: float = Field(gt=0, le=20)
    # Air-gap constants U, V, Y of the empirical T4' formula; taken by the user from the standard table.
    u: float = Field(gt=0)
    v: float = Field(ge=0)
    y_per_k: float = Field(ge=0)
    initial_mean_air_temperature_c: float = Field(ge=-20, le=120)

    @model_validator(mode='after')
    def ordered(self):
        if self.inner_diameter_m >= self.outer_diameter_m:
            raise ValueError('管道内径必须小于外径。')
        return self


class Installation(Strict):
    arrangement: Literal['trefoil_touching'] = 'trefoil_touching'
    environment: Literal['direct_buried', 'buried_ducts']
    depth_m: float = Field(gt=0, le=10, description='axis depth L of the cable (group) below ground surface')
    soil_rho_k_m_w: float = Field(gt=0, le=10)
    ambient_temperature_c: float = Field(ge=-20, le=60)
    # Direct burial only: the simplified ln(2u) form or the exact ln(u+sqrt(u^2-1)) form.
    t4_form: Literal['simplified', 'exact'] | None = None
    duct: Duct | None = None

    @model_validator(mode='after')
    def consistent(self):
        if self.environment == 'direct_buried':
            if self.t4_form is None:
                raise ValueError('直埋必须明确选择 T4 公式形式（simplified 或 exact）。')
            if self.duct is not None:
                raise ValueError('直埋工况不能包含管道参数。')
        else:
            if self.duct is None:
                raise ValueError('管道敷设必须提供管道参数。')
            if self.t4_form is not None:
                raise ValueError('管道敷设的 T4 由管内空气、管壁与管外土壤三段组成，不选择 t4_form。')
        return self


class Bonding(Strict):
    """Sheath bonding and eddy-current treatment.

    both_ends + ignored   : λ1 = λ1'                        (circulating current only)
    both_ends + trefoil   : λ1 = λ1' + F·λ1''  (CIGRE TB880 Guidance Point 31 extension of F)
    single_point + trefoil: λ1 = λ1''                       (no circulating current)
    """
    scheme: Literal['both_ends', 'single_point']
    eddy: Literal['ignored', 'trefoil']

    @model_validator(mode='after')
    def meaningful(self):
        if self.scheme == 'single_point' and self.eddy == 'ignored':
            raise ValueError('单点接地时护套损耗只来自涡流，不能忽略涡流。')
        return self


class Solver(Strict):
    initial_sheath_temperature_c: float = Field(ge=-20, le=150)
    current_tolerance_a: float = Field(default=1e-3, gt=0, le=10)
    max_iterations: int = Field(default=50, ge=1, le=500)


class Rating(Strict):
    """Steady-state rating, 100 % load factor, three equally loaded single-core cables."""
    schema_version: Literal['cablesim.iec60287.single-core/1'] = 'cablesim.iec60287.single-core/1'
    frequency_hz: float = Field(gt=0, le=1000)
    phase_voltage_v: float = Field(gt=0, le=500_000, description='U0, r.m.s. conductor-to-screen voltage')
    max_conductor_temperature_c: float = Field(gt=0, le=250)
    conductor: Conductor
    insulation: Insulation
    sheath: Sheath
    oversheath: Oversheath
    installation: Installation
    bonding: Bonding
    solver: Solver

    @model_validator(mode='after')
    def admissible(self):
        if self.installation.ambient_temperature_c >= self.max_conductor_temperature_c:
            raise ValueError('环境温度必须低于导体允许最高温度。')
        return self
