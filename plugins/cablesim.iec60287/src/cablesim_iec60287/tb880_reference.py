"""Two explicitly bounded TB880 reference chains from primitive SI inputs.

This keeps the reference publication's historical formula choices. It is not a
general domain mapper or an assertion that these are the latest IEC provisions.
"""
from math import pi, sqrt, log, acosh, isfinite
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, StrictInt, model_validator


COMMON={'frequency_hz','line_voltage_v','conductor_r20_ohm_m','conductor_diameter_m','conductor_alpha_per_k',
        'conductor_temperature_k','ambient_temperature_k','relative_permittivity','loss_tangent','core_spacing_m',
        'burial_depth_m','soil_thermal_resistivity_k_m_w','sheath_resistivity_ohm_m','sheath_alpha_per_k'}
WIRE={'screen_wire_diameter_m','screen_wire_lay_m'}
LEAD={'lead_thickness_m','core_lay_m','phase_outer_diameter_m','phase_oversheath_thermal_resistivity_k_m_w',
      'assembled_diameter_m','armour_inner_diameter_m','armour_wire_diameter_m','armour_lay_m',
      'armour_resistivity_ohm_m','armour_alpha_per_k','filler_thermal_resistivity_k_m_w'}


class Layer(BaseModel):
    model_config=ConfigDict(extra='forbid',allow_inf_nan=False)
    outer_diameter_m: float=Field(gt=0,lt=1)
    thermal_resistivity_k_m_w: float=Field(gt=0,le=100)


class ReferenceRating(BaseModel):
    model_config=ConfigDict(extra='forbid',allow_inf_nan=False)
    schema_version: Literal['cablesim.iec60287.tb880-reference/1']
    construction: Literal['three_core_lead_steel','single_core_wire_trefoil']
    data: dict[str,float]
    inner_layers: list[Layer]=Field(min_length=4,max_length=5)
    outer_layers: list[Layer]=Field(min_length=1,max_length=3)
    wire_count: StrictInt=Field(gt=0,le=1000)
    source_reference: str=Field(min_length=1)
    source_sha256: str=Field(pattern=r'^[a-fA-F0-9]{64}$')

    @model_validator(mode='before')
    @classmethod
    def numeric(cls,value):
        if isinstance(value,dict) and any(isinstance(v,bool) or not isinstance(v,(float,int)) for v in value.get('data',{}).values()):
            raise ValueError('data: explicit numeric SI inputs required')
        return value

    @model_validator(mode='after')
    def scope(self):
        d=self.data;lead=self.construction=='three_core_lead_steel'
        if set(d)!=COMMON|(LEAD if lead else WIRE):raise ValueError('data: exact primitive input keys required for this construction')
        if any(not isfinite(v) or v<=0 for v in d.values()):raise ValueError('data: positive finite SI inputs required')
        if not self.source_reference.strip():raise ValueError('source_reference: source required')
        if not 273.15<=d['ambient_temperature_k']<d['conductor_temperature_k']<=373.15 or not 45<=d['frequency_hz']<=65:
            raise ValueError('reference scope: 0..100C and 45..65Hz only')
        if len(self.inner_layers)!=(5 if lead else 4) or len(self.outer_layers)!=(1 if lead else 3):raise ValueError('reference scope: explicit original layer topology required')
        for start,layers in [(d['conductor_diameter_m'],self.inner_layers),(self.metal_outer_m,self.outer_layers)]:
            for layer in layers:
                if layer.outer_diameter_m<=start:raise ValueError('layers: ordered nonoverlapping concentric diameters required')
                start=layer.outer_diameter_m
        if d['burial_depth_m']<=self.outer_layers[-1].outer_diameter_m/2:raise ValueError('burial_depth_m: cable must be below the surface')
        if lead:
            if not self.inner_layers[-1].outer_diameter_m+2*d['lead_thickness_m']<d['phase_outer_diameter_m']<=d['core_spacing_m']:
                raise ValueError('phase_outer_diameter_m/core_spacing_m: invalid three-core geometry')
            if not d['assembled_diameter_m']>2*d['core_spacing_m'] or not d['armour_inner_diameter_m']>d['assembled_diameter_m']:
                raise ValueError('assembled/armour diameters do not enclose three cores')
            if not .002<=d['armour_wire_diameter_m']<=.006:raise ValueError('armour wire correction bounded to 2..6mm reference range')
        elif d['line_voltage_v']>35000 or abs(d['core_spacing_m']-self.outer_layers[-1].outer_diameter_m)>1e-10:
            raise ValueError('single-core reference requires touching trefoil at up to35kV')
        return self

    @property
    def metal_outer_m(self):
        return self.data['armour_inner_diameter_m']+2*self.data['armour_wire_diameter_m'] if self.construction=='three_core_lead_steel' else self.inner_layers[-1].outer_diameter_m+2*self.data['screen_wire_diameter_m']


