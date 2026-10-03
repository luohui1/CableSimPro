"""Read-only system demo versions and explicit study input choices.

The system catalogue contains declared demonstration facts, never manufacturer
certification. All numerical solving remains in the installed plugins.
"""
from copy import deepcopy
import json
from math import sqrt
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import Field

from backend.catalog import presets
from backend.domain.guards import check_locks, pointer
from backend.domain.migration import convert
from backend.domain.models import CableType, DomainDocument, Material
from backend.schemas import Scenario, StrictModel
from backend.workbench import Revision, fingerprint


VERSION = '1.0.0'
METHOD_DEFAULTS = {
    'cablesim.thermal-network': {'conductor_kind': 'copper', 'ac_extra_factor': 0.05, 'screen_loss_factor': 0.05},
    'cablesim.iec60287': {'ks': 1.0, 'kp': 1.0, 't4_form': 'simplified', 'eddy': 'ignored',
                        'solver': {'initial_sheath_temperature_c': 70.0, 'current_tolerance_a': 1e-8, 'max_iterations': 100}},
}


def system_models():
    models = []
    for area, diameter, r20 in [(240, 0.0185, 7.54e-5), (400, 0.025, 4.7e-5)]:
        label = f'YJL02-12/20 kV 1×{area}（结构演示）'
        materials = [
            {'id': 'material/cu', 'label': '铜（演示）', 'category': 'conductor', 'temperature_coefficient_20': 0.00393},
            {'id': 'material/semi', 'label': '半导电材料（演示）', 'category': 'semiconductor', 'thermal_resistivity': 2.5},
            {'id': 'material/xlpe', 'label': 'XLPE（演示）', 'category': 'insulation', 'thermal_resistivity': 3.5,
             'relative_permittivity': 2.5, 'loss_tangent': 0.001},
            {'id': 'material/al-sheath', 'label': '铝护套（演示）', 'category': 'metal', 'thermal_resistivity': 0.004,
             'electrical_resistivity_20': 2.84e-8, 'temperature_coefficient_20': 0.00403},
            {'id': 'material/pvc', 'label': '外护套（演示）', 'category': 'polymer', 'thermal_resistivity': 3.5},
        ]
        cable = {'id': 'cable_type/ct1', 'label': label, 'construction': 'single_core',
                 'rating': {'u0': 12000.0, 'u': 20000.0, 'um': 24000.0, 'max_conductor_temperature': {'normal': 363.15}},
                 'cores': [{'id': 'core/1', 'x': 0.0, 'z': 0.0, 'layers': [],
                            'conductor': {'material': 'material/cu', 'form': 'stranded_round',
                                          'nominal_area': area*1e-6, 'diameter': diameter, 'r20': r20}}],
                 'common_layers': [
                     {'role': 'conductor_screen', 'material': 'material/semi', 'thickness': 0.0006},
                     {'role': 'insulation', 'material': 'material/xlpe', 'thickness': 0.0055},
                     {'role': 'insulation_screen', 'material': 'material/semi', 'thickness': 0.0007},
                     {'role': 'metallic_sheath', 'material': 'material/al-sheath', 'thickness': 0.0008, 'form': 'smooth'},
                     {'role': 'oversheath', 'material': 'material/pvc', 'thickness': 0.0025},
                 ]}
        payload = {'cable_type': CableType.model_validate(cable).model_dump(mode='json'),
                   'materials': [Material.model_validate(m).model_dump(mode='json') for m in materials]}
        models.append({'id': f'system.cu-xlpe-al-{area}', 'version': '1.0.1', 'name': label,
                       'state': 'demo', 'source': '型号代号依据：山东泰开官方目录铜芯栏为 YJL02，铝芯栏为 YJLL02。'
                       'YJ 为 XLPE 绝缘；铜导体代号省略；L 为平滑铝套；02 为 PVC 外套。'
                       '目录产品为 66–500 kV，本 12/20 kV 结构为系统演示输入，并非该厂此规格产品数据；尺寸与物性为明示假设。'
                       ' https://www.taikaidianlan.com/index.php?c=show&id=211',
                       'content_sha256': fingerprint(payload), 'payload': payload,
                       'method_defaults': deepcopy(METHOD_DEFAULTS)})
    # The model designation is real; the full dimensions and material constants
    # below are an explicitly declared teaching model, not a factory data sheet.
    lead = deepcopy(models[1])
    lead['id'] = 'system.yjq02-110kv-800'
    lead['name'] = 'YJQ02-64/110 kV · 1×800（典型结构演示）'
    lead['source'] = ('型号系列来自中环特种电缆的高压产品目录；800 mm² 导体设计包络直径采用 34.0 mm，'
                      '参考皖特缆 64/110 kV 产品导体表（跨护套系列参考，不是本型号完整厂家数据）。'
                      '其余尺寸、物性和制造参数为明示假设，不能用于实际产品选型。'
                      ' http://www.zhtzdl.com/cable/gaoya/97.html')
    lead['conductor_diameter_source'] = ('安徽蓝普 / 皖特缆公开的 64/110 kV 电缆结构性能表：'
                                       '800 mm² 导体直径 34.0 mm、R20 0.0221 Ω/km；仅作为本演示的导体包络参考，'
                                       '不同护套系列的其他尺寸不移植。 https://dceyhr.cnal.com/product/detail-32519549.shtml')
    cable = lead['payload']['cable_type']
    cable['label'] = lead['name']
    cable['rating'].update(u0=64000.0, u=110000.0, um=123000.0)
    conductor = cable['cores'][0]['conductor']
    conductor.update(nominal_area=.0008, diameter=.034, r20=2.21e-5, form='stranded_round_compacted')
    for layer, thickness in zip(cable['common_layers'], [.001, .016, .001, .0029, .004]):
        layer['thickness'] = thickness
    cable['common_layers'][3]['material'] = 'material/pb-sheath'
    lead['payload']['materials'][3] = Material.model_validate({
        'id': 'material/pb-sheath', 'label': '铅护套（演示假设）', 'category': 'metal',
        'thermal_resistivity': .028, 'electrical_resistivity_20': 2.14e-7,
        'temperature_coefficient_20': .004, 'density': 11340.0}).model_dump(mode='json')
    for material, density in zip(lead['payload']['materials'], [8900.0, 1100.0, 920.0, 11340.0, 1400.0]):
        material['density'] = density
    lead['payload']['cable_type'] = CableType.model_validate(cable).model_dump(mode='json')
    lead['content_sha256'] = fingerprint(lead['payload'])
    models.append(lead)
    return models


