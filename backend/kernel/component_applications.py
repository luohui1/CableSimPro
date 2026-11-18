"""Copy one explicitly selected component into the old Types command history."""
from __future__ import annotations

from copy import deepcopy
import json
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Header
from pydantic import Field, ValidationError, model_validator

from backend.domain.guards import check_locks, pointer
from backend.domain.models import Conductor, Layer, Material
from backend.schemas import StrictModel
from .resource_applications import (AdoptionBase, AdoptionConfirmation, CaptureBase, CaptureConfirmation,
    application_evidence, capture_preview, fail, frozen_source, load_application, make_release,
    require_human, resource_summary, same_json, save_capture, source_for)
from .type_versions import checked_type_document
from .workspace import fingerprint


METHOD = {'name': '保存部件输入参考捕获', 'version': '1.0.0'}
OBSERVATIONS = {'minimum_thickness', 'maximum_thickness', 'mean_thickness',
                'mean_wire_diameter', 'minimum_tape_thickness', 'longitudinal_r20',
                'longitudinal_resistance_basis', 'longitudinal_resistance_frequency'}
UNITS = {
    'nominal_area': 'm²', 'diameter': 'm', 'sector_angle_deg': '°', 'sector_rotation_deg': '°',
    'r20': 'Ω/m', 'conductor_class': '1', 'inner_diameter': 'm', 'segments': '1',
    'wire_count': '1', 'wire_diameter': 'm', 'lay_length': 'm', 'lay_factor': '1',
    'thickness': 'm', 'corrugation_depth': 'm', 'corrugation_pitch': 'm', 'overlap': '1',
    'mean_wire_diameter': 'm', 'padding_thickness': 'm', 'tape_width': 'm',
    'minimum_thickness': 'm', 'maximum_thickness': 'm', 'mean_thickness': 'm',
    'nominal_tape_thickness': 'm', 'tape_count': '1', 'minimum_overlap': '1',
    'reverse_binder_thickness': 'm', 'reverse_binder_width': 'm', 'reverse_binder_count': '1',
    'screen_inner_diameter': 'm', 'minimum_tape_thickness': 'm', 'longitudinal_r20': 'Ω/m',
    'longitudinal_resistance_frequency': 'Hz', 'tape_gap': 'm',
    'thermal_resistivity': 'K·m/W', 'dry_thermal_resistivity': 'K·m/W',
    'volumetric_heat_capacity': 'J/(m³·K)', 'electrical_resistivity_20': 'Ω·m',
    'temperature_coefficient_20': 'K⁻¹', 'relative_permittivity': '1', 'loss_tangent': '1',
    'relative_permeability': '1', 'emissivity': '1', 'solar_absorptivity': '1',
    'critical_temperature_rise': 'K', 'density': 'kg/m³',
}
LABELS = {
    'id': '材料标识', 'label': '材料名称', 'material': '材料引用', 'form': '构造形式',
    'role': '结构层用途', 'nominal_area': '标称截面', 'diameter': '导体直径',
    'sector_angle_deg': '扇形夹角', 'sector_rotation_deg': '扇形朝向', 'r20': '20 ℃电阻',
    'conductor_class': '导体类别', 'r20_basis': '电阻数据口径', 'inner_diameter': '内径',
    'segments': '分割数', 'wire_count': '单丝数量', 'insulated_wires': '单丝绝缘声明',
    'wire_diameter': '单丝直径', 'lay_length': '绞距', 'lay_direction': '绞向', 'lay_factor': '绞入系数',
    'thickness': '标称层厚', 'corrugation_depth': '皱纹深度', 'corrugation_pitch': '皱纹节距',
    'overlap': '搭盖率', 'mean_wire_diameter': '实测平均丝径', 'padding_thickness': '附加垫层厚度',
    'tape_width': '带宽', 'minimum_thickness': '最薄点实测厚度', 'maximum_thickness': '最大实测厚度',
    'mean_thickness': '平均实测厚度', 'nominal_tape_thickness': '单带标称厚度', 'tape_count': '带数',
    'tape_application': '绕包方式', 'minimum_overlap': '最小搭盖率', 'reverse_binder_thickness': '反扎带厚度',
    'reverse_binder_width': '反扎带宽度', 'reverse_binder_count': '反扎带数量',
    'screen_inner_diameter': '屏蔽内径', 'minimum_tape_thickness': '单带最薄点实测厚度',
    'longitudinal_r20': '金属层纵向电阻', 'longitudinal_resistance_basis': '纵向电阻测量口径',
    'longitudinal_resistance_frequency': '纵向电阻测量频率', 'tape_gap': '双带间隙',
    'category': '材料用途', 'standard_kind': '材料组成类别', 'thermal_resistivity': '热阻率',
    'dry_thermal_resistivity': '干燥热阻率', 'volumetric_heat_capacity': '体积热容',
    'electrical_resistivity_20': '20 ℃电阻率', 'temperature_coefficient_20': '20 ℃电阻温度系数',
    'relative_permittivity': '相对介电常数', 'loss_tangent': '介质损耗角正切',
    'relative_permeability': '相对磁导率', 'emissivity': '表面发射率',
    'solar_absorptivity': '太阳吸收率', 'critical_temperature_rise': '临界温升', 'density': '质量密度',
}


