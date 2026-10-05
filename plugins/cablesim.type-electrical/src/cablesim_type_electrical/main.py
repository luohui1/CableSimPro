"""Traceable type properties and IEC 60949 component short-circuit ratings, SI inputs."""
from collections import Counter
from hashlib import sha256
from math import isfinite, log, pi, sqrt
from pathlib import Path
import json
import platform
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[4]))
sys.path.insert(0, str(Path(__file__).resolve().parents[3]/'cablesim.iec60287/src'))
from cablesim_iec60287.electrical import skin, effect_x, proximity
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from cablesim_type_electrical.inputs import ElectricalParameters, ShortCircuitParameters

VERSION = 'TYPE-ELECTRICAL-0.3.0'
METHOD_VERSIONS = {'electrical':VERSION, 'short-circuit':'TYPE-SHORT-CIRCUIT-0.2.0'}
SOURCES = json.loads(Path(__file__).with_name('sources.json').read_text('utf-8'))
CONSTANTS = {'copper_bare': (226, 234.5, 3.45e6), 'copper_coated': (226, 234.5, 3.45e6),
             'aluminium': (148, 228, 2.5e6), 'lead': (41, 230, 1.45e6)}


def checked(value, path, lower, upper):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not isfinite(value) or not lower <= value <= upper:
        raise ValueError(f'{path}：请输入 {lower:g}–{upper:g} 范围的 SI 数值，并核对单位。')
    return value


def prepare(document, parameters):
    if document.get('schema_version') != 'cablesim.domain/1':
        raise ValueError('schema_version：需要 cablesim.domain/1。')
    cable = next((c for c in document.get('cable_types', []) if c['id'] == parameters.get('cable_type_id')), None)
    if cable is None or cable.get('construction') not in ('single_core', 'three_core'):
        raise ValueError('parameters.cable_type_id：请选择单芯或三芯型号。')
    if len(cable['cores']) != (1 if cable['construction'] == 'single_core' else 3):
        raise ValueError('cable_types.cores：芯数与结构不一致。')
    if parameters.get('circuit_id') is not None and not any(c['id'] == parameters['circuit_id'] and c['cable_type'] == cable['id'] for c in document.get('circuits', [])):
        raise ValueError('parameters.circuit_id：请选择引用当前型号的回路。')
    materials = {m['id']: m for m in document['materials']}
    for core in cable['cores']:
        c = core['conductor']
        checked(c['diameter'], core['id'] + '.diameter', 1e-6, .5)
        checked(c['nominal_area'], core['id'] + '.nominal_area', 1e-8, .01)
        if c.get('r20') is not None:
            checked(c['r20'], core['id'] + '.r20', 1e-9, 1)
        if c['material'] not in materials:
            raise ValueError(core['id'] + '.material：材料引用不存在。')
    return cable, materials


def measurement(document, cable, core, role, quantity):
    items = [m for m in document.get('measurements', []) if m['cable_type'] == cable['id'] and m.get('core') == core and m['role'] == role and m['quantity'] == quantity]
    if len(items) > 1:
        raise ValueError('measurements：同一对象和量重复。')
    if not items:
        return None
    item = items[0]
    expected = 'ohm/m' if quantity == 'r20' else 'm2'
    if item.get('unit') != expected or item.get('basis') not in ('measurement', 'manufacturer_limit') or not item.get('source', {}).get('reference', '').strip():
        raise ValueError('measurements：请核对 SI 单位、数据性质和试验报告出处。')
    if quantity == 'screen_area' and item['basis'] != 'measurement':
        raise ValueError('measurements.screen_area：厂家声明上限不能作为实际载流金属截面。')
    checked(item['value'], 'measurements.value', 1e-12, 1 if expected == 'ohm/m' else .01)
    return item


def layers(cable, core):
    return core['layers'] + (cable['common_layers'] if len(cable['cores']) == 1 else [])


def adiabatic(area_mm2, k, beta, initial_c, final_c, duration_s):
    return k * area_mm2 * sqrt(log((final_c + beta) / (initial_c + beta)) / duration_s)


def conductor_factor(area_mm2, duration_s, x, y):
    return sqrt(1 + x*sqrt(duration_s/area_mm2) + y*duration_s/area_mm2)


