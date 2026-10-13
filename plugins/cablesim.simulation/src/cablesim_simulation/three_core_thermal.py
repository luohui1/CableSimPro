"""IEC balanced three-core losses fed back from a resolved 2D thermal field.

The IEC electrical state uses mean conductor/screen temperatures within each
balanced cable; the heat PDE resolves each core and all common thermal layers.
No strand, tape-contact, or steel hysteresis Maxwell field is claimed here.
"""
from copy import deepcopy
from math import hypot, log, pi
from cablesim_sdk.domain import DomainDocument
from .far_boundary import ThermalParameters, image_rise, loss_sources, default_boundary_reason
from cablesim_sdk.simulation import Problem
from cablesim_sdk.validation import FieldValueError
from .report import digest


def prepare(value, parameters):
    from cablesim_iec60287.domain import prepare as prepare_iec
    p = ThermalParameters.model_validate(parameters)
    d = DomainDocument.model_validate(value).model_dump(mode='json')
    for uid,property in p.material_thermal_resistivity.items():
        material = next((row for row in d['materials'] if row['id']==uid),None)
        if material is None or material['thermal_resistivity'] is not None:
            raise FieldValueError('此参数只补齐已有材料的缺失热阻率，不覆盖已保存物性。','parameters','material_thermal_resistivity',uid)
        material['thermal_resistivity'] = property.thermal_resistivity
        d['provenance']['/materials/'+uid.replace('/','~1')+'/thermal_resistivity'] = {
            'kind':'derived','reference':property.source,'reviewed':False}
    for name,uid in [('sections',p.domain_options.section_id),('load_cases',p.domain_options.load_id)]:
        d[name] = [row for row in d[name] if row['id']==uid]
        if len(d[name])!=1:
            raise FieldValueError('请选择已保存的截面和稳态负荷。','parameters','domain_options','section_id' if name=='sections' else 'load_id')
    section = d['sections'][0];placed = {q['cable'] for q in section['placements']}
    reason=default_boundary_reason(section,d['load_cases'][0])
    if reason and 'outer_boundary' not in p.model_fields_set:
        raise FieldValueError(reason+'；请在侧边与底边字段显式选择适用边界，不自动替换。','parameters','outer_boundary')
    if p.outer_boundary=='kennelly_image' and reason:
        raise FieldValueError(reason+'；Kennelly远场不适用，请显式选择适用边界。','parameters','outer_boundary')
    d['circuits'] = [c for c in d['circuits'] if any(x['id'] in placed for x in c['cables'])]
    group = prepare_iec(d,p.iec)
    if not group.soil.get('three_core'):
        raise FieldValueError('此热场能力要求三芯独立屏蔽的平衡电缆；单芯使用相应热场能力。','cable_types')
    materials = {m['id']:m for m in d['materials']};types = {t['id']:t for t in d['cable_types']}
    instances = {x['id']:c for c in d['circuits'] for x in c['cables']}
    enclosures = {e['id']:e for e in section['enclosures']}
    geometry = [];bindings = [];ducts = []
    def thermal(mid):
        material = materials[mid];rho = material['thermal_resistivity']
        if rho is None or rho<=0:
            raise FieldValueError('补齐有来源的热阻率，单位 K·m/W。','materials',d['materials'].index(material),'thermal_resistivity')
        if material.get('dry_thermal_resistivity') is not None or material.get('critical_temperature_rise') is not None:
            raise FieldValueError('此三芯热场不覆盖土壤干燥。','materials',d['materials'].index(material))
        return {'k_w_m_k':1/rho,'source':p.domain_options.source+'; domain material '+mid}
    bounds = list(p.domain_options.bounds_m)
    geometry.append({'uid':'environment','kind':'rectangle','values':bounds,'material':thermal(section['medium']['material'])})
    if section['backfill']:
        b = section['backfill'];a = [b['x']-b['width']/2,b['z']-b['height']/2,b['x']+b['width']/2,b['z']+b['height']/2]
        if a[0]<bounds[0] or a[1]<bounds[1] or a[2]>bounds[2] or a[3]>bounds[3]:
            raise FieldValueError('计算域须包含完整回填区域。','parameters','domain_options','bounds_m')
        geometry.append({'uid':b['id'],'kind':'rectangle','values':a,'material':thermal(b['material'])})
    def disk(uid,x,z,radius,material):
        return {'uid':uid,'kind':'disk','values':[x,z,radius],'material':material}
    ambient = section['medium']['surface_temperature']
    for q,c in zip(section['placements'],group.cables):
        if q['cable']!=c['id']:
            q = next(row for row in section['placements'] if row['cable']==c['id'])
        circuit = instances[q['cable']];ct = types[circuit['cable_type']];x,z = q['x'],q['z']
        core_outer = [core['conductor']['diameter']/2+sum(l['thickness'] for l in core['layers']) for core in ct['cores']]
        radius = max(hypot(core['x'],core['z'])+r for core,r in zip(ct['cores'],core_outer))
        common = [];armor_uid = None
        for i,layer in enumerate(ct['common_layers']):
            radius += layer['thickness'];uid = q['cable']+f'/common-{i}'
            common.append(disk(uid,x,z,radius,thermal(layer['material'])))
            if layer['role']=='armour':armor_uid = uid
        cable_radius = radius
        if q['enclosure']:
            enclosure = enclosures[q['enclosure']];law = c['rating'].installation.duct
            outer,inner = enclosure['outer_diameter']/2,enclosure['inner_diameter']/2
            if x-outer<=bounds[0] or x+outer>=bounds[2] or z-outer<=bounds[1] or z+outer>=bounds[3]:
                raise FieldValueError('计算域须严格包住全部排管。','parameters','domain_options','bounds_m')
            gap = law.u/(1+.1*(law.v+law.y_per_k*(ambient-273.15))*radius*2000)
            uid = enclosure['id']+'/air'
            geometry.extend([disk(enclosure['id']+'/wall',x,z,outer,thermal(enclosure['material'])),
                             disk(uid,x,z,inner,{'k_w_m_k':log(inner/radius)/(2*pi*gap),'source':p.domain_options.source})])
            ducts.append({'uid':uid,'center':[x,z],'cable_radius':radius,'inner_radius':inner,'law':law})
        elif x-radius<=bounds[0] or x+radius>=bounds[2] or z-radius<=bounds[1] or z+radius>=bounds[3]:
            raise FieldValueError('计算域须严格包住全部电缆。','parameters','domain_options','bounds_m')
        geometry.extend(reversed(common))
        cores = [];screens = [];insulations = [];centers = []
        for core in ct['cores']:
            cx,cz = x+core['x'],z+core['z'];centers.append([cx,cz]);r = core['conductor']['diameter']/2
            uid = q['cable']+'/'+core['id']+'/conductor';cores.append(uid)
            layers = [disk(uid,cx,cz,r,thermal(core['conductor']['material']))]
            for i,layer in enumerate(core['layers']):
                inner = r;r += layer['thickness'];uid = q['cable']+'/'+core['id']+f'/layer-{i}'
                layers.append(disk(uid,cx,cz,r,thermal(layer['material'])))
                if layer['role'] in ('metallic_screen','metallic_sheath'):screens.append(uid)
                if layer['role']=='insulation':insulations.append({'uid':uid,'center':[cx,cz],'inner':inner,'outer':r})
            geometry.extend(reversed(layers))
        bindings.append({'entity':q['cable'],'circuit':circuit['id'],'conductors':cores,'screens':screens,
            'armour':armor_uid,'insulations':insulations,'centers':centers,'center_m':[x,z],'radius':cable_radius})
    problem = Problem.model_validate({'schema_version':'cablesim.simulation-problem/1','physics':'steady_heat',
        'geometry':geometry,'boundaries':[{'uid':'outer','selector':'outer','values':[],'kind':'temperature','value':ambient}],
        'excitations':[],'provenance':{'domain_sha256':digest(d),'source':p.domain_options.source},
        'assumptions':['Balanced IEC electrical state at cable-average metal temperatures; resolved per-core 2D heat field.',
            'Round thermal envelopes for stranded conductors and tape layers; actual saved longitudinal screen resistance and IEC steel-tape losses.']})
    problem.assumptions.append('Side/bottom: '+p.outer_boundary+'; ground surface: saved ambient isothermal at z=0.')
    return p,d,group,problem,bindings,ducts


