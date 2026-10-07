"""Ephemeral exploration through the normal sealed executor; no Run or Delivery writes."""
from copy import deepcopy
from dataclasses import asdict
from hashlib import sha256
from time import perf_counter

from fastapi import HTTPException
from pydantic import ValidationError
from backend.domain.models import DomainDocument
from .workspace import fingerprint


def preview(research, wid, sid, body, *, max_timeout_s=None):
    started = perf_counter()
    with research.store.db() as db:
        row, state = research.store.load(db, wid, body.expected_revision, allow_domain=True)
        study = research.definition(db, wid, sid, body.expected_study_revision)
        definition = research.module_definition(study['definition'], body.module)
    plugin, capability = research.resolve(definition['method'])
    if not capability.preview:
        raise HTTPException(422, {'code': 'PREVIEW_NOT_SUPPORTED', 'message': '此能力没有声明快速预览。'})
    if hasattr(research.executor, 'required') and research.executor.required(plugin.manifest.id, capability.id):
        raise HTTPException(422, {'code': 'PREVIEW_REMOTE_FORBIDDEN', 'message': '预览只允许本机快速能力，不提交远程作业。'})
    if definition['input_source'] == 'domain':
        if body.method_input is not None:
            raise HTTPException(422, '领域预览不能覆盖为另一份独立输入。')
        try:
            document = DomainDocument.model_validate(body.domain if body.domain is not None else state.get('domain')).model_dump(mode='json')
        except ValidationError as error:
            from cablesim_sdk.validation import validation_error
            raise HTTPException(422,validation_error(error,'DOMAIN_INVALID')) from None
    else:
        if body.domain is not None:
            raise HTTPException(422, '独立输入预览不能叠加领域草稿。')
        document = deepcopy(body.method_input if body.method_input is not None else definition['method_input'])
    parameters = deepcopy(body.parameters if body.parameters is not None else definition['parameters'])
    forbidden = {'source_bundle', 'source_metadata', 'external_loss_artifact', '_artifact_reuse_sha256'}
    if forbidden & parameters.keys():
        raise HTTPException(422, '来源正文只能由宿主绑定，不接受调用方注入。')
    case = {'case_id': 'preview', 'input': document, 'parameters': parameters}
    research.bind_loss_artifact(wid, case)
    research.bind_native_artifact(wid, case)
    local = getattr(research.executor, 'local', research.executor)
    timeout_s=capability.preview_timeout_s if max_timeout_s is None else min(capability.preview_timeout_s,max_timeout_s)
    if timeout_s<=0:
        raise HTTPException(429,{'code':'BUDGET_EXCEEDED','message':'快速预览已无剩余时间预算。'})
    result = local.run(plugin.manifest.id, capability.id, [case],
                       timeout_s=timeout_s, expected_manifest=plugin.manifest)
    cases = [asdict(value) for value in result.cases]
    statuses = {value['status'] for value in cases}
    snapshot = {'cases': [case], 'definition': definition,
                'headline_contract': [value.model_dump(mode='json') for value in capability.headlines]}
    snapshot['artifact_source_contracts']={fingerprint(definition['method']):{
        'manifest_sha256':sha256((plugin.directory/'plugin.json').read_bytes()).hexdigest(),
        'temperature_field_binding':capability.temperature_field_binding.model_dump(mode='json') if capability.temperature_field_binding else None}}
    output = {'cases': cases, 'run_id':result.run_id}
    statuses_by_artifact = research.artifact_status({'snapshot': snapshot, 'output': output})
    from .headlines import project
    return {'preview': True, 'engineering_approval': False, 'persisted': False,
            'status': 'succeeded' if statuses == {'succeeded'} else 'partial' if 'succeeded' in statuses else 'failed',
            'execution_id': result.run_id, 'method': definition['method'],
            'input_digest': fingerprint({'input': document, 'parameters': parameters}),
            'elapsed_ms': (perf_counter() - started) * 1000, 'cases': cases,
            'artifact_status': statuses_by_artifact, 'headlines': project(snapshot, output, statuses_by_artifact)}
