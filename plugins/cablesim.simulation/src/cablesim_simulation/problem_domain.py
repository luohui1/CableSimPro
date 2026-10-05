"""Read-only SI domain mapping for magnetoquasistatic single-core sections."""
from math import cos,sin,pi
from cablesim_sdk.domain import DomainDocument
from .problem import Problem


def electromagnetic(value,options):
    required={'section_id','load_id','bounds_m','background','material_states','phase_degrees','bonded_layers','probes_m','source'}
    if set(options)!=required or not options['source']:
        raise ValueError('电磁领域适配需完整截面/负荷/外域、材料状态、相角、互联层与来源。')
    d=DomainDocument.model_validate(value)
    section=next((s for s in d.sections if s.id==options['section_id']),None)
    load=next((l for l in d.load_cases if l.id==options['load_id']),None)
    if section is None or load is None or load.kind!='steady' or load.profile:
        raise ValueError('时谐电磁需要已存在的稳态截面和负荷。')
    if section.enclosures or section.backfill or section.soil_layers:
        raise ValueError('此电磁领域适配尚未翻译包封/回填/土层，不能忽略这些区域。可改用完整统一问题描述。')
    materials={m.id:m for m in d.materials};types={t.id:t for t in d.cable_types}
    instances={c.id:(circuit,c) for circuit in d.circuits for c in circuit.cables}
    placed={p.cable for p in section.placements}
    if set(options['phase_degrees'])!=placed:
        raise ValueError('必须显式给出每根已选电缆的相角，不根据A/B/C猜相序。')
    frequency={instances[c][0].system.frequency for c in placed}
    if len(frequency)!=1 or next(iter(frequency))<=0:
        raise ValueError('同一时谐问题必须使用唯一正频率。')
    geometry=[{'uid':'environment','kind':'rectangle','values':options['bounds_m'],'material':options['background']}]
    excitations=[]
    if options['background'].get('conductivity_s_m',0)>0:
        raise ValueError('导电背景需指定电流/电压参考；请用完整统一问题描述。')
    used_materials=set();metal_uids=[]
    def material(mid):
        used_materials.add(mid)
        m=materials[mid]
        state=options['material_states'].get(mid)
        if not state or set(state)!={'temperature_k','nonconducting','source'} or not state['source']:
            raise ValueError('每种材料须声明温度、是否按非导体处理及其依据。')
        if m.relative_permeability is None:
            raise ValueError('缺少磁导率：'+mid)
        if state['nonconducting']:
            if m.category in ('conductor','metal'):
                raise ValueError('不能把领域中的金属材料静默改为非导体。')
            sigma=0
        else:
            if m.electrical_resistivity_20 is None or m.temperature_coefficient_20 is None or state['temperature_k']<=0:
                raise ValueError('缺少电阻率/温度系数/工作温度：'+mid)
            rho=m.electrical_resistivity_20*(1+m.temperature_coefficient_20*(state['temperature_k']-293.15))
            if rho<=0:
                raise ValueError('材料工作电阻率非正。')
            sigma=1/rho
        return {'conductivity_s_m':sigma,'relative_permeability':m.relative_permeability,'source':state['source']}
    for q in section.placements:
        circuit,instance=instances[q.cable];cable=types[circuit.cable_type]
        if len(cable.cores)!=1 or cable.construction!='single_core' or circuit.system.kind=='dc':
            raise ValueError('电磁领域映射只支持交流单芯。')
        if circuit.bonding.kind not in ('both_ends','single_point') or circuit.bonding.transposed:
            raise ValueError('领域映射只接受明确单点或两端且未换位的连接，其他拓扑尚未翻译。')
        core=cable.cores[0];cond=core.conductor
        if core.x or core.z or cond.inner_diameter or cond.form!='solid_round':
            raise ValueError('电磁领域映射要求显式实心圆导体；不自动把绞线/分割导体变为实心。')
        layers=core.layers+cable.common_layers
        metal_roles={'metallic_screen','metallic_sheath','armour'}
        if any(l.form not in (None,'smooth') or l.role in metal_roles and l.form!='smooth' for l in layers):
            raise ValueError('电磁层须为明确光滑同心层；丝/带屏蔽必须先建立有依据的等效模型。')
        radius=cond.diameter/2
        shapes=[{'uid':q.cable+'/conductor','kind':'disk','values':[q.x,q.z,radius],'material':material(cond.material)}]
        for i,l in enumerate(layers):
            radius+=l.thickness
            shapes.append({'uid':q.cable+f'/layer-{i}','kind':'disk','values':[q.x,q.z,radius],'material':material(l.material)})
        geometry.extend(reversed(shapes))
        current=load.currents.get(q.cable,load.currents.get(circuit.id))
        if current is None:
            raise ValueError('缺少电缆负荷。')
        angle=options['phase_degrees'][q.cable]*pi/180
        topology=circuit.electrical_topology
        if topology is not None:
            position={'A':0,'L1':0,'B':1,'L2':1,'C':-1,'L3':-1}.get(instance.phase)
            if position is None:
                raise ValueError('electrical_topology：当前只翻译三相A/B/C或L1/L2/L3。')
            expected=topology.reference_angle_rad+position*(-1 if topology.phase_sequence=='ABC' else 1)*2*pi/3
            if abs(complex(cos(angle),sin(angle))-complex(cos(expected),sin(expected)))>1e-9:
                raise ValueError('phase_degrees.'+q.cable+'：与领域electrical_topology的已保存相序/参考角不一致。')
        excitations.append({'regions':[shapes[0]['uid']],'kind':'current_rms_a','value':[current*cos(angle),current*sin(angle)],'source':options['source']})
        metal_uids.extend(s['uid'] for s in shapes[1:] if s['material']['conductivity_s_m']>0)
    if set(options['material_states'])!=used_materials:
        raise ValueError('材料状态必须完整且不含未使用材料。')
    joined=[]
    for group in options['bonded_layers']:
        if not group or any(u not in metal_uids for u in group):
            raise ValueError('互联引用未知导电层。')
        circuit_ids={instances[u.rsplit('/layer-',1)[0]][0].id for u in group}
        if len(circuit_ids)!=1:
            raise ValueError('不能把独立回路的护套隐式互联。')
        circuit=next(c for c in d.circuits if c.id in circuit_ids)
        if circuit.bonding.kind=='single_point' and len(group)!=1:
            raise ValueError('领域单点接地不允许非零环流互联组。')
        if circuit.bonding.kind=='both_ends' and len(group)!=len([c for c in circuit.cables if c.id in placed]):
            raise ValueError('两端互联组必须覆盖该截面同回路各根电缆。')
        joined+=group
        excitations.append({'regions':group,'kind':'current_rms_a','value':[0,0],'source':options['source']})
    if len(joined)!=len(set(joined)) or set(joined)!=set(metal_uids):
        raise ValueError('每个金属层须恰好归属一个互联组；单点接地用单区域零净电流组。')
    p={'schema_version':'cablesim.simulation-problem/1','physics':'magnetic_harmonic','geometry':geometry,
       'boundaries':[{'uid':'outer','selector':'outer','values':[],'kind':'magnetic_potential','value':0}],
       'excitations':excitations,'frequency_hz':next(iter(frequency)),'probes_m':options['probes_m'],
       'provenance':{'domain':{'source':options['source'],'source_schema':d.schema_version},
                     'electrical_topology':{c.id:{'phase':c.electrical_topology.model_dump(mode='json') if c.electrical_topology else None,
                                                  'bonding':c.bonding.model_dump(mode='json')} for c in d.circuits if any(i.id in placed for i in c.cables)}},
       'assumptions':['2D axial invariance; constant isotropic material states; RMS phasors; finite A=0 boundary; ideal explicit bonding groups.']}
    return Problem.model_validate(p).model_dump(mode='json')
