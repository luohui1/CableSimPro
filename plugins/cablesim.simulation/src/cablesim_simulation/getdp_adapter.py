"""Translate A_z + region electric-potential gradients to GetDP, no field solve here."""
import json
from math import pi
from .problem_mesh import gmsh_file
from .report import digest
from .solver_runtime import environment, execute, SolverFailure


def translate(problem, mesh, work, feedback=None):
    gmsh_file(mesh,work/'mesh.msh')
    regions = mesh['regions']
    order=mesh.get('field_order',1)
    by_uid = {r['uid']:r['id'] for r in regions}
    conductive = [r['id'] for r in regions if r['material']['conductivity_s_m']>0]
    impressed = [e for e in problem['excitations'] if e['kind']=='impressed_current_rms_a']
    bonded = [e for e in problem['excitations'] if len(e['regions'])>1]
    networks=problem.get('electrical_networks',[])
    lengths=problem.get('axial_lengths_m',{})
    if any(any(e['value']) or e['kind'] != ('voltage_gradient_v_m' if e.get('connection')=='series' else 'current_rms_a') for e in bonded):
        raise ValueError('多区域互联组仅支持零总电流并联或零总电压梯度串联网络。')
    def group(values):
        return '{'+','.join(map(str,values))+'}'
    lines = ['Group {', 'D = Region['+group([r['id'] for r in regions])+'];',
             'C = Region['+group(conductive)+'];',
             'Outer = Region['+group([1000+i for i in range(1,len(problem['boundaries'])+1)])+'];']
    for i,e in enumerate(problem['excitations']):
        lines.append(f'G{i} = Region['+group([by_uid[u] for u in e['regions']])+'];')
    lines += ['}', 'Function {']
    if not conductive:
        lines.append('sigma[] = 0;')
    for r in regions:
        m = r['material']
        nu=1/(4*pi*1e-7*complex(m['relative_permeability'],-m.get('relative_permeability_loss',0)))
        lines.append(f'nu[Region[{r["id"]}]] = Complex[{nu.real:.17g},{nu.imag:.17g}];')
        lines.append(f'magneticLoss[Region[{r["id"]}]] = {2*pi*problem["frequency_hz"]*nu.imag:.17g};')
        length=lengths.get(r['uid'],1.)
        lines.append(f'inverseLength[Region[{r["id"]}]] = {1/length:.17g};')
        if r['id'] in conductive:
            expression=f'{m["conductivity_s_m"]:.17g}'
            if feedback is not None:
                law=feedback['laws'][r['uid']]
                expression+=f'/(1+{law["alpha_per_k"]:.17g}*(ScalarField[XYZ[]]{{1}}-{law["reference_temperature_k"]:.17g}))'
            lines.append(f'sigma[Region[{r["id"]}]] = {expression};')
    if impressed:
        import numpy as np
        xy=np.asarray(mesh['points'])[np.asarray(mesh['triangles'])]
        a=xy[:,1]-xy[:,0];b=xy[:,2]-xy[:,0];area=np.abs(a[:,0]*b[:,1]-a[:,1]*b[:,0])/2
        for e in impressed:
            rid=by_uid[e['regions'][0]]
            value=complex(e['value'][0],e['value'][1] if len(e['value'])>1 else 0)/float(area[np.asarray(mesh['domain_ids'])==rid].sum())
            lines.append(f'js[Region[{rid}]] = Vector[0,0,Complex[{value.real:.17g},{value.imag:.17g}]];')
    lines += ['}', 'Constraint {','{ Name A0; Case {']
    for i,b in enumerate(problem['boundaries'],1):
        lines.append(f'{{ Region Region[{1000+i}]; Value {b["value"]:.17g}; }}')
    lines += ['} }']
    if order==2:
        lines+=['{ Name A2; Case { { Region Outer; Value 0; } } }']
    # Each region has its own U/I. Parallel branches enforce equal U and sum I=0
    # inside GetDP's network equations, not in Python postprocessing.
    for label,kind in [('Current','current_rms_a'),('Voltage','voltage_gradient_v_m')]:
        lines += [f'{{ Name {label}; Case {{']
        for i,e in enumerate(problem['excitations']):
            if e['kind']==kind and len(e['regions'])==1:
                real=e['value'][0]; imag=e['value'][1] if len(e['value'])>1 else 0
                if kind=='voltage_gradient_v_m':
                    length=lengths.get(e['regions'][0],1.)
                    real*=length;imag*=length
                lines.append(f'{{ Region G{i}; Value Complex[{real:.17g},{imag:.17g}]; }}')
        lines += ['} }']
    if bonded or networks:
        lines += ['{ Name Bonding; Type Network; Case Bonded {']
        node=1
        for e in bonded:
            n=len(e['regions'])
            for index,uid in enumerate(e['regions']):
                a,b=(node+index,node+(index+1)%n) if e.get('connection')=='series' else (node,node+1)
                lines.append(f'{{ Region Region[{by_uid[uid]}]; Branch {{{a},{b}}}; }}')
            node+=max(n,2)
        for network in networks:
            nodes={number:node+index for index,number in enumerate(sorted({n for branch in network['branches'] for n in branch['nodes']}))}
            for branch in network['branches']:
                a,b=[nodes[n] for n in branch['nodes']]
                lines.append(f'{{ Region Region[{by_uid[branch["region"]]}]; Branch {{{a},{b}}}; }}')
            node+=len(nodes)
        lines += ['} }']
    lines += ['}',
              'Jacobian { { Name J; Case { { Region All; Jacobian Vol; } } } }',
              'Integration { { Name Q; Case { { Type Gauss; Case { { GeoElement Triangle; NumberOfPoints '+('7' if order==2 or feedback is not None else '4')+'; } } } } } }',
              'FunctionSpace {',
              '{ Name H_A; Type Form1P; BasisFunction { { Name s; NameOfCoef a; Function BF_PerpendicularEdge; Support D; Entity NodesOf[All]; } '+
              ('{ Name s2; NameOfCoef a2; Function BF_PerpendicularEdge_2E; Support D; Entity EdgesOf[All]; } ' if order==2 else '')+
              '} Constraint { { NameOfCoef a; EntityType NodesOf; NameOfConstraint A0; } '+
              ('{ NameOfCoef a2; EntityType EdgesOf; NameOfConstraint A2; } ' if order==2 else '')+'} }',
              '{ Name H_U; Type Form1P; BasisFunction {']
    lines.append('{ Name ur; NameOfCoef u; Function BF_RegionZ; Support C; Entity C; }')
    lines += ['} GlobalQuantity { { Name U; Type AliasOf; NameOfCoef u; } { Name I; Type AssociatedWith; NameOfCoef u; } }',
              'Constraint { { NameOfCoef U; EntityType Region; NameOfConstraint Voltage; } { NameOfCoef I; EntityType Region; NameOfConstraint Current; } } }',
              '}', 'Formulation { { Name Eddy; Type FemEquation;',
              'Quantity { { Name a; Type Local; NameOfSpace H_A; } { Name u; Type Local; NameOfSpace H_U; } { Name U; Type Global; NameOfSpace H_U[U]; } { Name I; Type Global; NameOfSpace H_U[I]; } }',
              'Equation {',
              'Integral { [ nu[]*Dof{d a}, {d a} ]; In D; Jacobian J; Integration Q; }',
              'Integral { DtDof [ sigma[]*Dof{a}, {a} ]; In C; Jacobian J; Integration Q; }',
              'Integral { [ sigma[]*inverseLength[]*Dof{u}, {a} ]; In C; Jacobian J; Integration Q; }',
              'Integral { DtDof [ sigma[]*Dof{a}, {u} ]; In C; Jacobian J; Integration Q; }',
              'Integral { [ sigma[]*inverseLength[]*Dof{u}, {u} ]; In C; Jacobian J; Integration Q; }',
              'GlobalTerm { [ Dof{I}, {U} ]; In C; }']
    if bonded or networks:
        bonded_ids=[by_uid[u] for e in bonded for u in e['regions']]+[by_uid[branch['region']] for network in networks for branch in network['branches']]
        lines += ['GlobalEquation { Type Network; NameOfConstraint Bonding; { Node {I}; Loop {U}; Equation {I}; In Region['+group(bonded_ids)+']; } }']
    if impressed:
        source_ids=[by_uid[e['regions'][0]] for e in impressed]
        lines.append('Integral { [ -js[], {a} ]; In Region['+group(source_ids)+']; Jacobian J; Integration Q; }')
    lines += ['} } }',
              'Resolution { { Name SolveEddy; System { { Name S; NameOfFormulation Eddy; Type ComplexValue; Frequency '+str(problem['frequency_hz'])+'; } } Operation { Generate[S]; Solve[S]; SaveSolution[S]; } } }',
              'PostProcessing { { Name Fields; NameOfFormulation Eddy; Quantity {',
              '{ Name A; Value { Local { [ CompZ[{a}] ]; In D; Jacobian J; } } }',
              '{ Name B; Value { Local { [ {d a} ]; In D; Jacobian J; } } }',
              '{ Name Jz; Value { Local { [ -sigma[]*CompZ[Dt[{a}]+inverseLength[]*{u}] ]; In C; Jacobian J; } } }',
              '{ Name Ez; Value { Local { [ -CompZ[Dt[{a}]+inverseLength[]*{u}] ]; In C; Jacobian J; } } }',
              '{ Name P; Value { Integral { [ sigma[]*SquNorm[Dt[{a}]+inverseLength[]*{u}] ]; In C; Jacobian J; Integration Q; } } }',
              '{ Name Pmag; Value { Integral { [ magneticLoss[]*SquNorm[{d a}] ]; In D; Jacobian J; Integration Q; } } }',
              '{ Name Inet; Value { Integral { [ -sigma[]*CompZ[Dt[{a}]+inverseLength[]*{u}] ]; In C; Jacobian J; Integration Q; } } }',
              '} } }',
              'PostOperation { { Name Export; NameOfPostProcessing Fields; Operation {',
              'Print[A, OnElementsOf D, Format NodeTable, File "a.txt"];']
    for r in regions:
        if r['material'].get('relative_permeability_loss',0):
            lines.append(f'Print[Pmag[Region[{r["id"]}]], OnGlobal, Format Table, File "magnetic-loss-{r["id"]}.txt"];')
        if r['id'] in conductive:
            for quantity,filename in [('P','power'),('Inet','current')]:
                lines.append(f'Print[{quantity}[Region[{r["id"]}]], OnGlobal, Format Table, File "{filename}-{r["id"]}.txt"];')
            if feedback is not None or problem['probes_m'] or any(p['region']==r['uid'] for p in problem.get('current_probes',[])):
                lines.append(f'Print[Jz, OnElementsOf Region[{r["id"]}], Format NodeTable, File "j-{r["id"]}.txt"];')
            if feedback is not None:
                lines.append(f'Print[Ez, OnElementsOf Region[{r["id"]}], Format NodeTable, File "e-{r["id"]}.txt"];')
    for i,(x,z) in enumerate(problem['probes_m']):
        lines.append(f'Print[B, OnPoint {{{x:.17g},{z:.17g},0}}, Format Table, File "probe-{i}.txt"];')
    lines += ['} } }']
    if feedback is not None:
        lines=[line.replace('Generate[S]; Solve[S];','GmshRead["temperature.pos"]; Generate[S]; Solve[S];') for line in lines]
        values=feedback.get('temperature_k');points=mesh['points']
        view=['View "temperature" {']
        for index,tri in enumerate(mesh['triangles']):
            xyz=','.join(f'{v:.17g}' for n in tri for v in (*points[n],0.))
            local=feedback['temperature_triangles_k'][index] if 'temperature_triangles_k' in feedback else [values[n] for n in tri]
            ts=','.join(f'{v:.17g}' for v in local)
            view.append(f'ST({xyz}){{{ts}}};')
        (work/'temperature.pos').write_text('\n'.join(view+['};']),'ascii')
    (work/'case.pro').write_text('\n'.join(lines)+'\n',encoding='ascii')


