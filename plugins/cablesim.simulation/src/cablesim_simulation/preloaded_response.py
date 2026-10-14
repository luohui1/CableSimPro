"""Saved full-field initial data, resolved phases and sourced heat capacities.

No display mesh or assumed uniform initial temperature is accepted. The IEC
loss-feedback branch retains its balanced electrical scope. A separate fixed
power branch accepts explicitly prescribed per-region heat histories; it does
not turn an arbitrary unbalanced current into an IEC sheath-loss prediction.
"""
from copy import deepcopy
from hashlib import sha256
import json
from math import isfinite
import os
from pathlib import Path
import tarfile
from time import monotonic, process_time
from typing import Literal
from pydantic import Field, model_validator
from cablesim_sdk.simulation import Strict
from .step_response import Capacity, Controls, StepInput, System
from .report import digest
from .three_core_history import ResolvedHistory, history_rise, increments, response_change


class PreloadSource(Strict):
    run_id: str = Field(min_length=1)
    input_sha256: str = Field(pattern='^[a-f0-9]{64}$')
    output_sha256: str = Field(pattern='^[a-f0-9]{64}$')
    job_id: str = Field(min_length=1)
    study_name: str = Field(min_length=1)
    method: dict
    attachment_sha256: str = Field(pattern='^[a-f0-9]{64}$')
    attachment_size: int = Field(gt=0,le=104857600)


class HistorySegment(Strict):
    time_s: float = Field(ge=0)
    currents_a: dict[str,float] = Field(default_factory=dict)
    heat_w_m: dict[str,float] = Field(default_factory=dict)
    source: str = Field(min_length=1)


class PreloadedInput(Strict):
    schema_version: Literal['cablesim.fem-step-response/1']
    kind: Literal['preloaded_history']
    saved_source: PreloadSource
    capacities: dict[str,Capacity]
    history: list[HistorySegment] = Field(min_length=1,max_length=100)

    @model_validator(mode='after')
    def history_valid(self):
        starts=[r.time_s for r in self.history]
        if starts[0]!=0 or any(not isfinite(t) for t in starts) or any(b<=a for a,b in zip(starts,starts[1:])):
            raise ValueError('损耗历史须从 0 s 开始，阶跃时刻严格递增。')
        for row in self.history:
            values=row.currents_a or row.heat_w_m
            if bool(row.currents_a)==bool(row.heat_w_m) or any(not isfinite(v) or v<0 for v in values.values()):
                raise ValueError('每段完整填写逐相电流 A 或逐区域给定损耗 W/m，数值须非负有限；两种口径不能混用。')
        return self


