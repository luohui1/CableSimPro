"""Actual host capability discovery, local transport and model authority boundaries."""
from fastapi import HTTPException
from pydantic import BaseModel
import pytest

from backend.harness.context_builder import compress_result, encoded
from backend.harness.evidence import grounded_text, quantity_facts
from backend.harness.platform import evidence_view, page
from test_harness import fake_model, session, send, call, answer
from test_harness_adaptive import batch
from test_research import client


def operation(harness, path, method='GET'):
    return next(card['id'] for _,card,_ in harness.platform.catalog().values()
                if card['path']==path and card['method']==method)


def task(client):
    w=client.post('/api/workspaces',json={}).json()
    h=client.app.state.harness
    tid=session(client,w)
    turn=h.begin(tid,'检查平台能力。')
    with h.tasks.db() as db:record=h.tasks.load(db,tid)
    return h,w,record,turn


def register(client,path,endpoint,methods):
    # Modules are registered before the host's final unknown-API route.
    client.app.add_api_route(path,endpoint,methods=methods)
    route=client.app.router.routes.pop()
    index=next(i for i,r in enumerate(client.app.router.routes) if getattr(r,'path',None)=='/api/{path:path}')
    client.app.router.routes.insert(index,route)


@pytest.mark.parametrize('collection', ['object', 'array'])
def test_result_directory_with_long_unicode_paths_remains_navigable(collection):
    key = '规格/来源~' * 24
    entries = [{'position': index, 'description': '保存的完整来源说明。' * 400} for index in range(12)]
    value = {key: {str(index): entry for index, entry in enumerate(entries)} if collection == 'object' else entries}
    original = encoded(value)
    root = page(value, budget=2400)
    assert len(root['items']) == 1 and root['next_offset'] is None and not root['complete']
    directory = root['items'][0]
    path = '/' + key.replace('~', '~0').replace('/', '~1')
    assert directory['path'] == path and directory['omitted'] and directory['total_children'] == 12
    assert 0 < len(directory['children']) < directory['total_children']
    assert len(encoded(root['items'])) <= 2400
    positions, offset = [], 0
    while offset is not None:
        current = page(value, path, offset, 3, budget=2400)
        assert current['items'] and len(encoded(current['items'])) <= 2400
        for item in current['items']:
            assert item['omitted']
            leaf = page(value, item['path'] + '/position', budget=2400)
            assert leaf['complete']
            positions.append(leaf['value'])
        continuation = current['next_offset']
        assert continuation is None or continuation > offset
        offset = continuation
    assert positions == list(range(12)) and encoded(value) == original


def test_an_unpageable_key_stops_with_a_reason_instead_of_a_repeating_cursor():
    value = {'first': '完整的第一项', '过长的字段名' * 500: {'source': '保存内容' * 1000}, 'last': '仍在原始记录'}
    first = page(value, budget=2400)
    assert first['items'] == [{'path': '/first', 'value': '完整的第一项'}]
    assert first['next_offset'] == 1
    blocked = page(value, offset=first['next_offset'], budget=2400)
    assert blocked['items'] == [] and blocked['omitted'] and not blocked['complete']
    assert blocked['total'] == 3 and blocked['offset'] == 1 and blocked['next_offset'] is None
    assert '路径' in blocked['reason'] and '未跳过或截断' in blocked['reason']
    assert len(encoded(blocked)) < 2400


def test_a_zero_length_page_is_rejected_before_it_can_repeat_forever():
    with pytest.raises(HTTPException) as rejected:
        page([{'source': '保存内容' * 1000}], limit=0, budget=2400)
    assert rejected.value.detail['code'] == 'PLATFORM_PAGE_INVALID'


def test_platform_discovers_actual_modules_new_routes_and_reads_original_data(client):
    h,w,t,turn=task(client)
    cards=[card for _,card,_ in h.platform.catalog().values()]
    registered={(method,r.path) for r in client.app.routes if hasattr(r,'unique_id') and r.include_in_schema
                and r.path.startswith('/api/') and not r.deprecated for method in r.methods}
    assert {(c['method'],c['path']) for c in cards}==registered
    assert any(c['path'].startswith('/api/types') for c in cards)
    assert any(c['path'].startswith('/api/documents') for c in cards)
    assert any(c['path'].startswith('/api/foundation') for c in cards)
    op=operation(h,'/api/foundation/assets')
    with pytest.raises(HTTPException) as error:h.platform.read(t,{'operation':op})
    assert error.value.detail['code']=='PLATFORM_INSPECTION_REQUIRED'
    h.platform.discover(t,{'operation':op})
    result=h.platform.read(t,{'operation':op})
    assert result.data['response']==client.get('/api/foundation/assets').json()
    assert result.data['source']['read_only']
    # New modules appear without a new tool or a special intent classifier.
    register(client,'/api/new-module/records',lambda:{'items':['保存条目']},['GET'])
    fresh=operation(h,'/api/new-module/records')
    h.platform.discover(t,{'operation':fresh})
    assert h.platform.read(t,{'operation':fresh}).data['response']=={'items':['保存条目']}
    h.tasks.finish_turn(t['id'],turn,'completed',None)


