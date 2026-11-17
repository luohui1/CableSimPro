"""Catalogue agreement, retaining every size and every refusal.

This is a migration regression of the existing Studio methods. It is not a
certificate and does not complete a user's imported canonical model. Geometry
and R20 that were used as inputs are labelled as such, never independent checks.
Only the sealed method computes current ratings; this host computes differences.
"""
from copy import deepcopy

from studio.core.studio_core import catalogue, product, structure

from .public_catalogues import _data, _sheet_name, BAHRA_SHEET, catalogue_reference


COMPARISON_METHOD = {'name': '公开样本偏差对照', 'version': '1.0.0'}


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


def reference_report(sample_id):
    """Recompute every published size through the pre-existing sealed methods."""
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
    return {'sample_id': sample_id, 'source': data['source'], 'rows': rows, 'method': COMPARISON_METHOD,
            'scope': '沿用 Studio 公开样本方法回归；独立于用户型号审核。原始导入没有自动接受这些假设。',
            'assumptions': deepcopy(data['import_declaration'] if people else data['modelling_assumptions']),
            'summary': {'specifications': len(rows), 'ampacity_compared': len(compared),
                        'ampacity_refused': sum(row['metrics']['ampacity']['status'] == 'refused' for row in rows),
                        'ampacity_mean_absolute_relative_difference': sum(abs(v) for v in compared) / len(compared) if compared else None,
                        'ampacity_max_absolute_relative_difference': max(map(abs, compared)) if compared else None,
                        'weight_compared': 0},
            'human_reviewed': False}
