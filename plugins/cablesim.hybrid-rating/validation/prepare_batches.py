"""Prepare immutable LHS experiments; does not run any local solver.

The cable dimensions are declared system research structures, not certified
factory product records. All resulting datasets and models remain reference-only.
"""
from copy import deepcopy
from pathlib import Path
import argparse
import sys
from uuid import uuid4

ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT))
from backend.domain.migration import convert
from backend.schemas import Scenario
from backend.kernel.scenarios import system_models,METHOD_DEFAULTS,apply_layout
from backend.kernel.batch_runtime import create_plan
from backend.kernel.batch_files import digest,atomic
from backend.plugin_host.registry import Registry

SOURCE='参考项目书PDF第5–6页参数范围；本轮明确的同心光滑护套研究结构和水平三相设计假设；非厂家认证、非实测标签'


def base_case(family='direct_single'):
    document=convert(Scenario().model_dump())['document']
    model=next(m for m in system_models() if m['id']=='system.cu-xlpe-al-400')
    document['cable_types']=[deepcopy(model['payload']['cable_type'])]
    ids={m['id'] for m in model['payload']['materials']}
    document['materials']=[m for m in document['materials'] if m['id'] not in ids]+deepcopy(model['payload']['materials'])
    document['circuits'][0]['cable_type']=document['cable_types'][0]['id']
    document['circuits'][0]['bonding']['kind']='both_ends'
    document['load_cases'][0]['currents']={document['circuits'][0]['id']:250.}
    document=apply_layout(document,'double_flat' if family=='direct_double' else 'flat',depth=1.2,spacing=.09)
    for material in document['materials']:
        if material['id']=='material/cu':material['thermal_resistivity']=1/380.
    document['provenance']['/hybrid/research-structure']={'kind':'demo','reference':model['source']+'；铜热导率380 W/(m*K)为本数值研究显式假设，未作为IEC标准限值','reviewed':False}
    section=document['sections'][0]
    if family=='duct':
        document['materials'].append({'id':'material/duct','label':'PVC管材标准参考','category':'duct','thermal_resistivity':6.})
        section['enclosures']=[]
        for i,point in enumerate(section['placements']):
            point['x']=(i-1)*.12;uid='enclosure/hybrid-'+str(i)
            point['enclosure']=uid
            section['enclosures'].append({'id':uid,'type':'duct','x':point['x'],'z':point['z'],
                'material':'material/duct','inner_diameter':.064,'outer_diameter':.075,'contains':[point['cable']]})
        document['provenance']['/materials/material~1duct']={'kind':'standard','reference':'IEC60287-2-1:2023 Table1 PVC管6 K*m/W；管径为显式设计假设','reviewed':True}
    if family=='backfill':
        document['materials'].append({'id':'material/backfill','label':'设计回填区','category':'soil','thermal_resistivity':.8})
        section['backfill']={'id':'region/backfill','material':'material/backfill','x':0.,'z':-1.2,'width':1.2,'height':.6}
    if family=='layered_soil':
        document['materials'].append({'id':'material/lower-soil','label':'设计下层土壤','category':'soil','thermal_resistivity':1.5})
        section['soil_layers']=[{'id':'region/upper-soil','label':'上层土壤','material':section['medium']['material'],'top_z':0.,'bottom_z':-.8},
            {'id':'region/lower-soil','label':'下层土壤','material':'material/lower-soil','top_z':-.8,'bottom_z':-15.}]
    iec=deepcopy(METHOD_DEFAULTS['cablesim.iec60287'])
    if family=='direct_double':
        # This is a separately identified, supplied-loss thermal experiment.
        # Its coefficients are not presented as an electromagnetic calculation.
        iec['per_cable_losses']={q['cable']:{'ac_extra_factor':.04,'lambda1':.1} for q in section['placements']}
        iec['loss_input_source']='显式热修正研究边界：逐缆附加交流0.04、护套0.1恒定；非厂家或电磁测量；只对该参数化子模型有效'
    return {'case_id':'base','input':document,'parameters':{'iec':iec,
        'bounds_m':[-15.,-15.,15.,0.],
        'controls':{'operation':'ampacity','mesh_size_m':.0006,'far_mesh_size_m':.18,'mesh_transition_m':1.,'fine_mesh_band_m':.0015,
            'max_nodes':70000 if family=='direct_single' else 140000,'tolerance_k':1e-5,'max_iterations':100,'relaxation':.8,
            'current_upper_a':2000.,'current_tolerance_a':.02,'rated_circuit':document['circuits'][0]['id']},
        'dataset':{'mesh_scales':[1.5,1.,.75],'temperature_tolerance_k':.1,'ampacity_tolerance_a':.5},
        'source':SOURCE},'metadata':{'family':family,'structure_source':model['source']}}


