"""Self-contained source proofs for portable, pinned project model inputs.

Candidate digests identify a complete CableModelVersion, while a study may bind
only its cable and used materials. Preserve both identities instead of replacing
the original digest with the smaller projection's hash. Imported references use
a detached identity and cannot resolve to a different machine's local model.
"""
from copy import deepcopy

from fastapi import HTTPException
from pydantic import ValidationError

from .candidates import CableModelVersion, read
from .workspace import fingerprint


SOURCE_SCHEMA = 'cablesim.exchange-cable-source/2'
LEGACY_SOURCE_SCHEMA = 'cablesim.exchange-cable-source/1'
MAX_LEGACY_SOURCE_STATES = 4096
DETACHED_PREFIX = 'exchange-model:'


def fail(code, message):
    raise HTTPException(422, {'code': code, 'message': message})


def detached_id(origin_id, digest):
    return DETACHED_PREFIX + fingerprint({'origin_id': origin_id, 'content_sha256': digest})


def projection(payload):
    cable = payload['cable_type']
    used = ({core['conductor']['material'] for core in cable['cores']}
            | {layer['material'] for layer in cable['common_layers']}
            | {layer['material'] for core in cable['cores'] for layer in core['layers']})
    return {'cable_type': cable, 'materials': [material for material in payload['materials']
                                             if material['id'] in used]}


def source_reference_order(text, sources, declared=None):
    """Match whole references; a semicolon inside a reference is not a boundary.

    New proofs carry ordered source keys, independent of JSON object ordering.
    Old proofs require an exact multiset concatenation. Prefix matching visits
    bounded, memoized states rather than enumerating all source permutations.
    """
    keys = list(sources)
    if declared is not None:
        if (not isinstance(declared, list) or len(declared) != len(keys)
                or any(not isinstance(key, str) for key in declared)
                or set(declared) != set(keys)):
            fail('EXCHANGE_CABLE_SOURCE', '来源顺序证明须完整列出原始来源键，不能缺项或重复。')
        if text != '；'.join(sources[key]['reference'] for key in declared):
            fail('EXCHANGE_CABLE_SOURCE', '工程绑定的来源说明与原始型号的完整来源声明不一致。')
        return list(declared)
    if text == '；'.join(sources[key]['reference'] for key in keys):
        return keys
    groups = {}
    for key in keys:
        groups.setdefault(sources[key]['reference'], []).append(key)
    references = list(groups)
    counts = tuple(len(groups[reference]) for reference in references)
    if len(text) != sum(len(reference) * count for reference, count in zip(references, counts)) + len(keys) - 1:
        fail('EXCHANGE_CABLE_SOURCE', '工程绑定的来源说明与原始型号的完整来源声明不一致。')
    stack, seen = [(0, counts, ())], {(0, counts)}
    while stack:
        offset, remaining, sequence = stack.pop()
        if not any(remaining):
            if offset == len(text):
                used = [0] * len(references)
                result = []
                for index in sequence:
                    result.append(groups[references[index]][used[index]])
                    used[index] += 1
                return result
            continue
        for index, reference in enumerate(references):
            if not remaining[index] or not text.startswith(reference, offset):
                continue
            end = offset + len(reference)
            if end < len(text) and text[end] != '；':
                continue
            next_counts = list(remaining)
            next_counts[index] -= 1
            state = (end + 1 if end < len(text) else end, tuple(next_counts))
            if state in seen:
                continue
            if len(seen) >= MAX_LEGACY_SOURCE_STATES:
                fail('EXCHANGE_CABLE_SOURCE_ORDER_LIMIT',
                     '旧交换包的来源串联过于复杂，未猜测引用顺序；请从来源工程重新导出带顺序证明的交换包。')
            seen.add(state)
            stack.append((*state, (*sequence, index)))
    fail('EXCHANGE_CABLE_SOURCE', '工程绑定的来源说明与原始型号的完整来源声明不一致。')


