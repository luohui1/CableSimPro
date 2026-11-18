"""Consume GB/T 12706.2 13.3.3 without certifying missing manufacturing facts.

The three applicability records describe different questions. In particular,
the inner-covering relationship is not an exemption from a required separator.
No dimensions, compound limits or spark-test criteria are supplied here.
"""
import json

APPLICATION = 'separation_sheath_application'
WATER_EXCEPTION = 'separation_sheath_water_barrier_exception'
RECORDS = {
    'required': 'mv-isolation-applicability/r1/' + APPLICATION,
    'lead': 'mv-isolation-applicability/r2/' + APPLICATION,
    'relationship': 'mv-isolation-applicability/r3/' + APPLICATION,
    'water': 'mv-isolation-water-barrier/r1/' + WATER_EXCEPTION,
}
METALS = {
    'copper_bare': 'copper', 'copper_coated': 'copper',
    'aluminium': 'aluminium', 'aluminium_alloy': 'aluminium',
    'steel_galvanized': 'steel', 'steel_stainless_nonmagnetic': 'steel',
    'lead': 'lead',
}


def structure(checker):
    """Locate the actual innermost/outermost boundaries, never a material name."""
    common = checker.cable['common_layers']
    armour_index = next((i for i, layer in enumerate(common) if layer['role'] == 'armour'), None)
    before = common[:armour_index] if armour_index is not None else []
    common_metals = [(i, layer) for i, layer in enumerate(before)
                     if layer['role'] in ('metallic_screen', 'metallic_sheath')]
    boundary = common_metals[-1][0] if common_metals else -1
    # A surrounding common metal is the adjacent metal. Otherwise every core
    # must declare its outermost metal; an omitted core cannot prove separation.
    adjacent = [(None, common_metals[-1][1])] if common_metals else [
        (core['id'], next((layer for layer in reversed(core['layers'])
                         if layer['role'] in ('metallic_screen', 'metallic_sheath')), None))
        for core in checker.cable['cores']]
    armour = common[armour_index] if armour_index is not None else None
    missing = []
    escape = lambda value: value.replace('~', '~0').replace('/', '~1')
    cable_path = '/cable_types/' + escape(checker.cable['id'])
    for core_id, layer in [*adjacent, (None, armour)]:
        if layer is None:
            missing.append({'field': cable_path + ('/cores/' + escape(core_id) + '/layers' if core_id else '/common_layers'),
                            'label': '铠装及其内侧各芯或公共金属层结构', 'type': 'structure', 'storage': 'domain'})
        elif checker.materials.get(layer['material'], {}).get('standard_kind') not in METALS:
            missing.append({'field': '/materials/' + escape(layer['material']) + '/standard_kind',
                            'label': '铠装及相邻金属材料标准类别', 'type': 'material', 'storage': 'domain'})
    positions = {role: next((i for i, layer in enumerate(common) if layer['role'] == role), None)
                 for role in ('separator', 'bedding')}
    return {'common': common, 'armour_index': armour_index, 'boundary': boundary,
            'adjacent': adjacent, 'armour': armour, 'missing': missing, **positions}


def declaration(checker, row, name, label, kind='boolean'):
    from .manufacturing import field, read
    # All these declarations describe the armour's protection, even when a
    # dependent row targets the bedding. Keep one stable provenance address.
    target = {'target': {'scope': 'common', 'core_id': None, 'role': 'armour'}}
    spec = field(checker, target, name, label, kind=kind)
    fields = row.setdefault('engineering_inputs', [])
    if not any(value['field'] == spec['field'] for value in fields):
        fields.append(spec)
    source = checker.document.get('provenance', {}).get(spec['field'])
    if source and source.get('kind') == 'standard':
        raise ValueError(label + '：标准条款不能代替本电缆的构造、材料或试验记录。')
    if source:
        try:
            receipt = json.loads(source.get('reference', ''))
        except (TypeError, ValueError):
            raise ValueError(label + '：工程输入来源记录损坏，请重新录入。') from None
        if (not isinstance(receipt, dict) or not isinstance(receipt.get('reference'), str)
                or not receipt['reference'].strip()):
            raise ValueError(label + '：工程输入须有非空文字出处，不接受空白或其他数据类型代替。')
    return read(checker, spec), spec


def query(branch, conditions):
    return {'schema_version': 'cablesim.standards-query/1', 'standard': 'GB/T 12706.2',
            'edition': '2020', 'locator': '13.3.3',
            'quantity': WATER_EXCEPTION if branch == 'water' else APPLICATION,
            'record_id': RECORDS[branch], 'conditions': conditions}


