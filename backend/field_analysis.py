"""Scoped cable field studies: numerical external-soil heat, analytical E and B.
Not a general multiphysics FEM model; these outputs never replace the rating solver.
"""
from hashlib import sha256
import json
from math import pi
from typing import Literal
import numpy as np
from scipy.sparse import diags, eye, kron
from scipy.sparse.linalg import spsolve
from pydantic import Field
from .schemas import Scenario, StrictModel
from .engine import ThermalNetwork, MODEL_VERSION


class FieldRequest(StrictModel):
    expected_revision: int = Field(ge=1)
    kind: Literal['thermal_fd', 'electric', 'magnetic']
    resolution: Literal[65, 129] = 65


def poisson(boundary: np.ndarray, source: np.ndarray, dx: float, dy: float, conductivity: float):
    """Five-point Dirichlet -k Laplacian(T)=source, W/m3, on an orthogonal grid."""
    ny, nx = boundary.shape
    ax = diags([-np.ones(nx-3),2*np.ones(nx-2),-np.ones(nx-3)],[-1,0,1]) / dx**2
    ay = diags([-np.ones(ny-3),2*np.ones(ny-2),-np.ones(ny-3)],[-1,0,1]) / dy**2
    matrix = (kron(eye(ny-2),ax) + kron(ay,eye(nx-2))).tocsc()
    rhs = source[1:-1,1:-1].copy() / conductivity
    rhs[:,0] += boundary[1:-1,0]/dx**2
    rhs[:,-1] += boundary[1:-1,-1]/dx**2
    rhs[0,:] += boundary[0,1:-1]/dy**2
    rhs[-1,:] += boundary[-1,1:-1]/dy**2
    solution = spsolve(matrix,rhs.ravel())
    result = boundary.copy()
    result[1:-1,1:-1] = solution.reshape(ny-2,nx-2)
    residual = float(np.max(np.abs(matrix @ solution-rhs.ravel())))
    flux = conductivity * (dy/dx * (np.sum(result[1:-1,1]-result[1:-1,0])+np.sum(result[1:-1,-2]-result[1:-1,-1]))
        + dx/dy * (np.sum(result[1,1:-1]-result[0,1:-1])+np.sum(result[-2,1:-1]-result[-1,1:-1])))
    power = float(np.sum(source[1:-1,1:-1])*dx*dy)
    return result, {'linear_residual':residual,'source_power_w_m':power,'boundary_flux_w_m':float(flux),
                    'energy_error_w_m':float(abs(flux-power))}


def soil_reference(net: ThermalNetwork, xx, yy, losses):
    temperature = np.full_like(xx,net.s.installation.ambient_temperature_c)
    for (x,h),q in zip(net.positions,losses):
        d2=(xx-x)**2+(yy-h)**2
        image2=(xx-x)**2+(yy+h)**2
        temperature += net.s.installation.soil_rho_k_m_w*q/(4*pi)*np.log(image2/np.maximum(d2,net.radii[-1]**2))
    return temperature


def soil_fd(net: ThermalNetwork, current: float, n: int):
    state=net.state(current)
    margin=max(1.2,net.s.installation.depth_m)
    xmax=float(max(abs(net.positions[:,0])))+margin
    bottom=float(max(net.positions[:,1]))+margin
    xs,ys=np.linspace(-xmax,xmax,n),np.linspace(0,bottom,n)
    xx,yy=np.meshgrid(xs,ys)
    dx,dy=xs[1]-xs[0],ys[1]-ys[0]
    reference=soil_reference(net,xx,yy,state['total_losses_w_m'])
    boundary=reference.copy()
    source=np.zeros((n,n))
    mask=np.zeros((n,n),dtype=bool)
    for (x,h),q in zip(net.positions,state['total_losses_w_m']):
        fx,fy=(x-xs[0])/dx,h/dy
        i,j=int(np.floor(fx)),int(np.floor(fy))
        if not (1<=i<n-2 and 1<=j<n-2):
            raise ValueError('热源过于接近计算边界，请调整网格或敷设。')
        tx,ty=fx-i,fy-j
        for di,dj,weight in [(0,0,(1-tx)*(1-ty)),(1,0,tx*(1-ty)),(0,1,(1-tx)*ty),(1,1,tx*ty)]:
            source[j+dj,i+di] += q*weight/(dx*dy)
        mask |= (xx-x)**2+(yy-h)**2 <= max(net.radii[-1],2.5*max(dx,dy))**2
    values,diagnostics=poisson(boundary,source,dx,dy,1/net.s.installation.soil_rho_k_m_w)
    compare=np.ones_like(mask)
    for x,h in net.positions:
        compare &= ((xx-x)**2+(yy-h)**2 > .3**2)
    diagnostics.update({'reference_rmse_k':float(np.sqrt(np.mean((values[compare]-reference[compare])**2))),
                        'dx_m':float(dx),'dy_m':float(dy),'unknowns':(n-2)**2})
    return xs,ys,values,mask,diagnostics


