"""IEC 60287-1-2:2023 §§4–7; controlled source tables stay outside the package."""
from hashlib import sha256
import json
from math import isfinite, pi, sqrt
from .method import RatingRefused
from .electrical import sheath_thickness_terms

TABLE_SHA256 = '5caaea3dec2be3c35c639ad89a021cb01c535175f3efcc1546dfaa642c6db143'
SOURCE_SHA256 = 'b8f8fbf7396254a70a2b222cd92668b1b7cef047d34f70524863b217144473e2'
M = [.1,.5,1.,1.5,2.,2.5,3.]
Z_H = [.1,.15,.2,.25,.3,.35,.4,.45,.5]
Z_J = [.1,.2,.3,.4,.5]
Y_N = [.1,.2,.3,.4,.5,.6,.7,.8,.9,1.]
Y_J = [.2,.4,.6,.8,1.]


def interpolate(axes, values, coordinates):
    """Multilinear interpolation within the supplied closed table cell, no extrapolation."""
    def blend(axis, point, rows, remaining):
        if not isfinite(point) or point < axis[0]-1e-10 or point > axis[-1]+1e-10:
            raise RatingRefused('DOUBLE_FLAT_TABLE_RANGE', 'IEC 1-2 的 m/z/y 超出来源表范围；用数值仿真插件（GetDP 涡流）计算护套损耗后，作为外部系数带入。')
        if len(rows) != len(axis):
            raise ValueError('系数表维度与坐标轴不一致。')
        point = min(axis[-1],max(axis[0],point))
        lo = next((i for i in range(len(axis)-1) if axis[i] <= point <= axis[i+1]),len(axis)-2)
        fraction = (point-axis[lo])/(axis[lo+1]-axis[lo])
        def val(i):
            return blend(axes[remaining],coordinates[remaining],rows[i],remaining+1) if remaining < len(axes) else rows[i]
        return (1-fraction)*val(lo)+fraction*val(lo+1)
    value = blend(axes[0],coordinates[0],values,1)
    if not isinstance(value,(int,float)) or not isfinite(value) or value < 0:
        raise ValueError('系数表产生非有限或负数值。')
    return value


