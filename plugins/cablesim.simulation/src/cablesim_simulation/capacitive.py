"""Axisymmetric frequency-current P1 FEM with explicit dielectric displacement current."""
from math import pi
import numpy as np
from cablesim_sdk.capacitive import CapacitiveCable,CapacitiveMesh
from .report import digest

EPS0=8.8541878128e-12


def prepare(value,parameters):
    if set(parameters)!={'mesh'}:raise ValueError('parameters：频域电流场仅接受mesh。')
    return CapacitiveCable.model_validate(value),CapacitiveMesh.model_validate(parameters['mesh'])


def build(model,controls):
    radii=[model.inner_radius_m]+[l.outer_radius_m for l in model.layers]
    fractions=model.section_fractions or [1.]
    radial=controls.radial_elements_per_layer;axial=controls.axial_elements_per_section
    estimate=(len(model.layers)*radial+1)*(len(fractions)*axial+1)+(len(fractions)-1)*(len(model.layers)-1)*radial
    if estimate>controls.max_nodes:
        raise ValueError(f'mesh.max_nodes：结构网格需要{estimate}节点，超过{controls.max_nodes}上限；请明确减少网格密度。')
    ends=np.cumsum([0.]+fractions)*model.length_m/model.axial_coordinate_scale
    # Coincident insulating cut nodes are distinct across sections, except on
    # the continuous sheath. This is a zero-normal-current interface, not a
    # silently shorted union of the three independent phase electrodes.
    points=[];lookup={};triangles=[];ids=[];sections=[];electrodes=[set() for _ in fractions];grounds=set()
    sheath_inner=radii[-2]
    for section,(z0,z1) in enumerate(zip(ends,ends[1:])):
        zs=np.linspace(z0,z1,controls.axial_elements_per_section+1)
        for layer,(r0,r1) in enumerate(zip(radii,radii[1:])):
            rs=np.linspace(r0,r1,controls.radial_elements_per_layer+1)
            grid=np.zeros((len(rs),len(zs)),dtype=int)
            for i,r in enumerate(rs):
                for j,z in enumerate(zs):
                    seam=(j==0 and section>0) or (j==len(zs)-1 and section<len(fractions)-1)
                    owner=section if seam and r<sheath_inner-1e-14 else -1
                    key=(float(r),float(z),owner)
                    if key not in lookup:lookup[key]=len(points);points.append([float(r),float(z)])
                    n=lookup[key];grid[i,j]=n
                    if layer==0 and i==0:electrodes[section].add(n)
                    if layer==len(model.layers)-1:
                        ground=(model.bonding=='radial_ground' and i==len(rs)-1) or (model.bonding!='radial_ground' and section==0 and j==0) or (model.bonding in ('both_ends','cross_bonded') and section==len(fractions)-1 and j==len(zs)-1)
                        if ground:grounds.add(n)
            for i in range(len(rs)-1):
                for j in range(len(zs)-1):
                    a,b,c,d=map(int,(grid[i,j],grid[i+1,j],grid[i+1,j+1],grid[i,j+1]))
                    triangles.extend([[a,b,c],[a,c,d]]);ids.extend([layer+1]*2);sections.extend([section]*2)
    if len(points)>controls.max_nodes:raise ValueError('mesh.max_nodes：结构网格超过节点上限。')
    mesh=dict(schema='cablesim.capacitive-mesh/1',points=points,triangles=triangles,domain_ids=ids,section_ids=sections,
              coordinates='r-z; axial coordinate scaled',axial_coordinate_scale=model.axial_coordinate_scale,
              regions=[dict(id=i+1,uid=l.uid,material=l.model_dump(mode='json')) for i,l in enumerate(model.layers)],
              electrode_nodes=[sorted(v) for v in electrodes],ground_nodes=sorted(grounds))
    mesh['sha256']=digest(mesh)
    return mesh


