"""Manufacturer comparisons refuse missing data; reference scenarios are opt-in.

The published cells never inherit a reference scenario's dimensions or ratings.
The existing Studio regression remains available after explicit confirmation,
in a separate result that cannot contribute to manufacturer acceptance counts.
"""
from copy import deepcopy
from hashlib import sha256
from pathlib import Path

from .catalogue_core import catalogue, library, product, structure

from .public_catalogues import _data, _sheet_name, BAHRA_SHEET, SAMPLES, catalogue_reference


COMPARISON_METHOD = {'name': '公开样本严格偏差对照', 'version': '2.0.0'}
REFERENCE_METHOD = {'name': 'Studio 公开样本参考情景回归', 'version': '1.0.0'}


def metric(published, value, unit, reason, *, status=None, method=None, tier=None):
    comparable = published is not None and value is not None
    return {'published': published, 'value': value, 'unit': unit,
            'published_status': 'published' if published is not None else 'not_published',
            'difference': value - published if comparable else None,
            'relative_difference': (value - published) / published if comparable and published else None,
            'status': status or ('compared' if comparable else 'missing'), 'reason': reason,
            'method': method, 'tier': tier, 'confidence': 'reference',
            'comparison_method': COMPARISON_METHOD}


def _conditions(data, *, people, cores):
    published = data['ratings']['conditions'] if people else data['conditions']
    ground = published['ground_temperature_c']
    depth = .7 if people else published['depth_m']
    frequency = 50 if people else published['frequency_hz']
    installation = {'layout': 'three_core_buried_single' if cores == 3 else 'trefoil',
                    'depth_m': depth, 'spacing_m': None, 'duct': None, 'backfill': None, 'bonding': 'both_ends'}
    conditions = {'soil_thermal_resistivity': published['soil_thermal_resistivity'],
                  'ambient_temperature_c': ground, 'frequency_hz': frequency,
                  'system_voltage_v': data['u_v'], 'currents_a': [0.0]}
    return [{'id': 'ground-trefoil' if cores == 1 else 'ground-three-core',
             'installation': installation, 'conditions': conditions}]


