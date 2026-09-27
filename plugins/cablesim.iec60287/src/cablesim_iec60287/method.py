"""IEC 60287 steady-state rating, single-core cables, touching trefoil, buried.

Scope (anything else is refused, never approximated):
- IEC 60287-1-1:2023 conductor resistance, skin (x_s <= 2.8) and proximity effect for
  round stranded conductors, capacitance, dielectric loss, sheath reactance, sheath
  circulating-current loss (both ends bonded) and trefoil sheath eddy-current loss
  (clause 5.3.7.1), with the clause 5.3.6 F factor applied to both-ends bonding as
  extended by CIGRE TB 880 Guidance Point 31.
- IEC 60287-2-1:2023 T1 as three concentric layers, T3 of the oversheath, T4 of touching
  trefoil in uniform soil (simplified or exact radical) or in touching ducts
  (air gap + duct wall + external soil).
- 100 % load factor, no armour (T2 = 0, lambda2 = 0), no soil drying, uniform soil.

The rating equation depends on the sheath temperature through R_s and the eddy terms;
it is solved by fixed-point iteration on the sheath (and duct air) temperature, as in
CIGRE TB 880. Every intermediate quantity is returned so it can be checked
independently. SI units throughout; the two empirical formulas that are written in
millimetres (C_gs and T4') convert explicitly at the formula boundary.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from math import isfinite, log, pi, sqrt

from .inputs import Rating

METHOD_ID = 'cablesim.iec60287.single-core-trefoil-buried'
METHOD_VERSION = '0.1.0'
X_LIMIT = 2.8  # skin/proximity expressions are only given for x <= 2.8
# Oversheath T3 of touching single-core cables buried in trefoil is increased by 1.6
# (IEC 60287-2-1); a single cable inside its own duct is not.
T3_MULTIPLIER = {'direct_buried': 1.6, 'buried_ducts': 1.0}


class RatingRefused(ValueError):
    """The input is outside this method's scope or has no admissible solution."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class Geometry:
    conductor_m: float
    over_inner_screen_m: float
    over_insulation_m: float
    over_outer_screen_m: float
    sheath_mean_m: float
    over_sheath_m: float
    overall_m: float
    axis_spacing_m: float


@dataclass(frozen=True)
class Electrical:
    r_dc_max_ohm_m: float
    skin_x: float
    skin_ys: float
    proximity_x: float
    proximity_yp: float
    r_ac_max_ohm_m: float
    capacitance_f_m: float
    dielectric_loss_w_m: float
    sheath_r20_ohm_m: float
    sheath_reactance_ohm_m: float


@dataclass(frozen=True)
class SheathLoss:
    sheath_temperature_c: float
    sheath_r_ohm_m: float
    circulating: float          # lambda1'
    eddy_raw: float             # lambda1'' from clause 5.3.7.1
    eddy_factor_f: float | None  # clause 5.3.6 F, both-ends + eddy only
    total: float                # lambda1


@dataclass(frozen=True)
class Iteration:
    index: int
    sheath_temperature_c: float
    duct_air_temperature_c: float | None
    t4_air_gap_k_m_w: float | None
    t4_k_m_w: float
    loss: SheathLoss
    current_a: float
    conductor_loss_w_m: float
    sheath_loss_w_m: float
    cable_surface_temperature_c: float
    next_sheath_temperature_c: float
    next_duct_air_temperature_c: float | None


@dataclass
class Result:
    method: str
    method_version: str
    ampacity_a: float
    converged: bool
    iterations: int
    geometry: Geometry
    electrical: Electrical
    t1_k_m_w: float
    t3_k_m_w: float
    t3_multiplier: float
    t4_duct_wall_k_m_w: float | None
    t4_external_k_m_w: float
    history: list[Iteration] = field(default_factory=list)
    decisions: list[str] = field(default_factory=list)
    limitations: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return asdict(self)


def geometry(r: Rating) -> Geometry:
    ins = r.insulation
    dc = r.conductor.diameter_m
    d1 = dc + 2 * ins.inner_screen_thickness_m
    d2 = d1 + 2 * ins.thickness_m
    d3 = d2 + 2 * ins.outer_screen_thickness_m
    ts = r.sheath.thickness_m
    de = d3 + 2 * ts + 2 * r.oversheath.thickness_m
    duct = r.installation.duct
    if duct is not None and de >= duct.inner_diameter_m:
        raise RatingRefused('CABLE_DOES_NOT_FIT_DUCT', '电缆外径不小于管道内径。')
    # Touching trefoil: axis spacing is the cable diameter, or the duct diameter in ducts.
    spacing = de if duct is None else duct.outer_diameter_m
    return Geometry(dc, d1, d2, d3, d3 + ts, d3 + 2 * ts, de, spacing)


def _effect_factor(x2: float) -> float:
    return x2 * x2 / (192 + 0.8 * x2 * x2)


