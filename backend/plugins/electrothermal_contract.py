"""Explicit coefficient-loss electrothermal study; not a complete IEC/EM solver."""
from math import isclose, log, pi, fsum
from typing import Annotated, Literal
from pydantic import Field, field_validator, model_validator
from ..foundation.contracts import Contract
from ..schemas import Scenario
from .buried_contract import BuriedField

Triple = tuple[float, float, float]
Positive = Annotated[float, Field(gt=0, strict=True)]


class ElectrothermalArgs(Contract):
    mode: Literal['operating-point', 'ampacity']
    alpha20_per_k: float = Field(ge=0, le=.01, strict=True)
    conductor_k_w_m_k: float = Field(gt=1, le=500, strict=True)
    metal_screen_k_w_m_k: float = Field(gt=1, le=500, strict=True)
    coefficient_basis: str = Field(min_length=5, max_length=500)
    acknowledged_coefficient_model: Literal[True]
    domain_scale: Literal[4, 8, 16] = 8
    resolution: Literal[16, 24, 32] = 16
    compare_domain_scale: Literal[8, 16] | None = None
    domain_current_tolerance_percent: float = Field(default=.5, ge=.01, le=5, strict=True)
    maximum_search_current_a: float = Field(default=3000., gt=0, le=3000, strict=True)

    @field_validator('acknowledged_coefficient_model', mode='before')
    @classmethod
    def real_consent(cls, value):
        if value is not True:
            raise ValueError('EXPLICIT_COEFFICIENT_MODEL_ACK_REQUIRED')
        return value

    @field_validator('coefficient_basis')
    @classmethod
    def meaningful_basis(cls, value):
        if len(value.strip()) < 5:
            raise ValueError('COEFFICIENT_BASIS_REQUIRED')
        return value.strip()

    @model_validator(mode='after')
    def comparison(self):
        if self.compare_domain_scale is not None and (self.mode != 'ampacity' or self.compare_domain_scale <= self.domain_scale):
            raise ValueError('COMPARE_A_LARGER_DOMAIN_FOR_AMPACITY')
        return self


def preflight(scenario, arguments):
    s = Scenario.model_validate(scenario)
    args = ElectrothermalArgs.model_validate(arguments)
    if s.cable.r20_ohm_km is None:
        raise ValueError('R20_REQUIRED: save an explicit 20 C resistance; no area-based fallback')
    return s, args


class CurrentBracket(Contract):
    lower_a: float = Field(ge=0)
    upper_a: float = Field(gt=0)
    lower_max_temperature_c: float
    upper_max_temperature_c: float
    tolerance_a: Literal[.01] = .01
    temperature_tolerance_k: Literal[.005] = .005
    evaluations: int = Field(ge=2, le=100, strict=True)


class DomainComparison(Contract):
    domain_scale: Literal[8, 16]
    ampacity_a: Positive
    primary_current_max_temperature_c: float
    current_change_percent: float
    pairwise_tolerance_percent: float = Field(ge=.01, le=5)
    within_pairwise_tolerance: bool = Field(strict=True)
    mesh_independence_certified: Literal[False] = False
    infinite_domain_accuracy_certified: Literal[False] = False
    nodes: int = Field(gt=0, strict=True)
    elements: int = Field(gt=0, strict=True)


