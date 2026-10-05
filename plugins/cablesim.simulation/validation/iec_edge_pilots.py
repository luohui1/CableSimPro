"""Small Slurm-only drying/crossing pilots; no engineering capability or ML data.

Primary formula evidence: IEC 60287-1-1:2023 4.3.1 Eq.(3), pp.13-14;
IEC 60287-3-3:2007 4.1-4.2 Eqs.(1)-(13), Annex A Tables A.1-A.2.
All case variations are explicit numerical research assumptions, not site data.
"""
from math import acosh,pi,sqrt
from pathlib import Path
import os
import sys

ROOT=Path(__file__).resolve().parents[3]
sys.path[:0]=[str(ROOT),str(ROOT/'plugins/cablesim.simulation/src')]


def require_slurm():
    if not os.environ.get('SLURM_JOB_ID'):
        raise RuntimeError('Pilots require a Slurm compute allocation; no local solver fallback.')


def drying_rating(conductance,rho_wet,rho_dry,critical_rise,headroom=65.,internal=.318,resistance=7.81e-5):
    """Kirchhoff-transformed nonlinear soil FEM coupled to a radial cable.

    Phi(T)=integral(k(T)dT).  For uniform soil k(T), div(k grad T)=0
    becomes Laplace(Phi)=0 exactly. The surface is isothermal; a FEM shape
    conductance gives Q=G*Phi(Ts). This is not a moisture-transport PDE.
    """
    def phi(rise):
        return min(rise,critical_rise)/rho_wet+max(0.,rise-critical_rise)/rho_dry
    lo,hi=0.,headroom
    for _ in range(80):
        surface=(lo+hi)/2
        if surface+conductance*phi(surface)*internal>headroom:hi=surface
        else:lo=surface
    heat=conductance*phi(lo)
    return {'ampacity_a':sqrt(heat/resistance),'surface_rise_k':lo,'heat_w_m':heat,
        'drying_active':lo>critical_rise,'balance_residual_k':abs(lo+heat*internal-headroom)}


def soil_conductance(depth,bounds,size,far):
    require_slurm()
    from cablesim_simulation.thermal_input import prepare
    from cablesim_simulation.thermal import ThermalSystem
    bc={'kind':'temperature','temperature_k':298.15,'h_w_m2_k':None,'emissivity':None}
    model={'schema_version':'cablesim.thermal-model/1','cables':[{
        'uid':'surface','circuit':'single','x_m':0.,'z_m':-depth,
        'layers':[{'uid':'surface/hole','role':'conductor','outer_radius_m':.025,'k_w_m_k':None,'fixed_heat_w_m':0.}],
        'current_a':0.,'electrical':None,'prescribed_core_temperature_k':299.15,'temperature_limit_k':363.15,'duct':None}],
        'environment':{'kind':'ground','background':{'uid':'soil','bounds_m':[-bounds,-bounds,bounds,0.],'k_w_m_k':1.},
            'soil_layers':[],'backfills':[],'boundaries':{k:bc for k in ('top','bottom','left','right')}},
        'provenance':{'soil':{'source':'Kirchhoff potential shape function: unit potential on cable outer surface; zero on ground/finite boundaries'}},
        'assumptions':['The geometric hole is the cable outer surface, not its conductor.','Uniform isotropic soil; nonlinear temperature recovered by inverse Kirchhoff transform.']}
    controls={'operation':'temperature','element_order':2,'mesh_size_m':size,'far_mesh_size_m':far,'mesh_transition_m':10.,'fine_mesh_band_m':.003,
        'near_soil_mesh_size_m':size*15,'near_soil_margin_m':.5,
        'max_nodes':300000,'tolerance_k':1e-8,'max_iterations':100,'relaxation':1.,'current_upper_a':1000.,'current_tolerance_a':.01,'rated_circuit':None}
    m,c=prepare(model,{'controls':controls});system=ThermalSystem(m,c);state=system.state([0.])
    return {'conductance':state['prescribed_temperature_heat_w_m'],'nodes':state['nodes'],'elements':state['elements'],
        'energy_relative_residual':state['energy_relative_residual'],'bounds_m':bounds,'mesh_size_m':size,'far_mesh_size_m':far}


