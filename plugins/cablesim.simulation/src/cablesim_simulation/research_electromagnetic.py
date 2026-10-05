"""Sourced domain phase/bonding topology to native GetDP field/circuit constraints."""
from copy import deepcopy
from math import cos,sin,pi,isclose
from cablesim_sdk.domain import DomainDocument
from cablesim_sdk.simulation import Problem
from .problem_domain import electromagnetic


def prepare_domain(value,options):
    document=DomainDocument.model_validate(value)
    allowed={'section_id','load_id','bounds_m','background','material_states','probes_m','source'}
    if set(options)!=allowed:
        raise ValueError('electromagnetic_options：须明确截面/稳态负荷/外域/材料温度/测点和来源；相序与互联直接绑定已保存领域拓扑。')
    section=next((s for s in document.sections if s.id==options['section_id']),None)
    load=next((l for l in document.load_cases if l.id==options['load_id']),None)
    if section is None or load is None or load.kind!='steady' or load.profile:
        raise ValueError('electromagnetic_options.load_id：时谐护套损耗与稳态耦合须选择现有稳态负荷。')
    selected={p.cable for p in section.placements}
    circuits=[circuit for circuit in document.circuits if any(c.id in selected for c in circuit.cables)]
    types={item.id:item for item in document.cable_types}
    phase_degrees={};groups=[];bindings=[];material_by_region={}
    crossed=[]
    for circuit in circuits:
        topology=circuit.electrical_topology
        if topology is None:
            raise ValueError('circuits.'+circuit.id+'.electrical_topology：须保存相序、参考角和接线来源，不从标签猜相角。')
        if circuit.bonding.source is None:
            raise ValueError('circuits.'+circuit.id+'.bonding.source：须保存接线图或设计来源。')
        if circuit.bonding.kind not in ('both_ends','single_point','cross_bonded') or circuit.bonding.transposed:
            raise ValueError('circuits.'+circuit.id+'.bonding：仅支持明确单点、两端或三小段交叉互联；导体空间换位未覆盖。')
        cables=[c for c in circuit.cables if c.id in selected]
        if circuit.system.kind!='ac_three_phase' or len(cables)!=3 or {c.phase for c in cables} not in ({'A','B','C'},{'L1','L2','L3'}):
            raise ValueError('circuits.'+circuit.id+'.cables：当前拓扑接口要求完整的单回路三相单芯组。')
        cable_type=types[circuit.cable_type]
        if len(cable_type.cores)!=1 or cable_type.construction!='single_core':
            raise ValueError('cable_types.'+cable_type.id+'：当前领域电磁接口只翻译显式单芯圆形结构。')
        core=cable_type.cores[0];layers=core.layers+cable_type.common_layers
        metal_indices=[i for i,l in enumerate(layers) if l.role in ('metallic_screen','metallic_sheath','armour')]
        if not metal_indices:
            raise ValueError('cable_types.'+cable_type.id+'.layers：未找到实际护套/屏蔽层。')
        total_current=0j
        for cable in cables:
            position={'A':0,'L1':0,'B':1,'L2':1,'C':-1,'L3':-1}[cable.phase]
            angle=topology.reference_angle_rad+position*(-1 if topology.phase_sequence=='ABC' else 1)*2*pi/3
            phase_degrees[cable.id]=angle*180/pi
            current=load.currents.get(cable.id,load.currents.get(circuit.id))
            if current is None:raise ValueError('load_cases.'+load.id+'.currents.'+cable.id+'：缺少稳态电流，单位 A。')
            total_current+=current*complex(cos(angle),sin(angle))
            conductor=cable.id+'/conductor'
            sheath=[cable.id+f'/layer-{i}' for i in metal_indices if layers[i].role!='armour']
            armor=[cable.id+f'/layer-{i}' for i in metal_indices if layers[i].role=='armour']
            bindings.append({'entity':cable.id,'conductor_regions':[conductor],'sheath_regions':sheath,'armor_regions':armor})
            material_by_region[conductor]=core.conductor.material
            material_by_region.update({cable.id+f'/layer-{i}':layer.material for i,layer in enumerate(layers)})
        if abs(total_current)>1e-8*max(1.,sum(load.currents.get(c.id,load.currents.get(circuit.id,0.)) for c in cables)):
            raise ValueError('load_cases.'+load.id+'.currents：当前无大地回流模型，须给出相量和为零的三相电流。')
        for index in metal_indices:
            branch=[c.id+f'/layer-{index}' for c in cables]
            groups.extend([[uid] for uid in branch] if circuit.bonding.kind in ('single_point','cross_bonded') else [branch])
        if circuit.bonding.kind=='cross_bonded':
            if not isclose(sum(circuit.bonding.minor_section_lengths),section.length,rel_tol=1e-9):
                raise ValueError('circuits.'+circuit.id+'.bonding.minor_section_lengths：三个小段总长须等于当前 section.length，单位 m。')
            crossed.append(circuit)
    normalized=deepcopy(value)
    for circuit in normalized['circuits']:
        if circuit['id'] in {c.id for c in crossed}:
            circuit['bonding']={**circuit['bonding'],'kind':'single_point','minor_section_lengths':[],
                                'section_permutations':[]}
    parameters={**deepcopy(options),'phase_degrees':phase_degrees,'bonded_layers':groups}
    problem=electromagnetic(normalized,parameters)
    source_topology={c.id:{'electrical_topology':c.electrical_topology.model_dump(mode='json'),
                           'bonding':c.bonding.model_dump(mode='json')} for c in circuits}
    problem['provenance']['domain']['source_topology']=source_topology
    lengths=None
    if crossed:
        lengths=crossed[0].bonding.minor_section_lengths
        if any(any(not isclose(a,b,rel_tol=1e-9) for a,b in zip(c.bonding.minor_section_lengths,lengths)) for c in crossed[1:]):
            raise ValueError('bonding.minor_section_lengths：相邻回路须使用共同分段位置；不同分段需显式三维模型。')
        problem,bindings,material_by_region=segmented(problem,bindings,material_by_region,circuits,types,lengths)
    return Problem.model_validate(problem),bindings,material_by_region,source_topology,document,section


