"""Consume sealed temperature tensor coefficients; never extrapolate."""
from itertools import product
from math import isfinite
import re
from .method import RatingRefused


KEYS = {'lambda1','lambda2','ac_extra_factor'}


def number(value):
    return isinstance(value,(int,float)) and not isinstance(value,bool) and isfinite(value)


def validate(artifact, entities):
    if not re.fullmatch(r'[a-f0-9]{64}',str(artifact.get('resolved_source',{}).get('artifact_sha256',''))):
        raise ValueError('external_loss_artifact.resolved_source：缺少有效SHA256；真实性由宿主封存校验负责。')
    t = artifact.get('temperature_table', {})
    if artifact.get('validity',{}).get('kind') != 'temperature_tensor' or artifact['validity'].get('ampacity_iteration_allowed') is not True:
        raise ValueError('external_loss_artifact.validity：需要已校验的变温张量表。')
    axes = t.get('axes',[])
    if not 1 <= len(axes) <= 8 or t.get('interpolation') != 'multilinear' or t.get('extrapolation') != 'forbidden':
        raise ValueError('external_loss_artifact.temperature_table：轴数或插值方法无效。')
    seen=set()
    for a in axes:
        key=(a.get('entity'),a.get('state'));v=a.get('values_c',[])
        if key in seen or key[0] not in entities or key[1] not in ('conductor_temperature_c','sheath_temperature_c') or len(v)<2 or not all(number(x) and x > -273.15 for x in v) or any(x>=y for x,y in zip(v,v[1:])):
            raise ValueError('external_loss_artifact.temperature_table.axes：对象、状态或温度节点无效。')
        seen.add(key)
    if any((e,'conductor_temperature_c') not in seen for e in entities):
        raise ValueError('external_loss_artifact.temperature_table.axes：缺少导体温度轴。')
    expected=set(product(*(range(len(a['values_c'])) for a in axes)))
    rows=t.get('rows',[])
    if len(rows)!=len(expected) or {tuple(r.get('index',[])) for r in rows}!=expected:
        raise ValueError('external_loss_artifact.temperature_table.rows：温度网格不完整或节点重复。')
    for r in rows:
        if r.get('temperature_c') != [a['values_c'][i] for a,i in zip(axes,r['index'])] or set(r.get('coefficients',{}))!=entities:
            raise ValueError('external_loss_artifact.temperature_table.rows：节点温度或电缆绑定不一致。')
        for values in r['coefficients'].values():
            if set(values)!=KEYS or not all(number(v) and v>=0 for v in values.values()):
                raise ValueError('external_loss_artifact.temperature_table.rows：损耗系数必须为非负有限数。')
            if values['lambda2']!=0:
                raise RatingRefused('ARMOUR_THERMAL_PATH_NOT_SUPPORTED','temperature_table.lambda2：IEC当前无铠装热路，仅接受零铠装损耗。')
    refs=t.get('reference_current_a',{});span=t.get('current_scale_range',[])
    if set(refs)!=entities or not all(number(v) and v>0 for v in refs.values()) or len(span)!=2 or not all(number(v) for v in span) or not 0<=span[0]<=1<=span[1] or span[0]>=span[1]:
        raise ValueError('external_loss_artifact.temperature_table.current_scale_range：电流基准或倍率范围无效。')
    dc=t.get('dc_reference',{})
    if set(dc)!=entities or any(not number(v.get('r20_ohm_m')) or v['r20_ohm_m']<=0 or not number(v.get('alpha20_per_k')) or v['alpha20_per_k']<0 for v in dc.values()):
        raise ValueError('external_loss_artifact.temperature_table.dc_reference：缺少直流电阻/温度系数基准。')
    error=t.get('error',{})
    if error.get('kind')!='measured_cell_centres_not_global_bound' or not number(error.get('maximum_absolute')) or not number(error.get('acceptance_absolute')) or not 0<=error['maximum_absolute']<=error['acceptance_absolute']:
        raise ValueError('external_loss_artifact.temperature_table.error：缺少通过的独立插值误差检查。')
    checks=t.get('validation_points',[])
    centres=list(product(*[[(x+y)/2 for x,y in zip(a['values_c'],a['values_c'][1:])] for a in axes]))
    if len(checks)!=len(centres) or {tuple(c.get('temperature_c',[])) for c in checks}!=set(centres):
        raise ValueError('external_loss_artifact.temperature_table.validation_points：缺少网格单元中心校验。')
    nodes={tuple(r['index']):r['coefficients'] for r in rows};maximum=0.
    for check in checks:
        point=check['temperature_c'];values=check.get('coefficients',{})
        if set(values)!=entities or any(set(v)!=KEYS or not all(number(x) and x>=0 for x in v.values()) for v in values.values()):
            raise ValueError('external_loss_artifact.temperature_table.validation_points：中心点系数缺失或无效。')
        lower=[next(i for i,(x,y) in enumerate(zip(a['values_c'],a['values_c'][1:])) if (x+y)/2==v) for a,v in zip(axes,point)]
        corners=[nodes[tuple(i+b for i,b in zip(lower,bits))] for bits in product((0,1),repeat=len(axes))]
        maximum=max(maximum,max(abs(values[e][k]-sum(c[e][k] for c in corners)/len(corners)) for e in entities for k in KEYS))
    if maximum>error['acceptance_absolute'] or abs(maximum-error['maximum_absolute'])>1e-12*max(1,maximum):
        raise ValueError('external_loss_artifact.temperature_table.error：实际中心点误差与声明不符或超过容差。')
    return rows[0]['coefficients']


