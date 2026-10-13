"""Actual HTTP timings and configured-model acceptance on a release-library copy."""
import os
from time import perf_counter as monotonic

import pytest
from test_harness_real_use import real_use,projects

pytestmark=pytest.mark.skipif(os.environ.get('CABLESIM_AGENT_REAL_USE')!='1',reason='Explicit real host/model acceptance only')


def test_real_study_cards_and_inbox(real_use):
    run=real_use;phase=os.environ.get('CABLESIM_INDEX_MEASUREMENT_PHASE','after')
    # A hot reload follows a completed read of this actual endpoint. Retain its
    # first-use timing separately; never fold it into or hide it among hot reads.
    started=monotonic()
    first=run.api('GET','/api/index/objects',params={'kind':'study','limit':100,'offset':0})
    first_read={'elapsed_ms':(monotonic()-started)*1000,'total':first['total']}
    samples=[]
    for _ in range(10):
        start=monotonic()
        with run.client.stream('GET','/api/index/objects',params={'kind':'study','limit':100,'offset':0}) as response:
            first_byte_ms=(monotonic()-start)*1000
            response.raise_for_status();response.read()
            cards=response.json()
        sample={'first_byte_ms':first_byte_ms,'elapsed_ms':(monotonic()-start)*1000,'total':cards['total'],
            'server_ms':float(response.headers['X-Acceptance-Server-Ms'])}
        sample['index_read']=run.api('GET','/__acceptance/index-timing')['read'];samples.append(sample)
        assert cards['total']>0 and len(cards['items'])==min(cards['total'],100)
    measured={'first_read':first_read,'samples':samples,'cards':cards,
        'profile':run.api('GET','/__acceptance/index-profile'),'source_database':run.report['source_database']}
    history=run.report.setdefault('index_performance_attempts',[]);history.append({'phase':phase,**measured})
    run.report.setdefault('index_performance',{})[phase]=measured
    run.save()
    if phase=='before':return
    assert max(sample['elapsed_ms'] for sample in samples)<=200,samples
    consistency=run.api('GET','/__acceptance/execution-consistency')
    measured['execution_consistency']=consistency;run.save()
    assert consistency['equal_to_host'] and consistency['saved_runs']>0,consistency
    workspaces,_=projects(run)
    record,item=run.ask('inbox_after_index_optimization',workspaces[0]['id'],'帮我理一下待办，按原因分组说明下一步和处理人。',
        recipe={'id':'inbox_triage','parameters':{}})
    assert record['budget']['model_requests']<=2,item
    assert any(refs for refs in item['object_refs']),item
    assert not record['proposals'] and all(step['tool']=='inbox_read' for step in record['steps']),item
    item['acceptance']='passed';run.save()


def test_real_saved_scheduler_receipts_match_host(real_use):
    run=real_use
    comparison=run.api('GET','/__acceptance/execution-consistency')
    run.report['saved_scheduler_comparison']=comparison;run.save()
    assert comparison['equal_to_host'] and comparison['bundled_receipts']>0,comparison