def metal_factor(duration_s, thickness_m, heat_capacity, rho_inner, rho_outer, cv_inner, cv_outer, contact):
    m = (sqrt(cv_inner/rho_inner) + sqrt(cv_outer/rho_outer)) * contact / (2*heat_capacity*thickness_m)
    p = m*sqrt(duration_s)
    return 1 + .61*p - .069*p*p + .0043*p**3, m


def calculate(document, parameters, capability, *, _include_curve=True):
    if capability not in ('electrical', 'short-circuit'):
        raise ValueError('capability：未知计算能力。')
    model = ElectricalParameters if capability == 'electrical' else ShortCircuitParameters
    model.model_validate(parameters)
    cable, materials = prepare(document, parameters)
    circuits = [c for c in document.get('circuits', []) if c['cable_type'] == cable['id'] and (not parameters.get('circuit_id') or c['id'] == parameters['circuit_id'])]
    circuit = circuits[0] if len(circuits) == 1 else None
    topology = {'circuit_id': circuit['id'], 'electrical_topology': circuit.get('electrical_topology'), 'bonding': circuit.get('bonding')} if circuit else None
    rows = []
    def add(key, title, value, unit, clause, page, *, source='iec60287', formula=None, inputs=None, reason=None, status=None, core=None, role='conductor', basis='derived', input_source=None):
        if value is not None and not isfinite(value):
            raise ValueError(key + '：计算未取得有限值。')
        record = SOURCES[source]
        row = {'id': (core or 'common') + ':' + key, 'title': title, 'value': value, 'unit': unit,
               'status': status or ('available' if value is not None else 'missing'), 'standard': record['standard'],
               'clause': clause, 'printed_page': page, 'pdf_page': record.get('pages', {}).get(str(page), page + record.get('page_offset', 0)) if page is not None else None,
               'source_digest': record['sha256'], 'source_url': record.get('url'), 'formula': formula, 'formula_inputs': inputs or {},
               'reason': reason, 'basis': basis, 'input_source': input_source,
               'target': {'scope': 'core' if core else 'common', 'core_id': core, 'role': role}}
        rows.append(row)
        return row
    def parameter(key):
        value = parameters.get(key)
        reference = parameters.get('sources', {}).get(key)
        return value if value is not None and isinstance(reference, str) and reference.strip() else None
    if capability == 'electrical':
        temperature, frequency, voltage = (parameter(k) for k in ('temperature_k', 'frequency_hz', 'phase_voltage_v'))
        normal = cable['rating']['max_conductor_temperature'].get('normal')
        if temperature is not None and normal is not None and temperature > normal + 1e-9:
            raise ValueError('parameters.temperature_k：工作温度超过型号正常运行温限，请修正计算条件。')
        cll = 1 if len(cable['cores']) == 1 else parameter('core_lay_factor')
        basis = parameters.get('r20_length_basis')
        for i, core in enumerate(cable['cores']):
            cid, conductor = core['id'], core['conductor']
            cs = layers(cable, core)
            insulation = next((l for l in cs if l['role'] == 'insulation'), None)
            imat = materials.get(insulation['material'], {}) if insulation else {}
            cm = materials[conductor['material']]
            kind = cm.get('standard_kind')
            observation = measurement(document, cable, cid, 'conductor', 'r20')
            r20 = observation['value'] if observation else conductor.get('r20') if conductor.get('r20_basis') else None
            rbasis = observation['basis'] if observation else conductor.get('r20_basis')
            escape_pointer = lambda value: value.replace('~', '~0').replace('/', '~1')
            targets = [f'/cable_types/{document["cable_types"].index(cable)}/cores/{i}/conductor/r20',
                       f'/cable_types/{escape_pointer(cable["id"])}/cores/{escape_pointer(cid)}/conductor/r20']
            provenance = document.get('provenance', {})
            pointers = [p for p in provenance if any(target == p or target.startswith(p.rstrip('/') + '/') for target in targets)]
            src = observation['source'] if observation else provenance[max(pointers, key=len)] if pointers else None
            title = (f'芯 {i+1} · ' if len(cable['cores']) > 1 else '')
            resistance = add('r20', title+'导体 R₂₀', r20, 'Ω/m', '5.1.2', 16, core=cid, basis=rbasis or 'unknown', input_source=src, reason='设计输入、实测值和声明上限分别保留；标准限值不作为实测电阻。')
            resistance['data_origin'] = {'design':'设计输入', 'measurement':'实测值', 'manufacturer_limit':'厂家声明上限'}.get(rbasis, '待明确输入性质')
            if conductor.get('conductor_class') == 2:
                resistance['reference_table'] = {**SOURCES['gbt3956'], 'table':'表 2', 'printed_pages':[4, 5], 'pdf_pages':[7, 8], 'semantics':'standard_limit_reference'}
            alpha = cm.get('temperature_coefficient_20') or (.00393 if kind in ('copper_bare', 'copper_coated') else .00403 if kind == 'aluminium' else None)
            rdc = r20*(1+alpha*(temperature-293.15)) if all(v is not None for v in (r20, alpha, temperature)) else None
            straight = rdc/(cll if basis == 'finished_cable' else 1) if rdc is not None and cll is not None and basis else None
            finished_dc = straight*cll if straight is not None else None
            add('dc', title+'工作温度直流电阻', finished_dc, 'Ω/m', '5.1.2；附录 A', 16, core=cid, formula='R′ = R₂₀[1+α₂₀(θ−20)]；按明确的长度基准换算', inputs={'R20_ohm_m': r20, 'alpha20': alpha, 'temperature_k': temperature, 'C_LL': cll, 'length_basis': basis}, reason='需明确工作温度、R20 长度基准及三芯成缆绞入系数。')
            circular = conductor['form'] in ('solid_round', 'stranded_round', 'stranded_round_compacted')
            ks, kp = parameter('ks'), parameter('kp')
            spacing = parameter('spacing_m')
            xs = effect_x(frequency,straight,ks) if straight and frequency and ks is not None else None
            xp = effect_x(frequency,straight,kp) if straight and frequency and kp is not None else None
            ys = skin(xs) if xs is not None and circular else None
            ratio = conductor['diameter']/spacing if spacing is not None else None
            if ratio is not None and ratio >= 1:
                raise ValueError('parameters.spacing_m：导体中心距必须大于导体直径。')
            yp = None
            if xp is not None and xp <= 2.8 and ratio is not None and circular:
                yp = proximity(xp,conductor['diameter'],spacing)
            add('ys', title+'集肤因数 yₛ', ys, '1', '5.1.3', 16, core=cid, formula='xₛ²=8πf kₛ·10⁻⁷/R′；yₛ 按 xₛ 分段', inputs={'x_s': xs, 'ks': ks}, status='uncovered' if not circular and conductor['form'] != 'unspecified' else None, reason='只覆盖圆实心 / 圆绞合 / 紧压圆导体。' if not circular else None)
            add('yp', title+'邻近因数 yₚ', yp, '1', '5.1.5.1', 17, core=cid, formula='F=xₚ⁴/(192+0.8xₚ⁴)；yₚ=F(dc/s)²[0.312(dc/s)²+1.18/(F+0.27)]', inputs={'x_p': xp, 'kp': kp, 'dc_m': conductor['diameter'], 's_m': spacing}, status='not_applicable' if xp is not None and xp > 2.8 else 'uncovered' if not circular and conductor['form'] != 'unspecified' else None, reason='xₚ > 2.8 的邻近公式明确拒算。' if xp is not None and xp > 2.8 else '需明确相间中心距和系数来源；型号不内置敷设间距。')
            ac = straight*(1+ys+yp)*cll if all(v is not None for v in (straight, ys, yp, cll)) else None
            add('ac', title+'交流电阻', ac, 'Ω/m', '5.1.1，式 (7)；附录 A', 16, core=cid, formula='R_C=R′(1+yₛ+yₚ) C_LL', inputs={'R_dc_straight_ohm_m': straight, 'ys': ys, 'yp': yp, 'C_LL': cll}, status='not_applicable' if xp is not None and xp > 2.8 else None)
            diameter = conductor['diameter']
            di = None
            if insulation:
                for layer in cs:
                    if layer['role'] == 'insulation':
                        di = diameter + 2*layer['thickness']
                        break
                    diameter += 2*layer['thickness']
            screened = any(l['role'] == 'insulation_screen' for l in cs) and any(l['role'] in ('metallic_screen', 'metallic_sheath') for l in cs)
            er, tan = imat.get('relative_permittivity'), imat.get('loss_tangent')
            capacitance = 2*pi*8.854e-12*er/log(di/diameter)*cll if all(v is not None for v in (er, di, cll)) and screened and circular else None
            add('capacitance', title+'每相电容', capacitance, 'F/m', '5.2；附录 A', 19, core=cid, role='insulation', formula='C=2πε₀εᵣ C_LL/ln(D_i/d_c)', inputs={'d_c_with_screen_m': diameter, 'D_i_m': di, 'epsilon_r': er, 'epsilon_0': 8.854e-12, 'C_LL': cll}, status='uncovered' if not circular and conductor['form'] != 'unspecified' else None, reason='需完整圆柱屏蔽构造、介电常数和长度修正；非屏蔽多芯电容不套用此式。')
            charging = 2*pi*frequency*capacitance*voltage if all(v is not None for v in (frequency, capacitance, voltage)) else None
            add('charging', title+'每相充电电流 / 长度', charging, 'A/m', '5.2（由 I=ωCU 导出）', 19, core=cid, role='insulation', formula='I_c/L=2πf C U_phase', inputs={'f_hz': frequency, 'C_F_m': capacitance, 'U_phase_V': voltage}, reason='使用明确的运行相电压，不把型号 U₀ 当运行电压。')
            loss = 2*pi*frequency*capacitance*voltage**2*tan if all(v is not None for v in (frequency, capacitance, voltage, tan)) else None
            add('dielectric', title+'每相介质损耗', loss, 'W/m', '5.2', 19, core=cid, role='insulation', formula='W_d=2πf C U_phase² tanδ', inputs={'f_hz': frequency, 'C_F_m': capacitance, 'U_phase_V': voltage, 'tan_delta': tan})
            geometric_l = 2e-7*log(spacing/(.779*conductor['diameter']/2)) if len(cable['cores']) == 1 and circular and conductor['form'] in ('solid_round', 'stranded_round_compacted') and spacing and parameters.get('arrangement') == 'trefoil' else None
            add('geometric-inductance', title+'导体几何电感（不含金属回路）', geometric_l, 'H/m', '4.2，式 (9)，表 1（等距平衡回路导出）', 10, source='iec60287_1_3', core=cid, formula='L_geom=2·10⁻⁷ ln[s/(αd_c/2)]；α=0.779', inputs={'s_m': spacing, 'dc_m': conductor['diameter'], 'alpha': .779}, status='uncovered' if len(cable['cores']) != 1 else None, reason='仅等距单芯圆实心 / 紧压导体的几何项；不包含护套电流或大地返回，不能当作完整型号电感。')
            add('geometric-reactance', title+'导体几何感抗（不含金属回路）', 2*pi*frequency*geometric_l if frequency and geometric_l is not None else None, 'Ω/m', '4.2，式 (9)', 10, source='iec60287_1_3', core=cid, formula='X_geom=2πf L_geom', status='uncovered' if len(cable['cores']) != 1 else None)
        for key, title in [('inductance', '完整电缆电感 / 感抗'), ('positive-sequence', '正序阻抗 Z₁'), ('zero-sequence', '零序阻抗 Z₀')]:
            topology_ready = circuit and circuit.get('electrical_topology') and circuit.get('bonding', {}).get('source')
            add(key, title, None, 'Ω/m' if key != 'inductance' else 'H/m', '4.2 / 4.3（完整金属回路需拓扑）；大地返回不在本方法范围', 10, source='iec60287_1_3', status='uncovered', inputs={'topology_contract': topology}, reason='已复用领域接地拓扑契约；完整金属回路阻抗求解及大地返回尚未实现，不输出近似阻抗。' if topology_ready else '领域接地拓扑缺少相序、相角或接地来源；不从旧 bonding.kind 推断回流通路。完整阻抗求解尚未覆盖。')
    else:
        duration, initial, final = (parameter(k) for k in ('duration_s', 'initial_temperature_k', 'final_temperature_k'))
        for i, core in enumerate(cable['cores']):
            cond, cid = core['conductor'], core['id']
            const = CONSTANTS.get(materials[cond['material']].get('standard_kind'))
            area = cond['nominal_area']*1e6
            declared_final = cable['rating']['max_conductor_temperature'].get('short_circuit')
            if final is not None and declared_final is not None and final > declared_final + 1e-9:
                raise ValueError('parameters.final_temperature_k：最终温度超过已声明的导体短路温限。')
            iad = adiabatic(area, const[0], const[1], initial-273.15, final-273.15, duration) if const and all(v is not None for v in (duration, initial, final)) else None
            prefix = f'芯 {i+1} · ' if len(cable['cores']) > 1 else ''
            add('conductor-adiabatic', prefix+'导体绝热允许短路电流', iad, 'A', '第 3 章；表 I', 9, source='iec60949', core=cid, formula='I_AD=K S √{ln[(θ_f+β)/(θ_i+β)]/t}', inputs={'S_mm2': area, 'K': const[0] if const else None, 'beta_K': const[1] if const else None, 'theta_i_K': initial, 'theta_f_K': final, 't_s': duration}, status='uncovered' if not const else None, reason='按输入初末温度计算单个组件容量；不证明所选最终温度已获产品允许。')
            ins = next((l for l in layers(cable, core) if l['role'] == 'insulation'), {})
            xlpe = materials.get(ins.get('material'), {}).get('standard_kind') == 'XLPE'
            copper = materials[cond['material']].get('standard_kind') in ('copper_bare', 'copper_coated')
            x, y = (.41, .12) if copper else (.57, .16)
            eps = conductor_factor(area, duration, x, y) if const and duration is not None and xlpe else None
            add('conductor-factor', prefix+'导体非绝热修正因数', eps, '1', '5.2；表 III（XLPE，接触因数 0.7）', 13, source='iec60949', core=cid, formula='ε=√[1+X√(t/S)+Y(t/S)]', inputs={'S_mm2': area, 't_s': duration, 'X': x if xlpe else None, 'Y': y if xlpe else None}, status='uncovered' if not xlpe or not const else None, reason='只覆盖铜 / 铝导体与 XLPE 的表 III 组合。')
            add('conductor-nonadiabatic', prefix+'导体非绝热允许短路电流', iad*eps if iad is not None and eps is not None else None, 'A', '第 2 章；5.2', 9, source='iec60949', core=cid, formula='I=ε I_AD', inputs={'I_AD_A': iad, 'epsilon': eps}, status='uncovered' if not xlpe or not const else None)
        metallic = [(l, core['id']) for core in cable['cores'] for l in core['layers'] if l['role'] in ('metallic_screen', 'metallic_sheath')] + [(l, None) for l in cable['common_layers'] if l['role'] in ('metallic_screen', 'metallic_sheath')]
        if not metallic:
            add('metal-adiabatic', '金属屏蔽 / 护套绝热允许电流', None, 'A', '第 3 章；5.3 / 6.2 / 6.3', 9, source='iec60949', role='metallic_screen', reason='缺少金属屏蔽或护套构造、截面与初末温度。')
            add('metal-nonadiabatic', '金属屏蔽 / 护套非绝热允许电流', None, 'A', '5.3 / 6.1', 13, source='iec60949', role='metallic_screen', reason='需接触类型及相邻介质热参数，未用导体温度替代。')
        for layer, cid in metallic:
            role, form = layer['role'], layer.get('form')
            kind = materials[layer['material']].get('standard_kind')
            const = CONSTANTS.get(kind)
            obs = measurement(document, cable, cid, role, 'screen_area')
            area = obs['value']*1e6 if obs else None
            if area is None and form == 'wires' and layer.get('wire_count') and layer.get('wire_diameter'):
                area = layer['wire_count']*pi*(layer['wire_diameter']*1000)**2/4
            if area is None and form == 'tape' and layer.get('tape_width') and layer.get('nominal_tape_thickness') and layer.get('tape_count') and layer.get('tape_application') in ('helical_overlap', 'two_tape_gap'):
                area = layer['tape_count']*layer['tape_width']*layer['nominal_tape_thickness']*1e6
            mi, mf = parameter('metal_initial_temperature_k'), parameter('metal_final_temperature_k')
            iad = adiabatic(area, const[0], const[1], mi-273.15, mf-273.15, duration) if const and all(v is not None for v in (area, mi, mf, duration)) else None
            add(role+'-adiabatic', ('芯 '+str(next(i+1 for i,c in enumerate(cable['cores']) if c['id']==cid))+' · ' if cid else '')+'金属组件绝热允许电流', iad, 'A', '第 3 章；表 I；5.3 / 6.2 / 6.3', 9, source='iec60949', core=cid, role=role, formula='I_AD=K S √{ln[(θ_f+β)/(θ_i+β)]/t}', inputs={'S_mm2': area, 'K': const[0] if const else None, 'beta_K': const[1] if const else None, 'theta_i_K': mi, 'theta_f_K': mf, 't_s': duration}, status='uncovered' if not const else None, input_source=obs['source'] if obs else None, reason='金属组件容量单独列出；多个并联组件不能直接相加。')
            eps, m = None, None
            rho_i, rho_o, cv_i, cv_o = (parameter(k) for k in ('inner_thermal_resistivity', 'outer_thermal_resistivity', 'inner_volumetric_heat_capacity', 'outer_volumetric_heat_capacity'))
            contact = parameter('contact_factor')
            thickness = layer.get('nominal_tape_thickness') if form == 'tape' else layer.get('thickness')
            reason, status = '需金属组件厚度、相邻两侧介质热参数和接触因数的来源。', None
            if form in ('smooth', 'corrugated', 'tape') and const and all(v is not None for v in (duration, thickness, rho_i, rho_o, cv_i, cv_o, contact)):
                eps, m = metal_factor(duration, thickness, const[2], rho_i, rho_o, cv_i, cv_o, contact)
            elif form == 'wires':
                n, d, inner_d = layer.get('wire_count'), layer.get('wire_diameter'), layer.get('screen_inner_diameter')
                gap = (pi*(inner_d+d)-n*d)/n if n and d and inner_d else None
                wire_area = area/n if area is not None and n else pi*(d*1000)**2/4 if d else None
                embedded = parameters.get('wire_contact') == 'fully_embedded'
                if gap is not None and gap < 0:
                    raise ValueError('metallic_screen.wire_count：铜丝构造重叠。')
                if embedded and gap is not None and gap >= d and const and all(v is not None for v in (duration, rho_i, cv_i, wire_area)):
                    a = 2464/const[2]*sqrt(cv_i/rho_i)
                    b = 1.22/const[2]*(cv_i/rho_i)
                    eps = sqrt(1+.7*a*sqrt(duration/wire_area)+.7**2*b*duration/wire_area)
                    reason = '5.3.1：铜丝间隔至少一个丝径、完全嵌入；按每根铜丝面积计算 ε，容量再乘丝数；不包括反向扎带。'
                else:
                    status, reason = 'uncovered', '铜丝非绝热分支只覆盖明确完全嵌入且间隔至少一个丝径；其余接触类型未覆盖。'
            elif form not in ('smooth', 'corrugated', 'tape'):
                status, reason = 'uncovered', '需明确管状护套、铜带或铜丝构造。'
            add(role+'-factor', '金属组件非绝热修正因数', eps, '1', '5.1 / 5.3.1' if form == 'wires' else '6.1', 11 if form == 'wires' else 13, source='iec60949', core=cid, role=role, formula='按每根铜丝：ε=√[1+FA√(t/S_wire)+F²B(t/S_wire)]' if form == 'wires' else 'ε=1+0.61P−0.069P²+0.0043P³；P=M√t；M=F(√(σ₂/ρ₂)+√(σ₃/ρ₃))/(2σ₁δ)', inputs={'M_s_minus_half': m, 't_s': duration, 'thickness_m': thickness, 'contact_factor': contact}, status=status, reason=reason)
            add(role+'-nonadiabatic', '金属组件非绝热允许电流', iad*eps if iad is not None and eps is not None else None, 'A', '第 2 章；5.3 / 6.1', 9, source='iec60949', core=cid, role=role, formula='I=ε I_AD', inputs={'I_AD_A': iad, 'epsilon': eps}, status=status, reason=reason)
        add('parallel-fault-sharing', '多个金属回路的总故障容量', None, 'A', 'AMD1:2008，第 4 章补充', 2, source='iec60949_amendment', status='uncovered', reason='缺少接地拓扑、阻抗分配与各组件初始温度；不直接累加各组件容量。')
    counts = dict(Counter(r['status'] for r in rows))
    result = {'schema': 'cablesim.type-analysis/1', 'capability': capability, 'cable_type_id': cable['id'], 'label': cable['label'], 'method_version': METHOD_VERSIONS[capability], 'electrical_topology': topology, 'parameter_sources': parameters.get('sources', {}),
            'input_sha256': sha256(json.dumps({'document': document, 'parameters': parameters}, sort_keys=True, ensure_ascii=False, allow_nan=False).encode()).hexdigest(),
            'rows': rows, 'counts': counts, 'sources': list(SOURCES.values()), 'scope': '数值按保存的输入与已核验分支计算；不批准型号、不替代出厂试验或接地拓扑。'}
    if capability == 'short-circuit' and _include_curve:
        result['curve'] = short_circuit_curve(document, parameters, rows)
    return result


