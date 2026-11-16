"""GB 50217 correction of a rating the studio already holds.

The sealed method `cablesim.gb50217-correction` converts one single-cable baseline current to the actual ambient temperature
and parallel laying with coefficients it looks up in the standard basis, each with its page and digest. This module composes
the actual conditions into the document the method reads, hands over the baseline with its evidence and writes the method
card. It holds no coefficient and no formula.
"""
from . import CoreError, methods, runner, scene

PLUGIN = 'cablesim.gb50217-correction'
CAPABILITY = 'steady-rating'
ARTIFACT = 'x-cablesim.gb50217-correction'
METHOD = 'gb50217.correction'


def release_digest():
    """The release of the standard basis the method is sealed against, as its own contract declares it; the method refuses another."""
    return runner.capability(PLUGIN, CAPABILITY)['parameter_schema']['properties']['basis_release_digest']['default']


def card(run, artifact):
    """The method card stored with a correction: method, scope, assumptions, validation and the tier of this configuration."""
    spec = runner.capability(run['plugin_id'], run['capability'])
    method = next(item for item in methods.METHODS if item['id'] == METHOD)
    basis = ['基准载流量取自工程里保存的一条 IEC 60287 单回路运行记录，由工程师确认条件，不是厂家保证值。',
             '系数取自标准依据库：' + '；'.join(artifact['clauses']) + '；每个系数的原件页码和摘要保存在记录里。',
             '插件自带的手算核对（400 A 的合成基准乘表系数：436、390.6、326.4、427.28 A，以及 D.0.2 的公式）只验证系数的运算，'
             '没有整链的公开算例，因此分档为“参考”。']
    return {
        'method': method['title'], 'family': method['family'], 'summary': method['summary'],
        'plugin': f"{run['plugin_id']} {run['plugin_version']}", 'capability': run['capability'],
        'method_version': run['method_version'], 'manifest_sha256': run['manifest_sha256'],
        'standards': artifact['clauses'], 'scope': [*spec['limitations'], artifact['scope']],
        'assumptions': ['基准是单根电缆、同型号、同正常导体温限、同中心埋深的结果；已经按并列分组修正过的基准不能再乘并列系数。',
                        '并列的校正结果是所有回路等负荷时每根电缆的允许电流，不是各回路电流之和。',
                        '表外的土壤热阻率、根数和间距不插值、不外推，直接拒绝；D.0.3 只用于 GB 50217 表 C.0.1-2 的基准。'],
        'validation': {'level': spec['validation']['level'], 'cases': spec['validation']['cases'], 'this_configuration': basis},
        'tier': {'tier': 'reference', **methods.TIERS['reference'], 'basis': basis},
    }


def apply_document(document, baseline):
    """The baseline current corrected to the conditions of `document`, the actual ones, in the form the method reads them.

    `baseline` is {current_a, ambient_c, soil_thermal_resistivity, depth_m, source, sha256, page?, kind?, confirmed}: the
    single-cable result it stands on and where to find it. `kind` is `manufacturer` for a saved or published value, or
    `gb_c012` for a value of GB 50217 table C.0.1-2 itself. The method refuses a baseline that a person has not confirmed.
    """
    if baseline.get('confirmed') is not True:
        raise CoreError('BASELINE_UNCONFIRMED', '基准载流量的条件须由工程师核对确认后才能校正。', '/baseline/confirmed')
    parameters = {
        'baseline_current_a': baseline['current_a'], 'baseline_ambient_k': baseline['ambient_c'] + 273.15,
        'baseline_soil_rho': baseline['soil_thermal_resistivity'], 'baseline_kind': baseline.get('kind', 'manufacturer'),
        'baseline_source': baseline['source'], 'baseline_sha256': baseline['sha256'], 'baseline_page': baseline.get('page', 1),
        'baseline_depth_m': baseline['depth_m'], 'baseline_reviewed': True, 'basis_release_digest': release_digest()}
    cases = [{'case_id': 'correction', 'input': document, 'parameters': parameters}]
    run = runner.run(PLUGIN, CAPABILITY, cases)
    case = run['cases'][0]
    if case['status'] != 'succeeded':
        error = case.get('error') or {}
        raise CoreError(error.get('code', 'CORRECTION_FAILED'), error.get('message', '校正没有给出结果。'), error.get('field') or error.get('path'))
    artifact = case['artifacts'][ARTIFACT]
    return {'kind': 'correction', 'plugin_id': run['plugin_id'], 'plugin_version': run['plugin_version'], 'capability': run['capability'],
            'method_version': run['method_version'], 'manifest_sha256': run['manifest_sha256'], 'request_sha256': run['request_sha256'],
            'core_run_id': run['run_id'], 'environment': run['environment'], 'request': {'cases': cases}, 'result': {'cases': run['cases']},
            'correction': artifact, 'method_card': card(run, artifact), 'document': document, 'parameters': parameters}


def apply(scene_input, baseline):
    """The same, for the actual conditions a project states: cable, laying and conditions composed into the document."""
    composed = scene.compose(scene_input.get('name') or '未命名工程', scene_input['cable'], scene_input['installation'], scene_input['conditions'])
    return apply_document(composed['document'], baseline)
