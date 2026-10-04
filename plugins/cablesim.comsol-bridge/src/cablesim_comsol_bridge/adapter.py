"""Read native COMSOL data into the same public simulation artifact contract."""
import json
from math import hypot, isfinite, atan2, degrees
import numpy as np
from backend.foundation.simulation import validate
from backend.foundation.reproduction import digest
from .java_model import source
from .runtime import execute, SolverFailure


def prepare(value, parameters):
    allowed={'mesh','reproduction'}
    if set(parameters)-allowed:
        raise ValueError('parameters：仅接受 mesh 和 reproduction；不可由案例指定可执行文件、模型路径或 Java 表达式。')
    if 'mesh' not in parameters:
        raise ValueError('parameters.mesh：请提供近场尺寸、远场尺寸、过渡距离及节点上限，长度单位 m。')
    if parameters.get('reproduction',{}).get('missing_inputs'):
        raise ValueError('parameters.reproduction.missing_inputs：资料缺项未补齐，不能运行。')
    p,c=validate(value,parameters['mesh'])
    problem,controls=p.model_dump(mode='json'),c.model_dump(mode='json')
    source(problem,controls)  # Adapter-specific limits are checked before process start.
    return problem,controls


def parse(log, problem, solver):
    data={}
    for line in log.splitlines():
        if line.startswith('BRIDGE_DATA|'):
            _,key,raw=line.split('|',2)
            if key in data:raise SolverFailure('COMSOL 重复输出字段：'+key)
            try:data[key]=json.loads(raw)
            except ValueError as exc:raise SolverFailure('COMSOL 字段无法解析：'+key) from exc
    def array(key,dimensions):
        if key not in data:raise SolverFailure('COMSOL 缺少输出字段：'+key)
        result=np.asarray(data[key],dtype=float)
        if result.ndim!=dimensions or not np.isfinite(result).all():raise SolverFailure('COMSOL 输出维度错误或数值非有限：'+key)
        return result
    points=array('vertices',2).T;triangles=array('triangles',2).T
    native_ids=array('domain_ids',1)
    if points.shape[1]!=2 or triangles.shape[1]!=3 or len(native_ids)!=len(triangles):
        raise SolverFailure('COMSOL 原生网格不是二维三角形，未转换成近似网格。')
    if not np.equal(triangles,np.floor(triangles)).all() or np.any(triangles<0) or np.any(triangles>=len(points)):
        raise SolverFailure('COMSOL 网格节点索引无效。')
    triangles=triangles.astype(int)
    mapping={}
    for i,g in enumerate(problem['geometry']):
        for entity in array('region-'+str(i),1):
            if entity in mapping:raise SolverFailure('COMSOL 材料域映射重复。')
            mapping[entity]=i+1
    if set(native_ids)!=set(mapping):raise SolverFailure('COMSOL 网格与完整材料区域未一一绑定。')
    ids=[mapping[x] for x in native_ids]
    xy=points[triangles]
    signed=(xy[:,1,0]-xy[:,0,0])*(xy[:,2,1]-xy[:,0,1])-(xy[:,2,0]-xy[:,0,0])*(xy[:,1,1]-xy[:,0,1])
    if np.any(abs(signed)<1e-24):raise SolverFailure('COMSOL 返回退化三角形。')
    triangles[signed<0]=triangles[signed<0][:,[0,2,1]]
    edges={}
    for i,tri in enumerate(triangles):
        for a,b in ((tri[0],tri[1]),(tri[1],tri[2]),(tri[2],tri[0])):edges.setdefault(tuple(sorted((int(a),int(b)))),[]).append(i)
    if any(len(v)>2 for v in edges.values()):raise SolverFailure('COMSOL 网格含非流形边。')
    mesh={'schema':'cablesim.analysis-mesh/1','length_unit':'m','points':points.tolist(),
          'triangles':triangles.tolist(),'domain_ids':ids,
          'regions':[{'id':i+1,'uid':g['uid'],'material':g['material']} for i,g in enumerate(problem['geometry'])],
          'boundary_edges':[[a,b,owners[0],1] for (a,b),owners in edges.items() if len(owners)==1],
          'discretization':'COMSOL native curved quadratic physics; vertices/linear connectivity are the display mesh, not a P1 replacement solve'}
    mesh['sha256']=digest(mesh)
    field=array('field',3)
    transient=problem['physics']=='transient_heat'
    if field.shape[2]!=len(points) or (not transient and field.shape[1]!=1):raise SolverFailure('COMSOL 场值与网格节点数量不一致。')
    observations=[]
    def obs(quantity,entity,value,unit,**extra):
        if not isfinite(float(value)):raise SolverFailure('COMSOL 观测量非有限。')
        observations.append({'quantity':quantity,'entity':entity,'value':float(value),'unit':unit,**extra})
    result={'solver':solver,'execution':{'returncode':0,'completion_marker_verified':True},
            'mesh_sha256':mesh['sha256'],'problem_sha256':digest(problem),'engineering_approval':False}
    if problem['physics']=='magnetic_harmonic':
        if field.shape[0]!=2:raise SolverFailure('COMSOL 磁矢势必须有实部、虚部。')
        regions=[]
        for i,g in enumerate(problem['geometry']):
            sigma=g['material']['conductivity_s_m']
            if sigma<=0:continue
            v=array('integrals-'+str(i),2)
            if v.shape!=(5,1):raise SolverFailure('COMSOL 区域积分缺项。')
            re,im,joule,total,area=v[:,0];current=hypot(re,im)
            if area<=0 or joule<0 or total<joule-1e-8*max(1,joule):raise SolverFailure('COMSOL 区域面积或损耗不符合物理约束。')
            rdc=1/(sigma*area);rac=joule/current**2 if current>1e-8 and any(g['uid'] in e['regions'] and e['kind']=='current_rms_a' and any(e['value']) for e in problem['excitations']) else None
            regions.append({'entity':g['uid'],'current_complex_rms_a':[float(re),float(im)],'current_rms_a':current,
                            'joule_loss_w_m':float(joule),'magnetic_loss_w_m':float(max(0,total-joule)),
                            'dc_resistance_ohm_m':rdc,'ac_resistance_ohm_m':rac,'native_area_m2':float(area)})
            obs('current_rms_a',g['uid'],current,'A');obs('joule_loss_w_m',g['uid'],joule,'W/m')
            if rac is not None:obs('ac_resistance_ohm_m',g['uid'],rac,'ohm/m')
        obs('total_loss_w_m','all_conductors',sum(r['joule_loss_w_m']+r['magnetic_loss_w_m'] for r in regions),'W/m')
        if len(regions)==2:
            a,b=[complex(*r['current_complex_rms_a']) for r in regions]
            if abs(a)>1e-8 and abs(a+b)<1e-7*abs(a):obs('series_resistance_ohm_m','current-path',sum(r['joule_loss_w_m'] for r in regions)/abs(a)**2,'ohm/m')
        errors=[]
        for e in problem['excitations']:
            actual=[complex(*r['current_complex_rms_a']) for r in regions if r['entity'] in e['regions']]
            if e.get('connection')=='series':error=max(abs(v-actual[0]) for v in actual);scale=max(1,abs(actual[0]))
            elif e['kind']=='current_rms_a':
                expected=complex(e['value'][0],e['value'][1] if len(e['value'])>1 else 0)
                error=abs(sum(actual)-expected);scale=max(1,abs(expected))
            else:continue
            if error>1e-6*scale:raise SolverFailure('COMSOL 电流约束或互联连续性未满足。')
            errors.append({'regions':e['regions'],'absolute_error_a':error})
        probes=[];densities=[]
        for i,point in enumerate(problem['probes_m']):
            v=array('probe-'+str(i),3)
            if v.shape!=(4,1,1):raise SolverFailure('COMSOL 磁场测点缺项。')
            re=v[:2,0,0];im=v[2:,0,0];value=float(np.sqrt(re@re+im@im))
            probes.append({'point_m':point,'b_real_t':re.tolist()+[0.],'b_imag_t':im.tolist()+[0.],'b_rms_t':value})
            obs('magnetic_flux_density_rms','field',value,'T',probe_index=i,point_m=point)
        for i,p in enumerate(problem.get('current_probes',[])):
            v=array('current-probe-'+str(i),3)
            if v.shape!=(2,1,1):raise SolverFailure('COMSOL 电流密度测点缺项。')
            re,im=v[:,0,0];value=hypot(re,im)
            densities.append({'entity':p['region'],'point_m':p['point_m'],'j_complex_rms_a_m2':[float(re),float(im)],'j_rms_a_m2':value})
            obs('current_density_rms',p['region'],value,'A/m^2',probe_index=i,point_m=p['point_m'])
            obs('current_density_phase',p['region'],degrees(atan2(im,re)),'deg',probe_index=i,point_m=p['point_m'])
        result.update(regions=regions,probes=probes,current_density_probes=densities,current_constraint_errors=errors,
                      a_complex_wb_m=field[:,0,:].T.tolist(),phasor_convention='RMS; COMSOL native peak values divided by sqrt(2), native cycle-average losses retained')
    else:
        if field.shape[0]!=1:raise SolverFailure('COMSOL 热场必须只有温度变量。')
        times=array('times',2)[0] if transient else np.asarray([0.])
        if len(times)!=field.shape[1] or (transient and (np.any(np.diff(times)<=0) or times[0]!=0 or abs(times[-1]-problem['time']['step_s']*problem['time']['steps'])>1e-8)):
            raise SolverFailure('COMSOL 暂态时间证据与场帧不一致。')
        result['snapshots']=[]
        for i,t in enumerate(times):
            temperatures=field[0,i,:];maximum=float(temperatures.max())
            result['snapshots'].append({'time_s':float(t),'temperature_k':temperatures.tolist(),'maximum_k':maximum})
            obs('maximum_temperature_k','field',maximum,'K',time_s=float(t))
        result['final_field']=result['snapshots'][-1]
        if transient:
            for j,point in enumerate(problem['probes_m']):
                values=array('thermal-probe-'+str(j),3)
                if values.shape!=(1,len(times),1):raise SolverFailure('COMSOL 暂态测点帧缺项。')
                for i,t in enumerate(times):obs('probe_temperature_k','field',values[0,i,0],'K',time_s=float(t),probe_index=j,point_m=point)
    return mesh,result,observations


def solve(problem, controls, work, configuration=None):
    text=source(problem,controls)
    required=['COMSOL','ACDC' if problem['physics']=='magnetic_harmonic' else 'HEATTRANSFER']
    log,evidence=execute(text,work,required,configuration)
    mesh,result,observations=parse(log,problem,evidence)
    result['solver_files']={'BridgeJob.java':text,'solver.log':'\n'.join(line for line in log.splitlines() if not line.startswith('BRIDGE_DATA|'))}
    return mesh,result,observations
