"""Claim conversion, bounded private repairs and usable evidence fallback."""
from copy import deepcopy
import json
from test_index_reproductions import library

from fastapi import HTTPException
import pytest

from backend.harness.evidence import grounded_text,quantity_facts,converted,run_points,evidence_summary
from test_harness import fake_model,session,send,call,answer,FAKE_KEY
from test_research import client,study,request


def test_rounding_units_derivation_and_operation_scope_preserve_sources():
    facts=[{'key':'conductor_temperature','value':380.15,'unit':'K'},
           {'key':'temperature_limit','value':363.15,'unit':'K'},
           {'key':'temperature_margin','value':17,'unit':'K'},
           {'key':'length','value':.0123456,'unit':'m'},
           {'key':'area','value':.0003,'unit':'m²'},
           {'key':'resistance','value':.0000754,'unit':'Ω/m'},
           {'key':'ampacity','value':400,'unit':'A'},
           {'key':'ampacity','value':419.2,'unit':'A'},
           {'path':'/soil/rho','before':1.,'after':1.2,'unit':'K·m/W'}]
    observations=[{'data':{'results':facts,'cases':[{'case_id':'case-9'}],'circuits':[{'id':'circuit/c1'}]}}]
    proof=[]
    text='工况9，回路1。按IEC 60287-1-1、GB/T 12706，型号YJV22-8.7/15 3×300。\n'
    text+='保存结果最高导体温度107.00 °C，温限90.0 °C，超出温限17.0 K。温限余量17.0 °C。\n'
    text+='长度12.35 mm，截面300 mm²，电阻0.0754 Ω/km。\n'
    text+='允许电流400 A → 419.2 A，提高4.8 %，比值1.048倍。\n方案中把热阻率改为1.2 K·m/W，试算中修改后的最高温度107 °C；尚未保存到工程，未批准。'
    assert grounded_text(text,observations,proposals=[{'status':'pending'}],proof=proof)==text
    assert any(row['rule']=='percent_change' and len(row['sources'])==2 for row in proof)
    assert any(row['rule']=='ratio' for row in proof)
    assert grounded_text('用户要求1.2 K·m/W。',[],users=['改为1.2 K·m/W。'])
    assert grounded_text('用户给出的系数是0.8。',[],users=['系数0.8。'])
    assert grounded_text('最高导体温度从90 °C升高至107 °C，变化17 °C。',observations)
    for invalid in ('允许电流9999 A。','仅说明超出温限18 K。','温限余量290.15 °C。','已保存到工程。','方案已批准。','已发布。'):
        with pytest.raises(HTTPException) as blocked:grounded_text(invalid,observations,proposals=[{'status':'pending'}])
        assert blocked.value.detail['issues'][0]['fragment']
    # The exceedance follows from the two reported values (380.15 K against a 363.15 K limit); 18 K does not.
    assert grounded_text('超出温限17 K。',[{'data':{'results':facts[:2]}}])
    with pytest.raises(HTTPException):grounded_text('超出温限18 K。',[{'data':{'results':facts[:2]}}])
    with pytest.raises(HTTPException):grounded_text('共同允许电流400 A。',observations)
    no_rating={'integrity':'verified','id':'saved-run','study':'study','status':'succeeded','freshness':'current','input_digest':'digest',
        'snapshot':{'definition':{'driver':{'kind':'selection'},'method':{}},'headline_contract':[]},
        'output':{'cases':[{'case_id':'case-0','status':'succeeded','results':[
            {'key':'ampacity','unit':'A','case':'rating','status':'unavailable','reason':{'code':'NO_POSITIVE_RATING'}},
            {'key':'conductor_temperature','unit':'K','case':'operating','value':380.15,'status':'available'}]}]}}
    points=run_points(None,no_rating)
    summary,_=evidence_summary({'steps':[{'result':{'data':points}}],'proposals':[]})
    assert len(points['cases'])==1 and '无正允许电流' in summary and '107 °C' in summary


