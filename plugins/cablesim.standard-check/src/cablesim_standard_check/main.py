"""Product dimensional requirements. SI inputs; normative arithmetic stays in this plugin."""
from collections import Counter
from decimal import Decimal, ROUND_HALF_UP
from hashlib import sha256
import json
import math
from pathlib import Path
import platform

VERSION = 'GB-DIMENSIONS-0.2.0'
SOURCES = json.loads(Path(__file__).with_name('sources.json').read_text('utf-8'))
DATA = json.loads(Path(__file__).with_name('dimensions.json').read_text('utf-8'))
AREAS = DATA['areas_mm2']
DL = dict(zip(AREAS[4:], DATA['fictitious_diameters_mm'][4:]))
DL.update(zip(AREAS[:4], DATA['fictitious_diameters_mm'][:4]))
LV_XLPE = dict(zip(AREAS[:21], DATA['lv_xlpe_mm']))
R20_AREAS = DATA['r20_areas_mm2']
CU2 = dict(zip(R20_AREAS, DATA['r20_ohm_km']['copper_bare']))
CU_COATED2 = dict(zip(R20_AREAS, DATA['r20_ohm_km']['copper_coated']))
AL2 = dict(zip(AREAS[4:] + R20_AREAS[-3:], DATA['r20_ohm_km']['aluminium']))
R20_VERIFIED = {'copper_bare': CU2, 'copper_coated': CU_COATED2, 'aluminium': AL2}
HV_AREAS = DATA['hv_areas_mm2']
HV_INS = dict(zip(HV_AREAS, DATA['hv_mm']['insulation']))
HV_PB = dict(zip(HV_AREAS, DATA['hv_mm']['lead']))
HV_AL = dict(zip(HV_AREAS, DATA['hv_mm']['corrugated_aluminium']))
HV_OS = dict(zip(HV_AREAS, DATA['hv_mm']['oversheath']))
SCREEN_INCREMENT = [tuple(pair) for pair in DATA['screen_increment']]
INSULATION_TABLES = {'DL': DL, 'LV_XLPE': LV_XLPE, 'HV_INS': HV_INS}
VOLTAGE_FAMILIES = {(u0, u): family for u0, u, family in DATA['voltage_families']}


def rounded(value, places=1):
    return float(Decimal(str(value)).quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP))


def number(value, path, maximum, *, integer=False, zero=False):
    """Method bounds; common schema, finite-value and reference checks are host-owned."""
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not 0 <= value <= maximum
        or (value == 0 and not zero)
        or (integer and int(value) != value)
    ):
        raise ValueError(path + '：请输入范围内的' + ('非负' if zero else '正') + ('整数' if integer else '数值') + '，并核对 SI 单位。')
    return value


def prepare(document, parameters):
    """Check the supported product-standard subset of a host-validated snapshot."""
    if set(parameters) - {'cable_type_id'}:
        raise ValueError('parameters：此方法只接受 cable_type_id，不接受替代标准限值。')
    cable = next((t for t in document.get('cable_types', []) if t['id'] == parameters.get('cable_type_id')), None)
    if cable is None:
        raise ValueError('parameters.cable_type_id：请选择当前文档中的型号。')
    index = document['cable_types'].index(cable)
    root = f'cable_types.{index}'
    u0 = number(cable['rating'].get('u0'), root + '.rating.u0', 1e6)
    u = number(cable['rating'].get('u'), root + '.rating.u', 1e6)
    family = VOLTAGE_FAMILIES.get((u0, u))
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
            for key in (
                'thickness', 'minimum_thickness', 'maximum_thickness', 'mean_thickness',
                'nominal_tape_thickness', 'minimum_tape_thickness', 'wire_diameter',
                'tape_width', 'screen_inner_diameter', 'reverse_binder_width', 'mean_wire_diameter',
            ):
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
            for key in ('tape_gap','padding_thickness'):
                if l.get(key) is not None:
                    number(l[key],p+'.'+key,.2,zero=True)
            if l.get('minimum_thickness') is not None and l.get('maximum_thickness') is not None and l['minimum_thickness'] > l['maximum_thickness']:
                raise ValueError(p + '.minimum_thickness：最薄点不得大于最大实测厚度。')
    return cable, root, family, materials


def insulation_limit(family, u0, area, kind):
    if kind != 'XLPE':
        return None
    rule = next(
        (r for r in DATA['insulation']
         if r['family'] == family and r.get('u0', u0) == u0),
        None,
    )
    if rule is None:
        return None
    table = INSULATION_TABLES[rule['table']]
    if area not in table or area < rule.get('min_area_mm2', 0):
        return None
    if 'value_mm' in rule:
        return rule['value_mm']
    if 'bands' in rule:
        return next(value for upper, value in rule['bands'] if upper is None or area <= upper)
    return max(rule.get('minimum_mm', 0), table[area])


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
        if binder > DATA['fictitious']['reverse_binder_increment_minimum_mm']:
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
        if total < DATA['fictitious']['screen_tape_ignore_maximum_mm']:
            return 0, None
    maximum = SCREEN_INCREMENT[-1][0]
    return next((d for s, d in SCREEN_INCREMENT if area <= s), None), '屏蔽截面超过已核验附录 A 表 A.2 范围。' if area > maximum else None


def band(value, values):
    if value is None:
        return None
    return next(result for upper, result in values if upper is None or value <= upper)