class ComponentSelection(StrictModel):
    cable_type_id: str = Field(pattern=r'^cable_type/[A-Za-z0-9_-]+$')
    core_id: str | None = Field(default=None, pattern=r'^core/[A-Za-z0-9_-]+$')
    part: Literal['conductor', 'core_layer', 'common_layer']
    layer_index: int | None = Field(default=None, ge=0, strict=True)

    @model_validator(mode='after')
    def explicit_slot(self):
        if (self.part == 'common_layer') != (self.core_id is None):
            raise ValueError('公共层不指定线芯，导体和芯层必须明确线芯。')
        if (self.part == 'conductor') != (self.layer_index is None):
            raise ValueError('导体不指定层号；结构层必须明确保存的层位置。')
        return self


class CaptureComponent(CaptureBase):
    selection: ComponentSelection


class CreateComponent(CaptureComponent, CaptureConfirmation):
    pass


class PreviewComponent(AdoptionBase):
    target: ComponentSelection
    target_material_id: str = Field(pattern=r'^material/[A-Za-z0-9_-]+$')


class AdoptComponent(PreviewComponent, AdoptionConfirmation):
    operation: Literal['adopt_resource_component'] = 'adopt_resource_component'


def selected_part(document, selection):
    cable = next((item for item in document['cable_types'] if item['id'] == selection.cable_type_id), None)
    if cable is None:
        fail('RESOURCE_COMPONENT_SLOT', '所选型号不存在。')
    cable_index = document['cable_types'].index(cable)
    path, indexed = pointer('cable_types', cable['id']), '/cable_types/' + str(cable_index)
    core = None
    if selection.part != 'common_layer':
        core = next((item for item in cable['cores'] if item['id'] == selection.core_id), None)
        if core is None:
            fail('RESOURCE_COMPONENT_SLOT', '所选线芯不存在。')
        path += pointer('cores', core['id'])
        indexed += '/cores/' + str(cable['cores'].index(core))
    if selection.part == 'conductor':
        return cable, core, core['conductor'], path + '/conductor', indexed + '/conductor'
    key = 'common_layers' if core is None else 'layers'
    layers = cable[key] if core is None else core[key]
    if selection.layer_index >= len(layers):
        fail('RESOURCE_COMPONENT_SLOT', '所选层位置不存在，请重新读取目标。')
    layer = layers[selection.layer_index]
    indexed += '/' + key + '/' + str(selection.layer_index)
    if sum(item['role'] == layer['role'] for item in layers) == 1:
        path += pointer(key, layer['role'])
    else:
        path = indexed
    return cable, core, layer, path, indexed


def context(cable, core, selection):
    if selection.part == 'conductor':
        return {}
    result = {'construction': cable['construction'], 'rating': deepcopy(cable['rating'])}
    if selection.part == 'core_layer':
        result.update(conductor=deepcopy(core['conductor']), inner_layers=deepcopy(core['layers'][:selection.layer_index]))
    else:
        result.update(cores=deepcopy(cable['cores']), inner_layers=deepcopy(cable['common_layers'][:selection.layer_index]))
    return result


def reject_observations(document, selection, part):
    if selection.part == 'conductor':
        if part.get('r20') is not None and part.get('r20_basis') not in ('design', 'manufacturer_limit'):
            fail('RESOURCE_COMPONENT_OBSERVATION', '实测或口径不明的电阻不能当作目标导体输入搬用；明确厂家限值须完整保留其限值口径。')
    elif any(part.get(key) is not None for key in OBSERVATIONS):
        fail('RESOURCE_COMPONENT_OBSERVATION', '来源或目标层包含实测厚度、丝径或纵向电阻；须独立处理试验数据，不能以部件替换搬用。')
    role = 'conductor' if selection.part == 'conductor' else part['role']
    if any(item.get('cable_type') == selection.cable_type_id and item.get('core') == selection.core_id
           and item.get('role') == role for item in document.get('measurements', [])):
        fail('RESOURCE_COMPONENT_OBSERVATION', '所选对象已有出厂实测记录；不能以输入参考替换其试样身份。')


