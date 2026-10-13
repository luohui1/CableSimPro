"""Resolved three-core/shared-soil history method; no duct-air model.

Backward Euler on the verified steady Problem and region bindings. All cores
retain independent mass, conduction and loss domains. The exterior data are a
saved steady Kennelly field plus signed E1 increments of accepted heat history.
This method API is not an engineering result or an IEC 60853 official example.
"""
from copy import deepcopy
from hashlib import sha256
from math import isfinite
from pathlib import Path
import os
from time import monotonic, process_time

from cablesim_sdk.validation import FieldValueError
from .report import digest
from .step_response import Capacity, image_step_rise
from .far_boundary import image_rise, loss_sources
from .three_core_thermal import _thermal_system, solve, thermal_state

METHOD_VERSION='1.0.0'


def method_digest():
    return sha256(Path(__file__).read_bytes()+Path(__file__).with_name('three_core_thermal.py').read_bytes()).hexdigest()


def history_rise(points, baseline, changes, k, capacity, time_s):
    """Signed piecewise-constant heat history; prehistory is steady, not zero.

    Each change is (start_s, list of delta-W/m sources). Negative increments
    describe cooling. E1 handles exterior soil only; internal regions use FEM.
    """
    import numpy as np
    if not isfinite(time_s) or time_s<0:raise ValueError('暂态时刻须为非负有限秒数。')
    answer=image_rise(points,baseline,1/k)
    previous=-1.
    for at,sources in changes:
        if not isfinite(at) or at<0 or at<previous:raise ValueError('损耗历史须按非负时刻排列。')
        previous=at
        for source in sources:
            q=source['loss_w_m']
            if not isfinite(q):raise ValueError('历史损耗增量须为有限 W/m。')
            if at<time_s and q:
                answer+=np.sign(q)*image_step_rise(points,[{**source,'loss_w_m':abs(q)}],k,capacity,time_s-at)
    return answer


def increments(previous,current):
    if len(previous)!=len(current) or any(a['center_m']!=b['center_m'] for a,b in zip(previous,current)):
        raise ValueError('暂态热源绑定发生变化，不能混用历史。')
    return [{**b,'loss_w_m':b['loss_w_m']-a['loss_w_m']} for a,b in zip(previous,current)]


