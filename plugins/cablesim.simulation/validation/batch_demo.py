"""Explicit synthetic 10 kV, three-circuit duct-bank input for batch acceptance.

These dimensions and material values are declared research assumptions, not a
manufacturer cable, a GB/IEC rating, or field measurements. No missing data is inferred.
"""
from copy import deepcopy
from math import pi,sqrt


def baseline():
    source='Synthetic 10 kV three-circuit 3x3 duct bank; explicitly declared validation input, not manufacturer/IEC data'
    r=sqrt(240e-6/pi);cables=[]
    for circuit in range(3):
        for phase in range(3):
            uid=f'circuit/{circuit+1}/'+('ABC'[phase])
            cables.append({'uid':uid,'circuit':f'circuit/{circuit+1}',
                'x_m':(circuit-1)*.3,'z_m':-1.+(phase-1)*.18,
                'layers':[{'uid':uid+'/core','role':'conductor','outer_radius_m':r,'k_w_m_k':385.,'fixed_heat_w_m':0.},
                          {'uid':uid+'/insulation','role':'insulation','outer_radius_m':r+.0045,'k_w_m_k':.286,'fixed_heat_w_m':0.},
                          {'uid':uid+'/sheath','role':'sheath','outer_radius_m':r+.0065,'k_w_m_k':.286,'fixed_heat_w_m':0.}],
                'current_a':180.,'electrical':{'r20_ohm_m':1/(58e6*240e-6),'alpha20_per_k':.00393,
                    'ac_extra_factor':.03,'sheath_loss_factor':0.,'sheath_layer_uid':None,'source':source+'; explicit copper sigma58MS/m and Rac/Rdc=1.03 assumption; no sheath or dielectric heat'},
                'prescribed_core_temperature_k':None,'temperature_limit_k':363.15,
                'duct':{'uid':uid+'/duct','inner_radius_m':.055,'outer_radius_m':.065,
                    'k_w_m_k':.4,'air_resistance_k_m_w':.7,'source':source+'; explicitly prescribed equivalent annulus resistance, not CFD'}})
    boundary={'kind':'temperature','temperature_k':293.15,'h_w_m2_k':None,'emissivity':None}
    model={'schema_version':'cablesim.thermal-model/1','cables':cables,
        'environment':{'kind':'ground','background':{'uid':'soil','bounds_m':[-6.,-6.,6.,0.],'k_w_m_k':1.},
            'soil_layers':[],'backfills':[],
            'boundaries':{name:deepcopy(boundary) for name in ('top','bottom','left','right')}},
        'provenance':{'model':{'source':source},'rated_voltage':{'value':10000.,'unit':'V','source':source+'; geometric design context only, no dielectric model'}},
        'assumptions':['Infinite 2D section; homogeneous soil; all external boundaries at declared ground temperature.',
            '240 mm2 solid-equivalent copper; 4.5mm insulation and 2mm jacket are declared synthetic dimensions.',
            'Independent single-core ducts; prescribed equivalent air resistance 0.7 K m/W.',
            'No screen, armor, dielectric heating, groundwater advection or soil drying; not a standard cable rating.',
            'Circuit 2 current is rated while circuits 1 and 3 retain sampled operating load.']}
    return {'case_id':'base','input':model,'parameters':{'controls':{'operation':'ampacity',
        'mesh_size_m':.004,'far_mesh_size_m':.25,'mesh_transition_m':.3,'max_nodes':70000,
        'tolerance_k':1e-5,'max_iterations':100,'relaxation':.8,'current_upper_a':650.,
        'current_tolerance_a':.05,'rated_circuit':'circuit/2'},
        'dataset':{'mesh_scales':[1.5,1.,.75,.6],'temperature_tolerance_k':.1,'ampacity_tolerance_a':.5}}}


def parameter_space(count=2000,seed=42):
    source='Explicit bounded synthetic design-of-experiments; independent SI inputs'
    def axis(name,label,unit,low,high,bindings):
        return dict(name=name,label=label,unit=unit,minimum=low,maximum=high,source=source,bindings=bindings)
    return {'sampling':'latin_hypercube','sample_count':count,'seed':seed,'source':source,
        'axes':[
            axis('depth','埋深','m',.6,1.8,[{'pointer':f'/input/cables/{i}/z_m','target_unit':'m','scale':-1.,'offset':(i%3-1)*.18} for i in range(9)]),
            axis('soil_resistivity','土壤热阻率','K*m/W',.6,2.5,[{'pointer':'/input/environment/background/k_w_m_k','target_unit':'W/(m*K)','reciprocal':True}]),
            axis('ambient','地温','K',283.15,313.15,[{'pointer':f'/input/environment/boundaries/{name}/temperature_k','target_unit':'K'} for name in ('top','bottom','left','right')]),
            axis('load','负荷','A',100.,240.,[{'pointer':f'/input/cables/{i}/current_a','target_unit':'A'} for i in range(9)]),
            axis('spacing','回路间距','m',.18,.4,[{'pointer':f'/input/cables/{i}/x_m','target_unit':'m','scale':i//3-1} for i in range(9)])]}
