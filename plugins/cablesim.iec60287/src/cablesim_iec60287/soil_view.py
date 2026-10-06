"""Kennelly half-space view of the already solved operating losses.

No rating is recomputed, no loss is rescaled and no material is fitted. The IEC
external resistance is a mean-surface model, so the check compares the equal-angle
surface mean and separately discloses the nonuniform point temperature range.
"""
from hashlib import sha256
import json
from math import cos, sin, pi, hypot, log, fsum, isfinite
from pathlib import Path

from cablesim_sdk.simulation_artifacts import TemperatureField

SURFACE_TOLERANCE_K = .1
LIMITATIONS = [
    '均匀土壤半空间、地表等温于环境；Kennelly镜像线热源叠加，不替代有限元。',
    '只使用本次保存负荷工况已收敛的逐缆总损耗；不混用逐回路额定或同时额定损耗。',
    '排管外部按均匀土近似，管壁及管内区域不出值；矩形回填、分层土和接触品字形等效组不发布此均匀土场。',
    'IEC外部温度为周向平均模型；64等角外表面平均值误差须不大于0.1 K，同时记录周向最小与最大值。',
    '规则显示网格不是求解网格；热点仅为输出节点最大值，不表示连续极值或网格收敛。',
]


def digest(value):
    from cablesim_sdk.reproduction import digest as artifact_digest
    return artifact_digest(value)


def temperature_at(point, sources, rho, ambient_k):
    x,z=point
    if z>0:raise ValueError('显示场不能在地表以上采样。')
    terms=[]
    for source in sources:
        cx,cz=source['center_m']
        real=hypot(x-cx,z-cz);mirror=hypot(x-cx,z+cz)
        if real<=0:raise ValueError('线热源内部没有土壤温度值。')
        terms.append(source['loss_w_m']*rho/(2*pi)*log(mirror/real))
    return ambient_k+fsum(terms)


def exterior_geometry(group,payload):
    section=group.document['sections'][0]
    if section.get('soil_layers') or section.get('backfill') or group.soil.get('contact_trefoil'):
        raise ValueError('当前截面有土层、回填或接触品字形等效热阻，不发布均匀土壤场。')
    states={row['entity']:row for row in payload['operating']['cable_states']}
    if not states:raise ValueError('保存负荷的温度状态不可用，不能使用额定点替代。')
    materials={row['id']:row for row in group.document['materials']}
    rho=materials[section['medium']['material']]['thermal_resistivity']
    sources=[]
    for cable in group.cables:
        radius=cable['rating'].installation.duct.outer_diameter_m/2 if cable['duct'] else cable['geometry'].overall_m/2
        row=states[cable['id']]
        loss=row['total_loss_w_m']
        if not isfinite(loss) or loss<0:raise ValueError('本次总损耗不是非负有限W/m。')
        sources.append(dict(entity=cable['id'],center_m=list(cable['point']),radius_m=radius,
                            kind='duct-interior' if cable['duct'] else 'cable-interior',loss_w_m=loss,
                            reference_temperature_k=group.ambient+273.15+row['external_temperature_rise_k']))
    return sources,rho


def surface_checks(sources,rho,ambient_k):
    checks=[]
    for source in sources:
        x,z=source['center_m'];r=source['radius_m']
        values=[temperature_at((x+r*cos(i*2*pi/64),z+r*sin(i*2*pi/64)),sources,rho,ambient_k) for i in range(64)]
        mean=fsum(values)/len(values);error=abs(mean-source['reference_temperature_k'])
        if error>SURFACE_TOLERANCE_K:
            raise ValueError(f"{source['entity']}外表面平均温度误差{error:.6g} K超过0.1 K，未发布场；没有调参匹配。")
        checks.append(dict(entity=source['entity'],mean_temperature_k=mean,
                           reference_temperature_k=source['reference_temperature_k'],absolute_error_k=error,
                           surface_minimum_k=min(values),surface_maximum_k=max(values)))
    return checks


def _segment_distance(center,a,b):
    dx,dz=b[0]-a[0],b[1]-a[1]
    t=max(0,min(1,((center[0]-a[0])*dx+(center[1]-a[1])*dz)/(dx*dx+dz*dz)))
    return hypot(a[0]+t*dx-center[0],a[1]+t*dz-center[1])


def _triangle_clear(triangle,regions):
    for source in regions:
        center=source['center_m'];r=source['radius_m']
        cross=[(b[0]-a[0])*(center[1]-a[1])-(b[1]-a[1])*(center[0]-a[0]) for a,b in zip(triangle,triangle[1:]+triangle[:1])]
        if min(cross)>=0 or max(cross)<=0:return False
        if any(_segment_distance(center,a,b)<=r for a,b in zip(triangle,triangle[1:]+triangle[:1])):return False
    return True