def _reference_calculation(sample_id):
    """Run the unchanged, explicitly assumed Studio scenario after confirmation."""
    data = _data(sample_id)
    people = sample_id == 'people-mv'
    rows, jobs = [], {}
    if people:
        groups = []
        for table in data['tables']:
            declaration, originals = catalogue.table_series(data, table['id'])
            built = structure.build(declaration, originals)
            groups.append((table, originals, built['rows']))
    else:
        keys = [key for key, _ in data['columns']]
        originals = [dict(zip(keys, values)) for values in data['rows']]
        built = [{'ok': True, 'entry': catalogue.single_core_entry(data, item)} for item in originals]
        groups = [({'id': 'single-core', 'cores': 1, 'designations': [data['designation']]}, originals, built)]
    for table, originals, built in groups:
        sheet = _sheet_name(table) if people else BAHRA_SHEET
        for original, result in zip(originals, built):
            area = original['area']
            key = f'{table["id"]}-{area:g}'
            reference = catalogue_reference(sample_id, sheet, area)
            entry = result.get('entry')
            dimension = entry['summary']['outer_diameter_m'] * 1000 if entry else None
            r20 = entry['summary'].get('r20_ohm_m') if entry else None
            r20 = None if r20 is None else r20 * 1000
            geometry_reason = ('层厚及明确声明的包带/填充余量组成结构；外径用于闭合，零偏差不构成独立验证。' if people else
                               '目录外径是建模输入；未列屏蔽厚度按旧版对照显式分配，零偏差不构成独立验证。')
            error = result.get('error')
            if error:
                geometry_reason = error.get('message', str(error))
            metrics = {
                'outer_diameter': metric(reference['outer_diameter'], dimension, 'mm', geometry_reason,
                                         status='declared_input' if dimension is not None else 'refused',
                                         method=result.get('derivation')),
                'weight': metric(reference['weight'], None, 'kg/km',
                                 '厂家近似净重已收录，原值和原表来源均保留；独立质量计算缺少各层密度、成缆节距和工艺用量，'
                                 '拒绝生成计算重量与偏差。', status='refused'),
                'r20': metric(reference['r20'], r20, 'Ω/km',
                              '目录未公布 R20；结构使用 GB/T 3956 标准上限，无法计算厂家偏差。' if people else
                              '厂家保证上限作为导体输入回读；未测量电阻，零偏差不构成独立验证。',
                              status='missing' if people else 'declared_input'),
                'ampacity': metric(reference['ampacity'], None, 'A',
                                   error.get('message', str(error)) if error else '等待封签方法运行。',
                                   status='refused' if error else 'missing'),
            }
            item = {'key': key, 'sheet': sheet, 'table': table['id'], 'area_mm2': area,
                    'designation': table['designations'][0], 'metrics': metrics,
                    'source': deepcopy(reference['source']), 'warnings': result.get('warnings', []),
                    'error': error}
            if entry:
                # Retain the actual, explicitly assumed input separately from
                # the manufacturer's cells, including per-size derived inputs.
                item['reference_inputs'] = {key: deepcopy(entry[key]) for key in
                                           ('payload', 'method_defaults', 'method_parameters')}
            rows.append(item)
            if entry:
                jobs[key] = (entry, _conditions(data, people=people, cores=table['cores']))
    ratings = product.rating_table_batch(jobs) if jobs else {}
    for row in rows:
        if row['key'] not in ratings:
            continue
        rated = ratings[row['key']]
        value = rated['rows'][0]
        error = value.get('error')
        reason = ('目录未给埋深，比较显式采用 0.7 m、两端接地及系列参考屏蔽/填充参数；50 Hz 来自原 PDF 使用特性。'
                  '目录载流量为近似值，差异受未公开构造和敷设条件影响。' if people else
                  '目录未给屏蔽厚度和接地方式；旧版对照显式采用导体屏蔽 0.6 mm、余量作绝缘屏蔽、两端接地。'
                  '标准材料常数及厂家近似额定值的差异会改变载流量。')
        if error:
            reason = error.get('message', str(error))
        reference = row['metrics']['ampacity']['published']
        row['metrics']['ampacity'] = metric(reference, value.get('ampacity_a'), 'A', reason,
                                             status='refused' if error else None,
                                             method=rated.get('method'), tier=value.get('tier'))
        row['rating_error'] = error
        row['rating_warnings'] = value.get('warnings', [])
        row['conditions'] = _conditions(data, people=people, cores=3 if row['table'] != 'single-core' else 1)
    compared = [row['metrics']['ampacity']['relative_difference'] for row in rows
                if row['metrics']['ampacity']['relative_difference'] is not None]
    return {'sample_id': sample_id, 'source': data['source'], 'rows': rows, 'method': REFERENCE_METHOD,
            'scope': '已明确选择的参考情景；缺失厂家条件由所列研究声明代入，不是厂家真实条件复现，不计入四项真实核对。',
            'manufacturer_comparison': False,
            'assumptions': deepcopy(data['import_declaration'] if people else data['modelling_assumptions']),
            'summary': {'specifications': len(rows), 'ampacity_compared': len(compared),
                        'ampacity_refused': sum(row['metrics']['ampacity']['status'] == 'refused' for row in rows),
                        'ampacity_mean_absolute_relative_difference': sum(abs(v) for v in compared) / len(compared) if compared else None,
                        'ampacity_max_absolute_relative_difference': max(map(abs, compared)) if compared else None,
                        'weight_compared': 0},
            'human_reviewed': False}