def test_rejected_draft_is_private_redacted_feedback_and_repaired_over_http(client,fake_model):
    script,requests=fake_model;w,s=study(client);root,body=request(client,w,s)
    run=client.post(root+'/runs',json=body).json();tid=session(client,w,s)
    raw='允许电流9999 A。Bearer secret-token api_key=another-secret '+FAKE_KEY
    script.extend([call('run_read',{'run_id':run['id']}),answer(raw)])
    harness=client.app.state.harness;original=harness.model.reply;final=[]
    def reply(*args):
        if len(requests)==2:
            record=harness.tasks.record(tid);data=record['steps'][0]['result']['data']
            facts=quantity_facts([{'data':data}])
            value=next(f for f in facts if f['key']=='ampacity' and f['headline'] and f['unit']=='A')
            hottest=max((f for f in facts if f['key']=='conductor_temperature' and f.get('condition')=='operating'),key=lambda f:converted(f,'°C'))
            margin=min((f for f in facts if f['key']=='temperature_margin'),key=lambda f:f['value'])
            limiter=next(f['entity'] for case in data['cases'] for f in case['factors'] if f['key']=='limiting_cable')
            final.append(f'保存结果允许电流{value["value"]:.4g} A，口径为逐回路额定；最高导体温度{converted(hottest,"°C"):.4g} °C（{hottest["entity"]}）；温限余量{margin["value"]:.4g} K；限制对象{limiter}。')
            script.append(answer(final[-1]))
        return original(*args)
    harness.model.reply=reply
    events=send(client,tid,'这个研究的结论是什么？最主要的限制因素是什么？')
    record=client.get('/api/agent/sessions/'+tid).json()
    text=''.join(data['text'] for kind,data in events if kind=='message.delta')
    assert text==final[-1] and '9999' not in text
    rejected=next(event['data'] for event in record['events'] if event['type']=='answer.rejected')
    assert '9999' in rejected['draft'] and FAKE_KEY not in json.dumps(record) and 'secret-token' not in json.dumps(record) and 'another-secret' not in json.dumps(record)
    assert rejected['issues'][0]['available_values'][0]['unit']=='A'
    feedback=json.loads(requests[-1]['messages'][-1]['content'])
    assert requests[-1]['messages'][-1]['role']=='tool' and feedback['data']['issues'][0]['fragment']=='9999 A'
    assert len(requests)==3 and all('tools' not in row for row in requests[2:])
    assert [event['data']['phase'] for event in record['events'] if event['type']=='model.request']==['tools','tools','repair']
    assert record['budget']['prompt_tokens']==30 and record['budget']['completion_tokens']==15
    print('\n问题1（本地假模型，合成token）：'+json.dumps({'requests':3,'prompt_tokens':30,'completion_tokens':15,'repairs':1,'answer':text},ensure_ascii=False))


