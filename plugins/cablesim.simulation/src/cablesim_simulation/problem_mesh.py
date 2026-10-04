"""One canonical mesh; all solver files preserve its node/cell/material identity."""
from .report import digest


def exterior(points, cells):
    edges = {}
    for i, tri in enumerate(cells):
        for a,b in ((tri[0],tri[1]),(tri[1],tri[2]),(tri[2],tri[0])):
            key = tuple(sorted((int(a),int(b))))
            edges.setdefault(key, []).append(i)
    if any(len(v)>2 for v in edges.values()):
        raise ValueError('网格具有非流形边。')
    return [(a,b,owners[0]) for (a,b),owners in edges.items() if len(owners)==1]


def package(points, cells, ids, regions, boundaries):
    import numpy as np
    points,cells = np.asarray(points),np.asarray(cells)
    xy = points[cells]
    signed = (xy[:,1,0]-xy[:,0,0])*(xy[:,2,1]-xy[:,0,1])-(xy[:,2,0]-xy[:,0,0])*(xy[:,1,1]-xy[:,0,1])
    if np.any(np.abs(signed)<1e-24):
        raise ValueError('退化单元。')
    cells = cells.copy()
    cells[signed<0] = cells[signed<0][:,[0,2,1]]
    tagged = []
    for a,b,parent in exterior(points,cells):
        ends = points[[a,b]]
        matches = []
        for j,bc in enumerate(boundaries):
            select = bc['selector']; values = bc['values']
            ok = select == 'outer'
            if select in ('x','z'):
                ok = np.allclose(ends[:,0 if select=='x' else 1], values[0], rtol=0, atol=1e-8)
            elif select == 'circle':
                ok = np.allclose(np.linalg.norm(ends-np.asarray(values[:2]),axis=1),values[2],rtol=0,atol=1e-8)
            if ok:
                matches.append(j+1)
        if len(matches)!=1:
            raise ValueError('每条外边界必须恰好映射一个条件。')
        tagged.append([a,b,parent,matches[0]])
    result = {'schema':'cablesim.analysis-mesh/1','length_unit':'m','points':points.tolist(),
              'triangles':cells.tolist(),'domain_ids':list(map(int,ids)), 'regions':regions,'boundary_edges':tagged}
    result['sha256'] = digest(result)
    return result


