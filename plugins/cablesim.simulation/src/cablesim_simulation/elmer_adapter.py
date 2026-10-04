"""Elmer HeatSolve input/output adapter. Elmer owns spatial and temporal solves."""
from pathlib import Path
import math
from .report import digest
from .solver_runtime import environment,execute,SolverFailure


def mesh_files(mesh, directory):
    directory.mkdir(parents=True,exist_ok=True)
    n,e,b=len(mesh['points']),len(mesh['triangles']),len(mesh['boundary_edges'])
    (directory/'mesh.header').write_text(f'{n} {e} {b}\n2\n303 {e}\n202 {b}\n',encoding='ascii')
    (directory/'mesh.nodes').write_text(''.join(f'{i} -1 {x:.17g} {z:.17g} 0\n' for i,(x,z) in enumerate(mesh['points'],1)),encoding='ascii')
    (directory/'mesh.elements').write_text(''.join(f'{i} {r} 303 '+ ' '.join(str(n+1) for n in t)+'\n' for i,(t,r) in enumerate(zip(mesh['triangles'],mesh['domain_ids']),1)),encoding='ascii')
    (directory/'mesh.boundary').write_text(''.join(f'{i} {bc} {parent+1} 0 202 {a+1} {b+1}\n' for i,(a,b,parent,bc) in enumerate(mesh['boundary_edges'],1)),encoding='ascii')


def translate(problem,mesh,work):
    import numpy as np
    mesh_files(mesh,work/'mesh')
    time=problem.get('time')
    lines=['Header','  CHECK KEYWORDS Warn','  Mesh DB "." "mesh"','End','Simulation',
           '  Coordinate System = Cartesian 2D','  Simulation Type = '+('Transient' if time else 'Steady State'),
           '  Steady State Max Iterations = 1','  Max Output Level = 3']
    if time:
        # Cap full-field snapshots so the host's output-file limit remains valid.
        stride=max(1,math.ceil(time['steps']/100))
        if time['steps']%stride:
            raise ValueError('步数必须可被输出间隔ceil(steps/100)整除。')
        lines += ['  Timestepping Method = BDF',f'  BDF Order = {time["bdf_order"]}',
                  f'  Timestep Sizes = {time["step_s"]:.17g}',f'  Timestep Intervals = {time["steps"]}',f'  Output Intervals = {stride}']
    lines += ['End','Equation 1','  Active Solvers(2) = 1 2','End',
              'Solver 1','  Equation = Heat Equation','  Procedure = "HeatSolve" "HeatSolver"',
              '  Variable = Temperature','  Variable DOFs = 1','  Linear System Solver = Direct',
              '  Linear System Direct Method = UMFPACK','  Linear System Convergence Tolerance = 1.0e-12',
              '  Steady State Convergence Tolerance = 1.0e-10','  Nonlinear System Max Iterations = 1','End',
              'Solver 2','  Equation = Result Output','  Procedure = "ResultOutputSolve" "ResultOutputSolver"',
              '  Output File Name = "temperature"','  Output Format = vtu','  Binary Output = True','  Single Precision = False',
              '  Exec Solver = After Saving','  Save Geometry Ids = True','End']
    if time:
        lines.insert(len(lines)-1,'  Vtu Time Collection = True')
    xy=np.asarray(mesh['points'])[np.asarray(mesh['triangles'])]
    areas=np.abs((xy[:,1,0]-xy[:,0,0])*(xy[:,2,1]-xy[:,0,1])-(xy[:,2,0]-xy[:,0,0])*(xy[:,1,1]-xy[:,0,1]))/2
    by_uid={}
    for r in mesh['regions']:
        by_uid.setdefault(r['uid'],[]).append(r['id'])
    power={}
    for excitation in problem['excitations']:
        total_ids=[i for u in excitation['regions'] for i in by_uid[u]]
        volume=float(areas[np.isin(mesh['domain_ids'],total_ids)].sum())
        q=excitation['value'][0]/volume
        expr=f'{q:.17g}'
        if excitation.get('schedule'):
            schedule=excitation['schedule']
            # Each endpoint step uses the preceding interval's load. This avoids
            # applying a new step load one dt too early in backward Euler/BDF.
            expr=f'{q*schedule[0][1]:.17g}'
            for (old_t,old),(t,new) in zip(schedule,schedule[1:]):
                expr+=f'+({q*(new-old):.17g})*(tx>{t:.17g})'
        for i in total_ids:
            power[i]=(q,expr,bool(excitation.get('schedule')))
    initial=time['initial_temperature_k'] if time else min(b['value'] for b in problem['boundaries'] if b['value'] is not None)
    lines+=['Initial Condition 1',f'  Temperature = {initial:.17g}','End']
    for r in mesh['regions']:
        i=r['id']; m=r['material']
        lines += [f'Body {i}',f'  Target Bodies(1) = {i}','  Equation = 1',f'  Material = {i}',f'  Body Force = {i}','  Initial Condition = 1','End',
                  f'Material {i}',f'  Heat Conductivity = {m["k_w_m_k"]:.17g}','  Density = 1',
                  f'  Heat Capacity = {m.get("heat_capacity_j_m3_k") or 1:.17g}','End',f'Body Force {i}']
        q,expr,vary=power.get(i,(0,'0',False))
        # Density=1 represents supplied volumetric capacity, and makes Elmer's
        # W/kg Heat Source numerically identical to the explicit W/m3 source.
        lines += ['  Heat Source = Variable Time',f'    Real MATC "{expr}"'] if vary else [f'  Heat Source = {q:.17g}']
        lines+=['End']
    for i,b in enumerate(problem['boundaries'],1):
        lines += [f'Boundary Condition {i}',f'  Target Boundaries(1) = {i}']
        if b['kind']=='temperature':
            lines.append(f'  Temperature = {b["value"]:.17g}')
        elif b['kind']=='convection':
            lines += [f'  Heat Transfer Coefficient = {b["h_w_m2_k"]:.17g}',f'  External Temperature = {b["value"]:.17g}']
        elif b['kind']=='insulated':
            lines += ['  Heat Flux BC = True','  Heat Flux = 0']
        else:
            raise ValueError('Elmer HeatSolve不能接受非热边界。')
        lines += ['End']
    (work/'case.sif').write_text('\n'.join(lines)+'\n',encoding='ascii')


