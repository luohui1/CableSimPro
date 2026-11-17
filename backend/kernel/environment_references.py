"""Explicit environment references for the existing saved rating conditions.

The asset repository owns versions and publication. The data plugin owns every
number. This module only maps three named fields and freezes their evidence in
ordinary Research batch cases; it neither supplies missing conditions nor adds
a calculation method or a second environment store.
"""
from copy import deepcopy
import json
from math import isfinite
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException
from pydantic import Field, JsonValue, field_validator, model_validator

from backend.domain.guards import pointer
from backend.foundation.contracts import (
    AssetParameter, AssetRelease, Digest, Identifier, ReferenceEvidence, SourceReference, Version,
)
from backend.schemas import StrictModel
from .rating_conditions import RatingRow
from .resource_data import Selection
from .workspace import fingerprint


Parameter = Literal['depth_m', 'soil_rho_k_m_w', 'ambient_temperature_c']
TARGETS = {
    'laying_depth': ('depth_m', 'length'),
    'thermal_resistivity': ('soil_rho_k_m_w', 'thermal_resistivity'),
    'soil_thermal_resistivity': ('soil_rho_k_m_w', 'thermal_resistivity'),
    **{name: ('ambient_temperature_c', 'absolute_temperature') for name in (
        'ground_temperature_summer', 'ground_temperature_winter', 'ground_min_c', 'ground_max_c',
        'air_temperature_maximum', 'air_temperature_minimum', 'air_min_c', 'air_max_c')},
}
TABLES = ('iec60287-3-1-table1/', 'iec60287-3-1-table2/', 'iec60287-3-1-annex-a4/')
ROW_FIELDS = {'case_id', 'name', 'layout', 'depth_m', 'soil_rho_k_m_w',
              'ambient_temperature_c', 'frequency_hz', 'bonding', 'source'}
CONDITION_NAMES = {
    'country': '国家参考范围', 'u_v': '系统线电压', 'national_reference': '国家参考资料可用性',
    'soil_moisture': '土壤湿度状态', 'weather_pattern': '天气条件', 'climate': '气候类型',
    'elevation_basis': '海拔基准', 'burial_depth_m': '地温对应埋深',
}


def fail(code, message, status=422):
    raise HTTPException(status, {'code': code, 'message': message})


class EnvironmentDraftPreview(StrictModel):
    asset_id: Identifier
    version: Version
    name: str = Field(min_length=1, max_length=128)
    selections: list[Selection] = Field(min_length=1, max_length=3)

    @field_validator('name')
    @classmethod
    def named(cls, value):
        if not value.strip():
            raise ValueError('请填写敷设资料名称。')
        return value.strip()


class EnvironmentDraft(EnvironmentDraftPreview):
    preview_digest: Digest
    human_confirmed: Literal[True]

    @field_validator('human_confirmed', mode='before')
    @classmethod
    def human(cls, value):
        if value is not True:
            raise ValueError('须由人工确认预览后创建资料草稿。')
        return value


class EnvironmentPin(StrictModel):
    resource_id: UUID
    content_sha256: Digest
    parameter: Parameter


class EnvironmentPreview(StrictModel):
    workspace_id: UUID
    expected_revision: int = Field(ge=1, strict=True)
    row: RatingRow
    resources: list[EnvironmentPin] = Field(min_length=1, max_length=3)
    conditions: dict[str, JsonValue] = Field(max_length=100)

    @field_validator('row', mode='before')
    @classmethod
    def explicit_row(cls, value):
        data = value.model_dump() if isinstance(value, RatingRow) else value
        if not isinstance(data, dict) or not ROW_FIELDS <= set(data):
            raise ValueError('须明确填写完整工况；环境参考不补埋深、热阻率、温度、频率或接地默认值。')
        if data.get('layout') in ('flat', 'three_core_buried_horizontal') and data.get('spacing_m') is None:
            raise ValueError('水平排列须明确中心距。')
        if data.get('layout') in ('ducts', 'three_core_ducts_horizontal') and not {
                'duct_inner_m', 'duct_outer_m', 'duct_rho_k_m_w'} <= set(data):
            raise ValueError('排管工况须明确管内径、外径和管材热阻率。')
        return value

    @model_validator(mode='after')
    def unique_fields(self):
        if len({pin.parameter for pin in self.resources}) != len(self.resources):
            raise ValueError('同一工况字段只能选一个固定版本的参考。')
        json.dumps(self.conditions, allow_nan=False)
        return self


class EnvironmentAdoption(EnvironmentPreview):
    preview_digest: Digest
    human_confirmed: Literal[True]

    @field_validator('human_confirmed', mode='before')
    @classmethod
    def human(cls, value):
        if value is not True:
            raise ValueError('须由人工确认预览后采用环境参考。')
        return value