class ResolvedHistory:
    def __init__(self, prepared, capacities, *, analysis_mesh=None, validation_parameters=False):
        if not os.environ.get('SLURM_JOB_ID'):raise ValueError('三芯暂态与网格组装只允许在 Slurm 上执行。')
        import numpy as np
        from skfem import BilinearForm,asm
        self.prepared=deepcopy(prepared)
        p,d,group,problem,bindings,ducts=self.prepared
        if ducts or d['sections'][0].get('enclosures'):
            raise FieldValueError('管内空气暂态尚未验证；本方法不接受排管。','sections','enclosures')
        section=d['sections'][0]
        if p.outer_boundary!='kennelly_image' or section.get('soil_layers') or section.get('backfill') or section['kind']!='ground':
            raise FieldValueError('暂态镜像边界只覆盖均匀土壤、恒温地表。','parameters','outer_boundary')
        if problem.geometry[0].values[3]!=0:raise ValueError('计算域地表须为 z=0。')
        self.capacities={uid:Capacity.model_validate(row) for uid,row in capacities.items()}
        if set(self.capacities)!={g.uid for g in problem.geometry}:
            raise FieldValueError('逐实际区域填写有来源的体积热容，不使用默认材料值。','capacities')
        if any(not isfinite(c.value_j_m3_k) for c in self.capacities.values()):raise ValueError('体积热容须有限。')
        self.validation_parameters=validation_parameters
        if any('方法验证参数' in c.reference for c in self.capacities.values()) and not validation_parameters:
            raise ValueError('方法验证参数不能用于工程暂态。')
        self.system=_thermal_system(self.prepared,analysis_mesh)
        self.mesh,self.basis,self.ids,self.regions,self.weights,self.nodes,_,self.K,self.fixed_heat,self.D,self.free=self.system
        @BilinearForm
        def mass(u,v,w):return w.c*u*v
        c=np.asarray([self.capacities[self.mesh['regions'][i-1]['uid']].value_j_m3_k for i in self.ids])[:,None]
        self.M=asm(mass,self.basis,c=c)
        self.ambient=group.ambient+273.15
        self.k=problem.geometry[0].material.k_w_m_k
        self.capacity=self.capacities[problem.geometry[0].uid].value_j_m3_k
        self.bindings=bindings
        self.identity=digest({'problem':problem.model_dump(mode='json'),'parameters':p.model_dump(mode='json'),
                              'bindings':bindings,'method_sha256':method_digest()})
        self.factor_cache={}

    def evaluate(self, temperature, currents, fixed_region_heat=None):
        import numpy as np
        circuits={b['circuit'] for b in self.bindings}
        if set(currents)!=circuits or any(not isfinite(v) or v<0 for v in currents.values()):
            raise FieldValueError('每回路须给出非负有限电流，单位 A。','currents_a')
        for cable,b in zip(self.prepared[2].cables,self.bindings):cable['current']=currents[b['circuit']]
        if fixed_region_heat is None:
            matrix,load,states,_=thermal_state(self.prepared,self.system,temperature)
            return matrix,load,loss_sources(states,self.bindings),states
        if not self.validation_parameters:raise ValueError('给定区域损耗只用于方法验证参数。')
        load=np.zeros(self.basis.N);sources=[]
        if not set(fixed_region_heat)<=set(self.weights):raise ValueError('给定损耗区域没有绑定。')
        for uid,heat in fixed_region_heat.items():
            if not isfinite(heat) or heat<0:raise ValueError('区域损耗须非负有限。')
            load+=heat*self.weights[uid]/self.weights[uid].sum()
            shape=next(g for g in self.prepared[3].geometry if g.uid==uid)
            if shape.kind!='disk':raise ValueError('线源解析核对只使用圆形热源。')
            sources.append({'center_m':shape.values[:2],'loss_w_m':heat})
        return self.K,load,sources,[]

    def freeze_preload(self, currents, *, fixed_region_heat=None):
        """Save full native mesh/DOFs and actual accepted steady temperature."""
        import numpy as np
        from scipy.sparse.linalg import splu
        if fixed_region_heat is None:
            cache={}
            _,_,values,_=solve(self.prepared,self.mesh,_cache=cache)
            temperature=np.asarray(values)
            if not np.allclose(cache['system'][1].doflocs,self.basis.doflocs,rtol=0,atol=1e-12):
                raise ValueError('保存稳态与暂态全网格不同；拒绝隐式投影。')
            initial_currents={b['circuit']:c['current'] for c,b in zip(self.prepared[2].cables,self.bindings)}
            if initial_currents!=currents:raise ValueError('预载电流须等于保存稳态输入。')
        else:
            matrix,load,sources,_=self.evaluate(np.full(self.basis.N,self.ambient),currents,fixed_region_heat)
            u=np.zeros(self.basis.N);u[self.D]=image_rise(self.basis.doflocs[:,self.D],sources,1/self.k)
            u[self.free]=splu(matrix[self.free][:,self.free].tocsc()).solve(load[self.free]-matrix[self.free][:,self.D]@u[self.D])
            temperature=u+self.ambient
        matrix,load,sources,states=self.evaluate(temperature,currents,fixed_region_heat)
        residual=float(np.max(np.abs((matrix@(temperature-self.ambient)-load)[self.free])))
        if residual>1e-5:raise ValueError('预载稳态残差未达标。')
        value={'schema':'cablesim.resolved-preload/1','method_version':METHOD_VERSION,'method_sha256':method_digest(),
            'model_sha256':self.identity,'mesh':self.mesh,'dof_points_m':self.basis.doflocs.T.tolist(),
            'temperature_k':temperature.tolist(),'currents_a':currents,'sources':sources,'states':states,
            'ambient_temperature_k':self.ambient,'physical_residual_inf_w_m':residual,
            'reference_kind':'method_validation_parameters' if self.validation_parameters else 'saved_steady_field',
            'input_sha256':digest(self.prepared[1]),'job_id':os.environ['SLURM_JOB_ID'],'engineering_approval':False}
        return {**value,'sha256':digest(value)}

    def restore_preload(self, saved):
        import numpy as np
        value={k:v for k,v in saved.items() if k!='sha256'}
        if saved.get('schema')!='cablesim.resolved-preload/1' or digest(value)!=saved.get('sha256'):
            raise ValueError('保存预载场摘要不一致，保留原数据并拒绝起算。')
        if saved['method_sha256']!=method_digest() or saved['model_sha256']!=self.identity or digest(saved['mesh'])!=digest(self.mesh):
            raise ValueError('预载与当前模型或全网格不一致；本轮不自动投影。')
        if saved['reference_kind']=='method_validation_parameters' and not self.validation_parameters:
            raise ValueError('方法验证预载不能用于工程。')
        points=np.asarray(saved['dof_points_m']);values=np.asarray(saved['temperature_k'])
        if points.shape!=self.basis.doflocs.T.shape or not np.allclose(points,self.basis.doflocs.T,rtol=0,atol=1e-12) or values.shape!=(self.basis.N,) or not np.isfinite(values).all() or np.any(values<=0):
            raise ValueError('保存预载不是当前完整原生自由度场，拒绝显示降采样场。')
        return values

    def bind_saved_preload(self, run, full_points_m, full_temperature_k):
        """Bind a host-verified steady run and its lossless decoded full arrays.

        Array checksums come from the saved bundle, never the display artifact.
        The same native mesh is mandatory; remeshing needs a separate validated
        conservative transfer method and is deliberately rejected here.
        """
        import numpy as np
        if run.get('integrity')!='verified' or run.get('status')!='succeeded':
            raise ValueError('初场须引用宿主摘要核验通过的成功稳态运行。')
        method=run['snapshot']['definition']['method']
        if method['plugin_id']!='cablesim.simulation' or method['capability']!='iec-thermal-field':
            raise ValueError('初场来源不是同口径三芯稳态有限元。')
        cases=run['output']['cases']
        if len(cases)!=1 or cases[0]['status']!='succeeded':raise ValueError('初场须为单工况成功稳态结果。')
        case=cases[0];bundle=case['artifacts'].get('x-cablesim.simulation-bundle')
        if not bundle or not case.get('artifact_digests',{}).get('x-cablesim.simulation-bundle'):
            raise ValueError('初场缺少经过摘要核验的保存仿真工件。')
        if digest(bundle.get('problem'))!=digest(self.prepared[3].model_dump(mode='json')) or bundle['parameters'].get('outer_boundary')!='kennelly_image':
            raise ValueError('初场与当前几何、材料或边界不同，拒绝隐式重建。')
        arrays=bundle['field_storage']['arrays']
        points=np.asarray(full_points_m,dtype='<f8');temperature=np.asarray(full_temperature_k,dtype='<f8')
        for name,array in [('points',points),('temperature_k',temperature)]:
            descriptor=arrays[name]
            if list(array.shape)!=descriptor['shape'] or sha256(array.tobytes()).hexdigest()!=descriptor['sha256']:
                raise ValueError('全场数组摘要或尺寸不匹配，不能使用显示降采样场。')
        if points.shape!=self.basis.doflocs.T.shape or not np.allclose(points,self.basis.doflocs.T,rtol=0,atol=1e-12):
            raise ValueError('保存全场自由度与原生网格不同，本方法不自动投影。')
        if not np.isfinite(temperature).all() or np.any(temperature<=0):raise ValueError('保存初温含非法 K 值。')
        currents={b['circuit']:c['current'] for c,b in zip(self.prepared[2].cables,self.bindings)}
        K,load,sources,states=self.evaluate(temperature,currents)
        residual=float(np.max(np.abs((K@(temperature-self.ambient)-load)[self.free])))
        boundary_error=float(np.max(np.abs(temperature[self.D]-self.ambient-image_rise(self.basis.doflocs[:,self.D],sources,1/self.k))))
        if residual>1e-5 or boundary_error>.1:raise ValueError('保存预载与当前稳态热平衡/远场边界不一致。')
        value={'schema':'cablesim.resolved-preload/1','method_version':METHOD_VERSION,'method_sha256':method_digest(),
            'model_sha256':self.identity,'mesh':self.mesh,'dof_points_m':points.tolist(),'temperature_k':temperature.tolist(),
            'currents_a':currents,'sources':sources,'states':states,'ambient_temperature_k':self.ambient,
            'physical_residual_inf_w_m':residual,'reference_kind':'saved_steady_field','engineering_approval':False,
            'source_run_id':run['id'],'source_output_sha256':run['output_digest'],'source_method':method,
            'input_sha256':digest(self.prepared[1]),'job_id':os.environ['SLURM_JOB_ID']}
        return {**value,'sha256':digest(value)}

    def march(self,saved,schedule,times,*,fixed_heat_history=None,probe_m=None,wall_limit_s=600,cpu_limit_s=600):
        """Accept only complete circuit schedules, every discontinuity on grid.

        The caller freezes wall/CPU limits before this level. The Slurm wall
        limit is the hard outer bound; checks below stop between solves.
        """
        import numpy as np
        from scipy.sparse.linalg import splu
        if not 0<wall_limit_s<=3600 or not 0<cpu_limit_s<=3600:raise ValueError('本级上限须在 0–3600 秒内。')
        begin=monotonic();cpu=process_time();times=np.asarray(times,dtype=float)
        if len(times)<2 or times[0]!=0 or not np.isfinite(times).all() or np.any(np.diff(times)<=0):raise ValueError('时间轴须从 0 s 严格递增。')
        starts=[r['time_s'] for r in schedule]
        if not starts or starts[0]!=0 or any(not isfinite(t) or t<0 for t in starts) or any(b<=a for a,b in zip(starts,starts[1:])) or any(t not in times for t in starts):
            raise ValueError('每次负荷阶跃须唯一、递增且落在时间轴上。')
        if fixed_heat_history is not None and len(fixed_heat_history)!=len(schedule):raise ValueError('给定损耗须逐负荷段绑定。')
        # Validate all later segments before calculating the first step.
        initial=self.restore_preload(saved);u=initial-self.ambient
        for i,row in enumerate(schedule):self.evaluate(initial,row['currents_a'],None if fixed_heat_history is None else fixed_heat_history[i])
        baseline=saved['sources'];previous=baseline;changes=[];rows=[];balance=0.;residual=0.;iterations=0
        probe=self.basis.probes(np.asarray(probe_m)[:,None]) if probe_m is not None else None
        def record(t,temperature):
            cores=[{'circuit_id':b['circuit'],'cable_id':b['entity'],'region':uid,
                    'temperature_k':float(temperature[self.nodes[uid]].max()),
                    'hotspot_m':self.basis.doflocs[:,self.nodes[uid][np.argmax(temperature[self.nodes[uid]])]].tolist()}
                   for b in self.bindings for uid in b['conductors']]
            return {'time_s':float(t),'conductors':cores,'maximum_temperature_k':max(r['temperature_k'] for r in cores),
                    'probe_temperature_k':float((probe@temperature)[0]) if probe is not None else None}
        rows.append(record(0.,initial))
        for a,t in zip(times,times[1:]):
            dt=float(t-a);segment=max(i for i,s in enumerate(starts) if s<=a)
            fixed=None if fixed_heat_history is None else fixed_heat_history[segment]
            current=schedule[segment]['currents_a'];guess=u.copy()
            for iteration in range(80):
                if monotonic()-begin>wall_limit_s or process_time()-cpu>cpu_limit_s:raise TimeoutError('本级冻结的暂态核时/墙钟上限已到；不继续加密。')
                K,load,sources,states=self.evaluate(guess+self.ambient,current,fixed)
                boundary=history_rise(self.basis.doflocs[:,self.D],baseline,changes+[(float(a),increments(previous,sources))],self.k,self.capacity,float(t))
                A=K+self.M/dt;right=load+self.M@u/dt
                factor=self.factor_cache.get(dt)
                if factor is None:
                    factor=splu(A[self.free][:,self.free].tocsc())
                    # Bounded cache: no retaining one LU for every variable dt.
                    self.factor_cache.clear();self.factor_cache[dt]=factor
                proposal=np.zeros(self.basis.N);proposal[self.D]=boundary
                proposal[self.free]=factor.solve(right[self.free]-A[self.free][:,self.D]@boundary)
                change=float(np.max(np.abs(proposal-guess)));guess=proposal
                if change<=1e-7:break
            else:raise ValueError('当前时间步的电阻/护层损耗反馈未收敛，原预载保留。')
            K,load,sources,states=self.evaluate(guess+self.ambient,current,fixed)
            r=K@guess+self.M@(guess-u)/dt-load
            physical=float(np.max(np.abs(r[self.free])))
            if physical>1e-5:raise ValueError('暂态当前时间步能量残差未达标。')
            storage=float(np.sum(self.M@(guess-u))/dt);power=float(load.sum());outflow=-float(r[self.D].sum())
            error=abs(storage+outflow-power)/max(abs(power),abs(storage),1.)
            if error>1e-6:raise ValueError('暂态能量守恒未达标。')
            balance=max(balance,error);residual=max(residual,physical);iterations+=iteration+1
            changes.append((float(a),increments(previous,sources)));previous=sources;u=guess
            row=record(t,u+self.ambient)
            row.update(power_w_m=power,storage_w_m=storage,boundary_outflow_w_m=outflow)
            rows.append(row)
        return {'schema':'cablesim.resolved-history-result/1','method_version':METHOD_VERSION,'method_sha256':method_digest(),
            'reference_kind':saved['reference_kind'],'engineering_approval':False,'preload_sha256':saved['sha256'],
            'capacity_sha256':digest({k:v.model_dump(mode='json') for k,v in self.capacities.items()}),
            'capacities':{k:v.model_dump(mode='json') for k,v in self.capacities.items()},'rows':rows,'dofs':int(self.basis.N),
            'energy_relative_residual':balance,'physical_residual_inf_w_m':residual,'loss_feedback_iterations':iterations,
            'outer_boundary':'kennelly_image_history','ground_surface':'isothermal','time_steps':len(times)-1,
            'frozen_limits':{'wall_seconds':wall_limit_s,'cpu_seconds':cpu_limit_s,'core_hours':cpu_limit_s/3600},
            'wall_seconds':monotonic()-begin,'cpu_seconds':process_time()-cpu,'job_id':os.environ['SLURM_JOB_ID']}


def response_change(a,b):
    """Compare every conductor on the same saved time axis, not only maxima."""
    import numpy as np
    result=0.
    if [r['region'] for r in a['rows'][0]['conductors']]!=[r['region'] for r in b['rows'][0]['conductors']]:raise ValueError('收敛比较导体绑定不同。')
    ta=[r['time_s'] for r in a['rows']];tb=[r['time_s'] for r in b['rows']]
    if ta[0]!=tb[0] or ta[-1]!=tb[-1]:raise ValueError('收敛比较时长不同。')
    for index in range(len(a['rows'][0]['conductors'])):
        va=[r['conductors'][index]['temperature_k'] for r in a['rows']]
        vb=[r['conductors'][index]['temperature_k'] for r in b['rows']]
        result=max(result,float(np.max(np.abs(np.interp(tb,ta,va)-vb))))
    return result