def source_model(run):
    """Local scope/geometry preparation only. Never constructs a FEM mesh."""
    if run.get('integrity')!='verified' or run.get('status')!='succeeded':
        raise ValueError('起算场须为摘要核验通过的成功稳态运行。')
    cases=(run.get('output') or {}).get('cases',[])
    if len(cases)!=1 or cases[0].get('status')!='succeeded':raise ValueError('请选单工况成功稳态运行。')
    bundle=cases[0]['artifacts'].get('x-cablesim.simulation-bundle',{})
    method=run['snapshot']['definition']['method']
    if method['plugin_id']!='cablesim.simulation':raise ValueError('起算场须为有限元保存场，标准方法数值不能替代初场。')
    if method['capability']=='iec-thermal-field':
        from .three_core_thermal import prepare
        original=next(row for row in run['snapshot']['cases'] if row['case_id']==cases[0]['case_id'])
        parameters=deepcopy(original['parameters'])
        solver=parameters.get('iec',{}).get('solver',{})
        if 'initial_sheath_temperature_k' in solver and 'initial_sheath_temperature_c' not in solver:
            solver['initial_sheath_temperature_c']=solver.pop('initial_sheath_temperature_k')-273.15
        prepared=prepare(original['input'],parameters,allow_single_core=True)
        p,d,group,problem,bindings,ducts=prepared
        section=d['sections'][0]
        if ducts or section.get('enclosures'):raise ValueError('管内空气暂态未验证；排管仍不覆盖。')
        if p.outer_boundary!='kennelly_image' or section.get('soil_layers') or section.get('backfill') or section['kind']!='ground':
            raise ValueError('预载暂态只覆盖均匀土壤、恒温地表和镜像远场。')
        if digest(problem.model_dump(mode='json'))!=digest(bundle['problem']):
            raise ValueError('保存几何、材料或边界与当前适配器不同；不自动改造初场。')
        phases=[{'id':b['entity'],'label':{'L1':'A 相','L2':'B 相','L3':'C 相','A':'A 相','B':'B 相','C':'C 相'}.get(next((c.get('phase') for circuit in d['circuits'] for c in circuit['cables'] if c['id']==b['entity']),None),f'电缆 {i+1}'),
                 'current_a':c['current']} for i,(b,c) in enumerate(zip(bindings,group.cables))]
        return prepared,problem,[uid for b in bindings for uid in b['conductors']],phases
    if method['capability']=='fem-step-response' and bundle.get('parameters',{}).get('operation')=='steady_reference':
        value=StepInput.model_validate(bundle['input'])
        original=next(row for row in run['snapshot']['cases'] if row['case_id']==cases[0]['case_id'])
        if digest(value.model_dump(mode='json'))!=digest(StepInput.model_validate(original['input']).model_dump(mode='json')):
            raise ValueError('保存参考场输入与原快照不同；不能替换起算物理输入。')
        phases=[{'id':uid,'label':f'导体 {i+1}','heat_w_m':value.joule_heat_w_m.get(uid,0.)} for i,uid in enumerate(value.conductor_regions)]
        return value,value.problem,value.conductor_regions,phases
    raise ValueError('来源没有受支持的稳态初场；暂态结果不能当作稳态预载。')


def read_source(job, source):
    """Verify the frozen original snapshot/output bytes before decoding arrays."""
    path=job/'input'/('preload-'+source.attachment_sha256+'.tar.gz')
    if not path.is_file() or path.stat().st_size!=source.attachment_size:
        raise ValueError('保存初场附件缺失或长度不符，未运行暂态。')
    checksum=sha256()
    with path.open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):checksum.update(block)
    if checksum.hexdigest()!=source.attachment_sha256:raise ValueError('保存初场附件摘要不符，原运行保留。')
    members={}
    with tarfile.open(path,'r:gz') as archive:
        for member in archive:
            if member.name not in ('snapshot.json','output.json','source.json') or member.name in members or not member.isfile() or member.size>160*1024*1024:
                raise ValueError('保存初场附件成员无效。')
            members[member.name]=archive.extractfile(member).read()
    if set(members)!= {'snapshot.json','output.json','source.json'}:raise ValueError('保存初场附件不完整。')
    for name,expected in [('snapshot.json',source.input_sha256),('output.json',source.output_sha256)]:
        if sha256(members[name]).hexdigest()!=expected:raise ValueError('保存初场输入或输出字节摘要不符。')
    run=json.loads(members['source.json']);run.update(snapshot=json.loads(members['snapshot.json']),output=json.loads(members['output.json']))
    if run['id']!=source.run_id or run['input_digest']!=source.input_sha256 or run['output_digest']!=source.output_sha256 or run['snapshot']['definition']['method']!=source.method or str(run['execution']['job_id'])!=source.job_id:
        raise ValueError('初场运行、作业或方法身份与保存快照不一致。')
    # The authenticated original output bytes bind every saved artifact value.
    # artifact_digests are hashes of original plugin files (including their
    # serialization order), not hashes of reserialized database JSON. Preserve
    # those witnesses; full_field also validates every lossless array below.
    for case in run['output']['cases']:
        for name,value in case['artifacts'].items():
            witness=case['artifact_digests'].get(name,'')
            if not isinstance(value,dict) or len(witness)!=64 or any(c not in '0123456789abcdef' for c in witness):
                raise ValueError('起算场缺少有效的原工件摘要。')
    return run


