"""Fixed-temperature electrical coefficient comparison; calls existing IEC code."""
from copy import deepcopy
from dataclasses import asdict,replace
from hashlib import sha256
import json
from math import pi
from pathlib import Path
import sys
from types import SimpleNamespace as NS
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT))
sys.path.insert(0,str(ROOT/'plugins/cablesim.simulation/src'))
from backend.plugin_host import Executor
from backend.plugin_host.registry import Registry
from cablesim_simulation.report import digest


def coefficients():
    plugin=Registry(plugin_id='cablesim.iec60287').get('cablesim.iec60287')
    plugin.verify()
    sys.path.insert(0,str(ROOT/'plugins/cablesim.iec60287/src'))
    from cablesim_iec60287.method import geometry,electrical
    from cablesim_iec60287.group import _loss_factors
    thickness=25e-6/(2*pi*.0148)
    # Only the existing plugin's electrical coefficient functions are called.
    # Zero voltage is an explicit coefficient probe: no dielectric/thermal
    # rating is computed and no missing thermal properties are fabricated.
    r=NS(frequency_hz=50,max_conductor_temperature_c=90,phase_voltage_v=0,
         conductor=NS(diameter_m=.0142,r20_ohm_m=1/(35.38e6*pi*.0071**2),alpha20_per_k=.00403,ks=1.,kp=1.),
         insulation=NS(inner_screen_thickness_m=0,thickness_m=.0148-thickness/2-.0071,
                       outer_screen_thickness_m=0,relative_permittivity=2.5,tan_delta=0),
         sheath=NS(thickness_m=thickness,resistivity20_ohm_m=1/58e6,alpha20_per_k=.00393),
         oversheath=NS(thickness_m=.018-(.0148+thickness/2)),installation=NS(duct=None),bonding=NS(scheme='both_ends',eddy='ignored'))
    g=replace(geometry(r),axis_spacing_m=.106)
    e=electrical(r,g)
    # IEC helper convention uses decreasing A/B/C angles. Map the actual E05
    # (-120,0,+120) positions to B,A,C, retaining physical cable IDs A/B/C.
    cables=[{'id':label,'phase':phase,'point':(x,-.8),'rating':r,'geometry':g,'factors':None}
            for label,phase,x in zip('ABC',['B','A','C'],[-.106,0,.106])]
    group=NS(cables=cables,soil={},parameters={},circuits=[{'indices':[0,1,2],'spacing':.106,'automatic':True,
             'arrangement':'flat','transposed':False,'phase_sequence':'ABC','bonding':{'kind':'both_ends'}}])
    losses=_loss_factors(group,[e.r_ac_max_ohm_m]*3,[80.]*3)
    return {'ys':e.skin_ys,'yp':e.proximity_yp,'r_dc_ohm_m':e.r_dc_max_ohm_m,'r_ac_ohm_m':e.r_ac_max_ohm_m,
            'lambda1_circulating':dict(zip('ABC',losses)),
            'plugin_id':plugin.manifest.id,'plugin_version':plugin.manifest.version,
            'manifest_sha256':sha256((ROOT/'plugins/cablesim.iec60287/plugin.json').read_bytes()).hexdigest(),
            'functions':['cablesim_iec60287.method.geometry','cablesim_iec60287.method.electrical','cablesim_iec60287.group._loss_factors'],
            'basis':'Fixed90C conductor/80C shield; same solid equivalent sigma and geometry as FEM; ks=kp=1; coefficient probe only, not an IEC thermal rating run.',
            'phase_mapping':{'physical_A':'IEC_B(-120)','physical_B':'IEC_A(0)','physical_C':'IEC_C(+120)'},
            'dielectric_scope':'U0=0 and tan_delta=0 are explicit coefficient-probe settings; no dielectric loss result is used.'}


def canonical_rows(rows,iec):
    canonical=[]
    for phase in rows:
        for name,computed,expected,comparable in [
            ('ys',phase['ys_fem'],phase['ys_iec'],True),
            ('yp_bare',phase['yp_bare_fem'],phase['yp_iec'],True),
            ('lambda1_circulating',phase['lambda1_circulating_fem'],phase['lambda1_iec_circulating'],True),
            ('lambda1_total_vs_circulating',phase['lambda1_total_fem'],phase['lambda1_iec_circulating'],False)]:
            delta=computed-expected
            canonical.append({'id':phase['entity']+'-'+name,'quantity':name,'entity':phase['entity'],'unit':'1',
                              'reference':expected,'calculated':computed,'difference':delta,'absolute_difference':abs(delta),
                              'relative_difference':delta/abs(expected) if expected else None,'tolerance':None,
                              'source':{'plugin':iec['plugin_id'],'version':iec['plugin_version'],'functions':iec['functions']},
                              'status':'not_assessed' if comparable else 'not_comparable',
                              'reason':'No predeclared acceptance tolerance; compare model differences.' if comparable else 'FEM total includes local eddies; IEC flat branch is circulating only.'})
    return canonical