def solve(model,controls):
    from skfem import MeshTri,Basis,ElementTriP1,BilinearForm,LinearForm,asm,condense,solve as fem_solve
    from scipy.sparse import diags
    from scipy.sparse.linalg import splu
    mesh=build(model,controls);p=np.asarray(mesh['points']);tri=np.asarray(mesh['triangles']);ids=np.asarray(mesh['domain_ids'])
    basis=Basis(MeshTri(p.T,tri.T),ElementTriP1(),intorder=5)
    sr=np.zeros((len(tri),1));sz=sr.copy();eps=sr.copy()
    for i,l in enumerate(model.layers,1):
        mask=ids==i;sr[mask]=l.conductivity_radial_s_m;sz[mask]=l.conductivity_axial_s_m;eps[mask]=EPS0*l.relative_permittivity
    omega=2*pi*model.frequency_hz;scale=model.axial_coordinate_scale
    @BilinearForm(dtype=complex)
    def form(u,v,w):
        return 2*pi*w.x[0]*((w.sr+1j*omega*w.eps)*scale*u.grad[0]*v.grad[0]+(w.sz+1j*omega*w.eps)/scale*u.grad[1]*v.grad[1])
    matrix=asm(form,basis,sr=sr,sz=sz,eps=eps)
    fixed=np.zeros(basis.N,dtype=complex);fixed_nodes=set(mesh['ground_nodes'])
    for nodes,phase in zip(mesh['electrode_nodes'],model.section_phase_rad or [0.]):
        fixed[nodes]=(model.voltage_peak_v-model.axial_voltage_drop_peak_v_m*p[nodes,1]*scale)*np.exp(1j*phase)
        fixed_nodes.update(nodes)
    D=np.array(sorted(fixed_nodes));free=np.setdiff1d(np.arange(basis.N),D)
    # Symmetric diagonal scaling preserves the weak equation and makes the
    # physical semiconductor/XLPE/sheath contrast tractable in double precision.
    norm=1/np.sqrt(np.abs(matrix.diagonal()))
    if not np.isfinite(norm).all():raise ValueError('materials：频域刚度矩阵无有效对角。')
    scaled=diags(norm)@matrix@diags(norm)
    potential=norm*fem_solve(*condense(scaled,np.zeros(basis.N,dtype=complex),x=fixed/norm,D=D))
    if not np.isfinite(potential).all():raise ValueError('voltage：频域求解产生非有限结果。')
    def gradient(values):
        nodal=values[basis.element_dofs]
        differences=nodal-nodal[0]
        return sum(basis.basis[j][0].grad*differences[j][None,:,None] for j in range(3))
    @LinearForm(dtype=complex)
    def weak(v,w):
        return 2*pi*w.x[0]*((w.sr+1j*omega*w.eps)*scale*w.g[0]*v.grad[0]+(w.sz+1j*omega*w.eps)/scale*w.g[1]*v.grad[1])
    # Cancellation-safe iterative refinement: assemble fluxes from local voltage
    # differences, so a 127 kV common potential cannot pollute a tiny leakage.
    factor=splu(scaled[free][:,free].tocsc())
    for refinement in range(8):
        residual=asm(weak,basis,sr=sr,sz=sz,eps=eps,g=gradient(potential))
        correction=norm[free]*factor.solve(-norm[free]*residual[free])
        potential[free]+=correction
        if np.max(np.abs(correction))<1e-10:break
    gradients=gradient(potential)
    residual=asm(weak,basis,sr=sr,sz=sz,eps=eps,g=gradients)
    # Report KCL on electrodes and true complex weak residual (A peak).
    phase_currents=[complex(np.sum(residual[nodes])) for nodes in mesh['electrode_nodes']]
    ground_current=complex(np.sum(residual[mesh['ground_nodes']]))
    current_scale=max(sum(abs(x) for x in phase_currents),1e-20)
    kcl=abs(sum(phase_currents)+ground_current)/current_scale
    relative_residual=float(np.max(np.abs(residual[free])))/current_scale
    if kcl>2e-5 or relative_residual>2e-5:raise ValueError(f'current_conservation：KCL/残差不满足 ({kcl:.3g}/{relative_residual:.3g})。')
    Er=-gradients[0];Ez=-gradients[1]/scale
    volume=2*pi*basis.global_coordinates()[0]*scale*basis.dx
    loss=.5*(sr*np.abs(Er)**2+sz*np.abs(Ez)**2)
    totals=[]
    for i,l in enumerate(model.layers,1):
        mask=ids==i
        totals.append(dict(entity=l.uid,joule_loss_w=float(np.sum(loss[mask]*volume[mask]))))
    sheath_nodes=np.unique(tri[ids==len(model.layers)])
    # Average axial current across every physical slab, integrating Jz over
    # the exact annular area; samples are slab means, not invented extrema.
    sheath_currents=[]
    centers=p[tri].mean(axis=1)
    for section in range(len(model.section_fractions or [1.])):
        selected=np.flatnonzero((ids==len(model.layers))&(np.asarray(mesh['section_ids'])==section))
        zvalues=sorted(set(p[tri[selected],1].ravel()))
        for z0,z1 in zip(zvalues,zvalues[1:]):
            mask=(ids==len(model.layers))&(centers[:,1]>z0)&(centers[:,1]<z1)
            current=np.sum((sz+1j*omega*eps)[mask]*Ez[mask]*volume[mask])/((z1-z0)*scale)
            sheath_currents.append(dict(z_m=float((z0+z1)*scale/2),current_peak_a=[float(current.real),float(current.imag)]))
    c_per_m=float(phase_currents[0].imag/model.voltage_peak_v/omega/model.length_m) if model.bonding=='radial_ground' else None
    return mesh,dict(solver={'name':'scikit-fem','equation':'div((sigma+j*omega*epsilon) grad(V))=0; axisymmetric P1'},
                     voltage_complex_peak_v=np.column_stack([potential.real,potential.imag]).tolist(),
                     phase_currents_peak_a=[[x.real,x.imag] for x in phase_currents],ground_current_peak_a=[ground_current.real,ground_current.imag],
                     capacitance_f_m=c_per_m,regions=totals,total_joule_loss_w=sum(x['joule_loss_w'] for x in totals),
                     sheath_maximum_nodal_voltage_peak_v=float(np.max(np.abs(potential[sheath_nodes]))),
                     sheath_slab_current_peak_a=sheath_currents,current_kcl_relative_error=float(kcl),
                     weak_residual_relative_error=relative_residual,phasor_convention='peak; cycle-average Joule power includes 1/2',
                     engineering_approval=False)


def host_case(request,case,job):
    from .artifacts import write
    model,controls=prepare(case['input'],case.get('parameters',{}))
    evidence={'input_sha256':digest(case['input'])}
    if request['phase']=='check':
        mesh=build(model,controls)
        return dict(case_id=case['case_id'],status='succeeded',results=[],artifacts=[],evidence={**evidence,'mesh_sha256':mesh['sha256']})
    mesh,result=solve(model,controls)
    evidence['mesh_sha256']=mesh['sha256']
    bundle=dict(schema='cablesim.simulation-bundle/2',input=model.model_dump(mode='json'),mesh=mesh,result=result,evidence=evidence,engineering_approval=False)
    artifact=write(job,case['case_id'],'bundle','x-cablesim.simulation-bundle',bundle)
    return dict(case_id=case['case_id'],status='succeeded',evidence=evidence,artifacts=[artifact],
                results=[dict(key='x-cablesim.dielectric-screen-loss',type='quantity',entity=model.sheath_layer,
                              value=next(r['joule_loss_w'] for r in result['regions'] if r['entity']==model.sheath_layer),unit='W',status='available')])