def solve(problem, mesh, work, configuration=None, *, feedback=None):
    work.mkdir(parents=True,exist_ok=True)
    executable,env,version = environment('getdp',work,configuration)
    translate(problem,mesh,work,feedback)
    execution = execute(executable,['case.pro','-msh','mesh.msh','-solve','SolveEddy','-pos','Export','-v','3'],work,env)
    # Parsing is deliberately strict: a missing output cannot become a zero.
    import numpy as np
    currents=[];magnetic_losses=[]
    xy=np.asarray(mesh['points'])[np.asarray(mesh['triangles'])]
    areas=np.abs((xy[:,1,0]-xy[:,0,0])*(xy[:,2,1]-xy[:,0,1])-(xy[:,2,0]-xy[:,0,0])*(xy[:,1,1]-xy[:,0,1]))/2
    for region in mesh['regions']:
        if region['material'].get('relative_permeability_loss',0):
            raw=np.loadtxt(work/f'magnetic-loss-{region["id"]}.txt',ndmin=2)
            if raw.shape!=(1,3) or not np.isfinite(raw).all() or raw[0,1]<0 or abs(raw[0,2])>1e-10*max(1,raw[0,1]):
                raise SolverFailure('GetDP磁滞损耗必须为非负有限实数。')
            magnetic_losses.append({'entity':region['uid'],'magnetic_loss_w_m':float(raw[0,1])})
        if region['material']['conductivity_s_m']<=0:
            continue
        r=region['id']
        power=np.loadtxt(work/f'power-{r}.txt',ndmin=2)
        current=np.loadtxt(work/f'current-{r}.txt',ndmin=2)
        if power.shape!=(1,3) or current.shape!=(1,3) or not np.isfinite(power).all() or not np.isfinite(current).all():
            raise SolverFailure('GetDP积分输出格式不匹配。')
        real,imag = map(float,current[0,1:])
        magnitude = float(np.hypot(real,imag))
        watts = float(power[0,1])
        if watts<0 or abs(power[0,2])>1e-10*max(1,abs(watts)):
            raise SolverFailure('GetDP焦耳损耗必须为非负实数。')
        area = float(areas[np.asarray(mesh['domain_ids'])==r].sum())
        rdc = 1/(region['material']['conductivity_s_m']*area)
        currents.append({'entity':region['uid'],'current_complex_rms_a':[real,imag],'current_rms_a':magnitude,
                         'joule_loss_w_m':watts,'dc_resistance_ohm_m':rdc,
                         'ac_resistance_ohm_m':watts/magnitude**2 if magnitude>1e-10 and any(region['uid'] in e['regions'] and e['kind']=='current_rms_a' and any(e['value']) for e in problem['excitations']) else None})
    constraint_errors=[]
    by_region={row['entity']:complex(*row['current_complex_rms_a']) for row in currents}
    for network in problem.get('electrical_networks',[]):
        balances={n:0j for branch in network['branches'] for n in branch['nodes']}
        for branch in network['branches']:
            a,b=branch['nodes'];current=by_region[branch['region']]
            balances[a]+=current;balances[b]-=current
        error=max(map(abs,balances.values()),default=0.)
        scale=max((abs(by_region[branch['region']]) for branch in network['branches']),default=0.)
        constraint_errors.append({'network':network['id'],'absolute_error_a':error,'constraint':'network-node-KCL'})
        if error>1e-7*max(1.,scale):
            raise SolverFailure('GetDP接地拓扑网络KCL不满足：'+network['id'])
    for e in problem['excitations']:
        if e.get('connection')=='series':
            group_currents=[complex(*r['current_complex_rms_a']) for r in currents if r['entity'] in e['regions']]
            error=max(abs(i-group_currents[0]) for i in group_currents)
            constraint_errors.append({'regions':e['regions'],'absolute_error_a':error,'constraint':'series-current-equality'})
            if error>1e-7*max(1,abs(group_currents[0])):
                raise SolverFailure('GetDP串联组电流连续性不满足。')
        if e['kind']=='current_rms_a':
            expected=complex(e['value'][0],e['value'][1] if len(e['value'])==2 else 0)
            actual=sum(complex(*r['current_complex_rms_a']) for r in currents if r['entity'] in e['regions'])
            error=abs(actual-expected)
            constraint_errors.append({'regions':e['regions'],'absolute_error_a':error})
            if error>1e-7*max(1,abs(expected)):
                raise SolverFailure('GetDP电流约束/互联KCL不满足。')
    field=np.loadtxt(work/'a.txt',skiprows=1,ndmin=2)
    if field.shape!=(len(mesh['points']),3) or not np.array_equal(np.sort(field[:,0]),np.arange(1,len(mesh['points'])+1)) or not np.isfinite(field).all():
        raise SolverFailure('GetDP输出非有限值。')
    field = field[np.argsort(field[:,0])]
    probes=[]
    for i,point in enumerate(problem['probes_m']):
        raw=np.loadtxt(work/f'probe-{i}.txt',ndmin=2)
        if raw.shape!=(1,14) or not np.isfinite(raw).all():
            raise SolverFailure('GetDP磁场测点输出缺失或格式不匹配。')
        real,imag=raw[0,8:11],raw[0,11:14]
        probes.append({'point_m':point,'b_real_t':real.tolist(),'b_imag_t':imag.tolist(),'b_rms_t':float(np.sqrt(real@real+imag@imag))})
    density=[]
    for p in problem.get('current_probes',[]):
        region=next(r for r in mesh['regions'] if r['uid']==p['region'])
        raw=np.loadtxt(work/f'j-{region["id"]}.txt',skiprows=1,ndmin=2)
        nodes=raw[:,0].astype(int)-1
        distance=np.linalg.norm(np.asarray(mesh['points'])[nodes]-p['point_m'],axis=1)
        nearest=int(np.argmin(distance))
        if distance[nearest]>1e-8 or raw.shape[1]!=3 or not np.isfinite(raw).all():
            raise SolverFailure('电流密度测点必须是指定区域网格节点；不外推跨材料界面。')
        real,imag=raw[nearest,1:]
        density.append({'entity':p['region'],'point_m':p['point_m'],'j_complex_rms_a_m2':[float(real),float(imag)],
                        'j_rms_a_m2':float(np.hypot(real,imag)),'sampling':'material-side nodal limit'})
    # Independent free-space postprocessing of the actual distributed FEM J.
    # This does not replace the GetDP A-u field/circuit solve with line currents.
    # In P1 triangles, J is linear; three-point quadrature integrates its smooth
    # distant-field kernel. Only nonmagnetic models and nonconducting probes apply.
    eligible=not any(e['kind']=='impressed_current_rms_a' for e in problem['excitations']) and mesh.get('field_order',1)==1 and all(abs(r['material']['relative_permeability']-1)<1e-12 and r['material'].get('relative_permeability_loss',0)==0 for r in mesh['regions'])
    if probes and eligible:
        active=[]
        for p in probes:
            x,z=p['point_m'];owner=None
            for s in problem['geometry']:
                v=s['values']
                inside=(x-v[0])**2+(z-v[1])**2<=v[2]**2 if s['kind']=='disk' else v[0]<=x<=v[2] and v[1]<=z<=v[3]
                if inside:owner=s
            active.append(owner is not None and owner['material']['conductivity_s_m']==0)
        totals=np.zeros((len(probes),2),dtype=complex)
        bary=np.array([[2/3,1/6,1/6],[1/6,2/3,1/6],[1/6,1/6,2/3]])
        for region in mesh['regions']:
            if region['material']['conductivity_s_m']<=0:continue
            r=region['id'];raw=np.loadtxt(work/f'j-{r}.txt',skiprows=1,ndmin=2)
            j=np.full(len(mesh['points']),np.nan+1j*np.nan,dtype=complex)
            j[raw[:,0].astype(int)-1]=raw[:,1]+1j*raw[:,2]
            mask=np.asarray(mesh['domain_ids'])==r
            triangles=np.asarray(mesh['triangles'])[mask]
            if not np.isfinite(j[triangles]).all():raise SolverFailure('FEM电流密度节点映射不完整。')
            qpoints=np.einsum('qa,eac->eqc',bary,xy[mask])
            qcurrent=np.einsum('qa,ea->eq',bary,j[triangles])
            weight=areas[mask,None]/3
            for i,p in enumerate(probes):
                if not active[i]:continue
                delta=np.asarray(p['point_m'])-qpoints
                radius2=np.sum(delta**2,axis=2)
                if np.any(radius2<1e-24):raise SolverFailure('分布电流积分测点奇异。')
                scalar=2e-7*qcurrent*weight/radius2
                totals[i,0]+=np.sum(-delta[:,:,1]*scalar)
                totals[i,1]+=np.sum(delta[:,:,0]*scalar)
        for i,p in enumerate(probes):
            if active[i]:
                b=totals[i]
                p.update(b_current_integral_real_t=b.real.tolist(),b_current_integral_imag_t=b.imag.tolist(),
                         b_current_integral_rms_t=float(np.sqrt(np.sum(np.abs(b)**2))),
                         recovery='Free-space Biot-Savart quadrature of GetDP distributed P1 current density, not line-current approximation')
    coupled={}
    if feedback is not None:
        # P1 A and constant regional voltage gradients imply that E is P1.
        # Export E directly: contact-side temperature traces can differ. Heat assembly evaluates sigma(T) at
        # quadrature points, never smears heat across a material interface.
        if mesh.get('field_order',1)!=1:
            raise SolverFailure('coupled mesh.field_order：当前反馈只支持P1。')
        electric={}
        for region in mesh['regions']:
            if region['material']['conductivity_s_m']<=0:continue
            raw=np.loadtxt(work/f'e-{region["id"]}.txt',skiprows=1,ndmin=2)
            nodes=raw[:,0].astype(int)-1
            if raw.shape[1]!=3 or not np.isfinite(raw).all() or np.any(nodes<0) or np.any(nodes>=len(mesh['points'])):
                raise SolverFailure('GetDP区域电场输出格式或节点映射无效。')
            electric[region['uid']]={'nodes':nodes.tolist(),'electric_complex_v_m':raw[:,1:].tolist()}
        coupled={'electric_field_by_region':electric}
    return {'solver':version,'execution':execution,'mesh_sha256':mesh['sha256'],**coupled,
            'impressed_currents':[{'entity':e['regions'][0],'current_complex_rms_a':e['value'],'distribution':'uniform over actual source mesh area; no source-domain eddy currents'} for e in problem['excitations'] if e['kind']=='impressed_current_rms_a'],
            'problem_sha256':digest(problem),'regions':currents,'magnetic_losses':magnetic_losses,'a_complex_wb_m':field[:,1:].tolist(),
            'probes':probes,'current_density_probes':density,'current_constraint_errors':constraint_errors,
            'phasor_convention':'RMS; Joule integral has no factor 1/2',
            'field_order':mesh.get('field_order',1),
            'engineering_approval':False}