def verified_tables(payload):
    if not isinstance(payload,dict) or payload.get('schema') != 'cablesim.iec60287-1-2-tables/1':
        raise RatingRefused('DOUBLE_FLAT_TABLES_MISSING','double_flat_tables：需导入带来源的 IEC 1-2:2023 表1–11；未使用猜测系数。')
    source = payload.get('source',{})
    tables = payload.get('tables',{})
    digest = sha256(json.dumps(tables,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()
    if source.get('sha256') != SOURCE_SHA256 or digest != TABLE_SHA256:
        raise RatingRefused('DOUBLE_FLAT_TABLES_INVALID','double_flat_tables：来源或完整性摘要与已复核表1–11不一致。')
    return tables


def eddy_factor(rs, rc, rho, thickness_m, outer_m, mean_m, frequency,
                spacing_m, separation_m, cable_index, direction, payload):
    """Per-position loss, including thickness terms gs/Gs; Rs/Rc are Ω/m."""
    m, z, y = 2*pi*frequency*1e-7/rs,mean_m/(2*spacing_m),spacing_m/separation_m
    cc0 = 6 if cable_index in (1,4) else 1.5
    lambda0 = cc0*m*m/(1+m*m)*z*z
    if m < .1:
        ch,cn,cj,gs,gs_term = 1.,1.,1.,1.,0.
    else:
        tables = verified_tables(payload)
        local = cable_index%3
        h_index = 2-local if direction == 'reverse' and cable_index >= 3 else local
        ch = interpolate([M,Z_H],tables['CH'][h_index],[m,z])
        cn = interpolate([Y_N],[row[cable_index] for row in tables['CN'][direction]],[y])
        j_index = cable_index if direction == 'forward' else min(cable_index,5-cable_index)
        cj = interpolate([Y_J,M,Z_J],tables['CJ'][direction][j_index],[y,m,z])
        gs,gs_term = sheath_thickness_terms(rho,thickness_m,outer_m,frequency)
    value = rs/rc*(lambda0*ch*cn*cj*gs+gs_term)
    return {'total':value,'circulating':0.,'eddy_raw':value,'eddy_factor_f':None,
            'sheath_r_ohm_m':rs,'basis':'IEC 60287-1-2:2023 4.2 / 6.2–6.5',
            'coefficients':{'m':m,'z':z,'y':y,'CH':ch,'CN':cn,'CJ':cj,'gs':gs,'Gs':gs_term},
            'table_sha256':TABLE_SHA256 if m >= .1 else None}


def geometry(group):
    """Figure 1: six horizontal positions, identical circuits, explicit relative phasors."""
    refuse = '双回必须满足 IEC 1-2 同型同负荷水平平排和相位识别；用数值仿真插件（GetDP 涡流）计算护套损耗后，作为外部系数带入。'
    if len(group.circuits) != 2 or any(c['arrangement'] != 'flat' or not c['automatic'] for c in group.circuits):
        raise RatingRefused('MULTICIRCUIT_ELECTRICAL_MODEL_REQUIRED',refuse)
    ids = sorted(range(6),key=lambda i:group.cables[i]['point'][0])
    if any(abs(group.cables[i]['point'][1]-group.cables[ids[0]]['point'][1])>1e-9 for i in ids):
        raise RatingRefused('DOUBLE_FLAT_GEOMETRY_REQUIRED',refuse)
    first,second = ids[:3],ids[3:]
    if len({group.cables[i]['circuit'] for i in first}) != 1 or len({group.cables[i]['circuit'] for i in second}) != 1:
        raise RatingRefused('DOUBLE_FLAT_GEOMETRY_REQUIRED',refuse)
    spacing = group.cables[first[1]]['point'][0]-group.cables[first[0]]['point'][0]
    if any(abs(group.cables[b]['point'][0]-group.cables[a]['point'][0]-spacing)>1e-9 for a,b in [(first[1],first[2]),(second[0],second[1]),(second[1],second[2])]):
        raise RatingRefused('DOUBLE_FLAT_GEOMETRY_REQUIRED',refuse)
    if len({json.dumps(group.cables[i]['rating'].model_dump(exclude={'installation'}),sort_keys=True) for i in ids}) != 1:
        raise RatingRefused('DOUBLE_FLAT_IDENTICAL_CABLES_REQUIRED',refuse)
    if len({group.cables[i]['current'] for i in ids}) != 1:
        raise RatingRefused('DOUBLE_FLAT_BALANCED_LOAD_REQUIRED',refuse)
    domain = {c['id']:c for c in group.document['circuits']}
    phase_index = {'A':0,'L1':0,'B':1,'L2':1,'C':2,'L3':2}
    def angles(cables):
        circuit = domain[group.cables[cables[0]]['circuit']]
        t = circuit.get('electrical_topology')
        if not t or not t.get('source',{}).get('reference'):
            raise RatingRefused('PHASE_TOPOLOGY_REQUIRED','electrical_topology：双回需要相序、共同参考相角（rad）和来源。')
        sign = -1 if t['phase_sequence'] == 'ABC' else 1
        return [t['reference_angle_rad']+sign*phase_index[group.cables[i]['phase']]*2*pi/3 for i in cables]
    a,b = angles(first),angles(second)
    close = lambda x,y:abs((x-y+pi)%(2*pi)-pi)<1e-8
    if not close(a[0]-a[1],a[1]-a[2]):
        raise RatingRefused('DOUBLE_FLAT_PHASE_IDENTIFICATION_REQUIRED',refuse)
    if not close(a[0]-a[1],2*pi/3):
        ids = list(reversed(ids));first,second=ids[:3],ids[3:];a,b=angles(first),angles(second)
    direction = 'forward' if all(close(x,y) for x,y in zip(a,b)) else 'reverse' if all(close(x,y) for x,y in zip(a,reversed(b))) else None
    if direction is None:
        raise RatingRefused('DOUBLE_FLAT_PHASE_IDENTIFICATION_REQUIRED',refuse)
    separation = abs(group.cables[first[2]]['point'][0]-group.cables[second[0]]['point'][0])
    return {'indices':ids,'spacing':spacing,'separation':separation,'direction':direction}