def compute_fields(s:Scenario,kind:str,n=65):
    net=ThermalNetwork(s)
    diagnostics={}
    if kind=='thermal_fd':
        xs,ys,values,mask,diagnostics=soil_fd(net,s.operating_current_a,n)
        if n==129:
            *_,coarse=soil_fd(net,s.operating_current_a,65)
            diagnostics['coarse_reference_rmse_k']=coarse['reference_rmse_k']
            diagnostics['refinement_rmse_ratio']=diagnostics['reference_rmse_k']/max(coarse['reference_rmse_k'],1e-15)
        title,unit='外部土壤温度 · 二维有限差分','°C'
        axes=['水平距离 / m','埋深 / m']
        notes=['真实求解二维稳态 Poisson 方程；不是 COMSOL/FEM。',
               '电缆总损耗取自既有稳态热网络，网格仅求解均匀土壤，不反向修正载流量。',
               '恒温地表；侧面和底面使用同一半空间解析模型提供的 Dirichlet 边界。',
               '线热源按双线性权重沉积；近热源 2.5 个网格宽度内遮罩，不输出虚假导体温度。',
               '残差/守恒/网格对比是数值诊断，不等于厂家或 IEC 正式算例认证。']
    elif kind=='electric':
        a,b=net.radii[1],net.radii[2]
        r=net.radii[-1]*1.08
        xs,ys=np.linspace(-r*1000,r*1000,n),np.linspace(-r*1000,r*1000,n)
        xx,yy=np.meshgrid(xs/1000,ys/1000)
        radius=np.hypot(xx,yy)
        mask=(radius<a)|(radius>b)
        values=(s.cable.u0_kv*1000)/(np.maximum(radius,a)*np.log(b/a))/1e6
        radii=np.linspace(a,b,1001)
        e=s.cable.u0_kv*1000/(radii*np.log(b/a))
        diagnostics={'max_field_kv_mm_rms':float(e[0]/1e6),'min_field_kv_mm_rms':float(e[-1]/1e6),
                     'voltage_integral_kv':float(np.trapezoid(e,radii)/1000),
                     'insulation_inner_radius_mm':float(a*1000),'insulation_outer_radius_mm':float(b*1000)}
        title,unit='XLPE 绝缘电场 · 同轴解析','kV/mm RMS'
        axes=['截面 x / mm','截面 y / mm']
        notes=['同心均匀绝缘，导体屏蔽等电位 U₀、绝缘外屏蔽接地；E(r)=U₀/[r ln(b/a)]。',
               '显示工频有效值；瞬时峰值为有效值的 √2 倍。',
               '不含空间电荷、缺陷、接头终端、电树枝、介电强度试验与绝缘配合校核。']
    elif kind=='magnetic':
        cx=float(np.mean(net.positions[:,0]));cy=float(np.mean(net.positions[:,1]))
        extent=max(.3,s.installation.spacing_m*1.7)
        xs,ys=np.linspace(cx-extent,cx+extent,n),np.linspace(cy-extent,cy+extent,n)
        xx,yy=np.meshgrid(xs,ys)
        bx=np.zeros_like(xx,dtype=complex);by=bx.copy();mask=np.zeros_like(xx,dtype=bool)
        for i,(x,h) in enumerate(net.positions):
            dx,dy=xx-x,yy-h
            d2=dx*dx+dy*dy
            mask |= d2<=net.radii[-1]**2
            factor=2e-7*s.operating_current_a*np.exp(-2j*pi*i/3)/np.maximum(d2,net.radii[-1]**2)
            bx-=factor*dy;by+=factor*dx
        values=np.sqrt(abs(bx)**2+abs(by)**2)*1e6
        diagnostics={'uniform_current_density_a_mm2':s.operating_current_a/s.cable.area_mm2,
                     'current_a_rms':s.operating_current_a,'phases_deg':[0,-120,120]}
        title,unit='三相外部磁感应强度 · 无限长导体解析','µT RMS'
        axes=['水平距离 / m','埋深 / m']
        notes=['按平衡三相 RMS 电流相量叠加 Bx/By，图值为矢量有效值。',
               '均匀非磁性介质 μr=1，无限长直导体；遮罩电缆内部。',
               '忽略屏蔽/铠装感应电流、铁磁材料、集肤邻近效应；不用于电磁兼容合规判定。']
    else:
        raise ValueError('不支持的场类型。')
    finite=values[~mask]
    payload=s.model_dump(mode='json')
    return {'kind':kind,'title':title,'unit':unit,'axes':axes,'x':xs.tolist(),'y':ys.tolist(),
            'values':[[None if mask[j,i] else float(values[j,i]) for i in range(n)] for j in range(n)],
            'range':[float(np.min(finite)),float(np.max(finite))], 'diagnostics':diagnostics,
            'notes':notes+['物理竖井/垂直敷设的通风、烟囱效应和轴向温差不在本模型中，不能套用直埋边界。'],
            'input':payload,'input_sha256':sha256(json.dumps(payload,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest(),
            'model_version':MODEL_VERSION,'field_version':'CABLE-FIELDS-0.4.0','resolution':n}
