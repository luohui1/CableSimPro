"""Kennelly image-line Dirichlet data for a uniform, isothermal half-space.

The Green function is rho*q/(2*pi)*log(r_image/r_real).  It solves
-k Laplacian(T)=q*delta and T=ambient on z=0.  This is an outer-boundary
approximation, not an internal cable temperature or an IEC rating substitute.
See IEC 60287-2-1:2023, 4.2.2 (external resistance of buried cables), and
the independent disk-source analytic validation in tests/test_far_boundary.py.
"""
from typing import Literal
from pydantic import Field
from cablesim_sdk.iec_thermal import ThreeCoreThermalParameters


class ThermalParameters(ThreeCoreThermalParameters):
    outer_boundary: Literal['ambient_truncated','kennelly_image'] = Field(
        default='kennelly_image', description='均匀土壤、恒温地表的稳态研究默认镜像远场；分层、回填等工况须显式选择适用边界。')


def default_boundary_reason(section, load):
    """A default is authorized only for the validated homogeneous half-space."""
    if section.get('kind') != 'ground':return '此默认只覆盖地下土壤截面'
    if section.get('soil_layers'):return '分层土壤不满足均匀半无限土壤假设'
    if section.get('backfill'):return '回填区不满足均匀半无限土壤假设'
    if load.get('kind') != 'steady':return '此默认只覆盖稳态负荷'
    surface=section.get('medium',{}).get('surface_temperature')
    from math import isfinite
    if not isinstance(surface,(int,float)) or isinstance(surface,bool) or not isfinite(surface):
        return '地表没有保存有限的恒温边界'
    return None


def image_rise(points, sources, rho):
    """Vectorized boundary rise (K), from nonnegative actual losses (W/m)."""
    import numpy as np
    points=np.asarray(points,dtype=float)
    if points.ndim!=2 or points.shape[0]!=2 or not np.isfinite(points).all() or np.any(points[1]>1e-10):
        raise ValueError('远场采样须为地表以下的有限二维坐标，单位m。')
    if not np.isfinite(rho) or rho<=0:raise ValueError('远场土壤热阻率须为正有限值，单位K·m/W。')
    rise=np.zeros(points.shape[1])
    for source in sources:
        x,z=source['center_m'];q=source['loss_w_m']
        if not np.isfinite([x,z,q]).all() or z>=0 or q<0:raise ValueError('镜像热源须在地下，损耗须为非负有限W/m。')
        real=(points[0]-x)**2+(points[1]-z)**2
        mirror=(points[0]-x)**2+(points[1]+z)**2
        if np.any(real<=0):raise ValueError('远边界不能穿过热源。')
        rise+=rho*q/(4*np.pi)*np.log(mirror/real)
    return rise


def loss_sources(states, bindings):
    """Resolved cores/screens/dielectrics and common armour, conserving all heat."""
    sources=[]
    for state,binding in zip(states,bindings):
        per_core=sum(state[k] for k in ('conductor_joule_heat_w_m','screen_heat_w_m','dielectric_heat_w_m'))/len(binding['centers'])
        sources.extend({'entity':binding['entity']+f'/core-{i}', 'center_m':center,'loss_w_m':per_core}
                       for i,center in enumerate(binding['centers']))
        sources.append({'entity':binding['entity']+'/armour','center_m':binding['center_m'],
                        'loss_w_m':state['armour_heat_w_m']})
    return sources
