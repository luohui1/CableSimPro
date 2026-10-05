"""Saved module identities, immutable inputs and loss-artifact trust boundaries."""
from copy import deepcopy
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from backend.main import create_app
from test_plugin_host import SYNTHETIC_IEC


@pytest.fixture
def setup(tmp_path):
    with TestClient(create_app(tmp_path/'module.sqlite')) as c:
        w=c.post('/api/workspaces',json={}).json()
        m=next(v for v in c.get('/api/methods').json() if v['method']['plugin_id']=='cablesim.iec60287')
        config={'title':'合成模块测试','method':{**m['method'],'capability':'reference-rating'},'input_source':'study','method_input':deepcopy(SYNTHETIC_IEC)}
        s=c.post(f'/api/workspaces/{w["id"]}/studies',json={**config,'expected_revision':1,'modules':{'thermal-field':config}})
        assert s.status_code==201,s.text
        yield c,w,s.json()


def run(c,w,s,module=None):
    root=f'/api/workspaces/{w["id"]}/studies/{s["id"]}'
    args={'expected_revision':w['revision'],'expected_study_revision':s['revision']}
    if module:args['module']=module
    pre=c.get(root+'/preflight',params=args)
    assert pre.status_code==200,pre.text
    body={**args,'request_id':str(uuid4()),'scope_acknowledged':True,'lock_digest':pre.json()['lock_digest']}
    value=c.post(root+'/runs',json=body)
    assert value.status_code==200,value.text
    return root,body,value.json()


def test_module_run_is_pinned_replayable_and_does_not_replace_primary(setup):
    c,w,s=setup
    root,body,r=run(c,w,s,'thermal-field')
    assert r['status']=='succeeded'
    assert r['snapshot']['module']=='thermal-field'
    assert r['snapshot']['study_definition']['modules']['thermal-field']==s['definition']['modules']['thermal-field']
    assert c.post(root+'/runs',json=body).json()['id']==r['id']
    assert c.post(root+'/runs',json={**body,'module':None}).status_code==409
    _,_,primary=run(c,w,s)
    assert 'module' not in primary['snapshot']
    assert primary['id']!=r['id']


def test_missing_module_refused_before_solver(setup):
    c,w,s=setup
    response=c.get(f'/api/workspaces/{w["id"]}/studies/{s["id"]}/preflight',params={'expected_revision':1,'expected_study_revision':1,'module':'not-saved'})
    assert response.status_code==422 and '尚未保存' in response.text


def test_other_module_edit_preserves_freshness_but_selected_edit_invalidates(setup):
    c,w,s=setup;root,_,r=run(c,w,s,'thermal-field')
    body={**deepcopy(s['definition']),'expected_revision':1,'expected_study_revision':1}
    body['title']='另一模块标题已变'
    saved=c.put(root,json=body).json()
    assert c.get(root+'/runs/'+r['id']).json()['freshness']=='current'
    body={**saved['definition'],'expected_revision':1,'expected_study_revision':saved['revision']}
    body['modules']['thermal-field']['method_input']['installation']['ambient_temperature_c']+=1
    assert c.put(root,json=body).status_code==200
    assert c.get(root+'/runs/'+r['id']).json()['freshness']=='historical'


def test_untrusted_loss_body_and_unknown_reference_fail_before_solver(setup):
    c,w,s=setup;root=f'/api/workspaces/{w["id"]}/studies/{s["id"]}'
    body={**deepcopy(s['definition']),'expected_revision':1,'expected_study_revision':1}
    body['parameters']['external_loss_artifact']={'schema':'cablesim.loss-coefficients/1'}
    saved=c.put(root,json=body).json()
    pre=c.get(root+'/preflight',params={'expected_revision':1,'expected_study_revision':saved['revision']})
    assert pre.status_code==422 and '不能直接替换' in pre.text


def test_module_schema_cannot_accept_replacement_inputs_in_run(setup):
    c,w,s=setup;root,body,_=run(c,w,s,'thermal-field')
    assert c.post(root+'/runs',json={**body,'method_input':SYNTHETIC_IEC}).status_code==422


def test_external_loss_reference_cannot_name_missing_run(setup):
    c,w,s=setup
    root=f'/api/workspaces/{w["id"]}/studies/{s["id"]}'
    body={**deepcopy(s['definition']),'expected_revision':1,'expected_study_revision':1}
    body['parameters']['external_loss_reference']={'run_id':str(uuid4()),'case_id':'case-0','artifact_type':'x-cablesim.loss-coefficients','artifact_sha256':'0'*64}
    saved=c.put(root,json=body)
    assert saved.status_code==200
    pre=c.get(root+'/preflight',params={'expected_revision':1,'expected_study_revision':saved.json()['revision']})
    assert pre.status_code==422
    assert '来源' in pre.text or '工件' in pre.text


