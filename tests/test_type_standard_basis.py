"""Real Executor evidence, fixed editions and verdicts (no replacement limits)."""
from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor
import json
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from backend.main import create_app
from backend.kernel.scenarios import system_models
from backend.kernel.type_versions import structure_context
from backend.domain.models import DomainDocument
from test_standard_check import example, plugin, item


@pytest.mark.parametrize('hv,area,nominal,page,pdf,r20',[(False,300,4.5,7,15,.0601),(True,800,16,4,10,.0221)])
def test_fixed_basis_pages_and_pass_fail(tmp_path,hv,area,nominal,page,pdf,r20):
    app=create_app(tmp_path/'isolated.sqlite')
    with TestClient(app) as client:
        model=next(m for m in system_models() if m['id']=='system.cu-xlpe-al-240')
        w=client.post('/api/design/type-workspaces',json={'model_id':model['id'],'content_sha256':model['content_sha256']}).json()
        document=example(64000 if hv else 8700,110000 if hv else 15000,not hv,area)
        document.update(circuits=[],sections=[],load_cases=[])
        structure_context(document)
        standards=[plugin.SOURCES['hv' if hv else 'mv2'],plugin.SOURCES['conductor']]
        document['provenance']['/execution_standards']={'kind':'standard','reviewed':True,'reference':json.dumps({'schema':'cablesim.execution-standards/1','items':[{'standard':s['standard'],'source_digest':s['sha256']} for s in standards]})}
        document=DomainDocument.model_validate(document).model_dump(mode='json')
        response=client.put('/api/workspaces/'+w['id']+'/domain',json={'expected_revision':w['revision'],'document':document})
        assert response.status_code==200,response.text
        w={**w,'revision':response.json()['revision']}
        body={'request_id':str(uuid4()),'expected_revision':w['revision']}
        response=client.post('/api/design/type-workspaces/'+w['id']+'/requirements/basis',json=body)
        assert response.status_code==200,response.text
        answer=response.json()
        assert client.post('/api/design/type-workspaces/'+w['id']+'/requirements/basis',json=body).json()==answer
        params={'cable_type_id':document['cable_types'][0]['id'],**answer['parameters']}
        checked=plugin.check(document,params)
        insulation=item(checked,'insulation-nominal')
        assert (insulation['limit'],insulation['printed_page'],insulation['pdf_page'])==(nominal,page,pdf)
        assert insulation['verdict']=='passed'
        resistance=item(checked,'r20')
        assert resistance['limit']==r20 and resistance['printed_page']==4 and resistance['pdf_page']==7
        assert '第 '+str(page)+' 页' in insulation['citation']
        # A modified design requires a new input pin; the reference still contains
        # the exact same verified table row and never turns into a design value.
        changed=deepcopy(document);changed['cable_types'][0]['cores'][0]['layers'][1]['thickness']=(nominal-.2)/1000
        from cablesim_standard_check.basis import digest
        failed=plugin.check(changed,{**params,'basis_cable_sha256':digest(changed['cable_types'][0])})
        assert item(failed,'insulation-nominal')['verdict']=='failed'
        assert item(failed,'insulation-nominal')['citation']==insulation['citation']
        bad=deepcopy(params);reference=next(ref for ref in bad['basis_references'].values() if ref['record']['quantity']['key']=='insulation_nominal')
        reference['record']['value']=.1
        reference['record_sha256']=digest({k:v for k,v in reference['record'].items() if k not in ('record_sha256','citation')})
        with pytest.raises(ValueError,match='封签'): plugin.check(document,bad)
        if hv:
            unsupported=deepcopy(document)
            insulation_material=unsupported['cable_types'][0]['cores'][0]['layers'][1]['material']
            next(m for m in unsupported['materials'] if m['id']==insulation_material)['standard_kind']='EPR'
            check=plugin.check(unsupported,{**params,'basis_cable_sha256':digest(unsupported['cable_types'][0])})
            assert item(check,'insulation-nominal')['verdict']=='uncovered'


def test_concurrent_basis_request_returns_one_immutable_receipt(tmp_path):
    with TestClient(create_app(tmp_path/'replay.sqlite')) as client:
        model=next(m for m in system_models() if m['id']=='system.cu-xlpe-al-240')
        response=client.post('/api/design/type-workspaces',json={'model_id':model['id'],'content_sha256':model['content_sha256']})
        assert response.status_code==201,response.text
        workspace=response.json();document=workspace['domain']
        document['provenance']['/execution_standards']={'kind':'standard','reviewed':True,'reference':json.dumps({
            'schema':'cablesim.execution-standards/1','items':[{'standard':s['standard'],'source_digest':s['sha256']}
                for s in [plugin.SOURCES['mv2'],plugin.SOURCES['conductor']]]})}
        saved=client.put('/api/workspaces/'+workspace['id']+'/domain',json={'expected_revision':workspace['revision'],'document':document})
        assert saved.status_code==200,saved.text
        body={'request_id':str(uuid4()),'expected_revision':saved.json()['revision']}
        endpoint='/api/design/type-workspaces/'+workspace['id']+'/requirements/basis'
        with ThreadPoolExecutor(max_workers=2) as pool:
            answers=list(pool.map(lambda _:client.post(endpoint,json=body),range(2)))
        assert all(answer.status_code==200 for answer in answers),[answer.text for answer in answers]
        assert answers[0].json()==answers[1].json()==client.post(endpoint,json=body).json()