def _missing_ampacity_fields(people, table):
    """Missing manufacturer inputs, not the values a reference case substitutes."""
    missing = [
        ('installation.bonding', '金属屏蔽或金属套接地方式', '厂家未公布载流量计算采用的接地方式。'),
        ('structure.conductor_screen_thickness', '导体屏蔽厚度', '原表未给出，不能借用其他厂家的厚度。'),
        ('structure.insulation_screen_thickness', '绝缘屏蔽厚度', '原表未给出，不能把外径余量当作厂家层厚。'),
    ]
    if people:
        missing[:0] = [('installation.depth_m', '埋深', '原表未公布埋深，不能采用参考情景的 0.7 m。')]
        missing += [
            ('structure.screen_tape_specification', '铜带屏蔽规格及接触模型', '原表未列铜带厚度、宽度、搭盖与接触构造。'),
            ('conductor.r20', '20℃导体直流电阻', '原表未列电阻，标准上限不是该厂家产品的独立电阻数据。'),
            ('materials.filler_thermal_resistivity', '填充与包带材料热阻率', '原表未声明填充材料；参考纤维填充值不能作为厂家数据。'),
        ]
        if table.get('cores') == 3:
            missing.append(('structure.core_lay_length', '成缆节距', '原表未列成缆节距，不能代入另一研究案例的节距。'))
        else:
            missing.append(('installation.spacing_m', '单芯电缆间距', '原表未给出品字形电缆的间距，不能自动认定相互接触。'))
        if 'steel-tape' in table['id']:
            missing.append(('structure.armour_gap_ratio', '钢带间隙率', '原表未列实际间隙，标准最大允许值不是实际结构。'))
    else:
        missing += [
            ('materials.insulation_relative_permittivity', '绝缘相对介电常数', '目录未列产品参数；旧版参考回归使用标准参考值。'),
            ('materials.insulation_loss_tangent', '绝缘介质损耗因数', '目录未列产品参数；旧版参考回归使用标准参考值。'),
        ]
    return [{'field': field, 'label': label, 'reason': reason} for field, label, reason in missing]


def _manufacturer_rows(sample_id, data):
    """Read the original cells without constructing or calculating an assumed model."""
    people = sample_id == 'people-mv'
    tables = data['tables'] if people else [
        {'id': 'single-core', 'cores': 1, 'designations': [data['designation']], 'rows': data['rows']}]
    rows = []
    for table in tables:
        sheet = _sheet_name(table) if people else BAHRA_SHEET
        missing = _missing_ampacity_fields(people, table)
        reason = '厂家条件缺失，拒绝计算真实载流量及偏差：' + '、'.join(item['label'] for item in missing) + '。'
        for original in table['rows']:
            area = original[0]
            reference = catalogue_reference(sample_id, sheet, area)
            metrics = {
                'outer_diameter': metric(reference['outer_diameter'], reference['outer_diameter'], 'mm',
                    '保留厂家原表外径；缺少独立、完整的厂家层厚，回读原值不构成尺寸核对。', status='declared_input'),
                'weight': metric(reference['weight'], None, 'kg/km',
                    '厂家近似净重已收录；独立质量计算缺少各层密度、成缆节距和工艺用量，拒绝生成计算重量与偏差。', status='refused'),
                'r20': metric(reference['r20'], reference['r20'], 'Ω/km',
                    '目录未公布 R20，不能用标准上限补成厂家值。' if people else
                    '保留厂家保证上限；没有独立测量或计算结果，回读原值不构成电阻核对。',
                    status='missing' if people else 'declared_input'),
                'ampacity': {**metric(reference['ampacity'], None, 'A', reason, status='refused'),
                             'missing_fields': deepcopy(missing)},
            }
            # An identical input is not a zero-deviation independent check.
            for value in metrics.values():
                value['difference'] = value['relative_difference'] = None
                value['manufacturer_comparison'] = True
            rows.append({'key': f'{table["id"]}-{area:g}', 'sheet': sheet, 'table': table['id'],
                         'area_mm2': area, 'designation': table['designations'][0], 'metrics': metrics,
                         'source': deepcopy(reference['source']), 'conditions': deepcopy(reference['conditions']),
                         'warnings': [], 'error': None})
    return rows


