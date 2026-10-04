"""Independent P1 field assembly on a traceable, conforming triangular mesh.

No geometry inference and no inferred material data. Contact interfaces carry
two temperature traces; electrical interfaces retain continuous potential.
"""
import numpy as np
from scipy.sparse import coo_matrix, diags
from scipy.sparse.linalg import splu


def geometry(points, triangles):
    p=np.asarray(points,dtype=float);t=np.asarray(triangles,dtype=int)
    if p.ndim!=2 or p.shape[1]!=2 or not np.isfinite(p).all():raise ValueError('mesh.points: finite SI xy coordinates required')
    if t.ndim!=2 or t.shape[1]!=3 or t.min()<0 or t.max()>=len(p):raise ValueError('mesh.triangles: valid three-node indices required')
    q=p[t];det=(q[:,1,0]-q[:,0,0])*(q[:,2,1]-q[:,0,1])-(q[:,2,0]-q[:,0,0])*(q[:,1,1]-q[:,0,1])
    if np.any(abs(det)<1e-25):raise ValueError('mesh.triangles: degenerate triangle')
    grad=np.stack([np.stack([q[:,1,1]-q[:,2,1],q[:,2,0]-q[:,1,0]],axis=1),np.stack([q[:,2,1]-q[:,0,1],q[:,0,0]-q[:,2,0]],axis=1),np.stack([q[:,0,1]-q[:,1,1],q[:,1,0]-q[:,0,0]],axis=1)],axis=1)/det[:,None,None]
    return p,t,abs(det)/2,grad


def stiffness(triangles,area,grad,coefficient,n):
    c=np.asarray(coefficient)
    if c.shape!=(len(triangles),) or not np.isfinite(c).all() or np.any(c.real<0):raise ValueError('material: finite nonnegative coefficient per triangle required')
    local=area[:,None,None]*c[:,None,None]*np.einsum('eik,ejk->eij',grad,grad)
    return coo_matrix((local.ravel(),(np.repeat(triangles,3,axis=1).ravel(),np.tile(triangles,(1,3)).ravel())),shape=(n,n)).tocsr()


def solve_dirichlet(matrix,rhs,fixed,values):
    fixed=np.asarray(fixed,dtype=int);values=np.asarray(values)
    if len(fixed)!=len(np.unique(fixed)):raise ValueError('boundary: duplicate constrained nodes')
    free=np.setdiff1d(np.arange(matrix.shape[0]),fixed)
    out=np.zeros((matrix.shape[0],)+rhs.shape[1:],dtype=np.result_type(matrix.dtype,rhs.dtype,values.dtype));out[fixed]=values
    if not len(free):return out,matrix@out-rhs,0.
    reduced=matrix[free][:,free].tocsc();b=rhs[free]-matrix[free][:,fixed]@values
    scale=1/np.sqrt(abs(reduced.diagonal()))
    if not np.isfinite(scale).all():raise ValueError('boundary: unconstrained or isolated field node')
    scaled=diags(scale)@reduced@diags(scale)
    out[free]=scale[:,None]*splu(scaled.tocsc()).solve(scale[:,None]*b) if b.ndim==2 else scale*splu(scaled.tocsc()).solve(scale*b)
    residual=matrix@out-rhs
    denominator=max(float(np.linalg.norm(matrix@out,np.inf)),float(np.linalg.norm(rhs,np.inf)),1e-30)
    relative=float(np.linalg.norm(residual[free],np.inf))/denominator
    if not np.isfinite(out).all() or relative>1e-6:raise ValueError('field: linear solve residual exceeds 1e-6')
    return out,residual,relative


