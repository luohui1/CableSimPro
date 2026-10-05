"""Three-grid GetDP A-u / thermal labels with temperature-dependent losses.

This explicitly selected research model homogenizes a round stranded conductor
to a solid cylinder with exactly the saved R20. It is not a factory conductor
field model; the input and derived resistivity remain separately hashed.
"""
from copy import deepcopy
from pathlib import Path
from math import pi
import tempfile,time,os

from cablesim_simulation.domain_coupled import prepare
from cablesim_simulation.problem_mesh import build
from cablesim_simulation.electrothermal import solve
from .features import digest


def calculate(document, settings, prepared, iec):
    started=time.perf_counter();value=deepcopy(document)
    if value['sections'][0].get('soil_layers') or value['sections'][0].get('backfill') or value['sections'][0].get('enclosures'):
        raise ValueError('physics：电磁热标签本轮只覆盖直埋均匀土壤；复杂环境需完整领域翻译。')
    material={m['id']:m for m in value['materials']}
    core=value['cable_types'][0]['cores'][0];conductor=core['conductor']
    conductor['form']='solid_round'
    material[conductor['material']]['electrical_resistivity_20']=conductor['r20']*pi*conductor['diameter']**2/4
    used={conductor['material']}|{l['material'] for l in core['layers']+value['cable_types'][0]['common_layers']}
    for uid in used:material[uid]['relative_permeability']=1.
    source=settings.source+'; explicitly selected R20-preserving homogenized round conductor; nonmagnetic research materials'
    value['provenance']['/hybrid/electromagnetic-homogenization']={'kind':'user','reference':source,'reviewed':False}
    ambient=value['sections'][0]['medium']['surface_temperature']
    states={uid:{'temperature_k':ambient,'nonconducting':material[uid]['category'] not in ('conductor','metal'),
                 'source':source} for uid in used}
    conducting=[uid for uid,state in states.items() if not state['nonconducting']]
    bc=[{'uid':'thermal-outer','selector':'outer','values':[],'kind':'temperature','value':ambient}]
    wd={}
    for state in iec['operating']['cable_states']:
        for index in (0,2):wd[state['entity']+'/layer-'+str(index)]=state['dielectric_loss_w_m']/2
    options={'electromagnetic_options':{'section_id':value['sections'][0]['id'],'load_id':value['load_cases'][0]['id'],
        'bounds_m':settings.bounds_m,'background':{'conductivity_s_m':0.,'relative_permeability':1.,
        'k_w_m_k':1/material[value['sections'][0]['medium']['material']]['thermal_resistivity'],'source':source},
        'material_states':states,'probes_m':[],'source':source},
        'mesh':settings.electromagnetic_mesh,'thermal_boundaries':bc,
        'material_validity':{uid:{'minimum_temperature_k':253.15,'maximum_temperature_k':423.15,'source':source+'; explicit research validity interval'} for uid in conducting},
        'initial_temperature_k':ambient,'temperature_tolerance_k':1e-5,'power_relative_tolerance':1e-7,
        'maximum_iterations':80,'relaxation':.8,'fixed_heat_w_m_by_region':wd}
    if options['mesh'] is None:raise ValueError('electromagnetic_mesh：电磁热标签须明确网格与节点上限。')
    base,mesh_controls=prepare(value,options)
    circuit=settings.controls['rated_circuit'];ids={c['id'] for c in value['circuits'] if c['id']==circuit}
    conductor_uids={c['id']+'/conductor' for row in value['circuits'] if row['id'] in ids for c in row['cables']}
    limits={c['id']+'/conductor':value['criteria'].get('max_conductor_temperature',value['cable_types'][0]['rating']['max_conductor_temperature']['normal']) for row in value['circuits'] for c in row['cables']}
    levels=[]
    with tempfile.TemporaryDirectory(prefix='hybrid-coupled-') as scratch:
        for scale in settings.dataset.get('mesh_scales',[1.5,1.,.75]):
            controls=mesh_controls.model_copy(update={'size_m':mesh_controls.size_m*scale,
                'far_size_m':mesh_controls.far_size_m*scale})
            mesh=build(base.magnetic,controls);trials=[]
            def trial(current):
                problem=base.model_dump(mode='json')
                old=max(next(c['current'] for c in prepared.cables if c['circuit']==circuit),1e-12)
                for excitation in problem['magnetic']['excitations']:
                    if set(excitation['regions'])<=conductor_uids:
                        excitation['value']=[v*current/old for v in excitation['value']]
                model=type(base).model_validate(problem)
                result=solve(model,mesh,Path(scratch)/str(scale)/str(len(trials)))
                temperatures={row['entity']:row['maximum_nodal_temperature_k'] for row in result['region_temperatures']}
                excess=max(temperatures[uid]-limit for uid,limit in limits.items())
                energy=result['iterations'][-1]['energy_relative_residual']
                if (energy is None and result['iterations'][-1]['energy_absolute_residual_w_m']>1e-12) or (energy is not None and energy>1e-6):
                    raise ValueError(f'energy：电热标签能量残差 {energy}，须不超过1e-6。')
                trials.append({'current_a':current,'excess_k':excess,'energy_relative_residual':energy,
                    'source_heat_w_m':result['source_heat_w_m'],'iterations':len(result['iterations']),
                    'input_sha256':result['input_sha256']})
                return result,excess
            operating,_=trial(next(c['current'] for c in prepared.cables if c['circuit']==circuit))
            low=0.;safe,elo=trial(low)
            if elo>=0:raise ValueError('rating：其他负荷已超温，无正额定电流。')
            high=min(settings.controls['current_upper_a'],next(r['ampacity_a'] for r in iec['circuit_ratings'] if r['entity']==circuit)*1.08)
            upper,ehi=trial(high)
            while ehi<0 and high<settings.controls['current_upper_a']:
                low,safe,elo=high,upper,ehi;high=min(high*1.2,settings.controls['current_upper_a']);upper,ehi=trial(high)
            if ehi<0:raise ValueError('rating：明确电流上限未夹住温限。')
            for _ in range(45):
                middle=low+(high-low)*max(.1,min(.9,-elo/(ehi-elo)))
                result,excess=trial(middle)
                if excess<=0:low,safe,elo=middle,result,excess
                else:high,ehi=middle,excess
                if high-low<=.05 and abs(elo)<=.02:break
            else:raise ValueError('rating：电流/温限联合门禁未收敛。')
            def summary(result):
                by={q['entity']:q for q in result['region_temperatures']}
                magnetic={k:result['magnetic'][k] for k in ('solver','execution','mesh_sha256','problem_sha256',
                    'regions','magnetic_losses','current_constraint_errors','phasor_convention')}
                magnetic['field_sha256']=digest(result['magnetic'])
                return {'cables':[{'entity':c['id'],'circuit':c['circuit'],
                    'conductor_max_temperature_k':by[c['id']+'/conductor']['maximum_nodal_temperature_k'],
                    'conductor_joule_heat_w_m':sum(q['joule_loss_w_m'] for q in magnetic['regions'] if q['entity']==c['id']+'/conductor'),
                    'sheath_joule_heat_w_m':sum(q['joule_loss_w_m'] for q in magnetic['regions'] if q['entity'].startswith(c['id']+'/layer-'))} for c in prepared.cables],
                    'energy_relative_residual':result['iterations'][-1]['energy_relative_residual'],
                    'source_heat_w_m':result['source_heat_w_m'],'magnetic':magnetic,
                    'iterations':result['iterations']}
            rating=summary(safe);rating['rating']={'circuit':circuit,'ampacity_a':low,'upper_bracket_a':high,'trace':trials}
            levels.append({'mesh_scale':scale,'nodes':len(mesh['points']),'elements':len(mesh['triangles']),
                'mesh_sha256':mesh['sha256'],'operating':summary(operating),'rating':rating})
    previous,last=levels[-2:]
    delta=max(abs(a['conductor_max_temperature_k']-b['conductor_max_temperature_k']) for condition in ('operating','rating')
        for a,b in zip(previous[condition]['cables'],last[condition]['cables']))
    change=abs(last['rating']['rating']['ampacity_a']-previous['rating']['rating']['ampacity_a'])
    valid=delta<=.1 and change<=.5
    return {'schema_version':'cablesim.dataset-sample/1','kind':'electromagnetic-thermal',
        'input_sha256':digest(document),'prepared_input_sha256':digest({'input':value,'options':options}),
        'valid':valid,'status':'succeeded' if valid else 'nonconverged',
        'reason':None if valid else {'code':'MESH_NOT_CONVERGED','message':'电热标签三网格门禁未通过；原输入和结果保留。'},
        'solver':{'name':'GetDP A-u / scikit-fem P1','slurm_job_id':os.environ.get('SLURM_JOB_ID')},
        'mesh':{k:last[k] for k in ('nodes','elements','mesh_sha256')},'mesh_history':levels,
        'convergence':{'solver_status':'converged','mesh_status':'converged' if valid else 'nonconverged',
            'maximum_temperature_change_k':delta,'ampacity_change_a':change,'domain_status':'not_assessed',
            'energy_relative_residual':max(last[c]['energy_relative_residual'] for c in ('operating','rating'))},
        'operating':last['operating'],'rating':last['rating'],'wall_seconds':time.perf_counter()-started,
        'authority':'reference_only','engineering_approval':False,'assumptions':[source]}
