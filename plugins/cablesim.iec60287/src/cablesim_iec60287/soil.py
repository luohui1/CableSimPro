"""IEC 60287-2-1:2023 4.2.2, 4.2.3 and 4.2.7 (SI).

The surface is isothermal. Image sources represent non-touching circular
cables/ducts. A rectangular homogeneous backfill uses Table 2 and the 2023
equivalent-radius formula; no extrapolation or inferred damaged table cells.
"""
from bisect import bisect_left
from math import acosh, exp, hypot, log, pi

from .method import RatingRefused

HEIGHT_WIDTH = [0.05,0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1,1.2,1.4,1.6,1.8,2,2.2,2.4,2.6,2.8,3,3.2,3.4,3.6,3.8,4,4.5,5]
DEPTH_HEIGHT = [0.6,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,20]
GB = [
    [0.08,0.32,0.39,0.59,0.77,0.93,1.08,1.21,1.34,1.45,1.56,1.67,1.77,1.87,1.96,2.05,2.14,2.23,2.31,2.47],
    [0.1,0.36,0.65,0.94,1.18,1.39,1.57,1.72,1.87,2,2.13,2.25,2.37,2.47,2.57,2.66,2.76,2.85,2.94,3.12],
    [0.14,0.45,1,1.37,1.68,1.93,2.12,2.24,2.39,2.53,2.66,2.79,2.9,3.01,3.12,3.21,3.31,3.41,3.51,3.69],
    [0.18,0.56,1.26,1.68,2.02,2.29,2.48,2.6,2.75,2.89,3.02,3.15,3.27,3.38,3.49,3.59,3.69,3.9,3.89,4.08],
    [0.22,0.68,1.43,1.86,2.19,2.45,2.66,2.8,2.95,3.09,3.22,3.35,3.47,3.58,3.69,3.79,3.88,3.95,4.02,4.12],
    [0.25,0.81,1.51,1.92,2.21,2.46,2.67,2.83,2.99,3.13,3.25,3.38,3.5,3.61,3.71,3.81,3.91,4.01,4.11,4.29],
    [0.29,0.9,1.62,2.04,2.34,2.69,2.81,2.98,3.15,3.29,3.42,3.55,3.68,3.8,3.91,4.02,4.13,4.24,4.35,4.56],
    [0.32,0.97,1.71,2.14,2.44,2.7,2.92,3.1,3.27,3.43,3.57,3.72,3.86,3.99,4.12,4.24,4.37,4.49,4.62,4.86],
    [0.35,1.04,1.81,2.26,2.58,2.87,3.12,3.34,3.55,3.74,3.92,4.11,4.29,4.47,4.64,4.81,5,5.19,5.39,5.79],
    [0.39,1.11,1.9,2.39,2.74,3.07,3.37,3.64,3.91,4.16,4.4,4.65,4.9,5.15,5.39,5.63,5.89,6.14,6.41,6.94],
    [0.42,1.17,2,2.52,2.93,3.31,3.67,4.01,4.35,4.66,5.01,5.34,5.68,6.01,6.35,6.68,7.01,7.34,7.67,8.33],
    [0.47,1.24,2.06,2.58,2.98,3.35,3.7,4.03,4.36,4.68,5.02,5.34,5.67,5.98,6.3,6.61,6.93,7.25,7.57,8.21],
    [0.52,1.31,2.12,2.64,3.03,3.4,3.75,4.08,4.41,4.73,5.05,5.37,5.69,6,6.31,6.62,6.92,7.25,7.57,8.2],
    [0.56,1.37,2.18,2.7,3.1,3.47,3.82,4.15,4.48,4.81,5.14,5.46,5.78,6.09,6.4,6.71,7.03,7.34,7.66,8.29],
    [0.6,1.43,2.24,2.76,3.17,3.55,3.91,4.24,4.58,4.92,5.26,5.59,5.92,6.24,6.56,6.87,7.19,7.52,7.85,8.5],
    [0.64,1.48,2.31,2.83,3.25,3.64,4.01,4.36,4.72,5.07,5.43,5.78,6.12,6.45,6.78,7.11,7.45,7.79,8.13,8.82],
    [0.67,1.52,2.39,2.9,3.35,3.77,4.17,4.55,4.94,5.32,5.71,6.09,6.47,6.84,7.21,7.58,7.96,8.33,8.71,9.46],
    [0.7,1.56,2.46,2.98,3.44,3.89,4.32,4.74,5.16,5.58,6,6.42,6.83,7.24,7.65,8.05,8.46,8.87,9.28,10.11],
    [0.73,1.59,2.53,3.05,3.54,4.02,4.49,4.94,5.39,5.84,6.29,6.74,7.19,7.63,8.08,8.52,8.97,9.41,9.86,10.75],
    [0.76,1.62,2.6,3.13,3.65,4.15,4.65,5.13,5.62,6.1,6.58,7.06,7.55,8.03,8.51,8.99,9.47,9.96,10.4,11.41],
    [0.79,1.64,2.66,None,3.74,4.28,4.81,5.33,5.85,6.37,6.88,7.4,7.92,8.43,8.95,9.47,9.99,10.51,11,12.06],
    [0.82,1.67,2.72,3.27,3.84,4.41,4.97,5.53,6.08,6.63,7.18,7.73,8.29,8.84,9.39,9.95,10.5,11.06,11.6,12.72],
    [0.84,1.7,2.77,3.35,3.95,4.55,5.14,5.73,6.32,6.9,7.48,8.07,8.66,9.25,9.84,10.43,11.02,11.61,12.2,13.38],
    [0.86,1.72,2.81,3.42,4.05,4.68,5.31,5.94,6.56,7.1,7.79,8.41,9.04,9.66,10.29,10.92,11.54,12.17,12.7,14.04],
    [0.88,1.75,2.85,3.49,4.16,4.82,5.48,6.14,6.8,7.45,8.1,8.76,9.42,10.08,10.74,11.41,12.07,12.73,13.3,14.71],
    [0.9,1.77,2.89,3.56,4.26,4.96,5.66,6.35,7.04,7.73,8.42,9.11,9.81,10.5,11.2,11.9,12.6,13.29,13.9,15.38],
    [0.94,1.83,2.96,3.74,4.53,5.31,6.1,6.88,7.66,8.44,9.22,10,10.79,11.57,12.35,13.14,13.93,14.71,15.5,17.08],
    [0.97,1.88,3,3.91,4.79,5.67,6.55,7.42,8.29,9.17,10.04,10.9,11.79,12.66,13.53,14.4,15.28,16.15,17,18.79],
]


