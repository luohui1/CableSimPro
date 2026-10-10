"""Constant-Joule FEM step response in a homogeneous isothermal half-space.

M d(theta)/dt + K theta = f. Backward Euler; full conforming P1/P2 meshes.
The outer boundary uses the transient image-line Green function E1, tending
to the same Kennelly steady boundary. This is an analytic cross-check, not
an official IEC 60853 example or an implementation of its thermal network.
"""
from copy import deepcopy
from math import isclose, isfinite, pi
import os
from typing import Literal
from pydantic import Field, model_validator
from cablesim_sdk.simulation import Strict, Problem, MeshControls
from cablesim_sdk.validation import FieldValueError
from .report import digest


class Capacity(Strict):
    value_j_m3_k: float = Field(gt=0)
    material: str = Field(min_length=1)
    reference: str = Field(min_length=1)
    source_sha256: str = Field(pattern='^[a-f0-9]{64}$')
    page: int = Field(ge=1)
    table: str = Field(min_length=1)
    density_kg_m3: float | None = Field(default=None,gt=0)
    specific_heat_j_kg_k: float | None = Field(default=None,gt=0)
    limitations: str = Field(min_length=1)

    @model_validator(mode='after')
    def derived(self):
        if not self.reference.strip() or not self.material.strip() or not self.table.strip():
            raise ValueError('热容须填写材料、正文来源和表号，不接受空白来源。')
        if (self.density_kg_m3 is None)!=(self.specific_heat_j_kg_k is None):
            raise ValueError('密度和比热须成对提供，或使用文献直接给出的体积热容。')
        if self.density_kg_m3 is not None and not isclose(self.value_j_m3_k,self.density_kg_m3*self.specific_heat_j_kg_k,rel_tol=1e-10):
            raise ValueError('体积热容与来源的密度×比热不一致，单位 J/(m³·K)。')
        return self


class SavedSource(Strict):
    run_id: str = Field(min_length=1)
    output_sha256: str = Field(pattern='^[a-f0-9]{64}$')
    input_sha256: str = Field(pattern='^[a-f0-9]{64}$')
    method: str = Field(min_length=1)
    study_name: str = Field(min_length=1)
    steady_joule_rise_k: float = Field(gt=0)


class StepInput(Strict):
    schema_version: Literal['cablesim.fem-step-response/1']
    circuit_id: str = Field(min_length=1)
    reference_current_a: float = Field(gt=0)
    ambient_temperature_k: float = Field(gt=0)
    problem: Problem
    conductor_regions: list[str] = Field(min_length=1)
    joule_heat_w_m: dict[str,float]
    capacities: dict[str,Capacity]
    source: str = Field(min_length=1)
    saved_source: SavedSource | None = None

    @model_validator(mode='after')
    def applicable(self):
        shapes=self.problem.geometry;ids={g.uid for g in shapes}
        if self.problem.physics!='steady_heat' or shapes[0].kind!='rectangle' or any(g.kind!='disk' for g in shapes[1:]):
            raise ValueError('仅覆盖单回路、均匀土壤、圆形电缆热域；分层、回填和排管未覆盖。')
        if self.problem.excitations or self.problem.electrical_networks:
            raise ValueError('阶跃仅采用已保存的固定焦耳损耗，不叠加独立热源或电路求解。')
        if set(self.capacities)!=ids:
            missing=sorted(ids-set(self.capacities))
            raise FieldValueError('逐材料域补齐有正文来源的体积热容：'+', '.join(missing),'capacities')
        if not set(self.conductor_regions)<=ids or len(set(self.conductor_regions))!=len(self.conductor_regions):
            raise ValueError('导体区域须唯一并绑定已保存几何。')
        if not self.joule_heat_w_m or not set(self.joule_heat_w_m)<=ids-{shapes[0].uid} or any(not isfinite(v) or v<0 for v in self.joule_heat_w_m.values()) or sum(self.joule_heat_w_m.values())<=0:
            raise ValueError('焦耳损耗须绑定电缆区域并为非负有限 W/m，总损耗须为正。')
        if not self.problem.boundaries or any(b.kind!='temperature' or b.value!=self.ambient_temperature_k or b.selector!='outer' for b in self.problem.boundaries):
            raise ValueError('地表须为保存的环境恒温；侧边与底边使用镜像远场，非恒温地表未覆盖。')
        x,z,X,Z=shapes[0].values
        if Z!=0 or not x<X or not z<0:raise ValueError('均匀半空间计算域上边须为 z=0，单位 m。')
        for g in shapes[1:]:
            if g.void:raise ValueError('空域没有已验证热容模型，阶跃响应未覆盖。')
            cx,cz,r=g.values
            if not x<cx-r<cx+r<X or not z<cz-r<cz+r<0:raise ValueError('完整电缆热域须位于计算域与地表以内。')
        if len(shapes)<2:raise ValueError('缺少电缆导体与热域。')
        outer=shapes[1].values
        for g in shapes[2:]:
            if ((g.values[0]-outer[0])**2+(g.values[1]-outer[1])**2)**.5+g.values[2]>outer[2]+1e-10:
                raise ValueError('阶跃响应仅覆盖一个共同电缆包络内的单回路，不接受多根相互加热电缆。')
        for px,pz in self.problem.probes_m:
            if not x<px<X or not z<pz<0 or (px-outer[0])**2+(pz-outer[1])**2<=outer[2]**2:
                raise FieldValueError('解析核对取样点须位于外部均匀土壤中，避开电缆与计算边界。','problem','probes_m')
        return self