def model_version(model_id, digest):
    model = next((m for m in system_models() if m['id'] == model_id), None)
    if model is None or model['content_sha256'] != digest:
        raise HTTPException(409, '型号版本或内容已变化，请重新选择；未更新任何输入。')
    return model


def leaf_paths(value, path):
    if isinstance(value, dict):
        for key, item in value.items():
            yield from leaf_paths(item, path+pointer(key))
    elif isinstance(value, list):
        for item in value:
            yield from leaf_paths(item, path+pointer(item.get('id') or item.get('role')))
    else:
        yield path


def attach_model(state, model):
    document = deepcopy(state['domain'])
    if len(document['cable_types']) != 1:
        raise HTTPException(422, '当前引用入口支持单型号研究；请新建独立研究。')
    previous = state.get('study_cable_reference') or {}
    checked = {**state, 'locks': [p for p in state.get('locks', []) if p not in previous.get('locks', [])]}
    checked.pop('study_cable_reference', None)
    cable = deepcopy(model['payload']['cable_type'])
    cable['id'] = document['cable_types'][0]['id']
    document['cable_types'][0] = cable
    materials = {m['id']: m for m in document['materials']}
    materials.update({m['id']: deepcopy(m) for m in model['payload']['materials']})
    document['materials'] = list(materials.values())
    locks = list(leaf_paths(cable, pointer('cable_types', cable['id'])))
    for material in model['payload']['materials']:
        locks += list(leaf_paths(material, pointer('materials', material['id'])))
    reference = f"系统型号库 · {model['name']} · {model['version']} · 演示 · sha256:{model['content_sha256']}"
    for path in locks:
        document['provenance'][path] = {'kind': 'asset', 'reference': reference, 'reviewed': False}
    if model.get('conductor_diameter_source'):
        path = pointer('cable_types', cable['id'], 'cores', cable['cores'][0]['id'], 'conductor', 'diameter')
        document['provenance'][path] = {'kind': 'manufacturer', 'reference': model['conductor_diameter_source'], 'reviewed': False}
    document['provenance'][pointer('cable_types', cable['id'])] = {'kind': 'asset', 'reference': reference, 'reviewed': False}
    check_locks(checked, document)
    state['domain'] = DomainDocument.model_validate(document).model_dump(mode='json')
    state['locks'] = list(dict.fromkeys([*checked['locks'], *locks]))
    state['study_cable_reference'] = {k: deepcopy(model[k]) for k in ('id', 'version', 'name', 'state', 'source', 'content_sha256', 'payload', 'method_defaults')}
    state['study_cable_reference']['locks'] = locks
    state['study_cable_reference']['bound_cable_type_id'] = cable['id']