def _thermal_system(prepared, mesh):
    import numpy as np
    from skfem import MeshTri,Basis,FacetBasis,ElementTriP1,ElementTriP2,BilinearForm,LinearForm,asm
    from skfem.helpers import dot,grad
    from .problem_mesh import build
    p,d,group,problem,bindings,ducts = prepared
    mesh = build(problem,p.mesh) if mesh is None else deepcopy(mesh)
    points = np.asarray(mesh['points']);cells = np.asarray(mesh['triangles']);ids = np.asarray(mesh['domain_ids'])
    element = ElementTriP2() if p.mesh.field_order==2 else ElementTriP1()
    basis = Basis(MeshTri(points.T,cells.T),element,intorder=5)
    if basis.N>p.mesh.max_nodes:
        raise FieldValueError(f'三芯热场有{basis.N}自由度，超过声明上限；请调整网格分配。','parameters','mesh','max_nodes')
    regions = {r['uid']:r for r in mesh['regions']}
    @BilinearForm
    def conduction(u,v,w):return w.k*dot(grad(u),grad(v))
    @LinearForm
    def source(v,w):return w.q*v
    k = np.asarray([mesh['regions'][i-1]['material']['k_w_m_k'] for i in ids])[:,None]
    fixed_matrix = asm(conduction,basis,k=k);weights = {};nodes = {}
    for uid,r in regions.items():
        mask = ids==r['id'];weights[uid] = asm(source,basis,q=mask[:,None].astype(float))
        nodes[uid] = np.unique(basis.element_dofs[:,mask])
        if weights[uid].sum()<=0:raise ValueError('材料域面积非正：'+uid)
    air_laws = []
    endpoints = basis.mesh.p[:,basis.mesh.facets]
    for duct in ducts:
        mask = ids==regions[duct['uid']]['id'];unit = asm(conduction,basis,k=mask[:,None].astype(float))
        fixed_matrix -= regions[duct['uid']]['material']['k_w_m_k']*unit
        cx,cz = duct['center'];radii = np.sqrt((endpoints[0]-cx)**2+(endpoints[1]-cz)**2);interfaces = []
        for radius in (duct['cable_radius'],duct['inner_radius']):
            facets = np.flatnonzero(np.all(np.isclose(radii,radius,rtol=0,atol=1e-8),axis=0))
            if not len(facets):raise ValueError('未找到排管热阻界面。')
            interfaces.append(FacetBasis(basis.mesh,element,facets=facets,intorder=4))
        air_laws.append((duct,unit,interfaces))
    D = basis.get_dofs().all();free = np.setdiff1d(np.arange(basis.N),D)
    fixed_heat = np.zeros(basis.N)
    xy = basis.global_coordinates()
    for c,b in zip(group.cables,bindings):
        for insulation in b['insulations']:
            x,z = insulation['center'];mask = ids==regions[insulation['uid']]['id']
            density = np.zeros_like(basis.dx)
            density[mask] = 1/((xy[0,mask]-x)**2+(xy[1,mask]-z)**2)
            vector = asm(source,basis,q=density)
            fixed_heat += c['model']['wd']*vector/vector.sum()
    return mesh,basis,ids,regions,weights,nodes,air_laws,fixed_matrix,fixed_heat,D,free


