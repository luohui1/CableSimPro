"""Replay coupled and capacitive production methods via the immutable host."""
from pathlib import Path
from copy import deepcopy
import argparse,json,math,sys,shutil
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT))
from backend.plugin_host import Executor


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--physics',choices=['electrothermal','capacitive'],required=True)
    parser.add_argument('--solver',choices=['open','comsol'],default='open')
    args=parser.parse_args()
    if args.physics=='capacitive' and args.solver!='open':raise ValueError('Use COMSOL compare_capacitive.py for the installed native tutorial reference.')
    root=ROOT/'.data/simulation'/args.physics;root.mkdir(parents=True,exist_ok=True)
    work=ROOT/'.tmp/simulation-coupling-replay';work.mkdir(parents=True,exist_ok=True)
    executor=Executor(jobs_root=work);summary=[]
    if args.physics=='electrothermal':
        fixture=json.loads((ROOT/'plugins/cablesim.simulation/src/cases/electrothermal-coaxial.json').read_text('utf-8'))
        runs=[('rated',655,1.),('rated-fine',655,.5),('hot',1800,.5)] if args.solver=='open' else [('rated',655,.5),('hot',1800,.5)]
        configs=[]
        for label,current,scale in runs:
            d=deepcopy(fixture);d['input']['magnetic']['excitations'][0]['value']=[current,0]
            d['parameters']['mesh']['size_m']*=scale;d['parameters']['mesh']['far_size_m']*=scale
            if args.solver=='comsol':d['parameters']['mesh']['minimum_circle_segments']=8
            configs.append((label,d['input'],d['parameters']))
        plugin='cablesim.simulation' if args.solver=='open' else 'cablesim.comsol-bridge'
        capability='electrothermal' if args.solver=='open' else 'electrothermal-reference'
    else:
        fixture=json.loads((ROOT/'plugins/cablesim.simulation/src/cases/capacitive-submarine.json').read_text('utf-8'));configs=[]
        for count in [12,24,48]:
            for bonding in ['single_point','both_ends','cross_bonded','radial_ground']:
                d=deepcopy(fixture);v=d['input'];v['bonding']=bonding
                if bonding=='cross_bonded':v.update(section_fractions=[1/3]*3,section_phase_rad=[0,-2*math.pi/3,2*math.pi/3])
                if bonding=='radial_ground':
                    v.update(length_m=1,axial_coordinate_scale=100,axial_voltage_drop_peak_v_m=0)
                    v['layers'][-1].update(conductivity_radial_s_m=5,conductivity_axial_s_m=5,source='COMSOL62 submarine02 p14 explicit stabilized 5 S/m; coaxial submodel only')
                d['parameters']['mesh'].update(radial_elements_per_layer=count,axial_elements_per_section=100 if count<48 else 200)
                if count==48:d['parameters']['mesh']['max_nodes']=120000
                configs.append((bonding+'-'+str(count),v,d['parameters']))
        plugin='cablesim.simulation';capability='capacitive-cable'
    try:
        for label,value,parameters in configs:
            run=executor.run(plugin,capability,[dict(case_id=label,input=value,parameters=parameters)])
            row=run.cases[0]
            if row.status!='succeeded':raise RuntimeError(str(row.error))
            bundle=row.artifacts['x-cablesim.simulation-bundle']
            record=dict(run_id=run.run_id,method=dict(plugin_id=run.plugin_id,plugin_version=run.plugin_version,capability=run.capability,method_version=run.method_version),request_sha256=run.request_sha256,
                        artifact_digests=row.artifact_digests,input=value,parameters=parameters,bundle=bundle)
            (root/(args.solver+'-'+label+'.json')).write_text(json.dumps(record,ensure_ascii=False,allow_nan=False,separators=(',',':')),'utf-8')
            result=bundle['result'];small={k:result[k] for k in ('maximum_temperature_k','source_heat_w_m','capacitance_f_m','sheath_maximum_nodal_voltage_peak_v','regions') if k in result}
            summary.append(dict(label=label,run_id=run.run_id,method=record['method'],nodes=len(bundle['mesh']['points']),artifact_digests=row.artifact_digests,metrics=small))
            print(label,small,flush=True)
        (root/(args.solver+'-summary.json')).write_text(json.dumps(summary,ensure_ascii=False,indent=2),'utf-8')
    finally:
        # Only this command's dedicated jobs, after exported immutable evidence.
        shutil.rmtree(work)


if __name__=='__main__':main()