def validate_reference(binding):
    if (not isinstance(binding, dict) or not isinstance(binding.get('payload'), dict)
            or not all(isinstance(binding.get(key), str) and binding[key]
                       for key in ('id', 'version', 'name', 'source', 'content_sha256', 'bound_cable_type_id'))
            or not isinstance(binding['payload'].get('cable_type'), dict)
            or not isinstance(binding['payload'].get('materials'), list)
            or not isinstance(binding.get('locks'), list)
            or any(not isinstance(path, str) for path in binding['locks'])
            or not isinstance(binding.get('method_defaults'), dict)):
        fail('EXCHANGE_CABLE_REFERENCE', '工程引用的型号快照不完整。')
    # A system-looking ID or a candidate proof cannot certify a published model.
    if binding['source'] == 'published_type' or binding['id'].startswith('type/'):
        fail('EXCHANGE_PUBLISHED_MODEL_PROOF',
             '已发布型号引用需要完整发行与冻结规格书证明链；当前输入交换不覆盖，请使用数据库备份恢复。')
    proof = binding.get('source_snapshot')
    if proof is None:
        if binding['id'].startswith('system.'):
            from .scenarios import system_models
            original = next((item for item in system_models() if item['id'] == binding['id']), None)
            # A self-hash proves no catalogue identity. Compare the original raw
            # snapshot, including omitted optional fields, without upgrading it.
            fields = ('id', 'version', 'name', 'state', 'source', 'content_sha256', 'payload', 'method_defaults')
            if (original is None or binding['content_sha256'] != fingerprint(binding['payload'])
                    or fingerprint({key: binding.get(key) for key in fields})
                    != fingerprint({key: original[key] for key in fields})):
                fail('EXCHANGE_SYSTEM_MODEL_PROOF',
                     '系统型号身份、来源或内容与本机固定目录不一致；无法核验该版本，未替换为新版。')
            return
        fail('EXCHANGE_CABLE_SOURCE', '工程引用缺少完整的原始型号来源快照，请从来源机器重新导出。')
    proof_fields = {'schema', 'kind', 'origin_id', 'origin_state', 'payload'}
    if (not isinstance(proof, dict)
            or not (proof.get('schema') == LEGACY_SOURCE_SCHEMA and set(proof) == proof_fields
                    or proof.get('schema') == SOURCE_SCHEMA and set(proof) == proof_fields | {'source_reference_order'}
                    and isinstance(proof['source_reference_order'], list))
            or proof['kind'] != 'candidate'
            or not isinstance(proof['origin_id'], str) or not proof['origin_id'].startswith('candidate:')
            or not 10 < len(proof['origin_id']) <= 138
            or not isinstance(proof['origin_state'], str) or not 1 <= len(proof['origin_state']) <= 64
            or not isinstance(proof['payload'], dict)):
        fail('EXCHANGE_CABLE_SOURCE', '型号来源快照格式无效。')
    source = proof['payload']
    try:
        model = CableModelVersion.model_validate(source)
    except ValidationError:
        fail('EXCHANGE_CABLE_SOURCE', '型号来源快照不是完整有效的型号版本。')
    if model.cable_type is None:
        fail('EXCHANGE_CABLE_SOURCE', '缺项型号不能冒充工程中已绑定的完整结构。')
    if (binding['content_sha256'] != fingerprint(source)
            or (binding['name'], binding['version']) != (source['name'], source['version'])):
        fail('EXCHANGE_CABLE_SOURCE_DIGEST', '型号来源版本、名称或原始内容摘要不一致。')
    if (binding['id'] != detached_id(proof['origin_id'], binding['content_sha256'])
            or binding.get('state') != 'draft'):
        fail('EXCHANGE_CABLE_IDENTITY', '搬运型号须使用独立快照身份，不能绑定本机型号或继承来源方审批。')
    order = source_reference_order(binding['source'], source['sources'], proof.get('source_reference_order'))
    # Model-preparation studies retain the complete payload; ordinary candidate
    # studies contain its exact used-material projection. Neither is guessed.
    bound_digest = fingerprint(binding['payload'])
    if bound_digest not in (fingerprint(source), fingerprint(projection(source))):
        fail('EXCHANGE_CABLE_PROJECTION', '工程绑定结构与原始型号的电缆及材料投影不一致。')
    return order


def prepare_reference(db, inputs):
    """Add proof to an export copy; never mutate the source workspace or model."""
    binding = inputs.get('study_cable_reference')
    if binding is None:
        return
    if not isinstance(binding, dict):
        fail('EXCHANGE_CABLE_REFERENCE', '工程引用的型号快照不完整。')
    if binding.get('source_snapshot') is not None or not str(binding.get('id', '')).startswith('candidate:'):
        order = validate_reference(binding)
        if order is not None:
            binding['source_snapshot'].update(schema=SOURCE_SCHEMA, source_reference_order=order)
        return
    original_id = binding['id']
    payload = binding.get('payload')
    # A completed engineering model already contains a self-contained immutable
    # source; it must not be replaced by the incomplete candidate on this machine.
    if (isinstance(payload, dict) and {'name', 'version', 'sources'} <= set(payload)
            and fingerprint(payload) == binding.get('content_sha256')):
        source = payload
    else:
        try:
            item = read(db, original_id.removeprefix('candidate:'))
        except (HTTPException, ValueError):
            fail('EXCHANGE_CABLE_SOURCE', '原始型号版本缺失或摘要损坏；不能导出缺少来源证明的工程。')
        if item['digest'] != binding.get('content_sha256'):
            fail('EXCHANGE_CABLE_SOURCE_DIGEST', '工程绑定的原始型号摘要与来源库不同；未改用其他版本。')
        source = item['payload']
    # Validate the binding and complete source before reading their references.
    # The temporary /1 proof derives an order only after those checks succeed.
    binding['source_snapshot'] = {'schema': LEGACY_SOURCE_SCHEMA, 'kind': 'candidate',
        'origin_id': original_id, 'origin_state': binding.get('state'), 'payload': deepcopy(source)}
    binding['id'] = detached_id(original_id, binding['content_sha256'])
    binding['state'] = 'draft'
    order = validate_reference(binding)
    binding['source_snapshot'].update(schema=SOURCE_SCHEMA, source_reference_order=order)
