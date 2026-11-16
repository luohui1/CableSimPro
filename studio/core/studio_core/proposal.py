"""The initial structure a product standard gives.

One sealed method does the work (`cablesim.standard-check`, capability `structure-proposal`). It asks questions of the
standard basis between runs: which table, under which conditions. The basis library answers from its sealed data and the
method runs again, until it has what it needs. This module only carries the questions and the answers; it holds no
limit, table or formula. Every dimension it returns is a value the basis library gave (or the engineer stated), with
the standard, the clause and the pages it came from.
"""
import re

from . import CoreError, basis, runner, structure

PLUGIN = 'cablesim.standard-check'
CAPABILITY = 'structure-proposal'
ARTIFACT = 'x-cablesim.cable-design-proposal'
STEP_LIMIT = 24
# The layer a row of the proposal belongs to, and the field of the structure table that layer's thickness fills.
FIELDS = {'insulation': 'insulation_thickness', 'conductor_screen': 'conductor_screen_thickness', 'insulation_screen': 'insulation_screen_thickness',
          'bedding': 'bedding_thickness', 'oversheath': 'oversheath_thickness'}
CONDUCTORS = {'copper': 'copper_bare', 'aluminium': 'aluminium'}


def _edition(text):
    return re.sub(r'\s+', '', text).replace('—', '-').replace(':', '-')


def _standard(record):
    return f"{record['standard']}—{record['edition']}"


def _request(inputs):
    cores, scope = inputs['cores'], inputs['scope']
    values = {'schema_version': 'cablesim.cable-design-request/2', 'construction': 'single_core' if cores == 1 else 'three_core',
              'voltage': f"{round(inputs['u0_v'])}/{round(inputs['u_v'])}", 'conductor': CONDUCTORS[inputs['conductor']],
              'area_m2': inputs['area_mm2'] * 1e-6, 'form': 'solid_round', 'generation_mode': scope}
    if inputs.get('conductor_diameter_mm') is not None:
        values.update(form='unspecified', diameter_m=inputs['conductor_diameter_mm'] * 1e-3)
    if cores == 3:
        values['gap_m'] = 0.0  # the thickness of a layer does not depend on how far apart the cores lie
    if scope == 'complete':
        values['armour'] = inputs['armour']
        if inputs.get('screened') is not None:  # whether the cores are screened is the engineer's to say; the method asks if it is not said
            values['screened'] = 'yes' if inputs['screened'] else 'no'
        for key in ('conductor_screen_thickness', 'insulation_screen_thickness', 'screen_tape_thickness', 'screen_tape_width'):
            if inputs.get(key + '_mm') is not None:
                values[key + '_m'] = inputs[key + '_mm'] * 1e-3
    return values


def _run(values, references):
    run = runner.run(PLUGIN, CAPABILITY, [{'case_id': 'proposal', 'input': values, 'parameters': {'basis_references': references} if references else {}}])
    case = run['cases'][0]
    if case['status'] != 'succeeded':
        error = case.get('error') or {}
        raise CoreError(error.get('code', 'PROPOSAL_FAILED'), error.get('message', '标准结构提案没有给出结果。'), error.get('path'))
    return run, case['artifacts'][ARTIFACT]


def _source(row):
    """Where a dimension comes from: a value of the standard, a value the standard's annex calculation gives, or the engineer's."""
    source = row.get('source') or {}
    if row['basis'] == 'user':
        return {'kind': 'given', 'note': '工程师给定'}
    record = source.get('record') or {}
    return {'kind': 'standard' if row['basis'] == 'standard_value' else 'derived', 'standard': _standard(record),
            'clause': source.get('clause') or source.get('locator') or record.get('table') or record.get('clause'),
            'printed_page': source.get('printed_page'), 'pdf_page': source.get('pdf_page'), 'citation': source.get('citation') or record.get('citation'),
            'record_id': record.get('id'), 'record_sha256': record.get('record_sha256'), 'source_sha256': record.get('source_sha256'),
            **({'calculation': source['calculation']} if source.get('calculation') else {})}


def _field(row):
    path = row['path'].split('/')
    if path[-2:] == ['armour', 'nominal_tape_thickness']:
        return 'armour_tape_thickness'
    if path[-1] == 'thickness' and path[-2] in FIELDS:
        return FIELDS[path[-2]]
    return None  # a radial envelope of a tape (screen, armour) is derived from a field, not a field of the table


def _citation(source):
    if source['kind'] == 'given':
        return '工程师给定'
    clause = f" {source['clause']}" if source.get('clause') else ''
    pages = f"（印刷第 {source['printed_page']} 页，PDF 第 {source['pdf_page']} 页）" if source.get('pdf_page') else ''
    if source['kind'] == 'derived':
        return f"按 {source['standard']}{clause} 计算得出{pages}"
    return f"{source['standard']}{clause}{pages}"