def _bracket(axis, value):
    if not axis[0] <= value <= axis[-1]:
        raise RatingRefused('BACKFILL_GEOMETRY_OUT_OF_RANGE',
                            '回填几何比超出 IEC 60287-2-1:2023 表 2；请改用数值热传导方法。')
    i = bisect_left(axis, value)
    if i < len(axis) and abs(axis[i]-value) < 1e-12:
        return [(i, 1.0)]
    w = (value-axis[i-1])/(axis[i]-axis[i-1])
    return [(i-1, 1-w), (i, w)]


def geometric_factor(depth, height, width):
    """Bilinear interpolation, axes h_b/w_b and L_G/h_b (Table 2)."""
    result = 0.0
    for row, a in _bracket(HEIGHT_WIDTH, height/width):
        for col, b in _bracket(DEPTH_HEIGHT, depth/height):
            if a*b <= 1e-14:
                continue
            # The controlled 2023 copy has an unreadable node (3, 3) and an
            # inconsistent node (0.3, 17). Neither is silently repaired.
            if GB[row][col] is None or (HEIGHT_WIDTH[row] == .3 and DEPTH_HEIGHT[col] == 17):
                raise RatingRefused('BACKFILL_TABLE_AMBIGUOUS',
                                    '所需几何因子表格节点无法可靠核对；请提供经核实的数据或改用数值热传导方法。')
            result += a*b*GB[row][col]
    return result


