"""Adaptive evidence gathering, object attribution and bounded read-only recovery."""
from dataclasses import replace
from copy import deepcopy

from fastapi import HTTPException
import pytest

from backend.harness.evidence import grounded_text
from backend.harness import progress as goal_progress
from test_harness import fake_model, session, send, call, answer
from test_harness_recipes import final_text
from test_harness_resilience import saved_run
from test_research import client


def test_quantities_are_bound_to_named_study_run_and_heading():
    evidence = [{'data': {'studies': [
        {'study_id': 'study-a', 'title': '甲研究', 'latest_run': {'run_id': 'run-a',
            'results': [{'key': 'ampacity', 'value': 100., 'unit': 'A'}]}},
        {'study_id': 'study-b', 'title': '乙研究', 'latest_run': {'run_id': 'run-b',
            'results': [{'key': 'ampacity', 'value': 200., 'unit': 'A'}]}}
    ], 'objects': [{'kind': 'run', 'id': 'run-a', 'name': '甲保存运行'},
                   {'kind': 'run', 'id': 'run-b', 'name': '乙保存运行'}]}}]
    for text in ('“乙研究”的允许电流为 200 A。', '**乙研究**\n\n允许电流 200 A。',
                 '“甲保存运行”的允许电流为 100 A。', '甲研究允许电流100 A；乙研究允许电流200 A。',
                 '甲研究允许电流100 A，乙研究允许电流200 A。'):
        assert grounded_text(text, evidence) == text
    for text in ('“乙研究”的允许电流为 100 A。', '**乙研究**\n\n允许电流 100 A。',
                 '“乙保存运行”的允许电流为 100 A。', '“乙研究”的允许电流为 999 A。',
                 '甲研究允许电流100 A，乙研究允许电流100 A。'):
        with pytest.raises(HTTPException) as error:
            grounded_text(text, evidence)
        assert error.value.detail['code'] == 'UNGROUNDED_QUANTITY'
        assert all(row.get('study_id') != 'study-a' for row in error.value.detail['issues'][0]['available_values'])
    # A model's proposed tool arguments are planning metadata, never witnesses.
    metadata = {'data': {'projection': 'task_progress', 'goals': [{'requires': [
        {'arguments': {'value': 999., 'unit': 'A'}}]}]}}
    with pytest.raises(HTTPException):
        grounded_text('负荷电流999 A。', evidence + [metadata])


def batch(*responses):
    result = responses[0]
    result['choices'][0]['message']['tool_calls'] = [tool for response in responses
        for tool in response['choices'][0]['message']['tool_calls']]
    return result


