"""Explicit material-reference drafts and adoption through the existing Types store.

The source provider owns values. This module checks identities and applicability;
it does not supply material constants or elevate a reference to a measurement.
"""
from __future__ import annotations

from copy import deepcopy
import json
from math import isfinite
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException
from pydantic import Field, field_validator, model_validator

from backend.domain.guards import pointer
from backend.foundation.contracts import (
    AssetParameter, AssetRelease, Identifier, ReferenceEvidence, SourceReference, Version, content_hash,
)
from backend.schemas import StrictModel
from .resource_data import ResourceData, Selection
from .workspace import fingerprint


# Field and physical-quantity names only. Numerical values always come from the
# sealed lookup provider; unsupported quantities do not fall back to parameters.
PROPERTIES = {
    'density': ('mass_density', {'mass_density'}, '密度', 'kg/m³'),
    'volumetric_heat_capacity': ('volumetric_heat_capacity', {'volumetric_heat_capacity'}, '体积热容', 'J/(m³.K)'),
    'electrical_resistivity_20': ('resistivity', {'resistivity_20_ohm_m'}, '20 °C 电阻率', 'ohm.m'),
    'relative_permittivity': ('dimensionless', {'relative_permittivity'}, '相对介电常数', '1'),
    'thermal_resistivity': ('thermal_resistivity', {'thermal_resistivity', 'thermal_resistivity_k_m_w'}, '热阻率', 'K.m/W'),
}
MaterialProperty = Literal['density', 'volumetric_heat_capacity', 'electrical_resistivity_20',
                           'relative_permittivity', 'thermal_resistivity']


class MaterialSelection(StrictModel):
    parameter: MaterialProperty
    selection: Selection


class MaterialReferenceDraft(StrictModel):
    asset_id: Identifier
    version: Version
    name: str = Field(min_length=1, max_length=128)
    selections: list[MaterialSelection] = Field(min_length=1, max_length=5)

    @model_validator(mode='after')
    def unique_properties(self):
        if len({item.parameter for item in self.selections}) != len(self.selections):
            raise ValueError('同一物性只能选择一条明确的依据。')
        return self


class CreateMaterialReferenceDraft(MaterialReferenceDraft):
    preview_digest: str = Field(pattern=r'^[a-f0-9]{64}$')
    human_confirmed: Literal[True]

    @field_validator('human_confirmed', mode='before')
    @classmethod
    def human(cls, value):
        if value is not True:
            raise ValueError('须由人工明确确认资料草稿预览。')
        return value


class MaterialReferencePreview(StrictModel):
    workspace_id: UUID
    expected_revision: int = Field(ge=1, strict=True)
    material_id: str = Field(pattern=r'^material/[A-Za-z0-9_-]+$')
    property: MaterialProperty
    resource_id: UUID
    content_sha256: str = Field(pattern=r'^[a-f0-9]{64}$')


class AdoptMaterialReference(MaterialReferencePreview):
    request_id: UUID
    operation: Literal['adopt_resource_material_value'] = 'adopt_resource_material_value'
    preview_digest: str = Field(pattern=r'^[a-f0-9]{64}$')
    human_confirmed: Literal[True]
    acknowledge_reference_limits: Literal[True]

    @field_validator('human_confirmed', 'acknowledge_reference_limits', mode='before')
    @classmethod
    def explicit_confirmation(cls, value):
        if value is not True:
            raise ValueError('须由人工明确确认采用及资料参考限制。')
        return value


def reference_source(evidence: ReferenceEvidence) -> SourceReference:
    record = evidence.receipt['record']
    return SourceReference(
        kind='literature' if record['semantic'].startswith('literature') else 'standard',
        reviewed=False,
        reference=(record['citation'] + '; source_sha256:' + record['source_sha256']
                   + '; record_sha256:' + evidence.record_sha256),
    )


def preview_material_draft(service: ResourceData, body: MaterialReferenceDraft):
    evidence = []
    for item in body.selections:
        dimension, keys, _, _ = PROPERTIES[item.parameter]
        if item.selection.quantity not in keys:
            raise HTTPException(422, {'code': 'RESOURCE_QUANTITY_MISMATCH',
                'message': '所选原文物理量不能作为此材料物性；不按数值或单位猜测。'})
        evidence.append(service.evidence(item.selection, item.parameter, dimension))
    definition = AssetRelease(
        asset_id=body.asset_id, version=body.version, name=body.name.strip(), kind='material',
        parameters=tuple(AssetParameter(name=e.parameter, quantity=e.quantity) for e in evidence),
        sources=tuple(reference_source(e) for e in evidence), reference_evidence=tuple(evidence),
    )
    payload = {'schema_version': 'cablesim.material-reference-draft/1',
        'release': definition.model_dump(mode='json'), 'content_sha256': content_hash(definition),
        'approval': 'not_granted', 'applied_to_workspace': False, 'persisted': False}
    return {**payload, 'preview_digest': fingerprint(payload)}


