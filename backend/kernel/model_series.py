"""Bundled public manufacturer facts, imported through the ordinary host API.

Only source registration and SI conversion live here. Geometry/resistance and
rating remain plugin work; incomplete factory records are never approved here.
"""
from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path

from .candidates import CableModelVersion

SERIES = Path(__file__).with_name('model_series_data')/'huayuan_yjv22.json'
UNITS = {'mm':(.001,'m'), 'mm2':(1e-6,'m2'), 'ohm/km':(.001,'ohm/m'), '1':(1,'1')}


def bundled_series():
    raw=SERIES.read_bytes();data=json.loads(raw)
    return data,sha256(raw).hexdigest()


def payloads():
    data,digest=bundled_series();factory=data['sources']['factory'];resistance=data['sources']['r20']
    for row in data['rows']:
        if len(row)!=len(data['columns']):raise ValueError('厂家系列列数与结构字段不一致。')
        facts={key:(value,unit) for (key,unit),value in zip(data['columns'],row)}
        area=facts.pop('area')[0];facts={**data['common_manufacturer_values'],**facts}
        values={}
        for key,(value,unit) in facts.items():
            scale,target=UNITS[unit]
            values[key]={'value':value*scale,'unit':target,
                         'basis':'standard_limit' if key=='r20' else 'manufacturer',
                         'source':'r20' if key=='r20' else 'factory'}
        p={'name':f'YJV22-8.7/15 kV 3×{area}','version':data['version'],'confirmed':False,
           'specification':{'manufacturer':data['manufacturer'],'designation':data['designation'],
               'u0_v':data['u0_v'],'voltage_v':data['voltage_v'],'cores':3,'area_m2':area*1e-6,
               'conductor':'copper_bare','values':values,
               'missing':['三芯成缆位置及节距','铜带接触/径向包络','填料热阻率','钢带间隙及磁导率']},
           'sources':{
               'factory':{'kind':'manufacturer','reviewed':False,'reference':
                   f"{factory['title']}；{factory['location']}；3×{area}行；{factory['url']}；下载{factory['downloaded']}；sha256:{factory['sha256']}"},
               'r20':{'kind':'standard','reviewed':False,'reference':
                   f"{resistance['title']}；{area} mm²标准上限；sha256:{resistance['sha256']}"},
               'bundle':{'kind':'asset','reviewed':False,'reference':f"宿主随附资料包 {data['id']} {data['version']}；sha256:{digest}；非厂家试验认证，未批准型号。"}}}
        yield CableModelVersion.model_validate(p).model_dump(mode='json')


def import_yjv22(api, method):
    data,digest=bundled_series()
    entries=[api('/api/domain-cable-models','POST',p) for p in payloads()]
    parameters=data['engineering_scenario']['parameters']
    completions={c['id']:{'method':{**method,'capability':'model-completion'},'parameters':deepcopy(parameters)} for c in entries}
    return {'id':data['id'],'version':data['version'],'sha256':digest,'candidates':entries,
            'candidate_completions':completions,'engineering_scope':data['engineering_scenario']['scope']}


def bundled_hv():
    """Public Qifan dimensions plus separately declared engineering references."""
    raw=(SERIES.parent/'qifan_yjlw03.json').read_bytes()
    return json.loads(raw),sha256(raw).hexdigest()


def hv_payload():
    data,digest=bundled_hv();payload=deepcopy(data['model'])
    sources=deepcopy(data['sources'])
    # Sources become saved domain provenance, not a claim of factory approval.
    payload['sources']={
        '/cable_type/cores/core~11/conductor/diameter':sources['factory'],
        '/cable_type/cores/core~11/conductor/r20':sources['factory'],
        '/cable_type/cores/core~11/layers':sources['installed_dimensions'],
        '/cable_type/cores/core~11/layers/4/corrugation_depth':sources['geometry_reference'],
        '/cable_type/cores/core~11/layers/4/corrugation_pitch':sources['geometry_reference'],
        '/materials':sources['standard'],
        '/materials/material~1buffer-qifan/thermal_resistivity':sources['buffer_reference'],
        'bundle':{'kind':'asset','reviewed':False,'reference':
                  f"{data['id']} {data['version']} sha256:{digest}；{data['scope']}"}}
    return CableModelVersion.model_validate(payload).model_dump(mode='json')


def hv_study_document(workspace):
    """Apply the published validation scenario; model facts stay bound to version."""
    from math import sqrt
    data,_=bundled_hv();scenario=data['scenario'];document=deepcopy(workspace['domain'])
    section=document['sections'][0];medium=section['medium']
    medium['surface_temperature']=scenario['surface_temperature_k']
    next(m for m in document['materials'] if m['id']==medium['material'])['thermal_resistivity']=scenario['soil_thermal_resistivity_k_m_w']
    radius=scenario['touching_trefoil_outer_diameter_m']/2
    centre=-scenario['centre_depth_m']
    positions=((0,centre+2*radius/sqrt(3)),(-radius,centre-radius/sqrt(3)),(radius,centre-radius/sqrt(3)))
    for placement,(x,z) in zip(section['placements'],positions):placement.update(x=x,z=z)
    section['layout_template'].update(depth=scenario['centre_depth_m'],spacing=2*radius)
    document['circuits'][0]['bonding']['kind']=scenario['bonding']
    document['provenance']['/sections']={'kind':'user','reviewed':False,'reference':scenario['reference']}
    document['provenance']['/load_cases']={'kind':'user','reviewed':False,'reference':scenario['reference']}
    return document
