"""Versioned engineering inputs. Public lengths are mm for cable layers, m for soil."""
from math import pi, sqrt
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, str_strip_whitespace=True)


class Cable(StrictModel):
    name: str = Field(default="演示 · Cu / XLPE 12/20 kV · 1×240", min_length=1, max_length=100)
    conductor: Literal["copper", "aluminium"] = "copper"
    area_mm2: float = Field(default=240, ge=50, le=1000)
    fill_factor: float = Field(default=0.92, ge=0.7, le=1)
    r20_ohm_km: float | None = Field(default=None, gt=0, le=10)
    conductor_screen_mm: float = Field(default=0.6, ge=0.1, le=2)
    insulation_mm: float = Field(default=5.5, ge=2, le=15)
    insulation_screen_mm: float = Field(default=0.7, ge=0.1, le=2)
    metallic_screen_mm: float = Field(default=0.5, ge=0.05, le=3)
    jacket_mm: float = Field(default=2.5, ge=1, le=8)
    insulation_rho_k_m_w: float = Field(default=3.5, ge=0.1, le=10)
    jacket_rho_k_m_w: float = Field(default=3.5, ge=0.1, le=10)
    semicon_rho_k_m_w: float = Field(default=2.5, ge=0.1, le=10)
    u0_kv: float = Field(default=12, ge=1, le=26)
    frequency_hz: Literal[50, 60] = 50
    relative_permittivity: float = Field(default=2.3, ge=1, le=10)
    tan_delta: float = Field(default=0.0004, ge=0, le=0.02)
    ac_extra_factor: float = Field(default=0.05, ge=0, le=1)
    screen_loss_factor: float = Field(default=0.05, ge=0, le=2)
    max_temperature_c: float = Field(default=90, ge=50, le=110)

    def radii_mm(self) -> list[float]:
        radius = sqrt(self.area_mm2 / (pi * self.fill_factor))
        result = [radius]
        for thickness in (self.conductor_screen_mm, self.insulation_mm,
                          self.insulation_screen_mm, self.metallic_screen_mm, self.jacket_mm):
            radius += thickness
            result.append(radius)
        return result


class Installation(StrictModel):
    arrangement: Literal["flat", "trefoil"] = "flat"
    depth_m: float = Field(default=0.8, ge=0.2, le=3)
    spacing_m: float = Field(default=0.12, ge=0.02, le=2)
    ambient_temperature_c: float = Field(default=25, ge=-20, le=60)
    soil_rho_k_m_w: float = Field(default=1.2, ge=0.3, le=5)

    def positions_m(self) -> list[list[float]]:
        s, h = self.spacing_m, self.depth_m
        if self.arrangement == "flat":
            return [[-s, h], [0.0, h], [s, h]]
        return [[0.0, h - s / sqrt(3)], [-s / 2, h + s / (2 * sqrt(3))],
                [s / 2, h + s / (2 * sqrt(3))]]


class Scenario(StrictModel):
    schema_version: Literal[1] = 1
    name: str = Field(default="中压馈线 · 方案 01", min_length=1, max_length=100)
    description: str = Field(default="单回路 / 均匀土壤 / 稳态负荷", max_length=1000)
    cable: Cable = Field(default_factory=Cable)
    installation: Installation = Field(default_factory=Installation)
    operating_current_a: float = Field(default=350, ge=0, le=3000)
    circuit_length_m: float = Field(default=1000, ge=1, le=100000)

    @model_validator(mode="after")
    def valid_geometry(self) -> "Scenario":
        radius_m = self.cable.radii_mm()[-1] / 1000
        if self.installation.spacing_m < 2 * radius_m:
            raise ValueError("电缆相互重叠：中心间距必须不小于电缆外径。")
        if min(p[1] for p in self.installation.positions_m()) < 10 * radius_m:
            raise ValueError("埋深过浅或三角排列超出地表：本近似要求每相中心埋深至少为外半径的 10 倍。")
        if self.installation.ambient_temperature_c >= self.cable.max_temperature_c:
            raise ValueError("环境温度必须低于导体允许最高温度。")
        return self


class SweepRequest(StrictModel):
    scenario: Scenario
    parameter: Literal["soil_rho_k_m_w", "ambient_temperature_c", "depth_m", "spacing_m"]
    values: list[float] = Field(min_length=2, max_length=12)