def native_mesh(run, order):
    from backend.kernel.batch_field_storage import full_field
    from .problem_mesh import package
    import numpy as np
    case=run['output']['cases'][0];arrays=full_field(case)
    field=case['artifacts']['x-cablesim.temperature-field'];bundle=case['artifacts']['x-cablesim.simulation-bundle']
    cells=arrays['triangles'];ids=arrays['domain_ids'];points=arrays['points']
    if order==2:
        if len(cells)%4:raise ValueError('保存二阶场不含完整的四分三角单元。')
        parts=cells.reshape(-1,4,3)
        # package() normalizes each display triangle's orientation. Recover
        # corners and edge nodes by incidence, never by a positional guess.
        is_mid=(parts[:,:3,:,None]==parts[:,3,None,None,:]).any(axis=3)
        if not np.all((~is_mid).sum(axis=2)==1):raise ValueError('保存二阶场角点归属不完整。')
        native=parts[:,:3,:][~is_mid].reshape(-1,3)
        mids=[]
        for a,b in ((0,1),(1,2),(0,2)):
            common=(parts[:,a,:,None]==parts[:,b,None,:]).any(axis=2)
            if not np.all(common.sum(axis=1)==1):raise ValueError('保存二阶场边节点归属不完整。')
            mids.append(parts[:,a,:][common])
        dofs=np.column_stack((native,*mids))
        expected=dofs[:,[[0,3,5],[3,1,4],[5,4,2],[3,4,5]]]
        flat=expected.reshape(-1,3);xy=points[flat]
        a,b=xy[:,1]-xy[:,0],xy[:,2]-xy[:,0]
        signed=a[:,0]*b[:,1]-a[:,1]*b[:,0]
        flat[signed<0]=flat[signed<0][:,[0,2,1]]
        expected=flat.reshape(-1,4,3)
        if not np.array_equal(parts,expected) or not np.all(ids.reshape(-1,4)==ids.reshape(-1,4)[:,:1]):
            raise ValueError('保存二阶场单元绑定不一致；拒绝重三角化初场。')
        cells=native;ids=ids[::4];points=points[:int(native.max())+1]
    regions=bundle.get('field_storage',{}).get('regions',field['mesh']['regions'])
    boundaries=field['mesh'].get('boundaries') or bundle.get('problem',bundle.get('input',{}).get('problem',{})).get('boundaries',[])
    return arrays,package(points,cells,ids,regions,boundaries)


