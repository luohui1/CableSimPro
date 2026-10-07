"""Bounded model context from fixed object identities and saved tool observations."""
import json

from backend.kernel.workspace import fingerprint


def messages(record):
    # Completed results are durable even if delivery of their SSE event was interrupted.
    outcomes={step['node_id']:step.get('result') for step in record['steps'] if step.get('result')}
    result=[]
    for message in record['messages']:
        if message['role']=='user':
            result.append({'role':'user','content':message['content']})
        elif message['role']=='assistant':
            calls=message.get('tool_calls') or []
            row={'role':'assistant','content':message.get('content') or None}
            if calls:
                # An unresolved call cannot be replayed as a successful observation.
                if any(call['id'] not in outcomes for call in calls):continue
                row['tool_calls']=[{'id':call['id'],'type':'function','function':{
                    'name':call['name'],'arguments':json.dumps(call['arguments'],ensure_ascii=False,separators=(',',':'))}}
                    for call in calls]
            result.append(row)
            for call in calls:
                result.append({'role':'tool','tool_call_id':call['id'],
                    'content':json.dumps(outcomes[call['id']],ensure_ascii=False,separators=(',',':'))})
    # Preserve complete assistant/tool groups while bounding prior dialogue.
    while len(json.dumps(result,ensure_ascii=False).encode())>128*1024 and len(result)>1:
        result.pop(0)
        while result and result[0]['role']=='tool':result.pop(0)
    return result


def summary(record):
    identity={key:record[key] for key in ('id','workspace_id','workspace_revision','study_id','study_revision')}
    return {**identity,'budget':record['budget'],
        'proposals':[{'id':value['id'],'title':value['title'],'status':value['status']} for value in record['proposals']],
        'unknown_operations':[step['operation_id'] for step in record['steps'] if step['state']=='unknown']}


def request_summary(model,prompt,tools):
    return {'model':model,'messages_digest':fingerprint(prompt),'message_count':len(prompt),
        'tool_names':[tool['function']['name'] for tool in tools],
        'tool_contract_digest':fingerprint(tools),'credentials_recorded':False}