def apply_layout(document, kind, depth=0.8, spacing=None):
    circuit, section = document['circuits'][0], document['sections'][0]
    cable = next(t for t in document['cable_types'] if t['id'] == circuit['cable_type'])
    diameter = cable['cores'][0]['conductor']['diameter']+2*sum(l['thickness'] for l in cable['common_layers'])
    spacing = diameter if spacing is None else spacing
    section['enclosures'] = []
    section['backfill'] = None
    section['soil_layers'] = []
    section['kind'] = 'tunnel' if kind == 'tunnel' else 'air' if kind == 'tray' else 'ground'
    section['label'] = {'trefoil': '直埋单回 · 品字形', 'flat': '直埋单回 · 水平',
                        'double_trefoil': '直埋双回 · 品字形', 'ducts': '排管截面',
                        'tunnel': '隧道截面', 'tray': '桥架截面'}[kind]
    # A second circuit belongs to this template; never remove manually added circuits.
    if any(c['id'] != 'circuit/template2' for c in document['circuits'][1:]):
        raise HTTPException(422, '模板不能覆盖手工新增的回路，请保留当前布置并在图上调整。')
    document['circuits'] = [circuit]
    for load in document['load_cases']:
        load['currents'].pop('circuit/template2', None)
    if kind == 'double_trefoil':
        other = deepcopy(circuit)
        other['id'], other['label'] = 'circuit/template2', '第二回路（模板演示）'
        other['cables'] = [{**c, 'id': f'cable/template2-{c["phase"]}'} for c in circuit['cables']]
        document['circuits'].append(other)
        for load in document['load_cases']:
            load['currents'][other['id']] = load['currents'][circuit['id']]
    if section['kind'] != 'ground':
        section['medium']['air_temperature'] = section['medium']['surface_temperature']
        section['medium']['ventilation'] = 'natural'
    if kind == 'ducts':
        outer, inner = 0.075, 0.064
        spacing = outer
        if diameter > inner:
            raise HTTPException(422, '所选演示管径容纳不了电缆，请选择更大的排管模板。')
        if not any(m['id'] == 'material/duct' for m in document['materials']):
            document['materials'].append({'id': 'material/duct', 'label': '管材（演示）', 'category': 'duct', 'thermal_resistivity': 3.5})
    positions = [(-spacing, -depth), (0.0, -depth), (spacing, -depth)] if kind in ('flat', 'tunnel', 'tray') else [
        (0.0, -depth+sqrt(3)*spacing/3), (-spacing/2, -depth-sqrt(3)*spacing/6), (spacing/2, -depth-sqrt(3)*spacing/6)]
    section['placements'] = []
    for ci, selected in enumerate(document['circuits']):
        shift = (ci-.5)*.6 if kind == 'double_trefoil' else 0.0
        for i, (instance, (x, z)) in enumerate(zip(selected['cables'], positions)):
            enclosure = f'enclosure/duct-{i+1}' if kind == 'ducts' else 'enclosure/template-tray' if kind in ('tunnel', 'tray') else None
            section['placements'].append({'cable': instance['id'], 'x': x+shift, 'z': z, 'enclosure': enclosure})
            if kind == 'ducts':
                section['enclosures'].append({'id': enclosure, 'type': 'duct', 'material': 'material/duct', 'x': x, 'z': z,
                                              'inner_diameter': inner, 'outer_diameter': outer, 'contains': [instance['id']]})
    if kind in ('tunnel', 'tray'):
        section['enclosures'].append({'id': 'enclosure/template-tray', 'type': 'tray', 'x': 0.0, 'z': -depth-diameter/2-.05,
                                     'width': max(.4, diameter*5), 'height': .1, 'contains': [c['id'] for c in circuit['cables']]})
    section['layout_template'] = {'id': 'system.'+kind, 'version': VERSION, 'kind': kind, 'depth': depth, 'spacing': spacing}
    source = {'kind': 'demo', 'reference': f'系统截面模板 · {kind} · {VERSION}；位置与管材为演示输入', 'reviewed': False}
    for placement in section['placements']:
        for axis in ('x', 'z'):
            document['provenance'][pointer('sections', section['id'], 'placements', placement['cable'], axis)] = source
    return DomainDocument.model_validate(document).model_dump(mode='json')