def plan(checker, row):
    if row['id'].endswith(':armour-separation-relation'):
        return query('relationship', {})
    context = structure(checker)
    water, spec = declaration(checker, row, 'longitudinal_water_barrier',
                              '金属层间纵向阻水隔层')
    row['basis_missing_fields'].extend(context['missing'])
    if water is None:
        row['basis_missing_fields'].append(spec)
    if row['basis_missing_fields']:
        return None
    adjacent = [layer for _, layer in context['adjacent']]
    lead = [layer['role'] == 'metallic_sheath'
            and checker.materials[layer['material']]['standard_kind'] == 'lead' for layer in adjacent]
    if any(lead) and not all(lead):
        row['basis_uncovered_reason'] = (
            '各芯相邻金属层同时含铅套与其他金属；本库未接入逐界面的隔离与阻水判定，'
            '不能把一芯铅套允许的绕包垫层或统一阻水声明扩展到全部界面。')
        return None
    if water:
        return query('water', {'longitudinal_water_barrier': True})
    if all(lead):
        return query('lead', {'lead_sheath_present': True})
    armour_kind = checker.materials[context['armour']['material']]['standard_kind']
    kinds = [checker.materials[layer['material']]['standard_kind'] for layer in adjacent]
    if any(METALS[kind] != METALS[armour_kind] for kind in kinds):
        return query('required', {'metal_layer_relation': 'different',
                                 'longitudinal_water_barrier': False, 'lead_sheath_present': False})
    # Even identical declarations do not supply a compiled exemption. Alloy or
    # coating differences within one metal group are not silently equated.
    row['basis_uncovered_reason'] = (
        '已声明相同金属类别且无纵向阻水；本库没有此条件的独立免除判据，'
        '不把隔离套替代内衬的关系规则用作免除依据。'
        if all(kind == armour_kind for kind in kinds) else
        '相邻金属同属一个金属组但牌号或镀层类别不同；本库未核验其同异性分支，不推测隔离套免除条件。')
    return None


def position(context):
    index, armour = context['separator'], context['armour_index']
    if context['missing']:
        return 'missing', '缺字段：铠装及其内侧金属层、明确材料类别和相对位置。'
    if index is None:
        return 'missing', '缺字段：明确的隔离套层；普通光滑内衬不能自动视为挤包隔离套。'
    if not context['boundary'] < index < armour:
        return 'failed', '隔离套未处于相邻金属层与铠装之间；不能采用金属层内侧或铠装外侧的隔离层。'
    form = context['common'][index].get('form')
    if form in (None, 'unspecified'):
        return 'missing', '缺字段：隔离套的挤包构造。'
    if form != 'smooth':
        return 'failed', '所声明隔离套不是挤包构造；不能把绕包层当作挤包隔离套。'
    return None, None


def qualification(checker, row, context):
    """An affirmative declaration never supplies the unimplemented criteria."""
    # Preserve the existing declaration entry, including for a draft which has
    # only bedding. Recording it never supplies the missing separator role.
    confirmed, _ = declaration(checker, row, 'separator_compound_confirmed',
                               '隔离层材料已确认符合隔离套要求')
    status, reason = position(context)
    if status:
        return status, reason
    material, _ = declaration(checker, row, 'separator_material_reference',
                              '隔离套材料牌号与符合性记录', 'text')
    spark, _ = declaration(checker, row, 'separator_spark_test_reference',
                           '隔离套火花试验记录', 'text')
    separator = context['common'][context['separator']]
    measured = checker.observed(None, 'separator', 'minimum_thickness')
    minimum = measured['value'] if measured else separator.get('minimum_thickness')
    dependencies = [
        {'requirement': '隔离套规定标称厚度', 'verdict': 'uncovered',
         'reason': '13.3.3 与附录 A/B 的完整假设直径链未接齐；不以实际外径或内衬厚度代替。'},
        {'requirement': '隔离套最薄点实测及判据', 'verdict': 'missing' if minimum is None else 'uncovered',
         'value_m': minimum, 'reason': '须有隔离套实测记录及其适用的厚度判据；标称值不代替实测。'},
        {'requirement': '隔离套材料', 'verdict': 'failed' if confirmed is False else 'missing' if confirmed is None or material is None else 'uncovered',
         'reference': material, 'reason': '14.2 的完整材料符合性消费未接入；材料名称或工程确认不代替该判据。'},
        {'requirement': '隔离套火花试验', 'verdict': 'missing' if spark is None else 'uncovered',
         'reference': spark, 'reason': '火花试验记录须独立核对适用方法和判据；记录文字不构成试验合格结论。'},
    ]
    row['separation_dependencies'] = dependencies
    if confirmed is False:
        return 'failed', '已声明隔离套材料不符合要求。'
    missing = [item['requirement'] for item in dependencies if item['verdict'] == 'missing']
    residual = '仍未覆盖：13.3.3 完整厚度链、14.2 材料符合性和火花试验判据。'
    return ('missing', '缺字段：' + '、'.join(missing) + '。' + residual) if missing else ('uncovered', residual)