class ElectrothermalSummary(Contract):
    schema_version: Literal['cablesim.electrothermal-reference/1'] = 'cablesim.electrothermal-reference/1'
    method: Literal['P1 FEM + mean-conductor linear R(T) + specified loss coefficients'] = 'P1 FEM + mean-conductor linear R(T) + specified loss coefficients'
    mode: Literal['operating-point', 'ampacity']
    ampacity_a: Positive | None
    evaluated_current_a: float = Field(ge=0)
    temperature_limit_c: float
    maximum_temperature_c: float
    conductor_max_temperatures_c: Triple
    conductor_mean_temperatures_c: Triple
    conductor_ac_resistances_ohm_km: Triple
    conductor_losses_w_m: Triple
    screen_losses_w_m: Triple
    dielectric_losses_w_m: Triple
    ambient_temperature_c: float
    source_heat_w_m: float = Field(ge=0)
    boundary_heat_w_m: float
    energy_relative_residual: float | None
    free_equation_residual_inf_w_m: float = Field(ge=0)
    feedback_residual_w_m: float = Field(ge=0)
    feedback_spectral_radius: float = Field(ge=0, lt=1)
    feedback_iterations: int = Field(ge=1, le=200, strict=True)
    alpha20_per_k: float = Field(ge=0, le=.01)
    r20_ohm_km: float = Field(gt=0)
    ac_extra_factor: float = Field(ge=0)
    screen_loss_factor: float = Field(ge=0)
    capacitance_f_m: float = Field(gt=0)
    coefficient_basis: str
    within_temperature_limit: bool = Field(strict=True)
    bracket: CurrentBracket | None
    domain_comparison: DomainComparison | None = None
    domain_scale: Literal[4, 8, 16]
    resolution: Literal[16, 24, 32]
    half_width_m: float = Field(gt=0)
    bottom_depth_m: float = Field(gt=0)
    soil_k_w_m_k: float = Field(gt=0)
    nodes: int = Field(gt=0, strict=True)
    elements: int = Field(gt=0, strict=True)
    domains: Literal[19] = 19
    complete_iec_60287: Literal[False] = False
    electromagnetic_field_solved: Literal[False] = False

    @model_validator(mode='after')
    def check_balances(self):
        powers = self.conductor_losses_w_m + self.screen_losses_w_m + self.dielectric_losses_w_m
        if min(powers) < 0 or min(self.conductor_ac_resistances_ohm_km) <= 0:
            raise ValueError('NEGATIVE_LOSS_OR_RESISTANCE')
        total = sum(powers)
        if not isclose(total, self.source_heat_w_m, rel_tol=1e-9, abs_tol=1e-9):
            raise ValueError('ELECTROTHERMAL_POWER_SUM')
        difference = abs(total-self.boundary_heat_w_m)
        if difference > 1e-6*max(total, 1) or self.free_equation_residual_inf_w_m > 1e-6*max(total, 1):
            raise ValueError('ELECTROTHERMAL_ENERGY_BALANCE')
        expected = difference/total if total else None
        if (expected is None) != (self.energy_relative_residual is None) or expected is not None and not isclose(expected, self.energy_relative_residual, rel_tol=1e-6, abs_tol=1e-12):
            raise ValueError('ELECTROTHERMAL_RELATIVE_BALANCE')
        for mean, peak, r, p, screen in zip(self.conductor_mean_temperatures_c, self.conductor_max_temperatures_c, self.conductor_ac_resistances_ohm_km, self.conductor_losses_w_m, self.screen_losses_w_m):
            if mean > peak+1e-7:
                raise ValueError('MEAN_EXCEEDS_PEAK')
            expected_r = self.r20_ohm_km*(1+self.ac_extra_factor)*(1+self.alpha20_per_k*(mean-20))
            if not isclose(r, expected_r, rel_tol=1e-8, abs_tol=1e-12) or not isclose(p, self.evaluated_current_a**2*r/1000, rel_tol=1e-8, abs_tol=1e-9) or not isclose(screen, p*self.screen_loss_factor, rel_tol=1e-8, abs_tol=1e-9):
                raise ValueError('LOSS_TEMPERATURE_FEEDBACK_MISMATCH')
        if self.feedback_residual_w_m > 1e-7*max(total, 1):
            raise ValueError('FEEDBACK_NOT_CONVERGED')
        peak = max(self.conductor_max_temperatures_c)
        if peak > 150:
            raise ValueError('REFERENCE_TEMPERATURE_RANGE_EXCEEDED')
        if self.within_temperature_limit != (peak <= self.temperature_limit_c):
            raise ValueError('LIMIT_STATUS_MISMATCH')
        if self.mode == 'ampacity':
            b = self.bracket
            if not b or self.ampacity_a is None or not self.within_temperature_limit:
                raise ValueError('MISSING_AMPACITY_BRACKET')
            if self.ampacity_a != self.evaluated_current_a or self.ampacity_a != b.lower_a or not 0 < b.upper_a-b.lower_a <= b.tolerance_a or b.lower_max_temperature_c > self.temperature_limit_c or b.upper_max_temperature_c <= self.temperature_limit_c or not isclose(peak, b.lower_max_temperature_c, abs_tol=1e-7) or self.temperature_limit_c-peak > b.temperature_tolerance_k:
                raise ValueError('INVALID_AMPACITY_BRACKET')
        elif self.ampacity_a is not None or self.bracket is not None or self.domain_comparison is not None:
            raise ValueError('OPERATING_POINT_IS_NOT_AMPACITY')
        if self.domain_comparison:
            c = self.domain_comparison
            delta = 100*(c.ampacity_a-self.ampacity_a)/self.ampacity_a
            if c.domain_scale <= self.domain_scale or abs(delta-c.current_change_percent) > 1e-8 or c.within_pairwise_tolerance != (abs(delta) <= c.pairwise_tolerance_percent):
                raise ValueError('DOMAIN_COMPARISON_MISMATCH')
        return self