def _scenario_metadata(sample_id, data, confirmed):
    """Describe every declared assumption before running a reference scenario."""
    people = sample_id == 'people-mv'
    declaration = deepcopy(data['import_declaration'] if people else data['modelling_assumptions'])
    declaration_path = catalogue.CATALOGUES / (SAMPLES[sample_id]['catalogue'] + '.json')
    declaration_hash = sha256(declaration_path.read_bytes()).hexdigest()
    scenario_hash = sha256(Path(__file__).read_bytes()).hexdigest()
    facts = []

    def add(key, label, value, unit, reference, *, kind='engineering_assumption',
            version=REFERENCE_METHOD['version'], digest=declaration_hash):
        facts.append({'key': key, 'label': label, 'value': deepcopy(value), 'unit': unit,
                      'source': {'kind': kind, 'reference': reference, 'version': version, 'file_sha256': digest},
                      'confidence': 'reference', 'manufacturer_data': False})

    add('installation.bonding', '接地方式', 'both_ends', '1',
        '旧版 Studio 公开样本回归选择两端接地；厂家原表未公布此条件。', digest=scenario_hash)
    if people:
        add('installation.depth_m', '研究情景埋深', .7, 'm',
            '旧版 Studio 公开样本回归选择 0.7 m；厂家原表未公布埋深，无厂家依据。', digest=scenario_hash)
    add('installation.layout', '参考情景排列',
        {'single_core': 'trefoil', 'three_core': 'three_core_buried_single'} if people else 'trefoil', '1',
        '旧版 Studio 回归选择直埋单回路；单芯按相互接触的品字形排列，不能当作未公布的厂家间距。', digest=scenario_hash)
    modelling = {}
    if people:
        groups = [('common', declaration['common'], ''),
                  *[(f'common_by_cores.{cores}', values, f'{cores} 芯 · ')
                    for cores, values in declaration['common_by_cores'].items()],
                  *[(f'common_by_armour.{armour}', values, '钢带铠装 · ')
                    for armour, values in declaration['common_by_armour'].items()]]
        for prefix, values, qualifier in groups:
            for key, value in values.items():
                label, unit, *_ = structure.FIELDS[key]
                add(f'{prefix}.{key}', qualifier + label, value, unit, declaration['common_basis'][key])
        modelling = structure.reference_modelling()
        modelling['diameter_rounding'] = deepcopy(declaration['diameter_rounding'])
        modelling_hash = sha256((library.SERIES / 'huayuan_yjv22.json').read_bytes()).hexdigest()
        for key, item in modelling.items():
            add('modelling.' + key, structure.MODELLING[key][0], item['value'], item['unit'], item['reference'],
                digest=declaration_hash if key == 'diameter_rounding' else modelling_hash)
        add('conductor.r20_basis', '导体电阻参考依据', 'standard_limit', '1',
            'GB/T 3956—2008 表 2，第 2 类铜导体 20℃直流电阻上限；按截面查封签依据，不是厂家实测电阻。',
            kind='standard_reference', version='2008')
    else:
        units = {'conductor_screen_thickness_mm': 'mm', 'relative_permittivity': '1', 'loss_tangent': '1',
                 'electrical_resistivity_20': 'Ω*m', 'temperature_coefficient_20': '1/K', 'thermal_resistivity': 'K*m/W'}
        labels = {'conductor_screen_thickness_mm': '导体屏蔽参考厚度', 'relative_permittivity': '绝缘相对介电常数',
                  'loss_tangent': '绝缘介质损耗因数', 'electrical_resistivity_20': '铅套电阻率',
                  'temperature_coefficient_20': '铅套电阻温度系数', 'thermal_resistivity': '铅套热阻率'}
        for group, item in declaration.items():
            if 'value' in item:
                add(group, labels[group], item['value'], units[group], item['reference'])
            elif group == 'remainder':
                add(group, '绝缘屏蔽参考厚度的分配', item['reference'], 'mm',
                    '旧版 Studio 几何闭合声明；厂家未公布该层厚度，外径余量分配不是制造数据。')
            else:
                for key, value in item.items():
                    if key != 'reference':
                        add(group + '.' + key, labels[key], value, units[key], item['reference'], kind='standard_reference')
    method_defaults = deepcopy(library.METHOD_DEFAULTS)
    parameter_labels = {'ks': '集肤效应系数', 'kp': '邻近效应系数', 't4_form': '外部热阻形式', 'eddy': '涡流损耗处理',
                        'u': '排管空气隙系数 u', 'v': '排管空气隙系数 v', 'y_per_k': '排管空气隙系数 y',
                        'initial_mean_air_temperature_c': '排管空气初始温度',
                        'initial_sheath_temperature_c': '护套初始迭代温度', 'current_tolerance_a': '电流收敛容差',
                        'max_iterations': '最大迭代次数'}
    parameter_units = {'y_per_k': '1/K', 'initial_mean_air_temperature_c': '°C',
                       'initial_sheath_temperature_c': '°C', 'current_tolerance_a': 'A'}
    method_hash = sha256(Path(library.__file__).read_bytes()).hexdigest()

    def parameter_facts(values, prefix='method_parameters'):
        for key, value in values.items():
            if isinstance(value, dict):
                parameter_facts(value, prefix + '.' + key)
            else:
                add(prefix + '.' + key, parameter_labels[key], value, parameter_units.get(key, '1'),
                    '旧版 Studio 方法输入声明；仅用于显式确认的参考回归，非厂家参数。排管参数在本直埋情景不启用。',
                    kind='method_declaration', digest=method_hash)
    parameter_facts(method_defaults)
    return {'id': sample_id + '-studio-reference', 'requires_confirmation': True, 'confirmed': confirmed,
            'executed': False, 'manufacturer_data': False, 'method': REFERENCE_METHOD,
            'scope': '以下是可选研究情景的完整声明。确认只授权执行这些参考输入，不补全厂家原值，不计入真实样本验收。',
            'assumptions': facts,
            'raw_assumptions': {'catalogue_declaration': declaration, 'series_modelling': modelling,
                                'method_parameters': method_defaults,
                                'condition_selection': {str(cores) + '_core': _conditions(data, people=people, cores=cores)
                                                        for cores in ((1, 3) if people else (1,))},
                                'material_reference_notes': {'thermal': structure.THERMAL,
                                                             'dielectric': structure.DIELECTRIC}}}


