"""Explicit SI features and immutable construction identity; no guessed inputs."""
from copy import deepcopy
from hashlib import sha256
import json
from math import hypot, isfinite

from cablesim_sdk.domain import DomainDocument
from cablesim_iec60287.domain import prepare
from cablesim_iec60287.group import rate_group
from cablesim_iec60287.group_inputs import GroupRating

VERSION = 'cablesim.hybrid-features/2'
NAMES = ['depth_m','soil_rho_k_m_w','ambient_temperature_k','phase_spacing_m',
         'current_a','neighbour_current_a','nominal_area_m2','conductor_diameter_m',
         'r20_ohm_m','circuits','backfill_rho_k_m_w','backfill_width_m','backfill_height_m',
         'duct_inner_diameter_m','duct_outer_diameter_m','iec_ampacity_a',
         'iec_temperature_k','depth_times_rho','load_ratio','circuit_spacing_m',
         'backfill_offset_x_m','backfill_offset_z_m','lower_soil_rho_k_m_w','interface_depth_m']
UNITS = ['m','K*m/W','K','m','A','A','m^2','m','ohm/m','1','K*m/W','m','m','m','m','A','K','K*m^2/W','1','m','m','m','K*m/W','m']


def digest(value):
    return sha256(json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode()).hexdigest()


def family(document):
    section=document['sections'][0]
    if section.get('soil_layers'):return 'layered_soil'
    if section.get('backfill'):return 'backfill'
    if section.get('enclosures'):return 'duct'
    return 'direct_double' if len(document['circuits'])==2 else 'direct_single'


def construction(document,iec):
    """Identity includes every unsampled cable/material/electrical assumption.

    Coordinates, currents and sampled soil/backfill rho live in the feature
    vector. Labels, provenance text and object IDs cannot change physics.
    """
    section=document['sections'][0]
    medium_ids={section['medium']['material']}
    if section.get('backfill'):medium_ids.add(section['backfill']['material'])
    medium_ids.update(layer['material'] for layer in section.get('soil_layers',[]))
    materials=[]
    for material in document['materials']:
        item={k:v for k,v in material.items() if k not in ('id','label')}
        if material['id'] in medium_ids:item.pop('thermal_resistivity',None)
        materials.append({'id':material['id'],'properties':item})
    cables=deepcopy(document['cable_types'])
    for cable in cables:cable.pop('label',None)
    electrical=[{k:v for k,v in c.items() if k not in ('id','label','cables')} for c in document['circuits']]
    def quantities(value):
        if isinstance(value,bool):return value
        if isinstance(value,(int,float)):return float(value)
        if isinstance(value,dict):return {k:quantities(v) for k,v in value.items()}
        if isinstance(value,list):return [quantities(v) for v in value]
        return value
    # IEC's loose parameter dictionary crosses JSON/TypeScript boundaries.
    # 1 and 1.0 have identical physical meaning; source/run byte hashes remain
    # separate and are never rewritten by this semantic identity.
    p=quantities({k:v for k,v in iec.items() if k not in ('solver','operation','target_current_a')})
    topology=[{k:v for k,v in layer.items() if k not in ('top_z','bottom_z','label')}
              for layer in section.get('soil_layers',[])]
    return digest({'cable_types':cables,'materials':materials,'electrical':electrical,'soil_layer_topology':topology,
                   'iec':p,'criteria':document.get('criteria',{}),'family':family(document)})


def baseline(value,parameters):
    document=DomainDocument.model_validate(value).model_dump(mode='json')
    if len(document['sections'])!=1 or len(document['load_cases'])!=1:
        raise ValueError('sections/load_cases：混合模型每次只接受一个稳态截面和一个负荷。')
    if document['sections'][0].get('soil_layers'):
        uniform=deepcopy(document);uniform['sections'][0]['soil_layers']=[]
        prepared=prepare(uniform,parameters)
    else:
        prepared=prepare(document,parameters)
    if not isinstance(prepared,GroupRating):
        raise ValueError('cable_types：当前混合模型仅训练单芯同心光滑护套模型。')
    result=rate_group(prepared)
    if document['sections'][0].get('soil_layers'):
        result['hybrid_baseline']={'kind':'uniform_soil_counterfactual','input_sha256':digest(uniform),
            'actual_input_sha256':digest(document),'purpose':'Explicit IEC homogeneous-soil counterfactual for residual learning; not a same-condition layered thermal result'}
    ratings=result['circuit_ratings']
    if not ratings or any(r.get('ampacity_a') is None for r in ratings):
        raise ValueError('iec：缺少同条件允许电流；不能用温度结果或失败边界替代基线。')
    return document,prepared,result


