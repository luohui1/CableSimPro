"""Model-declared goals, with completion and stagnation derived from real receipts."""
from hashlib import sha256
import json

from fastapi import HTTPException
from jsonschema import Draft202012Validator

from .contracts import ToolResult
from .context_builder import fits, RESULT_BYTES


def turn_steps(record):
    start = next((index for index in range(len(record['events']) - 1, -1, -1)
                  if record['events'][index]['type'] == 'chat.message' and
                  record['events'][index]['data'].get('role') == 'user'), -1)
    events = record['events'][start + 1:]
    operations = {row['data']['operation_id'] for row in events if row['type'] == 'tool.intent'}
    turn = record['events'][start]['data'].get('turn_id') if start >= 0 else None
    return [row for row in record['steps'] if row.get('operation_id') in operations or
            (turn is not None and row.get('turn_id') == turn)]


def contains(actual, expected):
    if isinstance(expected, dict):
        return isinstance(actual, dict) and all(key in actual and contains(actual[key], value)
                                              for key, value in expected.items())
    if isinstance(expected, list):
        return isinstance(actual, list) and all(any(contains(item, value) for item in actual) for value in expected)
    return type(actual) == type(expected) and actual == expected


def state(record, tools):
    current = turn_steps(record)
    turn = next((row['data'].get('turn_id') for row in reversed(record['events'])
                 if row['type'] == 'chat.message' and row['data'].get('role') == 'user'), None)
    plan = next((row['data']['goals'] for row in reversed(record['events'])
                 if row['type'] == 'task.goals' and row['data']['turn_id'] == turn), [])
    goals = []
    for goal in plan:
        sources, missing = [], []
        for required in goal['requires']:
            found = next((step for step in reversed(current) if step['tool'] == required['tool'] and
                          step.get('state') == 'succeeded' and
                          (step.get('result') or {}).get('status') == 'ok' and
                          contains(step.get('arguments') or {}, required.get('arguments', {}))), None)
            if found:
                sources.append(found['node_id'])
            else:
                missing.append(required)
        goals.append({'id': goal['id'], 'description': goal['description'], 'status': 'pending' if missing else 'satisfied',
                      'source_node_ids': sources, 'missing': missing})
    seen, stalled = set(), 0
    for step in current:
        tool = tools.get(step['tool'])
        if not tool or tool.kind != 'read' or tool.name == 'task_plan' or not step.get('result'):
            continue
        result = step['result']
        # Tool/receipt identity matters; timings and host operation IDs do not.
        observed = {'tool': tool.name, 'status': result['status'], 'data': result.get('data'),
                    'diagnostics': result.get('diagnostics')}
        digest = sha256(json.dumps(observed, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        stalled = stalled + 1 if digest in seen else 0
        seen.add(digest)
    return {'projection': 'task_progress', 'goals': goals, 'all_satisfied': bool(goals) and all(g['status'] == 'satisfied' for g in goals),
            'consecutive_unproductive_reads': stalled, 'distinct_observations': len(seen),
            'engineering_approval': False}


def update(tasks, registry, task, arguments):
    goals = arguments['goals']
    if not fits(goals, 4 * 1024):
        raise HTTPException(422, {'code': 'TASK_GOALS_TOO_LARGE', 'path': '/goals',
                                  'message': '目标清单须在4KiB内；引用准确对象和必要参数，不复制整份工程或契约。'})
    if len({goal['id'] for goal in goals}) != len(goals):
        raise HTTPException(422, {'code': 'TASK_GOAL_DUPLICATE', 'path': '/goals',
                                  'message': '目标ID须唯一；保留用户全部目标，不重复建项。'})
    available = registry.visible(tasks.record(task['id'],model_context=True))
    for index, goal in enumerate(goals):
        for required in goal['requires']:
            if required['tool'] not in available or required['tool'] in ('task_plan', 'recipe_execute'):
                raise HTTPException(422, {'code': 'TASK_GOAL_TOOL_INVALID', 'path': f'/goals/{index}/requires',
                                          'message': '目标的证据要求须指向本会话已开放的实际工具步骤；配方请列出展开后的工具。'})
            errors = list(Draft202012Validator(available[required['tool']].model()['function']['parameters']).iter_errors(required['arguments']))
            if errors:
                raise HTTPException(422, {'code': 'TASK_GOAL_ARGUMENTS_INVALID', 'path': f'/goals/{index}/requires',
                                          'message': '证据要求的参数不符合该工具契约：' + errors[0].message})
    event = {'turn_id': task['active_turn'], 'goals': goals, 'source': 'model', 'engineering_writes': False}
    candidate = tasks.record(task['id'],model_context=True)
    candidate['events'].append({'type': 'task.goals', 'data': event})
    result = ToolResult(status='ok', summary='任务目标已记录；完成状态由实际成功工具回执确定，未执行工程操作。',
                        data=state(candidate, available))
    if not fits(result.model_dump(mode='json'), RESULT_BYTES):
        raise HTTPException(422, {'code': 'TASK_GOALS_TOO_LARGE', 'path': '/goals',
                                  'message': '目标进度超过6KiB；减少重复描述并保留必要证据参数。'})
    tasks.emit(task['id'], 'task.goals', event)
    return result