def space(case,count,seed,extrapolation=False):
    d=case['input'];family=case['metadata']['family'];section=d['sections'][0]
    def binding(pointer,unit,**kwargs):return {'pointer':pointer,'target_unit':unit,**kwargs}
    def axis(name,unit,minimum,maximum,bindings):return {'name':name,'label':name,'unit':unit,'minimum':minimum,'maximum':maximum,'bindings':bindings,'source':SOURCE}
    depth=[binding('/input/sections/0/placements/'+str(i)+'/z','m',scale=-1) for i in range(len(section['placements']))]
    if section['backfill']:depth.append(binding('/input/sections/0/backfill/z','m',scale=-1))
    depth += [binding('/input/sections/0/enclosures/'+str(i)+'/z','m',scale=-1) for i in range(len(section['enclosures']))]
    soil=next(i for i,m in enumerate(d['materials']) if m['id']==section['medium']['material'])
    currents=list(d['load_cases'][0]['currents'])
    current_pointer='/input/load_cases/0/currents/'+currents[0].replace('~','~0').replace('/','~1')
    spacing=[]
    for i,point in enumerate(section['placements']):
        group=i//3;phase=i%3;offset=(group-.5)*.6 if family=='direct_double' else 0.
        spacing.append(binding('/input/sections/0/placements/'+str(i)+'/x','m',scale=phase-1,offset=offset))
    for i in range(len(section['enclosures'])):
        spacing.append(binding('/input/sections/0/enclosures/'+str(i)+'/x','m',scale=i-1))
    axes=[axis('depth_m','m',2.6 if extrapolation else .6,3.0 if extrapolation else 2.,depth),
        axis('soil_rho_k_m_w','K*m/W',.5,2.5,[binding('/input/materials/'+str(soil)+'/thermal_resistivity','K*m/W')]),
        axis('ambient_temperature_k','K',263.15,313.15,[binding('/input/sections/0/medium/surface_temperature','K')]),
        axis('spacing_m','m',.09 if family=='duct' else .065,.16 if family=='duct' else .12,spacing),
        axis('current_a','A',80.,260.,[binding(current_pointer,'A')]),
        {'name':'section','label':'导体截面','unit':'1','source':SOURCE,'choices':[
            {'label':str(area)+' mm2','changes':{'/input/cable_types/0/cores/0/conductor/nominal_area':area*1e-6,
                '/input/cable_types/0/cores/0/conductor/diameter':diameter,
                '/input/cable_types/0/cores/0/conductor/r20':r20}} for area,diameter,r20 in [(240,.0185,7.54e-5),(400,.025,4.7e-5)]]}]
    if len(currents)>1:
        axes.append(axis('neighbour_current_a','A',50.,180.,[binding('/input/load_cases/0/currents/'+currents[1].replace('~','~0').replace('/','~1'),'A')]))
    if section['backfill']:
        index=next(i for i,m in enumerate(d['materials']) if m['id']=='material/backfill')
        axes.append(axis('backfill_rho_k_m_w','K*m/W',.5,1.5,[binding('/input/materials/'+str(index)+'/thermal_resistivity','K*m/W')]))
    if section['soil_layers']:
        index=next(i for i,m in enumerate(d['materials']) if m['id']=='material/lower-soil')
        axes.append(axis('lower_soil_rho_k_m_w','K*m/W',.5,2.5,[binding('/input/materials/'+str(index)+'/thermal_resistivity','K*m/W')]))
        axes.append(axis('interface_depth_m','m',.4,1.4,[binding('/input/sections/0/soil_layers/0/bottom_z','m',scale=-1),binding('/input/sections/0/soil_layers/1/top_z','m',scale=-1)]))
    return {'sampling':'latin_hypercube','sample_count':count,'seed':seed,'axes':axes,'source':SOURCE}


def prepare(family,count,seed,extrapolation=False):
    case=base_case(family);plugin=Registry(ROOT/'plugins',plugin_id='cablesim.hybrid-rating').get('cablesim.hybrid-rating')
    identifier=str(uuid4());folder=ROOT/'.data/hybrid/datasets'/family/identifier
    method={'plugin_id':plugin.manifest.id,'capability':'training-sample','version':plugin.manifest.version,
            'release_digest':digest(plugin.manifest.model_dump(mode='json',by_alias=True))}
    plan=create_plan(folder,batch_id=identifier,base_case=case,method=method,
        source={'project_book_pages':'5–9','family':family,'split':'extrapolation' if extrapolation else 'in_domain','sampling_seed':seed},
        space=space(case,count,seed,extrapolation),execution={'backend':'slurm','workers':8,
            'sample_timeout_s':120,'slurm_parallelism':8,'slurm_wall_seconds':150,'slurm_memory_mb':8192,
            'slurm_cpus_per_task':4})
    return folder,plan


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--family',choices=['direct_single','direct_double','duct','backfill','layered_soil'],default='direct_single')
    parser.add_argument('--samples',type=int,default=5000);parser.add_argument('--seed',type=int,default=42)
    parser.add_argument('--extrapolation',action='store_true')
    args=parser.parse_args();folder,plan=prepare(args.family,args.samples,args.seed,args.extrapolation)
    print(str(folder));print('Samples: '+str(len(plan['samples'])))


if __name__=='__main__':main()
