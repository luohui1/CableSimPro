"""J4 complete candidate inputs, trust boundary, failed cases and report conclusion."""
from copy import deepcopy
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from backend.main import create_app
from backend.kernel.drivers import assess
from backend.kernel.scenarios import system_models


@pytest.fixture
def setup(tmp_path):
    app=create_app(tmp_path/'selection.sqlite')
    with TestClient(app) as c:
        models=system_models();model=models[0]
        w=c.post('/api/workspaces',json={}).json()
        converted=c.post(f'/api/workspaces/{w["id"]}/domain/conversion',json={'expected_revision':w['revision']})
        assert converted.status_code==200,converted.text
        w['revision']=converted.json()['revision']
        document=converted.json()['document']
        document['circuits'][0]['bonding']['kind']='both_ends'
        document['circuits'][0]['system']['kind']='ac_three_phase'
        saved=c.put(f'/api/workspaces/{w["id"]}/domain',json={'expected_revision':w['revision'],'document':document})
        assert saved.status_code==200,saved.text
        w['revision']=saved.json()['revision']
        method=next(m for m in c.get('/api/methods').json() if m['method']['plugin_id']=='cablesim.iec60287')['method']
        yield c,w,method,models


def candidate(c,model,reviewed=False):
    p=deepcopy(model['payload'])
    source={'kind':'user' if reviewed else 'demo','reference':'synthetic test only; human confirmation fixture','reviewed':reviewed}
    r=c.post('/api/domain-cable-models',json={'name':model['name'],'version':model['version'],**p,'sources':{'/cable_type':source},'confirmed':reviewed})
    assert r.status_code==201,r.text
    return r.json()


def definition(method,ids,demo):
    return {'title':'合成客户问询完整输入核验','input_source':'domain','task':'target','method':{**method,'capability':'steady-rating'},
            'parameters':{'ks':1,'kp':1,'t4_form':'exact','eddy':'ignored','solver':{'initial_sheath_temperature_c':70,'current_tolerance_a':1e-8,'max_iterations':100},'target_current_a':450,'target_circuit_id':'circuit/c1'},
            'driver':{'kind':'selection','candidate_ids':ids,'minimum':450,'allow_demo_candidates':demo,'target_entity':'circuit/c1','target_condition':'rating'}}


def run(c,w,config):
    s=c.post(f'/api/workspaces/{w["id"]}/studies',json={**config,'expected_revision':w['revision']})
    assert s.status_code==201,s.text
    root=f'/api/workspaces/{w["id"]}/studies/{s.json()["id"]}'
    p=c.get(root+'/preflight',params={'expected_revision':w['revision'],'expected_study_revision':1})
    return root,p


def test_complete_candidates_independent_solver_and_conclusion_first(setup):
    c,w,m,models=setup
    entries=[candidate(c,v,True) for v in models[:2]]
    config=definition(m,[v['id'] for v in entries],False)
    root,p=run(c,w,config);assert p.status_code==200,p.text
    r=c.post(root+'/runs',json={'expected_revision':w['revision'],'expected_study_revision':1,'request_id':str(uuid4()),'scope_acknowledged':True,'lock_digest':p.json()['lock_digest']})
    assert r.status_code==200,r.text
    r=r.json();assert r['status']=='succeeded',r.get('error') or [(v['case_id'],v.get('error')) for v in r.get('output',{}).get('cases',[])]
    assert len(r['output']['assessment'])==2
    assert [v['input']['cable_types'][0]['cores'][0]['conductor']['nominal_area'] for v in r['snapshot']['cases']]==pytest.approx([.00024,.0004])
    assert len({v['evidence']['prepared_input_sha256'] for v in r['output']['cases']})==2
    d=c.post(f'/api/workspaces/{w["id"]}/deliveries',json={'run_ids':[r['id']]})
    assert d.status_code==201,d.text
    html=d.json()['html'];assert html.index('data-result="selection"')<html.index('data-section="shared-input"')
    assert '满足的最小截面' in html and '余量 ' in html
    assert 'sha256' in html.lower()


