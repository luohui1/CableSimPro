"""Two half-space line-source Green matrix with a finite horizontal top layer.

The image-reflection approach is described by Slaninka & Morgan, IEE Proc. A
139(3), 117-124 (1992), DOI 10.1049/ip-a-3.1992.0021, and Morgan & Slaninka,
EPSR 29, 35-42 (1994), DOI 10.1016/0378-7796(94)90046-9. The series below
is our Fourier/interface derivation; it is not an extracted standard formula.
Surface T is fixed, T and k*dT/dz are continuous at z=-H. All cable centres
must have one depth in one layer, and the cable must not cut the interface.
"""
from copy import deepcopy
from math import acosh, log, pi, hypot,exp,expm1,cos

from cablesim_iec60287.domain import prepare


def correction(distance, depth, interface, top_rho, lower_rho):
    k1,k2 = 1/top_rho,1/lower_rho
    reflect = (k1-k2)/(k1+k2)
    if abs(reflect) >= .95:
        raise ValueError('materials.thermal_resistivity：分层反射级数只覆盖反射系数绝对值小于0.95。')
    total = 0.
    conductivity = k1 if depth < interface else k2
    for n in range(1024):
        if depth < interface:
            center = (n+1)*interface
            term = log((4*center**2+distance**2)**2/
                       ((4*(center-depth)**2+distance**2)*(4*(center+depth)**2+distance**2)))
            coefficient = reflect/(4*pi*conductivity)
        else:
            term = log((4*(depth+(n+1)*interface)**2+distance**2)/
                       (4*(depth+(n-1)*interface)**2+distance**2))
            coefficient = -reflect/(4*pi*conductivity)
        addition = coefficient*(-reflect)**n*term
        total += addition
        # |cos(q*x)| <= 1 bounds every remaining Fourier term by its x=0
        # value. A term at this distance may vanish without its tail vanishing.
        center = (n+2)*interface
        bound = (2*log(center**2/(center**2-depth**2)) if depth < interface
                 else 2*log((depth+center)/(depth+n*interface)))
        tail = abs(coefficient)*abs(reflect)**(n+1)*bound/(1-abs(reflect))
        if tail <= 1e-11:
            return total,tail,n+1
    raise ValueError('soil_layers：反射级数未收敛，未给近似热阻。')


def prepare_layered(document, parameters):
    section = document['sections'][0]
    layers = sorted(section['soil_layers'],key=lambda x:x['top_z'],reverse=True)
    if len(layers)!=2 or layers[0]['top_z']!=0 or abs(layers[0]['bottom_z']-layers[1]['top_z'])>1e-9:
        raise ValueError('soil_layers：基线仅支持连续的两水平土层，上层从地表开始。')
    if section.get('backfill') or section.get('enclosures'):
        raise ValueError('soil_layers：分层基线未覆盖叠加回填或管道。')
    interface = -layers[0]['bottom_z']
    uniform = deepcopy(document);uniform['sections'][0]['soil_layers']=[]
    group = prepare(uniform, parameters)
    depth = -group.cables[0]['point'][1]
    radii = [c['geometry'].overall_m/2 for c in group.cables]
    if any(abs(c['point'][1]+depth)>1e-9 for c in group.cables):
        raise ValueError('placements.z：分层基线只覆盖同埋深电缆。')
    if any(abs(depth-interface)<=radius for radius in radii):
        raise ValueError('soil_layers：电缆跨越土层界面，线源基线不适用；仅保留FEM核验。')
    materials = {m['id']:m for m in document['materials']}
    top,lower = [materials[x['material']]['thermal_resistivity'] for x in layers]
    rho = top if depth < interface else lower
    matrix=[];bound=0.;terms=0
    for i,c in enumerate(group.cables):
        row=[]
        for j,other in enumerate(group.cables):
            x=abs(c['point'][0]-other['point'][0])
            homogeneous = rho/(2*pi)*(acosh(depth/radii[i]) if i==j else log(hypot(x,2*depth)/x))
            delta,error,count = correction(x,depth,interface,top,lower)
            row.append(homogeneous+delta);bound=max(bound,error);terms=max(terms,count)
        matrix.append(row)
    group.document=document;group.matrix=matrix
    group.soil={'base_matrix_k_m_w':matrix,'common_correction_k_m_w':0.,
        'source':'Two-layer Fourier/interface line-source series; Slaninka & Morgan 1992 image-reflection approach',
        'reference_basis':'layered_research','interface_depth_m':interface,
        'top_rho_k_m_w':top,'lower_rho_k_m_w':lower,'series_tail_bound_k_m_w':bound,'series_terms':terms,
        'scope':'IEC internal/electrical model + independently derived two-layer external Green matrix; reference_only'}
    return group


def independent_matrix(group):
    """Reconstruct the interface Green correction by direct Fourier integration.

    This does not read the image-series matrix or its coefficients. It uses
    the saved layer/material facts and checks the integral error separately.
    """
    from scipy.integrate import quad
    section=group.document['sections'][0]
    layers=sorted(section['soil_layers'],key=lambda x:x['top_z'],reverse=True)
    materials={m['id']:m for m in group.document['materials']}
    rho1,rho2=[materials[layer['material']]['thermal_resistivity'] for layer in layers]
    k1,k2=1/rho1,1/rho2;H=-layers[0]['bottom_z'];d=-group.cables[0]['point'][1]
    r=(k1-k2)/(k1+k2);rho=rho1 if d<H else rho2
    matrix=[]
    for i,cable in enumerate(group.cables):
        row=[]
        for j,other in enumerate(group.cables):
            x=abs(cable['point'][0]-other['point'][0])
            radius=cable['geometry'].overall_m/2
            homogeneous=rho/(2*pi)*(acosh(d/radius) if i==j else log(hypot(x,2*d)/x))
            def integrand(q):
                if q==0:return 0. if d<H else 4*H/(1+r)
                numerator=exp(-2*q*(H-d))*(-expm1(-2*q*d))**2 if d<H else exp(-2*q*(d-H))*(-expm1(-4*q*H))
                return cos(q*x)*numerator/(q*(1+r*exp(-2*q*H)))
            value,error=quad(integrand,0.,float('inf'),epsabs=1e-10,epsrel=1e-10,limit=500)
            coefficient=r*rho/(2*pi)*(1 if d<H else -1)
            if error*abs(coefficient)>1e-8:raise ValueError('soil_layers：独立傅里叶热阻积分精度不合格。')
            row.append(homogeneous+coefficient*value)
        matrix.append(row)
    return matrix