def target(selection):
    selected = Selection.model_validate(selection)
    mapped = TARGETS.get(selected.quantity)
    if not mapped or not selected.record_id.startswith(TABLES):
        fail('ENVIRONMENT_REFERENCE_UNSUPPORTED', '此记录不能映射到埋深、土壤热阻率或环境温度；不自动代换其他参数。')
    return mapped


def draft_preview(service, body):
    evidence = []
    for selection in body.selections:
        parameter, dimension = target(selection)
        evidence.append(service.evidence(selection, parameter, dimension))
    if len({entry.parameter for entry in evidence}) != len(evidence):
        fail('ENVIRONMENT_REFERENCE_DUPLICATE', '同一敷设资料中，每个参数只能有一条明确参考。')
    release = AssetRelease(
        asset_id=body.asset_id, version=body.version, kind='installation',
        name=body.name,
        parameters=tuple(AssetParameter(name=entry.parameter, quantity=entry.quantity) for entry in evidence),
        reference_evidence=tuple(evidence),
        sources=tuple(SourceReference(kind='standard', reviewed=False,
            reference=entry.receipt['record']['citation']) for entry in evidence),
    )
    definition = release.model_dump(mode='json')
    result = {'release': definition, 'content_sha256': release.reference().content_sha256,
        'trust': {'grade': 'reference', 'label': '参考'}, 'approval': 'not_granted',
        'applied_to_workspace': False}
    return {**result, 'preview_digest': fingerprint(result)}


def _published(service, assets, pin):
    asset = assets.get(str(pin.resource_id))
    if asset['kind'] != 'installation' or asset['status'] != 'published':
        fail('ENVIRONMENT_ASSET_NOT_PUBLISHED', '新工况只能采用已核对并发布的敷设资料；发布不等于工程批准。')
    if asset['content_sha256'] != pin.content_sha256:
        fail('ENVIRONMENT_ASSET_CHANGED', '敷设资料内容已变化，请重新查看固定版本后预览。', 409)
    release = AssetRelease.model_validate(asset['release'])
    evidence = next((entry for entry in release.reference_evidence if entry.parameter == pin.parameter), None)
    parameter = next((entry for entry in release.parameters if entry.name == pin.parameter), None)
    if evidence is None or parameter is None or evidence.quantity != parameter.quantity.si():
        fail('ENVIRONMENT_EVIDENCE_MISSING', '该参数缺少完整、相符的原始参考回执，不能采用。')
    expected, dimension = target(evidence.selection)
    if expected != pin.parameter or evidence.quantity.dimension != dimension:
        fail('ENVIRONMENT_PARAMETER_MISMATCH', '参考量与目标工况字段不相符。')
    service.verify_evidence(evidence)
    return asset, evidence


def _applicable(evidence, conditions, row):
    selected = evidence.selection['conditions']
    for key, value in selected.items():
        # A row label is already fixed by the selected record identity, not an
        # independent site fact. Different fields in one asset have different
        # labels; all physical/context conditions still need explicit values.
        if key == 'reference_item':
            continue
        if key not in conditions or type(conditions[key]) is bool or conditions[key] != value:
            label = CONDITION_NAMES.get(key, '适用条件')
            fail('ENVIRONMENT_CONDITION_MISMATCH', f'当前工况的{label}须明确填写并与参考相符；不能用额定值、范围或空白代替实际条件。')
    key = evidence.selection['quantity']
    air = row.layout == 'air'
    if (key.startswith('air_') and not air) or (not key.startswith('air_') and air):
        fail('ENVIRONMENT_MEDIUM_MISMATCH', '空气与地中参考不能互相采用；请核对敷设介质。')
    if key == 'laying_depth':
        # The exposed Annex A.4 records do not state a measurement datum.
        # RatingRow.depth_m is an axis/centre depth for both cables and ducts;
        # neither the general scope nor a user assertion proves that mapping.
        fail('ENVIRONMENT_DEPTH_REFERENCE_UNSUPPORTED', '原文未明确埋深的测量基准，不能直接作为电缆或管道中心埋深采用；可保留参考资料，须补充明确依据。')
    if 'burial_depth_m' in selected and row.depth_m != selected['burial_depth_m']:
        fail('ENVIRONMENT_DEPTH_MISMATCH', '原表地温只适用于所注明埋深；当前工况埋深不同。')
    if evidence.parameter == 'ambient_temperature_c' and conditions.get('temperature_basis') != key:
        fail('ENVIRONMENT_TEMPERATURE_BASIS_REQUIRED', '须明确选择最高、最低或季节温度口径，不能把参考边界当作现场温度。')


