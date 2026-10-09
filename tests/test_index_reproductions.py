"""Verified immutable public-case evidence, refreshed without a TTL or solver."""
from hashlib import sha256
import json
from time import perf_counter
from tempfile import TemporaryDirectory
from pathlib import Path

from fastapi.testclient import TestClient
import pytest
from backend.main import create_app
from backend.harness.context_builder import encoded

# Saved TB 880:2022 Fig.25–26 pp.63–64, §§4.5.3.1 p.75 / 4.7.5 p.87.
# Numerical reproduction values come from the archived Slurm report identified
# in .data/fem-validation/integration.md; these fixtures never execute a solver.
PUBLIC_CASES=[('B02-1','0-1',821.2764805349443,821.7763334392,75),
              ('B02-2','0-2',667.8823899920255,682.81446487,87)]


def cases():
    items=[{'id':id,'title':'CIGRE TB 880 · Case '+case,'status':'partial','kind':'standard',
        'citation':'CIGRE TB 880:2022','scope':'相切单芯工况；验证包装器，不是发布工程能力',
        'reference_location':'TB 880:2022 p.'+str(page),'inputs':[{'source':'TB 880:2022','pdf_page':page,'printed_page':page}],
        'rows':[{'id':'fem-current','variant':'有限元 · 收敛网格','quantity':'ampacity_a','unit':'A',
            'reference':reference,'open_source':value,'difference':value-reference,
            'relative_difference':(value-reference)/reference,'status':'outside_tolerance',
            'source':'TB 880:2022 p.'+str(page),'tolerance':{'absolute':.001,'unit':'A','source':'项目复现门槛；非报告容差'}}],
        'runs':[{'plugin_id':'cablesim.simulation','plugin_version':'1.1.0','method_version':'tb880-isothermal-p2/1',
                 'engineering_approval':False,'source_sha256':'0b8af10b102252928b738964ca4c6e89c8f6ae1be1774df62fb54001422a2b8a'},
                {'plugin_id':'cablesim.iec60287','plugin_version':'0.4.0','method_version':'iec60287-group/0.3.0'}],
        'convergence_summary':{'passed':True},'report_tolerance':None,
        'limitations':['收敛通过不等于复现通过或工程批准；两例偏差均超过项目复现门槛。',
                       '报告未给数值容差；项目门槛不是 CIGRE 工程容差。']}
        for id,case,value,reference,page in PUBLIC_CASES]
    items[1]['limitations'].extend(['这是夹具中的完整长限制说明。'*600+'此条完整结束。',
                                   '这是另一条完整长限制说明。'*400+'另一条完整结束。'])
    metric=items[1]['rows'][0]
    items[1]['rows']=[{**metric,'id':'history-a','status':'not_assessed'},
                      {**metric,'id':'history-b','status':'not_assessed'},
                      {**metric,'id':'limited-fem','status':'not_comparable'},metric]
    return items


def publish(root,items):
    raw=encoded({'schema':'cablesim.reproduction-library/1','created_at':'2026-10-09T06:09:33Z','items':items})
    digest=sha256(raw).hexdigest();(root/'snapshots').mkdir(parents=True,exist_ok=True)
    (root/'snapshots'/(digest+'.json')).write_bytes(raw)
    (root/'index.json').write_bytes(encoded({'current':digest,'history':[{'id':digest}]}))
    return digest


@pytest.fixture(autouse=True)
def library(tmp_path,monkeypatch):
    with TemporaryDirectory(prefix='reproductions-',dir=tmp_path) as temporary:
        root=Path(temporary);publish(root,cases())
        monkeypatch.setenv('CABLESIM_REPRODUCTION_LIBRARY',str(root))
        yield root


@pytest.fixture
def client(library,tmp_path):
    with TestClient(create_app(tmp_path/'workspace.sqlite')) as client:yield client


def test_corrupt_snapshot_is_explicit_and_restored_or_updated_library_refreshes(client,library):
    from test_research import study
    w,s=study(client)
    before=client.get('/api/index/inbox').json()
    api='/api/index/objects';first=client.get(api,params={'kind':'validation','q':'B02-1'}).json()['items'][0]
    digest=first['validation']['snapshot_digest'];path=library/'snapshots'/(digest+'.json');original=path.read_bytes()
    # JSON corruption and valid JSON with the wrong digest must both fail after
    # the old snapshot has already warmed. Never serve the old card or an empty list.
    for raw in (b'{broken',original+b' '):
        path.write_bytes(raw)
        for route in (api+'?kind=validation','/api/index/objects/validation/B02-1/relations'):
            response=client.get(route)
            assert response.status_code==503 and response.json()['detail']['code']=='INDEX_REPRODUCTION_INVALID'
        for route in (api,api+'?kind=project',api+'?kind=study',api+'?kind=type',
                      '/api/index/objects/study/'+s['id']+'/relations','/api/index/inbox'):
            response=client.get(route);assert response.status_code==200,response.text
            assert response.json()['source_errors'][0]['code']=='INDEX_REPRODUCTION_INVALID'
        relations=client.get('/api/index/objects/plugin/cablesim.simulation/relations').json()
        declared=[e['target'] for e in relations['uses'] if e['target']['subtype']=='declared']
        assert declared and any(e['role']=='validation' and '校验失败' in e['reason'] for e in relations['unresolved'])
        assert client.get('/api/index/objects/validation/'+declared[0]['id']+'/relations').status_code==200
        assert client.get(api,params={'kind':'validation','q':declared[0]['id']}).status_code==200
        inbox=client.get('/api/index/inbox').json()
        failures=[item for item in inbox['items'] if item['origin']=='validation']
        assert len(failures)==1 and failures[0]['title']=='复现库校验失败'
        assert failures[0]['object']['kind']=='validation' and inbox['counts']['missing']==before['counts']['missing']+1
        from backend.harness.inbox import read
        triage=read(client.app.state.research,{'category':'missing'}).data['items']
        assert any(item['origin']=='validation' and '在验证页' in item['next_step'] for item in triage)
        assert not any(card['subtype']=='reproduced' for card in client.get(api,params={'limit':100}).json()['items'])
        path.write_bytes(original)
        assert client.get(api,params={'kind':'validation','q':'B02-1'}).json()['items'][0]==first
        assert client.get('/api/index/inbox').json()['counts']==before['counts']
    (library/'index.json').write_text('{broken',encoding='utf-8')
    assert client.get(api,params={'kind':'validation'}).json()['detail']['code']=='INDEX_REPRODUCTION_INVALID'
    assert client.get('/api/index/inbox').status_code==200
    malformed=cases();malformed[1]['rows'][0]['reference']='not a number'
    publish(library,malformed)
    assert client.get(api,params={'kind':'validation'}).status_code==503
    assert client.get(api,params={'kind':'study'}).status_code==200
    all_cards=client.get(api,params={'limit':100}).json()['items']
    assert not any(card['subtype']=='reproduced' for card in all_cards)
    items=cases();items[0]['status']='missing_data';items[0]['rows']=[];items[0]['convergence_summary']={}
    updated=publish(library,items)
    card=client.get(api,params={'kind':'validation','q':'B02-1'}).json()['items'][0]
    assert card['status']['code']=='missing_data' and card['validation']['snapshot_digest']==updated
    assert not card['validation']['metrics'] and card['validation']['convergence_passed'] is None
    assert client.get('/api/index/inbox').json()['source_errors']==[]