def propose(standard, u0_v, u_v, cores, conductor, area_mm2, insulation='XLPE', armour='none', conductor_diameter_mm=None, scope=None,
            screened=None, conductor_screen_thickness_mm=None, insulation_screen_thickness_mm=None, screen_tape_thickness_mm=None,
            screen_tape_width_mm=None):
    """The dimensions a standard gives a cable of the stated kind, each with its source, and what is still left to the engineer."""
    if insulation != 'XLPE':
        raise CoreError('INSULATION_UNSUPPORTED', f'目前只有交联聚乙烯（XLPE）绝缘的标准结构提案，没有 {insulation}。', '/insulation')
    if cores not in (1, 3):
        raise CoreError('INPUT_INVALID', '芯数：目前收录单芯和三芯。', '/cores')
    if conductor not in CONDUCTORS:
        raise CoreError('INPUT_INVALID', '导体材料：铜或铝。', '/conductor')
    inputs = {'standard': standard, 'u0_v': u0_v, 'u_v': u_v, 'cores': cores, 'conductor': conductor, 'area_mm2': area_mm2, 'insulation': insulation,
              'armour': armour, 'conductor_diameter_mm': conductor_diameter_mm, 'screened': screened,
              'scope': scope or ('complete' if screened is not None else 'insulation'),
              'conductor_screen_thickness_mm': conductor_screen_thickness_mm, 'insulation_screen_thickness_mm': insulation_screen_thickness_mm,
              'screen_tape_thickness_mm': screen_tape_thickness_mm, 'screen_tape_width_mm': screen_tape_width_mm}
    values = _request(inputs)
    references, unanswered, steps = {}, {}, 0
    for _ in range(STEP_LIMIT):
        run, artifact = _run(values, references)
        steps += 1
        if artifact['status'] != 'basis_required':
            break
        queries = artifact['basis_queries']
        if steps == 1:
            # The standard the method will take the insulation from is known from its first question; a different one is refused at once.
            asked = queries['insulation']
            if _edition(asked['standard'] + '-' + asked['edition']) != _edition(standard):
                raise CoreError('STANDARD_MISMATCH', f"{round(u0_v)}/{round(u_v)} V 的 XLPE 绝缘厚度按 {asked['standard']}—{asked['edition']} 规定，"
                                f'与所给的执行标准 {standard} 不一致；请核对电压等级或执行标准。', '/standard')
        fresh = {name: query for name, query in queries.items() if name not in references}
        repeated = [name for name in fresh if name in unanswered]
        if repeated:
            query = fresh[repeated[0]]
            raise CoreError('BASIS_MISSING', f"标准依据库没有收录 {query['standard']}—{query['edition']} {query['locator']}（{unanswered[repeated[0]]}），不生成近似值。")
        answered, missing = basis.resolve(fresh)
        references.update(answered)
        unanswered.update({item['key']: item['reason'] for item in missing})
    else:
        raise CoreError('BASIS_INCOMPLETE', '标准依据查询没有收敛，请核对输入。')
    dimensions = {}
    for row in artifact['rows']:
        field = _field(row)
        if field is None:
            continue
        value = round(row['value'] / structure.FIELDS[field][2], 9)
        if field in dimensions and abs(dimensions[field]['value'] - value) > 1e-9:
            raise CoreError('PROPOSAL_INCONSISTENT', f'各线芯的{structure.FIELDS[field][0]}不一致，无法给出一个初始值。')
        dimensions.setdefault(field, {'field': field, 'label': structure.FIELDS[field][0], 'value': value, 'unit': structure.FIELDS[field][1], 'source': _source(row)})
    for key in ('screen_tape_thickness', 'screen_tape_width'):
        if inputs.get(key + '_mm') is not None:
            dimensions[key] = {'field': key, 'label': structure.FIELDS[key][0], 'value': inputs[key + '_mm'], 'unit': structure.FIELDS[key][1],
                               'source': {'kind': 'given', 'note': '工程师给定'}}
    if inputs['conductor_diameter_mm'] is not None:
        dimensions['conductor_diameter'] = {'field': 'conductor_diameter', 'label': structure.FIELDS['conductor_diameter'][0],
                                            'value': inputs['conductor_diameter_mm'], 'unit': 'mm', 'source': {'kind': 'given', 'note': '工程师给定'}}
    standards = {dimension['source']['standard'] for dimension in dimensions.values() if dimension['source'].get('standard')}
    needed = [*structure.REQUIRED, *(['bedding_thickness', 'armour_tape_thickness'] if armour == 'steel_tape' else [])]
    reasons = {'conductor_diameter': '导体外径由绞合工艺决定，标准不规定；建规格时按实际值填写',
               'outer_diameter': '成品外径由各层叠加后设计或实测得出；建规格时用来做外径闭合核对',
               'oversheath_thickness': '外护套厚度由附录计算得出；需要 scope 为 complete，并给出屏蔽的厚度',
               'bedding_thickness': '内衬层厚度由附录计算得出；需要 scope 为 complete，并给出屏蔽的厚度',
               'armour_tape_thickness': '钢带厚度由附录计算得出；需要 scope 为 complete，并给出屏蔽的厚度'}
    unspecified = '标准只规定铜带的最小标称厚度，屏蔽层的实际厚度由工程师给定'
    missing_fields = [{'field': key, 'label': structure.FIELDS[key][0], 'unit': structure.FIELDS[key][1], 'reason': reasons.get(key, unspecified)}
                      for key in needed if key not in dimensions]
    return {'scope': inputs['scope'], 'standard': standard if len(standards) != 1 else next(iter(standards)), 'inputs': inputs,
            'dimensions': list(dimensions.values()), 'values': {key: item['value'] for key, item in dimensions.items()},
            'basis': {key: _citation(item['source']) for key, item in dimensions.items()}, 'missing': missing_fields,
            'limitations': artifact['limitations'],
            'method': {key: run[key] for key in ('plugin_id', 'plugin_version', 'capability', 'method_version', 'manifest_sha256', 'request_sha256', 'run_id')}
            | {'steps': steps}}