def build(group,payload):
    sources,rho=exterior_geometry(group,payload);ambient_k=group.ambient+273.15
    checks=surface_checks(sources,rho,ambient_k)
    depth=max(-s['center_m'][1] for s in sources)
    margin=max(depth,4*max(s['radius_m'] for s in sources))
    left=min(s['center_m'][0]-s['radius_m'] for s in sources)-margin
    right=max(s['center_m'][0]+s['radius_m'] for s in sources)+margin
    bottom=min(s['center_m'][1]-s['radius_m'] for s in sources)-margin
    points=[];lookup={}
    # Fixed display sampling resolution; it never changes the IEC solve.
    for j in range(41):
        for i in range(61):
            point=(left+(right-left)*i/60,bottom*(1-j/40))
            if any(hypot(point[0]-s['center_m'][0],point[1]-s['center_m'][1])<=s['radius_m'] for s in sources):continue
            lookup[i,j]=len(points);points.append(list(point))
    triangles=[]
    for j in range(40):
        for i in range(60):
            for corners in [((i,j),(i+1,j),(i+1,j+1)),((i,j),(i+1,j+1),(i,j+1))]:
                if not all(corner in lookup for corner in corners):continue
                ids=[lookup[corner] for corner in corners]
                if _triangle_clear([points[n] for n in ids],sources):triangles.append(ids)
    mesh=dict(points=points,triangles=triangles,domain_ids=[1]*len(triangles),regions=[dict(id=1,label='均匀土壤')])
    mesh.update(sha256=digest(mesh),representation='61×41 regular display grid, triangular cells outside cable/duct interiors')
    values=[temperature_at(point,sources,rho,ambient_k) for point in points]
    index=max(range(len(values)),key=values.__getitem__)
    hotspot=dict(entity='soil',point_m=points[index],temperature_k=values[index],time_s=0,
                 method='maximum-of-exported-soil-nodes; not a continuous extremum')
    samples=[dict(entity=s['entity'],point_m=[s['center_m'][0]+s['radius_m'],s['center_m'][1]],
                  temperature_k=temperature_at((s['center_m'][0]+s['radius_m'],s['center_m'][1]),sources,rho,ambient_k),
                  time_s=0,method='exterior-surface point; surface mean checked separately') for s in sources]
    return dict(schema_version='cablesim.temperature-field/1',mesh=mesh,temperature_k=values,time_s=0,
                samples=samples,hotspot=hotspot,convergence={'mesh_status':'analytical_view_not_fem','surface_check':'passed'},
                analytical_soil_view=dict(model='kennelly-image-line-sources',condition='operating',
                    soil_thermal_resistivity_k_m_w=rho,limitations=LIMITATIONS,
                    excluded_regions=[{k:s[k] for k in ['entity','center_m','radius_m','kind']} for s in sources],
                    surface_check_method='mean-of-64-equal-angle-exterior-samples',surface_check_tolerance_k=.1,surface_checks=checks))


def attach(request,case,group,payload,out):
    """Write the trace first, then bind the optional field to its exact file bytes."""
    field=None
    try:
        field=build(group,payload)
        payload['soil_view']={'status':'available','condition':'operating','surface_checks':field['analytical_soil_view']['surface_checks'],
                              'surface_check_tolerance_k':.1,'limitations':LIMITATIONS}
    except (ValueError,KeyError,TypeError,AttributeError,ZeroDivisionError) as exc:
        payload['soil_view']={'status':'unavailable','reason':str(exc),'limitations':LIMITATIONS}
    manifest_path=Path(__file__).resolve().parents[2]/'plugin.json'
    manifest=json.loads(manifest_path.read_text('utf-8'))
    identity=dict(run_id=request['run_id'],case_id=case['case_id'],plugin_id=manifest['id'],plugin_version=manifest['version'],
                  capability=request['capability'],input_sha256=case.get('_source_input_sha256') or digest(case['input']),
                  manifest_sha256=sha256(manifest_path.read_bytes()).hexdigest())
    payload['source']=identity
    trace_name=case['case_id']+'.trace.json';trace_bytes=json.dumps(payload,ensure_ascii=False,allow_nan=False).encode()
    (out/trace_name).write_bytes(trace_bytes)
    artifacts=[{'path':'output/'+trace_name,'type':'x-cablesim.iec60287-trace'}]
    if field is not None:
        field['source']={**identity,'binding':'iec-trace','trace_sha256':sha256(trace_bytes).hexdigest()}
        field=TemperatureField.model_validate(field).model_dump(mode='json',exclude_none=True)
        name=case['case_id']+'.soil-field.json'
        (out/name).write_text(json.dumps(field,ensure_ascii=False,allow_nan=False),'utf-8')
        artifacts.append({'path':'output/'+name,'type':'x-cablesim.temperature-field'})
    return artifacts
