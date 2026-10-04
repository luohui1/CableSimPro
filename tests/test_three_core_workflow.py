"""One three-core cable per circuit, API binding and physical template counts."""
from copy import deepcopy
import importlib.util
from pathlib import Path
from uuid import uuid4
from fastapi.testclient import TestClient
import pytest
from backend.main import create_app
from backend.domain.models import DomainDocument
from backend.domain.guards import pointer
from design.workbench.scenarios import make_router,apply_layout


def design():
    # Reuse the declared primitive hand-check design, not a manufacturer model.
    path=Path(__file__).resolve().parents[1]/'plugins/cablesim.iec60287/tests/test_three_core.py'
    spec=importlib.util.spec_from_file_location('three_core_hand_check',path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    d=module.document()
    categories={'cu':'conductor','xlpe':'insulation','semi':'semiconductor','fibre':'filler','pvc':'polymer','steel':'metal','soil':'soil','duct':'duct'}
    for m in d['materials']:m.update(label=m['id'],category=categories[m['id'].split('/')[-1]])
    d['materials'][0]['standard_kind']='copper_bare'
    return DomainDocument.model_validate(d).model_dump(mode='json')


@pytest.mark.parametrize('kind,count,ducts',[
    ('three_core_buried_single',1,0),('three_core_buried_horizontal',3,0),
    ('three_core_ducts_horizontal',3,3),('three_core_ducts_2x3',6,6),('three_core_ducts_3x3',9,9)])
def test_three_core_template_counts_and_no_hidden_phase_sources(kind,count,ducts):
    result=apply_layout(design(),kind,1.2)
    assert len(result['circuits'])==count
    assert len(result['sections'][0]['placements'])==count
    assert len(result['sections'][0]['enclosures'])==ducts
    assert all(len(c['cables'])==1 and c['cables'][0]['phase']=='L1L2L3' for c in result['circuits'])
    again=apply_layout(result,'three_core_buried_single',1.2)
    assert len(again['circuits'])==1 and len(again['load_cases'][0]['currents'])==1


def test_new_study_only_catalog_retains_unreviewed_source_and_pinned_digest(tmp_path):
    app=create_app(tmp_path/'inquiry.sqlite');app.include_router(make_router(app.state.workspace_store))
    fallback=next(r for r in app.router.routes if getattr(r,'path',None)=='/api/{path:path}');app.router.routes.remove(fallback);app.router.routes.append(fallback)
    with TestClient(app) as client:
        d=design();created=client.post('/api/domain-cable-models',json={'name':'Explicit hand-check model','version':'1.0.0','cable_type':d['cable_types'][0],'materials':d['materials'],'sources':{'/cable_type':{'kind':'user','reference':'Isolated API test design with given SI primitive inputs','reviewed':False}},'confirmed':False})
        assert created.status_code==201,created.text
        cid=created.json()['id'];response=client.get('/api/design/study-cable-models');assert response.status_code==200,response.text
        catalog=response.json();model=next(m for m in catalog if m['id']=='candidate:'+cid)
        assert not any(m['id']=='candidate:'+cid for m in client.get('/api/design/cable-models').json())
        response=client.post('/api/design/study-workspaces',json={'model_id':model['id'],'content_sha256':model['content_sha256'],'three_core_layout':'three_core_ducts_horizontal','target_current_a':400})
        assert response.status_code==201,response.text
        w=response.json();assert w['study_cable_reference']['state']=='draft'
        assert len(w['domain']['circuits'])==3 and all(v==400 for v in w['domain']['load_cases'][0]['currents'].values())
        assert not w['domain']['provenance'][pointer('cable_types',w['domain']['cable_types'][0]['id'])]['reviewed']
        # Unused soil/duct materials in an imported payload never become cable
        # locks or silently replace the editable installation facts.
        assert not any(m['id'] in ('material/soil','material/duct') for m in model['payload']['materials'])
        saved=client.put(f'/api/workspaces/{w["id"]}/domain',json={'expected_revision':w['revision'],'document':w['domain']})
        assert saved.status_code==200,saved.text
        bad=client.post('/api/design/study-workspaces',json={'model_id':model['id'],'content_sha256':'0'*64})
        assert bad.status_code==409


def test_three_core_host_execution_validates_armour_quantities_and_snapshot(tmp_path):
    app=create_app(tmp_path/'three-core.sqlite')
    app.include_router(make_router(app.state.workspace_store))
    fallback=next(r for r in app.router.routes if getattr(r,'path',None)=='/api/{path:path}');app.router.routes.remove(fallback);app.router.routes.append(fallback)
    with TestClient(app) as c:
        doc=design();item=c.post('/api/domain-cable-models',json={'name':'宿主三芯手算输入','version':'hand-check','cable_type':doc['cable_types'][0],'materials':doc['materials'],'sources':{'/cable_type':{'kind':'user','reference':'Explicit hand-check primitive inputs, not manufacturer or approved engineering facts','reviewed':False}},'confirmed':False})
        assert item.status_code==201,item.text
        model=next(m for m in c.get('/api/design/study-cable-models').json() if m['id']=='candidate:'+item.json()['id'])
        saved=c.post('/api/design/study-workspaces',json={'model_id':model['id'],'content_sha256':model['content_sha256'],'three_core_layout':'three_core_ducts_horizontal','target_current_a':400})
        assert saved.status_code==201,saved.text
        w=saved.json()
        method=next(v['method'] for v in c.get('/api/methods').json() if v['method']['plugin_id']=='cablesim.iec60287')
        config={'title':'手算三芯完整宿主传输验证','input_source':'domain','method':{**method,'capability':'steady-rating'},
            'parameters':{'ks':1,'kp':1,'t4_form':'exact','eddy':'ignored','solver':{'initial_sheath_temperature_c':70,'max_iterations':300,'current_tolerance_a':1e-7},'duct':{'u':1.87,'v':.312,'y_per_k':.0037,'initial_mean_air_temperature_c':40}}}
        r=c.post('/api/workspaces/'+w['id']+'/studies',json={**config,'expected_revision':w['revision']});assert r.status_code==201,r.text
        root='/api/workspaces/'+w['id']+'/studies/'+r.json()['id']
        pre=c.get(root+'/preflight',params={'expected_revision':w['revision'],'expected_study_revision':1});assert pre.status_code==200 and pre.json()['ready'],pre.text
        run=c.post(root+'/runs',json={'expected_revision':w['revision'],'expected_study_revision':1,'request_id':str(uuid4()),'scope_acknowledged':True,'lock_digest':pre.json()['lock_digest']})
        assert run.status_code==200,run.text
        run=run.json();assert run['status']=='succeeded',run.get('error')
        case=run['output']['cases'][0];assert case['status']=='succeeded'
        assert len([q for q in case['results'] if q['key']=='x-cablesim.iec60287.loss_factor.armour'])==3
        trace=case['artifacts']['x-cablesim.iec60287-trace'];assert trace['verification']['passed']
        assert trace['operating']['cable_states'][0]['conductor_loss_w_m']==pytest.approx(sum(s['conductor_loss_w_m'] for s in trace['operating']['cable_states'][0]['cores']))
        delivery=c.post('/api/workspaces/'+w['id']+'/deliveries',json={'run_ids':[run['id']]});assert delivery.status_code==201,delivery.text
        html=delivery.json()['html']
        assert '整缆 T2' in html and 'λ2' in html and '逐芯损耗明细' in html