def test_platform_schema_paging_and_handoffs_cannot_bypass_permissions(client):
    h,w,t,turn=task(client)
    calls=[]
    class RunBody(BaseModel):
        cores:int
    def start(body:RunBody):
        calls.append(body.cores)
        return {'status':'submitted'}
    register(client,'/api/new-module/run',start,['POST'])
    register(client,'/api/new-module/records',lambda:{'records':[{'name':str(i),'text':'完整说明。'*300} for i in range(20)]},['GET'])
    op=operation(h,'/api/new-module/run','POST')
    h.platform.discover(t,{'operation':op})
    with pytest.raises(HTTPException) as error:h.platform.prepare(t,{'operation':op,'body':{'cores':'many'}})
    assert error.value.detail['path']=='/body/cores'
    request=h.platform.prepare(t,{'operation':op,'body':{'cores':8}})
    assert request.data['request']['executed'] is False and request.data['request']['business_validation']=='pending'
    with pytest.raises(HTTPException) as error:h.platform.read(t,{'operation':op})
    assert error.value.detail['code']=='HUMAN_EXECUTION_REQUIRED' and not calls
    route=h.platform.operation(op)[0]
    route.openapi_extra={'x-agent-access':'reference'}
    assert h.platform.operation(op)[1]['mode']=='human'  # Metadata can only restrict authority.
    preflight=operation(h,'/api/workspaces/{wid}/studies/{sid}/preflight')
    assert h.platform.operation(preflight)[1]['mode']=='human'
    settings=operation(h,'/api/agent/settings')
    with pytest.raises(HTTPException):h.platform.discover(t,{'operation':settings})
    with pytest.raises(HTTPException):h.platform.read(t,{'operation':'https://example.com/'})
    workspace=operation(h,'/api/workspaces/{wid}')
    h.platform.discover(t,{'operation':workspace})
    with pytest.raises(HTTPException):h.platform.read(t,{'operation':workspace,'path_parameters':{'wid':'../agent/settings'}})
    register(client,'/api/new-module/scoped',lambda workspace: {'workspace_id':workspace},['GET'])
    scoped=operation(h,'/api/new-module/scoped')
    h.platform.discover(t,{'operation':scoped})
    with pytest.raises(HTTPException) as error:h.platform.read(t,{'operation':scoped,'query':{'workspace':'another-workspace'}})
    assert error.value.detail['code']=='SCOPE_VIOLATION' and error.value.detail['path']=='/query/workspace'
    large=operation(h,'/api/new-module/records')
    h.platform.discover(t,{'operation':large})
    first=h.platform.read(t,{'operation':large,'view':'/records','limit':2})
    projection=compress_result(first.model_dump(mode='json'))
    assert len(encoded(projection))<=6*1024
    assert projection['data']['page']['next_offset']==2
    assert all(row.get('omitted') for row in projection['data']['page']['items'])
    detail=h.platform.read(t,{'operation':large,'view':'/records/0/name'})
    assert detail.data['agent_projection']['page']['value']=='0'
    assert len(first.data['response']['records'])==20  # Original stays in the durable tool result.
    register(client,'/api/new-module/oversized',lambda:{'text':'x'*(1024*1024+1)},['GET'])
    oversized=operation(h,'/api/new-module/oversized')
    h.platform.discover(t,{'operation':oversized})
    with pytest.raises(HTTPException) as error:h.platform.read(t,{'operation':oversized})
    assert error.value.detail['code']=='PLATFORM_RESULT_TOO_LARGE'
    changed=client.post('/api/workspaces/'+w['id']+'/edit',json={
        'expected_revision':w['revision'],'changes':[{'path':'name','value':'改名后的工程'}]})
    assert changed.status_code==200,changed.text
    with pytest.raises(HTTPException) as error:h.platform.read(t,{'operation':workspace,'path_parameters':{'wid':w['id']}})
    assert error.value.detail['code']=='PLATFORM_CONTEXT_CHANGED'
    # Contract defaults and prepared request parameters never prove quantities.
    for kind in ('capability_catalog','capability_contract','capability_request'):
        with pytest.raises(HTTPException):grounded_text('允许电流999 A。',[{'data':{'projection':kind,'value':999,'unit':'A'}}])
    raw={'integrity':'failed','results':[{'value':999,'unit':'A'}]}
    evidence={'data':{'projection':'platform_read','response':raw,'evidence':evidence_view(h.research,raw)}}
    with pytest.raises(HTTPException):grounded_text('允许电流999 A。',[evidence])
    assert not quantity_facts([evidence_view(h.research,{'schema':{'default':{'value':999,'unit':'A'}}})])
    h.tasks.finish_turn(t['id'],turn,'completed',None)


def test_model_can_combine_platform_modules_with_zero_business_writes(client,fake_model):
    h=client.app.state.harness
    w=client.post('/api/workspaces',json={}).json()
    tid=session(client,w)
    assets=operation(h,'/api/foundation/assets')
    docs=operation(h,'/api/documents')
    create=operation(h,'/api/workspaces','POST')
    script,requests=fake_model
    script.extend([batch(call('platform_capabilities',{'operation':assets}),call('platform_capabilities',{'operation':docs}),
                         call('platform_capabilities',{'operation':create})),
                   batch(call('platform_read',{'operation':assets}),call('platform_read',{'operation':docs}),
                         call('platform_prepare',{'operation':create,'body':{}})),
                   answer('已读取资源与资料目录，并准备新建工程的人工请求。工程尚未创建，请在工程入口核对后操作。')])
    send(client,tid,'查资源和厂家资料，准备新建工程。')
    record=h.tasks.record(tid)
    assert record['state']=='waiting' and record['waiting_reason']=='scope_confirmation'
    assert record['budget']['model_requests']==3 and record['budget']['tool_calls']==6
    assert len(client.get('/api/workspaces').json())==1
    assert not record['proposals'] and any(e['type']=='platform.action.prepared' for e in record['events'])
    assert not any(e['type']=='answer.fallback' for e in record['events'])
    assert all(len(encoded(r.get('tools',[])))<=16*1024 for r in requests)