def _system_facts(document, row, conditions, *, require_voltage):
    """Use saved engineering facts, never a matching claim sent by the client."""
    cable = document['cable_types'][0]
    circuits = [item for item in document.get('circuits', []) if item['cable_type'] == cable['id']]
    if len(circuits) > 1:
        fail('ENVIRONMENT_SYSTEM_CONTEXT_AMBIGUOUS', '该型号保存了多个运行回路，请先明确唯一的目标系统工况；不能自动采用第一个回路。')
    if not circuits or circuits[0].get('system', {}).get('kind') not in ('ac_three_phase', 'ac_single_phase'):
        fail('ENVIRONMENT_SYSTEM_CONTEXT_MISSING', '请先在型号中明确保存交流研究工况及来源；结构查看的直流占位不表示运行条件。')
    circuit = circuits[0]
    result = {}
    for key in ('frequency', 'voltage') if require_voltage else ('frequency',):
        value = circuit['system'].get(key)
        path = pointer('circuits', circuit['id'], 'system', key)
        source = document.get('provenance', {}).get(path, {})
        if (type(value) not in (int, float) or not isfinite(value) or value <= 0
                or not isinstance(source.get('reference'), str) or not source['reference'].strip()):
            fail('ENVIRONMENT_SYSTEM_FACT_MISSING', f'请先保存有明确来源的系统{ "线电压" if key == "voltage" else "频率" }；不从型号额定值推断。')
        requested = conditions.get('u_v') if key == 'voltage' else row.frequency_hz
        if type(requested) not in (int, float) or requested != value:
            fail('ENVIRONMENT_SYSTEM_FACT_CONFLICT', '所填参考条件与型号中已保存的系统电压或频率不同，请先核对工况修订。')
        result[key] = {'value': value, 'path': path, 'source': deepcopy(source)}
    return result


def _rated_voltage(service, document, evidence):
    if 'u_v' not in evidence.selection['conditions']:
        return None
    cable = document['cable_types'][0]
    voltage = cable.get('rating', {}).get('u')
    if type(voltage) not in (int, float) or not isfinite(voltage) or voltage <= 0:
        fail('ENVIRONMENT_RATED_VOLTAGE_MISSING', '型号额定电压缺项，不能证明所选敷设参考适用于该电压等级。')
    # Ask the same sealed resolver about the *saved* voltage class. This check
    # does not turn rated voltage into the actual system input checked above.
    selected = Selection.model_validate({**evidence.selection,
        'conditions': {**evidence.selection['conditions'], 'u_v': voltage}})
    try:
        service.select(selected)
    except HTTPException as error:
        if error.status_code != 422:
            raise
        fail('ENVIRONMENT_RATED_VOLTAGE_OUTSIDE', '该型号已保存的额定电压不在所选敷设参考范围；不能通过另填较低电压绕过。')
    return {'value': voltage, 'path': pointer('cable_types', cable['id'], 'rating', 'u')}


def preview(service, assets, research, body, *, workspace=None):
    workspace = workspace or research.store.snapshot(str(body.workspace_id))
    if str(workspace['id']) != str(body.workspace_id) or workspace['revision'] != body.expected_revision:
        fail('ENVIRONMENT_TARGET_CHANGED', '目标型号修订已变化，请重新预览；工况未修改。', 409)
    document = workspace.get('domain')
    if not document or len(document.get('cable_types', [])) != 1 or workspace.get('study_cable_reference'):
        fail('ENVIRONMENT_TARGET_INVALID', '环境参考须用于一个明确的独立型号。')
    if (document['cable_types'][0]['construction'] == 'three_core') != body.row.layout.startswith('three_core_'):
        fail('ENVIRONMENT_LAYOUT_MISMATCH', '型号芯数与敷设排列不相符。')
    proposed = body.row.model_dump()
    changes = []
    for pin in body.resources:
        asset, evidence = _published(service, assets, pin)
        value = evidence.quantity.value - 273.15 if pin.parameter == 'ambient_temperature_c' else evidence.quantity.value
        proposed[pin.parameter] = value
        changes.append({'parameter': pin.parameter, 'before': getattr(body.row, pin.parameter),
            'after': value, 'quantity': evidence.quantity.model_dump(mode='json'),
            'resource_id': asset['id'], 'asset_ref': {key: asset[key] for key in ('asset_id', 'version', 'content_sha256')},
            'reference_evidence': evidence.model_dump(mode='json')})
    row = RatingRow.model_validate(proposed)
    evidence_items = [ReferenceEvidence.model_validate(change['reference_evidence']) for change in changes]
    target_facts = _system_facts(document, row, body.conditions,
        require_voltage=any('u_v' in evidence.selection['conditions'] for evidence in evidence_items))
    for evidence in evidence_items:
        rated = _rated_voltage(service, document, evidence)
        if rated is not None:
            target_facts['rated_voltage'] = rated
        _applicable(evidence, body.conditions, row)
    result = {'workspace_id': str(body.workspace_id), 'expected_revision': body.expected_revision,
        'workspace_sha256': fingerprint(document), 'case_id': body.row.case_id,
        'before': body.row.model_dump(mode='json'), 'proposed': row.model_dump(mode='json'),
        'conditions': deepcopy(body.conditions), 'changes': changes, 'target_facts': target_facts,
        'trust': {'grade': 'reference', 'label': '参考'}, 'approval': 'not_granted',
        'applied_to_workspace': False,
        'limitations': ['采用仅固定本次载流量工况的参考；不证明现场条件，不修改厂家型号事实，也不构成工程批准。']}
    return {**result, 'preview_digest': fingerprint(result)}


