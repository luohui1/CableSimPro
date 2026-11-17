"""127/220 kV rows backed only by the verified GB/T 18890.2 tables.

No 110 kV or GB/T 12706 numerical rule is inherited here. The ordinary pinned
evidence path supplies every limit; requirements not yet compiled stay visible.
"""


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
    for key, title, field, reason in (
        ('ehv-construction', '导体结构与圆整度', path + '.form',
         '仅编制表 2/3；6.1.2 的结构与圆整度尚未绑定核对。'),
        ('ehv-coverings', '金属套与外护套要求', root + '.common_layers',
         '6.6、6.7 与表 4 的护层要求尚未编制可执行判据。'),
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
    result = {}
    for row in checker.rows:
        row['basis_missing_fields'] = []
        key = row['id'].rsplit(':', 1)[-1]
        if key not in ('r20', 'conductor-wire-count', 'insulation-nominal'):
            continue
        if metal is None:
            row['basis_missing_fields'].append({
                'field': '/materials/' + conductor['material'].replace('~', '~0').replace('/', '~1') + '/standard_kind',
                'label': '导体材料标准类别'})
        elif metal != 'copper_bare':
            row['reason'] = 'GB/T 18890.2—2015 6.1.1 为 TR 型圆铜线；本表未放行镀层铜、铝或合金替代。'
            continue
        if key == 'insulation-nominal' and insulation_kind is None:
            row['basis_missing_fields'].append({
                'field': '/materials/' + insulation.get('material', '').replace('~', '~0').replace('/', '~1') + '/standard_kind',
                'label': '绝缘材料标准类别'})
        elif key == 'insulation-nominal' and insulation_kind != 'XLPE':
            row['reason'] = 'GB/T 18890.2—2015 表 3 仅放行 XLPE；其他绝缘材料未覆盖。'
            continue
        if row['basis_missing_fields']:
            continue
        result[row['id']] = {
            'schema_version': 'cablesim.standards-query/1',
            'standard': 'GB/T 18890.2', 'edition': '2015',
            'locator': '表 3' if key == 'insulation-nominal' else '表 2',
            'quantity': {'r20': 'resistance_20_max', 'conductor-wire-count': 'wire_count_min',
                         'insulation-nominal': 'insulation_nominal'}[key],
            'conditions': {**conditions, **({'insulation': 'XLPE'} if key == 'insulation-nominal' else {})},
        }
    return result
