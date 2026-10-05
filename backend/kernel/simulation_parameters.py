"""Typed presentation/admission contracts for the three declared research tasks.

These models validate units/shape; plugin preflight remains the authority for
physical applicability and the relationship to saved domain facts.
"""
from typing import Literal
from pydantic import Field, model_validator
from cablesim_sdk.simulation import Material, MeshControls, Condition, Time
from cablesim_sdk.simulation_artifacts import LossTemperatureTable
from ..schemas import StrictModel


class ElectricalHeatSource(StrictModel):
    ac_extra_factor: float = Field(ge=0, description='AC resistance excess over frozen DC resistance, dimensionless.')
    sheath_loss_factor: float = Field(ge=0, description='Sheath/conductor loss ratio, dimensionless; explicit source required.')
    sheath_layer_uid: str | None = Field(description='Actual non-conductor layer UID for sheath heat, or null for zero sheath loss.')
    source: str = Field(min_length=1, description='Saved coefficient calculation or engineering source.')


class CableHeatOptions(StrictModel):
    electrical: ElectricalHeatSource | None
    fixed_layer_heat_w_m: dict[str, float] = Field(description='Every conductor/layer UID including explicit zero; power W/m.')
    prescribed_core_temperature_k: float | None = Field(default=None, gt=0, description='Prescribed absolute core temperature K; cannot coexist with conductor heat.')
    equivalent_layers_acknowledged: bool = Field(strict=True, description='Explicit acknowledgement of sourced equivalent thermal layers.')


class ThermalBoundary(StrictModel):
    kind: Literal['temperature', 'convection', 'insulated']
    temperature_k: float | None = Field(description='Boundary absolute temperature K, null only where the selected kind permits.')
    h_w_m2_k: float | None = Field(default=None, gt=0, description='Convective heat transfer coefficient W/(m²*K).')
    emissivity: float | None = Field(default=None, ge=0, le=1, description='Dimensionless emissivity; plugin validates whether radiation is supported.')


class DuctAirResistance(StrictModel):
    resistance_k_m_w: float = Field(gt=0, description='Sourced equivalent air thermal resistance K*m/W.')
    source: str = Field(min_length=1, description='IEC run/engineering source for the equivalent air resistance.')


class ThermalDomainOptions(StrictModel):
    section_id: str = Field(min_length=1, description='Existing saved domain section identity.')
    load_id: str = Field(min_length=1, description='Existing saved time-series/cyclic/emergency load identity.')
    bounds_m: tuple[float,float,float,float] | None = Field(description='Finite x0,z0,x1,z1 bounds in m; null for an explicitly supported intrinsic boundary.')
    boundaries: dict[str, ThermalBoundary] = Field(description='Boundary selectors supported by the saved section; temperatures K.')
    per_cable: dict[str, CableHeatOptions] = Field(description='Complete thermal source settings indexed by each placed cable UID.')
    duct_air: dict[str, DuctAirResistance] = Field(description='One equivalent air resistance/source per saved duct UID.')
    source: str = Field(min_length=1, description='Engineering source of the complete boundary/source assumptions.')


class AirHeatCapacity(StrictModel):
    heat_capacity_j_m3_k: float = Field(gt=0, description='Equivalent air volumetric heat capacity J/(m³*K).')
    source: str = Field(min_length=1, description='Engineering or published source for this capacity.')


class TransientParameters(StrictModel):
    domain_options: ThermalDomainOptions
    time: Time = Field(description='Initial temperature K, time step s, step count and BDF order.')
    mesh: MeshControls = Field(description='Mesh lengths m, explicit node limit; P1 transient elements.')
    resistance_temperature_k: dict[str, float] = Field(description='Frozen resistance temperature by cable UID, absolute K.')
    duct_air_capacity: dict[str, AirHeatCapacity] = Field(default_factory=dict)


class MaterialTemperatureState(StrictModel):
    temperature_k: float = Field(gt=0, description='Electrical material state temperature K.')
    nonconducting: bool = Field(strict=True, description='Explicit nonconducting assumption; metals cannot be silently removed.')
    source: str = Field(min_length=1, description='Engineering/material-state source.')


class ElectromagneticBackground(Material):
    conductivity_s_m: float = Field(ge=0, description='Exterior conductivity S/m; explicit zero for nonconducting exterior.')
    relative_permeability: float = Field(gt=0, description='Exterior relative magnetic permeability, dimensionless.')


class ElectromagneticDomainOptions(StrictModel):
    section_id: str = Field(min_length=1, description='Saved section identity; geometry comes from that section.')
    load_id: str = Field(min_length=1, description='Saved steady RMS current load identity; A.')
    bounds_m: tuple[float,float,float,float] = Field(description='Finite x0,z0,x1,z1 computational bounds, m.')
    background: ElectromagneticBackground
    material_states: dict[str, MaterialTemperatureState]
    probes_m: list[tuple[float,float]] = Field(max_length=100, description='Probe x,z coordinates in m.')
    source: str = Field(min_length=1, description='Source of finite domain and electromagnetic assumptions; bonding/phase come from saved domain.')


class SheathLossParameters(StrictModel):
    electromagnetic_options: ElectromagneticDomainOptions
    mesh: MeshControls = Field(description='Native field mesh lengths m, node limit and order.')
    temperature_table: LossTemperatureTable | None = Field(default=None, description='Explicit native temperature tensor, °C axes and dimensionless current scale; no extrapolation.')


class MaterialValidity(StrictModel):
    minimum_temperature_k: float = Field(gt=0, description='Lower valid absolute temperature, K.')
    maximum_temperature_k: float = Field(gt=0, description='Upper valid absolute temperature, K.')
    source: str = Field(min_length=1, description='Published or engineering material law validity source.')

    @model_validator(mode='after')
    def interval(self):
        if self.maximum_temperature_k <= self.minimum_temperature_k:
            raise ValueError('maximum_temperature_k：有效温度上限必须大于下限，单位K。')
        return self


class CoupledParameters(StrictModel):
    electromagnetic_options: ElectromagneticDomainOptions
    mesh: MeshControls = Field(description='Field mesh lengths m; P1 thermal transfer.')
    thermal_boundaries: list[Condition] = Field(min_length=1, description='Thermal conditions; temperature values K, convection h W/(m²*K).')
    material_validity: dict[str, MaterialValidity]
    initial_temperature_k: float = Field(gt=0, description='Initial absolute temperature K.')
    temperature_tolerance_k: float = Field(default=1e-4,gt=0,le=.01, description='Iteration temperature update tolerance K.')
    power_relative_tolerance: float = Field(default=1e-6,gt=0,le=1e-3, description='Dimensionless relative power update tolerance.')
    maximum_iterations: int = Field(default=60,ge=2,le=200, description='Bounded coupled iteration count.')
    relaxation: float = Field(default=.7,gt=0,le=1, description='Dimensionless relaxation factor in (0,1].')


from cablesim_sdk.iec_fem import ComparisonParameters

SIMULATION_PARAMETER_MODELS = {'iec-fem-comparison': ComparisonParameters, 'transient-temperature': TransientParameters,
    'sheath-losses': SheathLossParameters, 'electrothermal-steady': CoupledParameters}
