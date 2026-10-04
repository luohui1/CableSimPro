"""Reproducible four-physics, three-mesh performance protocol.

Fresh batch plans and measured process-tree memory are used for every backend.
COMSOL retains its native curved P2 discretization; open heat uses linear P1.
Equal inputs are checked by case hashes, not by assuming equal native meshes.
"""
import argparse
from copy import deepcopy
from math import log,pi
from pathlib import Path
import sys,time
from uuid import uuid4
ROOT=Path(__file__).resolve().parents[3];sys.path[:0]=[str(ROOT),str(Path(__file__).parent)]
from batch_demo import baseline
from backend.kernel.batch_files import atomic,read,digest
from backend.kernel.batch_runtime import create_plan,export_dataset,rows
from backend.kernel.batch_slurm import SlurmBackend
from backend.plugin_host.registry import Registry
from backend.foundation.simulation import validate
from backend.kernel.batch_inputs import materialize


def heat(duct):
    model=baseline()['input'];cables=model['cables'] if duct else model['cables'][:3]
    if not duct:
        for i,c in enumerate(cables):c.update(x_m=(i-1)*.15,z_m=-1.,duct=None)
    source='Explicit fixed 10 W/m per conductor performance case; synthetic 10 kV geometry, not current-rating labels'
    geometry=[{'uid':'soil','kind':'rectangle','values':[-6.,-6.,6.,0.],'material':{'k_w_m_k':1.,'source':source}}]
    for c in cables:
        if c['duct']:
            d=c['duct'];outer=c['layers'][-1]['outer_radius_m']
            for uid,r,k in [(d['uid']+'/wall',d['outer_radius_m'],d['k_w_m_k']),
                (d['uid']+'/air',d['inner_radius_m'],log(d['inner_radius_m']/outer)/(2*pi*d['air_resistance_k_m_w']))]:
                geometry.append({'uid':uid,'kind':'disk','values':[c['x_m'],c['z_m'],r],'material':{'k_w_m_k':k,'source':source}})
        for layer in reversed(c['layers']):
            geometry.append({'uid':layer['uid'],'kind':'disk','values':[c['x_m'],c['z_m'],layer['outer_radius_m']],
                             'material':{'k_w_m_k':layer['k_w_m_k'],'source':source}})
    return {'case_id':'heat','input':{'schema_version':'cablesim.simulation-problem/1','physics':'steady_heat',
        'geometry':geometry,'boundaries':[{'uid':'outer','selector':'outer','values':[],'kind':'temperature','value':293.15}],
        'excitations':[{'regions':[c['layers'][0]['uid']],'kind':'heat_w_m','value':[10.],'source':source} for c in cables],
        'probes_m':[[c['x_m'],c['z_m']] for c in cables],'provenance':{'all':{'source':source}},
        'assumptions':[source,'Infinite 2D section; constant properties; prescribed duct equivalent resistance 0.7 K m/W, no convection CFD.']},
        'parameters':{'mesh':{'size_m':.004,'far_size_m':.25,'transition_m':.3,'max_nodes':120000}}}


def cases():
    eddy=read(ROOT/'plugins/cablesim.simulation/src/cases/eddy-lunca.json')
    eddy={'case_id':'sheath','input':eddy['input'],'parameters':deepcopy(eddy['parameters'])}
    eddy['parameters']['mesh'].update(field_order=2,minimum_circle_segments=8,max_nodes=120000)
    for key in ('probe_cell_size_m','exterior_growth_start_m','exterior_growth_rate'):eddy['parameters']['mesh'].pop(key,None)
    transient=read(ROOT/'plugins/cablesim.simulation/src/cases/heat-step-cycle.json')
    transient={'case_id':'step','input':transient['input'],'parameters':transient['parameters']}
    transient['input']['excitations'][0]['schedule']=[[0,1]]
    return [('buried',heat(False),'elmer-heat','thermal-reference',[.004,.002,.001]),
            ('ducts',heat(True),'elmer-heat','thermal-reference',[.004,.003,.002]),
            ('sheath',eddy,'getdp-eddy','magnetic-reference',[.002,.001,.0005]),
            ('step',transient,'elmer-heat','thermal-reference',[.002,.001,.0005])]


def prepare(backend,output):
    index=output/(backend+'-plans.json')
    if index.exists():return read(index)
    pid='cablesim.comsol-bridge' if backend=='comsol' else 'cablesim.simulation'
    plugin=Registry(ROOT/'plugins',plugin_id=pid).get(pid)
    manifest=plugin.manifest.model_dump(mode='json',by_alias=True);plans=[]
    for name,case,opened,commercial,sizes in cases():
        choices=[]
        for size in sizes:
            changes={'/parameters/mesh/size_m':size}
            if name=='step':changes['/parameters/mesh/far_size_m']=size
            choices.append({'label':str(size)+' m','changes':changes})
        space={'sampling':'grid','sample_count':3,'source':'Predeclared common three-grid solver performance protocol',
            'axes':[{'name':'mesh','label':'网格','unit':'1','source':'Three explicit target sizes; native cell counts recorded separately','choices':choices}]}
        for sampled in materialize(case,space):validate(sampled['case']['input'],sampled['case']['parameters']['mesh'])
        method={'plugin_id':pid,'version':plugin.manifest.version,'release_digest':digest(manifest),
                'capability':commercial if backend=='comsol' else opened}
        identifier=str(uuid4());directory=output/backend/name/identifier
        create_plan(directory,batch_id=identifier,base_case=case,method=method,
            source={'description':'Synthetic fixed-source/explicit literature performance inputs; reference_only',
                    'benchmark':name,'case_input_sha256':digest(case['input'])},space=space,
            execution={'backend':'slurm','workers':1,'sample_timeout_s':1200,'slurm_wall_seconds':1260,'slurm_parallelism':1,
                       'slurm_memory_mb':4096 if backend=='comsol' else 2048})
        plans.append({'name':name,'directory':str(directory)})
    atomic(index,plans);return plans


def main():
    parser=argparse.ArgumentParser();parser.add_argument('backend',choices=['slurm','comsol']);args=parser.parse_args()
    output=ROOT/'.data/simulation/performance/solvers';output.mkdir(parents=True,exist_ok=True)
    profile=read(ROOT/'.data/hpc/config.json');profile['maximum_pending_tasks']=1
    remote=SlurmBackend(profile,ROOT/'.data/hpc/budget.sqlite')
    for item in prepare(args.backend,output):
        directory=Path(item['directory'])
        submission=remote.submit(directory,range(3))
        if not submission.get('job_id'):raise RuntimeError(submission)
        print(item['name'],submission['job_id'],flush=True)
        while True:
            accounting=remote.poll(directory,submission['token'])
            if accounting.get('terminal'):break
            time.sleep(20)
        remote.collect(directory,submission['token'])
        export_dataset(directory)
        print(item['name'],[(r['status'],r.get('wall_seconds'),r.get('error')) for r in rows(directory)],flush=True)


if __name__=='__main__':main()