class Controls(Strict):
    operation: Literal['steady_reference','step_response'] = 'step_response'
    mesh: MeshControls
    first_time_s: float = Field(default=10,gt=0)
    final_time_s: float = Field(default=1e8,gt=0,le=1e10)
    intervals_per_decade: int = Field(default=12,ge=4,le=100)
    max_levels: int = Field(default=4,ge=2,le=6)
    tolerance_k: float = Field(default=.1,gt=0,le=.1)

    @model_validator(mode='after')
    def duration(self):
        if self.first_time_s>=self.final_time_s:raise ValueError('末时刻须晚于首时间步，单位 s。')
        return self


def prepare(value,parameters):
    p=StepInput.model_validate(value);c=Controls.model_validate(parameters)
    if c.operation=='step_response' and p.saved_source is None:
        raise FieldValueError('先封存同输入稳态有限元研究，再引用该运行生成阶跃响应。','saved_source')
    return p,c


def image_step_rise(points,sources,k,capacity,time_s):
    """q/(4*pi*k) [E1(r²/(4*a*t))-E1(r_image²/(4*a*t))]."""
    import numpy as np
    from scipy.special import exp1
    xy=np.asarray(points,dtype=float)
    if xy.ndim!=2 or xy.shape[0]!=2 or not np.isfinite(xy).all() or np.any(xy[1]>1e-10):raise ValueError('镜像解坐标须在地表以下。')
    if not all(isfinite(v) and v>0 for v in (k,capacity)) or not isfinite(time_s) or time_s<0:raise ValueError('热导率、热容须正且有限，时刻须非负有限。')
    answer=np.zeros(xy.shape[1])
    for row in sources:
        x,z=row['center_m'];q=row['loss_w_m']
        if not np.isfinite([x,z,q]).all() or z>=0 or q<0:raise ValueError('镜像热源须地下且损耗非负。')
        real=(xy[0]-x)**2+(xy[1]-z)**2;mirror=(xy[0]-x)**2+(xy[1]+z)**2
        if np.any(real<=0):raise ValueError('镜像解不能在线热源中心取样。')
        if time_s:answer+=q/(4*pi*k)*(exp1(real*capacity/(4*k*time_s))-exp1(mirror*capacity/(4*k*time_s)))
    return answer


def time_grid(c,level):
    import numpy as np
    first=c.first_time_s/2**level
    count=int(np.ceil(np.log10(c.final_time_s/first)*c.intervals_per_decade))*2**level
    if count+1>9999:raise FieldValueError('时间区间超过应急输入容量；减少加密级数或每十倍时间的区间数。','parameters','intervals_per_decade')
    return np.r_[0.,np.geomspace(first,c.final_time_s,count+1)]