def create_material_draft(service: ResourceData, assets, body: CreateMaterialReferenceDraft):
    preview = preview_material_draft(service, body)
    if preview['preview_digest'] != body.preview_digest:
        raise HTTPException(409, {'code': 'RESOURCE_DRAFT_PREVIEW_CHANGED',
            'message': '资料草稿预览已变化，请重新核对来源和数值。'})
    return assets.create(AssetRelease.model_validate(preview['release']),
                         '人工核对固定封签依据后创建材料参考草稿；尚未审核、发布或采用。')


def _identity(document, material):
    """Only explicit saved composition facts; never infer from the display name."""
    index = document['materials'].index(material)
    provenance = document.get('provenance', {})
    source = provenance.get(pointer('materials', material['id'])) or provenance.get('/materials/'+str(index), {})
    try:
        value = json.loads(source.get('reference') or '{}')
    except (TypeError, ValueError):
        value = {}
    return source, value if isinstance(value, dict) else {}


def _material_facts(document, material, property):
    cables = document.get('cable_types', [])
    if len(cables) != 1:
        return {}, '需明确一个型号的实际结构，不能跨型号推断材料用途。'
    cable = cables[0]
    uses = [dict(core['conductor'], role='conductor') for core in cable['cores']]
    uses += [layer for core in cable['cores'] for layer in core['layers']]
    uses += cable['common_layers']
    roles = {layer['role'] for layer in uses if layer['material'] == material['id']}
    if not roles:
        return {}, '材料已不用于当前结构。'
    if len(roles) != 1:
        return {}, '同一材料同时用于导体、屏蔽或其他层；请先按真实用途拆分，不能共用参考物性。'
    role = next(iter(roles))
    source, identity = _identity(document, material)
    kind = material.get('standard_kind')
    if not kind and source.get('reviewed') is True:
        kind = {'material/copper-conductor': 'copper_bare', 'material/aluminium-conductor': 'aluminium',
                'material/xlpe-mv': 'XLPE', 'material/xlpe-hv': 'XLPE',
                'material/xlpe-filled-hv': 'XLPE'}.get(identity.get('asset_id'))
    categories = {'conductor': 'conductor', 'insulation': 'insulation'}
    if role not in categories or material.get('category') != categories[role]:
        return {}, '当前参考采用只核对用途明确的导体或绝缘；其余材料需补齐独立模型条件。'
    names = {'copper_bare': 'copper', 'copper_coated': 'copper', 'aluminium': 'aluminium',
             'XLPE': 'xlpe', 'PVC': 'pvc', 'EPR': 'epr', 'HEPR': 'hepr'}
    if kind not in names:
        return {}, '型号没有已声明的材料组成类别；名称或绑定操作不能补齐此事实。'
    facts = {'material': names[kind], 'material_role': role, 'insulation': kind if role == 'insulation' else None}
    rating = cable.get('rating', {})
    facts.update({key: rating.get(field) for key, field in (('u0_v', 'u0'), ('u_v', 'u'), ('um_v', 'um'))})
    if property == 'electrical_resistivity_20':
        # The target field itself is explicitly defined at 20 °C.
        facts['reference_temperature_k'] = 293.15
    if source.get('reviewed') is True:
        formulations = {'material/xlpe-mv': 'unfilled', 'material/xlpe-hv': 'unfilled',
                        'material/xlpe-filled-hv': 'filled'}
        if identity.get('asset_id') in formulations:
            facts['filler'] = formulations[identity['asset_id']]
    circuits = document.get('circuits', [])
    if circuits and all(c.get('system', {}).get('kind') in ('ac_three_phase', 'ac_single_phase')
                        and type(c.get('system', {}).get('frequency')) in (int, float)
                        and c['system']['frequency'] > 0 for c in circuits):
        facts['current_system'] = 'AC'
    # A source choice is not a material temperature declaration. Read an already
    # saved, reviewed applicability fact; this API has no "confirm missing fact"
    # switch. A changed rated limit invalidates that previous declaration.
    condition_source = document.get('provenance', {}).get(pointer('materials', material['id'], 'applicability'), {})
    try:
        applicability = json.loads(condition_source.get('reference') or '{}')
    except (TypeError, ValueError):
        applicability = {}
    if (isinstance(applicability, dict) and condition_source.get('reviewed') is True
            and applicability.get('schema') == 'cablesim.material-applicability/1'
            and applicability.get('material_id') == material['id']
            and applicability.get('temperature_basis') == 'maximum_permissible'
            and type(applicability.get('temperature_k')) in (int, float)
            and applicability['temperature_k'] == rating.get('max_conductor_temperature', {}).get('normal')):
        facts['temperature_basis'] = 'maximum_permissible'
    return facts, None