def _input_sources(case, receipt):
    document = case['input']
    section = document['sections'][0]
    for change in receipt['changes']:
        reference = {'asset': change['asset_ref'], 'parameter': change['parameter'],
            'record_sha256': change['reference_evidence']['record_sha256'], 'preview_digest': receipt['preview_digest'],
            'trust': 'reference', 'approval': 'not_granted'}
        source = {'kind': 'asset', 'reference': json.dumps(reference, ensure_ascii=False, sort_keys=True), 'reviewed': False}
        paths = [pointer('sections', section['id'], 'layout_template', change['parameter'])]
        if change['parameter'] == 'depth_m':
            paths.extend(pointer('sections', section['id'], 'placements', place['cable'], 'z') for place in section['placements'])
        elif change['parameter'] == 'soil_rho_k_m_w':
            paths.append(pointer('materials', 'material/rating-soil', 'thermal_resistivity'))
        else:
            paths.append(pointer('sections', section['id'], 'medium', 'surface_temperature'))
            if receipt['proposed']['layout'] == 'air':
                paths.append(pointer('sections', section['id'], 'medium', 'air_temperature'))
        for path in paths:
            document['provenance'][path] = deepcopy(source)


def adopt_for_batch(service, assets, research, workspace, definition, adoptions):
    """Revalidate a human-reviewed preview before saving the ordinary study.

    Saved runs keep this entire receipt. Historical reads never resolve a latest
    asset or reselect a newer data release.
    """
    cases = {case['case_id']: case for case in definition['driver']['cases']}
    for adoption in adoptions:
        if str(adoption.workspace_id) != str(workspace['id']):
            continue
        case = cases.get(adoption.row.case_id)
        if case is None:
            fail('ENVIRONMENT_CASE_MISSING', '环境参考没有对应的本次工况，未保存。')
        receipt = preview(service, assets, research, adoption, workspace=workspace)
        if receipt['preview_digest'] != adoption.preview_digest:
            fail('ENVIRONMENT_PREVIEW_CHANGED', '环境参考预览已变化，须重新核对并确认。', 409)
        if RatingRow.model_validate(case['metadata']['condition']).model_dump() != receipt['proposed']:
            fail('ENVIRONMENT_ROW_CHANGED', '计算工况与已确认的环境预览不同；不能暗中覆盖用户输入。', 409)
        case['metadata']['environment_references'] = {**receipt, 'human_confirmed': True,
            'adopted_to': 'saved_rating_condition'}
        _input_sources(case, receipt)


def make_router(service, assets, research):
    router = APIRouter(prefix='/environment')

    @router.post('/draft-preview')
    def preview_draft(body: EnvironmentDraftPreview):
        return draft_preview(service, body)

    @router.post('/draft', status_code=201)
    def create_asset(body: EnvironmentDraft, x_cablesim_actor: str | None = Header(default=None)):
        if x_cablesim_actor != 'human':
            fail('ENVIRONMENT_HUMAN_REQUIRED', '此写入须由人工确认；Agent 可查看资料并提出预览。', 403)
        result = draft_preview(service, body)
        if result['preview_digest'] != body.preview_digest:
            fail('ENVIRONMENT_DRAFT_CHANGED', '资料预览已变化，请重新核对；未创建草稿。', 409)
        return assets.create(AssetRelease.model_validate(result['release']),
            '从封签环境参考创建草稿；保留参考分档，尚未采用到工况。')

    @router.post('/preview')
    def preview_asset(body: EnvironmentPreview):
        return preview(service, assets, research, body)

    return router