def electrical(r: Rating, g: Geometry) -> Electrical:
    c, f = r.conductor, r.frequency_hz
    omega = 2 * pi * f
    r_dc = c.r20_ohm_m * (1 + c.alpha20_per_k * (r.max_conductor_temperature_c - 20))
    xs2 = 8 * pi * f / r_dc * 1e-7 * c.ks
    xp2 = 8 * pi * f / r_dc * 1e-7 * c.kp
    xs, xp = sqrt(xs2), sqrt(xp2)
    if xs > X_LIMIT or xp > X_LIMIT:
        raise RatingRefused('SKIN_PROXIMITY_OUT_OF_RANGE', f'x_s={xs:.3f}、x_p={xp:.3f}；本方法只实现 x ≤ {X_LIMIT} 的公式。')
    ys = _effect_factor(xs2)
    fp = _effect_factor(xp2)
    ratio2 = (g.conductor_m / g.axis_spacing_m) ** 2
    yp = fp * ratio2 * (0.312 * ratio2 + 1.18 / (fp + 0.27))
    r_ac = r_dc * (1 + ys + yp)
    cap = r.insulation.relative_permittivity / (18 * log(g.over_insulation_m / g.over_inner_screen_m)) * 1e-9
    wd = omega * cap * r.phase_voltage_v ** 2 * r.insulation.tan_delta
    s = r.sheath
    rs20 = s.resistivity20_ohm_m / (pi * g.sheath_mean_m * s.thickness_m)
    x = 2 * omega * 1e-7 * log(2 * g.axis_spacing_m / g.sheath_mean_m)
    return Electrical(r_dc, xs, ys, xp, yp, r_ac, cap, wd, rs20, x)


def _layer(rho: float, outer: float, inner: float) -> float:
    return rho / (2 * pi) * log(outer / inner)


def t1(r: Rating, g: Geometry) -> float:
    ins = r.insulation
    return (_layer(ins.inner_screen_rho_k_m_w, g.over_inner_screen_m, g.conductor_m)
            + _layer(ins.rho_k_m_w, g.over_insulation_m, g.over_inner_screen_m)
            + _layer(ins.outer_screen_rho_k_m_w, g.over_outer_screen_m, g.over_insulation_m))


def sheath_loss(r: Rating, g: Geometry, e: Electrical, theta_s: float) -> SheathLoss:
    s, b = r.sheath, r.bonding
    omega = 2 * pi * r.frequency_hz
    rho_s = s.resistivity20_ohm_m * (1 + s.alpha20_per_k * (theta_s - 20))
    rs = e.sheath_r20_ohm_m * (1 + s.alpha20_per_k * (theta_s - 20))
    if rs <= 0:
        raise RatingRefused('SHEATH_TEMPERATURE_INVALID', '护套温度使护套电阻非正。')
    ratio = rs / e.sheath_reactance_ohm_m
    circulating = rs / e.r_ac_max_ohm_m / (1 + ratio ** 2) if b.scheme == 'both_ends' else 0.0
    eddy, factor = 0.0, None
    if b.eddy == 'trefoil':
        # IEC 60287-1-1 clause 5.3.7.1, trefoil. t_s and D_s in mm inside C_gs; d is the mean sheath diameter.
        ts_mm, ds_mm = s.thickness_m * 1000, g.over_sheath_m * 1000
        beta1 = sqrt(4 * pi * omega / (1e7 * rho_s))
        cgs = 1 + (ts_mm / ds_mm) ** 1.74 * (beta1 * ds_mm * 1e-3 - 1.6)
        m = omega / rs * 1e-7
        ratio_d = g.sheath_mean_m / (2 * g.axis_spacing_m)
        lambda0 = 3 * (m * m / (1 + m * m)) * ratio_d ** 2
        delta1 = (1.14 * m ** 2.45 + 0.33) * ratio_d ** (0.92 * m + 1.66)
        eddy = rs / e.r_ac_max_ohm_m * (cgs * lambda0 * (1 + delta1) + (beta1 * ts_mm) ** 4 / 12e12)
        if b.scheme == 'both_ends':
            # Clause 5.3.6 F with M = N = R_s/X (trefoil), applied to all conductors per TB 880 GP31.
            factor = ratio ** 2 / (ratio ** 2 + 1)
    total = circulating + (eddy * factor if factor is not None else eddy)
    return SheathLoss(theta_s, rs, circulating, eddy, factor, total)


def _t4_air_gap(r: Rating, g: Geometry, theta_m: float) -> float:
    d = r.installation.duct
    # Empirical form written with the cable diameter in mm.
    return d.u / (1 + 0.1 * (d.v + d.y_per_k * theta_m) * g.overall_m * 1000)