class System:
    def __init__(self,p,controls):
        import numpy as np
        from skfem import MeshTri,Basis,ElementTriP1,ElementTriP2,BilinearForm,LinearForm,asm
        from skfem.helpers import grad,dot
        from .problem_mesh import build
        self.np=np;self.p=p;self.mesh=build(p.problem,controls)
        ids=np.asarray(self.mesh['domain_ids']);self.ids=ids
        basis=self.basis=Basis(MeshTri(np.asarray(self.mesh['points']).T,np.asarray(self.mesh['triangles']).T),ElementTriP2() if controls.field_order==2 else ElementTriP1(),intorder=5)
        if basis.N>controls.max_nodes:raise FieldValueError(f'网格有 {basis.N} 自由度，超过容量上限。','mesh','max_nodes')
        self.regions={r['uid']:r for r in self.mesh['regions']}
        @BilinearForm
        def conduction(u,v,w):return w.k*dot(grad(u),grad(v))
        @BilinearForm
        def mass(u,v,w):return w.c*u*v
        @LinearForm
        def unit(v,w):return w.q*v
        ks=np.asarray([self.mesh['regions'][i-1]['material']['k_w_m_k'] for i in ids])[:,None]
        cs=np.asarray([p.capacities[self.mesh['regions'][i-1]['uid']].value_j_m3_k for i in ids])[:,None]
        self.K=asm(conduction,basis,k=ks);self.M=asm(mass,basis,c=cs)
        self.D=basis.get_dofs().all();self.free=np.setdiff1d(np.arange(basis.N),self.D)
        self.load=np.zeros(basis.N);self.sources=[];self.core_nodes=[]
        for uid,r in self.regions.items():
            mask=ids==r['id']
            if uid in p.conductor_regions:self.core_nodes.extend(np.unique(basis.element_dofs[:,mask]).tolist())
            heat=p.joule_heat_w_m.get(uid,0.)
            if heat:
                w=asm(unit,basis,q=mask[:,None].astype(float));self.load+=heat*w/w.sum()
                shape=next(g for g in p.problem.geometry if g.uid==uid)
                self.sources.append({'center_m':shape.values[:2],'loss_w_m':heat})
        self.core_nodes=np.unique(self.core_nodes)
        soil=p.problem.geometry[0];self.soil_k=soil.material.k_w_m_k;self.soil_c=p.capacities[soil.uid].value_j_m3_k
        from scipy.sparse.linalg import splu
        from .far_boundary import image_rise
        boundary=image_rise(basis.doflocs[:,self.D],self.sources,1/self.soil_k)
        self.steady=np.zeros(basis.N);self.steady[self.D]=boundary
        self.steady[self.free]=splu(self.K[self.free][:,self.free].tocsc()).solve(self.load[self.free]-self.K[self.free][:,self.D]@boundary)
        self.steady_rise=float(self.steady[self.core_nodes].max())

    def curve(self,c,level,probe=None):
        from scipy.sparse.linalg import splu
        from time import perf_counter,process_time
        np=self.np;start=perf_counter();cpu=process_time();times=time_grid(c,level);u=np.zeros(self.basis.N);rows=[{'time_s':0.,'rise_k':0.}];residual=0.;samples=[0.]
        weights=self.basis.probes(np.asarray(probe)[:,None]) if probe is not None else None
        for a,t in zip(times,times[1:]):
            dt=t-a;matrix=self.K+self.M/dt
            boundary=image_step_rise(self.basis.doflocs[:,self.D],self.sources,self.soil_k,self.soil_c,float(t))
            right=self.load+self.M@u/dt
            next_u=np.zeros(self.basis.N);next_u[self.D]=boundary
            next_u[self.free]=splu(matrix[self.free][:,self.free].tocsc()).solve(right[self.free]-matrix[self.free][:,self.D]@boundary)
            residual=max(residual,float(np.max(np.abs((matrix@next_u-right)[self.free]))));u=next_u
            rows.append({'time_s':float(t),'rise_k':float(u[self.core_nodes].max())})
            if weights is not None:samples.append(float((weights@u)[0]))
        return {'rows':rows,'nodes':int(self.basis.N),'elements':int(self.basis.mesh.nelements),'steady_rise_k':self.steady_rise,
                'steady_gap_k':abs(self.steady_rise-rows[-1]['rise_k']),'linear_residual_inf_w_m':residual,
                'wall_seconds':perf_counter()-start,'cpu_seconds':process_time()-cpu,'time_intervals':len(times)-1},u,samples


def curve_change(a,b):
    import numpy as np
    ta=[r['time_s'] for r in a['rows']];va=[r['rise_k'] for r in a['rows']]
    tb=[r['time_s'] for r in b['rows']];vb=[r['rise_k'] for r in b['rows']]
    return float(np.max(np.abs(np.interp(tb,ta,va)-vb)))


def endpoint_passed(steady_rise,final_rise,saved_rise,tolerance):
    # Two separate differences <= tolerance do not imply that the endpoint
    # differs from the saved reference by <= tolerance.
    return max(abs(steady_rise-final_rise),abs(steady_rise-saved_rise),abs(final_rise-saved_rise))<=tolerance


