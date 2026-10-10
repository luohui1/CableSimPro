"""The Agent quotes public reproduction evidence without upgrading its status."""
import json
from copy import deepcopy
from time import perf_counter
import pytest
from fastapi import HTTPException

from test_index_reproductions import client
from test_research import study
from test_harness import fake_model,session,send,call,answer
from test_harness_recipes import final_text,metrics
from backend.harness.evidence import grounded_text,quantity_facts
from backend.harness.context_builder import encoded,RESULT_BYTES
from test_harness_inbox import business_state,forbid_writes


def test_precision_answer_uses_cards_repairs_exaggeration_and_preserves_thinking(client,fake_model,monkeypatch):
    w,s=study(client);tid=session(client,w,s);h=client.app.state.harness
    before=business_state(h.research.store);forbid_writes(client,monkeypatch)
    script,requests=fake_model
    good=('“CIGRE TB 880 · Case 0-1”有限元相对公布载流量偏差 -0.06083 %，来源报告第75页。'
          '“CIGRE TB 880 · Case 0-2”有限元相对公布载流量偏差 -2.187 %，来源报告第87页。'
          '两项均为部分复现：收敛检查通过，但偏差超过项目门槛；报告未给工程容差，不能称为整体验证通过。'
          '排管验证的限制说明共4条，本次省略2条，全文在该验证对象的家。'
          '这是保存验证包装器与方法版本的结果，不证明当前生产能力或任意工程的精度；工程使用仍需人工复核。')
    first=call('object_find',{'kind':'validation','q':'CIGRE TB 880','limit':2})
    first['choices'][0]['message']['reasoning_content']='先查保存算例，收敛与复现状态分别解释。'
    bad='两项算例均已通过验证，偏差符合 CIGRE 工程容差。'
    script.extend([first,answer(bad),answer(good)])
    start=perf_counter();events=send(client,tid,'有限元和 IEC 准不准，和公开算例差多少？');elapsed=perf_counter()-start
    record=h.tasks.record(tid);text=final_text(events)
    assert text==good and len(requests)==3 and record['budget']['tool_calls']==1
    rejected=next(e['data'] for e in record['events'] if e['type']=='answer.rejected')
    assert rejected['draft']==bad and rejected['issues'][0]['code']=='UNSUPPORTED_VALIDATION_CLAIM'
    feedback=requests[-1]['messages'][-1]
    assert feedback['role']=='tool' and 'partial' in feedback['content']
    assert all('tools' not in request for request in requests[2:])
    assert any(m.get('reasoning_content')==first['choices'][0]['message']['reasoning_content'] for m in requests[-1]['messages'])
    refs=next(data['object_refs'] for kind,data in events if kind=='message.delta')
    assert [ref['id'] for ref in refs]==['B02-1','B02-2']
    assert all(ref['status']['code']=='partial' for ref in refs)
    facts=quantity_facts(record['results'])
    assert {f['validation_id'] for f in facts if f.get('unit')=='%'}=={'B02-1','B02-2'}
    assert all(f['snapshot_digest'] for f in facts if f.get('validation_id'))
    assert len(encoded(record['results'][0]))<=RESULT_BYTES
    long=next(card for card in record['results'][0]['data']['items'] if card['id']=='B02-2')['validation']
    assert long['total_limitations']==4 and long['omitted_limitations']>0 and '验证对象的家' in long['omission_note']
    for invalid in ('“CIGRE TB 880 · Case 0-1”偏差 -2.187 %。','偏差 99 %。',
                    '两项偏差均在项目门槛内。','两项算例均复现成功。','报告未给容差，但两项已通过验证。'):
        with pytest.raises(HTTPException):grounded_text(invalid,record['results'])
    assert grounded_text('保存仿真插件版本 1.1.0，方法 tb880-isothermal-p2/1；不是当前生产能力的精度证明。',record['results'])
    unknown=deepcopy(record['results'])
    for card in unknown[0]['data']['items']:card['validation']['convergence_passed']=None
    with pytest.raises(HTTPException):grounded_text('两项收敛检查通过。',unknown)
    assert not record['proposals'] and not any(e['type']=='answer.fallback' for e in record['events'])
    assert business_state(h.research.store)==before
    print('\n公开算例精度假模型 '+json.dumps({**metrics(record,elapsed),'answer':text},ensure_ascii=False))
