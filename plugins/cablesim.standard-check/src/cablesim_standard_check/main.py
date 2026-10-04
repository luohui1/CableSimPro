"""Product dimensional requirements. SI inputs; normative arithmetic stays in this plugin."""
from collections import Counter
from decimal import Decimal, ROUND_HALF_UP
from hashlib import sha256
import json
import math
from pathlib import Path
import platform

VERSION = 'GB-DIMENSIONS-0.1.1'
SOURCES = json.loads(Path(__file__).with_name('sources.json').read_text('utf-8'))
AREAS = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400, 500, 630, 800, 1000, 1200, 1400, 1600]
DL = dict(zip(AREAS[4:], [3.6, 4.5, 5.6, 6.7, 8, 9.4, 11, 12.4, 13.8, 15.3, 17.5, 19.5, 22.6, 25.2, 28.3, 31.9, 35.7, 39.1, 42.2, 45.1]))
DL.update({1.5: 1.4, 2.5: 1.8, 4: 2.3, 6: 2.8})
LV_XLPE = dict(zip(AREAS[:21], [.7, .7, .7, .7, .7, .7, .9, .9, 1, 1.1, 1.1, 1.2, 1.4, 1.6, 1.7, 1.8, 2, 2.2, 2.4, 2.6, 2.8]))
CU2 = dict(zip([.5, .75, 1] + AREAS + [1800, 2000, 2500], [36, 24.5, 18.1, 12.1, 7.41, 4.61, 3.08, 1.83, 1.15, .727, .524, .387, .268, .193, .153, .124, .0991, .0754, .0601, .047, .0366, .0283, .0221, .0176, .0151, .0129, .0113, .0101, .009, .0072]))
CU_COATED2 = dict(zip([.5, .75, 1] + AREAS + [1800, 2000, 2500], [36.7, 24.8, 18.2, 12.2, 7.56, 4.70, 3.11, 1.84, 1.16, .734, .529, .391, .270, .195, .154, .126, .100, .0762, .0607, .0475, .0369, .0286, .0224, .0177, .0151, .0129, .0113, .0101, .009, .0072]))
AL2 = dict(zip(AREAS[4:] + [1800, 2000, 2500], [3.08, 1.91, 1.20, .868, .641, .443, .320, .253, .206, .164, .125, .100, .0778, .0605, .0469, .0367, .0291, .0247, .0212, .0186, .0165, .0149, .0127]))
R20_VERIFIED = {'copper_bare': CU2, 'copper_coated': CU_COATED2, 'aluminium': AL2}
HV_AREAS = [240, 300, 400, 500, 630, 800, 1000, 1200, 1400, 1600, 1800, 2000]
HV_INS = dict(zip(HV_AREAS, [19, 18.5, 17.5, 17, 16.5, 16, 16, 16, 16, 16, 16, 16]))
HV_PB = dict(zip(HV_AREAS, [2.6, 2.6, 2.7, 2.7, 2.8, 2.9, 3, 3.1, 3.2, 3.3, 3.3, 3.3]))
HV_AL = dict(zip(HV_AREAS, [2, 2, 2, 2, 2, 2, 2.3, 2.3, 2.3, 2.3, 2.3, 2.3]))
HV_OS = dict(zip(HV_AREAS, [4, 4, 4, 4, 4.5, 4.5, 4.5, 5, 5, 5, 5, 5]))
SCREEN_INCREMENT = list(zip([1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300], [.5, .5, .5, .6, .8, 1.1, 1.2, 1.4, 1.7, 2, 2.4, 2.7, 3, 4, 5, 6]))


def rounded(value, places=1):
    return float(Decimal(str(value)).quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP))


