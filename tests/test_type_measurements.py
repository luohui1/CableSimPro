"""Real design→human measurement receipt→sealed standard-check→specification.

Example observations are explicitly teaching data, not manufactured values.
The arithmetic is independent: tmin=4.1 > .9*4.5-.1=3.95 mm;
(4.7-4.1)/4.7=12.77% < 15%; deliberately replacing tmin by 3.8
must fail that requirement. No threshold is copied into a measurement input.
"""
from datetime import date
from uuid import uuid4
from io import BytesIO
import base64
import json
import pytest

from fastapi.testclient import TestClient
from reportlab.pdfgen.canvas import Canvas

from backend.main import create_app
from backend.plugin_host.executor import Executor


def test_real_measurement_revision_units_report_replay_and_standard_verdict(tmp_path):
    with TestClient(create_app(tmp_path/'measurements.sqlite')) as client:
        request = {'schema_version':'cablesim.cable-design-request/2','voltage':'8700/15000',
                   'area_m2':240e-6,'construction':'three_core','conductor':'copper_bare','form':'solid_round',
                   'generation_mode':'complete','screened':'yes','armour':'steel_tape','gap_m':0,
                   'conductor_screen_thickness_m':.0007,'insulation_screen_thickness_m':.0007,
                   'screen_tape_thickness_m':.0001,'screen_tape_width_m':.1}
        response=client.post('/api/types/creation-proposals',json={'request_id':str(uuid4()),'input':request})
        assert response.status_code==200,response.text
        proposal=response.json()
        response=client.post('/api/types',json={'request_id':str(uuid4()),'origin':'standard','name':'教学样品核对',
            'proposal_id':proposal['id'],'content_sha256':proposal['content_sha256'],'human_confirmed':True},headers={'X-CableSim-Actor':'human'})
        assert response.status_code==201,response.text
        saved=response.json();wid=saved['id'];revision=saved['revision'];core=saved['domain']['cable_types'][0]['cores'][0]['id']
        buffer=BytesIO();pdf=Canvas(buffer);pdf.drawString(40,800,'TEACHING SAMPLE - NOT A FACTORY TEST REPORT');pdf.save();data=buffer.getvalue()
        body={'expected_revision':revision,'request_id':str(uuid4()),'origin':'teaching','sample_id':'TEACH-240-A',
              'measured_on':date.today().isoformat(),'method':'教学投影仪测厚与搭盖比例示例','reference':'独立构造的教学记录，不作为厂家报告',
              'acknowledge_measured':True,'report':{'filename':'teaching-sample.pdf','content_base64':base64.b64encode(data).decode()},
              'values':[{'core':core,'role':'insulation','quantity':q,'value':v,'unit':'mm'} for q,v in [('minimum_thickness',4.1),('maximum_thickness',4.7)]]+
                       [{'core':core,'role':'metallic_screen','quantity':'minimum_overlap','value':8,'unit':'%'}]}
        bad={**body,'values':[{**body['values'][0],'unit':'%'}]}
        assert client.post('/api/types/'+wid+'/measurements',json=bad).status_code==422
        assert client.get('/api/workspaces/'+wid).json()['revision']==revision
        response=client.post('/api/types/'+wid+'/measurements',json=body)
        assert response.status_code==200,response.text
        measured=response.json();assert measured['revision']==revision+1
        assert client.post('/api/types/'+wid+'/measurements',json=body).json()['revision']==measured['revision']
        assert client.get(f'/api/workspaces/{wid}/revisions/{revision}').json()['state']['domain']['measurements']==[]
        observations=measured['domain']['measurements'];assert observations[0]['value']==pytest.approx(.0041,abs=1e-12)
        receipt=json.loads(observations[0]['source']['reference']);assert receipt['label']=='教学示例实测'
        response=client.get(f"/api/types/{wid}/measurements/reports/{receipt['report']['id']}")
        assert response.status_code==200 and response.content==data
        assert measured['domain']['cable_types'][0]['cores'][0]['layers'][1]['thickness']==.0045
        def checked(document,revision):
            response=client.post(f'/api/design/type-workspaces/{wid}/requirements/basis',json={'request_id':str(uuid4()),'expected_revision':revision})
            assert response.status_code==200,response.text
            case=Executor().run('cablesim.standard-check','dimensions',[{'case_id':'sample','input':document,
                'parameters':{'cable_type_id':document['cable_types'][0]['id'],**response.json()['parameters']}}]).cases[0]
            assert case.status=='succeeded',case.error
            return case.artifacts['x-cablesim.standard-check']
        artifact=checked(measured['domain'],measured['revision'])
        rows=[r for r in artifact['rows'] if r['target'].get('core_id')==core and r['id'].rsplit(':',1)[-1] in ('insulation-minimum','insulation-uniformity','screen-overlap-minimum')]
        assert len(rows)==3 and all(r['verdict']=='passed' and r['citation'] and r['basis_reference'] for r in rows)
        assert all('TEACH-240-A' in r['input_source']['reference'] for r in rows)
        body.update(expected_revision=measured['revision'],request_id=str(uuid4()),values=[{**body['values'][0],'value':3.8},body['values'][1]])
        response=client.post('/api/types/'+wid+'/measurements',json=body);assert response.status_code==200,response.text
        failed=response.json();artifact=checked(failed['domain'],failed['revision'])
        row=next(r for r in artifact['rows'] if r['target'].get('core_id')==core and r['id'].endswith(':insulation-minimum'))
        assert row['verdict']=='failed' and row['limit']==pytest.approx(3.95,abs=1e-12) and row['actual']==pytest.approx(3.8,abs=1e-12) and row['printed_page']==17
        response=client.post(f'/api/workspaces/{wid}/history/undo',json={'expected_revision':failed['revision']})
        assert response.status_code==200 and response.json()['domain']['measurements'][0]['value']==pytest.approx(.0041,abs=1e-12)
        assert client.get(f"/api/workspaces/{wid}/revisions/{failed['revision']}").json()['state']['domain']['measurements'][0]['value']==pytest.approx(.0038,abs=1e-12)
