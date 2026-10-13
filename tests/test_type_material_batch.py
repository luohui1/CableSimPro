"""Real host API material transactions using sourced, published reference assets."""
from copy import deepcopy
from uuid import uuid4

from fastapi.testclient import TestClient

from backend.main import create_app
from backend.kernel.scenarios import system_models
from frontend.scripts.engineering_resources import definitions, publish_resources


def test_batch_preview_atomic_reconfirmation_replay_and_history(tmp_path, monkeypatch):
    monkeypatch.setenv('CABLESIM_DATASETS_DIR', str(tmp_path/'datasets'))
    with TestClient(create_app(tmp_path/'materials.sqlite')) as client:
        def api(path, method='GET', body=None):
            response = client.request(method, path, json=body)
            assert response.status_code < 400, response.text
            return response.json()
        published = publish_resources(api)
        model = next(m for m in system_models() if m['id'] == 'system.specification-yjv22-300')
        workspace = api('/api/design/type-workspaces', 'POST', {'model_id': model['id'], 'content_sha256': model['content_sha256']})
        wid = workspace['id']; root = '/api/types/'+wid+'/resources'
        materials = workspace['domain']['materials']
        selected = [m for m in materials if m['id'] in ('material/cu', 'material/xlpe')]
        items = [{'target_id': m['id'], 'resource_id': published['material/'+('copper-conductor' if m['id']=='material/cu' else 'xlpe-mv')]['id']} for m in selected]
        fields = {'expected_revision': workspace['revision'], 'items': items}
        preview = api(root+'/material-preview', 'POST', fields)
        # This real YJV22 model also uses the same copper in its three screens.
        assert [r['layer_count'] for r in preview['rows']] == [6, 3]
        assert api('/api/workspaces/'+wid)['revision'] == workspace['revision']  # read-only preview
        confirm = {**fields, 'request_id': str(uuid4()), 'preview_digest': preview['digest'], 'reviewed_targets': [m['id'] for m in selected], 'human_confirmed': True}
        denied = client.post(root+'/material-confirm', json={**confirm, 'reviewed_targets': [selected[0]['id']]})
        assert denied.status_code == 409
        bound = api(root+'/material-confirm', 'POST', confirm)
        assert bound['revision'] == workspace['revision']+1 and len(bound['changed']) == 2
        assert api(root+'/material-confirm', 'POST', confirm) == bound
        saved = api('/api/workspaces/'+wid); document = deepcopy(saved['domain'])
        for material in document['materials']:
            if material['id'] == 'material/cu': material['density'] = 8889.
            if material['id'] == 'material/xlpe': material['density'] = 1200.
        api('/api/workspaces/'+wid+'/domain', 'PUT', {'expected_revision': saved['revision'], 'document': document})
        updated = api('/api/workspaces/'+wid)
        fields['expected_revision'] = updated['revision']
        preview = api(root+'/material-preview', 'POST', fields)
        densities = [next(d for d in r['differences'] if d['field']=='density') for r in preview['rows']]
        assert [d['after'] for d in densities] == [8889., 1200.]
        assert [d['before'] for d in densities] == [next(m['density'] for m in saved['domain']['materials'] if m['id']==r['id']) for r in preview['rows']]
        # An invalid second selection cannot partially write the first binding.
        invalid = {**fields, 'items': [items[0], {**items[1], 'resource_id': str(uuid4())}]}
        assert client.post(root+'/material-preview', json=invalid).status_code == 422
        assert client.post(root+'/material-confirm', json={**invalid, 'request_id':str(uuid4()), 'preview_digest':preview['digest'], 'reviewed_targets':[m['id'] for m in selected], 'human_confirmed':True}).status_code == 422
        assert api('/api/workspaces/'+wid)['revision'] == updated['revision']
        confirm = {**fields, 'request_id': str(uuid4()), 'preview_digest': preview['digest'], 'reviewed_targets': [m['id'] for m in selected], 'human_confirmed': True}
        assert client.post(root+'/material-confirm', json={**confirm, 'preview_digest': '0'*64}).status_code == 409
        result = api(root+'/material-confirm', 'POST', confirm)
        assert result['revision'] == updated['revision']+1
        assert all(t['state']=='current' for t in result['targets'] if t['id'] in {m['id'] for m in selected})
        archived = api('/api/workspaces/'+wid+'/revisions/'+str(saved['revision']))
        assert archived['state']['domain'] == saved['domain']
        assert client.post(root+'/material-confirm', json={**confirm, 'request_id': str(uuid4())}).status_code == 409


def test_exact_name_matching_requires_declared_category_and_one_published_version(tmp_path, monkeypatch):
    import json
    monkeypatch.setenv('CABLESIM_DATASETS_DIR', str(tmp_path/'datasets'))
    with TestClient(create_app(tmp_path/'exact.sqlite')) as client:
        def api(path, method='GET', body=None):
            response = client.request(method, path, json=body)
            assert response.status_code < 400, response.text
            return response.json()
        publish_resources(api)
        model = next(m for m in system_models() if m['id']=='system.specification-yjv22-300')
        workspace = api('/api/design/type-workspaces', 'POST', {'model_id': model['id'], 'content_sha256': model['content_sha256']})
        wid = workspace['id']; document = deepcopy(workspace['domain'])
        release = next(r.model_dump(mode='json') for r in definitions() if r.asset_id=='material/copper-conductor')
        material = next(m for m in document['materials'] if m['id']=='material/cu')
        material['label'] = release['name']
        api('/api/workspaces/'+wid+'/domain', 'PUT', {'expected_revision': workspace['revision'], 'document': document})
        def target(): return next(t for t in api('/api/types/'+wid+'/resources')['targets'] if t['id']==material['id'])
        assert target()['exact_name_match'] is None  # name alone is insufficient
        release['sources'].append({'kind':'project_input', 'reviewed':True, 'reference':json.dumps({'schema':'cablesim.material-identity/1', 'category':material['category']})})
        for version in ('1.0.1', '1.0.2'):
            release['version'] = version
            asset = api('/api/foundation/assets/import', 'POST', {'release':release})
            for action in ('review','publish'):
                asset = api('/api/foundation/assets/'+asset['id']+'/transition', 'POST', {'expected_revision':asset['revision'], 'content_sha256':asset['content_sha256'], 'action':action, 'acknowledge_sources':True, 'note':'隔离真实流程：保留标准参考值，明确声明材料类别。'})
            assert (target()['exact_name_match']==asset['id']) if version=='1.0.1' else (target()['exact_name_match'] is None)
        assert target()['binding'] is None  # suggestion never binds or approves