def source_component(document, selection):
    cable, core, part, path, indexed = selected_part(document, selection)
    reject_observations(document, selection, part)
    material = next((item for item in document['materials'] if item['id'] == part['material']), None)
    if material is None:
        fail('RESOURCE_COMPONENT_MATERIAL', '来源部件没有明确的材料事实。')
    try:
        part = (Conductor if selection.part == 'conductor' else Layer).model_validate(part).model_dump(mode='json')
        material = Material.model_validate(material).model_dump(mode='json')
    except ValidationError:
        fail('RESOURCE_COMPONENT_INCOMPLETE', '所选部件几何或材料字段缺失，不能从其他层或旧值补齐。')
    if selection.part == 'conductor' and part['form'] == 'unspecified':
        fail('RESOURCE_COMPONENT_INCOMPLETE', '来源导体构造尚未明确，不能作为可采用部件。')
    fields, missing = [], []
    for group, values, stable, index_path in (
            ('部件', part, path, indexed), ('材料', material, pointer('materials', material['id']),
             '/materials/' + str(next(i for i, value in enumerate(document['materials']) if value['id'] == material['id'])))):
        for key, value in values.items():
            source, source_path = source_for(document.get('provenance', {}), stable + pointer(key), index_path + pointer(key))
            if value is not None and key not in ('id', 'label', 'material') and source is None:
                fail('RESOURCE_COMPONENT_SOURCE_MISSING', '所选部件或材料缺少明确原始出处：' + stable + pointer(key))
            if value is not None and source and source['kind'] == 'measurement':
                fail('RESOURCE_COMPONENT_OBSERVATION', '实测来源不能作为新目标的制造或检验事实搬用。')
            unit = UNITS.get(key)
            if type(value) in (int, float) and unit is None:
                fail('RESOURCE_COMPONENT_UNIT_MISSING', '该数值尚无明确单位映射：' + key)
            label = group + ' · ' + LABELS[key]
            if value is None:
                missing.append(label + '：原输入未给出；采用时保持为空。')
            fields.append({'path': stable + pointer(key), 'label': label, 'value': value, 'unit': unit,
                           'source': source, 'source_path': source_path, 'group': group, 'field': key})
    payload = {'selection': selection.model_dump(mode='json'), 'component': part, 'material': material,
               'context': context(cable, core, selection)}
    return payload, fields, missing


def validate_component_application(application):
    try:
        selection = ComponentSelection.model_validate(application['payload']['selection'])
        original = application['source']['snapshot']['domain']
        UUID(application['source']['workspace_id'])
        if not same_json(checked_type_document(original), original):
            fail('RESOURCE_COMPONENT_INCOMPLETE', '冻结来源结构不完整；不能通过读取补默认值。')
        # Validation can add null optionals to a selected value, never numbers.
        # The source document itself stays byte-for-byte in the frozen snapshot.
        payload, fields, missing = source_component(original, selection)
    except (KeyError, TypeError, ValueError, ValidationError):
        fail('RESOURCE_COMPONENT_INCOMPLETE', '冻结部件载荷或来源结构不完整。')
    if not same_json(payload, application['payload']) or application['method'] != METHOD:
        fail('RESOURCE_COMPONENT_IDENTITY', '部件载荷与冻结来源、捕获方法不一致。')
    return {'selection': selection.model_dump(mode='json'), 'component': deepcopy(payload['component']),
            'material': deepcopy(payload['material']), 'fields': fields, 'missing': missing}


def capture_component(research, assets, types, db, body):
    row, state = types._type(db, str(body.workspace_id), body.expected_revision)
    payload, _, _ = source_component(state['domain'], body.selection)
    release = make_release(body, 'component', frozen_source(row, state), payload, METHOD)
    return capture_preview(research, assets, db, body, release)