def test_model_goals_keep_productive_reads_open_and_stop_repeated_reads(client, fake_model):
    w, s, run = saved_run(client)
    harness = client.app.state.harness
    harness.tasks.limits = replace(harness.tasks.limits, max_read_tool_calls=1)
    tid = session(client, w, s)
    script, requests = fake_model
    path = '/sections/section~1s1/placements/cable~1c1-A/z'
    result_args = {'run_id': run['id']}
    input_args = {'run_id': run['id'], 'input_paths': [path]}
    goals = [
        {'id': 'conclusion', 'description': '解释保存研究结论', 'requires': [{'tool': 'run_read', 'arguments': result_args}]},
        {'id': 'inputs', 'description': '说明结论依据的保存敷设输入', 'requires': [{'tool': 'study_read', 'arguments': input_args}]}
    ]
    script.extend([batch(call('task_plan', {'goals': goals}), call('run_read', result_args)),
                   call('study_read', input_args), answer('保存结论与敷设输入已分别读取；数值以对应保存工况为依据。')])
    events = send(client, tid, '汇总这个研究的结论，并说明输入依据。')
    record = harness.tasks.record(tid)
    assert record['budget']['model_requests'] == 3 and record['budget']['tool_calls'] == 3
    assert requests[1].get('tools') and requests[2].get('tools')
    progress = next(row['data'] for row in reversed(record['events']) if row['type'] == 'task.progress')
    assert progress['all_satisfied'] and all(row['source_node_ids'] for row in progress['goals'])
    interrupted=deepcopy(record)
    next(step for step in interrupted['steps'] if step['tool']=='study_read')['state']='unknown'
    assert not goal_progress.state(interrupted,harness.registry.visible(record))['all_satisfied']
    assert not any(row['type'] == 'turn.answer_only' for row in record['events'])
    assert '尚未取得' not in final_text(events)
    # A digest does not prevent following up on an additional input question.
    script.extend([call('project_digest'), call('study_read', input_args), answer('摘要和保存输入已读取。')])
    send(client, tid, '汇总研究结论及输入依据。')
    record = harness.tasks.record(tid)
    assert record['budget']['model_requests'] == 3 and requests[-2].get('tools')
    assert not any(row['type'] == 'task.progress' and row['data']['goals'] for row in record['events'][-3:])
    # Repeated evidence closes tools while preserving the saved result and audit.
    script.extend([call('run_read', result_args), call('run_read', result_args), answer('已读取保存结果，重复读取未增加证据。')])
    send(client, tid)
    record = harness.tasks.record(tid)
    assert record['budget']['model_requests'] == 3 and not requests[-1].get('tools')
    assert any(row['type'] == 'turn.answer_only' and row['data']['reason'] == 'evidence_stalled' for row in record['events'])
    assert any(row['type'] == 'tool.result_reused' for row in record['events'])


def test_missing_evidence_repair_can_read_but_cannot_propose_or_run(client, fake_model, monkeypatch):
    w, s, run = saved_run(client)
    harness = client.app.state.harness
    tid = session(client, w, s)
    script, requests = fake_model
    soil = next(material for material in s['definition']['method_input']['materials'] if material['id'] == 'material/soil')
    text = f'保存输入的土壤热阻率为 {soil["thermal_resistivity"]} K·m/W。'
    rejected = answer(text)
    rejected['choices'][0]['message']['reasoning_content'] = '这里需要保存土壤物性证据。'
    script.extend([call('run_read', {'run_id': run['id']}), rejected,
        call('study_read', {'run_id': run['id'], 'input_paths': ['/materials/material~1soil/thermal_resistivity']}), answer(text)])
    monkeypatch.setattr(harness.research.executor, 'run', lambda *a, **k: pytest.fail('repair ran a solver'))
    events = send(client, tid, '说明这个研究的土壤输入依据。')
    record = harness.tasks.record(tid)
    assert final_text(events) == text and record['budget']['model_requests'] == 4, [(row['type'], row['data']) for row in record['events'] if row['type'] in ('answer.rejected','answer.repair_rejected')]
    assert not record['proposals'] and all(step['tool'] in ('run_read', 'study_read') for step in record['steps'])
    assert not any(row['type'] == 'answer.fallback' for row in record['events'])
    visible = harness.registry.visible(record)
    assert all(visible[row['function']['name']].kind == 'read' for row in requests[-2]['tools'])
    assert any(message.get('reasoning_content') == '这里需要保存土壤物性证据。' for message in requests[-2]['messages'])
    assert any(row['type'] == 'answer.repair' and row['data']['read_tools_allowed'] for row in record['events'])
    # A provider returning a hidden business call cannot use repair to gain authority.
    tid = session(client, w, s)
    script.extend([call('run_read', {'run_id': run['id']}), answer(text),
        call('propose_method_parameters', {'changes': [{'path': '/ks', 'value': .8, 'unit': '1'}]}),
        answer('尚未取得所问的土壤物性证据，需读取保存输入。')])
    send(client, tid, '说明土壤输入。')
    record = harness.tasks.record(tid)
    assert not record['proposals'] and [step['tool'] for step in record['steps']] == ['run_read']
    assert any(row['type'] == 'answer.repair_rejected' for row in record['events'])