def build(problem, controls):
    import gmsh
    import numpy as np
    gmsh.initialize()
    try:
        gmsh.option.setNumber('General.Terminal',0)
        gmsh.option.setNumber('General.NumThreads',1)
        gmsh.model.add('simulation-problem')
        occ = gmsh.model.occ
        entities = []
        for shape in problem.geometry:
            v = shape.values
            tag = occ.addDisk(v[0],v[1],0,v[2],v[2]) if shape.kind=='disk' else occ.addRectangle(v[0],v[1],0,v[2]-v[0],v[3]-v[1])
            entities.append((2,tag))
        # A prescribed interior triangle keeps the raw P1 curl(A) sampling cell
        # identical while exterior truncation changes. The probe is its strict
        # interior centroid, never an ambiguous mesh vertex or element edge.
        physical_count=len(entities);probe_vertices=[]
        if controls.probe_cell_size_m is not None:
            from math import sqrt
            h=controls.probe_cell_size_m
            for x,z in problem.probes_m:
                vertices=[(x+h,z),(x-h/2,z+sqrt(3)*h/2),(x-h/2,z-sqrt(3)*h/2)]
                points=[occ.addPoint(a,b,0) for a,b in vertices]
                edges=[occ.addLine(points[i],points[(i+1)%3]) for i in range(3)]
                entities.append((2,occ.addPlaneSurface([occ.addCurveLoop(edges)])))
                probe_vertices.append(vertices)
        if len(entities)>1:
            _, mapping = occ.fragment([entities[0]],entities[1:])
        else:
            mapping = [entities]
        occ.synchronize()
        assignment = {}
        for i,parts in enumerate(mapping[:physical_count],1):
            for dim,tag in parts:
                if dim==2:
                    assignment[tag]=i
        removed=[tag for tag,i in assignment.items() if problem.geometry[i-1].void]
        if removed:
            occ.remove([(2,t) for t in removed],recursive=False)
            occ.synchronize()
            for t in removed:
                del assignment[t]
        if probe_vertices:
            for parts in mapping[physical_count:]:
                if len(parts)!=1 or parts[0][0]!=2 or parts[0][1] not in assignment:
                    raise ValueError('mesh.probe_cell_size_m：固定测点单元必须完整位于一个有效材料域内；请减小尺寸或移动测点。')
                surface=parts[0][1]
                edges=[t for d,t in gmsh.model.getBoundary([(2,surface)],oriented=False) if d==1]
                if len(edges)!=3:
                    raise ValueError('固定测点单元跨越了材料界面，不能保持同一原始场取样单元。')
                for edge in edges:gmsh.model.mesh.setTransfiniteCurve(edge,2)
                gmsh.model.mesh.setTransfiniteSurface(surface)
        near = set()
        for tag,region in assignment.items():
            if problem.geometry[region-1].kind=='disk':
                near.update(t for d,t in gmsh.model.getBoundary([(2,tag)],oriented=False) if d==1)
        fields=[]
        # Boundary-distance refinement alone can coarsen the centre of a disk
        # as SizeMin decreases (DistMin shrinks with it). Keep each material
        # disk's interior at the requested size as well as its boundary.
        for shape_index,shape in enumerate(problem.geometry):
            if shape.kind=='disk' and not shape.void and (shape_index>0 or len(problem.geometry)==1):
                x,z,radius=shape.values
                ball=gmsh.model.mesh.field.add('Ball')
                for key,val in [('XCenter',x),('YCenter',z),('ZCenter',0),('Radius',radius),('Thickness',0),('VIn',controls.size_m),('VOut',controls.far_size_m)]:
                    gmsh.model.mesh.field.setNumber(ball,key,val)
                fields.append(ball)
        if near:
            d = gmsh.model.mesh.field.add('Distance')
            gmsh.model.mesh.field.setNumbers(d,'CurvesList',sorted(near))
            gmsh.model.mesh.field.setNumber(d,'Sampling',200)
            f = gmsh.model.mesh.field.add('Threshold')
            for k,v in [('InField',d),('SizeMin',controls.size_m),('SizeMax',controls.far_size_m),('DistMin',controls.size_m*4),('DistMax',controls.transition_m)]:
                gmsh.model.mesh.field.setNumber(f,k,v)
            fields.append(f)
        else:
            gmsh.option.setNumber('Mesh.MeshSizeMin',controls.size_m)
            gmsh.option.setNumber('Mesh.MeshSizeMax',controls.size_m)
        for x,z in problem.probes_m:
            ball=gmsh.model.mesh.field.add('Ball')
            probe_radius=min(0.1,controls.transition_m)
            for key,val in [('XCenter',x),('YCenter',z),('ZCenter',0),('Radius',probe_radius),
                            ('Thickness',probe_radius),('VIn',min(controls.far_size_m,controls.probe_cell_size_m/2 if controls.probe_cell_size_m else controls.size_m*20)),('VOut',controls.far_size_m)]:
                gmsh.model.mesh.field.setNumber(ball,key,val)
            fields.append(ball)
        if fields:
            smallest=gmsh.model.mesh.field.add('Min')
            gmsh.model.mesh.field.setNumbers(smallest,'FieldsList',fields)
            background=smallest
            if controls.exterior_growth_start_m is not None:
                growth=gmsh.model.mesh.field.add('MathEval')
                gmsh.model.mesh.field.setString(growth,'F',f'{controls.exterior_growth_rate}*Max(0,Sqrt(x*x+y*y)-{controls.exterior_growth_start_m})')
                background=gmsh.model.mesh.field.add('Max')
                gmsh.model.mesh.field.setNumbers(background,'FieldsList',[smallest,growth])
            gmsh.model.mesh.field.setAsBackgroundMesh(background)
        gmsh.option.setNumber('Mesh.MeshSizeFromPoints',0)
        gmsh.option.setNumber('Mesh.MeshSizeFromCurvature',0)
        gmsh.option.setNumber('Mesh.MeshSizeExtendFromBoundary',0)
        gmsh.option.setNumber('Mesh.ElementOrder',1)
        # Four cardinal boundary points are retained for one-sided material
        # probes; circles are discretized identically for every solver.
        from math import ceil
        for _,curve in gmsh.model.getEntities(1):
            if gmsh.model.getType(1,curve) in ('Circle','Ellipse'):
                count=4*max(ceil(controls.minimum_circle_segments/4),ceil(occ.getMass(1,curve)/controls.size_m/4))
                gmsh.model.mesh.setTransfiniteCurve(curve,count+1)
        gmsh.model.mesh.generate(2)
        tags,coords,_ = gmsh.model.mesh.getNodes()
        index = {int(t):i for i,t in enumerate(tags)}
        cells,ids = [],[]
        for tag,region in assignment.items():
            kinds,_,nodes = gmsh.model.mesh.getElements(2,tag)
            for kind,conn in zip(kinds,nodes):
                if kind != 2:
                    raise ValueError('只支持线性三角形。')
                part = [[index[int(n)] for n in row] for row in conn.reshape(-1,3)]
                cells.extend(part); ids.extend([region]*len(part))
        cells = np.asarray(cells,dtype=int)
        used = np.unique(cells)
        if len(used)>controls.max_nodes:
            raise ValueError(f'网格节点{len(used)}超过显式上限{controls.max_nodes}。')
        remap = np.full(len(tags),-1,dtype=int); remap[used]=np.arange(len(used))
        points = np.asarray(coords).reshape(-1,3)[used,:2]
        present = set(ids)
        if present != {i for i,r in enumerate(problem.geometry,1) if not r.void}:
            raise ValueError('几何覆盖导致某个材料区域消失。')
        regions = [{'id':i,'uid':r.uid,'material':r.material.model_dump(mode='json')} for i,r in enumerate(problem.geometry,1) if not r.void]
        result=package(points,remap[cells],ids,regions,[b.model_dump(mode='json') for b in problem.boundaries])
        if controls.field_order is not None:
            result['field_order']=controls.field_order
            result.pop('sha256');result['sha256']=digest(result)
        if probe_vertices:
            triangles=np.asarray(result['triangles']);coordinates=np.asarray(result['points'])
            sampled=[]
            for centre,vertices in zip(problem.probes_m,probe_vertices):
                indices=[]
                for vertex in vertices:
                    distance=np.linalg.norm(coordinates-vertex,axis=1);index=int(np.argmin(distance))
                    if distance[index]>1e-10:raise ValueError('固定测点单元节点未保留。')
                    indices.append(index)
                matches=np.flatnonzero(np.all(np.sort(triangles,axis=1)==sorted(indices),axis=1))
                if len(matches)!=1:raise ValueError('固定测点单元被剖分或丢失。')
                vertices=sorted(coordinates[indices].tolist())
                sampled.append({'point_m':list(centre),'vertices_m':vertices,'cell_sha256':digest(vertices),
                                'triangle_index':int(matches[0]),'sampling':'strict-interior centroid of one unchanged triangle; field polynomial order recorded separately'})
            result['probe_cells']=sampled
            result.pop('sha256');result['sha256']=digest(result)
        return result
    finally:
        gmsh.finalize()