def terminal_admittance(points,triangles,admittivity,electrode_nodes,ground_nodes):
    """Each unit-voltage basis solve yields one column of the full Y matrix."""
    p,t,area,grad=geometry(points,triangles);n=len(p);count=len(electrode_nodes)
    K=stiffness(t,area,grad,admittivity,n)
    groups=[np.unique(np.asarray(g,dtype=int)) for g in electrode_nodes]
    fixed=np.concatenate([np.unique(ground_nodes),*groups]);V=np.zeros((len(fixed),count),dtype=complex);start=len(np.unique(ground_nodes))
    for j,g in enumerate(groups):V[start:start+len(g),j]=1;start+=len(g)
    if any(len(g)==0 for g in groups):raise ValueError('electrodes: empty electrode')
    potential,reaction,residual=solve_dirichlet(K,np.zeros((n,count),complex),fixed,V)
    # Energy bilinear form avoids subtracting almost equal large conductive
    # reactions when tiny dielectric currents meet highly conducting SCC.
    gradients=np.einsum('eik,eij->ekj',grad,potential[t])
    Y=np.einsum('e,eki,ekj->ij',area*np.asarray(admittivity),gradients,gradients)
    reciprocity=float(np.max(abs(Y-Y.T))/max(np.max(abs(Y)),1e-30))
    if reciprocity>1e-6:raise ValueError('admittance: reciprocity failed')
    if np.min(np.linalg.eigvalsh((Y.real+Y.real.T)/2)) < -1e-9*max(np.max(abs(Y)),1e-30):raise ValueError('admittance: negative dissipation')
    return {'admittance':Y,'potential':potential,'residual':residual,'reciprocity':reciprocity}


def floating_admittance(matrix,floating):
    """Zero net current on floating terminals, exact complex Schur elimination."""
    Y=np.asarray(matrix,dtype=complex);f=np.asarray(floating,dtype=int)
    if Y.ndim!=2 or Y.shape[0]!=Y.shape[1] or not np.isfinite(Y).all():raise ValueError('admittance: finite square complex matrix required')
    if len(set(f.tolist()))!=len(f) or len(f)>=len(Y) or np.any(f<0) or np.any(f>=len(Y)):raise ValueError('floating_terminals: invalid indices or no driven terminal remains')
    active=np.setdiff1d(np.arange(len(Y)),f)
    if not len(f):return active,Y.copy()
    try:response=np.linalg.solve(Y[np.ix_(f,f)],Y[np.ix_(f,active)])
    except np.linalg.LinAlgError as exc:raise ValueError('floating_terminals: singular floating subsystem, no unique potential') from exc
    result=Y[np.ix_(active,active)]-Y[np.ix_(active,f)]@response
    if not np.isfinite(result).all():raise ValueError('floating_terminals: nonfinite reduced admittance')
    return active,result


def split_contacts(triangles,domain_ids,contact_edges):
    """Split only across declared internal edges, preserving every other join."""
    t=np.asarray(triangles,dtype=int);ids=np.asarray(domain_ids,dtype=int)
    lookup={};original=[];local=np.empty_like(t)
    for e,tri in enumerate(t):
        for j,node in enumerate(tri):
            key=(int(ids[e]),int(node))
            if key not in lookup:lookup[key]=len(original);original.append(int(node))
            local[e,j]=lookup[key]
    parent=np.arange(len(original))
    def root(a):
        while parent[a]!=a:parent[a]=parent[parent[a]];a=parent[a]
        return a
    edges={}
    for e,tri in enumerate(t):
        for i,j in ((0,1),(1,2),(2,0)):edges.setdefault(tuple(sorted((int(tri[i]),int(tri[j])))),[]).append(e)
    contact={tuple(sorted(map(int,e))) for e in contact_edges};pairs=[]
    for edge,owners in edges.items():
        if len(owners)>2:raise ValueError('mesh: nonmanifold edge')
        if edge in contact:
            if len(owners)!=2:raise ValueError('contact: must join two domains')
            a,b=owners
            if ids[a]==ids[b]:raise ValueError('contact: identical adjacent domain')
            pairs.append(([lookup[(int(ids[a]),v)] for v in edge],[lookup[(int(ids[b]),v)] for v in edge],edge,(int(ids[a]),int(ids[b]))))
        elif len(owners)==2:
            a,b=owners
            for v in edge:parent[root(lookup[(int(ids[a]),v)])]=root(lookup[(int(ids[b]),v)])
    if len(pairs)!=len(contact):raise ValueError('contact: declared edge not in mesh')
    roots=np.array([root(i) for i in range(len(original))]);unique,mapping=np.unique(roots,return_inverse=True)
    return mapping[local],np.asarray(original)[unique],[(mapping[a],mapping[b],edge,domains) for a,b,edge,domains in pairs]