class FixedPowerHistory:
    """Linear prescribed-loss submodel, with the same full saved initial field."""
    def __init__(self,value,controls,mesh=None):
        if not os.environ.get('SLURM_JOB_ID'):raise ValueError('暂态质量矩阵仅在超算组装。')
        import numpy as np
        from skfem import LinearForm,asm
        self.p=value;self.base=System(value,controls,analysis_mesh=mesh)
        self.basis=self.base.basis;self.ambient=value.ambient_temperature_k
        self.k=self.base.soil_k;self.capacity=self.base.soil_c
        @LinearForm
        def weight(v,w):return w.q*v
        self.weights={uid:asm(weight,self.basis,q=(self.base.ids==region['id'])[:,None].astype(float)) for uid,region in self.base.regions.items() if uid in value.joule_heat_w_m}
        self.nodes={uid:np.unique(self.basis.element_dofs[:,self.base.ids==self.base.regions[uid]['id']]) for uid in value.conductor_regions}

    def powers(self,values):
        import numpy as np
        if set(values)!=set(self.weights) or any(not isfinite(v) or v<0 for v in values.values()):raise ValueError('逐保存热源区域完整填写损耗历史 W/m，不省略护层热源。')
        load=np.zeros(self.basis.N);sources=[]
        for uid,power in values.items():
            load+=power*self.weights[uid]/self.weights[uid].sum()
            geometry=next(g for g in self.p.problem.geometry if g.uid==uid)
            sources.append({'center_m':geometry.values[:2],'loss_w_m':power})
        return load,sources

    def march(self,initial,history,times):
        import numpy as np
        from scipy.sparse.linalg import splu
        begin=monotonic();cpu=process_time();K,M,D,free=self.base.K,self.base.M,self.base.D,self.base.free
        u=np.asarray(initial)-self.ambient
        load,baseline=self.powers(self.p.joule_heat_w_m)
        if np.max(abs((K@u-load)[free]))>1e-5:raise ValueError('保存预载场未满足原稳态能量平衡。')
        for segment in history:self.powers(segment.heat_w_m)
        probe=self.basis.probes(np.asarray(self.p.problem.probes_m[0])[:,None]) if self.p.problem.probes_m else None
        previous=baseline;changes=[];rows=[];factors={};balance=0.;residual=0.
        def row(t):
            cores=[dict(region=uid,cable_id=uid,circuit_id=self.p.circuit_id,temperature_k=float(u[nodes].max()+self.ambient),
                        hotspot_m=self.basis.doflocs[:,nodes[np.argmax(u[nodes])]].tolist()) for uid,nodes in self.nodes.items()]
            return dict(time_s=float(t),conductors=cores,maximum_temperature_k=max(c['temperature_k'] for c in cores),
                        probe_temperature_k=float((probe@u)[0]+self.ambient) if probe is not None else None)
        rows.append(row(0.))
        for a,t in zip(times,times[1:]):
            if monotonic()-begin>600 or process_time()-cpu>600:raise TimeoutError('已达本级 600 秒冻结上限，保留已保存初场。')
            segment=next(s for s in reversed(history) if s.time_s<=a);load,sources=self.powers(segment.heat_w_m)
            dt=float(t-a);boundary=history_rise(self.basis.doflocs[:,D],baseline,changes+[(float(a),increments(previous,sources))],self.k,self.capacity,float(t))
            matrix=K+M/dt;right=load+M@u/dt
            if dt not in factors:factors={dt:splu(matrix[free][:,free].tocsc())}
            next_u=np.zeros(self.basis.N);next_u[D]=boundary;next_u[free]=factors[dt].solve(right[free]-matrix[free][:,D]@boundary)
            r=K@next_u+M@(next_u-u)/dt-load
            residual=max(residual,float(abs(r[free]).max()))
            storage=float(np.sum(M@(next_u-u))/dt);power=float(load.sum());outflow=-float(r[D].sum())
            balance=max(balance,abs(storage+outflow-power)/max(abs(power),abs(storage),1.))
            if residual>1e-5 or balance>1e-6:raise ValueError('暂态能量平衡未通过，未给出近似结果。')
            changes.append((float(a),increments(previous,sources)));previous=sources;u=next_u;rows.append(row(t))
        return dict(rows=rows,dofs=int(self.basis.N),wall_seconds=monotonic()-begin,cpu_seconds=process_time()-cpu,
                    physical_residual_inf_w_m=residual,energy_relative_residual=balance)


def prepare(value,parameters):
    p=PreloadedInput.model_validate(value);c=Controls.model_validate(parameters)
    if c.operation!='step_response':raise ValueError('预载入口只做保存场起算，不生成另一个零初温参考。')
    if c.final_time_s/c.first_time_s>9999:raise ValueError('请在 9999 个时间区间内冻结本级步长与时长。')
    for row in p.history:
        if row.time_s>=c.final_time_s or abs(row.time_s/c.first_time_s-round(row.time_s/c.first_time_s))>1e-9:
            raise ValueError('阶跃时刻须位于末时刻前并对齐首时间步，单位 s。')
    return p,c


