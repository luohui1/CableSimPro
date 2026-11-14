"""What a product specification answers on its own, without a laying: electrical parameters,
short-circuit capacity, and conformity with the product standard.

Each function runs a sealed method in a separate process. Methods that need limits or constants from a
standard author their queries in a first run; the basis library answers them; a second run uses the answers.
"""
import re

from . import CoreError, basis, runner, scene

ELECTRICAL = 'cablesim.type-electrical'
CHECK = 'cablesim.standard-check'


def document_of(cable):
    """A domain document for one product. The methods here read the cable type and its materials only."""
    return scene.compose(cable['name'], cable, scene.default_installation(cable), scene.default_conditions(cable))['document']


def _single(plugin, capability, document, parameters):
    run = runner.run(plugin, capability, [{'case_id': 'main', 'input': document, 'parameters': parameters}])
    case = run['cases'][0]
    if case['status'] != 'succeeded':
        error = case.get('error') or {}
        raise CoreError(error.get('code', 'METHOD_FAILED'), error.get('message', '方法没有给出结果。'), error.get('path'))
    identity = {key: run[key] for key in ('run_id', 'plugin_id', 'plugin_version', 'capability', 'method_version', 'manifest_sha256', 'request_sha256')}
    return identity, case


def _rows(artifact):
    return {row['id'].split(':', 1)[-1] if row['id'].startswith('common:') else row['id']: row for row in artifact['rows']}


def electrical(cable, values, sources):
    """AC resistance, capacitance, charging current, dielectric loss and geometric inductance of one product.

    `values` are the method's SI inputs (temperature_k, frequency_hz, ks, kp, spacing_m, arrangement,
    phase_voltage_v, r20_length_basis ...); `sources` says where each one comes from. A value without a
    source is not used by the method.
    """
    document = document_of(cable)
    parameters = {'cable_type_id': document['cable_types'][0]['id'], **values, 'sources': sources}
    identity, case = _single(ELECTRICAL, 'electrical', document, parameters)
    artifact = case['artifacts']['x-cablesim.type-electrical']
    return {'method': identity, 'rows': artifact['rows'], 'by_id': _rows(artifact), 'warnings': case['warnings']}


def short_circuit(cable, values, sources):
    """Permissible short-circuit current of the conductor and the metallic components (IEC 60949)."""
    document = document_of(cable)
    parameters = {'cable_type_id': document['cable_types'][0]['id'], **values, 'sources': sources}
    _, plan = _single(ELECTRICAL, 'short-circuit', document, {**parameters, 'basis_references': {}, 'parallel_components': []})
    references, missing = basis.resolve(plan['artifacts']['x-cablesim.type-short-circuit']['basis_queries'])
    identity, case = _single(ELECTRICAL, 'short-circuit', document, {**parameters, 'basis_references': references})
    artifact = case['artifacts']['x-cablesim.type-short-circuit']
    return {'method': identity, 'rows': artifact['rows'], 'by_id': _rows(artifact), 'basis_missing': missing, 'warnings': case['warnings']}


def _edition(text):
    return re.sub(r'\s+', '', text).replace('—', '-').replace(':', '-')


def standard_check(cable, standards):
    """Conformity of the structure with the declared product standards, requirement by requirement.

    `standards` are the editions the product declares, written as in the standard ("GB/T 12706.2-2020").
    Only requirements of declared editions are judged; the others are reported as not declared.
    """
    document = document_of(cable)
    cable_type_id = document['cable_types'][0]['id']
    declared = {_edition(item) for item in standards}
    bound = lambda query: _edition(query['standard'] + '-' + query['edition']) in declared
    _, plan = _single(CHECK, 'dimensions', document, {'cable_type_id': cable_type_id})
    artifact = plan['artifacts']['x-cablesim.standard-check']
    auxiliary = {}
    # Some limits depend on intermediate diameters the method computes in stages; it asks, the library answers, it asks again.
    for _ in range(24):
        if auxiliary:
            _, plan = _single(CHECK, 'dimensions', document, {'cable_type_id': cable_type_id, 'basis_references': auxiliary,
                                                              'basis_cable_sha256': artifact['basis_cable_sha256']})
            artifact = plan['artifacts']['x-cablesim.standard-check']
        pending = {key: query for key, query in artifact.get('basis_auxiliary_queries', {}).items() if bound(query) and key not in auxiliary}
        if not pending:
            break
        answered, absent = basis.resolve(pending)
        auxiliary.update(answered)
        auxiliary.update({item['key']: {'uncovered': True, 'query': item['query']} for item in absent})
    else:
        raise CoreError('BASIS_INCOMPLETE', '标准依据查询没有收敛，请核对型号条件。')
    plans = {row['id']: row['basis_query'] for row in artifact['rows'] if row.get('basis_query') and bound(row['basis_query'])}
    undeclared = sorted({row['basis_query']['standard'] + '—' + row['basis_query']['edition']
                         for row in artifact['rows'] if row.get('basis_query') and row['id'] not in plans})
    answered, missing = basis.resolve(plans)
    identity, case = _single(CHECK, 'dimensions', document, {'cable_type_id': cable_type_id, 'basis_references': {**auxiliary, **answered},
                                                             'basis_cable_sha256': artifact['basis_cable_sha256']})
    final = case['artifacts']['x-cablesim.standard-check']
    return {'method': identity, 'rows': final['rows'], 'by_id': {row['id']: row for row in final['rows']}, 'summary': {key: final.get(key) for key in ('status', 'headline', 'failed_count') if key in final},
            'basis_missing': missing, 'undeclared_standards': undeclared, 'warnings': case['warnings']}