def test_public_case_cards_pins_and_percentages_share_verified_snapshot(client,library,monkeypatch):
    research=client.app.state.research
    monkeypatch.setattr(research.executor,'run',lambda *a,**k:pytest.fail('index submitted a solver'))
    plugin='/api/index/objects/plugin/cablesim.simulation/relations'
    relations=client.get(plugin);assert relations.status_code==200,relations.text
    actual=[e for e in relations.json()['uses'] if e['target']['subtype']=='reproduced']
    assert {edge['target']['id'] for edge in relations.json()['uses'][:2]}=={'B02-1','B02-2'}
    page=client.get('/api/index/objects',params={'kind':'validation','q':'CIGRE TB 880','limit':2}).json()
    assert {card['id'] for card in page['items']}=={'B02-1','B02-2'}
    assert {e['target']['id'] for e in actual}=={'B02-1','B02-2'}
    assert all(e['role']=='validation' and e['freshness']=='current' for e in actual)
    assert all('部分复现' in e['reason'] and '%' in e['reason'] for e in actual)
    for edge in actual:
        card=edge['target'];evidence=card['validation'];metric=evidence['metrics'][0]
        assert edge['pinned']['digest']==evidence['snapshot_digest']
        assert card['status']['label']=='部分复现' and evidence['convergence_passed'] is True
        assert evidence['outside_tolerance']==1 and evidence['report_tolerance'] is None
        assert metric['relative_difference_percent']==pytest.approx((metric['open_source']-metric['reference'])/metric['reference']*100)
        public=next(row for row in PUBLIC_CASES if row[0]==card['id'])
        assert evidence['source_pages'][0]['printed_page']==public[-1]
        reverse=client.get('/api/index/objects/validation/'+card['id']+'/relations').json()['used_by']
        assert {e['target']['id'] for e in reverse}=={'cablesim.simulation','cablesim.iec60287'}
    assert any(e['target']['subtype']=='declared' and e['target']['validation'] is None for e in relations.json()['uses'])
    from backend.harness.object_index import read
    from backend.harness.context_builder import RESULT_BYTES
    full=next(e['target'] for e in actual if e['target']['id']=='B02-2')
    assert len(encoded(full))>RESULT_BYTES and full['validation']['limitations']==cases()[1]['limitations']
    found=read(research,'object_find',{'kind':'validation','q':'B02-2'}).model_dump(mode='json')
    assert found['status']=='ok' and len(encoded(found))<=RESULT_BYTES
    compact=found['data']['items'][0]['validation']
    assert compact['metrics']==full['validation']['metrics']
    assert any(row['id']=='limited-fem' and row['status']=='not_comparable' for row in compact['metrics'])
    assert compact['convergence_passed'] is True and compact['source_pages']==full['validation']['source_pages']
    assert compact['total_limitations']==len(full['validation']['limitations'])
    assert compact['omitted_limitations']==len(full['validation']['limitations'])-len(compact['limitations'])>0
    assert all(entry in full['validation']['limitations'] for entry in compact['limitations'])
    assert f"省略 {compact['omitted_limitations']} 条" in compact['omission_note'] and '验证对象的家' in compact['omission_note']
    assert compact['detail_ref']=={'kind':'validation','id':'B02-2','snapshot_digest':full['validation']['snapshot_digest'],'view':'results'}
    seen=[];offset=0
    for _ in range(100):
        result=read(research,'object_relations',{'kind':'plugin','id':'cablesim.simulation','offset':offset,'limit':20})
        assert result.status=='ok' and len(encoded(result.model_dump(mode='json')))<=RESULT_BYTES
        seen+=result.data['uses']
        if result.data['next_offset'] is None:break
        assert result.data['next_offset']>offset;offset=result.data['next_offset']
    else:pytest.fail('relation pagination did not advance')
    target=next(e['target'] for e in seen if e['target']['id']=='B02-2')
    assert target['validation']==compact and target['status']==full['status']
    start=perf_counter();assert client.get(plugin).status_code==200;elapsed=(perf_counter()-start)*1000
    print('\n复现关联热请求 ms:',round(elapsed,2))
