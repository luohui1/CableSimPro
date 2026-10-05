"""领域SI快照至多区域热模型；所有损耗/边界/缺失物性须显式绑定。"""
from copy import deepcopy
from math import isclose
from cablesim_sdk.domain import DomainDocument
from .thermal_input import ThermalModel


def from_domain(value,options):
    allowed = {'section_id','load_id','bounds_m','boundaries','per_cable','duct_air','source'}
    if set(options) != allowed:
        raise ValueError('领域研究需明确截面/负荷、边界、逐缆损耗、管内等效及来源。')
    d = DomainDocument.model_validate(value)
    sections = [s for s in d.sections if s.id == options['section_id']]
    loads = [l for l in d.load_cases if l.id == options['load_id']]
    if len(sections) != 1 or len(loads) != 1 or loads[0].kind != 'steady':
        raise ValueError('需要存在的截面和稳态负荷；暂态不适用。')
    section,load = sections[0],loads[0]
    if section.kind not in ('ground','air') or load.profile:
        raise ValueError('仅支持地下或孤立空气中的稳态截面。')
    if not isinstance(options['source'],str) or not options['source'].strip():
        raise ValueError('研究的电气与边界假设必须注明来源。')
    materials = {m.id:m for m in d.materials}
    types = {t.id:t for t in d.cable_types}
    instances = {c.id:(circuit,c) for circuit in d.circuits for c in circuit.cables}
    enclosures = {e.id:e for e in section.enclosures}
    if any(e.type != 'duct' or len(e.contains) != 1 for e in enclosures.values()):
        raise ValueError('管内IEC等效仅支持每根一管、同心圆管；包封可用回填表示。')
    placed = {p.cable for p in section.placements}
    if set(options['per_cable']) != placed:
        raise ValueError('逐缆损耗参数必须覆盖全部已选截面电缆且不能含多余项。')
    if set(options['duct_air']) != set(enclosures):
        raise ValueError('必须为每个排管绑定由IEC取得的空气热阻证据。')
    def k(material):
        m = materials[material]
        if m.thermal_resistivity is None:
            raise ValueError('材料缺少热阻率：'+material)
        if m.dry_thermal_resistivity is not None or m.critical_temperature_rise is not None:
            raise ValueError('不支持土壤干燥模型，不能忽略干湿物性。')
        return 1/m.thermal_resistivity
    cables = []
    for placement in section.placements:
        circuit,instance = instances[placement.cable]
        cable = types[circuit.cable_type]
        if cable.construction != 'single_core' or len(cable.cores) != 1:
            raise ValueError('同心层热场要求每根为单芯圆形电缆。')
        core = cable.cores[0]
        if core.x or core.z or core.conductor.inner_diameter or core.conductor.form in ('sectoral','hollow'):
            raise ValueError('偏心、空心、扇形几何未实现，不可静默等效。')
        spec = options['per_cable'][placement.cable]
        if set(spec) != {'electrical','fixed_layer_heat_w_m','prescribed_core_temperature_k','equivalent_layers_acknowledged'}:
            raise ValueError('逐缆参数字段不完整或未知。')
        layers = core.layers+cable.common_layers
        if any(l.form in ('wires','tape','corrugated') for l in layers) and not spec['equivalent_layers_acknowledged']:
            raise ValueError('丝/带/皱纹层须明确批准为同心等效热层，并给出等效物性。')
        layer_uids = [placement.cable+'/conductor']+[placement.cable+f'/layer-{i}' for i in range(len(layers))]
        if set(spec['fixed_layer_heat_w_m']) != set(layer_uids):
            raise ValueError('每层固定热源（包括明确的0）必须完整给出。')
        r = core.conductor.diameter/2
        fixed_t = spec['prescribed_core_temperature_k']
        normalized = [{'uid':layer_uids[0],'role':'conductor','outer_radius_m':r,
                       'k_w_m_k':None if fixed_t is not None else k(core.conductor.material),
                       'fixed_heat_w_m':spec['fixed_layer_heat_w_m'][layer_uids[0]]}]
        for i,l in enumerate(layers):
            r += l.thickness
            normalized.append({'uid':layer_uids[i+1],'role':l.role,'outer_radius_m':r,'k_w_m_k':k(l.material),
                               'fixed_heat_w_m':spec['fixed_layer_heat_w_m'][layer_uids[i+1]]})
        electrical = deepcopy(spec['electrical'])
        if electrical is not None:
            if set(electrical) != {'ac_extra_factor','sheath_loss_factor','sheath_layer_uid','source'}:
                raise ValueError('电阻来自领域事实，不能由方法参数覆盖。')
            electrical.update(r20_ohm_m=core.conductor.r20,
                              alpha20_per_k=materials[core.conductor.material].temperature_coefficient_20)
        current = load.currents.get(placement.cable,load.currents.get(circuit.id))
        if current is None:
            raise ValueError('所选负荷未给出电流：'+placement.cable)
        duct = None
        if placement.enclosure:
            e = enclosures[placement.enclosure]
            if e.contains != [placement.cable] or not isclose(e.x,placement.x,abs_tol=1e-10) or not isclose(e.z,placement.z,abs_tol=1e-10):
                raise ValueError('IEC管内等效仅接受同心、每根一管。')
            supplied = options['duct_air'][e.id]
            if set(supplied)-{'resistance_k_m_w','source','air_law'} or not {'resistance_k_m_w','source'} <= set(supplied):
                raise ValueError('管内等效必须给出热阻及IEC运行来源。')
            if e.inner_diameter is None or e.outer_diameter is None or e.material is None:
                raise ValueError('管壁几何/材料缺失。')
            duct = {'uid':e.id,'inner_radius_m':e.inner_diameter/2,'outer_radius_m':e.outer_diameter/2,
                    'k_w_m_k':k(e.material),'air_resistance_k_m_w':supplied['resistance_k_m_w'],'source':supplied['source']}
            if 'air_law' in supplied:
                duct['air_law'] = supplied['air_law']
        limit = d.criteria.get('max_conductor_temperature',cable.rating.max_conductor_temperature.get('normal'))
        if limit is None:
            raise ValueError('缺少导体温度上限。')
        cables.append({'uid':placement.cable,'circuit':circuit.id,'x_m':placement.x,'z_m':placement.z,
                       'layers':normalized,'current_a':current,'electrical':electrical,
                       'prescribed_core_temperature_k':fixed_t,'temperature_limit_k':limit,'duct':duct})
    environment = {'kind':'ground' if section.kind == 'ground' else 'isolated_cables',
                   'background':None,'soil_layers':[],'backfills':[],'boundaries':options['boundaries']}
    if section.kind == 'ground':
        if options['bounds_m'] is None or section.medium.material is None:
            raise ValueError('必须显式指定求解远场矩形和土壤材料。')
        bounds = options['bounds_m']
        environment['background'] = {'uid':section.id+'/soil','bounds_m':bounds,'k_w_m_k':k(section.medium.material)}
        surface = section.medium.surface_temperature
        bc = environment['boundaries'].get('top',{})
        if not isinstance(surface,(float,int)) or bc.get('temperature_k') != surface:
            raise ValueError('边界环境温度必须绑定领域保存值，不允许静默覆盖。')
        for l in section.soil_layers:
            lo,hi = max(bounds[1],l.bottom_z),min(bounds[3],l.top_z)
            if lo < hi:
                environment['soil_layers'].append({'uid':l.id,'bounds_m':[bounds[0],lo,bounds[2],hi],'k_w_m_k':k(l.material)})
        if section.backfill:
            b = section.backfill
            environment['backfills'].append({'uid':b.id,'bounds_m':[b.x-b.width/2,b.z-b.height/2,b.x+b.width/2,b.z+b.height/2],'k_w_m_k':k(b.material)})
    else:
        if options['bounds_m'] is not None or section.soil_layers or section.backfill:
            raise ValueError('孤立空气电缆不使用土壤域。')
        if environment['boundaries'].get('surface',{}).get('temperature_k') != section.medium.air_temperature:
            raise ValueError('空气环境温度须绑定领域值。')
    return ThermalModel.model_validate({'schema_version':'cablesim.thermal-model/1','cables':cables,
        'environment':environment,'provenance':{'domain':{'schema':'cablesim.domain/1','sources':{p:s.model_dump() for p,s in d.provenance.items()}},
                                               'method':{'source':options['source']}},
        'assumptions':['各电缆沿轴向无限长；各层为显式等效同心圆热域；常热导率',
                       '管内空气按有来源的IEC热阻转为同心环等效导热率；声明air_law时按两侧表面平均温度更新，否则固定热阻；未求流体']})