def solve(problem,mesh,work,configuration=None):
    work.mkdir(parents=True,exist_ok=True)
    exe,env,version=environment('elmer',work,configuration)
    translate(problem,mesh,work)
    execution=execute(exe,['case.sif'],work,env)
    import meshio
    import numpy as np
    from scipy.spatial import cKDTree
    t=problem.get('time')
    times={}
    if t:
        from xml.etree import ElementTree as ET
        collections=list(work.rglob('temperature*.pvd'))
        if len(collections)!=1:
            raise SolverFailure('Elmer缺少唯一PVD时间索引；不按文件编号猜时刻。')
        collection=collections[0]
        for item in ET.parse(collection).iter('DataSet'):
            path=(collection.parent/item.attrib['file']).resolve()
            if not path.is_relative_to(work.resolve()) or path.suffix!='.vtu' or path in times:
                raise SolverFailure('无效PVD工件路径或重复帧。')
            times[path]=float(item.attrib['timestep'])
        files=sorted(times,key=times.get)
    else:
        files=sorted(work.glob('temperature*.vtu'))
        if not files:
            files=sorted((work/'mesh').glob('temperature*.vtu'))
    if not files:
        raise SolverFailure('Elmer未生成温度VTU工件。')
    snapshots=[]
    expected=np.asarray(mesh['points'])
    for file in files:
        raw=meshio.read(file)
        names=[n for n in raw.point_data if n.lower()=='temperature']
        if len(names)!=1 or len(raw.points)!=len(expected):
            raise SolverFailure('Elmer输出节点数或温度字段不匹配。')
        distance,idx=cKDTree(raw.points[:,:2]).query(expected)
        if np.max(distance)>1e-10 or len(np.unique(idx))!=len(expected):
            raise SolverFailure('Elmer输出不能与原网格节点一一对应。')
        inverse=np.empty(len(idx),dtype=int);inverse[idx]=np.arange(len(idx))
        actual=[]
        for block,labels in zip(raw.cells,raw.cell_data.get('GeometryIds',[])):
            if block.type=='triangle':
                actual.extend(np.column_stack((np.sort(inverse[block.data],axis=1),labels)).tolist())
        expected_cells=np.column_stack((np.sort(np.asarray(mesh['triangles']),axis=1),mesh['domain_ids']))
        if len(actual)!=len(expected_cells) or sorted(map(tuple,actual))!=sorted(map(tuple,expected_cells.tolist())):
            raise SolverFailure('Elmer输出单元连接或材料区域与共用网格不一致。')
        temp=np.asarray(raw.point_data[names[0]]).reshape(-1)[idx]
        if not np.isfinite(temp).all() or temp.min()<=0:
            raise SolverFailure('Elmer温度不是有效绝对温度。')
        snapshots.append({'file':file.name,'time_s':times.get(file.resolve()),'temperature_k':temp.tolist(),'minimum_k':float(temp.min()),'maximum_k':float(temp.max())})
    if t:
        stride=max(1,math.ceil(t['steps']/100))
        expected_times={t['steps']*t['step_s'],*[i*t['step_s'] for i in range(1,t['steps']+1,stride)]}
        actual_times=[s['time_s'] for s in snapshots]
        # Elmer 26.1 PVD timestamps use four significant digits. Match those
        # reported times against the declared sampling grid within that print
        # precision, then retain both the reported and unrounded SI time.
        if len(actual_times)!=len(expected_times) or any(abs(a-b)>max(1e-10,abs(b)*5.1e-4) for a,b in zip(actual_times,sorted(expected_times))):
            raise SolverFailure('Elmer时间序列帧数不完整。')
        for snap,exact_time in zip(snapshots,sorted(expected_times)):
            snap['reported_time_s']=snap['time_s'];snap['time_s']=exact_time
    else:
        if len(snapshots)!=1:
            raise SolverFailure('稳态输出帧数异常。')
        snapshots[0]['time_s']=None
    return {'solver':version,'execution':execution,'mesh_sha256':mesh['sha256'],'problem_sha256':digest(problem),
            'snapshots':snapshots,'engineering_approval':False}