class ChooseModel(StrictModel):
    model_id: str
    content_sha256: str = Field(pattern='^[0-9a-f]{64}$')


class BindModel(ChooseModel, Revision):
    pass


class LayoutPreview(Revision):
    document: DomainDocument
    kind: Literal['trefoil', 'flat', 'double_trefoil', 'ducts', 'tunnel', 'tray']
    depth: float = Field(default=0.8, gt=0)
    spacing: float | None = Field(default=None, gt=0)


def make_router(store):
    router = APIRouter(prefix='/api/design', tags=['Study inputs'])

    @router.get('/cable-models')
    def models():
        return system_models()

    @router.get('/type-workspaces')
    def types():
        with store.db() as db:
            result = []
            for row in db.execute('SELECT * FROM workspaces ORDER BY updated DESC'):
                state = json.loads(row['state'])
                if not state.get('domain') or state.get('study_cable_reference'):
                    continue
                result.append({'id': row['id'], 'name': state['domain']['name'], 'revision': row['revision'],
                               'updated_at': row['updated'], 'origin_version': state.get('type_origin_reference', {}).get('version')})
            return result

    @router.post('/workspaces/{wid}/section-template')
    def layout(wid: str, body: LayoutPreview):
        state = store.snapshot(wid)
        if state['revision'] != body.expected_revision:
            raise HTTPException(409, '共享输入已更新，请重新打开研究。')
        document = body.document.model_dump(mode='json')
        if len(document['sections']) != 1 or len(document['circuits'][0]['cables']) != 3:
            raise HTTPException(422, '当前系统模板需要一个截面和每回路三根单芯电缆。')
        check_locks(state, document)
        result = apply_layout(document, body.kind, body.depth, body.spacing)
        check_locks(state, result)
        source = {'kind': 'demo', 'reference': f'系统截面模板 · {body.kind} · {VERSION}；位置与管材为演示输入', 'reviewed': False}
        for placement in result['sections'][0]['placements']:
            for axis in ('x', 'z'):
                result['provenance'][pointer('sections', result['sections'][0]['id'], 'placements', placement['cable'], axis)] = source
        return result

    @router.post('/study-workspaces', status_code=201)
    def create(body: ChooseModel):
        model = model_version(body.model_id, body.content_sha256)
        area = model['payload']['cable_type']['cores'][0]['conductor']['nominal_area']*1e6
        preset = next(p for p in presets() if p['id'] == f'copper-{round(area)}') if round(area) in (240, 400) else next(p for p in presets() if p['id'] == 'copper-400')
        created = store.create(Scenario.model_validate(preset['scenario']))
        with store.db(True) as db:
            row, state = store.load(db, created['id'], created['revision'])
            converted = convert(state['scenario'])
            state['domain'] = converted['document']
            state['locks'] = [p for p in state.get('locks', []) if p != 'cable.max_temperature_c']
            state['domain_conversion'] = {'source_revision': row['revision'], 'method_parameters': deepcopy(METHOD_DEFAULTS['cablesim.thermal-network']),
                                         'warnings': ['系统演示型号；物性与方法假设需按实际产品核对。']}
            attach_model(state, model)
            soil = next(m for m in state['domain']['materials'] if m['id'] == state['domain']['sections'][0]['medium']['material'])
            soil['thermal_resistivity'] = 1.0
            state['domain']['load_cases'][0]['currents'][state['domain']['circuits'][0]['id']] = 350.0
            state['domain']['sections'][0]['medium']['surface_temperature'] = 298.15
            state['domain']['circuits'][0]['bonding']['kind'] = 'both_ends'
            demo = {'kind': 'demo', 'reference': '系统研究初始工况：350 A、25 °C、土壤 1.0 K·m/W；使用前按实际条件核对', 'reviewed': False}
            for path in [pointer('materials', soil['id'], 'thermal_resistivity'),
                         pointer('sections', state['domain']['sections'][0]['id'], 'medium', 'surface_temperature'),
                         pointer('load_cases', state['domain']['load_cases'][0]['id'], 'currents', state['domain']['circuits'][0]['id']),
                         '/criteria/max_conductor_temperature']:
                state['domain']['provenance'][path] = demo
            state['domain']['provenance'][pointer('circuits', state['domain']['circuits'][0]['id'], 'bonding', 'kind')] = {
                'kind': 'demo', 'reference': '系统演示工况：护套两端接地；按实际接地方案核对', 'reviewed': False}
            state['domain']['name'] = f"{model['name']} · 直埋研究（演示）"
            state['scenario']['name'] = state['domain']['name']
            state['domain'] = apply_layout(state['domain'], 'trefoil')
            store.commit(db, row, state, '显式选择系统演示型号版本与直埋模板')
        return store.snapshot(created['id'])

    @router.post('/type-workspaces', status_code=201)
    def create_type(body: ChooseModel):
        created = create(body)
        with store.db(True) as db:
            row, state = store.load(db, created['id'], created['revision'], allow_domain=True)
            binding = state.pop('study_cable_reference')
            state['locks'] = []
            state['type_origin_reference'] = {k: binding[k] for k in ('id', 'version', 'name', 'source', 'content_sha256')}
            # A type draft is not a buried three-phase arrangement. Keep one
            # neutral occurrence so thickness edits cannot clash with old spacing.
            circuit, section = state['domain']['circuits'][0], state['domain']['sections'][0]
            circuit['system']['kind'] = 'ac_single_phase'
            circuit['cables'] = [circuit['cables'][0]]
            section.update(kind='air', label='型号结构查看', enclosures=[], backfill=None, soil_layers=[], layout_template={})
            section['placements'] = [{'cable': circuit['cables'][0]['id'], 'x': 0.0, 'z': 0.0, 'enclosure': None}]
            state['domain'] = DomainDocument.model_validate(state['domain']).model_dump(mode='json')
            state['domain']['name'] = f"{binding['name']} · 型号草稿"
            state['scenario']['name'] = state['domain']['name']
            store.commit(db, row, state, '从系统型号版本复制独立型号草稿；保存不发布')
        return store.snapshot(created['id'])

    @router.post('/workspaces/{wid}/cable-reference')
    def bind(wid: str, body: BindModel):
        model = model_version(body.model_id, body.content_sha256)
        with store.db(True) as db:
            row, state = store.load(db, wid, body.expected_revision, allow_domain=True)
            if 'domain' not in state:
                raise HTTPException(409, '请先建立领域研究输入。')
            attach_model(state, model)
            store.commit(db, row, state, '引用并锁定系统演示型号版本')
        return store.snapshot(wid)

    return router
