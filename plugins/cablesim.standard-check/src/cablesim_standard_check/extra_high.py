"""127/220 kV rows backed only by verified GB/T 18890.2 records.

No 110 kV or GB/T 12706 numerical rule is inherited here. The ordinary pinned
evidence path supplies every limit; requirements not yet compiled stay visible.
"""
import math

from .manufacturing import field, read


def populate(checker):
    cable, root = checker.cable, checker.root
    core = cable['cores'][0]
    conductor = core['conductor']
    path = root + '.cores.0.conductor'
    basis = conductor.get('r20_basis')
    checker.row('r20', '芯 1 · 导体 R₂₀', path + '.r20',
        actual=conductor.get('r20') * 1000 if conductor.get('r20') is not None and basis else None,
        unit='Ω/km', comparison='<=', basis=basis or 'unknown',
        reason='需明确 R₂₀ 数据性质；制造商上限和设计声明均不代表试验合格。')
    checker.row('conductor-wire-count', '芯 1 · 导体最少单线数量', path + '.wire_count',
        actual=conductor.get('wire_count'), unit='1',
        reason='缺字段：导体单线数量；不从标称截面猜测制造结构。')
    insulation, ip = checker.find_layer(checker.layer_pairs(core, 0), 'insulation')
    checker.row('insulation-nominal', '芯 1 · 绝缘标称厚度', ip + '.thickness',
        actual=insulation['thickness'] * 1000 if insulation.get('thickness') is not None else None,
        reason='缺字段：XLPE 绝缘标称厚度；标准值不当作实测值。')
    checker.row('insulation-minimum', '芯 1 · 绝缘最薄点与偏心率', ip + '.minimum_thickness',
        actual=insulation['minimum_thickness'] * 1000 if insulation.get('minimum_thickness') is not None else None,
        basis='measurement', uncovered=True,
        reason='缺少已核验的 GB/T 18890.1—2015 10.6.2 判据；不套用低压、中压或 110 kV 公式。')
    pairs = checker.layer_pairs(core, 0)
    cs, cp = checker.find_layer(pairs, 'conductor_screen')
    checker.row('conductor-screen-minimum', '芯 1 · 挤包导体屏蔽最薄点', cp + '.minimum_thickness',
        basis='measurement', source='ehv-screens',
        reason='需单独录入挤包半导电层的最薄点实测值；不把绕包带或组合层厚度当作挤包层测量。',
        target_override=None if cs else {'scope': 'core', 'core_id': core['id'], 'role': 'conductor_screen'})
    screen, sp = checker.find_layer(pairs, 'insulation_screen')
    checker.row('insulation-screen-minimum', '芯 1 · 挤包绝缘屏蔽最薄点', sp + '.minimum_thickness',
        actual=screen['minimum_thickness'] * 1000 if screen.get('minimum_thickness') is not None else None,
        basis='measurement', source='ehv-screens',
        reason='需录入与绝缘层同时挤出的半导电层最薄点实测值，近似厚度不能代替。')
    metallic, mp = checker.find_layer(pairs, 'metallic_sheath')
    checker.row('sheath-nominal', '金属套标称厚度', mp + '.thickness',
        actual=metallic['thickness'] * 1000 if metallic.get('thickness') is not None else None,
        source='ehv-coverings', reason='需明确铅套或皱纹铝套；其他金属和构造不得借用表4。',
        target_override=None if metallic else {'scope': 'common', 'core_id': None, 'role': 'metallic_sheath'})
    checker.row('sheath-minimum', '金属套最薄点', mp + '.minimum_thickness',
        actual=metallic['minimum_thickness'] * 1000 if metallic.get('minimum_thickness') is not None else None,
        basis='measurement', source='ehv-coverings', uncovered=True,
        reason='缺少GB/T18890.1—2015的10.7.1/10.7.2完整判据；标称厚度不代替最薄点要求。')
    outer, op = checker.find_layer(pairs, 'oversheath')
    for key, title, name in [('oversheath-nominal', '外护套标称总厚度', 'thickness'),
                             ('oversheath-minimum', '外护套最薄点', 'minimum_thickness'),
                             ('oversheath-mean', '外护套平均实测厚度', 'mean_thickness')]:
        row = checker.row(key, title, op + '.' + name,
            actual=outer[name] * 1000 if outer.get(name) is not None else None,
            basis='design' if name == 'thickness' else 'measurement', source='ehv-coverings',
            reason='需明确ST2或ST7混合料及总厚度；复合护套子层不分别套用总厚度判据。',
            target_override=None if outer else {'scope': 'common', 'core_id': None, 'role': 'oversheath'})
        if key == 'oversheath-mean' and metallic.get('form') == 'corrugated':
            checker.rows.pop()
            checker.not_applicable.append({**row, 'verdict': 'not_applicable',
                'reason': 'GB/T18890.2—2015 6.7.2明确：皱纹金属套外护套无平均厚度要求；最薄点要求仍适用。'})
    metal_screen, msp = checker.find_layer(pairs, 'metallic_screen')
    if metal_screen.get('form') == 'wires':
        d, diameter, n = (metal_screen.get(key) for key in ('wire_diameter', 'screen_inner_diameter', 'wire_count'))
        checker.row('screen-wire-diameter', '芯 1 · 铜屏蔽丝直径', msp + '.wire_diameter',
            actual=None if d is None else d * 1000, source='ehv-metal',
            reason='需明确软铜丝材料和丝径；不从层厚反推。')
        checker.row('screen-wire-gap', '芯 1 · 铜屏蔽丝平均间隙', msp + '.wire_count',
            actual=None if any(value is None for value in (d, diameter, n)) else (math.pi * (diameter+d)-n*d)/n*1000,
            comparison='<=', source='ehv-metal',
            inputs={'D_mm': None if diameter is None else diameter * 1000,
                    'd_mm': None if d is None else d * 1000, 'n': n},
            reason='式(1)须有屏蔽下缆芯直径、铜丝直径与根数；不从标称截面推定。')
    for key, title, field, reason in (
        ('ehv-construction', '导体结构与圆整度', path + '.form',
         '表2–4与明确制造数值已编制；6.1.2的结构与圆整度尚未绑定核对。'),
        ('ehv-coverings', '金属套与外护套要求', root + '.common_layers',
         '标称套厚与外护套厚度按已核验记录核对；金属套材料证明、半导电导电层和完整产品试验仍需独立核验。'),
        ('ehv-routine-tests', '例行试验要求', root + '.rating.u',
         '缺少 GB/T 18890.1—2015 第 9 章的完整判据与试验数据。'),
        ('ehv-sample-tests', '抽样试验要求', root + '.rating.u',
         '缺少 GB/T 18890.1—2015 第 10 章的完整判据与试验数据。'),
        ('ehv-type-tests', '电缆系统型式试验要求', root + '.rating.u',
         '缺少 GB/T 18890.1—2015 第 12 章的完整判据与试验数据。'),
        ('ehv-prequalification-tests', '电缆系统预鉴定试验要求', root + '.rating.u',
         '缺少 GB/T 18890.1—2015 第 13 章的完整判据与试验数据。'),
    ):
        source = 'ehv-scope' if key == 'ehv-construction' else 'ehv-coverings' if key == 'ehv-coverings' else 'ehv-tests'
        checker.row(key, title, field, unit='1', uncovered=True, reason=reason, source=source)