def solve(p,c):
    if not os.environ.get('SLURM_JOB_ID'):raise ValueError('阶跃有限元、收敛与解析场交叉核对只允许在 Slurm 求解。')
    from time import perf_counter,process_time
    started=perf_counter();cpu=process_time();mesh=c.mesh.model_copy(deep=True);system=System(p,mesh)
    if c.operation=='steady_reference':return {'schema':'cablesim.fem-step-reference/1','input':p.model_dump(mode='json'),
        'steady_joule_rise_k':system.steady_rise,'nodes':int(system.basis.N),'outer_boundary':'kennelly_image','engineering_approval':False},system,system.steady
    history=[];previous=None;accepted=None;vector=None;time_level=0
    for level in range(c.max_levels):
        current,vector,_=system.curve(c,level);change=curve_change(previous,current) if previous else None
        history.append({'kind':'time','level':level+1,'change_k':change,**{k:v for k,v in current.items() if k!='rows'}})
        previous=current;time_level=level
        if change is not None and change<=c.tolerance_k:accepted=current;break
    time_passed=accepted is not None;accepted=accepted or previous;previous=accepted;mesh_passed=False
    history.append({'kind':'mesh','level':1,'change_k':None,**{k:v for k,v in accepted.items() if k!='rows'},
                    'reused_from_time_level':time_level+1,'cpu_seconds':0.,'wall_seconds':0.})
    for level in range(1,c.max_levels):
        mesh=mesh.model_copy(update={'size_m':mesh.size_m/2,'far_size_m':mesh.far_size_m/2,'minimum_circle_segments':min(512,mesh.minimum_circle_segments*2)})
        system=System(p,mesh);current,vector,_=system.curve(c,time_level);change=curve_change(previous,current)
        history.append({'kind':'mesh','level':level+1,'change_k':change,**{k:v for k,v in current.items() if k!='rows'}})
        accepted=current;previous=current
        if change<=c.tolerance_k:mesh_passed=True;break
    # Recheck the accepted mesh at the next finer time level. A coarse-grid
    # time verdict is never silently promoted to the final mesh.
    final,vector,_=system.curve(c,time_level+1);change=curve_change(accepted,final)
    history.append({'kind':'time_final_mesh','level':time_level+2,'change_k':change,**{k:v for k,v in final.items() if k!='rows'}})
    time_passed=time_passed and change<=c.tolerance_k;accepted=final
    source_gap=abs(system.steady_rise-p.saved_source.steady_joule_rise_k)
    endpoint_source_gap=abs(accepted['rows'][-1]['rise_k']-p.saved_source.steady_joule_rise_k)
    endpoint_ok=endpoint_passed(system.steady_rise,accepted['rows'][-1]['rise_k'],p.saved_source.steady_joule_rise_k,c.tolerance_k)
    probe=p.problem.probes_m[0] if p.problem.probes_m else None;cross=None
    if probe is not None:
        homogeneous=p.model_copy(deep=True)
        for g in homogeneous.problem.geometry:g.material.k_w_m_k=system.soil_k;homogeneous.capacities[g.uid]=p.capacities[p.problem.geometry[0].uid]
        checker=System(homogeneous,mesh);checked,_,values=checker.curve(c,time_level+1,probe)
        analytic=[float(image_step_rise([[probe[0]],[probe[1]]],checker.sources,checker.soil_k,checker.soil_c,r['time_s'])[0]) for r in checked['rows']]
        error=max(abs(a-b) for a,b in zip(values,analytic))
        cross={'kind':'analytic_cross_check','official_iec_example':False,'probe_m':probe,'maximum_difference_k':error,
               'rows':[{'time_s':r['time_s'],'fem_rise_k':a,'analytic_rise_k':b,'difference_k':a-b} for r,a,b in zip(checked['rows'],values,analytic)],
               'scope':'均质土壤、固定圆域热源与镜像线热源 E1 解；含热源半径与网格/时间离散差异，不是原电缆热容模型的等效响应。'}
    rows=accepted['rows']
    if any(b['rise_k']<a['rise_k']-1e-8 or b['rise_k']>system.steady_rise+1e-8 for a,b in zip(rows,rows[1:])):
        raise ValueError('接受网格的响应不满足单调阶跃与稳态上界；原始结果保留，拒绝应急曲线。')
    response={'schema':'cablesim.fem-step-response-result/1','circuit_id':p.circuit_id,'reference_current_a':p.reference_current_a,
        'ambient_temperature_k':p.ambient_temperature_k,'steady_joule_rise_k':system.steady_rise,'curve':rows,
        'outer_boundary':'kennelly_image_transient','loss_basis':'固定参考工况焦耳损耗；不含介电热，不进行暂态电阻反馈',
        'convergence':{'status':'converged' if time_passed and mesh_passed and endpoint_ok else 'unconverged','time_passed':time_passed,
            'mesh_passed':mesh_passed,'endpoint_passed':endpoint_ok,'tolerance_k':c.tolerance_k,'levels':history,
            'comparison':'共同时间点上分段线性插值；记录实际最大温升差','steady_gap_k':accepted['steady_gap_k'],
            'saved_steady_difference_k':source_gap,'endpoint_saved_difference_k':endpoint_source_gap},
        'capacities':{k:v.model_dump(mode='json') for k,v in p.capacities.items()},'saved_source':p.saved_source.model_dump(mode='json'),
        'input_sha256':digest(p.model_dump(mode='json')),'method_version':'1.0.0','analytic_cross_check':cross,
        'wall_seconds':perf_counter()-started,'cpu_seconds':process_time()-cpu,'job_id':os.environ['SLURM_JOB_ID'],
        'engineering_approval':False,'limitations':['固定热物性与参考损耗的线性阶跃；不是完整 IEC 60853 热路复现。',
            '热容来源的温度与含水率范围未给出时不得外推为现场材料认证。','应急初始电流与电阻比须由接收研究另行确认。']}
    return response,system,vector