def check_materials(artifact, cables):
    for c in cables:
        reference=artifact['temperature_table']['dc_reference'][c['id']]
        conductor=c['rating'].conductor
        # Polygonal FEM area is finite; allow 0.5% discretization difference,
        # not a different strand/solid effective resistance or thermal law.
        if abs(reference['r20_ohm_m']/conductor.r20_ohm_m-1)>.005 or abs(reference['alpha20_per_k']-conductor.alpha20_per_k)>1e-8:
            raise ValueError('external_loss_artifact.temperature_table.dc_reference.'+c['id']+'：R20或温度系数与IEC输入不一致。')


def interpolate(artifact, cables, currents, temperatures, sheaths):
    t=artifact['temperature_table'];ids={c['id']:i for i,c in enumerate(cables)}
    scales=[currents[i]/t['reference_current_a'][c['id']] for i,c in enumerate(cables)]
    lo,hi=t['current_scale_range']
    if min(scales)<lo-1e-10 or max(scales)>hi+1e-10 or max(scales)-min(scales)>1e-7*max(1,max(scales)):
        raise RatingRefused('LOSS_COEFFICIENT_VALIDITY_EXCEEDED','temperature_table.current_scale_range：电流倍率越界或各电缆电流比例改变；请重算电磁工件。')
    brackets=[]
    for a in t['axes']:
        i=ids[a['entity']];value=(temperatures if a['state']=='conductor_temperature_c' else sheaths)[i];nodes=a['values_c']
        if value<nodes[0]-1e-9 or value>nodes[-1]+1e-9:
            raise RatingRefused('LOSS_COEFFICIENT_VALIDITY_EXCEEDED',f"temperature_table.axes.{a['entity']}.{a['state']}：{value:.6g}°C越出[{nodes[0]}, {nodes[-1]}]；未外推。")
        j=min(next((j for j in range(len(nodes)-1) if value<=nodes[j+1]),len(nodes)-2),len(nodes)-2)
        w=min(1.,max(0.,(value-nodes[j])/(nodes[j+1]-nodes[j])))
        brackets.append(((j,1-w),(j+1,w)))
    rows={tuple(r['index']):r['coefficients'] for r in t['rows']}
    result={e:{k:0. for k in KEYS} for e in ids}
    for corner in product(*brackets):
        weight=1.
        for _,w in corner:weight*=w
        row=rows[tuple(i for i,_ in corner)]
        for e in result:
            for k in KEYS:result[e][k]+=weight*row[e][k]
    return result
