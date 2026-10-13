"""Real proposal, human records, live sealed lookup, and standards verdicts.

Independent arithmetic: inner lining 1.8 mm -> .8*1.8-.2 = 1.24 mm;
steel tape .5 mm -> .5*(1-.10) = .45 mm. Values 1.30/.46 pass,
1.23/.44 fail. Each tape gap is checked independently against .50.
These teaching observations are never copied from the standard's limits.
"""
import json
from datetime import date
from uuid import uuid4
from fastapi.testclient import TestClient
import pytest
from backend.main import create_app
from backend.plugin_host.executor import Executor


def test_live_manufacturing_rules_preserve_identity_measurements_and_missing_fields(tmp_path):
    with TestClient(create_app(tmp_path/'rules.sqlite')) as client:
        request={'schema_version':'cablesim.cable-design-request/2','voltage':'8700/15000','area_m2':240e-6,
            'construction':'three_core','conductor':'copper_bare','form':'solid_round','generation_mode':'complete',
            'screened':'yes','armour':'steel_tape','gap_m':0,'conductor_screen_thickness_m':.0007,
            'insulation_screen_thickness_m':.0007,'screen_tape_thickness_m':.0001,'screen_tape_width_m':.1}
        response=client.post('/api/types/creation-proposals',json={'request_id':str(uuid4()),'input':request})
        assert response.status_code==200,response.text
        proposal=response.json()
        response=client.post('/api/types',json={'request_id':str(uuid4()),'origin':'standard','name':'教学制造核对',
            'proposal_id':proposal['id'],'content_sha256':proposal['content_sha256'],'human_confirmed':True},headers={'X-CableSim-Actor':'human'})
        assert response.status_code==201,response.text
        saved=response.json();wid=saved['id']
        def check():
            response=client.post(f'/api/design/type-workspaces/{wid}/requirements/basis',json={'request_id':str(uuid4()),'expected_revision':saved['revision']})
            assert response.status_code==200,response.text
            case=Executor().run('cablesim.standard-check','dimensions',[{'case_id':'rules','input':saved['domain'],
                'parameters':{'cable_type_id':saved['domain']['cable_types'][0]['id'],**response.json()['parameters']}}]).cases[0]
            assert case.status=='succeeded',case.error
            return case.artifacts['x-cablesim.standard-check']['rows']
        def row(rows,key):return next(r for r in rows if r['id'].endswith(':'+key))
        rows=check()
        screens=[r for r in rows if r['id'].endswith(':screen-area')]
        assert len(screens)==3 and len({r['target']['core_id'] for r in screens})==3
        assert all(r['verdict']=='missing' and r['source_status']=='original-verified' and r['printed_page']==10 and len(r['engineering_inputs'])==4 for r in screens)
        assert all(r['formula'] is None for r in screens)  # Declared area is not a geometric derivation or capacity verdict.
        assert row(rows,'bedding-minimum')['limit']==pytest.approx(1.24,abs=1e-12)
        assert row(rows,'armour-tape-measured')['limit']==pytest.approx(.45,abs=1e-12)
        assert row(rows,'armour-separation')['source_status']=='input-missing'
        def measure(inner,tape):
            response=client.post(f'/api/types/{wid}/measurements',json={'expected_revision':saved['revision'],'request_id':str(uuid4()),
                'origin':'teaching','sample_id':'TEACH-MV-240','measured_on':date.today().isoformat(),'method':'教学投影仪测最薄点及按17.7.2测带厚',
                'reference':'教学记录，不用于厂家交付','acknowledge_measured':True,
                'values':[{'core':None,'role':'bedding','quantity':'minimum_thickness','value':inner,'unit':'mm'},
                          {'core':None,'role':'armour','quantity':'minimum_tape_thickness','value':tape,'unit':'mm'}]})
            assert response.status_code==200,response.text
            return response.json()
        saved=measure(1.30,.46);rows=check()
        assert row(rows,'bedding-minimum')['verdict']=='passed' and row(rows,'bedding-minimum')['printed_page']==18
        assert row(rows,'armour-tape-measured')['verdict']=='passed' and row(rows,'armour-tape-measured')['printed_page']==19
        assert 'TEACH-MV-240' in row(rows,'armour-tape-measured')['input_source']['reference']
        document=saved['domain'];armour=next(l for l in document['cable_types'][0]['common_layers'] if l['role']=='armour')
        material=next(m for m in document['materials'] if m['id']==armour['material']);material['standard_kind']='other'
        specs=row(rows,'armour-tape-gap')['engineering_inputs']+row(rows,'armour-separation')['engineering_inputs']
        for spec in specs:
            value=False if spec['type']=='boolean' else .4 if '1' in spec['field'].rsplit('/',1)[-1] else .6
            document['provenance'][spec['field']]={'kind':'user','reviewed':False,'reference':json.dumps({'schema':'cablesim.manufacturing-input/1','value':value,'unit':spec['unit'],'reference':'教学构造声明'})}
        response=client.put(f'/api/types/{wid}/document',json={'expected_revision':saved['revision'],'request_id':str(uuid4()),'document':document})
        assert response.status_code==200,response.text
        saved=response.json();rows=check()
        assert row(rows,'armour-material')['verdict']=='missing' and row(rows,'armour-material')['source_status']=='original-verified'
        assert row(rows,'armour-tape-gap')['verdict']=='failed' and row(rows,'armour-tape-gap')['per_layer_values']==[.4,.6]
        assert len(row(rows,'armour-tape-gap')['engineering_sources'])==2
        saved=measure(1.23,.44);rows=check()
        assert row(rows,'bedding-minimum')['verdict']=='failed' and row(rows,'armour-tape-measured')['verdict']=='failed'
        assert row(rows,'armour-underlayer')['verdict']=='failed'
        assert all(r['verdict']=='missing' for r in rows if r['id'].endswith(':screen-area'))
        document=saved['domain']
        armour=next(l for l in document['cable_types'][0]['common_layers'] if l['role']=='armour')
        armour['tape_count']=1;armour.pop('tape_application',None)
        response=client.put(f'/api/types/{wid}/document',json={'expected_revision':saved['revision'],'request_id':str(uuid4()),'document':document})
        assert response.status_code==200,response.text
        saved=response.json();rows=check()
        assert row(rows,'armour-tape-count')['verdict']=='failed'  # A known wrong count must not become merely "missing".
