"""cablesim.run/2 入口；受限热场基准与论文护套回路解析子模型。"""
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[4]))

from hashlib import sha256
from importlib import metadata, util
import json
import platform
from cablesim_simulation.wire import WireInput, mesh_size, solve_wire
from cablesim_simulation.bonded import prepare as prepare_bonded, solve_bonded


def thermal_case(request,case,job):
    from cablesim_simulation.thermal_input import prepare
    from cablesim_simulation.report import comparison,digest
    model,controls = prepare(case['input'],case.get('parameters',{}))
    for module in ('gmsh','skfem','numpy','scipy'):
        if util.find_spec(module) is None:
            raise ValueError('缺少数值运行依赖：'+module)
    prepared = {'model':model.model_dump(mode='json'),'controls':controls.model_dump(mode='json')}
    evidence = {'prepared_input_sha256':digest(prepared),'input_sha256':digest(case['input'])}
    if request['phase'] == 'check':
        return {'case_id':case['case_id'],'status':'succeeded','results':[],'artifacts':[],'evidence':evidence}
    from cablesim_simulation.thermal import solve_thermal
    summary,field = solve_thermal(model,controls)
    reference = case.get('parameters',{}).get('reproduction',{})
    report = comparison(summary,field,reference)
    report.update(input_sha256=evidence['input_sha256'],prepared_input_sha256=evidence['prepared_input_sha256'])
    name = 'output/'+case['case_id']+'.json'
    report_name = 'output/'+case['case_id']+'-comparison.json'
    payload = {'prepared_input':prepared,'summary':summary,'field':field,'evidence':evidence}
    (job/name).write_text(json.dumps(payload,ensure_ascii=False,allow_nan=False),'utf-8')
    (job/report_name).write_text(json.dumps(report,ensure_ascii=False,allow_nan=False),'utf-8')
    results = [{'key':'conductor_temperature','type':'quantity','entity':c['entity'],'status':'available',
                'value':c['conductor_max_temperature_k'],'unit':'K'} for c in summary['cables']]
    if summary['rating']:
        results.append({'key':'ampacity','type':'quantity','entity':summary['rating']['circuit'],
                        'status':'available','value':summary['rating']['ampacity_a'],'unit':'A'})
    return {'case_id':case['case_id'],'status':'succeeded','results':results,'evidence':evidence,
            'artifacts':[{'path':name,'type':'x-cablesim.simulation-bundle'},
                         {'path':report_name,'type':'x-cablesim.reproduction-report'}],
            'warnings':[{'code':'THERMAL_SCOPE','message':'二维常热物性、显式损耗/温变电阻与边界；管内空气为有来源的等效热阻，不是CFD或自动IEC损耗计算。'}]}


def bonded_case(request, case, job):
    value, parameters = prepare_bonded(case['input'], case.get('parameters', {}))
    if util.find_spec('numpy') is None:
        raise ValueError('缺少数值依赖：numpy')
    prepared = {'input': value, 'parameters': parameters}
    digest = sha256(json.dumps(prepared, ensure_ascii=False, sort_keys=True, allow_nan=False).encode()).hexdigest()
    evidence = {'prepared_input_sha256': digest, 'source_reference': value['source_reference']}
    if request['phase'] == 'check':
        return {'case_id': case['case_id'], 'status': 'succeeded', 'results': [], 'artifacts': [], 'evidence': evidence}
    summary = solve_bonded(value, parameters)
    name = 'output/'+case['case_id']+'.json'
    (job/name).write_text(json.dumps({'prepared_input': prepared, 'summary': summary,
                                    'prepared_input_sha256': digest, 'engineering_approval': False},
                                   ensure_ascii=False, allow_nan=False), 'utf-8')
    return {'case_id': case['case_id'], 'status': 'succeeded', 'evidence': evidence,
            'results': [{'key': 'x-cablesim.sheath-current', 'type': 'quantity', 'entity': 'cable/'+phase,
                         'status': 'available', 'unit': 'A', 'value': current}
                        for phase, current in zip('ABC', summary['shield_current_rms_a'])],
            'artifacts': [{'path': name, 'type': 'x-cablesim.simulation-bundle'}],
            'warnings': [{'code': 'ANALYTIC_SUBMODEL', 'message': '论文的线电流与护套回路解析子模型；不等于电磁有限元或完整论文复现。'}]}


def run_case(request, case, job):
    try:
        if request['capability'] in ('getdp-eddy','elmer-heat'):
            from cablesim_simulation.external import host_case
            return host_case(request,case,job,'getdp' if request['capability']=='getdp-eddy' else 'elmer')
        if request['capability'] == 'multiregion-thermal':
            return thermal_case(request,case,job)
        if request['capability'] == 'solid-bonding-flat':
            return bonded_case(request, case, job)
        if request['capability'] != 'insulated-wire':
            raise ValueError('未实现的求解能力。')
        wire = WireInput.parse(case['input'])
        size = mesh_size(case.get('parameters', {}), wire)
        for module in ('gmsh', 'skfem', 'numpy', 'scipy'):
            if util.find_spec(module) is None:
                raise ValueError('缺少数值运行依赖：' + module)
        prepared = {'input': wire.prepared(), 'mesh_size_m': size}
        digest = sha256(json.dumps(prepared, ensure_ascii=False, sort_keys=True, allow_nan=False).encode()).hexdigest()
        evidence = {'prepared_input_sha256': digest, 'source_reference': wire.source_reference}
        if request['phase'] == 'check':
            return {'case_id': case['case_id'], 'status': 'succeeded', 'results': [], 'artifacts': [], 'evidence': evidence}
        summary, field = solve_wire(wire, size)
        name = 'output/' + case['case_id'] + '.json'
        payload = {'prepared_input': prepared, 'prepared_input_sha256': digest, 'summary': summary, 'field': field,
                   'reference_kind': 'analytic-benchmark', 'engineering_approval': False}
        (job/name).write_text(json.dumps(payload, ensure_ascii=False, allow_nan=False), encoding='utf-8')
        return {'case_id': case['case_id'], 'status': 'succeeded',
                'results': [{'key': 'conductor_temperature', 'type': 'quantity', 'entity': wire.entity,
                             'status': 'available', 'value': summary['centre_rise_k']+wire.ambient_k, 'unit': 'K'}],
                'artifacts': [{'path': name, 'type': 'x-cablesim.simulation-bundle'}], 'evidence': evidence,
                'warnings': [{'code': 'REFERENCE_ONLY', 'message': '同心双材料稳态导热基准；输出为中心温度，不是载流量或 IEC 认证。'}]}
    except Exception as exc:
        return {'case_id': case['case_id'], 'status': 'failed', 'error': {'code': type(exc).__name__, 'message': str(exc)}}


def main():
    job = Path.cwd()
    request = json.loads((job/'input/request.json').read_text('utf-8'))
    if request.get('protocol') != 'cablesim.run/2' or request.get('phase') not in ('check', 'run'):
        raise ValueError('不支持的协议。')
    result = {'protocol': 'cablesim.run/2', 'cases': [run_case(request, case, job) for case in request['cases']],
              'environment': {'python': platform.python_version(), 'platform': platform.platform(),
                              'packages': {d.metadata['Name']: d.version for d in metadata.distributions() if d.metadata['Name']}}}
    (job/'output/result.json').write_text(json.dumps(result, ensure_ascii=False, allow_nan=False), encoding='utf-8')


if __name__ == '__main__':
    main()
