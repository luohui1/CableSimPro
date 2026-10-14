"""IEC 60287-1-3:2023 §4.2 (9), §4.3; explicitly closed metallic circuit.

Primitive log-distance impedances share an arbitrary one-metre reference.
The common reference cancels under the enforced total-current constraint.
No Carson/earth-return approximation or inferred sheath bonding is used.
"""
from cmath import exp
from math import hypot, log, pi, sqrt


def solve(matrix, vector):
    a = [[complex(v) for v in row] + [complex(rhs)] for row, rhs in zip(matrix, vector)]
    n = len(vector)
    for j in range(n):
        pivot = max(range(j, n), key=lambda k: abs(a[k][j]))
        if abs(a[pivot][j]) < 1e-14:
            raise ValueError('金属回流阻抗矩阵奇异，请检查连接、截面和阻抗。')
        a[j], a[pivot] = a[pivot], a[j]
        factor = a[j][j]
        a[j] = [v / factor for v in a[j]]
        for k in range(n):
            if k != j:
                factor = a[k][j]
                a[k] = [x-factor*y for x, y in zip(a[k], a[j])]
    return [row[-1] for row in a]


def sequence_results(cable, parameters, ac_rows):
    p, cores = parameters, cable['cores']
    needed = [name for name in ('frequency_hz','bonding_model') if p.get(name) is None or not p.get('sources',{}).get(name)]
    if len(cores) not in (1,3):
        return {'status':'uncovered','reason':'四芯及中性线拓扑不在此三相矩阵方法范围，请建立线路研究。'}
    if any(c['conductor']['form'] not in ('solid_round','stranded_round_compacted') for c in cores):
        return {'status':'uncovered','reason':'本分支覆盖实心圆与紧压圆导体（表 1 α=0.779）；其他绞线需股数系数。'}
    if len(cores)==3 and all(c.get('x') is not None and c.get('z') is not None for c in cores):
        points = [(c['x'],c['z']) for c in cores]
    else:
        for name in ('spacing_m','arrangement'):
            if p.get(name) is None or not p.get('sources',{}).get(name): needed.append(name)
        s = p.get('spacing_m')
        points = [(0,0),(s,0),(s/2,s*sqrt(3)/2)] if s and p.get('arrangement')=='trefoil' else [(0,0),(s,0),(2*s,0)] if s else None
    if needed: return {'status':'missing','reason':'缺字段：频率、相间几何或护层连接及来源；填写后重算。','missing_parameters':needed}
    if any(r is None for r in ac_rows):
        return {'status':'missing','reason':'缺字段：三相交流电阻；请补工作温度、导体电阻、集肤与邻近条件。','missing_parameters':['temperature_k','ks','kp']}
    ac = ac_rows*3 if len(cores)==1 else ac_rows
    radii = [.779*c['conductor']['diameter']/2 for c in cores]
    radii = radii*3 if len(cores)==1 else radii
    diameters = [c['conductor']['diameter'] for c in cores]* (3 if len(cores)==1 else 1)
    factor = 2e-7*2*pi*p['frequency_hz']
    distances = [[radii[i] if i==j else hypot(points[i][0]-points[j][0],points[i][1]-points[j][1]) for j in range(3)] for i in range(3)]
    if any(distances[i][j] <= (diameters[i]+diameters[j])/2 for i in range(3) for j in range(3) if i!=j):
        raise ValueError('相间中心距：导体重叠，请修正真实芯坐标或中心距。')
    zpp = [[(ac[i] if i==j else 0)+1j*factor*log(1/distances[i][j]) for j in range(3)] for i in range(3)]
    metal = p['bonding_model']
    metal_layers = [l for c in cores for l in c['layers']]+cable['common_layers']
    if any(l['role']=='armour' for l in metal_layers):
        return {'status':'uncovered','reason':'含磁性铠装的完整序阻抗不在本非磁性矩阵分支；请在工程线路研究中核定，不输出忽略铠装的完整值。'}
    if metal=='both_ends' and len(cores)==3 and any(l['role'] in ('metallic_screen','metallic_sheath') for l in cable['common_layers']):
        return {'status':'uncovered','reason':'三芯共用金属护层不能套用每相独立同心金属回路；请在工程线路研究中定义共用回流拓扑，停止输出此分支的完整序阻抗。'}
    if metal == 'cross_bonded':
        return {'status':'missing','reason':'需工程输入：交叉互联的分段长度及连接映射；本型号未保存线路分段，请转线路研究。','missing_parameters':['bonding_model'],'input_category':'system'}
    positive_current = [1,exp(-2j*pi/3),exp(2j*pi/3)]
    def apply(currents, zero=False):
        if metal=='single_point':
            return [sum(z*current for z,current in zip(row,currents)) for row in zpp], []
        rs, radius = p.get('metal_resistance_ohm_m'), p.get('metal_mean_radius_m')
        if rs is None or radius is None or p.get('metal_nonmagnetic') is not True or any(not p.get('sources',{}).get(k) for k in ('metal_resistance_ohm_m','metal_mean_radius_m','metal_nonmagnetic')):
            return None, ['metal_resistance_ohm_m','metal_mean_radius_m','metal_nonmagnetic']
        if any(radius<=d/2 for d in diameters) or any(radius*2>=distances[i][j] for i in range(3) for j in range(3) if i!=j):
            raise ValueError('金属回路平均半径：须包住本相导体，且各相金属管不能重叠。')
        zsp = [[1j*factor*log(1/(radius if i==j else distances[i][j])) for j in range(3)] for i in range(3)]
        zss = [[(rs if i==j else 0)+1j*factor*log(1/(radius if i==j else distances[i][j])) for j in range(3)] for i in range(3)]
        # Equal longitudinal metal potentials + explicit net-current closure.
        system = [row+[-1] for row in zss]+[[1,1,1,0]]
        rhs = [-sum(z*i for z,i in zip(row,currents)) for row in zsp]+[-sum(currents)]
        response = solve(system,rhs)
        voltage = [sum(z*i for z,i in zip(row,currents))+sum(z*i for z,i in zip(zsp[k],response[:3]))-response[3] for k,row in enumerate(zpp)]
        return voltage,response[:3]
    voltage, detail = apply(positive_current)
    if voltage is None: return {'status':'missing','reason':'需工程输入：每相金属回路交流电阻、平均半径及非磁性确认。','missing_parameters':detail,'input_category':'system'}
    z1 = sum(v/i for v,i in zip(voltage,positive_current))/3
    output = {'status':'available','positive':z1,'inductance':z1.imag/(2*pi*p['frequency_hz']),
        'inputs':{'phase_points_m':points,'gmr_m':radii,'ac_resistance_ohm_m':ac,'bonding_model':metal,
            'metal_resistance_ohm_m':p.get('metal_resistance_ohm_m'),'metal_mean_radius_m':p.get('metal_mean_radius_m')},
        'matrix_ohm_m':[[[z.real,z.imag] for z in row] for row in zpp],
        'scope':'三相平衡正序；含自感与互感及声明金属回路。非磁性长平行圆导体、无大地回流；平排结果为正序分量，非等距排列仍保留相间耦合。'}
    if p.get('return_path')=='metallic_only' and p.get('sources',{}).get('return_path') and metal=='both_ends':
        v0, _ = apply([1,1,1],zero=True)
        output['zero'] = sum(v0)/3
    else:
        output['zero_reason']='需工程输入：零序回流路径及两端金属连接；含大地回流时须转线路研究方法，本方法不套用近似大地阻抗。'
        output['zero_missing']=['return_path','bonding_model']
    return output
