"""Reduced cable physics. No CFD, arbitrary geometry FEM or standard certification.

Vertical: conservative axial finite volumes, four radial nodes, temperature-dependent
Joule heat, dielectric/screen sources, prescribed convection and grey-body radiation.
Electrostatic: homogeneous coaxial insulation analytical solution, RMS quantities.
"""
from math import pi, log, sqrt
import numpy as np
from pydantic import Field
from scipy.sparse import lil_matrix
from scipy.sparse.linalg import spsolve
from .schemas import Cable, Scenario, StrictModel
from .engine import ThermalNetwork, ModelError


class Vertical(StrictModel):
    height_m: float = Field(default=20, ge=1, le=300)
    ambient_bottom_c: float = Field(default=25, ge=-20, le=60)
    ambient_top_c: float = Field(default=40, ge=-20, le=80)
    h_w_m2k: float = Field(default=8, ge=1, le=50)
    emissivity: float = Field(default=0.85, ge=0, le=1)
    cells: int = Field(default=40, ge=10, le=160)


class VerticalNetwork:
    def __init__(self, cable: Cable, config: Vertical):
        # Geometry/material definitions are shared with the buried engine, not soil physics.
        net = ThermalNetwork(Scenario(cable=cable))
        self.c, self.v = cable, config
        self.t = np.array([net.t[0] + net.t[1] / 2, net.t[1] / 2 + net.t[2] + net.t[3], net.t[4]])
        self.r, self.alpha, self.wd = net.r20ac, net.alpha, net.wd
        self.diameter = float(net.radii[-1] * 2)
        self.n, self.dz = config.cells, config.height_m / config.cells
        self.z = (np.arange(self.n) + .5) * self.dz
        self.ambient = config.ambient_bottom_c + (config.ambient_top_c-config.ambient_bottom_c)*self.z/config.height_m
        self.axial = (400 if cable.conductor == 'copper' else 235) * cable.area_mm2 * 1e-6 / self.dz**2

    def equations(self, x, current):
        t = x.reshape(self.n, 4)
        f = np.zeros_like(t)
        j = lil_matrix((self.n*4, self.n*4))
        qc = current**2 * self.r * (1 + self.alpha*(t[:, 0]-20))
        derivative = current**2 * self.r * self.alpha
        for k in range(self.n):
            for edge, resistance in enumerate(self.t):
                a, b = k*4+edge, k*4+edge+1
                flux = (t[k,edge]-t[k,edge+1])/resistance
                f[k,edge] += flux; f[k,edge+1] -= flux
                for row,col,sign in [(a,a,1),(a,b,-1),(b,a,-1),(b,b,1)]:
                    j[row,col] += sign/resistance
            # Insulated axial ends: no missing-face flux at z=0,H.
            for neighbor in (k-1,k+1):
                if 0 <= neighbor < self.n:
                    f[k,0] += self.axial*(t[k,0]-t[neighbor,0])
                    j[k*4,k*4] += self.axial; j[k*4,neighbor*4] -= self.axial
            f[k,0] -= qc[k]; j[k*4,k*4] -= derivative
            f[k,1] -= self.wd
            f[k,2] -= self.c.screen_loss_factor*qc[k]
            j[k*4+2,k*4] -= self.c.screen_loss_factor*derivative
            surface_k, ambient_k = t[k,3]+273.15, self.ambient[k]+273.15
            f[k,3] += pi*self.diameter*(self.v.h_w_m2k*(surface_k-ambient_k)+self.v.emissivity*5.670374419e-8*(surface_k**4-ambient_k**4))
            j[k*4+3,k*4+3] += pi*self.diameter*(self.v.h_w_m2k+4*self.v.emissivity*5.670374419e-8*surface_k**3)
        return f.ravel(), j.tocsr(), qc

    def state(self, current):
        if not np.isfinite(current) or not 0 <= current <= 5000:
            raise ModelError('电流必须在 0–5000 A 范围内。')
        x = np.repeat(self.ambient,4) + 5
        for iteration in range(35):
            f,j,qc = self.equations(x,current)
            residual = float(np.max(np.abs(f)))
            if residual < 1e-7:
                break
            step = spsolve(j,-f)
            factor = 1.0
            accepted = False
            for _ in range(14):
                candidate = x + factor*step
                if np.all(np.isfinite(candidate)) and min(candidate)>-50 and max(candidate)<200:
                    ff,_,_ = self.equations(candidate,current)
                    if max(abs(ff)) < residual:
                        x=candidate;accepted=True;break
                factor /= 2
            if not accepted:
                raise ModelError('竖向模型未得到 200 °C 以下的有效稳态解，不能外推温度。')
        else:
            raise ModelError('竖向热模型未收敛。')
        t=x.reshape(self.n,4)
        # With nonuniform ambient, axial flow can cool a node below its local air.
        # Reject unstable feedback using the Z-matrix stability criterion, not that
        # incorrect local-temperature heuristic. J*x=1 with x>0 proves a nonsingular M-matrix.
        if not np.all(spsolve(j,np.ones(self.n*4))>0):
            raise ModelError('温度反馈稳定性检查未通过，拒绝该稳态分支。')
        heat=qc*(1+self.c.screen_loss_factor)+self.wd
        conv=pi*self.diameter*self.v.h_w_m2k*(t[:,3]-self.ambient)
        rad=pi*self.diameter*self.v.emissivity*5.670374419e-8*((t[:,3]+273.15)**4-(self.ambient+273.15)**4)
        loss=float(sum(heat)*self.dz)
        return {'current_a':current,'z_m':self.z.tolist(),'ambient_c':self.ambient.tolist(),
                'conductor_c':t[:,0].tolist(),'dielectric_node_c':t[:,1].tolist(),'screen_c':t[:,2].tolist(),'surface_c':t[:,3].tolist(),
                'conductor_loss_w_m':qc.tolist(),'total_loss_w_m':heat.tolist(),
                'convection_w_m':conv.tolist(),'radiation_w_m':rad.tolist(),
                'max_temperature_c':float(max(t[:,0])),'hotspot_height_m':float(self.z[np.argmax(t[:,0])]),
                'single_cable_loss_w':loss,'balance_error_w':float(abs(sum(heat-conv-rad))*self.dz),
                'max_node_residual_w_m':residual,'iterations':iteration+1}

    def rating(self):
        limit=self.c.max_temperature_c
        if self.state(0)['max_temperature_c'] >= limit:
            raise ModelError('零电流工况已达到温度上限。')
        lo,hi=0.,5000.
        for _ in range(34):
            mid=(lo+hi)/2
            try: hot=self.state(mid)['max_temperature_c'] > limit
            except ModelError: hot=True
            if hot: hi=mid
            else: lo=mid
        state=self.state(lo)
        if abs(state['max_temperature_c']-limit)>0.01:
            raise ModelError('无法验证温度极限处的载流量，拒绝返回额定结果。')
        return lo,state


