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
        # The receipt now also contains an Annex insulation lookup. Target the
        # exact row consumed above, not the first equal quantity in a mapping.
        bad=deepcopy(params);reference=bad['basis_references'][insulation['id']]
        assert reference==insulation['basis_reference']
        reference['record']['value']=.1
        reference['record_sha256']=digest({k:v for k,v in reference['record'].items() if k not in ('record_sha256','citation')})
        with pytest.raises(ValueError,match='封签'): plugin.check(document,bad)
        if not hv:
            from cablesim_standard_check.basis import BasisIntegrityError
            refs=params['basis_references']
            assert refs['insulation']['record']['id']==insulation['basis_reference']['record']['id']
            trace=checked['fictitious_diameter_trace']
            consumed={step['record']['id'] for step in trace}
            assert all(refs[key]['record']['id'] in consumed for key in
                       ('annex_conductor','annex_bedding','annex_oversheath'))
            assert item(checked,'oversheath-nominal')['limit']==3.5
            # Each altered record was actually consumed by the successful
            # chain. Recomputing the caller's own hash cannot reseal its value.
            cases=[]
            for key in ('insulation','annex_conductor','annex_bedding','annex_oversheath','annex_screen_table'):
                tampered=deepcopy(params);ref=tampered['basis_references'][key]
                if key=='annex_screen_table':
                    selected_id=refs['annex_screen_increment']['record']['id']
                    assert selected_id in consumed
                    record=next(record for record in ref['records'] if record['id']==selected_id)
                else:
                    record=ref['record']
                record['value']=.1
                forged=digest({k:v for k,v in record.items() if k not in ('record_sha256','citation')})
                record['record_sha256']=forged
                if key!='annex_screen_table':ref['record_sha256']=forged
                with pytest.raises(BasisIntegrityError,match='封签'):
                    plugin.check(document,tampered)
                cases.append({'case_id':key,'input':document,'parameters':tampered})
            # A complete list is more than individually authentic rows. The
            # original bug could omit the chosen lower gauge, obtain an honest
            # lookup for the next gauge, then complete an incorrect chain.
            from backend.kernel.requirements import lookup_references
            selected=refs['annex_screen_increment']['record']
            listed=refs['annex_screen_table']['records']
            larger=min((record for record in listed
                if record['conditions']['screen_area_m2']>selected['conditions']['screen_area_m2']),
                key=lambda record:record['conditions']['screen_area_m2'])
            query=deepcopy(refs['annex_screen_increment']['query'])
            query['conditions']={'screen_area_m2':larger['conditions']['screen_area_m2']}
            next_gauge,missing=lookup_references(app.state.research,{'annex_screen_increment':query})
            assert not missing and next_gauge['annex_screen_increment']['record_id']==larger['id']
            for mutation in ('omitted_gauge','duplicate_gauge','foreign_table'):
                tampered=deepcopy(params)
                rows=tampered['basis_references']['annex_screen_table']['records']
                rows[:]=[record for record in rows if record['id']!=selected['id']]
                if mutation=='omitted_gauge':
                    tampered['basis_references'].update(next_gauge)
                elif mutation=='duplicate_gauge':
                    rows.append(deepcopy(rows[0]))
                else:
                    rows.append(deepcopy(refs['annex_conductor']['record']))
                with pytest.raises(BasisIntegrityError,match='成员集合'):
                    plugin.check(document,tampered)
                cases.append({'case_id':mutation,'input':document,'parameters':tampered})
            reordered=deepcopy(params)
            reordered['basis_references']['annex_screen_table']['records'].reverse()
            assert plugin.check(document,reordered)['fictitious_diameter_trace']==trace
            for field, value in [('citation','伪造的来源与页码'),('record_sha256','0'*64)]:
                tampered=deepcopy(params)
                record=next(record for record in tampered['basis_references']['annex_screen_table']['records']
                            if record['id']==selected['id'])
                record[field]=value
                with pytest.raises(BasisIntegrityError,match='封签'):
                    plugin.check(document,tampered)
                cases.append({'case_id':'list-'+field,'input':document,'parameters':tampered})
            # The real plugin process must reject the whole case without a
            # partial requirements artifact, not turn bad evidence into gaps.
            rejected=app.state.research.executor.run('cablesim.standard-check','dimensions',cases)
            assert len(rejected.cases)==len(cases)
            for case in rejected.cases:
                assert case.status=='not_applicable' and not case.artifacts
                assert case.error['code']=='STANDARD_INPUT_INVALID'
                assert '封签' in case.error['message']
        if hv:
            unsupported=deepcopy(document)
            insulation_material=unsupported['cable_types'][0]['cores'][0]['layers'][1]['material']
            next(m for m in unsupported['materials'] if m['id']==insulation_material)['standard_kind']='EPR'
            check=plugin.check(unsupported,{**params,'basis_cable_sha256':digest(unsupported['cable_types'][0])})
            assert item(check,'insulation-nominal')['verdict']=='uncovered'