def dry_pilot():
    require_slurm()
    rows=[];geometry=[]
    for depth in (.6,1.2,1.8):
        levels=[soil_conductance(depth,30.,s,f) for s,f in [(.0015,1.2),(.001,.8),(.0007,.6)]]
        levels.append(soil_conductance(depth,60.,.0007,.6));geometry.append({'depth_m':depth,'levels':levels})
        for ratio in (2.,4.,6.):
            for critical in (10.,25.,40.):
                wet=1.;dry=ratio*wet
                # Eq.(3), n=1, Wd=lambda1=lambda2=T2=0, T1+T3=.318.
                t4=wet*acosh(depth/.025)/(2*pi)
                current=sqrt((65+(ratio-1)*critical)/(7.81e-5*(.318+ratio*t4)))
                surface=65-current**2*7.81e-5*.318
                if surface<critical:current=sqrt(65/(7.81e-5*(.318+t4)))
                predictions=[drying_rating(level['conductance'],wet,dry,critical) for level in levels]
                result=predictions[-1]
                mesh_change=abs(predictions[-3]['ampacity_a']-predictions[-2]['ampacity_a'])
                domain_change=abs(predictions[-2]['ampacity_a']-predictions[-1]['ampacity_a'])
                rows.append({'depth_m':depth,'rho_wet_k_m_w':wet,'rho_dry_k_m_w':dry,'critical_rise_k':critical,
                    'iec_ampacity_a':current,'fem':result,'iec_over_fem_percent':100*(current/result['ampacity_a']-1),
                    'mesh_change_a':mesh_change,'domain_change_a':domain_change,'valid':max(mesh_change,domain_change)<.5})
    return {'rows':rows,'geometry':geometry,'source':'IEC 60287-1-1:2023 4.3.1 Eq.(3), pp.13-14; 2-1:2023 single-cylinder half-space',
        'scope':'27 numerical cases, single isolated isothermal cable surface; soil k(T)=1/rho_wet below critical, 1/rho_dry above; exact Kirchhoff-transformed 2D soil FEM plus internal radial resistance.',
        'not_covered':['Moisture migration, hysteresis and measured site-specific critical-temperature law.','Multiple circuits and nonuniform soil; these are outside the two-zone standard scope.']}


def crossing_field(z,depth,source_depth,angle_rad,power,rho,length=None):
    """3D half-space point Green function integrated along a crossing segment."""
    import numpy as np
    transverse=(z*np.sin(angle_rad))**2
    near=np.sqrt(transverse+(depth-source_depth)**2)
    image=np.sqrt(transverse+(depth+source_depth)**2)
    if length is None:kernel=2*np.log(image/near)
    else:
        along=z*np.cos(angle_rad)
        kernel=(np.arcsinh((length/2-along)/near)+np.arcsinh((length/2+along)/near)
                -np.arcsinh((length/2-along)/image)-np.arcsinh((length/2+along)/image))
    return rho*power/(4*pi)*kernel


def crossing_rating(angle_deg=90.,length=None,*,method='fem',step=.02,extent=60.):
    require_slurm()
    import numpy as np
    from scipy.sparse import diags
    from scipy.sparse.linalg import spsolve
    # Table A.1: 300 mm2 10kV; fixed 132kV source = 3*25.90 W/m.
    depth,source_depth,power,rho=1.2,.9,3*25.90,.8
    headroom=65.;base_current=665.;alpha=.00393;resistance=7.81e-5
    tr=.214+.104+1.427;thermal=.214+(1+.089)*(.104+1.427);longitudinal=.0026/(300e-6)
    delta0=resistance*alpha*base_current**2/(1+alpha*(90-20))
    angle=angle_deg*pi/180
    n=int(round(2*extent/step));n+=n%2
    z=np.linspace(-extent,extent,n+1);h=2*extent/n
    if method=='fem':
        mass=diags([np.full(n-2,h/6),np.full(n-1,2*h/3),np.full(n-2,h/6)],[-1,0,1],format='csr')
        stiffness=diags([np.full(n-2,-1/h),np.full(n-1,2/h),np.full(n-2,-1/h)],[-1,0,1],format='csr')
        external=crossing_field(z,depth,source_depth,angle,power,rho,length)
        forcing=mass@external[1:-1]
        forcing[0]+=h/6*external[0];forcing[-1]+=h/6*external[-1]
    else:
        zz=np.arange(step,extent+step/2,step)
        gg=crossing_field(zz,depth,source_depth,angle,power,rho)
        if gg[-1]>=.01:raise ValueError('IEC 3-3 Eq.(11): increase extent until end source rise <0.01 K.')
    theta=float(crossing_field(np.asarray([0.]),depth,source_depth,angle,power,rho,length)[0])
    for iteration in range(100):
        gamma2=(1-delta0*(1-theta/headroom)*thermal)*longitudinal/tr
        if gamma2<=0:raise ValueError('No stable axial-conduction branch.')
        if method=='fem':
            values=spsolve(stiffness+gamma2*mass,gamma2*forcing)
            proposed=float(values.max())
        else:
            gamma=sqrt(gamma2)
            if gamma*step>=.01:raise ValueError('IEC 3-3 Eq.(10): decrease step.')
            proposed=float(np.expm1(gamma*step)*np.sum(np.exp(-gamma*zz)*gg))
        if abs(proposed-theta)<1e-9:theta=proposed;break
        theta=proposed
    else:raise ValueError('Crossing iteration did not converge.')
    if not 0<=theta<headroom:raise ValueError('No positive crossing rating.')
    return {'ampacity_a':base_current*sqrt(1-theta/headroom),'derating_factor':sqrt(1-theta/headroom),
        'crossing_rise_k':theta,'iterations':iteration+1,'step_m':step,'extent_m':extent,
        'axial_gamma_per_m':sqrt(gamma2),'nodes':n+1,
        'equation_residual':float(np.max(abs((stiffness+gamma2*mass)@values-gamma2*forcing))) if method=='fem' else None}