def vertical_study(cable:Cable,config:Vertical,current:float):
    net=VerticalNetwork(cable,config)
    rating,rated=net.rating()
    try: operating=net.state(current); error=None
    except ModelError as exc: operating=None;error=str(exc)
    return {'model':'VERTICAL-FV-0.4','ampacity_a':rating,'rating':rated,'operating':operating,'operating_error':error,
            'configuration':config.model_dump(),'radial_resistances_k_m_w':net.t.tolist(),
            'warnings':['单根隔离竖向电缆：给定沿高环境温度和对流系数 h；不求解井道气流、烟囱效应、成束互热或支架热桥。',
                        '轴向有限体积 + 四节点径向热网络；两端绝热。不是全二维/三维 FEM。',
                        '外界辐射温度等于当地空气温度；热导率常数为演示假设。h 必须由试验或另行校核。',
                        '竖向研究独立于直埋模型；不使用直埋埋深、土壤热阻率和相间距。',
                        '网格分辨率会影响热点位置。设计选型还需短路、压降、绝缘与机械校核。']}


def electric_study(cable:Cable):
    radii=cable.radii_mm(); a,b=radii[1],radii[2]
    rr=np.linspace(a,b,101); voltage=cable.u0_kv
    e=voltage/(rr*log(b/a)); potential=voltage*np.log(b/rr)/log(b/a)
    xy=np.linspace(-b*1.15,b*1.15,91); field=[]
    for y in xy:
        row=[]
        for x in xy:
            r=sqrt(x*x+y*y)
            row.append(float(voltage/(r*log(b/a))) if a<=r<=b else None)
        field.append(row)
    return {'model':'COAX-ELECTRIC-0.4','radius_mm':rr.tolist(),'potential_rms_kv':potential.tolist(),
            'electric_rms_kv_mm':e.tolist(),'electric_peak_kv_mm':(e*sqrt(2)).tolist(),
            'max_electric_rms_kv_mm':float(e[0]),'capacitance_nf_km':2*pi*8.8541878128e-12*cable.relative_permittivity/log(b/a)*1e12,
            'x_mm':xy.tolist(),'field_rms_kv_mm':field,
            'warnings':['均匀同轴绝缘、内半导电层等势、外屏蔽接地；忽略端部、缺陷、空间电荷。',
                        '输入是相对地电压 U₀；图为 RMS 场强，峰值为 √2 倍。不是局放或击穿合格判据。']}
