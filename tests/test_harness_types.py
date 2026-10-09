"""Type input/approval behavior only: no native solver or real model credential."""
from copy import deepcopy
import json
from test_index_reproductions import library
from time import perf_counter

import pytest
from backend.domain.guards import pointer, value_at
from backend.harness.type_design import read
from backend.harness.evidence import grounded_text
from fastapi import HTTPException
from test_harness import fake_model, session, send, call, answer
from test_harness_recipes import metrics
from test_type_versions import client, workspace


def design(client):
    w=workspace(client);document=deepcopy(w['domain']);cable=document['cable_types'][0]
    cable['label']='起帆 110 kV · 型号接口验收样本'
    document['name']=cable['label']
    layers=cable['cores'][0]['layers'] or cable['common_layers']
    layer=next(layer for layer in layers if layer['role']=='insulation');layer['thickness']=.0162
    root=pointer('cable_types',cable['id'])
    path=root+(pointer('cores',cable['cores'][0]['id'],'layers','insulation','thickness') if cable['cores'][0]['layers'] else pointer('common_layers','insulation','thickness'))
    response=client.put(f'/api/workspaces/{w["id"]}/domain',json={'expected_revision':w['revision'],'document':document})
    assert response.status_code==200,response.text
    return {**w,'domain':response.json()['document'],'revision':response.json()['revision']},path


def test_type_proposal_is_reviewed_saved_once_and_answer_has_exact_card(client,fake_model,monkeypatch):
    script,requests=fake_model;w,path=design(client);tid=session(client,w)
    name=w['domain']['cable_types'][0]['label'];text=f'“{name}”的方案将绝缘厚度从 16.2 mm 调为 15.8 mm。外径、电气及载流量影响须在工作台保存后重新计算核验。'
    script.extend([call('type_read',{'type_id':w['id'],'view':'structure'}),call('propose_type_changes',{
        'type_id':w['id'],'changes':[{'path':path,'value':15.8,'unit':'mm'}],'reason':'调整绝缘厚度'}),answer(text)])
    import backend.harness.proposals as proposals
    ordinary=proposals.save_domain;saves=[]
    def saved(*args,**kwargs):saves.append(args[2].expected_revision);return ordinary(*args,**kwargs)
    monkeypatch.setattr(proposals,'save_domain',saved)
    monkeypatch.setattr(client.app.state.research.executor,'run',lambda *a,**k:pytest.fail('type editing invoked solver'))
    start=perf_counter();events=send(client,tid,'把起帆 110 kV 的绝缘厚度改成 15.8 mm 并说明影响');elapsed=perf_counter()-start
    record=client.app.state.harness.tasks.record(tid)
    assert record['state']=='reviewing' and not saves
    assert not any(e['type'] in ('answer.rejected','answer.fallback') for e in record['events'])
    p=record['proposals'][0];assert p['kind']=='type' and p['type_id']==w['id'] and p['base_revision']==w['revision']
    difference=next(c for c in p['changes'] if c['path']==path)
    assert (difference['before'],difference['after'],difference['unit'])==(16.2,15.8,'mm')
    # Hand unit conversion: 15.8 mm / 1000 = 0.0158 m; the ordinary save must preserve it.
    assert client.get('/api/index/inbox').json()['counts']['review']==1
    proposal_rel=client.get(f'/api/index/objects/proposal/{p["id"]}/relations').json()
    assert next(e for e in proposal_rel['uses'] if e['role']=='type')['pinned']['revision']==w['revision']
    card=client.get('/api/index/objects',params={'kind':'type','q':w['id']}).json()['items'][0]
    refs=next(d['object_refs'] for kind,d in events if kind=='message.delta' and 'object_refs' in d)
    assert refs==[card] and record['messages'][-1]['object_refs']==refs
    approve='/api/agent/proposals/'+p['id']+'/approve'
    assert client.post(approve).status_code==200
    assert client.post(approve).status_code==200 and saves==[w['revision']]
    current=client.get(f'/api/workspaces/{w["id"]}/domain').json()
    assert current['revision']==w['revision']+1 and value_at(current['document'],path)==pytest.approx(.0158)
    assert not current['document']['provenance'][path]['reviewed']
    assert client.get('/api/index/inbox').json()['counts']['review']==0
    print('\n型号方案假模型 '+json.dumps({**metrics(record,elapsed),'answer':text},ensure_ascii=False))