def short_circuit_curve(document, parameters, rows):
    """Every plotted point uses the same IEC calculation, never a frontend formula."""
    selected = parameters.get('duration_s')
    interests = parameters.get('interest_times_s', [])
    highlighted = sorted(set(interests + ([selected] if selected is not None and .1 <= selected <= 5 else [])))
    times = sorted(set([.1, 5] + [.1*50**(i/40) for i in range(1, 40)] + highlighted))
    currents = [r for r in rows if r['unit'] == 'A' and r['id'].endswith(('-adiabatic', '-nonadiabatic'))]
    series = [{
        'row_id': r['id'], 'title': r['title'], 'target': r['target'],
        'model': 'nonadiabatic' if r['id'].endswith('-nonadiabatic') else 'adiabatic',
        'standard': r['standard'], 'clause': r['clause'], 'source_digest': r['source_digest'],
        'values_a': [], 'statuses': [],
    } for r in currents]
    for time in times:
        point_parameters = {**parameters, 'duration_s': time, 'sources': {
            **parameters.get('sources', {}),
            'duration_s': '短路时间扫描：0.1–5 s；本点 '+format(time, '.17g')+' s',
        }}
        calculated = calculate(document, point_parameters, 'short-circuit', _include_curve=False)
        point_rows = {r['id']: r for r in calculated['rows']}
        for item in series:
            row = point_rows[item['row_id']]
            item['values_a'].append(row['value'] if row['status'] == 'available' else None)
            item['statuses'].append(row['status'])
    return {
        'schema': 'cablesim.short-circuit-curve/1', 'range_s': [.1, 5], 'axis': 'log',
        'time_unit': 's', 'current_unit': 'A', 'times_s': times,
        'highlighted_times_s': highlighted, 'selected_time_s': selected,
        'selected_time_in_range': selected is not None and .1 <= selected <= 5,
        'series': series,
        'status': 'available' if any(any(v is not None for v in item['values_a']) for item in series) else 'missing',
        'conditions': {k: parameters.get(k) for k in (
            'initial_temperature_k', 'final_temperature_k',
            'metal_initial_temperature_k', 'metal_final_temperature_k')},
        'method_version': METHOD_VERSIONS['short-circuit'],
    }


