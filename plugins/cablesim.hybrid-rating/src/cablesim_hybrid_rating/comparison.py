"""Engineering-readable standard/FEM comparison; never grants approval."""
from .features import digest


def present(payload, value, parameters):
    label=payload['hybrid'];base=label['baseline'];valid=payload['valid']
    uniform=base.get('kind')=='uniform_soil_counterfactual'
    rows=[{'id':'iec','name':'均匀土壤IEC对照' if uniform else 'IEC标准公式',
        'ampacity_a':base['ampacity_a'],'conductor_temperature_k':base['temperature_k'],
        'status':'counterfactual' if uniform else 'available','same_condition':not uniform,
        'ampacity_difference_percent':0.,'temperature_difference_k':0.},
        {'id':'fem','name':'电磁热耦合FEM' if payload['kind']=='electromagnetic-thermal' else '热传导FEM',
         'status':'available' if valid else 'nonconverged','same_condition':True,
         'ampacity_a':label['fem']['ampacity_a'] if valid else None,
         'conductor_temperature_k':label['fem']['temperature_k'] if valid else None,
         'ampacity_difference_percent':100*(label['fem']['ampacity_a']/base['ampacity_a']-1) if valid else None,
         'temperature_difference_k':label['fem']['temperature_k']-base['temperature_k'] if valid else None}]
    reference=label.get('layered_reference')
    if reference:
        available=reference['status']=='available';quantities=reference.get('baseline',{})
        rows.append({'id':'layered-reference','name':'两层土壤解析参照','status':reference['status'],
            'same_condition':True,'ampacity_a':quantities.get('ampacity_a'),
            'conductor_temperature_k':quantities.get('temperature_k'),
            'ampacity_difference_percent':100*(quantities['ampacity_a']/base['ampacity_a']-1) if available else None,
            'temperature_difference_k':quantities['temperature_k']-base['temperature_k'] if available else None,
            'reason':reference.get('reason')})
    actual={state['entity']:state for state in payload['operating']['cables']}
    losses=[{'entity':state['entity'],'circuit':state['circuit'],'current_a':state['current_a'],
        'iec_conductor_w_m':state['conductor_loss_w_m'],'iec_sheath_w_m':state['sheath_loss_w_m'],
        'fem_conductor_w_m':actual[state['entity']].get('conductor_joule_heat_w_m') if valid else None,
        'fem_sheath_w_m':actual[state['entity']].get('sheath_joule_heat_w_m') if valid else None}
        for state in label['iec'].get('operating_cable_states',[])]
    mesh=[{k:level[k] for k in ('mesh_scale','nodes','elements','mesh_sha256')}|
        {'ampacity_a':level['rating']['rating']['ampacity_a'],
         'maximum_temperature_k':max(c['conductor_max_temperature_k'] for c in level['operating']['cables']),
         'energy_relative_residual':max(level[condition]['energy_relative_residual'] for condition in ('operating','rating'))}
        for level in payload['mesh_history']]
    return {'schema_version':'cablesim.physics-comparison/1','valid':valid,'reason':payload['reason'],
        'methods':rows,'losses':losses,'mesh_history':mesh,'convergence':payload['convergence'],
        'input_sha256':payload['input_sha256'],'request_input_sha256':digest(value),
        'prepared_input_sha256':payload['prepared_input_sha256'],'parameters_sha256':digest(parameters),
        'raw_dataset_sha256':digest(payload),'solver':payload['solver'],'iec':label['iec'],
        'layered_reference':reference,'physics_scope':label['physics_scope'],'source':label['source'],
        'domain_boundary':{'fem_bounds_m':parameters['bounds_m'],'iec':'half-space analytical thermal model',
            'far_field_status':payload['convergence']['domain_status']},
        'bonding':[{c['id']:c['bonding']} for c in value['circuits']],
        'interpretation':'标准与数值研究的差值；不是已知真实误差。分层IEC对照不是实际分层标准结果。',
        'authority':'reference_only','engineering_approval':False}
