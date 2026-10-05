"""Gmsh/OCC construction of the public COMSOL cable tutorial cross section.

Only the tutorial's dimensional construction is used. No native mesh, field,
triangulation, material mask or heat source is imported into the open geometry.
"""
from math import pi,sqrt,cos,sin,ceil
import numpy as np


def build(size_m=.002, circle_segments=96, *, thermal=True, max_nodes=120000):
    import gmsh
    from cablesim_simulation.report import digest
    from cablesim_simulation.problem_mesh import package
    dcon=.0262;dins=.0776;tscc=.00085;tpbs=tpe=.0029;dpha=dins+2*(tpbs+tpe)
    dpha3=dpha*(2/sqrt(3)+1);dcab=.219;darm=(dcab+dpha3)/2;tarm=.0056;narm=110;mfil=.0005;marm=pi*darm/narm-tarm
    cap=dpha3/2-mfil;armout=darm/2+tarm/2+marm;armin=armout-tarm-2*marm;emradius=5*dcab/2
    phases=[(-dpha/(2*sqrt(3)),dpha/2),(dpha/sqrt(3),0),(-dpha/(2*sqrt(3)),-dpha/2)]
    fiber=(-dpha*.836015,0.);objects=[];categories=[];labels=[]
    gmsh.initialize()
    try:
        gmsh.option.setNumber('General.Terminal',0);gmsh.option.setNumber('General.NumThreads',1)
        gmsh.model.add('submarine-independent');occ=gmsh.model.occ
        def disk(x,y,r):return [(2,occ.addDisk(x,y,0,r,r))]
        def copy(a):return occ.copy(a)
        def cut(a,b):return occ.cut(a,b,removeObject=True,removeTool=True)[0]
        def intersect(a,b):return occ.intersect(a,b,removeObject=True,removeTool=True)[0]
        def union(a):return occ.fuse(a[:1],a[1:],removeObject=True,removeTool=True)[0] if len(a)>1 else a
        def ring(x,y,inner,outer):return cut(disk(x,y,outer),disk(x,y,inner))
        def add(parts,mat,label):
            for part in parts:objects.append(part);categories.append(mat);labels.append(label)
        if thermal:
            add(cut([(2,occ.addRectangle(-5,-4,0,10,5))],disk(0,0,emradius)),3,'gravel/exterior')
            add([(2,occ.addRectangle(-5,1,0,10,3))],2,'water')
        add(ring(0,0,dcab/2,emradius),3,'gravel/magnetic')
        add(ring(0,0,armout,dcab/2),4,'pe/outer')
        add(ring(0,0,cap,armin),4,'pe/inner')
        phase_envelope=intersect(union([part for x,y in phases for part in disk(x,y,dpha/2+mfil)]),disk(0,0,cap))
        pe=copy(phase_envelope)
        for i,(x,y) in enumerate(phases):
            pe=cut(pe,disk(x,y,dins/2+tpbs))
            for inner,outer,mat,layer in [(0,dcon/2,11,'conductor'),(dcon/2,dcon/2+tscc,7,'scc-inner'),
                                        (dcon/2+tscc,dins/2-tscc,6,'xlpe'),(dins/2-tscc,dins/2,7,'scc-outer'),
                                        (dins/2,dins/2+tpbs,12,'screen')]:
                add(ring(x,y,inner,outer) if inner else disk(x,y,outer),mat,'phase/'+str(i+1)+'/'+layer)
        add(pe,4,'pe/phases')
        bulbs=[]
        for angle in (0,2*pi/3,4*pi/3):
            for x,y,r in [(-dpha*.836015,0,dpha*.241335+mfil),(-dpha*.890205,-dpha*.355815,dpha*.118595+mfil),(-dpha*.890205,dpha*.355815,dpha*.118595+mfil)]:
                bulbs+=disk(x*cos(angle)-y*sin(angle),x*sin(angle)+y*cos(angle),r)
        bulbs+=disk(0,0,dpha*(1/sqrt(3)-.5)+mfil)
        polypropylene=cut(intersect(union(bulbs),disk(0,0,cap)),copy(phase_envelope))
        polypropylene=cut(polypropylene,disk(*fiber,.00175))
        pp_fiber=intersect(copy(polypropylene),disk(*fiber,.0046))
        pp_bulk=cut(polypropylene,disk(*fiber,.0046))
        pp_all=copy(pp_bulk+pp_fiber)
        add(pp_bulk,5,'pp/filler');add(pp_fiber,5,'pp/fiber')
        steel=ring(*fiber,.00125,.00175)
        # The native layered circle has four quadrants; preserve the same
        # topology although no contact resistance exists between steel quarters.
        for sx,sy in [(-1,-1),(-1,1),(1,-1),(1,1)]:
            x0=fiber[0]-.002 if sx<0 else fiber[0];y0=-.002 if sy<0 else 0.
            add(intersect(copy(steel),[(2,occ.addRectangle(x0,y0,0,.002,.002))]),10,'fiber/steel')
        occ.remove(steel,recursive=True)
        add(disk(*fiber,.00125),9,'fiber/glass')
        air=cut(disk(0,0,cap),phase_envelope+pp_all+disk(*fiber,.00175))
        add(air,1,'air-pocket')
        armor=[]
        for i in range(narm):
            angle=2*pi*i/narm
            piece=disk(darm/2*cos(angle),darm/2*sin(angle),tarm/2)
            armor+=copy(piece);add(piece,13,'armor/'+str(i+1))
        add(cut(ring(0,0,armin,armout),armor),8,'bitumen')
        _,mapping=occ.fragment(objects[:1],objects[1:]);occ.synchronize()
        assignment={}
        for mat,label,parts in zip(categories,labels,mapping):
            for dim,tag in parts:
                if dim!=2:continue
                if tag in assignment:raise ValueError('Overlapping material solids in independent construction')
                assignment[tag]=(mat,label)
        live={tag for dim,tag in gmsh.model.getEntities(2)}
        if live!=set(assignment):raise ValueError('Unassigned independent geometry surface')
        # Stable domain identity uses physical class, original construction label
        # and geometric centroid, never a native COMSOL entity number.
        order=sorted(assignment,key=lambda tag:(assignment[tag],occ.getCenterOfMass(2,tag)))
        info=[];domain={}
        for i,tag in enumerate(order,1):
            mat,label=assignment[tag];domain[tag]=i
            info.append({'id':i,'uid':label if labels.count(label)==1 else label+'/'+str(i),'material_index':mat,
                         'construction_label':label,'area_m2':occ.getMass(2,tag),'center_m':list(occ.getCenterOfMass(2,tag)[:2])})
        counts={m:sum(r['material_index']==m for r in info) for m in set(categories)}
        expected={1:24,2:int(thermal),3:1+int(thermal),4:3,5:5,6:3,7:6,8:1,9:1,10:4,11:3,12:3,13:110}
        if any(counts.get(m,0)!=n for m,n in expected.items()):raise ValueError('Independent domain topology differs: '+str(counts))
        gmsh.option.setNumber('Mesh.MeshSizeFromPoints',0);gmsh.option.setNumber('Mesh.MeshSizeFromCurvature',0);gmsh.option.setNumber('Mesh.MeshSizeExtendFromBoundary',0)
        gmsh.option.setNumber('Mesh.ElementOrder',1)
        field=gmsh.model.mesh.field.add('MathEval')
        gmsh.model.mesh.field.setString(field,'F',f'Max({size_m},Min(0.5,0.22*Max(0,Sqrt(x*x+y*y)-0.115)))')
        gmsh.model.mesh.field.setAsBackgroundMesh(field)
        for dim,curve in gmsh.model.getEntities(1):
            if gmsh.model.getType(1,curve) in ('Circle','Ellipse'):
                bbox=gmsh.model.getBoundingBox(1,curve);radius=max(bbox[3]-bbox[0],bbox[4]-bbox[1])/2
                perimeter=occ.getMass(1,curve)
                # Arc length fraction, so a quarter circle does not acquire four
                # times as many segments as its unpartitioned counterpart.
                h=min(size_m,2*pi*max(radius,1e-9)/circle_segments) if radius<.12 else max(size_m,.02)
                gmsh.model.mesh.setTransfiniteCurve(curve,max(2,ceil(perimeter/h)+1))
        gmsh.model.mesh.generate(2)
        tags,coords,_=gmsh.model.mesh.getNodes();lookup={int(v):i for i,v in enumerate(tags)};cells=[];ids=[]
        for tag in order:
            types,_,nodes=gmsh.model.mesh.getElements(2,tag)
            for kind,conn in zip(types,nodes):
                if kind!=2:raise ValueError('Expected P1 triangle mesh')
                part=[[lookup[int(v)] for v in row] for row in conn.reshape(-1,3)];cells+=part;ids.extend([domain[tag]]*len(part))
        p=np.asarray(coords).reshape(-1,3)[:,:2];t=np.asarray(cells,int);used=np.unique(t)
        if len(used)>max_nodes:raise ValueError(f'Independent mesh {len(used)} nodes exceeds {max_nodes}')
        remap=np.full(len(p),-1,int);remap[used]=np.arange(len(used));p=p[used];t=remap[t]
        mesh=package(p,t,ids,info,[{'selector':'outer','values':[]}])
        adjacency={}
        for idx,tri in enumerate(mesh['triangles']):
            for a,b in [(tri[0],tri[1]),(tri[1],tri[2]),(tri[2],tri[0])]:adjacency.setdefault(tuple(sorted((a,b))),[]).append(idx)
        mats={r['id']:r['material_index'] for r in info};contacts=[]
        for edge,parents in adjacency.items():
            if len(parents)==2 and ids[parents[0]]!=ids[parents[1]] and any(mats[ids[j]] in (1,4,5,8,9) for j in parents):contacts.append(list(edge))
        mesh.update(contact_edges=contacts,geometry_source='COMSOL 6.2 submarine tutorial01 dimensional construction, independently rebuilt by Gmsh OCC',
                    material_domain_counts=counts,mesher={'name':'gmsh','version':gmsh.__version__},size_m=size_m,circle_segments=circle_segments,
                    electromagnetic_radius_m=emradius)
        mesh.pop('sha256');mesh['sha256']=digest(mesh)
        return mesh
    finally:gmsh.finalize()


if __name__=='__main__':
    import json,sys
    from pathlib import Path
    root=Path(__file__).resolve().parents[3];sys.path[:0]=[str(root),str(root/'plugins/cablesim.simulation/src')]
    mesh=build();output=root/'.data/simulation/submarine-coupled';output.mkdir(parents=True,exist_ok=True)
    (output/'open-mesh.json').write_text(json.dumps(mesh,separators=(',',':'),allow_nan=False),'utf-8')
    print(json.dumps({'nodes':len(mesh['points']),'elements':len(mesh['triangles']),'domains':mesh['material_domain_counts'],'contacts':len(mesh['contact_edges'])}),flush=True)