def condition_checks(document, material, evidence: ReferenceEvidence):
    facts, basic_reason = _material_facts(document, material, evidence.parameter)
    selected = evidence.selection['conditions']
    checks = []
    for key, value in selected.items():
        actual = facts.get(key)
        equal = actual == value and type(actual) is type(value)
        if type(actual) in (int, float) and type(value) in (int, float):
            equal = actual == value
        if key == 'material' and isinstance(actual, str) and isinstance(value, str):
            equal = actual.casefold() == value.casefold()
        reason = ('型号没有此条件的明确事实。' if actual is None else
                  '型号事实与选择的条件不一致。') if not equal else ''
        checks.append({'condition': key, 'required': evidence.receipt['record']['conditions'].get(key),
                       'selected': value, 'actual': actual, 'status': 'matched' if equal else 'unconfirmed',
                       'reason': reason})
    reason = basic_reason or next((f"{c['condition']}：{c['reason']}" for c in checks if c['status'] != 'matched'), None)
    return checks, reason


def evidence_rows(document, material, resource):
    """Saved comparison uses frozen receipts, never today's provider contents."""
    rows = {}
    provenance = document.get('provenance', {})
    for raw in resource['release'].get('reference_evidence', []):
        evidence = ReferenceEvidence.model_validate(raw)
        prop = evidence.parameter
        if prop not in PROPERTIES:
            continue
        _, keys, label, unit = PROPERTIES[prop]
        checks, reason = condition_checks(document, material, evidence)
        if evidence.selection['quantity'] not in keys:
            reason = '原文物理量与目标材料物性不同。'
        path = pointer('materials', material['id'], prop)
        record = evidence.receipt['record']
        reference = {'schema': 'cablesim.reference-data/1', 'property': prop,
            'value': evidence.quantity.value, 'unit': unit,
            'standard': record['standard']+'—'+record['edition'], 'table': record['table'] or record['clause'],
            'printed_page': record['printed_page'], 'pdf_page': record['pdf_page'],
            'source_digest': record['source_sha256'], 'condition': record['row_label'],
            'basis': record['semantic'], 'citation': record['citation'],
            'trust': evidence.receipt['trust'], 'limitations': record['limitations'],
            'method': evidence.receipt['method'], 'resource_reference': evidence.model_dump(mode='json')}
        actual = material.get(prop)
        status = 'condition_mismatch' if reason else 'design_missing' if actual is None else (
            'same' if actual == reference['value'] else 'different')
        delta = actual-reference['value'] if not reason and actual is not None else None
        percent = delta/reference['value']*100 if delta is not None and reference['value'] else None
        if delta is not None and not isfinite(delta) or percent is not None and not isfinite(percent):
            reason = '差值超出有限数值范围，请核对型号输入单位。'
            delta, percent = None, None
        index = document['materials'].index(material)
        source = next((provenance[p] for p in (path, '/materials/'+str(index)+'/'+prop,
                       pointer('materials', material['id']), '/materials/'+str(index)) if p in provenance),
                      {'kind': 'unknown', 'reference': '型号未记录该物性出处。'})
        rows[prop] = {'id': prop, 'label': label, 'unit': unit, 'path': path, 'actual': actual,
            'reference': reference if not reason else None, 'reference_candidates': [reference],
            'status': status, 'reason': reason or ('型号未给此项。' if actual is None else ''),
            'delta': delta, 'percent': percent, 'design_source': source, 'condition_checks': checks,
            'adoptable': not reason and status in ('different', 'design_missing')}
    return rows