def host_case(request,case,job):
    import numpy as np
    from .artifacts import write
    from .problem_mesh import build
    started=monotonic();cpu=process_time()
    p,c=prepare(case['input'],case.get('parameters',{}));run=read_source(job,p.saved_source)
    model,problem,cores,phases=source_model(run)
    missing={g.uid for g in problem.geometry}-set(p.capacities)
    if missing or set(p.capacities)-{g.uid for g in problem.geometry}:raise ValueError('热容缺项：'+', '.join(sorted(missing))+'；不采用相邻材料代替。')
    if isinstance(model,StepInput):
        controls=Controls.model_validate(run['output']['cases'][0]['artifacts']['x-cablesim.simulation-bundle']['parameters']).mesh
        def system(mesh=None,level=0):
            v=model.model_copy(deep=True);v.capacities=p.capacities
            m=controls.model_copy(deep=True);m.size_m/=2**level
            if m.far_size_m:m.far_size_m/=2**level
            return FixedPowerHistory(v,m,mesh)
        if any(s.currents_a for s in p.history):raise ValueError('固定损耗参考仅接受逐区域 W/m 历史，不从电流猜损耗。')
    else:
        controls=model[0].mesh
        def system(mesh=None,level=0):
            fine=deepcopy(model);fine[0].mesh.size_m/=2**level
            if fine[0].mesh.far_size_m:fine[0].mesh.far_size_m/=2**level
            return ResolvedHistory(fine,{uid:v.model_dump(mode='json') for uid,v in p.capacities.items()},analysis_mesh=mesh)
        if any(s.heat_w_m for s in p.history):raise ValueError('耦合参考使用逐相电流及温度反馈；给定区域损耗使用固定损耗参考。')
        for segment in p.history:
            if set(segment.currents_a)!={r['id'] for r in phases}:raise ValueError('逐相完整填写保存电缆的负荷历史。')
            for circuit in model[1]['circuits']:
                values=[segment.currents_a[b['entity']] for b in model[4] if b['circuit']==circuit['id']]
                if max(values)-min(values)>1e-10:raise ValueError('当前 IEC 护层损耗反馈只覆盖平衡相电流；不平衡损耗模型未验证。')
    arrays,mesh=native_mesh(run,controls.field_order or 1);native=system(mesh)
    if not np.allclose(native.basis.doflocs.T,arrays['points'],rtol=0,atol=1e-12):raise ValueError('保存全场自由度绑定不同；不插值或使用降采样场。')
    preload=native.bind_saved_preload(run,arrays['points'],arrays['temperature_k']) if isinstance(native,ResolvedHistory) else arrays['temperature_k']
    def march(obj,initial,dt):
        times=np.linspace(0,c.final_time_s,int(round(c.final_time_s/dt))+1)
        if not np.isclose(np.diff(times),dt).all():raise ValueError('总时长须为时间步整数倍。')
        return obj.march(initial,[s.model_dump(mode='json') for s in p.history],times) if isinstance(obj,ResolvedHistory) else obj.march(initial,p.history,times)
    evidence=dict(preload_source=p.saved_source.model_dump(mode='json'),mesh_nodes=int(native.basis.N),phase_bindings=phases)
    if request['phase']=='check':return dict(case_id=case['case_id'],status='succeeded',results=[],artifacts=[],evidence=evidence)
    levels=[];previous=None;dt=c.first_time_s;time_passed=False
    for level in range(c.max_levels):
        dt=c.first_time_s/2**level;current=march(native,preload,dt)
        change=response_change(previous,current) if previous else None
        levels.append(dict(kind='time',level=level+1,change_k=change,nodes=current['dofs'],time_intervals=len(current['rows'])-1,wall_seconds=current['wall_seconds'],cpu_seconds=current['cpu_seconds']))
        previous=current
        if change is not None and change<=c.tolerance_k:time_passed=True;break
    accepted=current;mesh_passed=False;previous=accepted
    # Refined initial fields are additional actual steady solves with the same
    # physical source, never an interpolation of the displayed initial field.
    # Keep the requested saved-mesh response as the delivered curve; refinement
    # curves only prove its error against an independently solved finer model.
    for level in range(1,c.max_levels):
        fine=system(level=level)
        initial=fine.freeze_preload(preload['currents_a']) if isinstance(fine,ResolvedHistory) else fine.base.steady+fine.ambient
        refined=march(fine,initial,dt);change=response_change(previous,refined)
        delivered_change=response_change(accepted,refined)
        levels.append(dict(kind='mesh',level=level+1,change_k=change,nodes=refined['dofs'],time_intervals=len(refined['rows'])-1,wall_seconds=refined['wall_seconds'],cpu_seconds=refined['cpu_seconds'],
                           delivered_curve_change_k=delivered_change,initial_field='同物理输入在本级网格独立求解的稳态场；不用显示插值'))
        previous=refined
        if max(change,delivered_change)<=c.tolerance_k:mesh_passed=True;break
    final_time=march(fine,initial,dt/2);change=response_change(refined,final_time)
    levels.append(dict(kind='time_final_mesh',level=level+1,change_k=change,nodes=final_time['dofs'],time_intervals=len(final_time['rows'])-1,wall_seconds=final_time['wall_seconds'],cpu_seconds=final_time['cpu_seconds']))
    time_passed=time_passed and change<=c.tolerance_k
    mesh_passed=mesh_passed and response_change(accepted,final_time)<=c.tolerance_k
    rows=accepted['rows'];ambient=native.ambient
    cross=None
    if isinstance(native,FixedPowerHistory) and model.problem.probes_m:
        _,baseline=native.powers(model.joule_heat_w_m);last=baseline;changes=[]
        for segment in p.history:
            _,sources=native.powers(segment.heat_w_m);changes.append((segment.time_s,increments(last,sources)));last=sources
        xy=np.asarray(model.problem.probes_m[0])[:,None]
        differences=[abs(row['probe_temperature_k']-ambient-float(history_rise(xy,baseline,changes,native.k,native.capacity,row['time_s'])[0])) for row in rows]
        cross=dict(maximum_difference_k=max(differences),scope='外部均匀土壤 E1 镜像线源分段历史叠加；含有限半径与离散误差',official_iec_example=False)
    response=dict(schema='cablesim.fem-step-response-result/1',kind='preloaded_history',method_version='1.1.0',
        saved_source=p.saved_source.model_dump(mode='json'),phase_bindings=phases,history=[s.model_dump(mode='json') for s in p.history],
        job_id=os.environ.get('SLURM_JOB_ID'),wall_seconds=monotonic()-started,cpu_seconds=process_time()-cpu,
        capacities={uid:v.model_dump(mode='json') for uid,v in p.capacities.items()},
        curve=[dict(row,rise_k=row['maximum_temperature_k']-ambient) for row in rows],
        analytic_cross_check=cross,energy_relative_residual=accepted['energy_relative_residual'],physical_residual_inf_w_m=accepted['physical_residual_inf_w_m'],
        convergence=dict(status='converged' if time_passed and mesh_passed else 'not_converged',tolerance_k=c.tolerance_k,time_passed=time_passed,mesh_passed=mesh_passed,levels=levels),
        scope='保存全网格稳态预载起算；同土壤域互热；不导出零初温 IEC 应急输入',engineering_approval=False)
    bundle=dict(input=p.model_dump(mode='json'),parameters=c.model_dump(mode='json'),step_response=response,engineering_approval=False)
    artifact=write(job,case['case_id'],'preloaded','x-cablesim.simulation-bundle',bundle)
    return dict(case_id=case['case_id'],status='succeeded',evidence=evidence,artifacts=[artifact],
        results=[dict(key='conductor_temperature',type='quantity',entity=row['cable_id'],status='available',value=row['temperature_k'],unit='K') for row in rows[-1]['conductors']])
