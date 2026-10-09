"""cablesim.run/2 entry point of the IEC 60287 plugin (started as `python -I main.py`)."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # -I drops cwd/PYTHONPATH; add our own src only
sys.path.insert(0, str(Path(__file__).resolve().parents[4]))

import json
from hashlib import sha256
import platform
from math import isfinite

from pydantic import ValidationError
from cablesim_sdk.validation import FieldValueError, validation_error, pointer

from cablesim_iec60287.inputs import Rating
from cablesim_iec60287.domain import prepare
from cablesim_iec60287.group_inputs import GroupRating
from cablesim_iec60287.group import rate_group, GROUP_METHOD_VERSION
from cablesim_iec60287.method import METHOD_VERSION, RatingRefused, rate, dielectric_path
from cablesim_iec60287.comparison import decompose
from cablesim_iec60287.rating_basis import basis

PROTOCOL = 'cablesim.run/2'
PHASES = ('A', 'B', 'C')


def steady_rating(case: dict, out: Path) -> dict:
    rating = prepare(case['input'], case.get('parameters', {}))
    if isinstance(rating, GroupRating):
        return group_rating(case, rating, out)
    result = rate(rating)
    last = result.history[-1]
    wd = result.electrical.dielectric_loss_w_m
    cables = [f'cable/c1-{p}' for p in PHASES]
    results = [{'key': 'ampacity', 'type': 'quantity', 'entity': 'circuit/c1', 'status': 'available',
                'value': result.ampacity_a, 'unit': 'A'}]
    # Three equally loaded cables in touching trefoil: one value applies to every phase.
    per_cable = [
        ('conductor_temperature', rating.max_conductor_temperature_c + 273.15, 'K'),
        ('sheath_temperature', last.sheath_temperature_c + 273.15, 'K'),
        ('surface_temperature', last.cable_surface_temperature_c + 273.15, 'K'),
        ('losses.conductor', last.conductor_loss_w_m, 'W/m'),
        ('losses.sheath', last.sheath_loss_w_m, 'W/m'),
        ('losses.dielectric', wd, 'W/m'),
        ('losses.total', last.conductor_loss_w_m + last.sheath_loss_w_m + wd, 'W/m'),
        ('loss_factor.sheath', last.loss.total, '1'),
        ('ac_resistance', result.electrical.r_ac_max_ohm_m, 'Ω/m'),
        ('capacitance', result.electrical.capacitance_f_m, 'F/m'),
        ('thermal_resistance.insulation', result.t1_k_m_w, 'K·m/W'),
        ('thermal_resistance.oversheath', result.t3_k_m_w, 'K·m/W'),
        ('thermal_resistance.external', last.t4_k_m_w, 'K·m/W'),
    ]
    for entity in cables:
        for key, value, unit in per_cable:
            results.append({'key': key, 'type': 'quantity', 'entity': entity, 'status': 'available', 'value': value, 'unit': unit})
    artifact = f"output/{case['case_id']}.trace.json"
    payload = result.as_dict()
    payload['rating_basis'] = basis()
    payload['rating_components'] = {
        'schema': 'cablesim.rating-components/1', 'phase': '三相等效',
        'ampacity_a': result.ampacity_a,
        'temperature_headroom_k': rating.max_conductor_temperature_c-rating.installation.ambient_temperature_c,
        'ac_resistance_ohm_m': result.electrical.r_ac_max_ohm_m,
        'lambda1': last.loss.total, 'lambda2': 0.0,
        't1_k_m_w': result.t1_k_m_w, 't2_k_m_w': 0.0,
        'metal_k_m_w': 0.0, 't3_k_m_w': result.t3_k_m_w,
        't4_k_m_w': last.t4_k_m_w,
        'dielectric_rise_k': wd * (dielectric_path(rating,result.geometry) + result.t3_k_m_w + last.t4_k_m_w),
        'dielectric_loss_w_m': wd, 'temperature_c': rating.max_conductor_temperature_c,
        'notes': 'T4 为 IEC 品字形外部热阻；λ1 为已收敛护套损耗因子；无铠装，T2/λ2 为零。',
    }
    context = case.get('comparison', {})
    reference = context.get('artifacts', {}).get('x-cablesim.thermal-network-rating', {}).get('rating_components')
    if reference:
        try:
            payload['rating_attribution'] = {**decompose(reference, payload['rating_components']),
                                           'source': context.get('source')}
        except (ValueError, KeyError, TypeError) as exc:
            payload['rating_attribution'] = {'status': 'unavailable', 'reason': str(exc)}
    domain = case['input'].get('schema_version') == 'cablesim.domain/1'
    load = case['input']['load_cases'][0]['currents'][case['input']['circuits'][0]['id']] if domain else None
    target = case.get('parameters', {}).get('target_current_a', load)
    if target is not None and (isinstance(target, bool) or not isinstance(target, (int, float)) or not isfinite(target) or target < 0):
        raise ValueError('目标电流必须是非负有限数值。')
    payload['goal_checks'] = [{
        'id': 'research.current', 'rule_version': 'iec60287-goals/1', 'key': 'ampacity', 'condition': 'rating',
        'actual': result.ampacity_a, 'target': target, 'unit': 'A',
        'margin': None if target is None else result.ampacity_a-target,
        'margin_percent': None if not target else (result.ampacity_a-target)/target*100,
        'verdict': 'unavailable' if target is None else 'satisfied' if result.ampacity_a >= target else 'not_satisfied',
        'source': '研究目标电流' if 'target_current_a' in case.get('parameters', {}) else '共享负荷工况',
        'reason': '尚未填写负荷或目标电流。' if target is None else None,
    }, {'id': 'research.temperature', 'rule_version': 'iec60287-goals/1', 'key': 'conductor_temperature',
        'condition': 'operating', 'actual': None, 'target': rating.max_conductor_temperature_c+273.15,
        'unit': 'K', 'margin': None, 'verdict': 'unavailable', 'source': '共享导体温限',
        'reason': '本 IEC 稳态子集未提供给定电流下的运行温度。'}]
    (out / Path(artifact).name).write_text(json.dumps(payload, ensure_ascii=False, allow_nan=False), 'utf-8')
    return {'results': results, 'artifacts': [{'path': artifact, 'type': 'x-cablesim.iec60287-trace'}],
            'warnings': [{'code': 'SCOPE', 'message': m} for m in result.limitations],
            'evidence': {'iterations': result.iterations, 'decisions': result.decisions}}


def prepare_case(case):
    if case['input'].get('schema_version')=='cablesim.iec60853-emergency/1':
        from cablesim_iec60287.emergency import Emergency
        if case.get('parameters'):raise ValueError('IEC60853应急子集使用完整SI输入，不接受额外参数。')
        return Emergency.model_validate(case['input'])
    if case['input'].get('schema_version')=='cablesim.product-specification/1':
        from cablesim_iec60287.engineering import complete
        return complete(case['input'],case.get('parameters',{}))
    if case['input'].get('schema_version')=='cablesim.iec60287.tb880-wire-foil/1':
        from cablesim_iec60287.tb880_wire_foil import WireFoilRating
        if case.get('parameters'):raise ValueError('TB880 wire/foil reference uses complete SI input')
        return WireFoilRating.model_validate(case['input'])
    if case['input'].get('schema_version')=='cablesim.iec60287.tb880-reference/1':
        from cablesim_iec60287.tb880_reference import ReferenceRating
        if case.get('parameters'):raise ValueError('TB880 reference uses complete SI input; extra parameters are not accepted')
        return ReferenceRating.model_validate(case['input'])
    if case['input'].get('schema_version')=='cablesim.iec60287.armoured-sl/1':
        from cablesim_iec60287.armour import ArmouredRating
        return ArmouredRating.model_validate(case['input'])
    group=prepare(case['input'],case.get('parameters',{}))
    if isinstance(group,GroupRating):
        from cablesim_iec60287.crossing import sources_for
        sources_for(group)
    return group


def armoured(case,out):
    from cablesim_iec60287.armour import armoured_rating
    value=armoured_rating(prepare_case(case));name=case['case_id']+'.armour.json'
    value['rating_basis'] = basis()
    (out/name).write_text(json.dumps(value,ensure_ascii=False,allow_nan=False),'utf-8')
    return {'results':[{'key':key,'type':'quantity','entity':'circuit/c1','status':'available','value':value[field],'unit':unit} for key,field,unit in [('ampacity','ampacity_a','A'),('x-cablesim.iec60287.loss_factor.armour','lambda2','1'),('x-cablesim.iec60287.losses.armour','armour_loss_w_m','W/m')]],
            'artifacts':[{'path':'output/'+name,'type':'x-cablesim.iec60287-armour'}],
            'warnings':[{'code':'SCOPE','message':s} for s in value['limitations']]}


def tb880_reference(case,out):
    if case['input'].get('schema_version')=='cablesim.iec60287.tb880-wire-foil/1':
        from cablesim_iec60287.tb880_wire_foil import rate
    else:
        from cablesim_iec60287.tb880_reference import rate
    value=rate(prepare_case(case));name=case['case_id']+'.reference.json'
    value['rating_basis'] = basis()
    (out/name).write_text(json.dumps(value,ensure_ascii=False,allow_nan=False),'utf-8')
    return {'results':[{'key':'ampacity','type':'quantity','entity':'circuit/c1','status':'available','value':value['ampacity_a'],'unit':'A'}],
            'artifacts':[{'path':'output/'+name,'type':'x-cablesim.iec60287-reference'}],
            'warnings':[{'code':'REFERENCE_SCOPE','message':s} for s in value['limitations']]}


def model_completion(case,out):
    value=prepare_case(case);name=case['case_id']+'.model.json'
    (out/name).write_text(json.dumps(value,sort_keys=True,ensure_ascii=False,allow_nan=False),'utf-8')
    return {'results':[{'key':'x-cablesim.completed-fields','type':'quantity','entity':value['cable_type']['id'],'status':'available','value':len(value['derived']),'unit':'1'}],
            'artifacts':[{'type':'x-cablesim.engineering-model','path':'output/'+name}]}


def emergency_response(case,out):
    from cablesim_iec60287.emergency import calculate
    result = calculate(case['input']);name = case['case_id']+'.emergency.json'
    (out/name).write_text(json.dumps(result,ensure_ascii=False,allow_nan=False),'utf-8')
    return {'results':[{'key':'x-cablesim.emergency-current','type':'quantity','entity':case['input']['circuit_id'],
        'value':row['permissible_current_a'],'unit':'A','case':f"duration-{row['time_s']:g}s",'status':'available'} for row in result['current_curve']],
        'artifacts':[{'type':'x-cablesim.iec60853-emergency','path':'output/'+name}],
        'warnings':[{'code':'IEC60853_SCOPE','message':'; '.join(result['limitations'])}]}


CAPABILITIES = {'iec60853-emergency':emergency_response,'model-completion':model_completion,'steady-rating': steady_rating,'reference-rating':steady_rating,'armoured-sl-rating':armoured,'tb880-reference-rating':tb880_reference,'tb880-wire-foil-rating':tb880_reference}


def group_rating(case, group, out):
    payload = rate_group(group)
    from cablesim_iec60287.crossing import apply as apply_crossing
    payload = apply_crossing(group,payload)
    payload['method_version'] = '1.1.0'
    results, goals = [], []
    selected = case.get('parameters', {}).get('target_circuit_id', group.circuits[0]['id'])
    target = case.get('parameters', {}).get('target_current_a')
    if selected not in {c['id'] for c in group.circuits}:
        raise ValueError('目标回路不存在，请明确选择研究要校核的回路。')
    if target is not None and len(group.circuits) > 1 and 'target_circuit_id' not in case.get('parameters', {}):
        raise ValueError('多回路目标电流校核必须明确 target_circuit_id，不能静默采用第一回路。')
    if target is not None and (isinstance(target,bool) or not isinstance(target,(int,float)) or not isfinite(target) or target < 0):
        raise ValueError('目标电流必须是非负有限数值。')
    for rated in payload['circuit_ratings']:
        entity = rated['entity']
        result = {'key':'ampacity','type':'quantity','entity':entity,'case':'rating','unit':'A','rating_basis':rated['rating_basis']}
        result.update({'status':'unavailable','reason':rated['error']} if rated['ampacity_a'] is None else {'status':'available','value':rated['ampacity_a']})
        results.append(result)
        load = max(c['current'] for c in group.cables if c['circuit'] == entity)
        required = target if entity == selected and target is not None else load
        margin = None if rated['ampacity_a'] is None else rated['ampacity_a']-required
        goals.append({'id':'research.current/'+entity,'entity':entity,'rule_version':'iec60287-goals/2','key':'ampacity','condition':'rating',
                      'actual':rated['ampacity_a'],'target':required,'unit':'A','margin':margin,
                      'margin_percent':margin/required*100 if required and margin is not None else None,
                      'verdict':'unavailable' if margin is None else 'satisfied' if margin >= 0 else 'not_satisfied',
                      'reason':rated.get('error',{}).get('message'),
                      'source':'研究目标电流' if entity == selected and target is not None else '保存负荷（不平衡时为最大相电流）'})
    simultaneous = payload.get('simultaneous_rating')
    if simultaneous:
        for circuit in group.circuits:
            result = {'key':'ampacity', 'type':'quantity', 'entity':circuit['id'], 'case':'rating-simultaneous', 'unit':'A','rating_basis':simultaneous['rating_basis']}
            result.update({'status':'unavailable', 'reason':simultaneous['error']} if simultaneous['ampacity_a'] is None else
                          {'status':'available', 'value':simultaneous['ampacity_a']})
            results.append(result)
    for crossing in payload.get('crossing_derating',[])[:1]:
        for key,field,unit,title in [('x-cablesim.iec60287.crossing.baseline_ampacity','baseline_current_a','A','降额前允许电流'),
            ('x-cablesim.iec60287.crossing.derating_factor','derating_factor','1','交叉热源降额系数'),
            ('x-cablesim.iec60287.crossing.temperature_rise','crossing_rise_k','K','交叉热源导体温升')]:
            results.append({'key':key,'type':'quantity','entity':crossing['entity'],'case':'rating','status':'available','value':crossing[field],'unit':unit,'title':title})
    fields = [
        ('conductor_temperature','conductor_temperature_c','K'), ('sheath_temperature','sheath_temperature_c','K'),
        ('surface_temperature','surface_temperature_c','K'), ('losses.conductor','conductor_loss_w_m','W/m'),
        ('losses.sheath','sheath_loss_w_m','W/m'), ('losses.dielectric','dielectric_loss_w_m','W/m'),
        ('losses.total','total_loss_w_m','W/m'), ('loss_factor.sheath','lambda1','1'),
        ('ac_resistance','ac_resistance_ohm_m','Ω/m'), ('capacitance','capacitance_f_m','F/m'),
        ('thermal_resistance.insulation','t1_k_m_w','K·m/W'), ('thermal_resistance.oversheath','t3_k_m_w','K·m/W'),
        ('thermal_resistance.external','t4_self_soil_k_m_w','K·m/W'),
        ('x-cablesim.iec60287.thermal_resistance.duct_air','t4_air_gap_k_m_w','K·m/W'), ('x-cablesim.iec60287.thermal_resistance.duct_wall','t4_wall_k_m_w','K·m/W'),
        ('x-cablesim.iec60287.temperature_rise.mutual','mutual_temperature_rise_k','K'), ('x-cablesim.iec60287.current','current_a','A')]
    if not payload['operating']['cable_states']:
        for cable in group.cables:
            results.extend({'key':key,'type':'quantity','entity':cable['id'],'case':'operating','unit':unit,
                            'status':'unavailable','reason':payload['operating']['error']} for key,_,unit in fields)
            goals.append({'id':'research.temperature/'+cable['id'],'entity':cable['id'],'rule_version':'iec60287-goals/2',
                          'key':'conductor_temperature','condition':'operating','actual':None,
                          'target':cable['rating'].max_conductor_temperature_c+273.15,'unit':'K','margin':None,
                          'verdict':'unavailable','source':'共享导体温限','reason':payload['operating']['error']['message']})
    for state in payload['operating']['cable_states']:
        if group.soil.get('three_core'):
            for key,field,unit in [('x-cablesim.iec60287.loss_factor.armour','lambda2','1'),('x-cablesim.iec60287.losses.armour','armour_loss_w_m','W/m'),('x-cablesim.iec60287.thermal_resistance.bedding','t2_k_m_w','K·m/W')]:
                results.append({'key':key,'type':'quantity','entity':state['entity'],'case':'operating','status':'available','value':state[field],'unit':unit})
        for key,field,unit in fields:
            value = state[field]+273.15 if field.endswith('_temperature_c') else state[field]
            results.append({'key':key,'type':'quantity','entity':state['entity'],'case':'operating','status':'available','value':value,'unit':unit})
        goals.append({'id':'research.temperature/'+state['entity'],'entity':state['entity'],'rule_version':'iec60287-goals/2',
                      'key':'conductor_temperature','condition':'operating','actual':state['conductor_temperature_c']+273.15,
                      'target':state['temperature_limit_c']+273.15,'unit':'K','margin':state['margin_k'],
                      'verdict':'satisfied' if state['margin_k'] >= 0 else 'not_satisfied','source':'共享导体温限'})
    payload['goal_checks'] = goals
    payload['rating_attribution'] = {'status':'unavailable','reason':'N 电缆结果按逐电缆热平衡比较，不使用单回路等效 Shapley 分解。'}
    context = case.get('comparison',{})
    reference = context.get('artifacts',{}).get('x-cablesim.thermal-network-rating',{}).get('rating_components')
    if reference and payload.get('rating_components'):
        try:
            payload['rating_attribution'] = {**decompose(reference,payload['rating_components']), 'source':context.get('source')}
        except (ValueError,KeyError,TypeError) as exc:
            payload['rating_attribution'] = {'status':'unavailable','reason':str(exc)}
    execution=case.get('_execution_source')
    if execution:
        from cablesim_iec60287.soil_view import attach
        artifacts=attach(execution,case,group,payload,out)
    else:
        artifact = f"output/{case['case_id']}.trace.json"
        (out/Path(artifact).name).write_text(json.dumps(payload,ensure_ascii=False,allow_nan=False),'utf-8')
        artifacts=[{'path':artifact,'type':'x-cablesim.iec60287-trace'}]
    return {'results':results,'artifacts':artifacts,
            'warnings':[{'code':'ELECTRICAL_SCOPE','message':payload['electrical_basis']}],
            'evidence':{'iterations':payload['operating']['iterations'],'residual_k':payload['operating']['residual_k'],
                        'decisions':payload['decisions']}}


def run_case(handler, case: dict, out: Path) -> dict:
    base = {'case_id': case['case_id']}
    try:
        result = handler(case, out)
        prepared = prepare_case(case)
        for r in result.get('results', []):
            r.setdefault('case', 'rating')
        if case['input'].get('schema_version') == 'cablesim.domain/1' and not isinstance(prepared, GroupRating):
            circuit = case['input']['circuits'][0]
            entities = {'circuit/c1': circuit['id'], **{f'cable/c1-{p}': c['id'] for p,c in zip('ABC',circuit['cables'])}}
            for r in result.get('results', []):
                r['entity'] = entities.get(r['entity'], r['entity'])
        for r in result.get('results', []):
            if r['key'] == 'ampacity':
                r.setdefault('rating_basis', basis(entity=r['entity']))
        if not isinstance(prepared,dict):prepared=prepared.model_dump(mode='json')
        result.setdefault('evidence', {})['prepared_input_sha256'] = sha256(json.dumps(prepared, sort_keys=True, ensure_ascii=False, allow_nan=False).encode('utf-8')).hexdigest()
        return {**base, 'status': 'succeeded', **result}
    except ValidationError as exc:
        prefix=('parameters',) if exc.title=='EngineeringParameters' else ()
        return {**base, 'status': 'failed', 'error': validation_error(exc, prefix=prefix)}
    except FieldValueError as exc:
        return {**base, 'status': 'not_applicable', 'error': {'code':'DOMAIN_NOT_SUPPORTED','message':str(exc),'path':pointer(exc.field_path)}}
    except RatingRefused as exc:
        return {**base, 'status': 'failed', 'error': {'code': exc.code, 'message': str(exc), 'path':exc.path}}
    except (ValueError, KeyError, TypeError, StopIteration) as exc:
        return {**base, 'status': 'not_applicable', 'error': {'code': 'DOMAIN_NOT_SUPPORTED', 'message': str(exc), 'path':pointer(('parameters',str(exc.args[0]))) if isinstance(exc,KeyError) else '/parameters'}}


def main() -> int:
    job = Path.cwd()
    request = json.loads((job / 'input/request.json').read_text('utf-8'))
    from cablesim_sdk.parameter_units import decode_request
    request = decode_request(request, Path(__file__).resolve().parents[2]/'plugin.json')
    if request.get('protocol') != PROTOCOL or request.get('phase') not in ('run', 'check'):
        raise SystemExit('unsupported protocol or phase')
    handler = CAPABILITIES[request['capability']]
    if request['phase'] == 'check':
        def handler(case, out):
            prepared=prepare_case(case)
            if request['capability']=='armoured-sl-rating':
                from cablesim_iec60287.armour import armoured_rating
                armoured_rating(prepared)
            elif request['capability']=='tb880-reference-rating':
                from cablesim_iec60287.tb880_reference import rate as reference_rate
                reference_rate(prepared)
            elif request['capability']=='tb880-wire-foil-rating':
                from cablesim_iec60287.tb880_wire_foil import rate as reference_rate
                reference_rate(prepared)
            return {'results': [], 'artifacts': []}
    out = job / 'output'
    def invoke(case,out):
        case['_execution_source']={'run_id':request['run_id'],'capability':request['capability']}
        schema={'iec60853-emergency':'cablesim.iec60853-emergency/1','tb880-reference-rating':'cablesim.iec60287.tb880-reference/1','tb880-wire-foil-rating':'cablesim.iec60287.tb880-wire-foil/1'}.get(request['capability'])
        if schema and case['input'].get('schema_version')!=schema:raise ValueError('input schema does not match the selected reference capability')
        return handler(case,out)
    cases = [run_case(invoke, case, out) for case in request['cases']]
    result = {'protocol': PROTOCOL, 'cases': cases,
              'environment': {'python': platform.python_version(), 'method': {'steady-rating':'1.1.0','iec60853-emergency':'1.0.0','armoured-sl-rating':'1.0.0','tb880-reference-rating':'1.0.0','tb880-wire-foil-rating':'1.0.0','reference-rating':METHOD_VERSION}.get(request['capability'],GROUP_METHOD_VERSION), 'legacy_method': METHOD_VERSION}}
    from cablesim_sdk.result_answers import attach_witnesses
    attach_witnesses(request,result,Path(__file__).resolve().parents[2]/'plugin.json')
    (out / 'result.json').write_text(json.dumps(result, ensure_ascii=False, allow_nan=False), 'utf-8')
    return 0


def resident_warmup():
    # Imports are already complete; each main() uses a fresh request and paths.
    pass


def resident_main():
    return main()


if __name__ == '__main__':
    sys.exit(main())