def contact_thermal(points,triangles,domain_ids,conductivity,heat_w_m3,contact_edges,contact_conductance,temperature_nodes,ambient_k,*,max_iterations=100,tolerance_k=1e-7,element_load_w_m=None):
    """Steady heat flow with prescribed volumetric source and zero-thickness R.

    conductivity(domain_ids, element_mean_temperature) returns SI W/(m K).
    contact_conductance is a positive SI W/(m2 K) constant per interface edge.
    Nonlinear conductivity is iterated; imported heat is never called coupled.
    """
    p,t,area,grad=geometry(points,triangles);ids=np.asarray(domain_ids);q=np.asarray(heat_w_m3,float)
    if q.shape!=area.shape or not np.isfinite(q).all() or np.any(q<0):raise ValueError('heat_w_m3: finite nonnegative source required per element')
    if not np.isfinite(ambient_k) or ambient_k<=0:raise ValueError('ambient_k: positive absolute temperature required')
    if np.intersect1d(temperature_nodes,np.asarray(contact_edges).ravel()).size:raise ValueError('temperature_nodes: contact-side temperature boundary is unsupported; use an exterior boundary')
    local,original,pairs=split_contacts(t,ids,contact_edges);n=len(original)
    h=np.broadcast_to(np.asarray(contact_conductance,float),(len(pairs),))
    if not np.isfinite(h).all() or np.any(h<=0):raise ValueError('contact_conductance: finite positive SI conductance required')
    ri=[];ci=[];va=[]
    for (a,b,edge,domains),value in zip(pairs,h):
        mass=value*np.linalg.norm(p[edge[0]]-p[edge[1]])/6*np.array([[2.,1.],[1.,2.]])
        for rows,cols,sign in ((a,a,1),(b,b,1),(a,b,-1),(b,a,-1)):
            for i in range(2):
                for j in range(2):ri.append(rows[i]);ci.append(cols[j]);va.append(sign*mass[i,j])
    H=coo_matrix((va,(ri,ci)),shape=(n,n)).tocsr()
    fixed=np.flatnonzero(np.isin(original,temperature_nodes))
    if not len(fixed):raise ValueError('temperature boundary: empty')
    load=np.repeat((q*area/3)[:,None],3,axis=1) if element_load_w_m is None else np.asarray(element_load_w_m,float)
    if load.shape!=t.shape or not np.isfinite(load).all() or np.any(load<0) or not np.allclose(load.sum(axis=1),q*area,rtol=1e-9,atol=1e-20):raise ValueError('element_load_w_m: conservative nonnegative P1 source weights required')
    rhs=np.bincount(local.ravel(),weights=load.ravel(),minlength=n)
    T=np.full(n,float(ambient_k));history=[]
    for iteration in range(max_iterations):
        k=np.asarray(conductivity(ids,T[local].mean(axis=1)),float)
        if not np.isfinite(k).all() or np.any(k<=0):raise ValueError('thermal_conductivity: positive finite SI values required')
        K=stiffness(local,area,grad,k,n)+H
        # Solve temperature rise. A uniform ambient is exactly in the nullspace
        # of conduction/contact operators; subtracting it analytically avoids
        # roundoff-only residuals being divided by zero physical heat input.
        rise,reaction,residual=solve_dirichlet(K,rhs,fixed,np.zeros(len(fixed)))
        trial=ambient_k+rise
        change=float(np.max(abs(trial-T)));history.append(change);T=trial
        if change<tolerance_k:break
    else:raise ValueError('thermal conductivity iteration did not converge')
    generated=float(q@area);extracted=float(-reaction[fixed].sum())
    balance=abs(generated-extracted)/max(generated,1e-20)
    if balance>1e-6:raise ValueError('thermal energy balance failed')
    contacts=[]
    for (a,b,edge,domains),value in zip(pairs,h):
        jump=float(np.mean(T[a]-T[b]));length=float(np.linalg.norm(p[edge[0]]-p[edge[1]]))
        contacts.append({'original_edge':list(edge),'domain_a':domains[0],'domain_b':domains[1],'trace_a_nodes':a.tolist(),'trace_b_nodes':b.tolist(),'conductance_w_m2k':float(value),'mean_temperature_jump_k':jump,'maximum_temperature_jump_k':float(np.max(abs(T[a]-T[b]))),'heat_a_to_b_w_m':value*length*jump})
    return {'temperature_k':T,'triangle_temperature_k':T[local],'triangles':local,'original_nodes':original,'contacts':contacts,'maximum_k':float(T.max()),'maximum_contact_jump_k':max((c['maximum_temperature_jump_k'] for c in contacts),default=0),'heat_w_m':generated,'boundary_heat_w_m':extracted,'relative_energy_error':balance,'iterations':len(history),'iteration_changes_k':history,'linear_residual':residual,'thermal_nodes':n}