def test_exhausted_repairs_and_closing_return_real_proposal_preview_comparison(client,fake_model):
    script,requests=fake_model;w,s=study(client)
    document=deepcopy(s['definition']['method_input'])
    soil=next(row for row in document['materials'] if row['category']=='soil');soil['thermal_resistivity']=1.0
    client.post(f'/api/workspaces/{w["id"]}/domain/conversion',json={'expected_revision':w['revision']})
    w=client.get('/api/workspaces/'+w['id']).json()
    saved=client.put(f'/api/workspaces/{w["id"]}/domain',json={'expected_revision':w['revision'],'document':document})
    assert saved.status_code==200,saved.text
    w=client.get('/api/workspaces/'+w['id']).json()
    updated=client.put(f'/api/workspaces/{w["id"]}/studies/{s["id"]}',json={**s['definition'],'input_source':'domain','method_input':None,
        'expected_revision':w['revision'],'expected_study_revision':s['revision']})
    assert updated.status_code==200,updated.text
    s=updated.json();root,body=request(client,w,s);run=client.post(root+'/runs',json=body).json()
    assert run['status']=='succeeded',run
    case_id=run['output']['cases'][0]['case_id'];tid=session(client,w,s)
    path='/materials/'+soil['id'].replace('/','~1')+'/thermal_resistivity'
    script.extend([call('run_read',{'run_id':run['id'],'case_id':case_id}),
        call('propose_domain_changes',{'changes':[{'path':path,'value':1.2,'unit':'K·m/W'}]})])
    harness=client.app.state.harness;original=harness.model.reply
    def reply(*args):
        if len(requests)==2:
            proposal=harness.tasks.record(tid)['proposals'][0]
            script.append(call('study_preview',{'proposal_id':proposal['id'],'run_id':run['id'],'case_id':case_id}))
        if len(requests)==3:script.extend([answer('已保存到工程。允许电流9999 A。') for _ in range(4)])
        return original(*args)
    harness.model.reply=reply
    events=send(client,tid,'把土壤热阻率改为1.2 K·m/W，给出方案并试算，与原结果比较。')
    record=client.get('/api/agent/sessions/'+tid).json()
    final=''.join(data['text'] for kind,data in events if kind=='message.delta')
    assert final.startswith('以下为工具证据摘要，模型解释未通过核验')
    assert '1 K·m/W → 1.2 K·m/W' in final and '最高导体温度' in final and '同一原工况前后对比' in final
    assert '9999' not in final and '已保存到工程' not in final
    assert len([event for event in record['events'] if event['type']=='answer.rejected'])==4
    assert len([event for event in record['events'] if event['type']=='answer.repair'])==2
    assert len([event for event in record['events'] if event['type']=='answer.fallback'])==1
    phases=[event['data']['phase'] for event in record['events'] if event['type']=='model.request']
    assert phases==['tools']*4+['repair']*2+['closing'] and len(requests)==7
    assert all('tools' not in row for row in requests[4:])
    assert record['proposals'][0]['status']=='pending'
    assert client.get(f'/api/workspaces/{w["id"]}/domain').json()['revision']==w['revision']
    print('\n问题2（本地假模型，合成token）：'+json.dumps({'requests':7,'prompt_tokens':70,'completion_tokens':35,'repairs':2,'answer':final},ensure_ascii=False))


def test_real_model_phrasing_is_grounded_but_altered_values_are_not():
    # Phrasings taken from rejected deepseek-flash drafts (2026-10-07): short run ids, model paths,
    # list enumerators, a negative margin stated as exceedance and a written subtraction.
    observations=[{'data':{'results':[
        {'key':'temperature_margin','entity':'cable/template2','value':-16.98,'unit':'K'},
        {'key':'conductor_temperature','entity':'cable/template2','value':380.13,'unit':'K','case':'operating'},
        {'key':'conductor_temperature','entity':'cable/c1-A','value':375.54,'unit':'K','case':'operating'},
        {'path':'/cable_types/cable_type~1ct1/rating/max_conductor_temperature/normal','value':90.0,'unit':'°C'},
        {'path':'/load_cases/load~1steady/currents/circuit~1c1','value':400.0,'unit':'A'},
        {'key':'ampacity','entity':'circuit/template2','case':'rating','value':212.9177,'unit':'A'},
        {'key':'ampacity','entity':'circuit/c1','case':'rating-simultaneous','value':362.238,'unit':'A'}]}}]
    text=('保存运行 72adf998，负荷见 /load_cases/load~1steady/currents/circuit~1c1、circuit~1template2。\n'
          '最热电缆 cable/template2 导体 106.98 °C（380.13 K），对 90.0 °C 限值的裕度为 −17.0 K，即超温 17.0 K。\n'
          'cable/c1-A 导体 102.39 °C；相对 90.0 °C 限值的差：90.0 °C − 102.39 °C = −12.39 K。\n'
          'circuit/template2 条件上限 212.9 A；全回路共同能力 362.2 A，低于 400 A 负荷。\n'
          '(2) 有限元交叉校核尚无运行。')
    assert grounded_text(text,observations)==text
    for invalid in ('cable/template2 超温 19.0 K。','cable/template2 的温限余量为 +17.0 K。','最热导体 108.5 °C。',
                    '相对 90.0 °C 限值的差：90.0 °C − 102.39 °C = −14.0 K。'):
        with pytest.raises(HTTPException):grounded_text(invalid,observations)