def resistance_matrix(points, radii, earth_rho, backfill=None, *, reference_basis='iec2023'):
    """R[i][j] times source-j W/m gives receiving surface-i rise in K.

    backfill = {x,z,width,height,rho}. Equal losses reduce its common
    correction to N*(rho_earth-rho_fill)*acosh(L_G/r_b)/(2*pi), 4.2.7.
    For unequal losses linear superposition gives C*sum(W_j).
    """
    if not points or len(points) != len(radii) or earth_rho <= 0:
        raise ValueError('热源、半径和土壤热阻率必须明确且有效。')
    rho, common, factor, rb = earth_rho, 0.0, None, None
    if backfill:
        rho = backfill['rho']
        x, z, width, height = (backfill[k] for k in ('x', 'z', 'width', 'height'))
        depth = -z
        if width <= 0 or height <= 0 or depth <= height/2 or rho <= 0:
            raise ValueError('回填区必须为完整地下矩形且热阻率为正。')
        if any(abs(px-x)+r > width/2+1e-12 or abs(pz-z)+r > height/2+1e-12
               for (px,pz),r in zip(points,radii)):
            raise RatingRefused('BACKFILL_NOT_CONTAINING_SOURCES',
                                '标准几何修正要求全部电缆或管道位于同一个回填矩形内；请调整布置或改用数值热传导方法。')
        if reference_basis == 'tb880_reference':
            # TB 880 p.92: former IEC 60287-2-1 radius, for replay only.
            # IEC 2023 4.2.7 (printed p.29) expressly supersedes this form.
            short, long = sorted((height, width))
            ratio = short/long
            if long/short >= 3:
                raise RatingRefused('TB880_BANK_GEOMETRY_OUT_OF_RANGE', 'TB880 旧版矩形公式仅在长短边比小于 3 时用于参考复现。')
            rb = exp(.5*ratio*(4/pi-ratio)*log(1+1/ratio**2)+log(short/2))
        else:
            factor = geometric_factor(depth, height, width)
            rb = depth/exp(factor)
        if depth <= rb:
            raise RatingRefused('BACKFILL_RADIUS_INVALID', '回填等效半径不满足地下热阻公式；请改用数值热传导方法。')
        common = (earth_rho-rho)/(2*pi)*acosh(depth/rb)
    matrix, base = [], []
    for i, (xi,zi) in enumerate(points):
        depth = -zi
        if not 0 < radii[i] < depth <= 10:
            raise RatingRefused('DEPTH_OUT_OF_RANGE', '热源需完整位于地表下且埋深不超过 10 m；更深或近地表布置请改用数值方法。')
        row = []
        for j, (xj,zj) in enumerate(points):
            if i == j:
                rij = rho/(2*pi)*acosh(depth/radii[i])
            else:
                distance = hypot(xi-xj, zi-zj)
                if distance <= radii[i]+radii[j]+1e-10:
                    raise RatingRefused('TOUCHING_GROUP_NOT_SUPPORTED',
                                        '通用镜像法要求热源不接触；接触品字形单回路请使用接触模板，其他接触组合请改用数值方法。')
                rij = rho/(2*pi)*log(hypot(xi-xj, zi+zj)/distance)
            row.append(rij)
        base.append(row)
        # The old worked example puts N*C in each cable's own T4 (TB p.94).
        # Engineering mode uses the common-temperature C*sum(W) extension.
        matrix.append([v+(len(points)*common if i == j else 0) for j,v in enumerate(row)]
                      if reference_basis == 'tb880_reference' else [v+common for v in row])
    if any(v < 0 for row in matrix for v in row):
        raise RatingRefused('BACKFILL_CORRECTION_INVALID',
                            '此回填几何修正产生负热阻，超出近似适用范围；请改用数值热传导方法。')
    return matrix, {'base_matrix_k_m_w': base, 'common_correction_k_m_w': common,
                    'geometric_factor': factor, 'equivalent_radius_m': rb,
                    'reference_basis':reference_basis,
                    'source': 'TB 880 2022 pp.92–94（旧版矩形半径和 N·C，仅参考复现）' if reference_basis == 'tb880_reference'
                              else 'IEC 60287-2-1:2023 4.2.2 / 4.2.3.2 / 4.2.6 / 4.2.7, Table 2'}