def thermal_state(prepared, system, temperature):
    """Shared resolved-region loss assembly for steady and transient methods."""
    import numpy as np
    from cablesim_iec60287.three_core import electrical
    p,d,group,problem,bindings,ducts=prepared
    mesh,basis,ids,regions,weights,nodes,air_laws,fixed_matrix,fixed_heat,D,free=system
    def mean(uid):return float(weights[uid]@temperature/weights[uid].sum())
    matrix=fixed_matrix.copy();air=[]
    for duct,unit,interfaces in air_laws:
        surfaces=[float(np.sum(fb.interpolate(temperature)*fb.dx)/fb.dx.sum()) for fb in interfaces]
        mean_c=sum(surfaces)/2-273.15;law=duct['law']
        resistance=law.u/(1+.1*(law.v+law.y_per_k*mean_c)*duct['cable_radius']*2000)
        if not 0<=mean_c<=150 or resistance<=0:raise ValueError('管内空气温度越出声明的0–150°C计算区间。')
        conductivity=log(duct['inner_radius']/duct['cable_radius'])/(2*pi*resistance)
        matrix+=conductivity*unit
        regions[duct['uid']]['material']['k_w_m_k']=conductivity
        air.append({'entity':duct['uid'],'mean_temperature_c':mean_c,'resistance_k_m_w':resistance})
    load=fixed_heat.copy();states=[]
    for c,b in zip(group.cables,bindings):
        tc=sum(mean(uid) for uid in b['conductors'])/3-273.15
        ts=sum(mean(uid) for uid in b['screens'])/3-273.15
        ta=mean(b['armour'])-273.15 if b['armour'] else ts
        circuit=next(row for row in d['circuits'] if row['id']==b['circuit'])
        rc,l1,l2,details=electrical(c['model'],tc,ts,ta,group.parameters,circuit['system']['frequency'])
        wc=c['current']**2*rc;ws=wc*l1;wa=3*wc*l2['total']
        for uids,power in [(b['conductors'],wc),(b['screens'],ws),([b['armour']] if b['armour'] else [],wa)]:
            for uid in uids:load+=power*weights[uid]/weights[uid].sum()
        states.append({'entity':b['entity'],'current_a':c['current'],'conductor_mean_temperature_k':tc+273.15,
            'conductor_max_temperature_k':max(float(temperature[nodes[uid]].max()) for uid in b['conductors']),
            'conductor_joule_heat_w_m':3*wc,'screen_heat_w_m':3*ws,'armour_heat_w_m':wa,
            'dielectric_heat_w_m':3*c['model']['wd'],'lambda1':l1,'lambda2':l2['total'],'electrical_details':details})
    return matrix,load,states,air