def main():
    fixture=json.loads((ROOT/'plugins/cablesim.simulation/src/cases/eddy-lunca.json').read_text('utf-8'))
    output=ROOT/'.data/simulation/eddy-iec';output.mkdir(parents=True,exist_ok=True)
    jobs=ROOT/'.tmp/simulation-external-iec';jobs.mkdir(parents=True,exist_ok=True)
    executor=Executor(jobs_root=jobs)
    full_run=executor.run('cablesim.simulation','getdp-eddy',[{'case_id':'full','input':fixture['input'],'parameters':fixture['parameters']}])
    if full_run.cases[0].status!='succeeded':raise RuntimeError(full_run.cases[0].error)
    full=full_run.cases[0].artifacts['x-cablesim.simulation-bundle']['result']
    (output/'full.json').write_text(json.dumps(asdict(full_run),ensure_ascii=False,allow_nan=False,separators=(',',':')),'utf-8')
    studies={}
    for name,cores in [('isolated',['B/core']),('bare',['A/core','B/core','C/core'])]:
        p=deepcopy(fixture['input'])
        for r in p['geometry']:
            if r['uid'] not in cores:r['material']['conductivity_s_m']=0
        p['excitations']=[e for e in p['excitations'] if len(e['regions'])==1 and e['regions'][0] in cores]
        p['probes_m']=[]
        p['assumptions'].append('Control experiment '+name+': all regions other than selected cores are explicitly nonconducting.')
        parameters=deepcopy(fixture['parameters']);parameters['mesh']['size_m']=.00025
        stored=output/(name+'.json')
        if '--reuse-controls' in sys.argv and stored.is_file():
            saved=json.loads(stored.read_text('utf-8'))
            bundle=saved['cases'][0]['artifacts']['x-cablesim.simulation-bundle']
            if bundle['evidence']['input_sha256']!=digest(p):
                raise ValueError('保存的控制试验与当前输入不一致。')
            studies[name]=bundle['result']
            print('Reused matching saved control: '+saved['run_id'],flush=True)
            continue
        run=executor.run('cablesim.simulation','getdp-eddy',[{'case_id':name,'input':p,'parameters':parameters}])
        if run.cases[0].status!='succeeded':raise RuntimeError(run.cases[0].error)
        studies[name]=run.cases[0].artifacts['x-cablesim.simulation-bundle']['result']
        (output/(name+'.json')).write_text(json.dumps(asdict(run),ensure_ascii=False,allow_nan=False,separators=(',',':')),'utf-8')
        print('GetDP control completed: '+name,flush=True)
    isolated=studies['isolated']['regions'][0]
    ys=isolated['ac_resistance_ohm_m']/isolated['dc_resistance_ohm_m']-1
    bare={r['entity']:r for r in studies['bare']['regions']}
    states={r['entity']:r for r in full['regions']}
    iec=coefficients()
    rows=[]
    for label in 'ABC':
        b=bare[label+'/core'];c=states[label+'/core'];s=states[label+'/sheath']
        yp=b['ac_resistance_ohm_m']/b['dc_resistance_ohm_m']-1-ys
        circulating=s['current_rms_a']**2*s['dc_resistance_ohm_m']/c['joule_loss_w_m']
        total=s['joule_loss_w_m']/c['joule_loss_w_m']
        rows.append({'entity':label,'ys_fem':ys,'ys_iec':iec['ys'],'yp_bare_fem':yp,'yp_iec':iec['yp'],
                     'lambda1_total_fem':total,'lambda1_circulating_fem':circulating,
                     'lambda1_iec_circulating':iec['lambda1_circulating'][label],
                     'lambda1_eddy_residual_fem':total-circulating,
                     'yp_with_shields_effective':c['ac_resistance_ohm_m']/c['dc_resistance_ohm_m']-1-ys})
    canonical=canonical_rows(rows,iec)
    report={'schema':'cablesim.reproduction-report/1','kind':'case','reference':{'id':'E05-IEC-coefficients','kind':'crosscheck'},
            'scope':'IEC plugin electrical functions at matching fixed temperatures; ys isolated-core control, yp bare-three-core control, lambda full bonded FEM.',
            'status':'not_assessed','rows':canonical,'comparisons':rows,'iec':iec,'fem_solver':full['solver'],
            'fem_run':{'run_id':full_run.run_id,'plugin_version':full_run.plugin_version,'request_sha256':full_run.request_sha256,
                       'artifact_sha256':full_run.cases[0].artifact_digests['x-cablesim.simulation-bundle']},'engineering_approval':False,
            'limitations':['IEC flat lambda branch returns circulating losses only; FEM includes local shield eddies.',
                           'IEC yp is a shared approximate circuit coefficient; local phase FEM proximity and shield reaction need not coincide.',
                           'FEM geometry-DC resistance uses actual polygon area; compare small ratios independently of area-discretization bias.',
                           'IEC low-level functions called from installed sealed plugin because public steady-rating always iterates temperatures; this is not a new IEC host capability.']}
    (output/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2,allow_nan=False),'utf-8')
    print(json.dumps({'rows':rows,'iec_version':iec['plugin_version']},ensure_ascii=False))
    if not any(jobs.iterdir()):jobs.rmdir()


if __name__=='__main__':main()