def test_type_diagnostics_identify_units_range_locks_and_revision_conflict(client):
    w,path=design(client);h=client.app.state.harness;tid=session(client,w);task=h.tasks.record(tid)
    for change,code in [({'path':path,'value':15.8,'unit':'m'},'DISPLAY_UNIT_MISMATCH'),
                        ({'path':path,'value':-1,'unit':'mm'},'TYPE_INPUT_INVALID'),
                        ({'path':path,'value':15.8},'TYPE_UNIT_REQUIRED'),
                        ({'path':path+'bad','value':15.8,'unit':'mm'},'FIELD_NOT_FOUND')]:
        with pytest.raises(HTTPException) as exc:h.proposals.type_changes(task,w['id'],[change],'字段验证')
        assert exc.value.detail['code']==code and exc.value.detail['path']==change['path']
    other=workspace(client)
    with pytest.raises(HTTPException) as exc:h.proposals.type_changes(task,other['id'],[{'path':path,'value':15.8,'unit':'mm'}],'越界')
    assert exc.value.detail['code']=='SCOPE_VIOLATION'
    lock=client.post(f'/api/workspaces/{w["id"]}/lock',json={'expected_revision':w['revision'],'path':path,'locked':True})
    assert lock.status_code==200,lock.text
    locked=client.app.state.workspace_store.snapshot(w['id']);locked_task=h.tasks.record(session(client,locked))
    with pytest.raises(HTTPException) as exc:h.proposals.type_changes(locked_task,w['id'],[{'path':path,'value':15.8,'unit':'mm'}],'锁字段')
    assert exc.value.detail['code']=='TYPE_FIELD_LOCKED' and exc.value.detail['path']==path
    # A proposal based on the earlier revision is never applied over the lock edit.
    p=h.proposals.type_changes(task,w['id'],[{'path':path,'value':15.8,'unit':'mm'}],'旧修订')
    response=client.post('/api/agent/proposals/'+p['id']+'/approve')
    assert response.status_code==409
    assert value_at(client.app.state.workspace_store.snapshot(w['id'])['domain'],path)==.0162
    assert h.tasks.record(tid)['proposals'][0]['status']=='pending'