def compared(actual, limit, comparison, precision):
    value = rounded(actual, precision) if actual is not None and precision is not None else actual
    threshold = rounded(limit, precision) if limit is not None and precision is not None else limit
    if value is None or threshold is None:
        return value, threshold, 'missing', None
    satisfied = value >= threshold if comparison == '>=' else value == threshold if comparison == '=' else value <= threshold
    margin = value - threshold if comparison == '>=' else threshold - value
    return value, threshold, 'passed' if satisfied else 'failed', margin


class _Check:
    def __init__(self, document, parameters):
        self.cable, self.root, self.family, self.materials = prepare(document, parameters)
        self.document = document
        self.rows, self.trace, self.not_applicable = [], [], []
        self.observations = document.get('measurements', [])

    def rule(self, key):
        return DATA['rules'][key][self.family]

    def limit(self, key):
        rule = self.rule(key)
        return rule['limits_by_cores'][str(len(self.cable['cores']))] if 'limits_by_cores' in rule else rule.get('limit')

    def minimum(self, key, value):
        rule = self.rule(key)
        return rule['factor'] * value + rule['offset'] if value is not None else None

    def linear(self, key, value, minimum=None):
        if value is None:
            return None
        rule = self.rule(key)
        return max(rule['minimum'] if minimum is None else minimum, rounded(rule['factor'] * value + rule['offset']))

    def observed(self, core, role, quantity):
        observations, cable = self.observations, self.cable
        matches = [
            o for o in observations
            if o.get('cable_type') == cable['id'] and o.get('core') == core
            and o.get('role') == role and o.get('quantity') == quantity
        ]
        if len(matches) > 1:
            raise ValueError('measurements：同一对象和量重复，请编辑已有记录。')
        return matches[0] if matches else None

    def path_context(self, path):
        document, cable = self.document, self.cable
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
        target = {
            'scope': 'core' if 'cores' in parts else 'common',
            'core_id': cable['cores'][int(parts[parts.index('cores') + 1])]['id'] if 'cores' in parts else None,
            'role': 'conductor' if 'conductor' in parts else None,
        }
        if 'layers' in parts or 'common_layers' in parts:
            marker = 'layers' if 'layers' in parts else 'common_layers'
            at = parts.index(marker)
            if at + 1 < len(parts) and parts[at + 1].isdigit():
                target['role'] = (
                    cable['cores'][int(parts[parts.index('cores') + 1])]['layers']
                    if marker == 'layers' else cable['common_layers']
                )[int(parts[at + 1])]['role']
        return provenance, target

    def row(self, key, title, path, limit=None, actual=None, unit='mm', comparison='>=',
            *, inputs=None, reason=None, uncovered=False, basis='design',
            source=None, target_override=None, rule_key=None):
        source_record = SOURCES[source or self.family]
        rule = self.rule(rule_key or key)
        page = rule['printed_page']
        if 'page_bands_mm2' in rule:
            core_index = int(path.split('.')[3])
            area = rounded(self.cable['cores'][core_index]['conductor']['nominal_area'] * 1e6, 6)
            page = band(area, rule['page_bands_mm2'])
        if limit is None:
            limit = rule.get('limit')
        provenance, target = self.path_context(path)
        if target_override is not None:
            target = target_override
        quantity = 'screen_area' if key == 'screen-area' else None if key == 'insulation-uniformity' else path.rsplit('.', 1)[-1]
        observation = self.observed(target.get('core_id'), target.get('role'), quantity)
        design_actual = actual
        if observation:
            expected_unit = 'ohm/m' if quantity == 'r20' else 'm2' if quantity == 'screen_area' else 'm'
            actual = observation['value'] * (1e6 if expected_unit == 'm2' else 1000)
            basis, provenance = observation['basis'], observation['source']
            if limit is not None and key == 'r20':
                reason = '出厂数据与标准上限比较；来源记录不代表已人工批准。'
        value, threshold, verdict, margin = compared(actual, limit, comparison, rule.get('precision'))
        if uncovered:
            verdict = 'uncovered'
        rows = self.rows
        rows.append({
            'id': path + ':' + key,
            'title': title,
            'path': path,
            'layer_path': path.rsplit('.', 1)[0],
            'target': target,
            'standard': source_record['standard'],
            'clause': rule['clause'],
            'printed_page': page,
            'pdf_page': page + source_record['page_offset'] if page is not None else None,
            'source_digest': source_record.get('sha256'),
            'source_status': source_record['status'],
            'limit': threshold,
            'actual': value,
            'actual_unrounded': actual,
            'margin': margin,
            'unit': unit,
            'comparison': comparison,
            'verdict': verdict,
            'reason': reason,
            'formula': rule.get('formula'),
            'formula_inputs': inputs or {},
            'basis': basis,
            'input_source': provenance,
            'design_actual': design_actual if observation else None,
            'measurement_id': observation['id'] if observation else None,
        })
        return rows[-1]

    def layer_pairs(self, core, index):
        cable, root = self.cable, self.root
        return (
            [(l, root + f'.cores.{index}.layers.{j}') for j, l in enumerate(core['layers'])]
            + (
                [(l, root + f'.common_layers.{j}') for j, l in enumerate(cable['common_layers'])]
                if len(cable['cores']) == 1 else []
            )
        )
    def find_layer(self, pairs, role):
        root = self.root
        return next(((l, p) for l, p in pairs if l['role'] == role), ({}, root + '.common_layers'))
    def conductor(self, core, i):
        root, materials = self.root, self.materials
        row = self.row
        cond, cp = core['conductor'], root + f'.cores.{i}.conductor'
        area = rounded(cond['nominal_area'] * 1e6, 6)
        conductor_kind = materials[cond['material']].get('standard_kind')
        rlimit = R20_VERIFIED.get(conductor_kind, {}).get(area) if cond.get('conductor_class') == 2 else None
        rbasis = cond.get('r20_basis')
        row(
            'r20',
            f'芯 {i+1} · 导体 R₂₀',
            cp + '.r20',
            rlimit,
            cond.get('r20') * 1000 if cond.get('r20') is not None and rbasis else None,
            'Ω/km',
            '<=',
            source='conductor',
            basis=rbasis or 'unknown',
            reason=(
                '需明确第 2 类、裸铜/镀层铜/铝及 R₂₀ 数据性质；表内上限不作为实测值。'
                if rlimit is None
                or rbasis is None
                else '制造商上限仅核对声明值，不代表试验合格。'
                if rbasis == 'manufacturer_limit'
                else None
            ),
            uncovered=(
                cond.get('conductor_class') is not None
                and cond['conductor_class'] != 2
                or (cond.get('conductor_class') == 2 and conductor_kind is not None and area not in R20_VERIFIED.get(conductor_kind, {}))
            ),
        )
        return area

    def insulation(self, core, i, pairs, area):
        cable, family, materials = self.cable, self.family, self.materials
        row = self.row
        observed = self.observed
        find_layer = self.find_layer
        ins, ip = find_layer(pairs, 'insulation')
        insulation_kind = materials.get(ins.get('material'), {}).get('standard_kind')
        tn = insulation_limit(family, cable['rating']['u0'], area, insulation_kind)
        declared_insulation = ins['thickness'] * 1000 if ins.get('thickness') is not None else None
        specified_insulation = max(tn, declared_insulation) if tn is not None and declared_insulation is not None else None
        row(
            'insulation-nominal',
            f'芯 {i+1} · 绝缘标称厚度',
            ip + '.thickness',
            tn,
            ins.get('thickness', 0) * 1000 if ins else None,
            reason='需明确绝缘材料为 XLPE 和表内标称截面；其他材料或表外截面未覆盖。' if tn is None else None,
            uncovered=insulation_kind is not None and tn is None,
        )
        if family == 'hv':
            row(
                'insulation-minimum',
                f'芯 {i+1} · 绝缘最薄点',
                ip + '.minimum_thickness',
                actual=ins.get('minimum_thickness') * 1000 if ins.get('minimum_thickness') is not None else None,
                reason='缺少 GB/T 11017.1—2024 原文，未实现其限值。',
                uncovered=True,
                basis='measurement',
            )
        elif family == 'mv1':
            row(
                'insulation-minimum',
                f'芯 {i+1} · 绝缘最薄点',
                ip + '.minimum_thickness',
                self.minimum('insulation-minimum', specified_insulation),
                ins.get('minimum_thickness') * 1000 if ins.get('minimum_thickness') is not None else None,
                basis='measurement',
                inputs={'t_n_declared_mm': declared_insulation, 't_n_standard_min_mm': tn, 't_n_mm': specified_insulation},
            )
            row(
                'insulation-mean',
                f'芯 {i+1} · 绝缘平均厚度',
                ip + '.mean_thickness',
                specified_insulation,
                ins.get('mean_thickness') * 1000 if ins.get('mean_thickness') is not None else None,
                basis='measurement',
            )
        else:
            row(
                'insulation-minimum',
                f'芯 {i+1} · 绝缘最薄点',
                ip + '.minimum_thickness',
                self.minimum('insulation-minimum', specified_insulation),
                ins.get('minimum_thickness') * 1000 if ins.get('minimum_thickness') is not None else None,
                inputs={'t_n_declared_mm': declared_insulation, 't_n_standard_min_mm': tn, 't_n_mm': specified_insulation},
                basis='measurement',
                reason='t_n 为该层规定标称厚度；不低于标准标称要求，采用更厚的设计时随之提高。最薄点必须录入实测值。',
            )
            tmin, tmax = ins.get('minimum_thickness'), ins.get('maximum_thickness')
            minimum = observed(core['id'] if len(cable['cores']) > 1 else None if '.common_layers.' in ip else core['id'], 'insulation', 'minimum_thickness')
            maximum = observed(core['id'] if len(cable['cores']) > 1 else None if '.common_layers.' in ip else core['id'], 'insulation', 'maximum_thickness')
            if minimum or maximum:
                same_sample = minimum and maximum and minimum['source']['reference'] == maximum['source']['reference']
                tmin, tmax = (minimum['value'], maximum['value']) if same_sample else (None, None)
                if tmin is not None and tmin > tmax:
                    raise ValueError('measurements.minimum_thickness：同一试样的最薄点大于最大实测厚度。')
            row(
                'insulation-uniformity',
                f'芯 {i+1} · 绝缘厚度偏差',
                ip + '.maximum_thickness',
                None,
                (tmax - tmin) / tmax if tmax is not None and tmin is not None else None,
                '1',
                '<=',
                basis='measurement',
                reason='需录入同一试样的最薄点和最大实测厚度。',
            )
        return ins, tn

    def screen(self, core, i, pairs, area):
        cable, root, family = self.cable, self.root, self.family
        row = self.row
        find_layer = self.find_layer
        screen, sp = find_layer(pairs, 'metallic_screen')
        if screen:
            sarea, missing = screen_area(screen)
            if screen.get('form') == 'tape':
                self.tape_screen(screen, sp, i, area)
            if screen.get('form') == 'wires':
                self.wire_screen(screen, sp, i)
            row(
                'screen-area',
                f'芯 {i+1} · 屏蔽标称截面',
                sp + '.wire_count' if screen.get('form') == 'wires' else sp + '.tape_width',
                actual=sarea,
                unit='mm²',
                uncovered=True,
                reason=(missing + ' ' if missing else '') + '截面最低要求取决于故障电流及短路容量，尚未绑定该要求；几何截面不代表短路合格。',
            )
        elif family != 'mv1':
            screen_path = root + f'.cores.{i}.layers' if len(cable['cores']) > 1 else root + '.common_layers'
            target = {
                'scope': 'core' if len(cable['cores']) > 1 else 'common',
                'core_id': core['id'] if len(cable['cores']) > 1 else None,
                'role': 'metallic_sheath' if family == 'hv' else 'metallic_screen',
            }
            row(
                'screen-area',
                f'芯 {i+1} · 金属屏蔽 / 护套截面',
                screen_path,
                uncovered=True,
                reason='未提供独立金属屏蔽构造；金属护套兼作屏蔽仍需短路容量要求。',
                target_override=target,
                rule_key='screen-area-missing',
            )
            if family != 'hv':
                row('screen-dimensions', f'芯 {i+1} · 屏蔽构造与尺寸', screen_path, reason='请定义金属屏蔽层及铜带 / 铜丝构造，生成对应的带厚、丝径与间隙要求；缺层不代表免除要求。', target_override=target)
        return screen

    def tape_screen(self, screen, sp, i, area):
        family, materials = self.family, self.materials
        row = self.row
        copper = materials[screen['material']].get('standard_kind') in ('copper_bare', 'copper_coated')
        if family != 'hv':
            tt = screen.get('nominal_tape_thickness')
            row(
                'screen-tape-nominal',
                f'芯 {i+1} · 屏蔽铜带标称厚度',
                sp + '.nominal_tape_thickness',
                self.limit('screen-tape-nominal'),
                tt * 1000 if tt is not None and copper else None,
                reason='需明确铜材及单带标称厚度；径向层厚不作为单带厚度。',
            )
            row(
                'screen-tape-minimum',
                f'芯 {i+1} · 屏蔽铜带最薄点',
                sp + '.minimum_tape_thickness',
                self.minimum('screen-tape-minimum', max(self.limit('screen-tape-nominal'), tt * 1000)) if tt is not None else None,
                screen.get('minimum_tape_thickness') * 1000 if screen.get('minimum_tape_thickness') is not None and copper else None,
                basis='measurement',
            )
            row('screen-overlap', f'芯 {i+1} · 屏蔽铜带标称搭盖率', sp + '.overlap', None, screen.get('overlap') if copper else None, '1', '=')
            row(
                'screen-overlap-minimum',
                f'芯 {i+1} · 屏蔽铜带最小搭盖率',
                sp + '.minimum_overlap',
                None,
                screen.get('minimum_overlap') if copper else None,
                '1',
                basis='measurement',
            )
            if family == 'mv3' and area >= self.rule('screen-wire-required')['area_minimum_mm2']:
                row('screen-wire-required', f'芯 {i+1} · 大截面铜丝屏蔽', sp + '.form', None, 0, '1', reason='导体截面不小于 500 mm² 应采用铜丝屏蔽。')

    def wire_screen(self, screen, sp, i):
        family, materials = self.family, self.materials
        row = self.row
        if family == 'hv':
            copper = materials[screen['material']].get('standard_kind') in ('copper_bare', 'copper_coated')
            row(
                'screen-wire-diameter',
                '屏蔽铜丝标称直径',
                sp + '.wire_diameter',
                None,
                screen.get('wire_diameter') * 1000 if screen.get('wire_diameter') is not None and copper else None,
                reason='需明确屏蔽材质为铜。' if not copper else None,
            )
            n, d, diameter = screen.get('wire_count'), screen.get('wire_diameter'), screen.get('screen_inner_diameter')
            gap = (math.pi * (diameter + d) - n * d) / n * 1000 if n and d and diameter and copper else None
            if gap is not None and gap < 0:
                raise ValueError(sp + '.wire_count：丝数、丝径和屏蔽下直径造成铜丝重叠，请修正构造。')
            row(
                'screen-wire-gap',
                '屏蔽铜丝平均间隙',
                sp + '.screen_inner_diameter',
                None,
                gap,
                comparison='<=',
                inputs={'D_mm': diameter * 1000 if diameter else None, 'd_mm': d * 1000 if d else None, 'n': n},
                reason='D 为铜丝屏蔽下实测/设计直径，需明确输入。',
            )
        else:
            row(
                'screen-wire-gap',
                f'芯 {i+1} · 屏蔽铜丝平均间隙',
                sp + '.screen_inner_diameter',
                reason='条文引用 GB/T 11017.2—2014 的定义与算法；该版原文缺失，未用 2024 版替代。',
                uncovered=True,
            )

    def diameter(self, core, i, pairs, area, ins, tn, screen):
        cable, family = self.cable, self.family
        find_layer = self.find_layer
        trace = self.trace
        if family in ('mv1', 'mv2', 'mv3') and tn is not None and area in DL:
            actual_tn = ins.get('thickness')
            conductor_screen, _ = find_layer(pairs, 'conductor_screen')
            insulation_screen, _ = find_layer(pairs, 'insulation_screen')
            if actual_tn is None or (family != 'mv1' and (not conductor_screen or not insulation_screen)):
                diameter = ((None, '需提供绝缘与两层半导电屏蔽的完整结构。'))
            else:
                semi_increment = DATA['fictitious']['semiconductor_increment_mm'][family]
                dc = rounded(DL[area] + 2 * rounded(actual_tn * 1000) + semi_increment)
                increment, why = screen_increment(screen) if screen else (0, None)
                if (
                    len(cable['cores']) == 3
                    and any(
                        l['role'] not in ('conductor_screen', 'insulation', 'insulation_screen', 'metallic_screen')
                        and not (
                            l['role'] == 'binder'
                            and l['thickness'] <= DATA['fictitious']['ignored_binder_maximum_m']
                        )
                        for l, _ in pairs
                    )
                ):
                    increment, why = None, '线芯附加护层的假定直径分支未覆盖。'
                diameter = ((rounded(dc + increment) if increment is not None else None, why))
                trace.append({
                    'stage': f'芯 {i+1} 假定直径',
                    'clause': DATA['fictitious']['core_clause'],
                    'd_L_mm': DL[area],
                    't_in_mm': rounded(actual_tn * 1000),
                    'semiconductive_increment_mm': semi_increment,
                    'screen_increment_mm': increment,
                    'D_c_mm': diameter[0],
                })
        else:
            diameter = ((None, '此结构的附录 A 假定直径链未覆盖。'))
        return diameter

    def core(self, core, i):
        area = self.conductor(core, i)
        pairs = self.layer_pairs(core, i)
        insulation, nominal = self.insulation(core, i, pairs, area)
        screen = self.screen(core, i, pairs, area)
        return self.diameter(core, i, pairs, area, insulation, nominal, screen)

    def hv_common(self, area):
        cable, root, materials = self.cable, self.root, self.materials
        row = self.row
        layer_pairs = self.layer_pairs
        find_layer = self.find_layer
        single_layers = layer_pairs(cable['cores'][0], 0)
        sheath, shp = find_layer(single_layers, 'metallic_sheath')
        kind = materials.get(sheath.get('material'), {}).get('standard_kind')
        limit = None
        if kind == 'lead':
            limit = HV_PB.get(area)
        elif kind == 'aluminium' and sheath.get('form') == 'corrugated':
            limit = HV_AL.get(area)
        elif kind == 'aluminium' and sheath.get('form') == 'smooth' and area in HV_AREAS:
            limit = self.rule('sheath-nominal')['smooth_aluminium_mm']
        row(
            'sheath-nominal',
            '金属护套标称厚度',
            shp + '.thickness',
            limit,
            sheath.get('thickness') * 1000 if sheath.get('thickness') is not None else None,
            reason='需明确铅 / 光滑铝 / 波纹铝；铜护套需供需协议，本实现未覆盖。',
            uncovered=kind is not None and limit is None,
        )
        row(
            'sheath-minimum',
            '金属护套最薄点',
            shp + '.minimum_thickness',
            actual=sheath.get('minimum_thickness') * 1000 if sheath.get('minimum_thickness') is not None else None,
            uncovered=True,
            basis='measurement',
            reason='缺少 GB/T 11017.1—2024 原文。',
        )
        for role, title in [('conductor_screen', '导体半导电屏蔽最薄点'), ('insulation_screen', '绝缘半导电屏蔽最薄点')]:
            layer, lp = find_layer(single_layers, role)
            row(
                role + '-minimum',
                title,
                lp + '.minimum_thickness',
                None,
                layer.get('minimum_thickness') * 1000 if layer.get('minimum_thickness') is not None else None,
                basis='measurement',
                reason='约 1.5 / 1.0 mm 为近似厚度说明，不作为标称厚度硬性下限。',
                target_override=None if layer else {'scope': 'common', 'core_id': None, 'role': role},
            )
        os, op = find_layer(single_layers, 'oversheath')
        row('oversheath-nominal', '外护套标称厚度', op + '.thickness', HV_OS.get(area), os.get('thickness') * 1000 if os.get('thickness') is not None else None)
        row(
            'oversheath-minimum',
            '外护套最薄点',
            op + '.minimum_thickness',
            actual=os.get('minimum_thickness') * 1000 if os.get('minimum_thickness') is not None else None,
            uncovered=True,
            basis='measurement',
            reason='缺少 GB/T 11017.1—2024 原文。',
        )
        row('bedding-nominal', '内衬层 / 半导电缓冲层', root + '.common_layers', uncovered=True, reason='缓冲 / 阻水构造与产品协议尚未覆盖，未套用中压内衬层公式。')

    def bedding(self, layer, lp, diameter, why):
        family = self.family
        row = self.row
        limit = band(diameter, DATA['fictitious']['bedding_bands_mm'])
        if family == 'mv3' and limit is not None:
            limit = max(DATA['fictitious']['mv3_bedding_minimum_mm'], limit)
        wrapped = layer.get('form') == 'tape'
        if layer.get('form') not in ('smooth', 'tape'):
            diameter, why, limit = None, '需明确内衬层为挤包或绕包。', None
        if wrapped:
            limit = band(diameter, DATA['fictitious']['wrapped_bedding_bands_mm'])
        self.bedding_basis = {'layer':layer,'path':lp,'diameter':diameter,'nominal':limit,'wrapped':wrapped}
        uncovered = family == 'mv1' or (family == 'mv3' and wrapped)
        row(
            'bedding-nominal',
            '内衬层标称厚度',
            lp + '.thickness',
            limit,
            layer['thickness'] * 1000,
            uncovered=uncovered,
            inputs={'D_f_mm': diameter},
            reason='第 1 部分成缆与省略内衬层分支未覆盖。' if family == 'mv1' else '第 3 部分只核验挤包内衬层。' if uncovered else why,
            rule_key='bedding-wrapped' if wrapped else None,
        )
        paired_tape = wrapped and family in DATA['armour'] and any(
            candidate['role']=='armour' and candidate.get('form')=='tape' for candidate in self.cable['common_layers'])
        if wrapped and family in DATA['armour'] and len(self.cable['cores'])>1 and all(
            core['conductor']['form']!='sectoral' for core in self.cable['cores']):
            row('bedding-filled','绕包内衬层下线芯间隙填充',lp+'.form',actual=int(any(
                candidate['role']=='filler' for candidate in self.cable['common_layers'])),unit='1',
                reason='圆形线芯采用绕包内衬层时，须先填充线芯间隙。')
        if family != 'mv1' and not uncovered and not paired_tape:
            specified_bedding = max(limit or 0, layer['thickness'] * 1000)
            row(
                'bedding-minimum',
                '内衬层最薄点',
                lp + '.minimum_thickness',
                self.minimum('bedding-minimum', specified_bedding) if not wrapped else None,
                layer.get('minimum_thickness') * 1000 if layer.get('minimum_thickness') is not None else None,
                basis='measurement',
                inputs={'t_n_declared_mm': layer['thickness'] * 1000, 't_n_standard_min_mm': limit, 't_n_mm': specified_bedding},
                uncovered=wrapped,
                reason='绕包内衬层的制造检验分支未覆盖。' if wrapped else 't_n 为规定标称厚度；已知的标准标称要求不因较薄设计而降低。',
                rule_key='bedding-wrapped-minimum' if wrapped else None,
            )
        increment_t = band(diameter, DATA['fictitious']['wrapped_bedding_bands_mm']) if family in ('mv1', 'mv2') and diameter is not None else limit
        diameter = rounded(diameter + 2 * increment_t) if diameter is not None and increment_t is not None else None
        return diameter, why

    def lead(self, layer, lp, diameter, why):
        family, materials = self.family, self.materials
        row = self.row
        first_row = len(self.rows)
        is_lead = materials[layer['material']].get('standard_kind') == 'lead'
        limit = self.linear('sheath-nominal', diameter) if is_lead else None
        row(
            'sheath-nominal',
            '铅套标称厚度',
            lp + '.thickness',
            limit,
            layer['thickness'] * 1000,
            inputs={'D_g_mm': diameter},
            uncovered=not is_lead or family == 'mv1',
            reason='仅核验铅套分支；其他金属护套未覆盖。' if not is_lead else why,
        )
        if family != 'mv1':
            specified_lead = max(limit or 0, layer['thickness'] * 1000)
            row(
                'sheath-minimum',
                '铅套最薄点',
                lp + '.minimum_thickness',
                self.minimum('sheath-minimum', specified_lead) if is_lead else None,
                layer.get('minimum_thickness') * 1000 if layer.get('minimum_thickness') is not None else None,
                basis='measurement',
                uncovered=not is_lead,
                inputs={'t_Pb_declared_mm': layer['thickness'] * 1000, 't_Pb_standard_min_mm': limit, 't_Pb_mm': specified_lead},
            )
        if materials[layer['material']].get('standard_kind') == 'aluminium':
            # Material identity proves only that the lead clauses do not apply.
            # It does not prove that the aluminium construction meets its own requirements.
            for excluded in self.rows[first_row:]:
                self.not_applicable.append({**excluded, 'verdict':'not_applicable',
                    'reason':'当前结构明确为铝护套，铅套条款不适用。'})
            del self.rows[first_row:]
            coverage = row('metallic-sheath-coverage', '铝护套尺寸覆盖', lp+'.thickness',
                actual=layer['thickness']*1000, uncovered=True, rule_key='sheath-nominal',
                reason='当前中压铝护套尺寸分支尚未覆盖；不以铅套条款替代。')
            coverage.update(clause='铝护套尺寸分支未覆盖', printed_page=None, pdf_page=None)
        diameter = rounded(diameter + 2 * limit) if diameter is not None and limit is not None else None
        return diameter, why

    def separator(self, common, layer, lp, diameter, why):
        family, materials = self.family, self.materials
        row = self.row
        previous = common[common.index((layer, lp)) - 1][0] if common.index((layer, lp)) else {}
        on_lead = previous.get('role') == 'metallic_sheath' and materials.get(previous.get('material'), {}).get('standard_kind') == 'lead'
        minimum = self.rule('separator-nominal')['minimum_on_lead' if on_lead else 'minimum']
        limit = self.linear('separator-nominal', diameter, minimum)
        row(
            'separator-nominal',
            '隔离套标称厚度',
            lp + '.thickness',
            limit,
            layer['thickness'] * 1000,
            uncovered=family == 'mv1',
            inputs={'D_u_mm': diameter, 'minimum_mm': minimum},
            reason=why,
        )
        diameter = rounded(diameter + 2 * limit) if diameter is not None and limit is not None else None
        return diameter, why

    def armour(self, common, layer, lp, diameter, why):
        data = DATA['armour'].get(self.family)
        form = data['forms'].get(layer.get('form')) if data else None
        if form is None:
            why = '此标准版本或铠装构造的尺寸分支未覆盖；不套用其他版本的数值。'
            self.row('armour-padding','铠装尺寸覆盖',lp+'.form',uncovered=True,reason=why)
            return None,why
        material = self.materials[layer['material']].get('standard_kind')
        substance = data['materials'].get(material)
        self.row('armour-material','铠装材料类别',lp+'.material',unit='1',
            actual=int(layer['form'] in substance['forms']) if substance else None,
            reason=None if substance else '需明确材料标准类别；不按材料名称猜测钢、铝或铜。')
        if len(self.cable['cores'])==1 and any(c.get('system',{}).get('kind','').startswith('ac_')
                for c in self.document.get('circuits',[]) if c.get('cable_type')==self.cable['id']):
            self.row('armour-nonmagnetic','交流单芯铠装非磁性要求',lp+'.material',unit='1',
                actual=int(not substance['magnetic']) if substance else None,
                reason='特殊磁性铠装结构未覆盖；普通交流单芯结构要求非磁性铠装。')
        preceding = common[:common.index((layer,lp))]
        underlayer, up = next(((value,path) for value,path in reversed(preceding)
            if value['role'] in ('bedding','separator')),({},lp))
        self.row('armour-underlayer','铠装下内衬层或挤包隔离套',up+'.form',unit='1',
            actual=int(bool(underlayer) and underlayer.get('form') in ('smooth','tape')),
            reason=None if underlayer else '铠装前须有内衬层；符合13.3.3的挤包隔离套可代替内衬层。')
        declared = layer.get(form['field'])
        declared_mm = declared*1000 if declared is not None else None
        details = {'wires':self.armour_wires,'tape':self.armour_tapes}
        diameter, why = details[layer['form']](layer,lp,diameter,why,form,underlayer,up,declared_mm)
        bands = form.get('bands') or form.get('bands_by_material',{}).get((substance or {}).get('group'))
        limit = band(diameter,bands) if bands else None
        self.row(form['rule'],form['title'],lp+'.'+form['field'],limit,declared_mm,
            inputs={'D_A_mm':diameter,'material_kind':material},reason=why or (None if bands else '缺少已核验的材料尺寸表分支。'))
        nominal = max(limit or 0,declared_mm) if declared_mm is not None else limit
        measured = layer.get(form['measured_field'])
        self.row(form['measured_rule'],form['measured_title'],lp+'.'+form['measured_field'],
            self.minimum(form['measured_rule'],nominal),measured*1000 if measured is not None else None,
            basis='measurement',inputs={'t_nominal_mm':nominal},
            reason='按17.7规定的测量方法取得平均值；不以标称尺寸代替实测。')
        # Appendix A uses the declared armour gauge, independently of its compliance verdict.
        diameter = rounded(diameter+form['diameter_multiplier']*declared_mm) if diameter is not None and declared_mm is not None else None
        if layer['form']=='wires':
            binder = layer.get('reverse_binder_thickness')
            if binder is None:
                return None,'需明确反向扎带厚度；无扎带时填写0，不自动推断。'
            if diameter is not None and binder*1000>DATA['fictitious']['reverse_binder_increment_minimum_mm']:
                diameter=rounded(diameter+2*binder*1000)
        return diameter,why

    def armour_wires(self, layer, lp, diameter, why, form, underlayer, up, declared):
        if declared is not None and declared>=form['coarse_wire_mm']:
            self.row('armour-coarse-bedding','粗圆丝铠装下内衬或隔离套厚度',up+'.thickness',
                actual=underlayer['thickness']*1000 if underlayer else None)
        return diameter,why

    def armour_tapes(self, layer, lp, diameter, why, form, underlayer, up, declared):
        self.row('armour-tape-count','铠装金属带层数',lp+'.tape_count',actual=layer.get('tape_count'),unit='1',comparison='=')
        width,gap = layer.get('tape_width'),layer.get('tape_gap')
        self.row('armour-tape-gap','铠装金属带最大间隙率',lp+'.tape_gap',
            actual=gap/width if width is not None and gap is not None else None,unit='1',comparison='<=',
            inputs={'tape_width_m':width,'maximum_gap_m':gap})
        if layer.get('tape_application')!=form['application']:
            why='需明确双层间隙绕包构造，外带中部覆盖内带间隙。'
            self.rows[-1].update(verdict='missing',reason=why)
        bedding = getattr(self,'bedding_basis',{})
        if bedding.get('wrapped') and underlayer.get('role')=='bedding':
            extra = band(declared,form['padding_bands_mm'])
            nominal = bedding['nominal']+extra if bedding['nominal'] is not None and extra is not None else None
            padding = underlayer.get('padding_thickness')
            self.row('armour-padding','双带铠装附加包带垫层',up+'.padding_thickness',extra,
                padding*1000 if padding is not None else None,
                inputs={'t_AD_mm':declared},reason='附加垫层已计入内衬层总厚度，不另加到实际外径。')
            self.row('armour-padding-total','绕包内衬及垫层总标称厚度',up+'.thickness',nominal,underlayer['thickness']*1000)
            specified = max(nominal or 0,underlayer['thickness']*1000)
            self.row('armour-padding-minimum','绕包内衬及垫层总实测厚度',up+'.minimum_thickness',
                self.minimum('armour-padding-minimum',specified),
                underlayer.get('minimum_thickness')*1000 if underlayer.get('minimum_thickness') is not None else None,
                basis='measurement',inputs={'t_total_mm':specified})
            if padding is None:
                return None,'绕包内衬层的附加垫层输入缺项；不能默认为已提供。'
            increment=band(diameter,form['padding_diameter_bands_mm'])
            diameter=rounded(diameter+increment) if diameter is not None else None
            self.trace.append({'stage':'附加垫层假定直径','clause':'附录 A.2.9，表 A.3；B.1',
                               'D_mm':diameter,'increment_mm':increment})
        return diameter,why

    def covering_layer(self, common, layer, lp, diameter, why):
        role = layer['role']
        handlers = {'bedding':self.bedding,'metallic_sheath':self.lead,
            'separator':lambda *args:self.separator(common,*args),'armour':lambda *args:self.armour(common,*args)}
        if role in handlers:
            return handlers[role](layer,lp,diameter,why)
        if role=='filler' and len(self.cable['cores'])==3:
            return diameter,why  # Appendix A.2.3 bundle factor includes the laid-up core/filling space.
        if role == 'binder' and layer['thickness'] <= DATA['fictitious']['ignored_binder_maximum_m']:
            return diameter, why
        return None, '此附加公共层的假定直径分支未覆盖。'

    def mv_common(self, common, core_diameters):
        cable, root, family, materials = self.cable, self.root, self.family, self.materials
        row = self.row
        find_layer = self.find_layer
        trace = self.trace
        dc_values = [v for v, _ in core_diameters]
        why = next((w for v, w in core_diameters if v is None), None)
        if len(set(v for v in dc_values if v is not None)) > 1:
            why = '异尺寸绝缘线芯成缆的假定直径分支未覆盖。'
        diameter = rounded(dc_values[0] * (DATA['fictitious']['bundle_factors'][str(len(cable['cores']))])) if not why else None
        trace.append({
            'stage': '缆芯假定直径',
            'clause': DATA['fictitious']['cable_clause'],
            'B': DATA['fictitious']['bundle_factors'][str(len(cable['cores']))],
            'D_f_mm': diameter,
            'missing': why,
        })
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
            diameter, why = self.covering_layer(common, layer, lp, diameter, why)
            trace.append({'stage': role, 'clause': DATA['fictitious']['common_clause'], 'D_mm': diameter, 'missing': why})
        if not bedding_seen:
            row('bedding-nominal', '内衬层标称厚度 / 省略条件', root + '.common_layers', uncovered=True, reason='未提供内衬层，需核验省略条件及铠装下衬层构造。', rule_key='bedding-missing')
            if len(cable['cores']) == 3:
                diameter, why = None, '三芯省略内衬层及相应假定厚度分支未覆盖。'
        limit = self.linear('oversheath-nominal', diameter, self.rule('oversheath-nominal')['minimums_by_cores'][str(len(cable['cores']))])
        row(
            'oversheath-nominal',
            '外护套标称厚度',
            op + '.thickness',
            limit,
            os.get('thickness') * 1000 if os.get('thickness') is not None else None,
            inputs={'D_os_mm': diameter},
            reason=why,
            uncovered=bool(why and '未覆盖' in why),
        )
        specified_oversheath = max(limit or 0, os['thickness'] * 1000) if os.get('thickness') is not None else None
        row(
            'oversheath-minimum',
            '外护套最薄点',
            op + '.minimum_thickness',
            self.minimum('oversheath-minimum', specified_oversheath),
            os.get('minimum_thickness') * 1000 if os.get('minimum_thickness') is not None else None,
            basis='measurement',
            inputs={
                't_n_declared_mm': os['thickness'] * 1000 if os.get('thickness') is not None else None,
                't_n_standard_min_mm': limit,
                't_n_mm': specified_oversheath,
            },
            reason='t_n 为规定标称厚度；已知的标准标称要求不因较薄设计而降低。',
        )

    def result(self):
        cable, family, document = self.cable, self.family, self.document
        rows, trace = self.rows, self.trace
        counts = dict(Counter(r['verdict'] for r in rows))
        return {
            'schema': 'cablesim.standard-check/1',
            'cable_type_id': cable['id'],
            'label': cable['label'],
            'method_version': VERSION,
            'input_sha256': sha256(json.dumps(document, ensure_ascii=False, sort_keys=True, allow_nan=False).encode()).hexdigest(),
            'sources': [SOURCES[k] for k in (family, 'conductor')],
            'rows': rows,
            'not_applicable': self.not_applicable,
            'fictitious_diameter_trace': trace,
            'counts': counts,
            'conclusion': (
                'not_satisfied'
                if counts.get('failed')
                else 'incomplete'
                if counts.get('missing')
                or counts.get('uncovered')
                else 'satisfied'
            ),
            'scope': '仅核对列出的尺寸与电阻要求；设计输入、厂家上限与实測值分别标记。不是完整产品认证，不批准要求或型号。',
        }
    