def emergency_export(response):
    if response['convergence']['status']!='converged':raise ValueError('时间步、网格或末值尚未达标，不能导出应急输入。')
    positive=[r for r in response['curve'] if r['time_s']>0 and r['rise_k']>0]
    value={'schema_version':'cablesim.iec60853-emergency/1','circuit_id':response['circuit_id'],'scope':'thermally_isolated_circuit',
        'reference_current_a':response['reference_current_a'],'initial_current_a':0.,'initial_to_reference_resistance_ratio':1.,
        'steady_joule_rise_k':response['steady_joule_rise_k'],'rated_response':positive,
        'response_source':f"保存有限元阶跃响应；Slurm {response['job_id']}；方法 {response['method_version']}；输入 {response['input_sha256']}；镜像远场",
        'source':'由环境温度起阶跃；零预负荷与电阻比1对应本次计算初态，采用前须核对应急研究工况。'}
    from cablesim_iec60287.emergency import Emergency
    return Emergency.model_validate(value).model_dump(mode='json')


def from_saved_run(run,capacities=None):
    """Bind a verified single-case steady result; never infer a heat capacity."""
    if run.get('integrity')!='verified' or run.get('status')!='succeeded':
        raise ValueError('阶跃来源须为完整性通过的成功稳态运行。')
    cases=run['output']['cases']
    if len(cases)!=1 or cases[0]['status']!='succeeded':raise ValueError('请选择单工况稳态运行。')
    case=cases[0];bundle=case['artifacts'].get('x-cablesim.simulation-bundle')
    # The host verifies every payload through output_digest. Custom JSON has
    # no separate physical-schema status (that map covers temperature fields).
    if not bundle or not case.get('artifact_digests',{}).get('x-cablesim.simulation-bundle'):
        raise ValueError('稳态仿真工件未通过摘要核验。')
    method=run['snapshot']['definition']['method'];original=next(c for c in run['snapshot']['cases'] if c['case_id']==case['case_id'])
    reference=bundle.get('step_response',{})
    if reference.get('schema')=='cablesim.fem-step-reference/1':
        if method['plugin_id']!='cablesim.simulation' or method['capability']!='fem-step-response' or original['parameters'].get('operation')!='steady_reference':
            raise ValueError('来源能力与稳态参考工件不一致。')
        if digest(StepInput.model_validate(reference['input']).model_dump(mode='json'))!=digest(StepInput.model_validate(original['input']).model_dump(mode='json')):
            raise ValueError('稳态工件的输入与保存运行不同。')
        value=deepcopy(reference['input']);steady=reference['steady_joule_rise_k']
    elif method['capability']=='iec-thermal-field':
        result=bundle['result'];parameters=bundle['parameters'];cables=result['cables']
        if len(cables)!=1 or parameters.get('outer_boundary')!='kennelly_image':raise ValueError('仅覆盖单回路均匀土壤镜像远场；请选择符合条件的保存运行。')
        cable=cables[0]
        if abs(cable['dielectric_heat_w_m'])>1e-12:raise ValueError('原稳态含介电热，不能冒充焦耳阶跃。请先保存同模型、显式不含介电热的稳态参考。')
        from .three_core_thermal import prepare as prepare_steady
        _,_,group,problem,bindings,ducts=prepare_steady(original['input'],parameters)
        if digest(problem.model_dump(mode='json'))!=digest(bundle.get('problem')):
            raise ValueError('当前适配器与保存热模型不同；拒绝隐式重建旧运行几何，请先保存当前版本稳态参考。')
        if ducts:raise ValueError('排管热容与空气暂态未覆盖。')
        binding=bindings[0];cores=binding['conductors'];heat={uid:cable['conductor_joule_heat_w_m']/len(cores) for uid in cores}
        for uid in binding['screens']:heat[uid]=cable['screen_heat_w_m']/len(binding['screens'])
        if binding.get('armour'):heat[binding['armour']]=cable['armour_heat_w_m']
        ambient=group.ambient+273.15
        value={'schema_version':'cablesim.fem-step-response/1','circuit_id':binding['circuit'],'reference_current_a':cable['current_a'],
               'ambient_temperature_k':ambient,'problem':problem.model_dump(mode='json'),'conductor_regions':cores,
               'joule_heat_w_m':heat,'capacities':capacities or {},'source':'已保存 IEC 损耗耦合有限元运行的固定焦耳损耗；引用原工件摘要。'}
        steady=cable['conductor_max_temperature_k']-ambient
    else:raise ValueError('来源不是已覆盖的稳态有限元能力。')
    if capacities is not None:value['capacities']=capacities
    value['saved_source']={'run_id':run['id'],'output_sha256':run['output_digest'],'input_sha256':digest(original['input']),
                          'method':method['plugin_id']+'/'+method['capability']+' '+method['version'],
                          'study_name':run['snapshot']['definition']['title'],'steady_joule_rise_k':steady}
    return StepInput.model_validate(value).model_dump(mode='json')


