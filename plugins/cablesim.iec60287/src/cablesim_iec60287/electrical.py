"""SI electrical primitives, IEC 60287-1-1:2023 §§5.1.2–5.1.5, 5.3.

Skin effect uses all three published branches; circular-conductor proximity
requires x_p <= 2.8. Historical material/length conventions stay with callers.
"""
from math import isfinite, log, pi, sqrt


class RatingRefused(ValueError):
    def __init__(self, code, message, path='/parameters'):
        super().__init__(message)
        self.code = code
        self.path = path


def resistance(r20, alpha, temperature_c):
    value = r20 * (1 + alpha * (temperature_c - 20))
    if not isfinite(value) or value <= 0:
        raise RatingRefused('ELECTRICAL_STATE_INVALID', '工作温度对应的电阻须为正值，请核对温度、电阻与温度系数。')
    return value


def effect_x(frequency, dc_resistance, coefficient):
    return sqrt(8*pi*frequency/dc_resistance*1e-7*coefficient)


def effect_factor_squared(x2):
    return x2*x2/(192 + .8*x2*x2)


def skin(x):
    """§5.1.3, x_s <=2.8, 2.8<x_s<=3.8 and x_s>3.8."""
    if x <= 2.8:
        return effect_factor_squared(x*x)
    if x <= 3.8:
        return -.136 - .0177*x + .0563*x*x
    return .354*x - .733


def proximity(x, diameter, spacing):
    """§5.1.5.1 round conductors, three-core or three single-core cables."""
    if x > 2.8:
        raise RatingRefused('PROXIMITY_OUT_OF_RANGE', '邻近效应 xₚ 超过 2.8；请使用数值电磁方法。')
    fp = effect_factor_squared(x*x)
    ratio2 = (diameter/spacing)**2
    return fp*ratio2*(.312*ratio2 + 1.18/(fp + .27))


def ac_factors(dc, frequency, ks, kp, diameter, spacing):
    xs, xp = effect_x(frequency, dc, ks), effect_x(frequency, dc, kp)
    ys, yp = skin(xs), proximity(xp, diameter, spacing)
    return xs, ys, xp, yp, dc*(1 + ys + yp)


def sheath_reactance(frequency, spacing, mean_diameter, lay_factor=1):
    """§5.3.2, Ω/m; caller supplies the applicable spacing and lay convention."""
    return 2*(2*pi*frequency)*1e-7*log(2*spacing/mean_diameter)*lay_factor


def circulating(rs, rc, reactance, multiplier=1):
    """§5.3.2, §5.3.11 (multiplier 1.5 for armoured SL three-core)."""
    return rs/rc/(1 + (rs/reactance)**2)*multiplier


def sheath_thickness_terms(rho, thickness, outer_diameter, frequency):
    """§5.3.7.1 gs and Gs, SI equivalents of the published mm forms."""
    beta = sqrt(4*pi*(2*pi*frequency)/(1e7*rho))
    gs = 1 + (thickness/outer_diameter)**1.74*(beta*outer_diameter - 1.6)
    return gs, (beta*thickness)**4/12


def eddy_geometry(m, ratio, role='trefoil'):
    """§5.3.7.1: λ0 and δ corrections; flat roles refer to phase order."""
    multiplier = 3 if role == 'trefoil' else 6 if role == 'middle' else 1.5
    base = multiplier*m*m/(1 + m*m)*ratio**2
    if role == 'trefoil':
        d1, d2 = (1.14*m**2.45 + .33)*ratio**(.92*m + 1.66), 0.
    elif role == 'middle':
        d1, d2 = .86*m**3.08*ratio**(1.4*m + .7), 0.
    elif role == 'outer_leading':
        d1 = 4.7*m**.7*ratio**(.16*m + 2)
        d2 = 21*m**3.3*ratio**(1.47*m + 5.06)
    else:
        d1 = -.74*(m + 2)*sqrt(m)/(2 + (m - .3)**2)*ratio**(m + 1)
        d2 = .92*m**3.7*ratio**(m + 2)
    return base*(1 + d1 + d2)