@pytest.mark.parametrize('reference',[[{}],{'run_id':[]}])
def test_malformed_loss_reference_returns_field_error_not_server_failure(setup,reference):
    c,w,s=setup
    root=f'/api/workspaces/{w["id"]}/studies/{s["id"]}'
    body={**deepcopy(s['definition']),'expected_revision':1,'expected_study_revision':1}
    body['parameters']['external_loss_reference']=reference
    saved=c.put(root,json=body)
    assert saved.status_code==200
    pre=c.get(root+'/preflight',params={'expected_revision':1,'expected_study_revision':saved.json()['revision']})
    assert pre.status_code==422 and 'external_loss_reference' in pre.text


def test_editing_module_preserves_unchanged_historical_primary_pin(setup,monkeypatch):
    c,w,s=setup
    research=c.app.state.research
    resolve=research.resolve
    def checked(method,*args,**kwargs):
        if method['capability']=='obsolete-primary':
            from fastapi import HTTPException
            raise HTTPException(409,'historical primary')
        return resolve(method,*args,**kwargs)
    # Model a previously saved pin which became unavailable after installation.
    with research.store.db(True) as db:
        import json
        definition=deepcopy(s['definition'])
        definition['method']['capability']='obsolete-primary'
        db.execute('UPDATE study_versions SET definition=? WHERE study=? AND revision=1',(json.dumps(definition),s['id']))
    monkeypatch.setattr(research,'resolve',checked)
    body={**definition,'expected_revision':1,'expected_study_revision':1}
    body['modules']['thermal-field']['title']='只编辑模块'
    root=f'/api/workspaces/{w["id"]}/studies/{s["id"]}'
    saved=c.put(root,json=body)
    assert saved.status_code==200,saved.text
    assert saved.json()['definition']['method']==definition['method']
    assert c.get(root+'/preflight',params={'expected_revision':1,'expected_study_revision':2}).status_code==409
    assert c.get(root+'/preflight',params={'expected_revision':1,'expected_study_revision':2,'module':'thermal-field'}).status_code==200


def field_record():
    from cablesim_sdk.reproduction import digest
    mesh={'points':[[0.,0.],[1.,0.],[0.,1.]],'triangles':[[0,1,2]],'domain_ids':[1],'regions':[{'id':1,'uid':'region/test'}]}
    method={'plugin_id':'contract-test','version':'1','capability':'field'}
    field={'schema_version':'cablesim.temperature-field/1','source':{'run_id':'worker-test','case_id':'case-0','plugin_id':'contract-test','plugin_version':'1','capability':'field','input_sha256':digest(SYNTHETIC_IEC),'bundle_sha256':'b'*64,'manifest_sha256':'c'*64},
      'mesh':{**mesh,'sha256':digest(mesh),'representation':'linear triangular nodal field'},'temperature_k':[300.,301.,302.], 'time_s':0.,'samples':[],
      'hotspot':{'entity':'field','point_m':[0.,1.],'temperature_k':302.,'time_s':0.,'method':'node maximum'},'convergence':{'mesh_status':'not_assessed_single_mesh'}}
    return {'snapshot':{'cases':[{'case_id':'case-0','input':SYNTHETIC_IEC}],'definition':{'method':method}},'output':{'cases':[{'case_id':'case-0','artifacts':{'x-cablesim.temperature-field':field,'x-cablesim.simulation-bundle':{}},'artifact_digests':{'x-cablesim.temperature-field':'a'*64,'x-cablesim.simulation-bundle':'b'*64}}]}}


def test_field_contract_binds_input_bundle_and_mesh_without_silently_repairing():
    from backend.kernel.research import Research
    r=field_record()
    assert Research.artifact_status(r)['case-0']['x-cablesim.temperature-field']['status']=='verified'
    for key in ('input','bundle','mesh','index'):
        changed=deepcopy(r);f=changed['output']['cases'][0]['artifacts']['x-cablesim.temperature-field']
        if key=='input':f['source']['input_sha256']='0'*64
        elif key=='bundle':f['source']['bundle_sha256']='0'*64
        elif key=='mesh':f['mesh']['points'][0]=[.1,0]
        else:f['mesh']['triangles'][0]=[0,1,9]
        assert Research.artifact_status(changed)['case-0']['x-cablesim.temperature-field']['status']=='unavailable'
        assert changed!=r
