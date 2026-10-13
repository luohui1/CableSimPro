"""Bounded model context from fixed object identities and saved tool observations."""
import json
from hashlib import sha256
from time import time

from backend.kernel.workspace import fingerprint

RESULT_BYTES=6*1024
METADATA_PROJECTIONS=frozenset({'task_progress','capability_catalog','capability_contract','capability_request','draft_catalog'})


def encoded(value):
    return json.dumps(value,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode()


def fits(value,maximum):
    size=0
    for chunk in json.JSONEncoder(ensure_ascii=False,separators=(',',':'),allow_nan=False).iterencode(value):
        size+=len(chunk.encode())
        if size>maximum:return False
    return True


def content_digest(value):
    digest=sha256()
    for chunk in json.JSONEncoder(sort_keys=True,ensure_ascii=False,separators=(',',':'),allow_nan=False).iterencode(value):digest.update(chunk.encode())
    return digest.hexdigest()


def compress_result(value,maximum=RESULT_BYTES):
    """Project a model observation; durable steps always retain the original JSON."""
    data=value.get('data') or {}
    if data.get('projection') in ('platform_read','draft_geometry','workspace_input','study_preflight') and 'agent_projection' in data:
        value={**value,'data':data['agent_projection']}
    if fits(value,maximum):return value
    result={key:value[key] for key in ('status','summary','execution_ref') if key in value}
    result.update(truncated=True,reason='已截断，可按 paths / key 继续读取',
        content_digest=content_digest(value),read_hint={'tool':'run_read' if (value.get('execution_ref') or {}).get('run_id') else 'workspace_read',
        'filters':['paths','entity','key','case_id','schema_path']})
    if data.get('projection')=='draft_input':
        result['read_hint']={'tool':'draft_read','view':'input',**({'draft_id':data['draft_id']} if data.get('draft_id') else {}),
            'filters':['paths'],'reason':'按草稿大纲的稳定路径分对象读取，不改读保存输入。'}
    remaining=maximum-len(encoded(result))-128
    def take(item,budget):
        if fits(item,budget):return item
        if isinstance(item,(dict,list)):
            output={} if isinstance(item,dict) else []
            priority=('proposal','enabled_tools','headlines','run_id','study_id','draft_id','input_digest','status','ready','partial','coverage','next_page','preview','persisted',
                'engineering_approval','source_run_id','source_case_id','proposal_id','method','parameter_fields','input_fields','fields','objects',
                'sections','materials','cable_types','circuits','load_cases','cases','factors','results','assessment','checks')
            pairs=sorted(item.items(),key=lambda row:priority.index(row[0]) if row[0] in priority else len(priority)) if isinstance(item,dict) else enumerate(item)
            for key,child in pairs:
                available=budget-len(encoded(output))-len(encoded(str(key)))-8
                if available<96:break
                selected=take(child,available)
                if isinstance(output,dict):output[key]=selected
                else:output.append(selected)
            return output
        return {'omitted':True}
    for key in ('data','diagnostics','next_actions','artifact_refs'):
        if key in value and remaining>96:
            result[key]=take(value[key],remaining)
            remaining=maximum-len(encoded(result))-16
    # Envelope overhead and long summaries also count toward the byte limit.
    while len(encoded(result))>maximum:
        if 'artifact_refs' in result:result.pop('artifact_refs')
        elif 'data' in result:result.pop('data')
        else:result['summary']='工具结果已取得；已截断，可按 paths / key 继续读取';break
    return result


def messages(record):
    # Completed results are durable even if delivery of their SSE event was interrupted.
    outcomes={step['node_id']:step.get('result') for step in record['steps'] if step.get('result')}
    arguments={step['node_id']:step['arguments'] for step in record['steps'] if step.get('result')}
    # Host orchestration did not produce a model tool-call or a chain of thought.
    # Keep its receipts as observations, rather than inventing assistant history
    # that thinking providers require us to replay with reasoning_content.
    host_nodes={node['id'] for plan in record.get('plans',[]) for node in plan['body'].get('nodes',[])
        if str(node.get('provider_call_id','')).startswith(('host-recipe-','host-type-context-'))}
    # 思考模式（DeepSeek 等）：带工具的请求必须回传全部历史 reasoning_content；
    # 只在服务确实返回过思维链时才带这个字段，宿主自己生成的回答补空串，其他服务看不到它。
    thinking=any(message.get('reasoning_content') for message in record['messages'])
    result=[]
    for message in record['messages']:
        if message['role']=='user':
            result.append({'role':'user','content':message['content']})
        elif message['role']=='assistant':
            calls=message.get('tool_calls') or []
            if calls and (message.get('source')=='host' or all(call['id'] in host_nodes for call in calls)):
                observed=[{'tool':call['name'],'arguments':arguments.get(call['id'],call['arguments']),
                    'result':compress_result(outcomes[call['id']])} for call in calls if call['id'] in outcomes]
                if observed:result.append({'role':'user','content':encoded({'host_observations':observed}).decode()})
                continue
            row={'role':'assistant','content':message.get('content') or None}
            if thinking:row['reasoning_content']=message.get('reasoning_content') or ''
            if calls:
                # An unresolved call cannot be replayed as a successful observation.
                calls=[call for call in calls if call['id'] in outcomes]
                if not calls:continue
                row['tool_calls']=[{'id':call['id'],'type':'function','function':{
                    'name':call['name'],'arguments':json.dumps(arguments.get(call['id'],call['arguments']),ensure_ascii=False,separators=(',',':'))}}
                    for call in calls]
            result.append(row)
            for call in calls:
                result.append({'role':'tool','tool_call_id':call['id'],
                    'content':encoded(compress_result(outcomes[call['id']])).decode()})
    # Preserve complete assistant/tool groups while bounding prior dialogue.
    while len(encoded(result))>48*1024 and len(result)>1:
        result.pop(0)
        while result and result[0]['role']=='tool':result.pop(0)
    return result


def draft_card(value, revision, current_revision, *, created=None, now=None):
    """Candidate identity only; parameters and documents never become evidence here."""
    now=time() if now is None else now
    expired=value['expires']<=now
    outdated=value['workspace_revision']!=revision or current_revision!=revision
    status=('outdated' if outdated else 'expired' if expired else 'available')
    reason={'outdated':'保存输入的修订已变化，须重新建立草稿。',
        'expired':'候选已过期，须重新读取输入。',
        'available':'可按准确ID继续读取；使用时仍会核对原件、摘要、锁和修订。'}[status]
    row={key:value.get(key) for key in ('kind','id','draft_id','parent_id','workspace_revision','input_digest','expires')}
    if value['kind']=='simulation':
        row.update(title=value['definition'].get('title'),method=value['definition'].get('method'))
    return {**row,'created':created,'status':{'code':status,'reason':reason},
        'verification':'checked_on_use','engineering_approval':False}


def summary(record):
    identity={key:record[key] for key in ('id','workspace_id','workspace_revision','study_id','study_revision')}
    candidates=[row for row in record.get('plans',[]) if row['body'].get('kind') in ('draft','simulation')]
    cards=[draft_card(row['body'],record['workspace_revision'],record.get('current_workspace_revision',record['workspace_revision']),
        created=row['created']) for row in reversed(candidates[-6:])]
    return {**identity,'context':record.get('context'),'budget':record['budget'],
        **({'memory':record['memory']} if record.get('memory',{}).get('enabled') else {}),
        'drafts':{'items':cards,'total':len(candidates),'omitted':max(0,len(candidates)-len(cards)),
            'read_hint':{'tool':'draft_read','view':'catalog'},'engineering_approval':False},
        'proposals':[{'id':value['id'],'title':value['title'],'status':value['status']} for value in record['proposals']],
        'unknown_operations':[step['operation_id'] for step in record['steps'] if step['state']=='unknown']}


def request_summary(model,prompt,tools):
    return {'model':model,'messages_digest':fingerprint(prompt),'message_count':len(prompt),
        'tool_names':[tool['function']['name'] for tool in tools],
        'tool_contract_digest':fingerprint(tools),'definition_bytes':len(encoded(tools)),
        'prompt_bytes':len(encoded(prompt)),'credentials_recorded':False}
