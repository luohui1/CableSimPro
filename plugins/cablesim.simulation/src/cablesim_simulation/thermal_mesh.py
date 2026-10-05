"""由统一热模型生成材料界面共形网格；不读取显示三角形。"""
from math import log, pi


def build(model, controls):
    import gmsh
    import numpy as np
    gmsh.initialize()
    try:
        gmsh.option.setNumber('General.Terminal',0)
        gmsh.option.setNumber('General.NumThreads',1)
        gmsh.model.add('multiregion-thermal')
        occ = gmsh.model.occ
        entities, descriptions = [], []
        def rectangle(region):
            x,z,X,Z = region.bounds_m
            entities.append((2,occ.addRectangle(x,z,0,X-x,Z-z)))
            descriptions.append({'uid':region.uid,'k':region.k_w_m_k,'kind':'environment'})
        env = model.environment
        if env.kind == 'ground':
            rectangle(env.background)
            for region in env.soil_layers+env.backfills:
                rectangle(region)
        # 后面的嵌套实体覆盖前面的材料；fragment保证所有界面共享节点。
        for i,c in enumerate(model.cables):
            disks = []
            if c.duct:
                d = c.duct
                gap_k = log(d.inner_radius_m/c.layers[-1].outer_radius_m)/(2*pi*d.air_resistance_k_m_w)
                disks += [(d.outer_radius_m, {'uid':d.uid+'/wall','k':d.k_w_m_k,'kind':'duct','cable':i}),
                          (d.inner_radius_m, {'uid':d.uid+'/air','k':gap_k,'kind':'air-equivalent','cable':i})]
            disks += [(l.outer_radius_m,{'uid':l.uid,'k':l.k_w_m_k,'kind':'layer','cable':i,'layer':j})
                      for j,l in reversed(list(enumerate(c.layers)))]
            for radius,desc in disks:
                entities.append((2,occ.addDisk(c.x_m,c.z_m,0,radius,radius)))
                descriptions.append(desc)
        if len(entities) == 1:
            mapped = [[entities[0]]]
        else:
            _,mapped = occ.fragment([entities[0]],entities[1:])
        occ.synchronize()
        assignment = {}
        for desc, parts in zip(descriptions,mapped):
            for dim,tag in parts:
                if dim == 2:
                    assignment[tag] = desc
        removed = []
        prescribed_curves=set()
        for tag,desc in assignment.items():
            if desc['kind'] == 'layer' and desc['layer'] == 0 and model.cables[desc['cable']].prescribed_core_temperature_k is not None:
                removed.append(tag)
        # 给定芯温时仅保留芯表面，未知芯热导率不被补值。
        if removed:
            for tag in removed:
                prescribed_curves.update(t for d,t in gmsh.model.getBoundary([(2,tag)],oriented=False) if d==1)
            occ.remove([(2,t) for t in removed],recursive=False)
            occ.synchronize()
            for t in removed:
                del assignment[t]
        region_data, domain_surfaces = [], []
        for tag,desc in sorted(assignment.items()):
            group = len(region_data)+1
            gmsh.model.addPhysicalGroup(2,[tag],group)
            gmsh.model.setPhysicalName(2,group,desc['uid'])
            region_data.append({**desc,'id':group})
            domain_surfaces.append(tag)
        # 限制芯附近和每条材料界面；远场按距离渐变。
        near_curves = set(prescribed_curves)
        for tag,desc in assignment.items():
            if desc['kind'] != 'environment':
                near_curves.update(t for d,t in gmsh.model.getBoundary([(2,tag)],oriented=False) if d == 1)
        distance = gmsh.model.mesh.field.add('Distance')
        gmsh.model.mesh.field.setNumbers(distance,'CurvesList',sorted(near_curves))
        gmsh.model.mesh.field.setNumber(distance,'Sampling',200)
        threshold = gmsh.model.mesh.field.add('Threshold')
        band=controls.fine_mesh_band_m
        if band is None:band=max(c.layers[-1].outer_radius_m for c in model.cables)
        if band>=controls.mesh_transition_m:
            raise ValueError('controls.fine_mesh_band_m：细网格带宽须小于网格过渡距离。')
        for key,v in [('InField',distance),('SizeMin',controls.mesh_size_m),('SizeMax',controls.far_mesh_size_m),
                      ('DistMin',band),('DistMax',controls.mesh_transition_m)]:
            gmsh.model.mesh.field.setNumber(threshold,key,v)
        background=threshold
        if controls.near_soil_mesh_size_m is not None:
            box=gmsh.model.mesh.field.add('Box');margin=controls.near_soil_margin_m
            radii=[c.duct.outer_radius_m if c.duct else c.layers[-1].outer_radius_m for c in model.cables]
            for key,value in [('VIn',controls.near_soil_mesh_size_m),('VOut',controls.far_mesh_size_m),
                ('XMin',min(c.x_m-r for c,r in zip(model.cables,radii))-margin),
                ('XMax',max(c.x_m+r for c,r in zip(model.cables,radii))+margin),
                ('YMin',min(c.z_m-r for c,r in zip(model.cables,radii))-margin),
                ('YMax',max(c.z_m+r for c,r in zip(model.cables,radii))+margin),('ZMin',-1.),('ZMax',1.)]:
                gmsh.model.mesh.field.setNumber(box,key,value)
            background=gmsh.model.mesh.field.add('Min')
            gmsh.model.mesh.field.setNumbers(background,'FieldsList',[threshold,box])
        gmsh.model.mesh.field.setAsBackgroundMesh(background)
        for option in ('MeshSizeFromPoints','MeshSizeFromCurvature','MeshSizeExtendFromBoundary'):
            gmsh.option.setNumber('Mesh.'+option,0)
        gmsh.option.setNumber('Mesh.ElementOrder',1)
        gmsh.model.mesh.generate(2)
        tags,coords,_ = gmsh.model.mesh.getNodes()
        lookup = {int(t):i for i,t in enumerate(tags)}
        cells,ids = [],[]
        for group,surface in enumerate(domain_surfaces,1):
            kinds,_,connections = gmsh.model.mesh.getElements(2,surface)
            for kind,conn in zip(kinds,connections):
                if kind != 2:
                    raise ValueError('仅接受线性三角形。')
                part = [[lookup[int(n)] for n in row] for row in conn.reshape(-1,3)]
                cells.extend(part); ids.extend([group]*len(part))
        cells = np.asarray(cells,dtype=int)
        used = np.unique(cells)
        if len(used) > controls.max_nodes:
            from cablesim_sdk.validation import FieldValueError
            raise FieldValueError(f'网格含 {len(used)} 节点，超过显式上限 {controls.max_nodes}；请调整网格分配，未自动降精度。','parameters','controls','max_nodes')
        reindex = np.full(len(tags),-1,dtype=int); reindex[used] = np.arange(len(used))
        points = np.asarray(coords).reshape(-1,3)[used,:2]
        if not len(cells) or not np.isfinite(points).all():
            raise ValueError('网格为空或坐标无效。')
        # 原生二进制不经宿主传输；可重放JSON完整保留节点、连接及语义域。
        return points,reindex[cells],np.asarray(ids,dtype=int),region_data
    finally:
        gmsh.finalize()
