"""Independent GetDP sheath-eddy audit of a controlled IEC 60287-1-2 example.

No tabulated IEC correction coefficient enters the field equation. Original
standard input and reference values remain in the ignored controlled directory.
"""
from argparse import ArgumentParser
from dataclasses import asdict
from hashlib import sha256
import json
from math import pi, cos, sin
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT))
sys.path.insert(0,str(ROOT/'plugins/cablesim.simulation/src'))
from backend.plugin_host import Executor
from cablesim_simulation.report import digest


def problem(example, source, *, exterior_m=4., material_basis='resistance', source_radius_m=.005):
    p=example['input'];s=p['spacing_m'];gap=p['separation_m']
    positions=[-gap/2-2*s,-gap/2-s,-gap/2,gap/2,gap/2+s,gap/2+2*s]
    outer=p['outer_m']/2;inner=outer-p['thickness_m']
    area=pi*(outer*outer-inner*inner)
    rho=p['rs']*area if material_basis=='resistance' else p['rho']
    nonmag=lambda sigma,label:{'conductivity_s_m':sigma,'relative_permeability':1.,'source':label}
    geometry=[{'uid':'air','kind':'rectangle','values':[-exterior_m,-exterior_m,exterior_m,exterior_m],
               'material':nonmag(0,'Nonmagnetic exterior; independent truncation convergence')}]
    excitations=[];current=1000.
    sequence=[0,-2*pi/3,2*pi/3]*2
    if p['direction']=='reverse':sequence[3:]=reversed(sequence[3:])
    for n,(x,phase) in enumerate(zip(positions,sequence),1):
        for suffix,radius,sigma in [('sheath',outer,1/rho),('inside',inner,0),('source',source_radius_m,0)]:
            geometry.append({'uid':f'position-{n}/{suffix}','kind':'disk','values':[x,0.,radius],
                             'material':nonmag(sigma,'Controlled IEC example; '+material_basis+' material branch' if suffix=='sheath' else 'Nonconducting space / prescribed uniform circular current source')})
        excitations.extend([
            {'regions':[f'position-{n}/sheath'],'kind':'current_rms_a','value':[0.,0.],'source':'IEC 1-2 scope: no net sheath circulating current'},
            {'regions':[f'position-{n}/source'],'kind':'impressed_current_rms_a','value':[current*cos(phase),current*sin(phase)],
             'source':'IEC phase currents; 1000 A RMS linear normalization, uniform impressed source has exact line-current exterior field'}])
    return {'schema_version':'cablesim.simulation-problem/1','physics':'magnetic_harmonic','geometry':geometry,
            'boundaries':[{'uid':'outer','selector':'outer','values':[],'kind':'magnetic_potential','value':0.}],
            'excitations':excitations,'frequency_hz':p['frequency'],'probes_m':[],
            'provenance':{'standard':source,'example':example['case'],'pdf_pages':example['pdf_pages'],
                          'material_basis':material_basis,'source_current_rms_a':current,'conductor_ac_resistance_ohm_m':p['rc'],
                          'sheath_resistivity_ohm_m':rho,'source_radius_m':source_radius_m},
            'assumptions':['The example specifies no conductor radius. A uniform impressed disk is the mathematical line-current regularization, not an invented solid conductor.',
                           'No source-domain eddy/proximity redistribution is added to the standard current idealization. Rc is used only for the I^2 Rc denominator.',
                           'A=0 finite exterior is tested separately; six sheaths have independent zero-net-current constraints.',
                           'Rs, dimensions and printed rho are overdetermined for a homogeneous sheath. Resistance-consistent and printed-rho branches are reported separately; no fitted input.']}