def solve(prepared, mesh=None, *, _cache=None, _export_field=True):
    """Solve every trial; reuse only the immutable same-mesh linear assembly.

    Cache lifetime is one host case. Losses, air conductance, boundary values,
    nonlinear residuals and temperature are recomputed for every rating trial.
    """
    import numpy as np
    from scipy.sparse.linalg import splu,cg,LinearOperator
    from cablesim_iec60287.three_core import electrical,SOURCES
    from .problem_mesh import package
    p,d,group,problem,bindings,ducts=prepared
    cache={} if _cache is None else _cache
    identity=digest({'problem':problem.model_dump(mode='json'),'mesh':p.mesh.model_dump(mode='json'),
                     'dielectric':[c['model']['wd'] for c in group.cables]})
    if cache and cache['identity']!=identity:raise ValueError('载流量网格复用身份不同，拒绝复用。')
    if not cache:cache.update(identity=identity,system=_thermal_system(prepared,mesh),preconditioner=None)
    mesh,basis,ids,regions,weights,nodes,air_laws,fixed_matrix,fixed_heat,D,free=cache['system']
    ambient=group.ambient+273.15;temperature=np.full(basis.N,ambient)
    rho=1/problem.geometry[0].material.k_w_m_k
    def boundary(states):
        return image_rise(basis.doflocs[:,D],loss_sources(states,bindings),rho) if p.outer_boundary=='kennelly_image' else np.zeros(len(D))
    def evaluate(t):
        return thermal_state(prepared,cache['system'],t)
    history = [];preconditioner = cache['preconditioner']
    for iteration in range(1,p.maximum_iterations+1):
        matrix,load,states,_ = evaluate(temperature);reduced = matrix[free][:,free].tocsr()
        prescribed=boundary(states)
        rhs=load[free]-matrix[free][:,D]@prescribed
        if preconditioner is None:
            factor = splu(reduced.tocsc());preconditioner = LinearOperator(reduced.shape,matvec=factor.solve)
            cache['preconditioner']=preconditioner
        rise,status = cg(reduced,rhs,M=preconditioner,rtol=1e-11,atol=1e-12,maxiter=200)
        if status:raise ValueError('三芯当前热矩阵未收敛。')
        proposed = np.full(basis.N,ambient);proposed[free] += rise;proposed[D]+=prescribed
        delta = float(np.max(np.abs(proposed-temperature)))
        history.append({'iteration':iteration,'temperature_update_inf_k':delta,'power_w_m':float(load.sum())})
        if delta<=p.tolerance_k:
            temperature = proposed;break
        temperature += p.relaxation*(proposed-temperature)
    else:raise ValueError('三芯IEC损耗—温度反馈未收敛。')
    matrix,load,states,air = evaluate(temperature)
    boundary_error=float(np.max(np.abs(temperature[D]-ambient-boundary(states))))
    if boundary_error>p.tolerance_k:raise ValueError('当前损耗与远场边界反馈尚未收敛。')
    residual = matrix@(temperature-ambient)-load;power = float(load.sum());outflow = -float(residual[D].sum())
    balance = abs(power-outflow)/max(power,1.);physical = float(np.max(np.abs(residual[free])))
    if balance>1e-6 or physical>max(1e-5,p.tolerance_k):raise ValueError('三芯接受温度的热平衡不合格。')
    result = {'cables':states,'iterations':history,'source_heat_w_m':power,'boundary_heat_w_m':outflow,
        'energy_relative_residual':balance,'physical_residual_inf_w_m':physical,'duct_air_states':air,
        'solver':f'scikit-fem P{p.mesh.field_order or 1} / IEC60287 balanced three-core loss feedback','clauses':SOURCES,
        'outer_boundary':{'kind':p.outer_boundary,'ground_surface':'isothermal','soil_resistivity_k_m_w':rho,
            'sources':loss_sources(states,bindings) if p.outer_boundary=='kennelly_image' else [],
            'feedback_residual_k':boundary_error,'reference':'IEC 60287-2-1:2023 4.2.2; Kennelly half-space Green function'},
        'assumptions':problem.assumptions,'engineering_approval':False}
    if not _export_field:return result,None,None,None
    samples = [{'entity':b['entity'],'point_m':center,'temperature_k':float((basis.probes(np.asarray(center)[:,None])@temperature)[0]),
                'time_s':0.,'method':f'P{p.mesh.field_order or 1} interpolation at saved conductor centre'} for b in bindings for center in b['centers']]
    if p.mesh.field_order==2:
        dofs = basis.element_dofs.T
        display = dofs[:,[[0,3,5],[3,1,4],[5,4,2],[3,4,5]]].reshape(-1,3)
        mesh = package(basis.doflocs.T,display,np.repeat(ids,4),mesh['regions'],[b.model_dump(mode='json') for b in problem.boundaries])
        mesh['discretization'] = 'P2 nodal values on four linear display subtriangles per element'
    mesh.pop('sha256',None);mesh['sha256'] = digest(mesh)
    return result,mesh,temperature.tolist(),samples


