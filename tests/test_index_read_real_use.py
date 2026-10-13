"""Release-copy cold/contended index reads and actual free-text preflight use."""
import os
from concurrent.futures import ThreadPoolExecutor
from time import perf_counter

import pytest
from test_harness_real_use import real_use,projects

pytestmark=pytest.mark.skipif(os.environ.get('CABLESIM_AGENT_REAL_USE')!='1',reason='Explicit actual HTTP/model acceptance')


def test_real_index_reads_after_commit_and_during_page_reads(real_use):
    run=real_use;phase=os.environ.get('CABLESIM_INDEX_MEASUREMENT_PHASE','after')
    cards=run.api('GET','/api/index/objects',params={'kind':'cable_version','limit':100})['items']
    assert cards
    card=next((c for c in cards if c['id']=='1a83b117-7f4c-416c-b740-0d76afc89a92'),cards[0])
    workspaces,_=projects(run);w=workspaces[0]
    study=run.api('GET',f'/api/workspaces/{w["id"]}/studies',params={'view':'summary'})[0]
    relation=f'/api/index/objects/cable_version/{card["id"]}/relations'
    def measure(path,**kwargs):
        started=perf_counter()
        with run.client.stream('GET',path,**kwargs) as response:
            ttfb=(perf_counter()-started)*1000;response.read()
            value=response.json()
        return {'path':path,'status':response.status_code,'elapsed_ms':(perf_counter()-started)*1000,
            'first_byte_ms':ttfb,'bytes':len(response.content),'value':value,
            'index':run.api('GET','/__acceptance/index-timing') if path.startswith('/api/index/') else None}
    # Match the reported browser-cold route: the host is already started and
    # opening this read-only page does not commit a new Agent task.
    cold=measure(relation)
    # Separately measure a genuine source change, and prove its next read is
    # current. Do not mix source-rebuild latency with browser-cold navigation.
    created=run.api('POST','/api/agent/sessions',json={'workspace_id':w['id']})
    changed=measure(relation)
    visible=run.api('GET','/api/index/objects',params={'kind':'agent_task','q':created['id']})
    assert any(row['id']==created['id'] for row in visible['items']),visible
    with ThreadPoolExecutor(max_workers=5) as pool:
        paths=[relation,'/api/index/inbox','/api/index/objects?kind=study&limit=100&offset=0',
            f'/api/workspaces/{w["id"]}/studies?view=summary',f'/api/studies/{study["id"]}']
        concurrent=list(pool.map(measure,paths))
    hot=[measure('/api/index/objects',params={'kind':'study','limit':100}) for _ in range(10)]
    run.api('POST','/api/agent/sessions',json={'workspace_id':w['id']})
    profile=run.api('GET','/__acceptance/index-profile',params={'kind':'cable_version','id':card['id']})
    result={'phase':phase,'card':card,'cold_page_read':cold,'cold_after_commit':changed,
        'committed_task_visible':created['id'],'concurrent':concurrent,'hot':hot,'cold_profile':profile}
    run.report.setdefault('index_reads',{})[phase]=result;run.save()
    if phase=='before':return
    assert cold['status']==200 and cold['elapsed_ms']<=1000,cold
    assert all(row['status']==200 for row in concurrent),concurrent
    assert max(row['elapsed_ms'] for row in hot)<=200,hot


def test_real_free_preflight_question(real_use):
    from test_harness_free_questions import test_real_free_question_finishes_with_one_preflight
    test_real_free_question_finishes_with_one_preflight(real_use,
        '检查这个研究还缺哪些输入，说明已检查的范围和我下一步应该做什么。不要修改、试算或提交作业。')
    item=real_use.report['tasks'][-1]
    item['preflight_requests']=sum(step['tool']=='study_preflight' for step in item['steps'])
    item['acceptance']='passed' if item['preflight_requests']==1 else 'failed_duplicate_preflight'
    real_use.save()
    assert item['preflight_requests']==1,item


def test_real_inbox_after_index_changes(real_use):
    from test_harness_real_use import test_real_inbox_grouping_and_type_module_homes
    test_real_inbox_grouping_and_type_module_homes(real_use)