def queries(checker):
    """Preserve an exact query per row; never choose a substitute material."""
    cable = checker.cable
    core = cable['cores'][0]
    conductor = core['conductor']
    metal = checker.materials.get(conductor['material'], {}).get('standard_kind')
    insulation = next((layer for layer, _ in checker.layer_pairs(core, 0)
                       if layer['role'] == 'insulation'), {})
    insulation_kind = checker.materials.get(insulation.get('material'), {}).get('standard_kind')
    conditions = {'area_m2': conductor['nominal_area'],
                  'u0_v': cable['rating']['u0'], 'u_v': cable['rating']['u'],
                  'conductor_material': 'copper'}
    pairs = checker.layer_pairs(core, 0)
    metallic, mp = checker.find_layer(pairs, 'metallic_sheath')
    outer, op = checker.find_layer(pairs, 'oversheath')
    metal_screen, _ = checker.find_layer(pairs, 'metallic_screen')
    mapping = {
        'r20': ('表 2', 'resistance_20_max'),
        'conductor-wire-count': ('表 2', 'wire_count_min'),
        'insulation-nominal': ('表 3', 'insulation_nominal'),
        'conductor-screen-minimum': ('6.3.2', 'conductor_screen_min'),
        'insulation-screen-minimum': ('6.3.3', 'insulation_screen_min'),
        'sheath-nominal': ('表 4', 'metal_sheath_nominal'),
        'oversheath-nominal': ('6.7.2', 'oversheath_nominal'),
        'oversheath-minimum': ('6.7.2', 'nonmetal_sheath_min'),
        'oversheath-mean': ('6.7.2', 'oversheath_mean_min'),
        'screen-wire-diameter': ('6.5.2', 'screen_wire_nominal_min'),
        'screen-wire-gap': ('6.5.2', 'screen_wire_gap_max'),
    }
    result = {}
    for row in checker.rows:
        row['basis_missing_fields'] = []
        key = row['id'].rsplit(':', 1)[-1]
        if key not in mapping:
            continue
        if metal is None:
            row['basis_missing_fields'].append({
                'field': '/materials/' + conductor['material'].replace('~', '~0').replace('/', '~1') + '/standard_kind',
                'label': '导体材料标准类别'})
        elif metal != 'copper_bare':
            row['reason'] = 'GB/T 18890.2—2015 6.1.1 为 TR 型圆铜线；本表未放行镀层铜、铝或合金替代。'
            continue
        needs_xlpe = key not in ('r20', 'conductor-wire-count')
        if needs_xlpe and insulation_kind is None:
            row['basis_missing_fields'].append({
                'field': '/materials/' + insulation.get('material', '').replace('~', '~0').replace('/', '~1') + '/standard_kind',
                'label': '绝缘材料标准类别'})
        elif needs_xlpe and insulation_kind != 'XLPE':
            row['reason'] = 'GB/T18890.2—2015仅放行本标准XLPE电缆；其他绝缘材料未覆盖。'
            continue
        selected = {**conditions, **({'insulation': 'XLPE'} if needs_xlpe else {})}
        if key == 'conductor-screen-minimum':
            measurement = field(checker, row, 'extruded_minimum_thickness', '挤包导体屏蔽最薄点实测',
                                unit='m', min=1e-12, max=.05, display_unit='mm', scale=1000)
            value = read(checker, measurement)
            row['engineering_inputs'] = [measurement]
            row['actual'] = row['actual_unrounded'] = None if value is None else value * 1000
            row['input_source'] = checker.document.get('provenance', {}).get(measurement['field'])
            if value is None:
                row['basis_missing_fields'].append(measurement)
            selected['measurement_role'] = 'extruded_conductor_screen'
        elif key == 'insulation-screen-minimum':
            selected['measurement_role'] = 'extruded_insulation_screen'
        elif key == 'sheath-nominal':
            sheath_kind = checker.materials.get(metallic.get('material'), {}).get('standard_kind')
            form = metallic.get('form')
            if not sheath_kind:
                row['basis_missing_fields'].append({'field': mp + '.material', 'label': '金属套材料类别'})
            elif sheath_kind == 'lead' and form == 'smooth':
                selected['sheath_material'] = 'lead'
            elif sheath_kind in ('aluminium', 'aluminium_alloy') and form == 'corrugated':
                selected['sheath_material'] = 'corrugated_aluminium'
            else:
                row['reason'] = '表4只绑定铅套和皱纹铝套；需明确套形，不能套用于平铝套或铜套。'
                continue
        elif key.startswith('oversheath-'):
            compound = field(checker, row, 'sheath_compound', '外护套混合料牌号（ST2或ST7）', kind='text')
            value = read(checker, compound)
            row['engineering_inputs'] = [compound]
            if value is None:
                row['basis_missing_fields'].append(compound)
            elif value not in ('ST2', 'ST7'):
                row['reason'] = '外护套混合料不是明确的ST2或ST7，不能用通用聚合物名称代替。'
                continue
            selected['sheath_compound'] = value
            if key == 'oversheath-mean':
                if metallic.get('form') != 'smooth':
                    row['basis_missing_fields'].append({'field': mp + '.form', 'label': '外护套内金属套构造'})
                selected['metal_sheath_form'] = 'smooth'
                if outer.get('thickness') is None:
                    row['basis_missing_fields'].append({'field': op + '.thickness', 'label': '外护套标称总厚度'})
                selected['nominal_thickness_m'] = outer.get('thickness')
        elif key.startswith('screen-wire-'):
            kind = checker.materials.get(metal_screen.get('material'), {}).get('standard_kind')
            if kind is None:
                row['basis_missing_fields'].append({'field': '/materials/' + metal_screen.get('material', '').replace('/', '~1') + '/standard_kind',
                                                   'label': '铜丝屏蔽材料类别'})
            elif kind != 'copper_bare':
                row['reason'] = '6.5.2只绑定软铜丝；未声明材料或其他金属不得使用本判据。'
                continue
            selected['screen_kind'] = 'copper_wire'
        if row['basis_missing_fields']:
            continue
        result[row['id']] = {
            'schema_version': 'cablesim.standards-query/1',
            'standard': 'GB/T 18890.2', 'edition': '2015',
            'locator': mapping[key][0], 'quantity': mapping[key][1], 'conditions': selected,
        }
    return result