def validate_electrothermal(raw_field, raw_summary, scenario, arguments):
    field = BuriedField.model_validate(raw_field)
    summary = ElectrothermalSummary.model_validate(raw_summary)
    s, args = preflight(scenario, arguments)
    if (summary.mode != args.mode or summary.alpha20_per_k != args.alpha20_per_k or summary.r20_ohm_km != s.cable.r20_ohm_km or summary.ac_extra_factor != s.cable.ac_extra_factor or summary.screen_loss_factor != s.cable.screen_loss_factor or summary.temperature_limit_c != s.cable.max_temperature_c or summary.coefficient_basis != args.coefficient_basis or summary.ambient_temperature_c != s.installation.ambient_temperature_c or summary.domain_scale != args.domain_scale or summary.resolution != args.resolution):
        raise ValueError('ELECTRICAL_INPUT_BINDING')
    if summary.mode == 'operating-point' and summary.evaluated_current_a != s.operating_current_a:
        raise ValueError('OPERATING_CURRENT_BINDING')
    radii = s.cable.radii_mm()
    capacitance = 2*pi*8.8541878128e-12*s.cable.relative_permittivity/log(radii[2]/radii[1])
    wd = 2*pi*s.cable.frequency_hz*capacitance*(1000*s.cable.u0_kv)**2*s.cable.tan_delta
    if not isclose(summary.capacitance_f_m, capacitance, rel_tol=1e-12) or any(not isclose(v, wd, rel_tol=1e-9, abs_tol=1e-12) for v in summary.dielectric_losses_w_m):
        raise ValueError('DIELECTRIC_INPUT_BINDING')
    positions = s.installation.positions_m()
    scale = max(max(y for x,y in positions), max(abs(x) for x,y in positions)+radii[-1]/1000)
    if not isclose(summary.half_width_m, args.domain_scale*scale, rel_tol=1e-12) or not isclose(summary.bottom_depth_m, args.domain_scale*scale, rel_tol=1e-12):
        raise ValueError('DOMAIN_EXTENT_BINDING')
    if (field.cable_centers_m != tuple(tuple(p) for p in s.installation.positions_m()) or abs(field.cable_outer_radius_m-s.cable.radii_mm()[-1]/1000) > 1e-12 or summary.soil_k_w_m_k != 1/s.installation.soil_rho_k_m_w):
        raise ValueError('GEOMETRY_INPUT_BINDING')
    if (len(field.points) != summary.nodes or len(field.triangles) != summary.elements or field.half_width_m != summary.half_width_m or field.bottom_depth_m != summary.bottom_depth_m or abs(max(field.values)-273.15-summary.maximum_temperature_c) > 1e-7):
        raise ValueError('FIELD_SUMMARY_BINDING')
    if any(abs(field.values[i]-273.15-summary.ambient_temperature_c) > 1e-7 for i in field.boundary_nodes):
        raise ValueError('FIELD_BOUNDARY_TEMPERATURE')
    if summary.mode == 'ampacity' and summary.bracket.upper_a > args.maximum_search_current_a:
        raise ValueError('SEARCH_LIMIT_BINDING')
    for phase, domain in enumerate((1, 7, 13)):
        areas, energies = [], []
        for tri, tag in zip(field.triangles, field.domain_ids):
            if tag != domain:
                continue
            a,b,c = (field.points[i] for i in tri)
            area = abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2
            areas.append(area); energies.append(area*sum(field.values[i] for i in tri)/3)
        actual_mean = fsum(energies)/fsum(areas)-273.15
        if abs(actual_mean-summary.conductor_mean_temperatures_c[phase]) > 1e-7:
            raise ValueError('FIELD_MEAN_TEMPERATURE')
        nodes = {i for tri, tag in zip(field.triangles, field.domain_ids) if tag == domain for i in tri}
        if abs(max(field.values[i] for i in nodes)-273.15-summary.conductor_max_temperatures_c[phase]) > 1e-7:
            raise ValueError('FIELD_PHASE_TEMPERATURE')
    if (summary.domain_comparison is None) != (args.compare_domain_scale is None):
        raise ValueError('MISSING_DOMAIN_COMPARISON')
    if summary.domain_comparison and (summary.domain_comparison.domain_scale != args.compare_domain_scale or summary.domain_comparison.pairwise_tolerance_percent != args.domain_current_tolerance_percent):
        raise ValueError('DOMAIN_COMPARISON_BINDING')
    return field, summary