def test_type_read_pages_saved_input_and_readonly_recipe_runs_before_one_answer(client,fake_model,monkeypatch):
    script,requests=fake_model;w,path=design(client);h=client.app.state.harness;tid=session(client,w);task=h.tasks.record(tid)
    monkeypatch.setattr(h.research.executor,'run',lambda *a,**k:pytest.fail('readonly recipe invoked solver'))
    args={'type_id':w['id'],'view':'summary','limit':2};items=[];cursors=set()
    while True:
        result=read(h.research,task,args).model_dump(mode='json')
        assert len(json.dumps(result,ensure_ascii=False,separators=(',',':')).encode())<=6*1024
        items.extend(result['data']['items']);args=result['data']['next_page']
        if not args:break
        assert args['after'] not in cursors;cursors.add(args['after'])
    assert next(row for row in items if row.get('path')==path)['value']==16.2
    assert not any(row['section']=='diameter_chain' for row in items)
    assert any(row['section']=='checks' and row['id']=='standards/missing' for row in items)
    with pytest.raises(HTTPException):grounded_text('最高允许电流 999 A。',[result])
    recipe=next(r for r in client.get('/api/agent/recipes').json() if r['id']=='type_review')
    assert recipe['parameters']['required']==['type_id']
    text='型号检查已读取保存输入；标准核对尚无保存运行，不能判断符合性。'
    scripted=answer(text);scripted['choices'][0]['message']['reasoning_content']='只解释宿主检查，不执行计算。';script.append(scripted)
    start=perf_counter();send(client,tid,recipe={'id':'type_review','parameters':{'type_id':w['id']}});elapsed=perf_counter()-start
    record=h.tasks.record(tid)
    assert len(requests)==1 and requests[0].get('tools',[])==[]
    assert all(step['tool']=='type_read' for step in record['steps']) and not record['proposals']
    assert record['workspace_revision']==w['revision']
    assert any(e['type']=='recipe.compiled' and e['data']['source']=='host' for e in record['events'])
    assert not any(e['type'] in ('answer.rejected','answer.fallback') for e in record['events'])
    assert record['messages'][-1]['reasoning_content']=='只解释宿主检查，不执行计算。'
    from backend.index import get_index
    cards=get_index(h.research).snapshot().cards;card=cards['type',w['id']];plugin=cards['plugin','cablesim.iec60287']
    nested={**record,'steps':[{'result':{'data':{'object':card,'properties':{'kind':{'type':'string'}}}}}]}
    refs=h.object_refs(tid,plugin['name']+'；'+card['name']+'；'+card['name'],nested)
    assert refs==[plugin,card]  # Schema fields called kind are not ObjectCards.
    from types import SimpleNamespace
    import backend.harness.object_refs as object_refs_module
    other={**card,'id':'other-type-id'}
    with monkeypatch.context() as patch:
        patch.setattr(object_refs_module,'get_index',lambda research:SimpleNamespace(
            snapshot=lambda:SimpleNamespace(cards={('type',card['id']):card,('type',other['id']):other})))
        ambiguous={**record,'steps':[{'result':{'data':{'objects':[card,other]}}}]}
        assert h.object_refs(tid,card['name'],ambiguous)==[]
        assert h.object_refs(tid,card['id'],ambiguous)==[card]
    # Isolated host-read receipt fixture: verify copying units/clauses/source,
    # without substituting a native geometry solver or claiming standard coverage.
    from backend.kernel.type_versions import Types
    run={'id':'receipt-run','study':'receipt-study','status':'succeeded','freshness':'historical',
        'input_digest':'a'*64,'output_digest':'b'*64,'snapshot':{'workspace_revision':w['revision'],'study_revision':1,
            'definition':{'method':{'plugin_id':'receipt-test','capability':'fixture','version':'1.0.0'}}}}
    channels={'geometry':{'run':run,'case_id':'receipt-case','artifact':{'outer_diameter_m':.08,'mass_kg_per_km':None,
        'layers':[{'role':'insulation','inner_diameter_m':.02,'outer_diameter_m':.0524}]}},
        'standards':{'run':run,'case_id':'receipt-case','artifact':{'rows':[{'id':'receipt-check','title':'receipt fixture',
            'standard':'fixture standard','clause':'fixture clause','verdict':'failed','reason':'fixture discrepancy',
            'actual':16.2,'limit':17,'unit':'mm'}]}}}
    state=client.app.state.workspace_store.snapshot(w['id'])
    monkeypatch.setattr(Types,'evidence',lambda self,wid:({'revision':w['revision']},state,channels,[]))
    for view,section in [('structure','diameter_chain'),('requirements','requirements')]:
        args={'type_id':w['id'],'view':view};saved=[]
        while True:
            result=read(h.research,task,args).model_dump(mode='json');saved.extend(result['data']['items'])
            assert len(json.dumps(result,ensure_ascii=False,separators=(',',':')).encode())<=6*1024
            args=result['data']['next_page']
            if not args:break
        evidence=next(row for row in saved if row['section']==section)
        assert evidence['source']['run_id']=='receipt-run' and evidence['source']['freshness']=='historical'
        if view=='structure':assert (evidence['value'],evidence['unit'])==(.08,'m')
        else:
            assert evidence['clause']=='fixture clause' and evidence['verdict']=='failed'
            assert evidence['quantities'][0]=={'key':'actual','value':16.2,'unit':'mm'}
    print('\n型号检查假模型 '+json.dumps(metrics(record,elapsed),ensure_ascii=False))
