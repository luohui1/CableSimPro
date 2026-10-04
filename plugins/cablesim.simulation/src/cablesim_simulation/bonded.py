"""平排两端接地护套：均匀线电流/集总回路解析子模型，非电磁 FEM。"""
from math import isfinite, pi

FIELDS = {'phase_current_a', 'frequency_hz', 'spacing_m', 'depth_m', 'shield_mean_radius_m',
          'shield_area_m2', 'shield_conductivity20_s_m', 'shield_alpha_per_k',
          'shield_temperature_c', 'source_reference'}


def prepare(value, parameters):
    if not isinstance(value, dict) or set(value) != FIELDS:
        raise ValueError('平排护套子模型需要完整显式参数，不接受额外字段。')
    for key in FIELDS-{'source_reference'}:
        x = value[key]
        if isinstance(x, bool) or not isinstance(x, (float, int)) or not isfinite(x):
            raise ValueError('非有限实数：'+key)
        if key != 'shield_temperature_c' and x <= 0:
            raise ValueError('参数必须为正：'+key)
    if not isinstance(value['source_reference'], str) or not value['source_reference'].strip():
        raise ValueError('必须提供来源。')
    if value['spacing_m'] <= 2*value['shield_mean_radius_m']:
        raise ValueError('护套重叠或接触，不满足本线电流近似。')
    if 1+value['shield_alpha_per_k']*(value['shield_temperature_c']-20) <= 0:
        raise ValueError('温度修正电阻非正。')
    if not isinstance(parameters, dict) or set(parameters) != {'height_m', 'x_points_m'}:
        raise ValueError('必须指定观测高度和横向采样点。')
    h = parameters['height_m']
    xs = parameters['x_points_m']
    if isinstance(h, bool) or not isinstance(h, (float, int)) or not isfinite(h) or h < 0:
        raise ValueError('观测高度必须为地表上有限非负值。')
    if not isinstance(xs, list) or not 1 <= len(xs) <= 201 or any(
            isinstance(x, bool) or not isinstance(x, (float, int)) or not isfinite(x) for x in xs):
        raise ValueError('采样点必须为1至201个有限横向坐标。')
    if any(b <= a for a, b in zip(xs, xs[1:])):
        raise ValueError('采样点必须严格递增。')
    return dict(value), dict(parameters)


def solve_bonded(value, parameters):
    import numpy as np
    current = value['phase_current_a']*np.exp(1j*np.deg2rad([-120, 0, 120]))
    x = np.array([-value['spacing_m'], 0, value['spacing_m']])
    distances = np.abs(x[:, None]-x)
    np.fill_diagonal(distances, value['shield_mean_radius_m'])
    # 任意参考长度取1m；sum(I)=sum(Ishield)=0使共同对数常数消去。
    inductance = 2e-7*np.log(1/distances)
    resistance = (1+value['shield_alpha_per_k']*(value['shield_temperature_c']-20))/(
        value['shield_conductivity20_s_m']*value['shield_area_m2'])
    impedance = resistance*np.eye(3)+1j*2*pi*value['frequency_hz']*inductance
    coupled = np.block([[impedance, np.ones((3, 1))], [np.ones((1, 3)), np.zeros((1, 1))]])
    rhs = np.r_[-1j*2*pi*value['frequency_hz']*inductance@current, 0]
    solution = np.linalg.solve(coupled, rhs)
    shield = solution[:3]
    residual = float(np.max(np.abs(coupled@solution-rhs)))
    total_current = current+shield
    xpoints = np.asarray(parameters['x_points_m'])
    dx = xpoints[:, None]-x
    dy = parameters['height_m']+value['depth_m']
    distance2 = dx**2+dy**2
    bx = np.sum(-2e-7*total_current[None, :]*dy/distance2, axis=1)
    by = np.sum(2e-7*total_current[None, :]*dx/distance2, axis=1)
    rms_b = np.sqrt(np.abs(bx)**2+np.abs(by)**2)
    if not np.isfinite(rms_b).all() or residual > 1e-10:
        raise ValueError('回路残差或磁场计算无效。')
    return {'schema': 'cablesim.bonded-sheath/1', 'model': 'analytic-line-current-circuit',
            'shield_resistance_ohm_m': resistance, 'shield_current_rms_a': np.abs(shield).tolist(),
            'shield_phase_deg': np.rad2deg(np.angle(shield)).tolist(),
            'shield_current_sum_abs_a': float(abs(shield.sum())), 'circuit_residual_v_m': residual,
            'curve': {'x_m': xpoints.tolist(), 'height_m': parameters['height_m'], 'b_rms_t': rms_b.tolist()},
            'assumptions': ['无限长平排三缆，RMS相序-120/0/120度，μr=1',
                            '三护套相同电阻、理想两端互联、合计护套电流为零；忽略地返回电流及护套局部涡流',
                            '电阻由显式温度修正；此解析子模型不求解导体集肤或电热反馈']}