def test_unreviewed_candidate_not_in_engineering_selection(setup):
    c,w,m,models=setup;entry=candidate(c,models[0])
    assert candidate(c,models[0])['id']==entry['id']  # Retry/import does not duplicate the immutable version.
    _,p=run(c,w,definition(m,[entry['id']],False))
    assert p.status_code==422 and '已核对' in p.text
    entry['payload']['confirmed']=True
    entry['payload']['sources']['/cable_type']['reviewed']=True
    assert c.post('/api/domain-cable-models',json=entry['payload']).status_code==422


def test_all_not_applicable_is_preserved_without_solver_or_fake_numbers(setup,monkeypatch):
    c,w,m,models=setup;model=deepcopy(models[0]);model['payload']['cable_type']['cores'][0]['conductor'].update(form='sectoral',diameter=.04,sector_angle_deg=120.,sector_rotation_deg=0.)
    entry=candidate(c,model)
    root,p=run(c,w,definition(m,[entry['id']],True))
    assert p.status_code==200 and not p.json()['ready']
    original=c.app.state.research.executor.run
    def forbidden(*a,**k):
        if k.get('phase')=='check':return original(*a,**k)
        raise AssertionError('no applicable candidate must not run a solver')
    monkeypatch.setattr(c.app.state.research.executor,'run',forbidden)
    r=c.post(root+'/runs',json={'expected_revision':w['revision'],'expected_study_revision':1,'request_id':str(uuid4()),'scope_acknowledged':True,'lock_digest':p.json()['lock_digest']})
    assert r.status_code==200,r.text
    a=r.json()['output']['assessment'][0]
    assert a['value'] is None and a['status']=='not_applicable'
    assert r.json()['output']['executions'][0]['executed'] is False
    assert c.post(f'/api/workspaces/{w["id"]}/deliveries',json={'run_ids':[r.json()['id']]}).status_code==201


def test_all_target_circuits_must_have_available_output_hand_check():
    d={'driver':{'kind':'selection','candidate_ids':['model'],'target_key':'ampacity','target_entity':'c1','target_entities':['c1','c2','c3'],'target_unit':'A','target_condition':'rating','minimum':400}}
    q=[{'type':'quantity','key':'ampacity','entity':e,'unit':'A','case':'rating','status':'available','value':v} for e,v in zip(['c1','c2','c3'],[450,399,430])]
    a=assess(d,[{'case_id':'case-0','status':'succeeded','results':q}])[0]
    assert a['value']==399 and a['margin']==-1 and a['status']=='not_satisfied'
    assert assess(d,[{'case_id':'case-0','status':'succeeded','results':q[:2]}])[0]['status']=='not_applicable'


def published():
    return {'name':'YJV22-8.7/15 kV 3×300','version':'manufacturer-publication',
        'specification':{'manufacturer':'江苏华远','designation':'YJV22','voltage_v':15000,'u0_v':8700,
            'cores':3,'area_m2':.0003,'conductor':'copper_bare',
            'values':{'conductor_diameter':{'value':.0206,'unit':'m','basis':'manufacturer','source':'factory'},
                      'r20':{'value':.0000601,'unit':'ohm/m','basis':'standard_limit','source':'r20'}},
            'missing':['填充材料热阻率']},
        'sources':{'factory':{'kind':'manufacturer','reference':'厂家公开结构尺寸表，3×300行；SHA256:source'},
                   'r20':{'kind':'standard','reference':'GB/T3956-2008 表2，PDF7页，标准上限'}}}