def crossing_pilot():
    require_slurm()
    rows=[];baseline=[]
    for angle in (15.,30.,60.,90.):
        iec=crossing_rating(angle,method='iec',step=.001,extent=200.)
        control=crossing_rating(angle,step=.01,extent=60.)
        baseline.append({'angle_deg':angle,'iec':iec,'infinite_source_quasi3d':control,
            'difference_percent':100*(iec['ampacity_a']/control['ampacity_a']-1)})
        for length in (3.,10.,30.):
            levels=[crossing_rating(angle,length,step=s,extent=60.) for s in (.04,.02,.01)]
            levels.append(crossing_rating(angle,length,step=.01,extent=120.))
            mesh=abs(levels[-3]['ampacity_a']-levels[-2]['ampacity_a']);domain=abs(levels[-2]['ampacity_a']-levels[-1]['ampacity_a'])
            rows.append({'angle_deg':angle,'source_length_m':length,'iec':iec,'quasi3d':levels[-1],
                'iec_over_fem_percent':100*(iec['ampacity_a']/levels[-1]['ampacity_a']-1),
                'mesh_change_a':mesh,'domain_change_a':domain,'valid':max(mesh,domain)<.5,'levels':levels})
    return {'rows':rows,'infinite_source_controls':baseline,'source':'IEC 60287-3-3:2007 4.1/4.2 Eqs.(1)-(13), Annex A Tables A.1-A.2 pp.13-14.',
        'scope':'3D half-space Green function for a finite crossing heat-source segment, coupled to 1D P1 conductor axial heat conduction and IEC resistance feedback; quasi-3D, not full solid 3D FEM.',
        'not_covered':['Finite heat-source lengths are declared synthetic variations, not measured district-heating pipe data.','Pipe fluid flow, source temperature feedback, layered soil and two-way cable crossing not included.']}


def run():
    require_slurm()
    import json
    from cablesim_sdk.reproduction import digest
    output={'schema_version':'cablesim.iec-edge-pilots/1','drying':dry_pilot(),'crossing':crossing_pilot(),
        'authority':'reference_only','engineering_approval':False,'slurm_job_id':os.environ['SLURM_JOB_ID']}
    for name in ('drying','crossing'):
        import numpy as np
        rows=output[name]['rows'];gaps=[r['iec_over_fem_percent'] for r in rows if r['valid']]
        output[name]['distribution']={'cases':len(rows),'valid':len(gaps),'minimum_percent':min(gaps) if gaps else None,
            'median_percent':float(np.median(gaps)) if gaps else None,'maximum_percent':max(gaps) if gaps else None,'above_3_percent':sum(abs(v)>3 for v in gaps)}
    output['sha256']=digest(output)
    path=ROOT/'artifacts/iec-edge-pilots.json';path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(output,ensure_ascii=False,allow_nan=False,indent=2),'utf-8')
    return output


if __name__=='__main__':run()