def execute(checker, row, record):
    expected = {RECORDS['required']: 'extruded_required',
                RECORDS['lead']: ['separation_sheath', 'tape_bedding_13.3.4'],
                RECORDS['relationship']: ['replace_inner_covering', 'additional_to_inner_covering'],
                RECORDS['water']: 'not_required'}
    if (record['id'] not in expected or record['value'] != expected[record['id']]
            or record['criterion'] != 'rule' or record['quantity']['unit'] != '1'):
        raise ValueError('隔离套依据的记录身份、构造语义或单位不兼容。')
    context = structure(checker)
    row.update(limit=None, comparison=None, actual=None, margin=None, formula=None,
               formula_inputs={}, rule_requirement='按相邻金属层、阻水构造和铅套条件核对隔离套')
    row['separation_structure'] = {
        'common_layer_order': [layer['role'] for layer in context['common']],
        'adjacent_metals': [{'core_id': core, 'role': layer['role'], 'material': layer['material'],
                            'standard_kind': checker.materials.get(layer['material'], {}).get('standard_kind')}
                           for core, layer in context['adjacent'] if layer is not None],
        'armour_index': context['armour_index'], 'separator_index': context['separator'],
        'bedding_index': context['bedding'],
    }
    if record['id'] == RECORDS['water']:
        row.update(verdict='passed', rule_actual='已声明相邻金属层周围纵向阻水，本条不要求隔离套',
                   reason='仅判定 13.3.3 的隔离套适用性；不证明阻水性能、材料或其他制造试验合格。')
        return
    if record['id'] == RECORDS['relationship']:
        row['rule_requirement'] = '隔离套可替代内衬，或与内衬同时设置'
        status, reason = position(context)
        if status:
            row.update(verdict=status, reason=reason)
            return
        bedding = context['bedding']
        if bedding is not None and bedding >= context['armour_index']:
            row.update(verdict='failed', reason='所声明内衬位于铠装外侧，不能作为铠装下内衬的附加配置。')
            return
        row.update(verdict='passed', reason='仅确认已声明的配置关系；隔离套尺寸、材料和试验仍须独立核对。',
                   rule_actual='隔离套替代内衬' if bedding is None else '隔离套与内衬同时设置',
                   separation_relationship='replace_inner_covering' if bedding is None else 'additional_to_inner_covering')
        return
    if record['id'] == RECORDS['lead']:
        row['rule_requirement'] = '铅套铠装选用隔离套或符合 13.3.4 的绕包垫层'
        bedding = context['bedding']
        if context['separator'] is None and bedding is not None:
            if context['boundary'] < bedding < context['armour_index'] and context['common'][bedding].get('form') == 'tape':
                row.update(verdict='uncovered', rule_actual='已声明铅套与铠装之间的绕包垫层',
                           reason='已核验 13.3.3 允许此选择；13.3.4 的完整垫层要求尚未收录，不用 8.2 内衬或 13.7 附加垫层代替。')
                return
    status, reason = qualification(checker, row, context)
    row.update(verdict=status, reason=reason)


def replacement(checker, row):
    """Keep 8.2 separate from the 13.3.3 permission and its prerequisites."""
    context = structure(checker)
    if context['separator'] is None:
        return False
    relation = next((item for item in checker.rows if item['id'].endswith(':armour-separation-relation')), None)
    row['rule_requirement'] = '内衬须符合 8.2；替代内衬的隔离套须独立符合 13.3.3'
    if not relation or not relation.get('basis_reference'):
        row.update(verdict='uncovered', reason='缺少已固定的 13.3.3 隔离套与内衬关系依据。')
        return True
    row['basis_reference'] = {**row['basis_reference'], 'dependency_references': [relation['basis_reference']]}
    if relation['verdict'] != 'passed':
        row.update(verdict=relation['verdict'], reason=relation['reason'])
        return True
    status, reason = qualification(checker, row, context)
    row.update(verdict=status, reason='已声明用隔离套替代内衬；' + reason)
    return True