def segmented(problem,bindings,materials,circuits,types,lengths):
    """Three disconnected field slices, joined only by the actual sheath circuit."""
    base=deepcopy(problem)
    bounds=base['geometry'][0]['values'];width=bounds[2]-bounds[0]
    conducting={g['uid'] for g in base['geometry'] if g['material'].get('conductivity_s_m',0)>0}
    geometry=[];excitations=[];axial={};shifted_materials={}
    for segment,length in enumerate(lengths):
        offset=segment*width*2
        prefix=f'segment-{segment}/'
        for shape in base['geometry']:
            item=deepcopy(shape);item['uid']=prefix+shape['uid']
            item['values'][0]+=offset
            if item['kind']=='rectangle':item['values'][2]+=offset
            geometry.append(item)
            if shape['uid'] in conducting:axial[item['uid']]=length
            if shape['uid'] in materials:shifted_materials[item['uid']]=materials[shape['uid']]
        for excitation in base['excitations']:
            if all(uid.endswith('/conductor') for uid in excitation['regions']):
                item=deepcopy(excitation);item['regions']=[prefix+uid for uid in item['regions']];excitations.append(item)
    networks=[]
    for circuit in circuits:
        cables=[c for c in circuit.cables if c.id+'/conductor' in conducting]
        core=types[circuit.cable_type].cores[0]
        layers=core.layers+types[circuit.cable_type].common_layers
        for index,layer in enumerate(layers):
            regions=[c.id+f'/layer-{index}' for c in cables]
            if not set(regions)<=conducting:continue
            if circuit.bonding.kind=='single_point':
                excitations.extend({'regions':[f'segment-{segment}/'+uid],'kind':'current_rms_a','value':[0,0],
                                    'source':circuit.bonding.source.reference} for segment in range(3) for uid in regions)
                continue
            permutations=circuit.bonding.section_permutations if circuit.bonding.kind=='cross_bonded' else [[0,1,2]]*3
            branches=[]
            for branch in range(3):
                nodes=[1,3+branch*2,4+branch*2,2]
                for segment in range(3):
                    uid=f'segment-{segment}/'+regions[permutations[segment][branch]]
                    branches.append({'region':uid,'nodes':nodes[segment:segment+2]})
            networks.append({'id':circuit.id+f'/layer-{index}','branches':branches,'source':circuit.bonding.source.reference})
    mapped=[{**binding,**{name:[f'segment-{segment}/'+uid for segment in range(3) for uid in binding[name]]
        for name in ('conductor_regions','sheath_regions','armor_regions')}} for binding in bindings]
    base.update(geometry=geometry,excitations=excitations,axial_lengths_m=axial,electrical_networks=networks,
                probes_m=[],current_probes=[],
                assumptions=base['assumptions']+['Three independent cross-section field domains; exact native GetDP circuit continuity and KCL with actual segment voltage drops, no 3D bend or earth-return model.'])
    return base,mapped,shifted_materials