def number(value, path, maximum, *, integer=False, zero=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0 or (value == 0 and not zero) or value > maximum or (integer and int(value) != value):
        raise ValueError(path + '：请输入范围内的' + ('非负' if zero else '正') + ('整数' if integer else '数值') + '，并核对 SI 单位。')
    return value


def prepare(document, parameters):
    if document.get('schema_version') != 'cablesim.domain/1':
        raise ValueError('schema_version：请选择 cablesim.domain/1 的 SI 输入。')
    if set(parameters) - {'cable_type_id'}:
        raise ValueError('parameters：此方法只接受 cable_type_id，不接受替代标准限值。')
    cable = next((t for t in document.get('cable_types', []) if t['id'] == parameters.get('cable_type_id')), None)
    if cable is None:
        raise ValueError('parameters.cable_type_id：请选择当前文档中的型号。')
    index = document['cable_types'].index(cable)
    root = f'cable_types.{index}'
    u0 = number(cable['rating'].get('u0'), root + '.rating.u0', 1e6)
    u = number(cable['rating'].get('u'), root + '.rating.u', 1e6)
    family = {(600, 1000): 'mv1', (1800, 3000): 'mv1', (3600, 6000): 'mv2', (6000, 6000): 'mv2', (6000, 10000): 'mv2', (8700, 10000): 'mv2', (8700, 15000): 'mv2', (12000, 20000): 'mv2', (18000, 20000): 'mv2', (18000, 30000): 'mv2', (21000, 35000): 'mv3', (26000, 35000): 'mv3', (64000, 110000): 'hv'}.get((u0, u))
    if family is None:
        raise ValueError(root + '.rating.u0：额定电压组合不在已核验产品标准范围内，请核对 U₀/U。')
    cores = cable.get('cores', [])
    if cable.get('construction') not in ('single_core', 'three_core') or len(cores) != (1 if cable['construction'] == 'single_core' else 3):
        raise ValueError(root + '.construction：当前支持单芯或三芯结构。')
    if family == 'hv' and len(cores) != 1:
        raise ValueError(root + '.construction：GB/T 11017.2 的本实现只支持单芯 64/110 kV。')
    materials = {m['id']: m for m in document.get('materials', [])}
    for i, core in enumerate(cores):
        c, p = core['conductor'], root + f'.cores.{i}.conductor'
        number(c['nominal_area'], p + '.nominal_area', .01)
        number(c['diameter'], p + '.diameter', .2)
        if c['material'] not in materials:
            raise ValueError(p + '.material：材料引用不存在。')
        if c.get('r20') is not None:
            number(c['r20'], p + '.r20', 1)
        if c.get('conductor_class') is not None and c['conductor_class'] not in (1, 2, 5, 6):
            raise ValueError(p + '.conductor_class：请选择 1、2、5 或 6 类导体。')
        combined = core['layers'] + (cable['common_layers'] if len(cores) == 1 else [])
        if len({l['role'] for l in combined}) != len(combined):
            raise ValueError(root + f'.cores.{i}.layers：线芯与公共层不能重复定义同一角色。')
    for layers, path in [(c['layers'], root + f'.cores.{i}.layers') for i, c in enumerate(cores)] + [(cable['common_layers'], root + '.common_layers')]:
        if len({l['role'] for l in layers}) != len(layers):
            raise ValueError(path + '：同一堆叠内的层角色不能重复。')
        for j, l in enumerate(layers):
            p = path + f'.{j}'
            if l['material'] not in materials:
                raise ValueError(p + '.material：材料引用不存在。')
            for key in ('thickness', 'minimum_thickness', 'maximum_thickness', 'mean_thickness', 'nominal_tape_thickness', 'minimum_tape_thickness', 'wire_diameter', 'tape_width', 'screen_inner_diameter', 'reverse_binder_width'):
                if l.get(key) is not None:
                    number(l[key], p + '.' + key, .5)
            for key in ('wire_count', 'tape_count', 'reverse_binder_count'):
                if l.get(key) is not None:
                    number(l[key], p + '.' + key, 10000, integer=True)
            for key in ('overlap', 'minimum_overlap'):
                if l.get(key) is not None:
                    number(l[key], p + '.' + key, .999999, zero=True)
            if l.get('reverse_binder_thickness') is not None:
                number(l['reverse_binder_thickness'], p + '.reverse_binder_thickness', .05, zero=True)
            if l.get('minimum_thickness') is not None and l.get('maximum_thickness') is not None and l['minimum_thickness'] > l['maximum_thickness']:
                raise ValueError(p + '.minimum_thickness：最薄点不得大于最大实测厚度。')
    return cable, root, family, materials


def insulation_limit(family, u0, area, kind):
    if kind != 'XLPE':
        return None
    if family == 'hv':
        return HV_INS.get(area)
    if family == 'mv3':
        return (9.3 if u0 == 21000 else 10.5) if area in DL and area >= 50 else None
    if family == 'mv1':
        base = LV_XLPE.get(area)
        return base if u0 == 600 else max(2, base) if base is not None and area >= 10 else None
    if area not in DL:
        return None
    if u0 == 3600:
        return 2.5 if area <= 185 else {240: 2.6, 300: 2.8, 400: 3}.get(area, 3.2)
    return {6000: (16, 3.4), 8700: (25, 4.5), 12000: (35, 5.5), 18000: (50, 8)}[u0][1] if area >= {6000: 16, 8700: 25, 12000: 35, 18000: 50}[u0] else None


def screen_area(layer):
    if layer.get('form') == 'tape':
        if any(layer.get(k) is None for k in ('tape_count', 'nominal_tape_thickness', 'tape_width')):
            return None, '需提供带材根数、单带标称厚度和带宽。'
        return layer['tape_count'] * layer['nominal_tape_thickness'] * layer['tape_width'] * 1e6, None
    if layer.get('form') == 'wires':
        if any(layer.get(k) is None for k in ('wire_count', 'wire_diameter', 'reverse_binder_thickness')):
            return None, '需提供丝数、丝径及反向扎带厚度（明确无扎带时填 0）。'
        area = layer['wire_count'] * (layer['wire_diameter'] * 1000) ** 2 * math.pi / 4
        binder = layer['reverse_binder_thickness'] * 1000
        if binder > .3:
            if any(layer.get(k) is None for k in ('reverse_binder_count', 'reverse_binder_width')):
                return None, '大于 0.3 mm 的反向扎带需提供根数和带宽。'
            area += layer['reverse_binder_count'] * binder * layer['reverse_binder_width'] * 1000
        return area, None
    return None, '金属屏蔽构造尚未明确为铜带或铜丝。'


def screen_increment(layer):
    area, missing = screen_area(layer)
    if missing:
        return None, missing
    if layer.get('form') == 'tape':
        application, t = layer.get('tape_application'), layer['nominal_tape_thickness'] * 1000
        if application in ('helical_overlap', 'two_tape_gap'):
            total = 2 * t
        elif application == 'longitudinal' and layer.get('overlap') is not None:
            total = t if layer['overlap'] < .3 else 2 * t
        else:
            return None, '需明确屏蔽带重叠绕包、双带间隙绕包或纵包。'
        if total < .15:
            return 0, None
    return next((d for s, d in SCREEN_INCREMENT if area <= s), None), '屏蔽截面超过已核验附录 A 表 A.2 范围。' if area > 300 else None


def check(document, parameters):
    cable, root, family, materials = prepare(document, parameters)
    rows, trace = [], []
    observations = document.get('measurements', [])
    for observation in observations:
        number(observation.get('value'), 'measurements.value', 1)
        if observation.get('basis') not in ('measurement', 'manufacturer_limit') or observation.get('source', {}).get('kind') not in ('measurement', 'manufacturer') or not observation.get('source', {}).get('reference', '').strip():
            raise ValueError('measurements.source.reference：请填写试验报告编号或厂家数据表出处。')
        if observation.get('basis') == 'manufacturer_limit' and observation.get('quantity') != 'r20':
            raise ValueError('measurements.basis：声明上限不能作为实际厚度或金属截面。')
    def observed(core, role, quantity):
        matches = [o for o in observations if o.get('cable_type') == cable['id'] and o.get('core') == core and o.get('role') == role and o.get('quantity') == quantity]
        if len(matches) > 1:
            raise ValueError('measurements：同一对象和量重复，请编辑已有记录。')
        return matches[0] if matches else None
    def row(key, title, path, clause, page, limit=None, actual=None, unit='mm', comparison='>=', *, formula=None, inputs=None, reason=None, uncovered=False, basis='design', source=family, precision=None, target_override=None):
        source_record = SOURCES[source]
        pointer = '/' + path.replace('.', '/')
        provenance = document.get('provenance', {}).get(pointer)
        stable_parts, cursor = [], document
        for part in path.split('.'):
            if isinstance(cursor, list) and (not part.isdigit() or int(part) >= len(cursor)):
                break
            next_value = cursor.get(part) if isinstance(cursor, dict) else cursor[int(part)]
            name = (next_value.get('id') or next_value.get('role') or part) if isinstance(cursor, list) and isinstance(next_value, dict) else part
            stable_parts.append(str(name).replace('~', '~0').replace('/', '~1'))
            cursor = next_value
            if cursor is None:
                break
        stable = '/' + '/'.join(stable_parts)
        provenance = document.get('provenance', {}).get(stable, provenance)
        parts = path.split('.')
        target = {'scope': 'core' if 'cores' in parts else 'common', 'core_id': cable['cores'][int(parts[parts.index('cores') + 1])]['id'] if 'cores' in parts else None, 'role': 'conductor' if 'conductor' in parts else None}
        if 'layers' in parts or 'common_layers' in parts:
            marker = 'layers' if 'layers' in parts else 'common_layers'
            at = parts.index(marker)
            if at + 1 < len(parts) and parts[at + 1].isdigit():
                target['role'] = (cable['cores'][int(parts[parts.index('cores') + 1])]['layers'] if marker == 'layers' else cable['common_layers'])[int(parts[at + 1])]['role']
        if target_override is not None:
            target = target_override
        quantity = 'screen_area' if key == 'screen-area' else None if key == 'insulation-uniformity' else path.rsplit('.', 1)[-1]
        observation = observed(target.get('core_id'), target.get('role'), quantity)
        design_actual = actual
        if observation:
            expected_unit = 'ohm/m' if quantity == 'r20' else 'm2' if quantity == 'screen_area' else 'm'
            if observation.get('unit') != expected_unit:
                raise ValueError('measurements.unit：实测量的 SI 单位不正确。')
            actual = observation['value'] * (1e6 if expected_unit == 'm2' else 1000)
            basis, provenance = observation['basis'], observation['source']
            if limit is not None and key == 'r20':
                reason = '出厂数据与标准上限比较；来源记录不代表已人工批准。'
        value, threshold = actual, limit
        if value is not None and precision is not None:
            value = rounded(value, precision)
        if threshold is not None and precision is not None:
            threshold = rounded(threshold, precision)
        satisfied = value is not None and threshold is not None and (value >= threshold if comparison == '>=' else value == threshold if comparison == '=' else value <= threshold)
        verdict = 'uncovered' if uncovered else 'missing' if threshold is None or value is None else 'passed' if satisfied else 'failed'
        margin = None if value is None or threshold is None else (value - threshold if comparison == '>=' else threshold - value)
        rows.append({'id': path + ':' + key, 'title': title, 'path': path, 'layer_path': path.rsplit('.', 1)[0], 'target': target, 'standard': source_record['standard'], 'clause': clause, 'printed_page': page,
                     'pdf_page': page + source_record['page_offset'] if page is not None else None, 'source_digest': source_record.get('sha256'), 'source_status': source_record['status'], 'limit': threshold, 'actual': value, 'actual_unrounded': actual,
                     'margin': margin, 'unit': unit, 'comparison': comparison, 'verdict': verdict, 'reason': reason, 'formula': formula, 'formula_inputs': inputs or {}, 'basis': basis, 'input_source': provenance, 'design_actual': design_actual if observation else None, 'measurement_id': observation['id'] if observation else None})
        return rows[-1]
    def layer_pairs(core, index):
        return [(l, root + f'.cores.{index}.layers.{j}') for j, l in enumerate(core['layers'])] + ([(l, root + f'.common_layers.{j}') for j, l in enumerate(cable['common_layers'])] if len(cable['cores']) == 1 else [])
    def find_layer(pairs, role):
        return next(((l, p) for l, p in pairs if l['role'] == role), ({}, root + '.common_layers'))
    core_diameters = []
    for i, core in enumerate(cable['cores']):
        cond, cp = core['conductor'], root + f'.cores.{i}.conductor'
        area = rounded(cond['nominal_area'] * 1e6, 6)
        conductor_kind = materials[cond['material']].get('standard_kind')
        rlimit = R20_VERIFIED.get(conductor_kind, {}).get(area) if cond.get('conductor_class') == 2 else None
        rbasis = cond.get('r20_basis')
        row('r20', f'芯 {i+1} · 导体 R₂₀', cp + '.r20', '5.2.2 / 5.3.2，表 2；第 7 章', 4 if area <= 1000 else 5, rlimit, cond.get('r20') * 1000 if cond.get('r20') is not None and rbasis else None, 'Ω/km', '<=', source='conductor', basis=rbasis or 'unknown',
            reason='需明确第 2 类、裸铜/镀层铜/铝及 R₂₀ 数据性质；表内上限不作为实测值。' if rlimit is None or rbasis is None else '制造商上限仅核对声明值，不代表试验合格。' if rbasis == 'manufacturer_limit' else None,
            uncovered=cond.get('conductor_class') is not None and cond['conductor_class'] != 2 or (cond.get('conductor_class') == 2 and conductor_kind is not None and area not in R20_VERIFIED.get(conductor_kind, {})))
        pairs = layer_pairs(core, i)
        ins, ip = find_layer(pairs, 'insulation')
        insulation_kind = materials.get(ins.get('material'), {}).get('standard_kind')
        tn = insulation_limit(family, cable['rating']['u0'], area, insulation_kind)
        declared_insulation = ins['thickness'] * 1000 if ins.get('thickness') is not None else None
        specified_insulation = max(tn, declared_insulation) if tn is not None and declared_insulation is not None else None
        ins_clause, ins_page = ('6.2.2，表 2', 4) if family == 'hv' else ('6.2，表 6', 6) if family == 'mv3' else ('6.2，表 7', 7 if family == 'mv2' else 6)
        row('insulation-nominal', f'芯 {i+1} · 绝缘标称厚度', ip + '.thickness', ins_clause, ins_page, tn, ins.get('thickness', 0) * 1000 if ins else None,
            reason='需明确绝缘材料为 XLPE 和表内标称截面；其他材料或表外截面未覆盖。' if tn is None else None, uncovered=insulation_kind is not None and tn is None)
        if family == 'hv':
            row('insulation-minimum', f'芯 {i+1} · 绝缘最薄点', ip + '.minimum_thickness', '6.2.2 → GB/T 11017.1—2024 10.6.2', 4, actual=ins.get('minimum_thickness') * 1000 if ins.get('minimum_thickness') is not None else None, reason='缺少 GB/T 11017.1—2024 原文，未实现其限值。', uncovered=True, basis='measurement')
        elif family == 'mv1':
            row('insulation-minimum', f'芯 {i+1} · 绝缘最薄点', ip + '.minimum_thickness', '16.5.2，式 (4)；附录 B 表 B.1', 16, .9 * specified_insulation - .1 if specified_insulation is not None else None, ins.get('minimum_thickness') * 1000 if ins.get('minimum_thickness') is not None else None, basis='measurement', precision=2, formula='t_min ≥ 0.9 t_n − 0.1', inputs={'t_n_declared_mm': declared_insulation, 't_n_standard_min_mm': tn, 't_n_mm': specified_insulation})
            row('insulation-mean', f'芯 {i+1} · 绝缘平均厚度', ip + '.mean_thickness', '16.5.2；附录 B 表 B.1', 16, specified_insulation, ins.get('mean_thickness') * 1000 if ins.get('mean_thickness') is not None else None, basis='measurement', precision=1)
        else:
            row('insulation-minimum', f'芯 {i+1} · 绝缘最薄点', ip + '.minimum_thickness', '17.5.2，式 (4)；附录 B 表 B.1', 17 if family == 'mv2' else 14, .9 * specified_insulation - .1 if specified_insulation is not None else None, ins.get('minimum_thickness') * 1000 if ins.get('minimum_thickness') is not None else None, formula='t_min ≥ 0.9 t_n − 0.1', inputs={'t_n_declared_mm': declared_insulation, 't_n_standard_min_mm': tn, 't_n_mm': specified_insulation}, basis='measurement', precision=2, reason='t_n 为该层规定标称厚度；不低于标准标称要求，采用更厚的设计时随之提高。最薄点必须录入实测值。')
            tmin, tmax = ins.get('minimum_thickness'), ins.get('maximum_thickness')
            minimum = observed(core['id'] if len(cable['cores']) > 1 else None if '.common_layers.' in ip else core['id'], 'insulation', 'minimum_thickness')
            maximum = observed(core['id'] if len(cable['cores']) > 1 else None if '.common_layers.' in ip else core['id'], 'insulation', 'maximum_thickness')
            if minimum or maximum:
                same_sample = minimum and maximum and minimum['source']['reference'] == maximum['source']['reference']
                tmin, tmax = (minimum['value'], maximum['value']) if same_sample else (None, None)
                if tmin is not None and tmin > tmax:
                    raise ValueError('measurements.minimum_thickness：同一试样的最薄点大于最大实测厚度。')
            row('insulation-uniformity', f'芯 {i+1} · 绝缘厚度偏差', ip + '.maximum_thickness', '17.5.2，式 (5)', 17 if family == 'mv2' else 14, .15, (tmax - tmin) / tmax if tmax is not None and tmin is not None else None, '1', '<=', basis='measurement', formula='(t_max − t_min) / t_max ≤ 0.15', reason='需录入同一试样的最薄点和最大实测厚度。')
        screen, sp = find_layer(pairs, 'metallic_screen')
        if screen:
            sarea, missing = screen_area(screen)
            if screen.get('form') == 'tape':
                copper = materials[screen['material']].get('standard_kind') in ('copper_bare', 'copper_coated')
                section = '9.2.3' if family == 'mv1' else '10.2.3' if family == 'mv2' else '10.2.2'
                page = 9 if family == 'mv1' else 10 if family == 'mv2' else 8
                if family != 'hv':
                    tt = screen.get('nominal_tape_thickness')
                    row('screen-tape-nominal', f'芯 {i+1} · 屏蔽铜带标称厚度', sp + '.nominal_tape_thickness', section, page, .12 if len(cable['cores']) == 1 else .10, tt * 1000 if tt is not None and copper else None, reason='需明确铜材及单带标称厚度；径向层厚不作为单带厚度。')
                    row('screen-tape-minimum', f'芯 {i+1} · 屏蔽铜带最薄点', sp + '.minimum_tape_thickness', section + '；附录 B 表 B.1', page, .9 * max(.12 if len(cable['cores']) == 1 else .10, tt * 1000) if tt is not None else None, screen.get('minimum_tape_thickness') * 1000 if screen.get('minimum_tape_thickness') is not None and copper else None, basis='measurement', formula='t_t,min ≥ 0.9 t_t,n', precision=2)
                    row('screen-overlap', f'芯 {i+1} · 屏蔽铜带标称搭盖率', sp + '.overlap', section, page, .15, screen.get('overlap') if copper else None, '1', '=')
                    row('screen-overlap-minimum', f'芯 {i+1} · 屏蔽铜带最小搭盖率', sp + '.minimum_overlap', section, page, .05, screen.get('minimum_overlap') if copper else None, '1', basis='measurement')
                    if family == 'mv3' and area >= 500:
                        row('screen-wire-required', f'芯 {i+1} · 大截面铜丝屏蔽', sp + '.form', '10.2.3', 8, 1, 0, '1', reason='导体截面不小于 500 mm² 应采用铜丝屏蔽。')
            if screen.get('form') == 'wires':
                if family == 'hv':
                    copper = materials[screen['material']].get('standard_kind') in ('copper_bare', 'copper_coated')
                    row('screen-wire-diameter', '屏蔽铜丝标称直径', sp + '.wire_diameter', '6.5.2', 6, 1, screen.get('wire_diameter') * 1000 if screen.get('wire_diameter') is not None and copper else None, reason='需明确屏蔽材质为铜。' if not copper else None)
                    n, d, diameter = screen.get('wire_count'), screen.get('wire_diameter'), screen.get('screen_inner_diameter')
                    gap = (math.pi * (diameter + d) - n * d) / n * 1000 if n and d and diameter and copper else None
                    if gap is not None and gap < 0:
                        raise ValueError(sp + '.wire_count：丝数、丝径和屏蔽下直径造成铜丝重叠，请修正构造。')
                    row('screen-wire-gap', '屏蔽铜丝平均间隙', sp + '.screen_inner_diameter', '6.5.2，式 (1)', 6, 4, gap, comparison='<=', formula='G = [π(D+d) − nd] / n', inputs={'D_mm': diameter * 1000 if diameter else None, 'd_mm': d * 1000 if d else None, 'n': n}, reason='D 为铜丝屏蔽下实测/设计直径，需明确输入。')
                else:
                    row('screen-wire-gap', f'芯 {i+1} · 屏蔽铜丝平均间隙', sp + '.screen_inner_diameter', '9.2.2' if family == 'mv1' else '10.2.2' if family == 'mv2' else '10.2.3', 9 if family == 'mv1' else 10 if family == 'mv2' else 8, reason='条文引用 GB/T 11017.2—2014 的定义与算法；该版原文缺失，未用 2024 版替代。', uncovered=True)
            row('screen-area', f'芯 {i+1} · 屏蔽标称截面', sp + '.wire_count' if screen.get('form') == 'wires' else sp + '.tape_width', '6.5.2 / 6.5.3' if family == 'hv' else '9.2.1 / 附录 A.2.5' if family == 'mv1' else '10.2.1 / 附录 A.2.5', 6 if family == 'hv' else 9 if family == 'mv1' else 10 if family == 'mv2' else 8, actual=sarea, unit='mm²', uncovered=True, reason=(missing + ' ' if missing else '') + '截面最低要求取决于故障电流及短路容量，尚未绑定该要求；几何截面不代表短路合格。', formula='n_t t_t W_t / n_w π d_w²/4 + n_h t_h W_h')
        elif family != 'mv1':
            screen_path = root + f'.cores.{i}.layers' if len(cable['cores']) > 1 else root + '.common_layers'
            target = {'scope': 'core' if len(cable['cores']) > 1 else 'common', 'core_id': core['id'] if len(cable['cores']) > 1 else None, 'role': 'metallic_sheath' if family == 'hv' else 'metallic_screen'}
            row('screen-area', f'芯 {i+1} · 金属屏蔽 / 护套截面', screen_path, '6.5' if family == 'hv' else '10.2', 6 if family == 'hv' else 10 if family == 'mv2' else 8, uncovered=True, reason='未提供独立金属屏蔽构造；金属护套兼作屏蔽仍需短路容量要求。', target_override=target)
            if family != 'hv':
                row('screen-dimensions', f'芯 {i+1} · 屏蔽构造与尺寸', screen_path, '10.2.2 / 10.2.3', 10 if family == 'mv2' else 8, reason='请定义金属屏蔽层及铜带 / 铜丝构造，生成对应的带厚、丝径与间隙要求；缺层不代表免除要求。', target_override=target)
        if family in ('mv1', 'mv2', 'mv3') and tn is not None and area in DL:
            actual_tn = ins.get('thickness')
            conductor_screen, _ = find_layer(pairs, 'conductor_screen')
            insulation_screen, _ = find_layer(pairs, 'insulation_screen')
            if actual_tn is None or (family != 'mv1' and (not conductor_screen or not insulation_screen)):
                core_diameters.append((None, '需提供绝缘与两层半导电屏蔽的完整结构。'))
            else:
                semi_increment = 0 if family == 'mv1' else 3
                dc = rounded(DL[area] + 2 * rounded(actual_tn * 1000) + semi_increment)
                increment, why = screen_increment(screen) if screen else (0, None)
                if len(cable['cores']) == 3 and any(l['role'] not in ('conductor_screen', 'insulation', 'insulation_screen', 'metallic_screen') and not (l['role'] == 'binder' and l['thickness'] <= .0003) for l, _ in pairs):
                    increment, why = None, '线芯附加护层的假定直径分支未覆盖。'
                core_diameters.append((rounded(dc + increment) if increment is not None else None, why))
                trace.append({'stage': f'芯 {i+1} 假定直径', 'clause': '附录 A.2.1 / A.2.2 / A.2.5；B.1', 'd_L_mm': DL[area], 't_in_mm': rounded(actual_tn * 1000), 'semiconductive_increment_mm': semi_increment, 'screen_increment_mm': increment, 'D_c_mm': core_diameters[-1][0]})
        else:
            core_diameters.append((None, '此结构的附录 A 假定直径链未覆盖。'))
    common = [(l, root + f'.common_layers.{j}') for j, l in enumerate(cable['common_layers'])]
    area = rounded(cable['cores'][0]['conductor']['nominal_area'] * 1e6, 6)
    if family == 'hv':
        single_layers = layer_pairs(cable['cores'][0], 0)
        sheath, shp = find_layer(single_layers, 'metallic_sheath')
        kind = materials.get(sheath.get('material'), {}).get('standard_kind')
        limit = HV_PB.get(area) if kind == 'lead' else HV_AL.get(area) if kind == 'aluminium' and sheath.get('form') == 'corrugated' else 1.8 if kind == 'aluminium' and sheath.get('form') == 'smooth' and area in HV_AREAS else None
        row('sheath-nominal', '金属护套标称厚度', shp + '.thickness', '6.6.2，表 3', 7, limit, sheath.get('thickness') * 1000 if sheath.get('thickness') is not None else None, reason='需明确铅 / 光滑铝 / 波纹铝；铜护套需供需协议，本实现未覆盖。', uncovered=kind is not None and limit is None)
        row('sheath-minimum', '金属护套最薄点', shp + '.minimum_thickness', '6.6.2 → GB/T 11017.1—2024 10.7.2 / 10.7.3', 6, actual=sheath.get('minimum_thickness') * 1000 if sheath.get('minimum_thickness') is not None else None, uncovered=True, basis='measurement', reason='缺少 GB/T 11017.1—2024 原文。')
        for role, title, clause in [('conductor_screen', '导体半导电屏蔽最薄点', '6.3.2'), ('insulation_screen', '绝缘半导电屏蔽最薄点', '6.3.3')]:
            layer, lp = find_layer(single_layers, role)
            row(role + '-minimum', title, lp + '.minimum_thickness', clause, 5, .5, layer.get('minimum_thickness') * 1000 if layer.get('minimum_thickness') is not None else None, basis='measurement', reason='约 1.5 / 1.0 mm 为近似厚度说明，不作为标称厚度硬性下限。', target_override=None if layer else {'scope': 'common', 'core_id': None, 'role': role})
        os, op = find_layer(single_layers, 'oversheath')
        row('oversheath-nominal', '外护套标称厚度', op + '.thickness', '6.7.2，表 4', 8, HV_OS.get(area), os.get('thickness') * 1000 if os.get('thickness') is not None else None)
        row('oversheath-minimum', '外护套最薄点', op + '.minimum_thickness', '6.7.2 → GB/T 11017.1—2024 10.6.3', 7, actual=os.get('minimum_thickness') * 1000 if os.get('minimum_thickness') is not None else None, uncovered=True, basis='measurement', reason='缺少 GB/T 11017.1—2024 原文。')
        row('bedding-nominal', '内衬层 / 半导电缓冲层', root + '.common_layers', '6.4', 5, uncovered=True, reason='缓冲 / 阻水构造与产品协议尚未覆盖，未套用中压内衬层公式。')
    else:
        dc_values = [v for v, _ in core_diameters]
        why = next((w for v, w in core_diameters if v is None), None)
        if len(set(v for v in dc_values if v is not None)) > 1:
            why = '异尺寸绝缘线芯成缆的假定直径分支未覆盖。'
        diameter = rounded(dc_values[0] * (2.16 if len(cable['cores']) == 3 else 1)) if not why else None
        trace.append({'stage': '缆芯假定直径', 'clause': '附录 A.2.3；B.1', 'B': 2.16 if len(cable['cores']) == 3 else 1, 'D_f_mm': diameter, 'missing': why})
        os, op = find_layer(common, 'oversheath')
        bedding_seen = False
        for layer, lp in common:
            role = layer['role']
            if role in ('conductor_screen', 'insulation', 'insulation_screen', 'metallic_screen'):
                if len(cable['cores']) == 3:
                    diameter, why = None, '三芯公共屏蔽或绝缘层的假定直径分支未覆盖。'
                continue  # Single-core layers were included in D_c.
            if role == 'oversheath':
                break
            if role == 'bedding':
                bedding_seen = True
                limit = next((t for upper, t in [(25, 1), (35, 1.2), (45, 1.4), (60, 1.6), (80, 1.8), (math.inf, 2)] if diameter is not None and diameter <= upper), None)
                if family == 'mv3' and limit is not None:
                    limit = max(1.2, limit)
                wrapped = layer.get('form') == 'tape'
                if layer.get('form') not in ('smooth', 'tape'):
                    diameter, why, limit = None, '需明确内衬层为挤包或绕包。', None
                if wrapped:
                    limit = (.4 if diameter <= 40 else .6) if diameter is not None else None
                uncovered = family == 'mv1' or (family == 'mv3' and wrapped)
                row('bedding-nominal', '内衬层标称厚度', lp + '.thickness', '7.2.3 / 7.2.4' if family == 'mv1' else '8.2.3，表 7' if family == 'mv3' else '8.2.4' if wrapped else '8.2.3，表 9', 8 if family == 'mv1' else 7 if family == 'mv3' else 9 if wrapped else 8, limit, layer['thickness'] * 1000, uncovered=uncovered, formula='t_B = table(D_f)' if not wrapped else 'D_f ≤ 40: 0.4; D_f > 40: 0.6', inputs={'D_f_mm': diameter}, reason='第 1 部分成缆与省略内衬层分支未覆盖。' if family == 'mv1' else '第 3 部分只核验挤包内衬层。' if uncovered else why)
                if family != 'mv1' and not uncovered:
                    specified_bedding = max(limit or 0, layer['thickness'] * 1000)
                    row('bedding-minimum', '内衬层最薄点', lp + '.minimum_thickness', '17.12' if wrapped else '17.5.3，式 (6)；附录 B 表 B.1', 21 if wrapped else 18 if family == 'mv2' else 15, .8 * specified_bedding - .2 if not wrapped else None, layer.get('minimum_thickness') * 1000 if layer.get('minimum_thickness') is not None else None, basis='measurement', formula=None if wrapped else 't_min ≥ 0.8 t_n − 0.2', inputs={'t_n_declared_mm': layer['thickness'] * 1000, 't_n_standard_min_mm': limit, 't_n_mm': specified_bedding}, precision=2, uncovered=wrapped, reason='绕包内衬层的制造检验分支未覆盖。' if wrapped else 't_n 为规定标称厚度；已知的标准标称要求不因较薄设计而降低。')
                increment_t = (.4 if diameter <= 40 else .6) if family in ('mv1', 'mv2') and diameter is not None else limit
                diameter = rounded(diameter + 2 * increment_t) if diameter is not None and increment_t is not None else None
            elif role == 'metallic_sheath':
                is_lead = materials[layer['material']].get('standard_kind') == 'lead'
                limit = max(1.2, rounded(.03 * diameter + .7)) if diameter is not None and is_lead else None
                row('sheath-nominal', '铅套标称厚度', lp + '.thickness', '11，式 (1)' if family == 'mv1' else '12，式 (1)', 10 if family == 'mv1' else 11 if family == 'mv2' else 8, limit, layer['thickness'] * 1000, formula='t_Pb = max(1.2, round_0.1(0.03 D_g + 0.7))', inputs={'D_g_mm': diameter}, uncovered=not is_lead or family == 'mv1', reason='仅核验铅套分支；其他金属护套未覆盖。' if not is_lead else why)
                if family != 'mv1':
                    specified_lead = max(limit or 0, layer['thickness'] * 1000)
                    row('sheath-minimum', '铅套最薄点', lp + '.minimum_thickness', '17.6.1，式 (7)；附录 B 表 B.1', 18 if family == 'mv2' else 15, .95 * specified_lead - .1 if is_lead else None, layer.get('minimum_thickness') * 1000 if layer.get('minimum_thickness') is not None else None, basis='measurement', precision=2, uncovered=not is_lead, formula='t_Pb,min ≥ 0.95 t_Pb − 0.1', inputs={'t_Pb_declared_mm': layer['thickness'] * 1000, 't_Pb_standard_min_mm': limit, 't_Pb_mm': specified_lead})
                diameter = rounded(diameter + 2 * limit) if diameter is not None and limit is not None else None
            elif role == 'separator':
                previous = common[common.index((layer, lp)) - 1][0] if common.index((layer, lp)) else {}
                on_lead = previous.get('role') == 'metallic_sheath' and materials.get(previous.get('material'), {}).get('standard_kind') == 'lead'
                limit = max(1 if on_lead else 1.2, rounded(.02 * diameter + .6)) if diameter is not None else None
                row('separator-nominal', '隔离套标称厚度', lp + '.thickness', '13.3.3，式 (2)', 12 if family == 'mv2' else 9, limit, layer['thickness'] * 1000, uncovered=family == 'mv1', formula='t_ss = max(minimum, round_0.1(0.02 D_u + 0.6))', inputs={'D_u_mm': diameter, 'minimum_mm': 1 if on_lead else 1.2}, reason=why)
                diameter = rounded(diameter + 2 * limit) if diameter is not None and limit is not None else None
            elif role == 'armour':
                if layer.get('form') == 'tape' and layer.get('tape_count') == 2 and layer.get('nominal_tape_thickness') is not None:
                    diameter, why = None, '双带铠装的附加包带垫层分支未覆盖，不能省略其直径增量。'
                    row('armour-padding', '双带铠装附加包带垫层', lp + '.thickness', '13.7 / 附录 A.2.9' if family == 'mv2' else '13.7 / 附录 A.2.8', 13 if family == 'mv2' else 11, uncovered=True, reason=why)
                elif layer.get('form') == 'wires' and layer.get('wire_diameter') is not None and layer.get('reverse_binder_thickness') is not None:
                    tw = layer['reverse_binder_thickness'] * 1000
                    diameter = rounded(diameter + 2 * rounded(layer['wire_diameter'] * 1000) + (2 * rounded(tw) if tw > .3 else 0)) if diameter is not None else None
                else:
                    diameter, why = None, '铠装需明确双带及单带标称厚度，或金属丝径及反向扎带厚度。'
            elif role == 'binder' and layer['thickness'] <= .0003:
                pass
            else:
                diameter, why = None, '附加包带垫层、填充或未知公共层的假定直径分支未覆盖。'
            trace.append({'stage': role, 'clause': '附录 A；B.1', 'D_mm': diameter, 'missing': why})
        if not bedding_seen:
            row('bedding-nominal', '内衬层标称厚度 / 省略条件', root + '.common_layers', '8.2 / 13.3.1' if family != 'mv1' else '7.2 / 7.3 / 7.4', 8 if family == 'mv2' else 7 if family == 'mv3' else 8, uncovered=True, reason='未提供内衬层，需核验省略条件及铠装下衬层构造。')
            if len(cable['cores']) == 3:
                diameter, why = None, '三芯省略内衬层及相应假定厚度分支未覆盖。'
        limit = max(1.4 if len(cable['cores']) == 1 else 1.8, rounded(.035 * diameter + 1)) if diameter is not None else None
        row('oversheath-nominal', '外护套标称厚度', op + '.thickness', '14.3，式 (3)；附录 A / B.1' if family != 'mv1' else '13.3，式 (3)；附录 A / B.1', 14 if family == 'mv2' else 11 if family == 'mv3' else 13, limit, os.get('thickness') * 1000 if os.get('thickness') is not None else None, formula='t_os = max(minimum, round_0.1(0.035 D_os + 1))', inputs={'D_os_mm': diameter}, reason=why, uncovered=bool(why and '未覆盖' in why))
        specified_oversheath = max(limit or 0, os['thickness'] * 1000) if os.get('thickness') is not None else None
        row('oversheath-minimum', '外护套最薄点', op + '.minimum_thickness', '17.5.3，式 (6)；附录 B 表 B.1' if family != 'mv1' else '16.5.3，式 (5)；附录 B 表 B.1', 18 if family == 'mv2' else 15 if family == 'mv3' else 16, .8 * specified_oversheath - .2 if specified_oversheath is not None else None, os.get('minimum_thickness') * 1000 if os.get('minimum_thickness') is not None else None, basis='measurement', precision=2, formula='t_min ≥ 0.8 t_n − 0.2', inputs={'t_n_declared_mm': os['thickness'] * 1000 if os.get('thickness') is not None else None, 't_n_standard_min_mm': limit, 't_n_mm': specified_oversheath}, reason='t_n 为规定标称厚度；已知的标准标称要求不因较薄设计而降低。')
    counts = dict(Counter(r['verdict'] for r in rows))
    return {'schema': 'cablesim.standard-check/1', 'cable_type_id': cable['id'], 'label': cable['label'], 'method_version': VERSION, 'input_sha256': sha256(json.dumps(document, ensure_ascii=False, sort_keys=True, allow_nan=False).encode()).hexdigest(),
            'sources': [SOURCES[k] for k in (family, 'conductor')], 'rows': rows, 'fictitious_diameter_trace': trace, 'counts': counts, 'conclusion': 'not_satisfied' if counts.get('failed') else 'incomplete' if counts.get('missing') or counts.get('uncovered') else 'satisfied',
            'scope': '仅核对列出的尺寸与电阻要求；设计输入、厂家上限与实測值分别标记。不是完整产品认证，不批准要求或型号。'}


def main():
    request = json.loads(Path('input/request.json').read_text('utf-8'))
    if request.get('protocol') != 'cablesim.run/2' or request.get('capability') != 'dimensions' or request.get('phase') not in ('check', 'run'):
        raise ValueError('不支持的执行协议。')
    cases = []
    for case in request['cases']:
        base = {'case_id': case['case_id']}
        try:
            cable, *_ = prepare(case['input'], case.get('parameters', {}))
            result = {}
            if request['phase'] == 'run':
                artifact = check(case['input'], case.get('parameters', {}))
                name = case['case_id'] + '.requirements.json'
                Path('output', name).write_text(json.dumps(artifact, ensure_ascii=False, allow_nan=False), 'utf-8')
                result = {'results': [{'key': 'x-cablesim.standard-failed-count', 'type': 'quantity', 'entity': cable['id'], 'status': 'available', 'value': artifact['counts'].get('failed', 0), 'unit': '1'}], 'artifacts': [{'type': 'x-cablesim.standard-check', 'path': 'output/' + name}]}
            cases.append({**base, 'status': 'succeeded', **result})
        except (KeyError, ValueError, TypeError) as exc:
            cases.append({**base, 'status': 'not_applicable', 'error': {'code': 'STANDARD_INPUT_INVALID', 'message': str(exc)}})
    Path('output/result.json').write_text(json.dumps({'protocol': 'cablesim.run/2', 'cases': cases, 'environment': {'python': platform.python_version(), 'method': VERSION}}, ensure_ascii=False, allow_nan=False), 'utf-8')


if __name__ == '__main__':
    main()