def host_case(request,case,job):
    from .artifacts import write,source,temperature_field
    p,c=prepare(case['input'],case.get('parameters',{}));evidence={'input_sha256':digest(case['input']),'prepared_input_sha256':digest(p.model_dump(mode='json'))}
    if request['phase']=='check':
        if not os.environ.get('SLURM_JOB_ID'):raise ValueError('网格预检须提交 Slurm。')
        system=System(p,c.mesh)
        return dict(case_id=case['case_id'],status='succeeded',results=[],artifacts=[],evidence={**evidence,'mesh_nodes':int(system.basis.N)})
    result,system,u=solve(p,c)
    producer=source(request,case,b'');producer.pop('bundle_sha256')
    result['producer']=producer  # Bundle checksum belongs to the outer saved artifact, avoiding a self-referential digest.
    bundle={'input':p.model_dump(mode='json'),'parameters':c.model_dump(mode='json'),'step_response':result,'engineering_approval':False}
    raw=write(job,case['case_id'],'step','x-cablesim.simulation-bundle',bundle);artifacts=[raw]
    if c.operation=='step_response' and result['convergence']['status']=='converged':
        artifacts.append(write(job,case['case_id'],'emergency','x-cablesim.emergency-input',emergency_export(result)))
    if c.operation=='steady_reference':
        from .problem_mesh import package
        np=system.np;cells=system.basis.mesh.t.T;ids=system.ids
        if c.mesh.field_order==2:
            dofs=system.basis.element_dofs.T;cells=dofs[:,[[0,3,5],[3,1,4],[5,4,2],[3,4,5]]].reshape(-1,3);ids=np.repeat(ids,4)
        mesh=package(system.basis.doflocs.T,cells,ids,system.mesh['regions'],[b.model_dump(mode='json') for b in p.problem.boundaries])
        producer=source(request,case,(job/raw['path']).read_bytes())
        field=temperature_field(mesh,(u+p.ambient_temperature_k).tolist(),producer,convergence={'solver_status':'converged'})
        artifacts.append(write(job,case['case_id'],'temperature','x-cablesim.temperature-field',field))
    peak=p.ambient_temperature_k+(result.get('steady_joule_rise_k') if c.operation=='steady_reference' else result['curve'][-1]['rise_k'])
    return dict(case_id=case['case_id'],status='succeeded',evidence=evidence,results=[dict(key='conductor_temperature',type='quantity',entity=p.circuit_id,status='available',value=peak,unit='K')],artifacts=artifacts)
