"""Explicit synthetic SI fixtures for research interfaces, never product defaults."""
from math import pi
from cablesim_sdk.domain import DomainDocument


def domain(three_phase=False):
    source={'kind':'demo','reference':'Independent synthetic SI interface/Bessel/circuit verification','reviewed':False}
    conductor={'id':'material/conductor','label':'显式验证导体','category':'conductor',
               'thermal_resistivity':5. if not three_phase else 1/380.,'volumetric_heat_capacity':2e6,
               'electrical_resistivity_20':10*pi*.005**2 if not three_phase else 1.7241e-8,
               'temperature_coefficient_20':.00393,'relative_permeability':1.}
    materials=[conductor]
    layers=[]
    if three_phase:
        materials.extend([
            {'id':'material/insulation','label':'理想绝缘','category':'insulation','thermal_resistivity':5.,
             'volumetric_heat_capacity':1.5e6,'relative_permeability':1.},
            {'id':'material/sheath','label':'显式铝护套','category':'metal','thermal_resistivity':1/200.,
             'volumetric_heat_capacity':2.4e6,'electrical_resistivity_20':2.84e-8,'temperature_coefficient_20':.00403,'relative_permeability':1.},
            {'id':'material/soil','label':'均匀土壤','category':'soil','thermal_resistivity':1.,
             'volumetric_heat_capacity':1.8e6,'relative_permeability':1.}])
        layers=[{'role':'insulation','material':'material/insulation','thickness':.009,'form':'smooth'},
                {'role':'metallic_sheath','material':'material/sheath','thickness':.001,'form':'smooth'}]
    cables=[{'id':'cable/'+phase.lower(),'phase':phase} for phase in ('A','B','C')] if three_phase else [{'id':'cable/one','phase':'L1'}]
    value={'schema_version':'cablesim.domain/1','name':'显式仿真接口验证','materials':materials,
        'cable_types':[{'id':'cable_type/verification','label':'显式验证截面','construction':'single_core',
            'rating':{'u0':1000.,'max_conductor_temperature':{'normal':294.15 if not three_phase else 363.15,'emergency':373.15}},
            'cores':[{'id':'core/one','conductor':{'material':'material/conductor','form':'solid_round',
                'nominal_area':pi*.005**2,'diameter':.01,'r20':10. if not three_phase else 1.7241e-8/(pi*.005**2),
                'r20_basis':'design'},'layers':layers}], 'common_layers':[]}],
        'circuits':[{'id':'circuit/one','label':'验证回路','system':{'kind':'ac_three_phase' if three_phase else 'ac_single_phase','frequency':50.},
            'cable_type':'cable_type/verification','cables':cables,
            'bonding':{'kind':'both_ends' if three_phase else 'single_point','source':source},
            **({'electrical_topology':{'phase_sequence':'ABC','reference_angle_rad':0.,'source':source}} if three_phase else {})}],
        'sections':[{'id':'section/one','label':'验证敷设截面','kind':'ground' if three_phase else 'air','length':300.,
            'medium':{'material':'material/soil','surface_temperature':293.15} if three_phase else {'air_temperature':293.15},
            'placements':[{'cable':cable['id'],'x':(index-1)*.08 if three_phase else 0.,'z':-.2 if three_phase else 0.} for index,cable in enumerate(cables)]}],
        'load_cases':[{'id':'load/one','kind':'steady' if three_phase else 'time_series','currents':{'circuit/one':100.} if three_phase else {},
            'profile':{} if three_phase else {'circuit/one':{'time':[0.,20.,40.,60.],'value':[1.,0.,1.,1.],'interpolation':'step','scale':'absolute'}},
            **({'duration':60.} if not three_phase else {})}],
        'criteria':{},'provenance':{'/verification':source}}
    return DomainDocument.model_validate(value).model_dump(mode='json')


def transient_parameters(value):
    ids=[c['id'] for circuit in value['circuits'] for c in circuit['cables']]
    return {'domain_options':{'section_id':'section/one','load_id':'load/one','bounds_m':None,
        'boundaries':{'surface':{'kind':'temperature','temperature_k':293.15,'h_w_m2_k':None,'emissivity':None}},
        'per_cable':{cid:{'electrical':{'ac_extra_factor':0.,'sheath_loss_factor':0.,'sheath_layer_uid':None,'source':'Explicit 1 A × 10 ohm/m = 10 W/m Bessel verification'},
            'fixed_layer_heat_w_m':{cid+'/conductor':0.},'prescribed_core_temperature_k':None,'equivalent_layers_acknowledged':False} for cid in ids},
        'duct_air':{},'source':'Homogeneous circular conductor with explicit uniform initial and boundary temperatures'},
        'time':{'initial_temperature_k':293.15,'step_s':.1,'steps':600,'bdf_order':1},
        'mesh':{'size_m':.00025,'far_size_m':.00025,'transition_m':.001,'max_nodes':20000,'minimum_circle_segments':64},
        'resistance_temperature_k':{cid:293.15 for cid in ids},'duct_air_capacity':{}}


def electromagnetic_parameters(value):
    return {'electromagnetic_options':{'section_id':'section/one','load_id':'load/one','bounds_m':[-.8,-.8,.8,0.],
        'background':{'conductivity_s_m':0.,'relative_permeability':1.,'source':'Explicit nonconducting unit-permeability finite exterior'},
        'material_states':{mid:{'temperature_k':293.15,'nonconducting':mid=='material/insulation','source':'Explicit 20 C material state'}
                           for mid in ('material/conductor','material/insulation','material/sheath')},
        'probes_m':[],'source':'Explicit synthetic field/network verification with saved phase and bonding sources'},
        'mesh':{'size_m':.0005,'far_size_m':.06,'transition_m':.04,'max_nodes':70000,'minimum_circle_segments':32,'field_order':2}}


def coupled_parameters(value):
    parameters=electromagnetic_parameters(value)
    parameters['mesh']['field_order']=1
    parameters.update(thermal_boundaries=[{'uid':'outer','selector':'outer','values':[],'kind':'temperature','value':293.15}],
        material_validity={mid:{'minimum_temperature_k':273.15,'maximum_temperature_k':373.15,'source':'Explicit bounded synthetic linear resistivity law'}
                           for mid in ('material/conductor','material/sheath')},
        initial_temperature_k=293.15,maximum_iterations=60,temperature_tolerance_k=1e-4,power_relative_tolerance=1e-6,relaxation=.7)
    return parameters