def layer_resistance(start,layers):
    values=[]
    for layer in layers:
        values.append(layer.thermal_resistivity_k_m_w/(2*pi)*log(layer.outer_diameter_m/start));start=layer.outer_diameter_m
    return values


def rate(r:ReferenceRating):
    d=r.data;lead=r.construction=='three_core_lead_steel';n=3 if lead else 1
    f=d['frequency_hz'];omega=2*pi*f;tc=d['conductor_temperature_k'];ambient=d['ambient_temperature_k'];spacing=d['core_spacing_m']
    rdc=d['conductor_r20_ohm_m']*(1+d['conductor_alpha_per_k']*(tc-293.15))
    x2=8*pi*f*1e-7/rdc
    if sqrt(x2)>2.8:raise ValueError('reference scope: conductor skin branch x<=2.8 required')
    ys=x2*x2/(192+.8*x2*x2);ratio=d['conductor_diameter_m']/spacing
    yp=ys*ratio**2*(.312*ratio**2+1.18/(ys+.27));rc=rdc*(1+(1.5 if lead else 1)*(ys+yp))
    lay=sqrt(1+(pi*1.29*d['phase_outer_diameter_m']/d['core_lay_m'])**2) if lead else 1.
    insulation=2 if lead else 1
    capacitance=d['relative_permittivity']/(18*log(r.inner_layers[insulation].outer_diameter_m/r.inner_layers[insulation-1].outer_diameter_m))*1e-9*lay
    wd=omega*capacitance*(d['line_voltage_v']**2/3)*d['loss_tangent']
    inner=layer_resistance(d['conductor_diameter_m'],r.inner_layers);t1=sum(inner)/lay
    outer=layer_resistance(r.metal_outer_m,r.outer_layers);t3=sum(outer)
    sheath_inner=r.inner_layers[-1].outer_diameter_m
    if lead:
        thickness=d['lead_thickness_m'];mean=sheath_inner+thickness;sheath_outer=sheath_inner+2*thickness
        rs0=d['sheath_resistivity_ohm_m']/(pi*thickness*mean)*lay
        x=2*omega*1e-7*log(2*spacing/mean)*lay
        pe=d['phase_oversheath_thermal_resistivity_k_m_w']/(2*pi)*log(d['phase_outer_diameter_m']/sheath_outer)/lay
        gx=(d['armour_inner_diameter_m']-d['assembled_diameter_m'])/(2*d['phase_outer_diameter_m'])
        if not 0<gx<.03:raise ValueError('reference filler branch requires 0<X<0.03')
        g=2*pi*(.00022619+2.11429*gx-20.4762*gx**2)
        t2=pe/3+d['filler_thermal_resistivity_k_m_w']/(6*pi)*g
        t4=d['soil_thermal_resistivity_k_m_w']/(2*pi)*acosh(2*d['burial_depth_m']/r.outer_layers[-1].outer_diameter_m)
        armour_mean=d['armour_inner_diameter_m']+d['armour_wire_diameter_m']
        armour_area=r.wire_count*pi*(d['armour_wire_diameter_m']/2)**2
        armour_lay=sqrt(1+(pi*armour_mean/d['armour_lay_m'])**2)
        armour_k=1.2+(1.4-1.2)/(.005-.002)*(d['armour_wire_diameter_m']-.002)
        ra0=armour_k*d['armour_resistivity_ohm_m']/armour_area*armour_lay
        axis_radius=(d['assembled_diameter_m']-spacing)/2
        geometry={'core_lay_factor':lay,'filler_x':gx,'filler_g':g,'armour_lay_factor':armour_lay,'armour_ac_factor':armour_k,'armour_r20_ohm_m':ra0}
    else:
        diameter=d['screen_wire_diameter_m'];mean=sheath_inner+diameter
        screen_lay=sqrt(1+(pi*mean/d['screen_wire_lay_m'])**2)
        area=r.wire_count*pi*diameter**2/4;rs0=screen_lay*d['sheath_resistivity_ohm_m']/area
        coverage=diameter*r.wire_count/(pi*mean)*screen_lay
        if coverage>=.5:raise ValueError('reference wire-screen branch requires coverage below50%')
        t1*=1.07;t3*=1.6;t2=0.
        t4=1.5/pi*d['soil_thermal_resistivity_k_m_w']*(log(4*d['burial_depth_m']/r.outer_layers[-1].outer_diameter_m)-.630)
        x=2*omega*1e-7*log(2*spacing/mean)
        geometry={'screen_area_m2':area,'screen_lay_factor':screen_lay,'screen_coverage':coverage}
    head=tc-ambient;num=head-wd*(.5*t1+n*(t2+t3+t4))
    if num<=0:raise ValueError('Dielectric heating exhausts temperature margin')
    ts=ta=ambient;history=[]
    for iteration in range(200):
        rs=rs0*(1+d['sheath_alpha_per_k']*(ts-293.15));lc=rs/rc*(1.5 if lead else 1)/(1+(rs/x)**2)
        le=0.;l2=0.;correction=1.
        if lead:
            m=omega/rs*1e-7;b=sqrt(4*pi*omega/(1e7*d['sheath_resistivity_ohm_m']*(1+d['sheath_alpha_per_k']*(ts-293.15))))
            l0=3*m*m/(1+m*m)*(mean/(2*spacing))**2;delta=(1.14*m**2.45+.33)*(mean/(2*spacing))**(.92*m+1.66)
            gs=1+(thickness/sheath_outer)**1.74*(b*sheath_outer-1.6)
            le=rs/rc*(gs*l0*(1+delta)+(b*thickness)**4/12)
            mn=rs/x;correction=(4*mn**4+4*mn**2)/(4*(mn**2+1)**2)
            ra=ra0*(1+d['armour_alpha_per_k']*(ta-293.15))
            l2=1.23*ra/rc*(2*axis_radius/armour_mean)**2/(1+(2.77*ra*1e6/omega)**2)*(1-rc/rs*lc)
        l1=lc+correction*le
        current=sqrt(num/(rc*t1+n*rc*(1+l1)*t2+n*rc*(1+l1+l2)*(t3+t4)))
        wc=rc*current**2;next_ts=tc-(wc+.5*wd)*t1;next_ta=next_ts-(wc*(1+l1)+wd)*n*t2
        residual=max(abs(next_ts-ts),abs(next_ta-ta))
        history.append({'iteration':iteration+1,'ampacity_a':current,'sheath_temperature_k':next_ts,'armour_temperature_k':next_ta if lead else None,'lambda1':l1,'lambda2':l2,'temperature_update_k':residual})
        if residual<1e-9:break
        ts=.5*(ts+next_ts);ta=.5*(ta+next_ta)
    else:raise ValueError('Reference thermal/electrical iteration did not converge')
    return {'schema':'cablesim.iec60287.tb880-reference-trace/1','ampacity_a':current,'conductor_loss_w_m':n*wc,'sheath_loss_w_m':n*wc*l1,'armour_loss_w_m':n*wc*l2,
            'dielectric_loss_per_core_w_m':wd,'ac_resistance_ohm_m':rc,'dc_resistance_ohm_m':rdc,'ys':ys,'yp':yp,'capacitance_f_m':capacitance,
            'sheath_r20_ohm_m':rs0,'sheath_resistance_ohm_m':rs,'sheath_reactance_ohm_m':x,'sheath_temperature_k':next_ts,
            'lambda1':l1,'lambda1_circulating':lc,'lambda1_eddy':le,'lead_correction':correction,'lambda2':l2,
            't1_k_m_w':t1,'t2_k_m_w':t2,'t3_k_m_w':t3,'t4_k_m_w':t4,'inner_layer_resistances':inner,'outer_layer_resistances':outer,
            'geometry_factors':geometry,'history':history,'input':r.model_dump(mode='json'),'engineering_approval':False,
            'limitations':['仅TB880:2022 Case2或Case4明确结构的参考公式链；SI原始几何/材料输入，热阻和损耗均重新推导。',
                           '保留出版物历史公式和钢丝6mm外推规则；不替代IEC2023通用领域映射或工程审批。',
                           '铜丝屏蔽参考例绞距短于标准条款15D，TB880 p203仍沿用1.07/1.6修正；本入口明确复现该约定。']}