def main():
    parser=ArgumentParser();parser.add_argument('--source',type=Path,default=ROOT/'.data/iec60287/double-flat-examples.json')
    parser.add_argument('--limit',type=int);parser.add_argument('--resume',action='store_true');args=parser.parse_args()
    document=json.loads(args.source.read_text('utf-8'));example=next(c for c in document['cases'] if c['case'].endswith('8.3'))
    output=ROOT/'.data/iec60287/getdp-position2';output.mkdir(parents=True,exist_ok=True)
    plans=[('mesh-coarse',.003,4.,'resistance',.005),('mesh-medium',.002,4.,'resistance',.005),
           ('mesh-fine',.0015,4.,'resistance',.005),('domain-small',.0015,2.,'resistance',.005),
           ('domain-large',.0015,8.,'resistance',.005),('source-radius',.0015,4.,'resistance',.0025),
           ('printed-rho-medium',.002,4.,'printed_rho',.005),('printed-rho-fine',.0015,4.,'printed_rho',.005),
           ('domain-far',.0015,16.,'resistance',.005),('domain-final',.0015,32.,'resistance',.005),
           ('printed-rho-domain-final',.0015,32.,'printed_rho',.005)]
    jobs=ROOT/'.tmp/simulation-seventh-iec';jobs.mkdir(parents=True,exist_ok=True)
    executor=Executor(jobs_root=jobs);records=[]
    for name,h,extent,basis,radius in plans[:args.limit]:
        value=problem(example,document['source'],exterior_m=extent,material_basis=basis,source_radius_m=radius)
        controls={'size_m':h,'far_size_m':.04,'transition_m':.12,'max_nodes':120000,'field_order':2,
                  'minimum_circle_segments':256,'exterior_growth_start_m':.8,'exterior_growth_rate':.2}
        request={'case_id':name,'input':value,'parameters':{'mesh':controls}}
        path=output/(name+'.json');inp=output/(name+'-input.json')
        if args.resume and path.exists() and inp.exists() and json.loads(inp.read_text('utf-8'))==request:
            run=json.loads(path.read_text('utf-8'))
        else:
            inp.write_text(json.dumps(request,ensure_ascii=False,indent=2,allow_nan=False),'utf-8')
            run=asdict(executor.run('cablesim.simulation','getdp-eddy',[request]))
            path.write_text(json.dumps(run,ensure_ascii=False,separators=(',',':'),allow_nan=False),'utf-8')
        case=run['cases'][0]
        if case['status']!='succeeded':raise RuntimeError(case['error'])
        bundle=case['artifacts']['x-cablesim.simulation-bundle'];result=bundle['result']
        if bundle['evidence']['input_sha256']!=digest(value):raise ValueError('Saved input hash mismatch')
        values=[next(r for r in result['regions'] if r['entity']==f'position-{i}/sheath')['joule_loss_w_m']/(1000.**2*example['input']['rc']) for i in range(1,7)]
        record={'id':name,'mesh_size_m':h,'exterior_half_size_m':extent,'source_radius_m':radius,'material_basis':basis,
                'nodes':len(bundle['mesh']['points']),'elements':len(bundle['mesh']['triangles']),
                'lambda1_by_position':values,'position2':values[1],'run_id':run['run_id'],'plugin_version':run['plugin_version'],
                'input_sha256':bundle['evidence']['input_sha256'],'request_sha256':run['request_sha256'],
                'artifact_sha256':case['artifact_digests']['x-cablesim.simulation-bundle'],
                'saved_run_sha256':sha256(path.read_bytes()).hexdigest(),'solver':result['solver'],
                'max_net_sheath_current_a':max(r['current_rms_a'] for r in result['regions'])}
        records.append(record);print(json.dumps({k:record[k] for k in ('id','nodes','position2','max_net_sheath_current_a')}),flush=True)
        (output/'report.json').write_text(json.dumps({'schema':'cablesim.double-flat-getdp/1','source':document['source'],
            'source_file_sha256':sha256(args.source.read_bytes()).hexdigest(),'example':example,'runs':records,
            'scope':value['assumptions'],'predeclared_numerical_checks':{'last_mesh_relative_change':.002,'exterior_relative_change':.001},
            'status':'not_assessed','engineering_approval':False},ensure_ascii=False,indent=2,allow_nan=False),'utf-8')


if __name__=='__main__':main()
