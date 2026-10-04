"""Compare completed immutable coupled/charging runs; no solver or reference fitting."""
from pathlib import Path
from hashlib import sha256
import json,math
ROOT=Path(__file__).resolve().parents[3]


def read(path):return json.loads(path.read_text('utf-8'))


def main():
    rows=[];evidence={};convergence={}
    def add(case,quantity,unit,computed,reference,scope,**extra):
        difference=computed-reference
        rows.append(dict(case=case,quantity=quantity,unit=unit,calculated=computed,comsol=reference,
                         difference=difference,relative_difference=None if unit=='K' else difference/abs(reference),
                         scope=scope,status='not_assessed',reason='No acceptance threshold supplied; numerical agreement is not engineering approval',**extra))
    electro=ROOT/'.data/simulation/electrothermal'
    for label,opened in [('rated','rated-fine'),('hot','hot')]:
        paths=[electro/('open-'+opened+'.json'),electro/('comsol-'+label+'.json')]
        a,b=map(read,paths)
        if a['input']!=b['input']:raise ValueError('Coupled physical inputs differ; refusing numerical comparison')
        ra,rb=a['bundle']['result'],b['bundle']['result']
        for quantity,unit in [('maximum_temperature_k','K'),('source_heat_w_m','W/m')]:
            add('sigmaT-'+label,quantity,unit,ra[quantity],rb[quantity],'coaxial sigma(T) capability; not full tutorial06')
        evidence['sigmaT-'+label]=[dict(file=str(p),sha256=sha256(p.read_bytes()).hexdigest(),run_id=v['run_id'],method=v['method'],artifact_digests=v['artifact_digests']) for p,v in zip(paths,[a,b])]
    coarse=read(electro/'open-rated.json')['bundle']['result'];fine=read(electro/'open-rated-fine.json')['bundle']['result']
    convergence['sigmaT-rated']={key:[coarse[key],fine[key]] for key in ('maximum_temperature_k','source_heat_w_m')}
    cap=ROOT/'.data/simulation/capacitive';reference=read(cap/'native-reference.json')
    for bonding in ['single_point','both_ends','cross_bonded']:
        records=[read(cap/f'open-{bonding}-{count}.json') for count in [12,24,48]]
        states=[v['bundle']['result'] for v in records]
        powers=[r['regions'][-1]['joule_loss_w'] for r in states]
        native=reference[bonding+'-sheathloss'][0][0]
        add('tutorial03-'+bonding,'sheath_joule_loss','W',powers[-1],native,'same axisymmetric charging model and explicit numerical lead anisotropy')
        add('tutorial03-'+bonding,'sheath_voltage_peak','V',states[-1]['sheath_maximum_nodal_voltage_peak_v'],reference[bonding+'-sheathmax'][0][0],'same geometry, excitation and ideal grounding')
        convergence[bonding]=dict(radial_elements_per_layer=[12,24,48],axial_elements_per_section=[100,100,200],loss_w=powers,
                                  nodes=[len(v['bundle']['mesh']['points']) for v in records],last_change_w=powers[-1]-powers[-2])
        evidence[bonding]=[dict(run_id=v['run_id'],method=v['method'],request_sha256=v['request_sha256'],artifact_digests=v['artifact_digests']) for v in records]
    records=[read(cap/f'open-radial_ground-{count}.json') for count in [12,24,48]]
    result=records[-1]['bundle']['result'];current=abs(complex(*result['phase_currents_peak_a'][0]))
    add('tutorial02-coaxial','charging_current_peak_per_length','A/m',current,reference['radial-charge'][0][0],
        'open coaxial radial submodel versus native full 3-phase cross-section with grounded screens; not full field equivalence')
    convergence['radial_ground']=dict(capacitance_f_m=[r['bundle']['result']['capacitance_f_m'] for r in records])
    evidence['native_capacitive']=dict(source_model_sha256=reference['source_model_sha256'],solver=reference['solver'],
                                      artifact_sha256=sha256((cap/'native-reference.json').read_bytes()).hexdigest())
    report=dict(schema='cablesim.reproduction-report/1',kind='suite',scope='sigma(T), electroquasistatic coaxial charging and axisymmetric bonding',
                rows=rows,convergence=convergence,evidence=evidence,engineering_approval=False,
                uncovered=['complete tutorial06 thermal contact and material-specific geometry','tutorial02 mutual-capacitance field','inductive cross-bonding and 3D'])
    out=ROOT/'.data/simulation/coupling-comparison/report.json';out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(report,ensure_ascii=False,indent=2,allow_nan=False),'utf-8')
    for row in rows:print(json.dumps(row,ensure_ascii=False),flush=True)


if __name__=='__main__':main()
