"""TB880 Case1: full wire-screen/laminated-foil reference rating chains."""
from math import pi,sqrt,log,acosh,isfinite
from typing import Literal
from pydantic import BaseModel,ConfigDict,Field,StrictInt,model_validator
from .tb880_reference import COMMON,WIRE,Layer,layer_resistance

FOIL={'conductor_ks','conductor_kp','foil_inner_diameter_m','foil_thickness_m',
      'foil_resistivity_ohm_m','foil_alpha_per_k','bedding_thermal_resistivity_k_m_w'}


class WireFoilRating(BaseModel):
    model_config=ConfigDict(extra='forbid',allow_inf_nan=False)
    schema_version: Literal['cablesim.iec60287.tb880-wire-foil/1']
    arrangement: Literal['trefoil','flat']
    data: dict[str,float]
    inner_layers: list[Layer]=Field(min_length=4,max_length=4)
    outer_layers: list[Layer]=Field(min_length=2,max_length=2)
    wire_count: StrictInt=Field(gt=0,le=1000)
    minor_section_ratios: tuple[float,float,float]|None=None
    source_reference: str=Field(min_length=1)
    source_sha256: str=Field(pattern=r'^[a-fA-F0-9]{64}$')

    @model_validator(mode='before')
    @classmethod
    def numeric(cls,value):
        if isinstance(value,dict) and any(isinstance(v,bool) or not isinstance(v,(float,int)) for v in value.get('data',{}).values()):raise ValueError('data: explicit numeric SI inputs required')
        return value

    @model_validator(mode='after')
    def scope(self):
        d=self.data
        if set(d)!=COMMON|WIRE|FOIL or any(not isfinite(v) or v<=0 for v in d.values()):raise ValueError('data: exact positive finite primitive SI inputs required')
        if not self.source_reference.strip():raise ValueError('source_reference required')
        if not 273.15<=d['ambient_temperature_k']<d['conductor_temperature_k']<=373.15 or not 45<=d['frequency_hz']<=65:raise ValueError('reference scope: 0..100C and45..65Hz')
        screen_outer=self.inner_layers[-1].outer_diameter_m+2*d['screen_wire_diameter_m'];foil_outer=d['foil_inner_diameter_m']+2*d['foil_thickness_m']
        if screen_outer>=d['foil_inner_diameter_m']:raise ValueError('foil must enclose wire screen with a positive bedding gap')
        for start,layers in [(d['conductor_diameter_m'],self.inner_layers),(foil_outer,self.outer_layers)]:
            for layer in layers:
                if layer.outer_diameter_m<=start:raise ValueError('layers must have strictly increasing diameters')
                start=layer.outer_diameter_m
        outer=self.outer_layers[-1].outer_diameter_m
        if d['burial_depth_m']<=outer/2 or d['core_spacing_m']<outer:raise ValueError('burial or spacing invalid')
        if self.arrangement=='trefoil':
            if abs(d['core_spacing_m']-outer)>1e-10 or self.minor_section_ratios is not None:raise ValueError('trefoil reference is touching, solidly bonded')
        elif self.minor_section_ratios is None or any(not isfinite(v) or v<=0 for v in self.minor_section_ratios):raise ValueError('flat reference needs positive cross-bonded minor-section ratios')
        return self


def electrical(d,temperatures):
    values=[]
    for temperature in temperatures:
        r=d['conductor_r20_ohm_m']*(1+d['conductor_alpha_per_k']*(temperature-293.15));base=8*pi*d['frequency_hz']*1e-7/r
        xs2=base*d['conductor_ks'];xp2=base*d['conductor_kp']
        if sqrt(xs2)>2.8:raise ValueError('reference skin branch requires xs<=2.8')
        ys=xs2**2/(192+.8*xs2**2);z=xp2**2/(192+.8*xp2**2);ratio=d['conductor_diameter_m']/d['core_spacing_m']
        yp=z*ratio**2*(.312*ratio**2+1.18/(z+.27));values.append(r*(1+ys+yp))
    return values