def test_published_specification_does_not_invent_or_approve_a_solver_model(setup,monkeypatch):
    c,w,m,_=setup;body=published();response=c.post('/api/domain-cable-models',json=body)
    assert response.status_code==201,response.text
    entry=response.json();assert entry['state']=='incomplete' and entry['payload']['cable_type'] is None
    assert c.post('/api/domain-cable-models',json=body).json()['id']==entry['id']
    assert c.post('/api/domain-cable-models',json={**body,'confirmed':True}).status_code==422
    body['specification']['values']['conductor_diameter']['unit']='ohm/m'
    assert c.post('/api/domain-cable-models',json=body).status_code==422
    body['specification']['values']['conductor_diameter'].update(unit='m',value=True)
    assert c.post('/api/domain-cable-models',json=body).status_code==422
    config=definition(m,[entry['id']],False)
    root,p=run(c,w,config);assert p.status_code==200 and not p.json()['ready']
    monkeypatch.setattr(c.app.state.research.executor,'run',lambda *a,**k:pytest.fail('incomplete product must never reach solver'))
    r=c.post(root+'/runs',json={'expected_revision':w['revision'],'expected_study_revision':1,'request_id':str(uuid4()),'scope_acknowledged':True,'lock_digest':p.json()['lock_digest']})
    assert r.status_code==200,r.text
    a=r.json()['output']['assessment'][0];assert a['status']=='not_applicable' and a['value'] is None
    report=c.post(f'/api/workspaces/{w["id"]}/deliveries',json={'run_ids':[r.json()['id']]})
    assert report.status_code==201,report.text
    assert 'data-result="selection"' in report.json()['html'] and 'CANDIDATE_DATA_MISSING' in report.json()['html']
    assert c.delete('/api/domain-cable-models/'+entry['id'],params={'expected_digest':entry['digest']}).status_code==409


def test_only_unused_draft_can_be_discarded_with_exact_digest(setup):
    c,w,m,_=setup;entry=c.post('/api/domain-cable-models',json=published()).json()
    assert c.delete('/api/domain-cable-models/'+entry['id'],params={'expected_digest':'wrong'}).status_code==409
    assert c.delete('/api/domain-cable-models/'+entry['id'],params={'expected_digest':entry['digest']}).status_code==204
    assert entry['id'] not in [v['id'] for v in c.get('/api/domain-cable-models').json()]


def test_temperature_reason_uses_saved_kelvin_goals_hand_check():
    definition={'driver':{'kind':'selection','candidate_ids':['model'],'target_key':'ampacity','target_entity':'c1','target_unit':'A','target_condition':'rating','minimum':400}}
    case={'case_id':'case-0','status':'succeeded','results':[{'key':'ampacity','entity':'c1','type':'quantity','unit':'A','case':'rating','status':'available','value':380}],
        'artifacts':{'trace':{'goal_checks':[{'key':'conductor_temperature','condition':'operating','unit':'K','entity':'cable/3','actual':369.15,'target':363.15,'current_a':400}]}}}
    record=assess(definition,[case])[0]
    assert record['reason']['actual_k']==369.15
    assert record['reason']['message']=='该截面在400 A 下导体温度 96.0 °C，超过 90 °C。'
    case['artifacts']['trace']['goal_checks'][0]['current_a']=450
    assert '450 A 下' in assess(definition,[case])[0]['reason']['message']
    del case['artifacts']['trace']['goal_checks'][0]['current_a']
    assert '保存负荷下' in assess(definition,[case])[0]['reason']['message']


def test_candidate_selection_uses_independent_common_rating_when_held_loads_fail():
    d={'driver':{'kind':'selection','candidate_ids':['x'],'target_key':'ampacity','target_entity':'c1','target_entities':['c1','c2'],'target_unit':'A','target_condition':'rating','rating_basis':'individual','minimum':400}}
    results=[{'type':'quantity','key':'ampacity','unit':'A','entity':e,'case':'rating','status':'unavailable','reason':{'code':'NO_POSITIVE_RATING'}} for e in ('c1','c2')]
    results += [{'type':'quantity','key':'ampacity','unit':'A','entity':e,'case':'rating-simultaneous','status':'available','value':182.} for e in ('c1','c2')]
    row=assess(d,[{'case_id':'case-0','status':'succeeded','results':results}])[0]
    assert row['value']==182 and row['status']=='not_satisfied' and row['margin']==-218
    assert row['rating_basis']=='simultaneous' and row['reason']['code']=='AMPACITY_BELOW_TARGET'