def test_comparisons_between_cited_quantities_are_derived_not_invented():
    observations=[{'data':{'results':[
        {'path':'/load_cases/load~1steady/currents/circuit~1c1','value':400.0,'unit':'A'},
        {'key':'ampacity','entity':'circuit/c1','case':'rating-simultaneous','value':362.238,'unit':'A'},
        {'key':'conductor_temperature','entity':'cable/template2','value':380.1297,'unit':'K'},
        {'key':'conductor_temperature','entity':'cable/template2','value':392.7625,'unit':'K','run_id':'preview'}]}}]
    text=('保存负荷每回 400 A，比共同能力 362.2 A 高约 10.4%（400 A / 362.2 A = 1.104）。\n\n'
          '试算最热导体由 380.13 K 升到 392.76 K，上升约 12.6 K（380.13 K − 273.15 = 106.98 °C）。')
    assert grounded_text(text,observations)==text
    for invalid in ('保存负荷每回 400 A，比共同能力 362.2 A 高约 15%。','400 A / 362.2 A = 1.2。',
                    '试算由 380.13 K 升到 392.76 K，上升约 20 K。'):
        with pytest.raises(HTTPException):grounded_text(invalid,observations)


def test_derived_values_use_operands_from_their_own_sentence():
    observations=[{'data':{'results':[
        {'path':'/load_cases/load~1steady/currents/circuit~1c1','value':400.0,'unit':'A'},
        {'key':'ampacity','entity':'circuit/template2','case':'rating','value':212.9177,'unit':'A'},
        {'key':'ampacity','entity':'circuit/c1','case':'rating-simultaneous','value':362.238,'unit':'A'},
        {'key':'ampacity','case':'rating-simultaneous','value':341.635,'unit':'A','run_id':'preview'},
        {'key':'conductor_temperature','value':380.1297,'unit':'K'},
        {'key':'conductor_temperature','value':392.7625,'unit':'K','run_id':'preview'}]}}]
    text=('全回路共同能力下降 20.6 A（362.2 → 341.6 A）。最高导体温度上升 12.63 K（119.61 − 106.98 °C）。'
          '回路 2 条件上限 212.9 A，对 400 A 负荷差 187.1 A。')
    assert grounded_text(text,observations)==text
    # 37.8 A is 400 − 362.2 from another sentence, attributed here to the 212.9 A limit.
    with pytest.raises(HTTPException):
        grounded_text('全回路共同能力 362.2 A。\n回路 2 条件上限 212.9 A（对应 400 A 负荷，差值 37.8 A）。',observations)


def test_changes_between_saved_and_preview_records_can_be_cited_anywhere():
    observations=[{'data':{'results':[
        {'key':'conductor_temperature','entity':'cable/template2','value':380.1297,'unit':'K','run_id':'saved'},
        {'key':'ampacity','case':'rating-simultaneous','value':362.238,'unit':'A','run_id':'saved'},
        {'path':'/load_cases/load~1steady/currents/circuit~1c1','value':400.0,'unit':'A'}]}},
        {'data':{'results':[
        {'key':'conductor_temperature','entity':'cable/template2','value':392.7625,'unit':'K','run_id':'preview'},
        {'key':'ampacity','case':'rating-simultaneous','value':341.635,'unit':'A','run_id':'preview'}]}}]
    text=('型号 YJV22‑8.7/15 3×300 的全回路允许电流 362.2 A（低于 400 A）。\n\n'
          '由试算看，热阻率提高使导体温度 +12.6 K、共同能力 −20.6 A；此为试算推断，不是已批准结论。')
    assert grounded_text(text,observations)==text
    for invalid in ('由试算看，导体温度上升 15 K。','共同能力下降 37.8 A。'):
        with pytest.raises(HTTPException):grounded_text(invalid,observations)


def test_temperature_margin_follows_the_named_cable_and_sign():
    observations=[{'data':{'results':[
        {'key':'conductor_temperature','entity':'cable/template2','value':392.7625,'unit':'K','run_id':'preview'},
        {'key':'conductor_temperature','entity':'cable/c1-A','value':375.54,'unit':'K','run_id':'preview'},
        {'path':'/cable_types/cable_type~1ct1/rating/max_conductor_temperature/normal','value':90.0,'unit':'°C'}]}}]
    assert grounded_text('试算后 cable/template2 超温 29.61 K，温限余量 −29.6 K。',observations)
    for invalid in ('试算后 cable/c1-A 超温 29.61 K。','试算后 cable/template2 温限余量 +29.6 K。'):
        with pytest.raises(HTTPException):grounded_text(invalid,observations)