def rate(r:WireFoilRating):
    d=r.data;flat=r.arrangement=='flat';omega=2*pi*d['frequency_hz'];s=d['core_spacing_m'];limit=d['conductor_temperature_k'];ambient=d['ambient_temperature_k']
    screen_outer=r.inner_layers[-1].outer_diameter_m+2*d['screen_wire_diameter_m'];screen_mean=screen_outer-d['screen_wire_diameter_m']
    foil_outer=d['foil_inner_diameter_m']+2*d['foil_thickness_m'];foil_mean=foil_outer-d['foil_thickness_m']
    area=r.wire_count*pi*d['screen_wire_diameter_m']**2/4;lay=sqrt(1+(pi*screen_mean/d['screen_wire_lay_m'])**2)
    rs0=d['sheath_resistivity_ohm_m']/area*lay;rf0=d['foil_resistivity_ohm_m']/(pi*foil_mean*d['foil_thickness_m'])
    mean=sqrt((screen_mean**2+foil_mean**2)/2);x=2*omega*1e-7*log(2*s/mean);xm=2*omega*1e-7*log(2);P=x+xm;Q=x-xm/3
    lengths=r.minor_section_ratios;msu=(sum(v*v for v in lengths)-sum(lengths[i]*lengths[j] for i,j in [(0,1),(1,2),(2,0)]))/sum(lengths)**2 if flat else 1.
    inner=layer_resistance(d['conductor_diameter_m'],r.inner_layers);t1=sum(inner)
    t2=d['bedding_thermal_resistivity_k_m_w']/(2*pi)*log(d['foil_inner_diameter_m']/screen_outer)
    outer=layer_resistance(foil_outer,r.outer_layers);t3=sum(outer)*(1 if flat else 1.6)
    cap=d['relative_permittivity']/(18*log(r.inner_layers[1].outer_diameter_m/r.inner_layers[0].outer_diameter_m))*1e-9
    wd=omega*cap*d['line_voltage_v']**2/3*d['loss_tangent'];rho=d['soil_thermal_resistivity_k_m_w'];depth=d['burial_depth_m'];diam=r.outer_layers[-1].outer_diameter_m
    self_t=rho/(2*pi)*acosh(2*depth/diam)
    near=rho/(2*pi)*log(sqrt(s*s+(2*depth)**2)/s);far=rho/(2*pi)*log(sqrt((2*s)**2+(2*depth)**2)/(2*s))
    matrix=[[self_t,near,near],[near,self_t,far],[near,far,self_t]]
    trefoil_t=1.5*rho/pi*(log(4*depth/diam)-.630)
    tc=[limit]*3;ts=[ambient]*3;tf=[ambient]*3;current=0.;history=[]
    for iteration in range(400):
        rc=electrical(d,tc);screen=[];foil=[];details=[]
        for i in range(3):
            rs=rs0*(1+d['sheath_alpha_per_k']*(ts[i]-293.15));rf=rf0*(1+d['foil_alpha_per_k']*(tf[i]-293.15));parallel=rs*rf/(rs+rf)
            if flat:
                if i==0:lc=parallel/rc[i]*Q*Q/(parallel**2+Q*Q)*msu
                else:lc=parallel/rc[i]*(.75*P*P/(parallel**2+P*P)+.25*Q*Q/(parallel**2+Q*Q)+(1 if i==1 else -1)*2*parallel*P*Q*xm/(sqrt(3)*(parallel**2+P*P)*(parallel**2+Q*Q)))*msu
            else:lc=parallel/rc[i]/(1+(parallel/x)**2)
            m=omega/rf*1e-7;ratio=foil_mean/(2*s);l0=(6 if flat and i==0 else 1.5 if flat else 3)*m*m/(1+m*m)*ratio**2
            if not flat:delta1=(1.14*m**2.45+.33)*ratio**(.92*m+1.66);delta2=0.
            elif i==0:delta1=.86*m**3.08*ratio**(1.4*m+.7);delta2=0.
            elif i==1:delta1=-.74*(m+2)*sqrt(m)/(2+(m-.3)**2)*ratio**(m+1);delta2=.92*m**3.7*ratio**(m+2)
            else:delta1=4.7*m**.7*ratio**(.16*m+2);delta2=21*m**3.3*ratio**(1.47*m+5.06)
            beta=sqrt(4*pi*omega/(1e7*d['foil_resistivity_ohm_m']*(1+d['foil_alpha_per_k']*(tf[i]-293.15))))
            gs=1+(d['foil_thickness_m']/foil_outer)**1.74*(beta*foil_outer-1.6)
            eddy=rf/rc[i]*(gs*l0*(1+delta1+delta2)+(beta*d['foil_thickness_m'])**4/12)
            mn=parallel/x;factor=1. if flat else (4*mn**4+4*mn**2)/(4*(mn**2+1)**2)
            screen.append(lc*rf/(rs+rf));foil.append(lc*rs/(rs+rf)+factor*eddy)
            details.append({'screen_resistance_ohm_m':rs,'foil_resistance_ohm_m':rf,'parallel_resistance_ohm_m':parallel,'circulating_total':lc,'foil_eddy':eddy,'eddy_correction':factor})
        losses=[current**2*rc[i]*(1+screen[i]+foil[i])+wd for i in range(3)]
        t4=[sum(a*b for a,b in zip(row,losses))/losses[i] for i,row in enumerate(matrix)] if flat else [trefoil_t]*3
        numerator=limit-ambient-wd*(.5*t1+t2+t3+t4[0])
        if numerator<=0:raise ValueError('Dielectric heating exhausts the temperature margin')
        proposed=sqrt(numerator/(rc[0]*(t1+(1+screen[0])*t2+(1+screen[0]+foil[0])*(t3+t4[0]))))
        wc=[proposed**2*v for v in rc]
        next_tc=[ambient+(wc[i]+.5*wd)*t1+(wc[i]*(1+screen[i])+wd)*t2+(wc[i]*(1+screen[i]+foil[i])+wd)*(t3+t4[i]) for i in range(3)]
        next_tc[0]=limit
        next_ts=[next_tc[i]-(wc[i]+.5*wd)*t1 for i in range(3)]
        next_tf=[next_ts[i]-(wc[i]*(1+screen[i])+wd)*t2 for i in range(3)]
        residual=max(abs(a-b) for first,second in [(tc,next_tc),(ts,next_ts),(tf,next_tf)] for a,b in zip(first,second));di=abs(proposed-current)
        history.append({'iteration':iteration+1,'ampacity_a':proposed,'temperature_update_k':residual,'current_update_a':di,'conductor_temperature_k':next_tc,'sheath_temperature_k':next_ts,'foil_temperature_k':next_tf})
        if residual<1e-9 and di<1e-8:break
        current=(current+proposed)/2
        tc=[(a+b)/2 for a,b in zip(tc,next_tc)];ts=[(a+b)/2 for a,b in zip(ts,next_ts)];tf=[(a+b)/2 for a,b in zip(tf,next_tf)]
    else:raise ValueError('Wire/foil reference iteration did not converge')
    if max(next_tc)>limit+1e-6:raise ValueError('An outer phase exceeds the center-phase rating limit; this reference arrangement is not valid')
    states=[{'phase':label,'conductor_temperature_k':next_tc[i],'screen_temperature_k':next_ts[i],'foil_temperature_k':next_tf[i],
             'ac_resistance_ohm_m':rc[i],'lambda_screen':screen[i],'lambda_foil':foil[i],'t4_k_m_w':t4[i],
             'conductor_loss_w_m':wc[i],'screen_loss_w_m':wc[i]*screen[i],'foil_loss_w_m':wc[i]*foil[i],**details[i]} for i,label in enumerate(('middle','lagging','leading'))]
    return {'schema':'cablesim.iec60287.tb880-wire-foil-trace/1','ampacity_a':proposed,'states':states,'t1_k_m_w':t1,'t2_k_m_w':t2,'t3_k_m_w':t3,
            'screen_r20_ohm_m':rs0,'foil_r20_ohm_m':rf0,'mean_metal_diameter_m':mean,'cross_bonding_factor':msu,'capacitance_f_m':cap,'dielectric_loss_per_core_w_m':wd,
            'inner_layer_resistances':inner,'outer_layer_resistances':outer,'history':history,'input':r.model_dump(mode='json'),'engineering_approval':False,
            'limitations':['TB880:2022 Case1完整参考公式链：三根单芯紧靠三叶形固接，或等间距平排不换位不平衡交叉互联。',
                           '按原文计算表的外径逐层算热阻；铜丝与铝箔电阻并联，环流分摊和铝箔涡流分别计算。',
                           '历史参考方法，不构成IEC2023通用领域映射或工程审批；平排三相均核验温限。']}