def main():
    request = json.loads(Path('input/request.json').read_text('utf-8'))
    if request.get('protocol') != 'cablesim.run/2' or request.get('phase') not in ('check', 'run') or request.get('capability') not in ('electrical', 'short-circuit'):
        raise ValueError('不支持的执行协议。')
    cases = []
    for case in request['cases']:
        try:
            artifact = calculate(case['input'], case.get('parameters', {}), request['capability'])
            result = {'case_id': case['case_id'], 'status': 'succeeded'}
            if request['phase'] == 'run':
                name = case['case_id'] + '.json'
                Path('output', name).write_text(json.dumps(artifact, ensure_ascii=False, allow_nan=False), 'utf-8')
                result.update(results=[{'key': 'x-cablesim.type-analysis.available-count', 'type': 'quantity', 'entity': artifact['cable_type_id'], 'status': 'available', 'value': artifact['counts'].get('available', 0), 'unit': '1'}], artifacts=[{'type': 'x-cablesim.type-' + request['capability'], 'path': 'output/' + name}])
            cases.append(result)
        except (ValueError, KeyError, TypeError) as error:
            cases.append({'case_id': case['case_id'], 'status': 'not_applicable', 'error': {'code': 'TYPE_INPUT_INVALID', 'message': str(error)}})
    Path('output/result.json').write_text(json.dumps({'protocol': 'cablesim.run/2', 'cases': cases, 'environment': {'python': platform.python_version(), 'method': METHOD_VERSIONS[request['capability']]}}, ensure_ascii=False, allow_nan=False), 'utf-8')


if __name__ == '__main__':
    main()
