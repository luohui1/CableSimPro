"""Replay a real six-axis GetDP table and its IEC variable-temperature rating."""
from copy import deepcopy
from dataclasses import asdict
from hashlib import sha256
import json
from math import pi
from pathlib import Path
import shutil
import sys

ROOT=Path(__file__).resolve().parents[3]
sys.path[:0]=[str(ROOT),str(ROOT/'plugins/cablesim.simulation/src'),str(ROOT/'plugins/cablesim.iec60287/src')]
from backend.plugin_host import Executor
from backend.workbench import fingerprint
from cablesim_simulation.problem_domain import electromagnetic
from design.workbench.scenarios import METHOD_DEFAULTS


def main():
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--consume-only',action='store_true');args=parser.parse_args()
    output=ROOT/'.data/simulation/loss-temperature';output.mkdir(parents=True,exist_ok=True)
    jobs=ROOT/'.tmp/simulation-sixth-loss';jobs.mkdir(parents=True,exist_ok=True)
    domain=json.loads((ROOT/'plugins/cablesim.simulation/src/cases/thermal-iec.json').read_text('utf-8'))
    conductor=domain['cable_types'][0]['cores'][0]['conductor']
    conductor['form']='solid_round';conductor['nominal_area']=pi*(conductor['diameter']/2)**2
    conductor['r20']=1.7241e-8/conductor['nominal_area']
    for layer in domain['cable_types'][0]['cores'][0]['layers']:layer['form']='smooth'
    for mat in domain['materials']:mat['relative_permeability']=1
    circuit=domain['circuits'][0]
    circuit['electrical_topology']={'phase_sequence':'ABC','reference_angle_rad':0.,'source':{'kind':'demo','reference':'Explicit balanced phase benchmark'}}
    circuit['bonding']['source']={'kind':'demo','reference':'Explicit ideal both-end bonded screen group'}
    options={'section_id':'section/ground','load_id':'load/steady','bounds_m':[-2,-3,2,1],
        'background':{'conductivity_s_m':0,'relative_permeability':1,'source':'Explicit nonconducting benchmark exterior'},
        'material_states':{'material/'+u:{'temperature_k':293.15,'nonconducting':u not in ('cu','sheath'),'source':'Synthetic benchmark material state at20C'} for u in ['cu','semicon','xlpe','sheath','pvc']},
        'phase_degrees':{'cable/A':0,'cable/B':-120,'cable/C':120},
        'bonded_layers':[['cable/'+p+'/layer-3' for p in 'ABC']], 'probes_m':[], 'source':'Synthetic common-domain loss/IEC coupling regression'}
    problem=electromagnetic(domain,options)
    axes=[];laws={};bindings=[]
    for phase in 'ABC':
        entity='cable/'+phase
        bindings.append({'entity':entity,'conductor_regions':[entity+'/conductor'],'sheath_regions':[entity+'/layer-3'],'armor_regions':[]})
        for state,suffix in [('conductor_temperature_c','conductor'),('sheath_temperature_c','layer-3')]:
            uid=entity+'/'+suffix
            axes.append({'entity':entity,'state':state,'regions':[uid],
                         'values_c':[20.,140/3,220/3,100.] if suffix=='conductor' else [20.,60.,100.]})
            laws[uid]={'reference_temperature_k':293.15,'alpha_per_k':.00393,'minimum_temperature_k':293.15,'maximum_temperature_k':373.15,'source':'Same saved-domain copper alpha20=0.00393/K'}
    export={'bindings':bindings,'source_domain_sha256':fingerprint(domain),
        'topology':{'constraints':[{k:e[k] for k in ('regions','kind','connection','value')} for e in problem['excitations']],
                    'circuits':{c['id']:{'electrical_topology':c.get('electrical_topology'),'bonding':c['bonding']} for c in domain['circuits']}},
        'material_temperatures_k':{uid:293.15 for uid in laws},'source':'Six independent metal temperatures; synthetic solid-copper cable fixture, not a paper',
        'temperature_table':{'axes':axes,'resistivity_laws':laws,'current_scale_range':[0.,4.], 'maximum_validation_absolute_error':.003}}
    params={'mesh':{'size_m':.002,'far_size_m':.25,'transition_m':.8,'minimum_circle_segments':96,'max_nodes':60000},
            'electromagnetic_options':options,'loss_export':export}
    payload={'domain':domain,'parameters':params}
    if args.consume_only:
        if json.loads((output/'input.json').read_text('utf-8'))!=payload:raise ValueError('Saved producer input differs; regenerate the table')
    else:(output/'input.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2),'utf-8')
    executor=Executor(jobs_root=jobs)
    try:
        if args.consume_only:data=json.loads((output/'getdp.json').read_text('utf-8'))
        else:
            run=executor.run('cablesim.simulation','getdp-eddy',[{'case_id':'temperature-table','input':domain,'parameters':params}]);data=asdict(run)
            (output/'getdp.json').write_text(json.dumps(data,ensure_ascii=False,allow_nan=False,separators=(',',':')),'utf-8')
        case=data['cases'][0]
        if case['status']!='succeeded':raise RuntimeError(case['error'])
        artifact=deepcopy(case['artifacts']['x-cablesim.loss-coefficients'])
        raw=json.dumps(artifact,ensure_ascii=False,allow_nan=False,separators=(',',':')).encode('utf-8')
        if sha256(raw).hexdigest()!=case['artifact_digests']['x-cablesim.loss-coefficients']:raise ValueError('Saved producer artifact hash mismatch')
        artifact['resolved_source']={'run_id':data['run_id'],'case_id':case['case_id'],'artifact_sha256':case['artifact_digests']['x-cablesim.loss-coefficients'],
            'source':'Local validation harness forwarding a sealed producer artifact; not an engineer-approved study'}
        p=deepcopy(METHOD_DEFAULTS['cablesim.iec60287']);p['external_loss_artifact']=artifact
        rated=executor.run('cablesim.iec60287','steady-rating',[{'case_id':'rating','input':domain,'parameters':p}])
        (output/'iec.json').write_text(json.dumps(asdict(rated),ensure_ascii=False,allow_nan=False,separators=(',',':')),'utf-8')
        if rated.cases[0].status!='succeeded':raise RuntimeError(rated.cases[0].error)
        print(json.dumps({'table_nodes':len(artifact['temperature_table']['rows']), 'validation_points':len(artifact['temperature_table']['validation_points']),
                          'error':artifact['temperature_table']['error'],'iec_results':rated.cases[0].results},ensure_ascii=False),flush=True)
    finally:
        shutil.rmtree(jobs,ignore_errors=True)


if __name__=='__main__':main()
