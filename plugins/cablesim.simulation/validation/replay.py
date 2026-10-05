"""数据驱动复现入口：案例JSON、领域模型、所有网格均调用同一宿主方法。"""
from copy import deepcopy
from dataclasses import asdict
from hashlib import sha256
import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT))
sys.path.insert(0,str(ROOT/'plugins/cablesim.simulation/src'))
from backend.plugin_host import Executor
from cablesim_simulation.report import blocked,digest


def replace_path(value,path,replacement):
    target = value
    for part in path[:-1]:
        target = target[part]
    if isinstance(target,dict) and path[-1] not in target:
        raise ValueError('变体只能替换已存在的冻结字段。')
    target[path[-1]] = deepcopy(replacement)


def replay(fixture, output, executor):
    citation = deepcopy(fixture['citation'])
    pdf = citation.get('local_pdf')
    if pdf:
        path = ROOT/pdf
        if path.is_file():
            citation['local_pdf_sha256'] = sha256(path.read_bytes()).hexdigest()
    reference = {k:fixture.get(k,[]) for k in ('missing_inputs','frozen_inputs','assumptions')}
    reference.update(citation=citation,scope=fixture['scope'])
    output.mkdir(parents=True,exist_ok=True)
    if fixture['missing_inputs']:
        report = blocked(reference)
        report['frozen_inputs'] = fixture.get('frozen_inputs',[])
        report['fixture_sha256'] = digest(fixture)
        (output/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2,allow_nan=False),'utf-8')
        return report
    cases = []
    index = []
    for variant in fixture['variants']:
        value = deepcopy(fixture['input'])
        for change in variant['input_changes']:
            replace_path(value,change['path'],change['value'])
        targets = deepcopy(fixture['targets'])
        for change in variant['target_changes']:
            item = next(t for t in targets if t['id'] == change['id'])
            item.update({k:v for k,v in change.items() if k != 'id'})
        base_h = fixture['parameters']['controls']['mesh_size_m']
        for level,h in enumerate(fixture['mesh_sizes_m']):
            p = deepcopy(fixture['parameters'])
            p['controls']['mesh_size_m'] = h
            p['controls']['far_mesh_size_m'] *= h/base_h
            p['reproduction'] = {**reference,'targets':targets,'assumptions':value.get('assumptions',[])}
            case_id = variant['id']+'-mesh-'+str(level)
            cases.append({'case_id':case_id,'input':value,'parameters':p})
            index.append({'case_id':case_id,'variant':variant['id'],'mesh_size_m':h})
    checked = executor.check('cablesim.simulation','multiregion-thermal',cases)
    if any(c.status != 'succeeded' for c in checked.cases):
        raise ValueError('预检失败：'+str([(c.case_id,c.error) for c in checked.cases if c.status != 'succeeded']))
    # 每个网格独立受控运行，避免批量总时限误判；每次仍使用相同入口和精确封签。
    runs,comparisons,convergence = [],[],[]
    for case,info in zip(cases,index):
        run = executor.run('cablesim.simulation','multiregion-thermal',[case])
        runs.append(asdict(run))
        item = run.cases[0]
        if item.status != 'succeeded':
            comparisons.append({**info,'status':'solver_failed','error':item.error})
            continue
        bundle = item.artifacts['x-cablesim.simulation-bundle']
        report = item.artifacts['x-cablesim.reproduction-report']
        report.update(info)
        report['run'] = {k:getattr(run,k) for k in ('run_id','plugin_id','plugin_version','method_version','request_sha256')}
        report['environment'] = run.environment
        report['artifact_sha256'] = item.artifact_digests
        comparisons.append(report)
        summary = bundle['summary']
        convergence.append({**info,'nodes':summary['nodes'],'elements':summary['elements'],
                            'energy_relative_residual':summary['energy_relative_residual'],
                            'quantities':{r['id']:r['calculated'] for r in report['rows']}})
    variants = []
    for variant in fixture['variants']:
        levels = [r for r in comparisons if r['variant'] == variant['id']]
        valid = [r for r in convergence if r['variant'] == variant['id']]
        changes = []
        for a,b in zip(valid,valid[1:]):
            changes.append({key:None if b['quantities'][key] is None or a['quantities'][key] is None else b['quantities'][key]-a['quantities'][key]
                            for key in b['quantities']})
        variants.append({'id':variant['id'],'finest':levels[-1], 'mesh_sequence':valid,
                         'consecutive_changes':changes,'mesh_independence_certified':False})
    report = {'schema':'cablesim.reproduction-report/1','kind':'suite','reference':citation,'scope':fixture['scope'],
              'fixture_sha256':digest(fixture),'frozen_inputs':fixture['frozen_inputs'],'missing_inputs':[],
              'variants':variants,'engineering_approval':False,
              'status':'solver_failed' if any(r.get('status') == 'solver_failed' for r in comparisons) else
                       'matched' if all(v['finest']['status'] == 'matched' for v in variants) else 'comparison_requires_review'}
    (output/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2,allow_nan=False),'utf-8')
    (output/'runs.json').write_text(json.dumps(runs,ensure_ascii=False,allow_nan=False),'utf-8')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('fixture',type=Path)
    parser.add_argument('--output',type=Path,required=True)
    args = parser.parse_args()
    fixture = json.loads(args.fixture.read_text('utf-8'))
    jobs = ROOT/'.tmp/simulation-replay'
    jobs.mkdir(parents=True,exist_ok=True)
    report = replay(fixture,args.output,Executor(jobs_root=jobs))
    print(json.dumps({'id':fixture['id'],'status':report['status'],'report':str(args.output/'report.json'),
                      'variants':[{'id':v['id'],'rows':v['finest'].get('rows',[]),'changes':v['consecutive_changes']} for v in report.get('variants',[])]},ensure_ascii=False))
    if not any(jobs.iterdir()):
        jobs.rmdir()


if __name__ == '__main__':
    main()
