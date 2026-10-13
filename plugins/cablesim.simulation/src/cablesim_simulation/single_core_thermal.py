"""Saved single-core thermal envelopes with IEC electrical loss feedback.

Corrugated radii follow IEC 60287-2-1:2023 4.1.2.1 and 4.1.5.1.
No change to saved centres, thicknesses, loss selectors or gap properties.
Point tangency is a zero-area ideal interface, not a measured contact patch.
"""
from math import hypot, log, pi
from cablesim_sdk.simulation import Problem
from cablesim_sdk.validation import FieldValueError
from .report import digest


def prepare(p, d, group):
    section=d['sections'][0]
    if section['soil_layers'] or section['backfill'] or section['enclosures']:
        raise FieldValueError('单芯波纹热场只覆盖均匀土壤直埋；土层、回填与排管未覆盖。','sections')
    materials={m['id']:m for m in d['materials']};types={t['id']:t for t in d['cable_types']}
    circuits={c['id']:c for c in d['circuits']};placements={q['cable']:q for q in section['placements']}
    bounds=list(p.domain_options.bounds_m)
    def material(mid):
        rho=materials[mid]['thermal_resistivity']
        if rho is None or rho<=0:
            raise FieldValueError('请补齐有来源的稳态热阻率，单位 K·m/W。','parameters','material_thermal_resistivity',mid)
        if materials[mid].get('dry_thermal_resistivity') is not None:
            raise FieldValueError('单芯波纹热场不覆盖土壤干燥。','materials')
        return {'k_w_m_k':1/rho,'source':p.domain_options.source+'; '+mid}
    geometry=[{'uid':'environment','kind':'rectangle','values':bounds,'material':material(section['medium']['material'])}]
    bindings=[]
    def disk(uid,x,z,r,m):return {'uid':uid,'kind':'disk','values':[x,z,r],'material':m}
    for c in group.cables:
        ct=types[circuits[c['circuit']]['cable_type']];core=ct['cores'][0];q=placements[c['id']];x,z=q['x'],q['z']
        layers=core['layers']+ct['common_layers'];r=core['conductor']['diameter']/2
        uid=c['id']+'/'+core['id']+'/conductor';conductors=[uid]
        shapes=[disk(uid,x,z,r,material(core['conductor']['material']))];screens=[];insulations=[]
        wave=c['rating'].sheath.corrugation;g=c['geometry']
        for i,layer in enumerate(layers):
            inner=r
            if layer['role']=='metallic_sheath' and wave:
                # Add the saved, sourced effective gap to the mean inner surface.
                mean_inner=(g.sheath_mean_m-c['rating'].sheath.thickness_m)/2
                if mean_inner<=r:raise FieldValueError('波纹平均内径必须大于已保存缓冲层外径。','cable_types')
                shapes.append(disk(c['id']+'/corrugation-gap',x,z,mean_inner,
                    {'k_w_m_k':1/wave.gap_rho_k_m_w,'source':wave.gap_source+'; IEC 60287-2-1:2023 4.1.2.1'}))
                r=mean_inner;inner=r
            r+=layer['thickness']
            # The outer corrugation extent belongs to the first outer serving
            # annulus, exactly as 4.1.5.1, rather than overlapping the metal.
            if wave and i>0 and layers[i-1]['role']=='metallic_sheath':r+=wave.depth_m/2
            uid=c['id']+'/'+core['id']+f'/layer-{i}'
            shapes.append(disk(uid,x,z,r,material(layer['material'])))
            if layer['role']=='metallic_sheath':screens.append(uid)
            if layer['role']=='insulation':insulations.append({'uid':uid,'center':[x,z],'inner':inner,'outer':r})
        if abs(2*r-g.overall_m)>1e-10:
            raise FieldValueError('有限元包络外径与保存波纹尺寸不一致，拒绝求解。','cable_types')
        if x-r<=bounds[0] or x+r>=bounds[2] or z-r<=bounds[1] or z+r>=bounds[3]:
            raise FieldValueError('计算域须包住所有保存电缆。','parameters','domain_options','bounds_m')
        geometry.extend(reversed(shapes))
        bindings.append({'entity':c['id'],'circuit':c['circuit'],'conductors':conductors,'screens':screens,
            'armour':None,'insulations':insulations,'centers':[[x,z]],'center_m':[x,z],'radius':r})
        cap=2*pi*8.8541878128e-12*c['rating'].insulation.relative_permittivity/log(g.over_insulation_m/g.over_inner_screen_m)
        c['model']={'wd':2*pi*c['rating'].frequency_hz*cap*c['rating'].phase_voltage_v**2*c['rating'].insulation.tan_delta}
    for i,a in enumerate(bindings):
        for b in bindings[i+1:]:
            distance=hypot(a['center_m'][0]-b['center_m'][0],a['center_m'][1]-b['center_m'][1])
            if distance<a['radius']+b['radius']-1e-10:
                raise FieldValueError('保存电缆包络重叠；不能用热层等效掩盖重叠。','sections')
    problem=Problem.model_validate({'schema_version':'cablesim.simulation-problem/1','physics':'steady_heat',
        'geometry':geometry,'boundaries':[{'uid':'outer','selector':'outer','values':[],'kind':'temperature','value':group.ambient+273.15}],
        'excitations':[],'provenance':{'domain_sha256':digest(d),'source':p.domain_options.source},
        'assumptions':['单芯圆形热包络；电损耗由保存 IEC 参数按导体和金属套平均温度反馈，非独立 Maxwell 损耗。',
            '相切外护套为零面积理想点接触，共形网格；未采用未测得的有限接触宽度或接触系数。',
            '波纹护套采用 IEC 60287-2-1:2023 4.1.2.1 平均内径及 4.1.5.1 外护层；保存的气隙等效热阻率不变。',
            '二维均匀环不能复现轴向波谷缓冲接触；差异研究不代表厂家实测接触模型。',
            'Side/bottom: '+p.outer_boundary+'; ground surface: saved isothermal ambient.']})
    return p,d,group,problem,bindings,[]


def thermal_state(prepared,system,temperature):
    from cablesim_iec60287.group import _resistance,_loss_details
    p,d,group,problem,bindings,ducts=prepared
    mesh,basis,ids,regions,weights,nodes,air,fixed_matrix,fixed_heat,D,free=system
    def mean(uid):return float(weights[uid]@temperature/weights[uid].sum())
    tc=[mean(b['conductors'][0])-273.15 for b in bindings]
    ts=[mean(b['screens'][0])-273.15 for b in bindings]
    spacings={i:c['spacing'] for c in group.circuits for i in c['indices']}
    resistance=[_resistance(c,tc[i],spacings[i]) for i,c in enumerate(group.cables)]
    losses=_loss_details(group,resistance,ts);load=fixed_heat.copy();states=[]
    for i,(c,b) in enumerate(zip(group.cables,bindings)):
        wc=c['current']**2*resistance[i];ws=wc*losses[i]['total']
        for uid,power in [(b['conductors'][0],wc),(b['screens'][0],ws)]:load+=power*weights[uid]/weights[uid].sum()
        states.append({'entity':b['entity'],'current_a':c['current'],'conductor_mean_temperature_k':tc[i]+273.15,
            'conductor_max_temperature_k':float(temperature[nodes[b['conductors'][0]]].max()),
            'conductor_joule_heat_w_m':wc,'screen_heat_w_m':ws,'armour_heat_w_m':0.,
            'dielectric_heat_w_m':c['model']['wd'],'lambda1':losses[i]['total'],'lambda2':0.,'electrical_details':losses[i]})
    return fixed_matrix.copy(),load,states,[]
