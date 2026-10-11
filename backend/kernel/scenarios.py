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

from .presets import presets
from backend.domain.guards import check_locks, pointer
from backend.domain.migration import convert
from backend.domain.models import CableType, DomainDocument, Material
from backend.schemas import Scenario, StrictModel
from backend.kernel.workspace import Revision, fingerprint
from .contracts import CandidateCompletion


VERSION = '1.0.0'
METHOD_DEFAULTS = {
    'cablesim.thermal-network': {'conductor_kind': 'copper', 'ac_extra_factor': 0.05, 'screen_loss_factor': 0.05},
    'cablesim.iec60287': {'ks': 1.0, 'kp': 1.0, 't4_form': 'exact', 'eddy': 'ignored',
                        'duct': {'u': 1.87, 'v': .312, 'y_per_k': .0037, 'initial_mean_air_temperature_c': 40.0},
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
    medium = deepcopy(models[0])
    medium.update(id='system.cu-xlpe-10kv-240',version='1.0.0',name='6/10 kV · 1×240 · 光滑管套校核模型（结构演示）')
    medium['source'] = ('Tratos 官方 6/10 kV 结构表：铜 240 mm² 导体参考直径 18.2 mm、绝缘 3.4 mm、R20 0.0754 Ω/km。'
                        '厂家产品为铜丝屏蔽；此校核模型使用明示的 0.8 mm 光滑铝管套及 2.0 mm PVC 外套，不能视为该厂产品。'
                        ' https://tratosgroup.com/wp-content/uploads/2020/06/XLPE-Medium-Tension-Cable-mod2.pdf')
    cable = medium['payload']['cable_type']
    cable['label'] = medium['name']
    cable['rating'].update(u0=6000.0,u=10000.0,um=12000.0)
    cable['cores'][0]['conductor'].update(diameter=.0182,r20=7.54e-5)
    cable['common_layers'][1]['thickness'] = .0034
    cable['common_layers'][4]['thickness'] = .0020
    medium['payload']['materials'][4]['thermal_resistivity'] = 5.0
    medium['payload']['cable_type'] = CableType.model_validate(cable).model_dump(mode='json')
    medium['content_sha256'] = fingerprint(medium['payload'])
    models.append(medium)
    compacted = deepcopy(models[1])
    compacted.update(id='system.cu-xlpe-al-compacted-400', version='1.0.0',
                     name='YJL02-12/20 kV 1×400（紧压包络演示）')
    compacted['payload']['cable_type']['label'] = compacted['name']
    compacted['payload']['cable_type']['cores'][0]['conductor']['form'] = 'stranded_round_compacted'
    compacted['source'] += ' 此独立演示版本显式采用紧压导体设计外径包络；未给单丝制造参数和绞入系数，不据包络计算铜量。'
    models.append(compacted)
    specification = deepcopy(compacted)
    specification.update(id='system.specification-cu-xlpe-al-400', version='1.0.0',
                         name='YJL02-12/20 kV 1×400（规格书演示）')
    specification['source'] = ('规格书教学设计输入：第2类紧压铜导体、1.02绞入系数，材料密度与电气、短路及地下工况条件明确给定。'
                               '尺寸沿用系统结构演示；计算由已安装插件执行。非厂家实测、非完整产品认证，不自动批准发布。')
    payload = specification['payload']
    payload['cable_type']['label'] = specification['name']
    payload['cable_type']['cores'][0]['conductor'].update(conductor_class=2, r20_basis='design', lay_factor=1.02)
    payload['cable_type']['rating']['max_conductor_temperature']['short_circuit'] = 523.15
    for material, kind, density in zip(payload['materials'], ['copper_bare','other','XLPE','aluminium','PVC'], [8900,1100,920,2700,1400]):
        material.update(standard_kind=kind, density=density)
    reference = '规格书教学设计条件；仅用于真实代数流程演示，非厂家试验或现场输入。'
    electrical = {'temperature_k':363.15, 'frequency_hz':50, 'ks':1, 'kp':1,
                  'spacing_m':.0452, 'phase_voltage_v':12000, 'r20_length_basis':'finished_cable', 'arrangement':'trefoil'}
    short_circuit = {'duration_s':1, 'initial_temperature_k':363.15, 'final_temperature_k':523.15,
                     'metal_initial_temperature_k':343.15, 'metal_final_temperature_k':473.15,
                     'contact_factor':.7, 'inner_thermal_resistivity':2.5, 'outer_thermal_resistivity':3.5,
                     'inner_volumetric_heat_capacity':2e6, 'outer_volumetric_heat_capacity':2e6}
    for parameters in (electrical, short_circuit):
        parameters['sources'] = {key:reference for key in parameters}
    payload['specification_conditions'] = {
        'electrical':electrical, 'short_circuit':short_circuit,
        'rating':{'parameters':{**deepcopy(METHOD_DEFAULTS['cablesim.iec60287']), 'reference_basis':'iec2023', 'source':reference},
                  'rows':[{'case_id':layout, 'name':name, 'layout':layout, 'depth_m':.8,
                           'ambient_temperature_c':20, 'soil_rho_k_m_w':1, 'bonding':'both_ends', 'source':reference}
                          for layout,name in [('trefoil','直埋品字形'),('flat','直埋水平排列'),('ducts','排管品字形')]]}}
    models.append(specification)
    # Independent teaching version: public YJV22 dimensions, explicitly given
    # manufacturing/physical inputs. Never overwrite the manufacturer's candidate.
    mv = deepcopy(specification)
    mv.update(id='system.specification-yjv22-300', version='1.0.0', name='YJV22-8.7/15 3×300（规格书演示）')
    mv['source'] = ('公开结构：江苏华远YJV22 8.7/15kV结构表3×300行，http://jshydlyxgs.com/showproduct.asp?id=49；'
                    '2026-10-04下载，SHA256 e1eb8537ee1a836abbadb64415fd0838fe03d8d9a30e655bf3c0656b2b8bd957。'
                    '铜带连续接触与15%搭盖、导体1.02绞入系数、材料密度及镀锌钢带材质为教学设计假设；'
                    '成缆节距2.152m与钢带相对磁导率300分别参考TB880 Case2/10，非本型号实测；'
                    'R20取GB/T3956表2的设计上限，非测量值；材料热电参数采用IEC60287参考输入。')
    mats = [
        {'id':'material/cu','label':'铜','category':'conductor','standard_kind':'copper_bare','density':8900,
         'electrical_resistivity_20':1.7241e-8,'temperature_coefficient_20':.00393},
        {'id':'material/semi','label':'半导电材料','category':'semiconductor','standard_kind':'other','density':1100,'thermal_resistivity':2.5},
        {'id':'material/xlpe','label':'交联聚乙烯','category':'insulation','standard_kind':'XLPE','density':920,'thermal_resistivity':3.5,'relative_permittivity':2.5,'loss_tangent':.004},
        {'id':'material/filler','label':'纤维填充料','category':'filler','standard_kind':'other','density':1100,'thermal_resistivity':6},
        {'id':'material/pvc','label':'聚氯乙烯','category':'polymer','standard_kind':'PVC','density':1400,'thermal_resistivity':6},
        {'id':'material/steel','label':'镀锌钢带','category':'metal','standard_kind':'steel_galvanized','density':7850,'relative_permeability':300},
    ]
    cores=[]
    for index,(x,z) in enumerate([(0,.033/sqrt(3)),(-.0165,-.033/(2*sqrt(3))),(.0165,-.033/(2*sqrt(3)))]):
        cores.append({'id':f'core/{index+1}','x':x,'z':z,
            'conductor':{'material':'material/cu','form':'stranded_round_compacted','nominal_area':.0003,'diameter':.0206,
                         'r20':6.01e-5,'r20_basis':'design','conductor_class':2,'lay_factor':1.02},
            'layers':[{'role':role,'material':material,'thickness':thickness} for role,material,thickness in [
                ('conductor_screen','material/semi',.0008),('insulation','material/xlpe',.0045),('insulation_screen','material/semi',.0007)]]+
                [{'role':'metallic_screen','material':'material/cu','form':'tape','thickness':.0002,'nominal_tape_thickness':.0001,
                  'tape_width':.04,'tape_count':1,'overlap':.15,'tape_application':'helical_overlap',
                  'longitudinal_r20':.0014249338001803575,'longitudinal_resistance_basis':'dc'}]})
    cable={'id':'cable_type/ct1','label':mv['name'],'construction':'three_core','core_lay_length':2.152,
           'rating':{'u0':8700,'u':15000,'um':17500,'max_conductor_temperature':{'normal':363.15,'short_circuit':523.15}},
           'cores':cores,'common_layers':[
               {'role':'filler','material':'material/filler','thickness':.0002},
               {'role':'bedding','material':'material/pvc','form':'smooth','thickness':.002},
               {'role':'armour','material':'material/steel','form':'tape','thickness':.0016,'nominal_tape_thickness':.0008,
                'tape_count':2,'tape_width':.06,'tape_gap':.03,'tape_application':'two_tape_gap'},
               {'role':'oversheath','material':'material/pvc','form':'smooth','thickness':.0037}]}
    mv['payload']={'cable_type':CableType.model_validate(cable).model_dump(mode='json'),
                   'materials':[Material.model_validate(m).model_dump(mode='json') for m in mats],
                   'specification_conditions':deepcopy(payload['specification_conditions'])}
    conditions=mv['payload']['specification_conditions']
    conditions['electrical'].update(spacing_m=.033,phase_voltage_v=8700,core_lay_factor=sqrt(1+(2*3.141592653589793*.033/sqrt(3)/2.152)**2))
    conditions['electrical']['sources'].update({key:reference for key in ('spacing_m','phase_voltage_v','core_lay_factor')})
    conditions['rating']['parameters']['solver']['max_iterations']=300
    conditions['rating']['rows']=[{'case_id':kind,'name':name,'layout':kind,'depth_m':.8,'ambient_temperature_c':20,
                                  'soil_rho_k_m_w':1,'bonding':'both_ends','rating_basis':'simultaneous','source':reference}
        for kind,name in [('three_core_buried_single','三芯直埋单回'),('three_core_buried_horizontal','三芯直埋三回水平'),('three_core_ducts_horizontal','三芯排管三回水平')]]
    models.append(mv)
    # New system versions only: never rewrite saved user material facts/runs.
    dielectric_reference='IEC 60287-1-1:2023 Table 3，PDF43/印刷41页：未填充XLPE，U0≤18 kV档，εr=2.5、tanδ=0.004；标准参考值，非厂家实测。'
    for model in models:
        if model['payload']['cable_type']['rating']['u0']<=18000:
            changed=False
            for material in model['payload']['materials']:
                if material.get('category')=='insulation' and material.get('loss_tangent')==.001:
                    material['loss_tangent']=.004;changed=True
            if changed:
                major,minor,patch=map(int,model['version'].split('.'))
                model['version']=f'{major}.{minor}.{patch+1}'
                model['dielectric_reference']=dielectric_reference
                model['source']+='；'+dielectric_reference
    # Optional standards facts must not alter already named demo versions when
    # those facts are absent. Retain the pre-extension payload bytes/identities.
    for model in models:
        payload = model['payload']
        if payload['cable_type'].get('core_lay_length') is None:
            payload['cable_type'].pop('core_lay_length',None)
        for material in payload['materials']:
            if material.get('standard_kind') is None:
                material.pop('standard_kind', None)
        for core in payload['cable_type']['cores']:
            for key in ('conductor_class', 'r20_basis', 'sector_angle_deg', 'sector_rotation_deg'):
                if core['conductor'].get(key) is None:
                    core['conductor'].pop(key, None)
        for layer in [*payload['cable_type']['common_layers'], *(l for c in payload['cable_type']['cores'] for l in c['layers'])]:
            for key in ('minimum_thickness', 'maximum_thickness', 'mean_thickness', 'nominal_tape_thickness', 'tape_count', 'tape_application', 'minimum_overlap', 'reverse_binder_thickness', 'reverse_binder_width', 'reverse_binder_count', 'screen_inner_diameter', 'minimum_tape_thickness', 'longitudinal_r20', 'longitudinal_resistance_basis', 'longitudinal_resistance_frequency', 'tape_gap', 'mean_wire_diameter', 'padding_thickness', 'corrugation_depth', 'corrugation_pitch'):
                if layer.get(key) is None:
                    layer.pop(key, None)
        model['content_sha256'] = fingerprint(payload)
    return models


def engineering_examples():
    """Repeatable design inputs; all results are produced by a real saved run."""
    descriptions = [
        ('trefoil','110 kV 单回接触品字形直埋载流量校核',[600]),
        ('flat','110 kV 单回水平直埋载流量校核',[500]),
        ('double_trefoil','110 kV 双回品字形直埋出线载流量校核',[600,400]),
        ('double_flat','110 kV 双回水平直埋出线载流量校核',[450,300]),
        ('ducts','10 kV 单回接触品字形排管载流量校核',[200]),
        ('ducts_2x3','10 kV 排管 2×3 载流量校核',[220,160]),
        ('ducts_3x3','10 kV 排管 3×3 载流量校核',[200,150,180]),
        ('backfill','110 kV 矩形回填直埋载流量校核',[600]),
        ('duct_bank','10 kV 包封排管 3×3 载流量校核',[200,150,180]),
    ]
    return [{'id':kind,'layout':kind,'title':title,
             'model_id':'system.cu-xlpe-10kv-240' if '10 kV' in title and '110 kV' not in title else 'system.yjq02-110kv-800',
             'depth_m':1.2,'currents_a':currents,'soil_rho_k_m_w':1.2,'ambient_temperature_c':25.0,
             'source':'敷设与工况为可重复的设计假设：中心埋深 1.2 m、地表 25 °C、原土 1.2 K·m/W、所列负荷；未有现场勘测。型号尺寸及物性来源见绑定版本。',
             'verification':'插件运行后生成独立对数式热平衡与固定收敛损耗参数的允许电流手算核对表。'} for kind,title,currents in descriptions]


def apply_example(document, example):
    d = apply_layout(document,example['layout'],example['depth_m'])
    d['name'] = example['title']
    soil = next(m for m in d['materials'] if m['id'] == d['sections'][0]['medium']['material'])
    soil['thermal_resistivity'] = example['soil_rho_k_m_w']
    d['sections'][0]['medium']['surface_temperature'] = example['ambient_temperature_c']+273.15
    src = {'kind':'demo','reference':example['source'],'reviewed':False}
    d['provenance'][pointer('materials',soil['id'],'thermal_resistivity')] = src
    d['provenance'][pointer('sections',d['sections'][0]['id'],'medium','surface_temperature')] = src
    for circuit,current in zip(d['circuits'],example['currents_a']):
        d['load_cases'][0]['currents'][circuit['id']] = current
        circuit['system']['voltage'] = 10000.0 if example['model_id'] == 'system.cu-xlpe-10kv-240' else 110000.0
        d['provenance'][pointer('load_cases',d['load_cases'][0]['id'],'currents',circuit['id'])] = src
    if example['layout'] == 'duct_bank':
        material = next(m for m in d['materials'] if m['id'] == d['sections'][0]['backfill']['material'])
        material['thermal_resistivity'] = 1.0
        d['provenance'][pointer('materials',material['id'],'thermal_resistivity')] = {
            'kind':'standard','reference':'IEC 60287-2-1:2023 Table 1 混凝土参考值 1.0 K·m/W；实际配比需核实','reviewed':True}
    return DomainDocument.model_validate(d).model_dump(mode='json')


def study_models(store, include_incomplete=False):
    """Study-only catalog: system inputs plus complete immutable API candidates."""
    from backend.kernel.candidates import read
    entries=system_models()
    with store.db() as db:
        if db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='domain_cable_models'").fetchone() is None:
            return entries
        for row in db.execute('SELECT id FROM domain_cable_models ORDER BY created'):
            item=read(db,row['id']);p=item['payload']
            if not p.get('cable_type'):
                if include_incomplete and p.get('specification',{}).get('cores')==3 and p['specification']['voltage_v']==15000 and p['specification']['designation'] in ('YJV','YJV22'):
                    entries.append({'id':'candidate:'+item['id'],'version':p['version'],'name':p['name'],'state':item['state'],
                        'source':'；'.join(s['reference'] for s in p['sources'].values()),'content_sha256':item['digest'],'payload':p})
                continue
            cable=p['cable_type'];used={c['conductor']['material'] for c in cable['cores']}|{l['material'] for l in cable['common_layers']}|{l['material'] for c in cable['cores'] for l in c['layers']}
            defaults=deepcopy(METHOD_DEFAULTS)
            defaults['cablesim.iec60287']['solver']['max_iterations']=300
            entries.append({'id':'candidate:'+item['id'],'version':p['version'],'name':p['name'],'state':item['state'],
                'source':'；'.join(s['reference'] for s in p['sources'].values()),'content_sha256':item['digest'],
                'payload':{'cable_type':cable,'materials':[m for m in p['materials'] if m['id'] in used]},'method_defaults':defaults})
    return entries


def model_version(model_id, digest, store=None):
    model = next((m for m in (study_models(store) if store else system_models()) if m['id'] == model_id), None)
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


def attach_model(state, model, *, preserve_layout=False):
    document = deepcopy(state['domain'])
    if len(document['cable_types']) != 1:
        raise HTTPException(422, '当前引用入口支持单型号研究；请新建独立研究。')
    previous = state.get('study_cable_reference') or {}
    checked = {**state, 'locks': [p for p in state.get('locks', []) if p not in previous.get('locks', [])]}
    checked.pop('study_cable_reference', None)
    cable = deepcopy(model['payload']['cable_type'])
    if preserve_layout and cable['construction'] != document['cable_types'][0]['construction']:
        raise HTTPException(409, {'code': 'MODEL_LAYOUT_CHANGE_REQUIRED', 'message': '新版型号的芯数结构改变，请先核对截面布置再重算。'})
    cable['id'] = document['cable_types'][0]['id']
    document['cable_types'][0] = cable
    materials = {m['id']: m for m in document['materials']}
    materials.update({m['id']: deepcopy(m) for m in model['payload']['materials']})
    document['materials'] = list(materials.values())
    locks = list(leaf_paths(cable, pointer('cable_types', cable['id'])))
    for material in model['payload']['materials']:
        locks += list(leaf_paths(material, pointer('materials', material['id'])))
    reference = f"型号库 · {model['name']} · {model['version']} · sha256:{model['content_sha256']}" if model['id'].startswith('candidate:') else f"系统型号库 · {model['name']} · {model['version']} · 演示 · sha256:{model['content_sha256']}"
    for path in locks:
        document['provenance'][path] = {'kind': 'asset', 'reference': reference, 'reviewed': model['state']=='reviewed'}
    if model.get('conductor_diameter_source'):
        path = pointer('cable_types', cable['id'], 'cores', cable['cores'][0]['id'], 'conductor', 'diameter')
        document['provenance'][path] = {'kind': 'manufacturer', 'reference': model['conductor_diameter_source'], 'reviewed': False}
    if model.get('dielectric_reference'):
        for material in model['payload']['materials']:
            if material.get('category')=='insulation':
                document['provenance'][pointer('materials',material['id'],'loss_tangent')]={'kind':'standard','reference':model['dielectric_reference'],'reviewed':False}
    document['provenance'][pointer('cable_types', cable['id'])] = {'kind': 'asset', 'reference': reference+'；'+model['source'], 'reviewed': model['state']=='reviewed'}
    if cable['construction']=='three_core' and not preserve_layout:
        if len(document['circuits'])!=1:
            raise HTTPException(422,'多回路单芯布置不能在引用型号时自动合并为三芯；请新建三芯研究并选择对应模板。')
        circuit=document['circuits'][0];old={c['id'] for c in circuit['cables']};cid=circuit['cables'][0]['id']
        circuit['cables']=[{'id':cid,'phase':'L1L2L3'}]
        document['circuits']=[circuit]
        section=document['sections'][0];section.update(enclosures=[],backfill=None,soil_layers=[],placements=[{'cable':cid,'x':0.,'z':-1.2}])
        document['sections']=[section]
        for load in document['load_cases']:
            for key in old:load['currents'].pop(key,None)
    check_locks(checked, document)
    state['domain'] = DomainDocument.model_validate(document).model_dump(mode='json')
    state['locks'] = list(dict.fromkeys([*checked['locks'], *locks]))
    state['study_cable_reference'] = {k: deepcopy(model[k]) for k in ('id', 'version', 'name', 'state', 'source', 'content_sha256', 'payload', 'method_defaults')}
    state['study_cable_reference']['locks'] = locks
    state['study_cable_reference']['bound_cable_type_id'] = cable['id']


def apply_layout(document, kind, depth=0.8, spacing=None):
    if kind.startswith('three_core_'):
        return apply_three_core_layout(document,kind,depth,spacing)
    circuit, section = document['circuits'][0], document['sections'][0]
    cable = next(t for t in document['cable_types'] if t['id'] == circuit['cable_type'])
    diameter = 2*CableType.model_validate(cable).radius()
    spacing = (max(.15,diameter*1.5) if kind in ('flat','double_trefoil','double_flat','backfill') else diameter) if spacing is None else spacing
    section['enclosures'] = []
    section['backfill'] = None
    section['soil_layers'] = []
    section['kind'] = 'tunnel' if kind == 'tunnel' else 'air' if kind == 'tray' else 'ground'
    section['label'] = {'trefoil': '直埋单回 · 品字形', 'flat': '直埋单回 · 水平',
                        'double_trefoil': '直埋双回 · 留间隔品字形', 'double_flat': '直埋双回 · 水平',
                        'ducts': '排管截面', 'ducts_2x3': '排管 · 2×3', 'ducts_3x3': '排管 · 3×3',
                        'duct_bank': '包封排管 · 3×3', 'backfill': '矩形回填 · 留间隔品字形',
                        'tunnel': '隧道截面', 'tray': '桥架截面'}[kind]
    # A second circuit belongs to this template; never remove manually added circuits.
    if any(c['id'] not in ('circuit/template2','circuit/template3') for c in document['circuits'][1:]):
        raise HTTPException(422, '模板不能覆盖手工新增的回路，请保留当前布置并在图上调整。')
    document['circuits'] = [circuit]
    for load in document['load_cases']:
        load['currents'].pop('circuit/template2', None)
        load['currents'].pop('circuit/template3', None)
        for cid in list(load['currents']):
            if cid.startswith(('cable/template2-','cable/template3-')):
                load['currents'].pop(cid)
    count = 3 if kind in ('ducts_3x3','duct_bank') else 2 if kind in ('double_trefoil','double_flat','ducts_2x3') else 1
    for ci in range(2,count+1):
        other = deepcopy(circuit)
        other['id'], other['label'] = f'circuit/template{ci}', f'回路 {ci}'
        other['cables'] = [{**c, 'id': f'cable/template{ci}-{c["phase"]}'} for c in circuit['cables']]
        document['circuits'].append(other)
        for load in document['load_cases']:
            load['currents'][other['id']] = load['currents'][circuit['id']]
    if section['kind'] != 'ground':
        section['medium']['air_temperature'] = section['medium']['surface_temperature']
        section['medium']['ventilation'] = 'natural'
    ducted = kind in ('ducts','ducts_2x3','ducts_3x3','duct_bank')
    if ducted:
        outer, inner = (.075,.064) if kind == 'ducts' else (.16,.14)
        spacing = outer if kind == 'ducts' else max(.25,spacing)
        if diameter > inner:
            raise HTTPException(422, '所选演示管径容纳不了电缆，请选择更大的排管模板。')
        if not any(m['id'] == 'material/duct' for m in document['materials']):
            document['materials'].append({'id': 'material/duct', 'label': 'PVC 管材', 'category': 'duct', 'thermal_resistivity': 6.0})
        duct_material = next(m for m in document['materials'] if m['id'] == 'material/duct')
        duct_material['thermal_resistivity'] = 6.0
        document['provenance']['/materials/material~1duct/thermal_resistivity'] = {
            'kind': 'standard', 'reference': 'IEC 60287-2-1:2023 Table 1，PVC 管材 6.0 K·m/W', 'reviewed': True}
    rows = kind in ('ducts_2x3','ducts_3x3','duct_bank')
    positions = [(-spacing, -depth), (0.0, -depth), (spacing, -depth)] if kind in ('flat','double_flat','tunnel','tray') or rows else [
        (0.0, -depth+sqrt(3)*spacing/3), (-spacing/2, -depth-sqrt(3)*spacing/6), (spacing/2, -depth-sqrt(3)*spacing/6)]
    section['placements'] = []
    for ci, selected in enumerate(document['circuits']):
        shift = (ci-.5)*max(.6,4*spacing) if kind in ('double_trefoil','double_flat') else 0.0
        for i, (instance, (x, z)) in enumerate(zip(selected['cables'], positions)):
            if rows:
                z += (ci-(count-1)/2)*spacing
            enclosure = f'enclosure/duct-{ci*3+i+1}' if ducted else 'enclosure/template-tray' if kind in ('tunnel', 'tray') else None
            section['placements'].append({'cable': instance['id'], 'x': x+shift, 'z': z, 'enclosure': enclosure})
            if ducted:
                section['enclosures'].append({'id': enclosure, 'type': 'duct', 'material': 'material/duct', 'x': x, 'z': z,
                                              'inner_diameter': inner, 'outer_diameter': outer, 'contains': [instance['id']]})
    if kind in ('backfill','duct_bank'):
        width, height = (1.2,.6) if kind == 'backfill' else (1.2,1.0)
        region_id = 'material/concrete' if kind == 'duct_bank' else 'material/backfill'
        if not any(m['id'] == region_id for m in document['materials']):
            document['materials'].append({'id':region_id,'label':'混凝土包封' if kind == 'duct_bank' else '导热回填料',
                                          'category':'soil','thermal_resistivity': .8})
        section['backfill'] = {'id':'region/backfill','material':region_id,'x':0.0,'z':-depth,'width':width,'height':height}
        document['provenance'][pointer('materials',region_id,'thermal_resistivity')] = {
            'kind':'demo','reference':'算例设计假设：回填 / 包封热阻率 0.8 K·m/W，未有现场测量；使用前核实材料', 'reviewed':False}
    if kind in ('tunnel', 'tray'):
        section['enclosures'].append({'id': 'enclosure/template-tray', 'type': 'tray', 'x': 0.0, 'z': -depth-diameter/2-.05,
                                     'width': max(.4, diameter*5), 'height': .1, 'contains': [c['id'] for c in circuit['cables']]})
    section['layout_template'] = {'id': 'system.'+kind, 'version': VERSION, 'kind': kind, 'depth': depth, 'spacing': spacing}
    source = {'kind': 'demo', 'reference': f'系统截面模板 · {kind} · {VERSION}；位置与管材为演示输入', 'reviewed': False}
    for placement in section['placements']:
        for axis in ('x', 'z'):
            document['provenance'][pointer('sections', section['id'], 'placements', placement['cable'], axis)] = source
    return DomainDocument.model_validate(document).model_dump(mode='json')


def apply_three_core_layout(document,kind,depth,spacing=None):
    """One physical cable per balanced circuit; empty ducts are not heat sources."""
    d=deepcopy(document);first=d['circuits'][0];section=d['sections'][0]
    cable=next(t for t in d['cable_types'] if t['id']==first['cable_type'])
    if cable['construction']!='three_core' or len(first['cables'])!=1 or first['cables'][0]['phase']!='L1L2L3':
        raise HTTPException(422,'三芯模板要求每回路一根三芯电缆，电缆相别为ABC。')
    if any(c['id'] not in {f'circuit/template{i}' for i in range(2,10)} for c in d['circuits'][1:]):
        raise HTTPException(422,'模板不能覆盖手工新增回路，请保留当前截面。')
    diameter=2*CableType.model_validate(cable).radius()
    ducted=kind in ('three_core_ducts_horizontal','three_core_ducts_2x3','three_core_ducts_3x3')
    rows=2 if kind=='three_core_ducts_2x3' else 3 if kind=='three_core_ducts_3x3' else 1
    count=3*rows if ducted else 1 if kind=='three_core_buried_single' else 3
    spacing=max(.25,1.5*diameter) if spacing is None else spacing
    if spacing < (.16 if ducted else diameter):raise HTTPException(422,'回路中心距小于管道/电缆外径，请增大中心距。')
    if depth <= (rows-1)*spacing/2+(.08 if ducted else diameter/2):raise HTTPException(422,'地表以下埋深不足，请增大中心埋深。')
    if ducted and diameter>=.14:raise HTTPException(422,'电缆外径须小于140 mm管内径，请编辑管道尺寸。')
    # Remove only loads belonging to the previous template.
    known={c['id'] for c in d['circuits'][1:]}|{v['id'] for c in d['circuits'][1:] for v in c['cables']}
    for load in d['load_cases']:
        for cid in known:load['currents'].pop(cid,None)
    d['circuits']=[first]
    for i in range(2,count+1):
        other=deepcopy(first);other.update(id=f'circuit/template{i}',label=f'回路 {i}',cables=[{'id':f'cable/template{i}','phase':'L1L2L3'}]);d['circuits'].append(other)
        for load in d['load_cases']:load['currents'][other['id']]=load['currents'][first['id']]
    section.update(kind='ground',enclosures=[],placements=[],backfill=None,soil_layers=[])
    labels={'three_core_buried_single':'三芯直埋 · 单回','three_core_buried_horizontal':'三芯直埋 · 三回水平','three_core_ducts_horizontal':'三芯排管 · 三回水平','three_core_ducts_2x3':'三芯排管 · 2×3','three_core_ducts_3x3':'三芯排管 · 3×3'}
    section['label']=labels[kind]
    if ducted and not any(m['id']=='material/duct' for m in d['materials']):d['materials'].append({'id':'material/duct','label':'PVC管','category':'duct','thermal_resistivity':6.})
    for i,c in enumerate(d['circuits']):
        x=(i%3-1)*spacing if count>1 else 0.;z=-depth+(i//3-(rows-1)/2)*spacing
        cid=c['cables'][0]['id'];eid=f'enclosure/three-core-{i+1}' if ducted else None
        section['placements'].append({'cable':cid,'x':x,'z':z,'enclosure':eid})
        if ducted:section['enclosures'].append({'id':eid,'type':'duct','material':'material/duct','x':x,'z':z,'inner_diameter':.14,'outer_diameter':.16,'contains':[cid]})
    section['layout_template']={'id':'system.'+kind,'version':'1.0.0','kind':kind,'depth':depth,'spacing':spacing,
        'duct_grid':[2,3] if kind.endswith('2x3') else [3,3] if kind.endswith('3x3') else None,
        'occupied_cells':[[i//3,i%3] for i in range(count)] if ducted else []}
    source={'kind':'demo','reference':f'三芯截面模板{kind}：一管一缆、140/160 mm PVC管；位置、负荷与土壤按现场条件确认。','reviewed':False}
    for q in section['placements']:
        for axis in ('x','z'):d['provenance'][pointer('sections',section['id'],'placements',q['cable'],axis)]=source
    return DomainDocument.model_validate(d).model_dump(mode='json')


class ChooseModel(StrictModel):
    model_id: str
    content_sha256: str = Field(pattern='^[0-9a-f]{64}$')


class CreateStudyWorkspace(ChooseModel):
    project_name: str | None = Field(default=None,min_length=1,max_length=120,description='工程师填写的客户与工程名称；单位：无。未提供时保持原有教学研究命名。')
    candidate_completion: CandidateCompletion | None = None
    example_id: str | None = None
    three_core_layout: Literal['three_core_buried_single','three_core_buried_horizontal','three_core_ducts_horizontal','three_core_ducts_2x3','three_core_ducts_3x3'] | None = None
    target_current_a: float | None = Field(default=None,gt=0)


class BindModel(ChooseModel, Revision):
    pass


class LayoutPreview(Revision):
    document: DomainDocument
    kind: Literal['trefoil','flat','double_trefoil','double_flat','ducts','ducts_2x3','ducts_3x3','duct_bank','backfill','tunnel','tray','three_core_buried_single','three_core_buried_horizontal','three_core_ducts_horizontal','three_core_ducts_2x3','three_core_ducts_3x3']
    depth: float = Field(default=0.8, gt=0)
    spacing: float | None = Field(default=None, gt=0)


def make_router(store,research=None):
    router = APIRouter(prefix='/api/design', tags=['Study inputs'])

    @router.get('/cable-models')
    def models():
        return system_models()

    @router.get('/study-cable-models')
    def study_catalog():
        return study_models(store,include_incomplete=True)

    @router.get('/engineering-examples')
    def examples():
        return engineering_examples()

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
        if len(document['sections']) != 1 or len(document['circuits'][0]['cables']) != (1 if body.kind.startswith('three_core_') else 3):
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
    def create(body: CreateStudyWorkspace):
        body=CreateStudyWorkspace.model_validate(body.model_dump())
        if body.project_name is not None and not body.project_name.strip():raise HTTPException(422,{'code':'PROJECT_NAME_REQUIRED','path':'/project_name','message':'请填写客户与工程名称。'})
        if body.candidate_completion:
            from .candidates import read
            if research is None or not body.model_id.startswith('candidate:'):raise HTTPException(422,'请选择型号库原始规格后补工程参数。')
            with store.db() as db:item=read(db,body.model_id.removeprefix('candidate:'))
            if item['digest']!=body.content_sha256:raise HTTPException(409,'原始型号已变化，请重新选择。')
            prepared,error=research.complete_candidate(item,body.candidate_completion.model_dump(mode='json'))
            if error:raise HTTPException(422,error)
            p=prepared['payload'];defaults=deepcopy(METHOD_DEFAULTS);defaults['cablesim.iec60287']['solver']['max_iterations']=300
            model={'id':body.model_id,'name':p['name'],'version':p['version'],'state':'engineering_input','content_sha256':prepared['digest'],
                'source':'；'.join(s['reference'] for s in p['sources'].values()),'payload':p,'method_defaults':defaults,'prepared_candidate':prepared}
        else:model = model_version(body.model_id, body.content_sha256,store)
        example_id = getattr(body,'example_id',None)
        example = next((e for e in engineering_examples() if e['id'] == example_id),None)
        if example_id and (not example or example['model_id'] != model['id']):
            raise HTTPException(422,'敷设算例与型号版本不匹配，请重新选择。')
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
            if model.get('prepared_candidate'):state['engineering_model_reference']=deepcopy(model['prepared_candidate'])
            soil = next(m for m in state['domain']['materials'] if m['id'] == state['domain']['sections'][0]['medium']['material'])
            soil['thermal_resistivity'] = 1.0
            state['domain']['load_cases'][0]['currents'][state['domain']['circuits'][0]['id']] = body.target_current_a or 350.0
            state['domain']['sections'][0]['medium']['surface_temperature'] = 298.15
            state['domain']['circuits'][0]['bonding']['kind'] = 'both_ends'
            demo = {'kind': 'demo', 'reference': f'系统研究初始工况：{body.target_current_a or 350:g} A、25 °C、土壤 1.0 K·m/W；按实际条件核对', 'reviewed': False}
            for path in [pointer('materials', soil['id'], 'thermal_resistivity'),
                         pointer('sections', state['domain']['sections'][0]['id'], 'medium', 'surface_temperature'),
                         pointer('load_cases', state['domain']['load_cases'][0]['id'], 'currents', state['domain']['circuits'][0]['id']),
                         '/criteria/max_conductor_temperature']:
                state['domain']['provenance'][path] = demo
            if body.target_current_a is not None:
                state['domain']['provenance'][pointer('load_cases',state['domain']['load_cases'][0]['id'],'currents',state['domain']['circuits'][0]['id'])]={'kind':'user','reference':'新建问询目标电流，单位A','reviewed':False}
            state['domain']['provenance'][pointer('circuits', state['domain']['circuits'][0]['id'], 'bonding', 'kind')] = {
                'kind': 'demo', 'reference': '系统演示工况：护套两端接地；按实际接地方案核对', 'reviewed': False}
            state['domain']['name'] = f"{model['name']} · 直埋研究（演示）"
            state['scenario']['name'] = state['domain']['name']
            state['domain'] = apply_layout(state['domain'], body.three_core_layout or 'three_core_buried_single' if model['payload']['cable_type']['construction']=='three_core' else 'trefoil',depth=1.2 if model['payload']['cable_type']['construction']=='three_core' else .8)
            if example:
                state['domain'] = apply_example(state['domain'],example)
                state['scenario']['name'] = example['title']
                state['engineering_example'] = deepcopy(example)
            if body.project_name:
                state['domain']['name']=body.project_name.strip()
                state['scenario']['name']=state['domain']['name']
                state['domain']['provenance']['/name']={'kind':'user','reference':'工程师填写的客户与工程名称','reviewed':False}
            store.commit(db, row, state, '显式选择系统演示型号版本与直埋模板')
        return store.snapshot(created['id'])

    @router.post('/type-workspaces', status_code=201)
    def create_type(body: ChooseModel):
        created = create(CreateStudyWorkspace.model_validate(body.model_dump()))
        with store.db(True) as db:
            row, state = store.load(db, created['id'], created['revision'], allow_domain=True)
            binding = state.pop('study_cable_reference')
            state['locks'] = []
            state['type_origin_reference'] = {k: binding[k] for k in ('id', 'version', 'name', 'source', 'content_sha256')}
            declared = model_version(body.model_id, body.content_sha256, store)['payload'].get('specification_conditions')
            if declared:
                state['type_specification_conditions'] = deepcopy(declared)
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
        model = model_version(body.model_id, body.content_sha256,store)
        with store.db(True) as db:
            row, state = store.load(db, wid, body.expected_revision, allow_domain=True)
            if 'domain' not in state:
                raise HTTPException(409, '请先建立领域研究输入。')
            attach_model(state, model)
            store.commit(db, row, state, '引用并锁定系统演示型号版本')
        return store.snapshot(wid)

    return router