def check(document, parameters):
    report = _Check(document, parameters)
    cable, root = report.cable, report.root
    core_diameters = [report.core(core, i) for i, core in enumerate(cable['cores'])]
    if report.family == 'hv':
        report.hv_common(rounded(cable['cores'][0]['conductor']['nominal_area'] * 1e6, 6))
    else:
        common = [(layer, root + f'.common_layers.{i}') for i, layer in enumerate(cable['common_layers'])]
        report.mv_common(common, core_diameters)
    return report.result()


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
                result = {
                    'results': [{
                        'key': 'x-cablesim.standard-failed-count', 'type': 'quantity', 'entity': cable['id'],
                        'status': 'available', 'value': artifact['counts'].get('failed', 0), 'unit': '1',
                    }],
                    'artifacts': [{'type': 'x-cablesim.standard-check', 'path': 'output/' + name}],
                }
            cases.append({**base, 'status': 'succeeded', **result})
        except (KeyError, ValueError, TypeError) as exc:
            cases.append({**base, 'status': 'not_applicable', 'error': {'code': 'STANDARD_INPUT_INVALID', 'message': str(exc)}})
    Path('output/result.json').write_text(
        json.dumps(
            {'protocol': 'cablesim.run/2', 'cases': cases,
             'environment': {'python': platform.python_version(), 'method': VERSION}},
            ensure_ascii=False, allow_nan=False,
        ),
        'utf-8',
    )


if __name__ == '__main__':
    main()