def rating(prepared,mesh,*,_cache=None):
    """Locate temperature limits by real coupled FEM solves on this exact mesh."""
    from scipy.optimize import brentq
    from cablesim_sdk.ampacity import AmpacityBasis
    p,d,group,problem,bindings,ducts=prepared
    circuits=[c['id'] for c in d['circuits']]
    limits={b['entity']:next(t for t in d['cable_types'] if t['id']==next(c for c in d['circuits'] if c['id']==b['circuit'])['cable_type'])['rating']['max_conductor_temperature']['normal'] for b in bindings}
    if any(v is None for v in limits.values()):raise ValueError('缺少正常运行导体温限，不能反求允许电流。')
    modes=p.iec.get('rating_mode','individual');rows=[];trials=[];cache={} if _cache is None else _cache
    targets=[([c],'rating') for c in circuits] if modes in ('individual','both') else []
    if modes in ('simultaneous','both'):targets.append((circuits,'rating-simultaneous'))
    for varied,condition in targets:
        fixed={c['id']:c['current'] for c,b in zip(group.cables,bindings) if b['circuit'] not in varied}
        basis=AmpacityBasis(kind='conditional_fixed_load' if fixed else 'single_circuit' if len(circuits)==1 else 'common_balanced',
            display_name='其他回路固定负荷：'+', '.join(f'{uid} {current:g} A' for uid,current in fixed.items()) if fixed else '单回路能力' if len(circuits)==1 else '全回路共同能力',
            varied_circuits=varied,fixed_currents_a=fixed).model_dump()
        def evaluate(current):
            trial=deepcopy(prepared)
            for cable,binding in zip(trial[2].cables,bindings):
                if binding['circuit'] in varied:cable['current']=current
            result,_,_,_=solve(trial,mesh,_cache=cache,_export_field=False)
            excess=max(c['conductor_max_temperature_k']-limits[c['entity']] for c in result['cables'])
            trials.append({'varied_circuits':varied,'current_a':current,'maximum_excess_k':excess,
                           'energy_relative_residual':result['energy_relative_residual']})
            return excess
        low=evaluate(0.)
        if low>=0:
            for circuit in varied:rows.append({'key':'ampacity','type':'quantity','entity':circuit,'unit':'A','case':condition,'status':'unavailable','rating_basis':basis,
                'reason':{'code':'NO_POSITIVE_RATING','message':'其余回路维持保存负荷时，零电流已达到温限；没有正允许电流。'}})
            continue
        upper=max(1.,max(c['current'] for c in group.cables))
        for _ in range(16):
            if evaluate(upper)>=0:break
            upper*=1.25
        else:raise ValueError('有限元允许电流未能在有界搜索内包住温限，未返回近似值。')
        tolerance=p.iec.get('solver',{}).get('current_tolerance_a',1e-4)
        current=brentq(evaluate,0.,upper,xtol=max(tolerance,1e-7),maxiter=40)
        evaluate(current)
        for circuit in varied:rows.append({'key':'ampacity','type':'quantity','entity':circuit,'unit':'A','case':condition,
            'status':'available','value':current,'rating_basis':basis})
    return rows,trials