def _t4_soil(r: Rating, g: Geometry) -> float:
    inst = r.installation
    reference = g.overall_m if inst.duct is None else inst.duct.outer_diameter_m
    if inst.depth_m <= reference:
        raise RatingRefused('DEPTH_TOO_SMALL', '埋深必须大于电缆（或管道）外径。')
    u = 2 * inst.depth_m / reference
    rho = inst.soil_rho_k_m_w
    if inst.duct is not None:
        return rho / (2 * pi) * (log(2 * u) + 2 * log(u))
    ln_term = log(2 * u) if inst.t4_form == 'simplified' else log(u + sqrt(u * u - 1))
    return 1.5 / pi * rho * (ln_term - 0.630)


def rate(r: Rating) -> Result:
    g = geometry(r)
    e = electrical(r, g)
    T1 = t1(r, g)
    inst = r.installation
    multiplier = T3_MULTIPLIER[inst.environment]
    T3 = multiplier * _layer(r.oversheath.rho_k_m_w, g.overall_m, g.over_sheath_m)
    duct = inst.duct
    T4_wall = _layer(duct.rho_k_m_w, duct.outer_diameter_m, duct.inner_diameter_m) if duct else None
    T4_ext = _t4_soil(r, g)
    d_theta = r.max_conductor_temperature_c - inst.ambient_temperature_c
    theta_s = r.solver.initial_sheath_temperature_c
    theta_m = duct.initial_mean_air_temperature_c if duct else None
    R, wd = e.r_ac_max_ohm_m, e.dielectric_loss_w_m
    history: list[Iteration] = []
    previous = None
    converged = False
    for index in range(1, r.solver.max_iterations + 1):
        t4_gap = _t4_air_gap(r, g, theta_m) if duct else None
        T4 = T4_ext + (t4_gap + T4_wall if duct else 0.0)
        loss = sheath_loss(r, g, e, theta_s)
        lam = loss.total
        numerator = d_theta - wd * (0.5 * T1 + T3 + T4)
        denominator = R * T1 + R * (1 + lam) * (T3 + T4)
        if numerator <= 0:
            raise RatingRefused('NO_POSITIVE_RATING', '仅介质损耗已使导体达到允许温度，不存在正载流量。')
        current = sqrt(numerator / denominator)
        wc = R * current ** 2
        ws = lam * wc
        w = wc + ws + wd
        surface = inst.ambient_temperature_c + w * T4
        next_theta_s = surface + w * T3
        next_theta_m = surface - 0.5 * t4_gap * w if duct else None
        if not all(isfinite(v) for v in (current, surface, next_theta_s)):
            raise RatingRefused('NUMERIC_FAILURE', '计算出现非有限数值。')
        history.append(Iteration(index, theta_s, theta_m, t4_gap, T4, loss, current, wc, ws,
                                 surface, next_theta_s, next_theta_m))
        if previous is not None and abs(current - previous) < r.solver.current_tolerance_a:
            converged = True
            break
        previous, theta_s, theta_m = current, next_theta_s, next_theta_m
    if not converged:
        raise RatingRefused('NOT_CONVERGED', f'{r.solver.max_iterations} 次迭代内电流变化未小于 {r.solver.current_tolerance_a} A。')
    decisions = [
        f'T3 乘以 {multiplier}（{"直埋接触品字形单芯电缆" if duct is None else "管道内单根电缆"}）。',
        '集肤与邻近效应系数在导体最高允许温度的直流电阻下计算。',
        '护套电阻、涡流项随迭代中的护套温度更新；导体交流电阻固定在允许温度。',
    ]
    if duct is None:
        decisions.append('T4 使用' + ('简化式 ln(2u)' if inst.t4_form == 'simplified' else '精确根式 ln(u+√(u²−1))') + '，u = 2L/De。')
    else:
        decisions.append("T4 = 管内空气 T4'（随管内平均空气温度迭代）+ 管壁 T4'' + 管外土壤 T4'''。")
    if r.bonding.scheme == 'both_ends' and r.bonding.eddy == 'trefoil':
        decisions.append('两端接地计入涡流：λ1 = λ1′ + F·λ1″，F 按 IEC 60287-1-1 5.3.6，并按 CIGRE TB 880 GP31 推广到非分割导体。')
    elif r.bonding.eddy == 'ignored':
        decisions.append('两端接地忽略涡流损耗：λ1 = λ1′。')
    else:
        decisions.append('单点接地：无环流，λ1 = λ1″。')
    limitations = [
        '仅三根等负荷单芯电缆接触品字形排列；均匀土壤、恒温地表、100 % 负荷率。',
        '无铠装（T2 = 0、λ2 = 0）；不计土壤干燥、外部热源与相邻回路。',
        '仅光滑管状金属护套；铜丝屏蔽、皱纹护套、复合护套不适用。',
        '集肤/邻近系数 ks、kp 及管道常数 U、V、Y 由使用者按标准表给定，本方法不内置标准表。',
    ]
    return Result(METHOD_ID, METHOD_VERSION, history[-1].current_a, converged, len(history), g, e,
                  T1, T3, multiplier, T4_wall, T4_ext, history, decisions, limitations)