def gmsh_file(mesh, path):
    """Deterministic ASCII MSH2, no remeshing by solver adapters."""
    lines = ['$MeshFormat','2.2 0 8','$EndMeshFormat','$Nodes',str(len(mesh['points']))]
    lines += [f'{i} {x:.17g} {z:.17g} 0' for i,(x,z) in enumerate(mesh['points'],1)]
    lines += ['$EndNodes','$Elements',str(len(mesh['triangles'])+len(mesh['boundary_edges']))]
    for i,(tri,r) in enumerate(zip(mesh['triangles'],mesh['domain_ids']),1):
        lines.append(f'{i} 2 2 {r} {r} '+' '.join(str(n+1) for n in tri))
    offset = len(mesh['triangles'])
    for i,(a,b,_,bc) in enumerate(mesh['boundary_edges'],offset+1):
        lines.append(f'{i} 1 2 {1000+bc} {1000+bc} {a+1} {b+1}')
    lines.append('$EndElements')
    path.write_text('\n'.join(lines)+'\n',encoding='ascii')


def from_thermal(value, parameters):
    """Preserve the exact mesh generator used by the existing thermal method."""
    from .thermal_input import prepare
    from .thermal_mesh import build as thermal_build
    model,controls = prepare(value,parameters)
    if controls.operation!='temperature' or any(c.electrical for c in model.cables):
        raise ValueError('Elmer热交叉核验要求显式固定热源或给定芯温；温变电阻尚未翻译，不能静默冻结。')
    conditions = []
    for name,bc in model.environment.boundaries.items():
        if bc.emissivity:
            raise ValueError('Elmer适配尚未翻译局部辐射，不能静默丢弃。')
        if name=='surface':
            for c in model.cables:
                conditions.append({'uid':'surface:'+c.uid,'selector':'circle','values':[c.x_m,c.z_m,c.layers[-1].outer_radius_m],
                                   'kind':bc.kind,'value':bc.temperature_k,'h_w_m2_k':bc.h_w_m2_k})
        else:
            bounds = model.environment.background.bounds_m
            axis,index = {'left':('x',0),'right':('x',2),'bottom':('z',1),'top':('z',3)}[name]
            conditions.append({'uid':name,'selector':axis,'values':[bounds[index]],'kind':bc.kind,'value':bc.temperature_k,'h_w_m2_k':bc.h_w_m2_k})
    for c in model.cables:
        if c.prescribed_core_temperature_k is not None:
            conditions.append({'uid':'core:'+c.uid,'selector':'circle','values':[c.x_m,c.z_m,c.layers[0].outer_radius_m],
                               'kind':'temperature','value':c.prescribed_core_temperature_k,'h_w_m2_k':None})
    points,cells,ids,descs = thermal_build(model,controls)
    regions = [{'id':r['id'],'uid':r['uid'],'material':{'k_w_m_k':r['k'],'source':'frozen thermal-model provenance'},'thermal_region':r} for r in descs]
    mesh = package(points,cells,ids,regions,conditions)
    geometry=[]
    env=model.environment
    if env.kind=='ground':
        for r in [env.background,*env.soil_layers,*env.backfills]:
            geometry.append({'uid':r.uid,'kind':'rectangle','values':list(r.bounds_m),'material':{'k_w_m_k':r.k_w_m_k,'source':'thermal-model provenance'}})
    from math import log,pi
    for c in model.cables:
        if c.duct:
            d=c.duct
            for uid,r,k in [(d.uid+'/wall',d.outer_radius_m,d.k_w_m_k),(d.uid+'/air',d.inner_radius_m,log(d.inner_radius_m/c.layers[-1].outer_radius_m)/(2*pi*d.air_resistance_k_m_w))]:
                geometry.append({'uid':uid,'kind':'disk','values':[c.x_m,c.z_m,r],'material':{'k_w_m_k':k,'source':d.source}})
        for i,l in reversed(list(enumerate(c.layers))):
            void=i==0 and c.prescribed_core_temperature_k is not None
            geometry.append({'uid':l.uid,'kind':'disk','values':[c.x_m,c.z_m,l.outer_radius_m],'void':void,
                             'material':{'k_w_m_k':l.k_w_m_k,'source':'thermal-model provenance'}})
    problem = {'schema_version':'cablesim.simulation-problem/1','physics':'steady_heat',
               'geometry':geometry,'boundaries':conditions,
               'excitations':[{'regions':[l.uid],'kind':'heat_w_m','value':[l.fixed_heat_w_m],'schedule':[],
                               'source':'thermal model'} for c in model.cables for l in c.layers if l.fixed_heat_w_m],
               'time':None,'probes_m':[],'provenance':model.provenance,'assumptions':model.assumptions}
    from .problem import Problem
    return Problem.model_validate(problem).model_dump(mode='json'),mesh,model,controls