def host_case(request,case,job):
    from .artifacts import source,write,temperature_field
    prepared = prepare(case['input'],case.get('parameters',{}))
    if request['phase']=='check':
        from .problem_mesh import build
        mesh=build(prepared[3],prepared[0].mesh)
        nodes=len(mesh['points'])
        if prepared[0].mesh.field_order==2:
            edges={tuple(sorted((t[a],t[b]))) for t in mesh['triangles'] for a,b in ((0,1),(1,2),(2,0))}
            nodes+=len(edges)
        if nodes>prepared[0].mesh.max_nodes:
            raise FieldValueError(f'三芯热场有{nodes}自由度，超过保存上限；请增大网格尺寸或改用一阶场。','parameters','mesh','max_nodes')
        return {'case_id':case['case_id'],'status':'succeeded','results':[],'artifacts':[],
                'evidence':{'mesh_nodes':nodes,'geometry_nodes':len(mesh['points']),'mesh_elements':len(mesh['triangles']),
                            'mesh_sha256':mesh['sha256'],'field_order':prepared[0].mesh.field_order or 1}}
    from .problem_mesh import build
    analysis_mesh=build(prepared[3],prepared[0].mesh)
    cache={}
    result,mesh,temperatures,samples = solve(prepared,analysis_mesh,_cache=cache)
    ratings,trials=rating(prepared,analysis_mesh,_cache=cache) if prepared[0].iec.get('operation','both')=='both' else ([],[])
    cache.clear()
    result['rating_trials']=trials
    from .compact_field import export,display
    storage,full_artifacts=export(job,case['case_id'],mesh,temperatures)
    display_mesh,display_temperatures=display(mesh,temperatures)
    bundle = {'input':prepared[1],'parameters':prepared[0].model_dump(mode='json'),'problem':prepared[3].model_dump(mode='json'),
        'field_storage':storage,'result':result,'engineering_approval':False}
    raw = write(job,case['case_id'],'bundle','x-cablesim.simulation-bundle',bundle)
    producer = source(request,case,(job/raw['path']).read_bytes())
    field = temperature_field(display_mesh,display_temperatures,producer,samples=samples,convergence={
        'full_mesh_nodes':len(mesh['points']),'full_mesh_elements':len(mesh['triangles']),
        'display_decimated':len(display_mesh['points'])<len(mesh['points']),
        'display_notice':'显示已降采样，计算用全网格' if len(display_mesh['points'])<len(mesh['points']) else None,
        'solver_status':'converged','iterations':result['iterations'],'energy_relative_residual':result['energy_relative_residual'],
        'physical_residual_inf_w_m':result['physical_residual_inf_w_m']})
    artifact = write(job,case['case_id'],'temperature','x-cablesim.temperature-field',field)
    return {'case_id':case['case_id'],'status':'succeeded','artifacts':[raw,artifact,*full_artifacts],
        'results':[{'key':'conductor_temperature','type':'quantity','entity':c['entity'],'unit':'K','status':'available',
                    'case':'operating','value':c['conductor_max_temperature_k']} for c in result['cables']]+ratings,
        'warnings':[{'code':'IEC_THERMAL_FIELD_SCOPE','message':'三芯IEC平衡电损耗按金属区域平均温度反馈；场解析实际三芯热域。丝/带为有来源的热层等效，不是三维电磁场。'}]}