def test_complete_list_membership_matches_the_sealed_data_reader():
    from cablesim_standard_check import basis_catalog
    from cablesim_standard_check.basis import RECORDS, digest, validate_list
    from test_standards_basis import library_module
    assert basis_catalog.rebuild()==RECORDS
    library=library_module.BasisLibrary()
    for part,locator,count in [('1','表 A.3',16),('2','表 A.2',16),('3','表 A.2',16),('2','6.2',100)]:
        query={'schema_version':'cablesim.standards-query/1','operation':'list',
            'standard':'GB/T 12706.'+part,'edition':'2020','locator':locator}
        answer=library.query(query)
        assert answer['status']=='listed' and len(answer['records'])==count
        reference={'schema':'cablesim.standard-basis-list-ref/1','query':query,
            'query_sha256':digest(query),'plugin_version':answer['plugin_version'],'records':answer['records']}
        assert validate_list(reference,query)==answer['records']


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


def test_missing_query_fields_are_not_missing_standards(tmp_path):
    """An engineer clears class/material, then saves class 2 and re-queries the real library."""
    with TestClient(create_app(tmp_path/'input-repair.sqlite')) as client:
        model=next(m for m in system_models() if m['id']=='system.cu-xlpe-al-240')
        workspace=client.post('/api/design/type-workspaces',json={'model_id':model['id'],'content_sha256':model['content_sha256']}).json()
        document=example(64000,110000,False,800)
        document.update(circuits=[],sections=[],load_cases=[]);structure_context(document)
        document['provenance']['/execution_standards']={'kind':'standard','reviewed':True,'reference':json.dumps({'schema':'cablesim.execution-standards/1','items':[{'standard':plugin.SOURCES[key]['standard'],'source_digest':plugin.SOURCES[key]['sha256']} for key in ('hv','conductor')]})}
        document['cable_types'][0]['cores'][0]['conductor']['conductor_class']=None
        next(m for m in document['materials'] if m.get('standard_kind')=='XLPE')['standard_kind']=None
        def save_and_query():
            nonlocal workspace
            document_checked=DomainDocument.model_validate(document).model_dump(mode='json')
            saved=client.put('/api/workspaces/'+workspace['id']+'/domain',json={'expected_revision':workspace['revision'],'document':document_checked})
            assert saved.status_code==200,saved.text
            workspace={**workspace,'revision':saved.json()['revision']}
            response=client.post('/api/design/type-workspaces/'+workspace['id']+'/requirements/basis',json={'request_id':str(uuid4()),'expected_revision':workspace['revision']})
            assert response.status_code==200,response.text
            answer=response.json()
            return answer,plugin.check(document_checked,{'cable_type_id':document_checked['cable_types'][0]['id'],**answer['parameters']})
        missing,checked=save_and_query()
        assert {f['label'] for row in missing['missing_fields'] for f in row['fields']}=={'导体类别','绝缘材料标准类别'}
        for key in ('r20','insulation-nominal'):
            row=item(checked,key)
            assert row['verdict']=='missing' and row['source_status']=='input-missing'
            assert '缺字段' in row['reason'] and '未收录' not in row['reason']
        document['cable_types'][0]['cores'][0]['conductor']['conductor_class']=2
        next(m for m in document['materials'] if m['id']=='material/xlpe')['standard_kind']='XLPE'
        resolved,checked=save_and_query()
        assert resolved['missing_fields']==[]
        # GB/T 3956—2008 table 2, 800 mm² bare copper, 0.0221 Ω/km, printed page 4.
        resistance=item(checked,'r20')
        assert (resistance['limit'],resistance['printed_page'],resistance['source_status'])==(.0221,4,'original-verified')
        assert checked['rows'] and client.get('/api/workspaces/'+workspace['id']+'/revisions/'+str(workspace['revision']-1)).json()['state']['domain']['cable_types'][0]['cores'][0]['conductor']['conductor_class'] is None