def proposed_component(types, assets, db, body):
    row, state = types._type(db, str(body.workspace_id), body.expected_revision)
    types.store.assert_mutable(db, row['id'])
    resource, application = load_application(assets, db, body.resource_id, body.content_sha256,
                                             kind='component', published=True)
    evidence = application_evidence(types.research, application)
    source = application['payload']
    if body.target.part != source['selection']['part']:
        fail('RESOURCE_COMPONENT_SLOT_MISMATCH', '导体、芯层与公共层不能互相替换。')
    document = deepcopy(state['domain'])
    cable, core, previous, path, indexed = selected_part(document, body.target)
    reject_observations(document, body.target, previous)
    if body.target.part != 'conductor' and (previous['role'] != source['component']['role']
            or not same_json(context(cable, core, body.target), source['context'])):
        fail('RESOURCE_COMPONENT_CONTEXT', '结构层用途、电压声明或内层几何不一致；不能脱离原层位置套用。')
    existing = next((item for item in document['materials'] if item['id'] == body.target_material_id), None)
    material = deepcopy(source['material'])
    material['id'] = body.target_material_id
    material_action = 'create'
    if existing is not None:
        if not same_json({k: v for k, v in existing.items() if k not in ('id', 'label')}, {
                k: v for k, v in material.items() if k not in ('id', 'label')}):
            fail('RESOURCE_MATERIAL_CONFLICT', '所选已有材料的完整事实不同；不能覆盖共享材料，请明确另一个新材料标识。')
        material_action, material = 'reuse_identical', deepcopy(existing)
    proposed = deepcopy(source['component'])
    proposed['material'] = body.target_material_id
    previous_material = next((item for item in document['materials'] if item['id'] == previous['material']), None)
    changes, provenance = [], document.setdefault('provenance', {})
    for group, before, after, destination, index_destination in (
            ('部件', previous, proposed, path, indexed),
            ('材料', existing or {}, material, pointer('materials', material['id']),
             '/materials/' + str(document['materials'].index(existing)) if existing else None)):
        for key, value in after.items():
            original = next(item for item in evidence['fields'] if item['group'] == group and item['field'] == key)
            target_path = destination + pointer(key)
            previous_source = None
            if group != '材料' or existing is not None:
                previous_source, _ = source_for(provenance, target_path,
                    index_destination + pointer(key) if index_destination else None)
            action = 'unchanged' if group == '材料' and material_action == 'reuse_identical' else 'replace'
            changes.append({'path': target_path, 'label': original['label'], 'unit': original['unit'],
                'before': before.get(key), 'after': value, 'source': deepcopy(original['source']),
                'previous_source': previous_source, 'source_action': action})
    # Remove only the selected slot's old field sources. Full prior values and
    # sources are retained in the new per-field receipts and workspace history.
    for key in list(provenance):
        if any(key == prefix or key.startswith(prefix + '/') for prefix in (path, indexed)):
            del provenance[key]
    for change in changes:
        if change['source_action'] == 'unchanged':
            continue
        provenance[change['path']] = {'kind': 'asset', 'reviewed': False,
            'reference': json.dumps({'schema': 'cablesim.adopted-component-field/1',
                'resource': resource_summary(resource), 'source_selection': source['selection'],
                'source_workspace': application['source']['workspace_id'], 'source_revision': application['source']['revision'],
                'source_document_sha256': application['source']['document_sha256'],
                'target': body.target.model_dump(mode='json'), 'field': change,
                'method': METHOD, 'approval': 'not_granted'}, ensure_ascii=False)}
    if material_action == 'create':
        document['materials'].append(material)
    if body.target.part == 'conductor':
        core['conductor'] = proposed
    elif body.target.part == 'core_layer':
        core['layers'][body.target.layer_index] = proposed
    else:
        cable['common_layers'][body.target.layer_index] = proposed
    document = checked_type_document(document)
    check_locks(state, document)
    result = {**evidence, 'schema_version': 'cablesim.component-preview/1',
        'workspace_id': row['id'], 'revision': row['revision'], 'document_sha256': fingerprint(state['domain']),
        'resource': resource_summary(resource), 'target': body.target.model_dump(mode='json'),
        'before': {'component': deepcopy(previous), 'material': deepcopy(previous_material)},
        'proposed': {'component': proposed, 'material': material}, 'changes': changes,
        'material_action': material_action, 'adoptable': True}
    return row, state, document, {**result, 'preview_digest': fingerprint(result)}


def component_routes(research, assets, types):
    router = APIRouter(prefix='/components')

    @router.post('/capture-preview')
    def preview_capture(body: CaptureComponent):
        with types.store.read_snapshot() as db:
            return capture_component(research, assets, types, db, body)

    @router.post('/capture', status_code=201)
    def capture(body: CreateComponent, x_cablesim_actor: str | None = Header(default=None)):
        require_human(x_cablesim_actor)
        with types.store.db(True) as db:
            return save_capture(assets, db, body, capture_component(research, assets, types, db, body), x_cablesim_actor)

    @router.post('/preview')
    def preview(body: PreviewComponent):
        with types.store.read_snapshot() as db:
            return proposed_component(types, assets, db, body)[3]

    @router.post('/adopt')
    def adopt(body: AdoptComponent, x_cablesim_actor: str | None = Header(default=None)):
        require_human(x_cablesim_actor)
        with types.store.db(True) as db:
            replay = types._replay(db, str(body.workspace_id), body)
            if replay:
                return replay
            row, state, document, preview = proposed_component(types, assets, db, body)
            if preview['preview_digest'] != body.preview_digest:
                fail('RESOURCE_ADOPTION_PREVIEW_CHANGED', '目标、来源或预览已变化，请重新核对。', 409)
            state['domain'] = document
            types.store.commit(db, row, state, '人工采用固定部件输入参考')
            result = types.store.snapshot(row['id'], db)
            types._remember(db, row['id'], body, result)
            return result

    return router