def reference_report(sample_id, *, reference_scenario_confirmed=False):
    """Read every original value; execute assumptions only with literal opt-in."""
    if type(reference_scenario_confirmed) is not bool:
        raise ValueError('参考情景须使用明确的布尔确认值。')
    data = _data(sample_id)
    rows = _manufacturer_rows(sample_id, data)
    scenario = _scenario_metadata(sample_id, data, reference_scenario_confirmed)
    calculated = _reference_calculation(sample_id) if reference_scenario_confirmed else None
    scenario['executed'] = calculated is not None
    return {'schema': 'cablesim.catalogue-comparison/2', 'sample_id': sample_id, 'source': data['source'],
            'rows': rows, 'method': COMPARISON_METHOD,
            'scope': '厂家埋设条件或结构参数缺失时拒绝计算；输入回读和另行确认的参考情景均不计入四项真实核对。',
            'assumptions': scenario['assumptions'], 'reference_scenario': scenario, 'reference_calculation': calculated,
            'summary': {'specifications': len(rows), 'ampacity_compared': 0, 'ampacity_refused': len(rows),
                        'ampacity_mean_absolute_relative_difference': None, 'ampacity_max_absolute_relative_difference': None,
                        'weight_compared': 0, 'four_metric_passed': 0},
            'human_reviewed': False}
