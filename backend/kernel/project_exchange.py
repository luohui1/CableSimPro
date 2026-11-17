"""Self-contained source proofs for portable, pinned project model inputs.

Candidate digests identify a complete CableModelVersion, while a study may bind
only its cable and used materials. Preserve both identities instead of replacing
the original digest with the smaller projection's hash. Imported references use
a detached identity and cannot resolve to a different machine's local model.
"""
from collections import Counter
from copy import deepcopy

from fastapi import HTTPException
from pydantic import ValidationError

from .candidates import CableModelVersion, read
from .workspace import fingerprint


SOURCE_SCHEMA = 'cablesim.exchange-cable-source/1'
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
    if (not isinstance(proof, dict)
            or set(proof) != {'schema', 'kind', 'origin_id', 'origin_state', 'payload'}
            or proof['schema'] != SOURCE_SCHEMA or proof['kind'] != 'candidate'
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
    # The UI summary joins references with Chinese semicolons. Canonical JSON
    # sorts source keys, so compare all text segments with multiplicity while
    # preserving both the original summary and the full source declarations.
    references = Counter(part for item in model.sources.values() for part in item.reference.split('；'))
    if Counter(binding['source'].split('；')) != references:
        fail('EXCHANGE_CABLE_SOURCE', '工程绑定的来源说明与原始型号来源声明不一致。')
    # Model-preparation studies retain the complete payload; ordinary candidate
    # studies contain its exact used-material projection. Neither is guessed.
    bound_digest = fingerprint(binding['payload'])
    if bound_digest not in (fingerprint(source), fingerprint(projection(source))):
        fail('EXCHANGE_CABLE_PROJECTION', '工程绑定结构与原始型号的电缆及材料投影不一致。')


def prepare_reference(db, inputs):
    """Add proof to an export copy; never mutate the source workspace or model."""
    binding = inputs.get('study_cable_reference')
    if binding is None:
        return
    if not isinstance(binding, dict):
        fail('EXCHANGE_CABLE_REFERENCE', '工程引用的型号快照不完整。')
    if binding.get('source_snapshot') is not None or not str(binding.get('id', '')).startswith('candidate:'):
        validate_reference(binding)
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
    binding['source_snapshot'] = {'schema': SOURCE_SCHEMA, 'kind': 'candidate',
        'origin_id': original_id, 'origin_state': binding.get('state'), 'payload': deepcopy(source)}
    binding['id'] = detached_id(original_id, binding['content_sha256'])
    binding['state'] = 'draft'
    validate_reference(binding)