def extract(document,prepared,result,rated_circuit):
    circuit=next((c for c in prepared.circuits if c['id']==rated_circuit),None)
    if circuit is None:raise ValueError('rated_circuit：请选择保存的回路。')
    indices=circuit['indices']; selected=[prepared.cables[i] for i in indices]
    if len(selected)!=3 or circuit['arrangement']!='flat':
        raise ValueError('placements：本轮数据域为正间隙水平三相；品字形尚未训练。')
    depth=-selected[0]['point'][1]
    if any(abs(c['point'][1]+depth)>1e-9 for c in prepared.cables):
        raise ValueError('placements.z：本轮训练只覆盖同埋深水平布置。')
    sec=document['sections'][0];mat={m['id']:m for m in document['materials']}
    ctype=next(t for t in document['cable_types'] if t['id']==document['circuits'][0]['cable_type'])
    cond=ctype['cores'][0]['conductor']
    if any(c['cable_type']!=document['circuits'][0]['cable_type'] for c in document['circuits']):
        raise ValueError('circuits.cable_type：本轮训练仅覆盖相同结构的全部回路。')
    centers=[]
    for other in prepared.circuits:
        points=[prepared.cables[i]['point'] for i in other['indices']]
        if len(points)!=3 or other['arrangement']!='flat' or abs(other['spacing']-circuit['spacing'])>1e-9:
            raise ValueError('placements：训练域要求各回路同相中心距、水平平衡三相。')
        centers.append(sum(point[0] for point in points)/len(points))
    if len(centers)>2:raise ValueError('circuits：本轮最多训练双回。')
    loads=[c['current'] for c in selected]
    if max(loads)-min(loads)>1e-9:raise ValueError('load_cases.currents：训练域要求回路内三相平衡。')
    fill=sec.get('backfill'); duct=selected[0]['duct']
    soil=mat[sec['medium']['material']]['thermal_resistivity']
    current=loads[0];neighbours=[c['current'] for c in prepared.cables if c['circuit']!=rated_circuit]
    rating=next(r for r in result['circuit_ratings'] if r['entity']==rated_circuit)
    states=[s for s in result['operating']['cable_states'] if s['circuit']==rated_circuit]
    amp=rating['ampacity_a'];temperature=max(s['conductor_temperature_c'] for s in states)+273.15
    layers=sorted(sec.get('soil_layers',[]),key=lambda x:x['top_z'],reverse=True)
    values=[depth,soil,sec['medium']['surface_temperature'],circuit['spacing'],current,
        max(neighbours,default=0.),cond['nominal_area'],cond['diameter'],cond['r20'],len(prepared.circuits),
        mat[fill['material']]['thermal_resistivity'] if fill else 0.,fill['width'] if fill else 0.,
        fill['height'] if fill else 0.,duct['inner_diameter'] if duct else 0.,duct['outer_diameter'] if duct else 0.,
        amp,temperature,depth*soil,current/amp,abs(centers[1]-centers[0]) if len(centers)>1 else 0.,
        fill['x']-centers[0] if fill else 0.,fill['z']+depth if fill else 0.,
        mat[layers[1]['material']]['thermal_resistivity'] if layers else 0.,-layers[0]['bottom_z'] if layers else 0.]
    if not all(isfinite(v) for v in values):raise ValueError('features：含非有限值。')
    return values,{'ampacity_a':amp,'temperature_k':temperature,'rated_circuit':rated_circuit,
                   'limiting_cable':rating['limiting_cable'],
                   'kind':'uniform_soil_counterfactual' if layers else 'iec_same_condition'}