def preview_material_reference(types, service, db, row, state, body):
    wid = str(body.workspace_id)
    pin = state.get('type_resource_bindings', {}).get('material', {}).get(body.material_id)
    if not pin or pin['resource_id'] != str(body.resource_id) or pin['content_sha256'] != body.content_sha256:
        raise HTTPException(409, {'code': 'MATERIAL_REFERENCE_BINDING_CHANGED',
            'message': '请先绑定并核对固定材料版本；绑定本身不改变任何物性。'})
    resource = types.assets._detail(db, types.assets._load(db, pin['resource_id']))
    if (resource['kind'] != 'material' or resource['status'] != 'published' or resource['issues']
            or any(resource[k] != pin[k] for k in ('asset_id', 'version', 'content_sha256'))):
        raise HTTPException(409, {'code': 'MATERIAL_REFERENCE_NOT_PUBLISHED', 'message': '该材料版本不能新引用。'})
    material = next((m for m in state['domain']['materials'] if m['id'] == body.material_id), None)
    raw = next((e for e in resource['release'].get('reference_evidence', []) if e['parameter'] == body.property), None)
    if material is None or raw is None:
        raise HTTPException(422, {'code': 'MATERIAL_REFERENCE_MISSING', 'message': '材料或逐属性资料回执缺失，不能采用。'})
    evidence = service.verify_evidence(ReferenceEvidence.model_validate(raw))
    item = evidence_rows(state['domain'], material, resource)[body.property]
    payload = {'schema_version': 'cablesim.material-reference-preview/1', 'workspace_id': wid,
        'revision': row['revision'], 'document_sha256': fingerprint(state['domain']),
        'material_id': body.material_id, 'material_name': material['label'], 'property': body.property,
        'resource': deepcopy(pin), 'evidence': evidence.model_dump(mode='json'), 'comparison': item,
        'adoptable': item['adoptable'], 'reason': item['reason'], 'approval': 'not_granted',
        'applied_to_workspace': False,
        'limitations': ['采用仅把所选参考值写入新输入修订；不表示厂家实测、检验合格或工程批准。',
                        *evidence.receipt['record']['limitations']]}
    return {**payload, 'preview_digest': fingerprint(payload)}


def verify_material_adoption(types, db, row, state, body):
    """Called inside the same CAS transaction as Types.adopt_material_value."""
    if (not isinstance(body, AdoptMaterialReference) or body.human_confirmed is not True
            or body.acknowledge_reference_limits is not True):
        raise HTTPException(422, {'code': 'MATERIAL_REFERENCE_PREVIEW_REQUIRED',
            'message': '资料参考值须先查看固定版本、条件和限制，再由人工明确采用。'})
    preview = preview_material_reference(types, ResourceData(types.research.executor), db, row, state, body)
    if preview['preview_digest'] != body.preview_digest:
        raise HTTPException(409, {'code': 'MATERIAL_REFERENCE_PREVIEW_CHANGED',
            'message': '输入、资源或预览已变化，请重新核对。'})
    if not preview['adoptable']:
        raise HTTPException(422, {'code': 'MATERIAL_REFERENCE_NOT_APPLICABLE', 'message': preview['reason']})


def make_router(service: ResourceData, assets, types):
    router = APIRouter(prefix='/materials')

    @router.post('/draft-preview')
    def draft_preview(body: MaterialReferenceDraft):
        return preview_material_draft(service, body)

    @router.post('/draft', status_code=201)
    def draft(body: CreateMaterialReferenceDraft, x_cablesim_actor: str | None = Header(default=None)):
        if x_cablesim_actor != 'human':
            raise HTTPException(403, {'code': 'HUMAN_RESOURCE_DRAFT_REQUIRED',
                'message': 'Agent 可预览资料提案，创建本地草稿须由人工确认。'})
        return create_material_draft(service, assets, body)

    @router.post('/preview')
    def preview(body: MaterialReferencePreview):
        with types.store.db() as db:
            row, state = types._type(db, str(body.workspace_id), body.expected_revision)
            return preview_material_reference(types, service, db, row, state, body)

    @router.post('/adopt')
    def adopt(body: AdoptMaterialReference, x_cablesim_actor: str | None = Header(default=None)):
        if x_cablesim_actor != 'human':
            raise HTTPException(403, {'code': 'HUMAN_MATERIAL_ADOPTION_REQUIRED',
                'message': 'Agent 只能提出和预览参考值，采用须由人工操作。'})
        return types.adopt_material_value(str(body.workspace_id), body)

    return router
