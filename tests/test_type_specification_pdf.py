"""A real PDF binds the specification revision and preserves missing data."""
from hashlib import sha256
from copy import deepcopy
import re
from uuid import uuid4

import fitz
from fastapi.testclient import TestClient

from backend.main import create_app
from backend.kernel.scenarios import system_models
from backend.kernel.specification_pdf import render_pdf
from backend.kernel.type_versions import check_results


def test_export_pdf_contains_version_and_saved_clause_sources(tmp_path):
    with TestClient(create_app(tmp_path/'pdf.sqlite')) as client:
        model = next(item for item in system_models() if item['id'] == 'system.cu-xlpe-al-compacted-400')
        response = client.post('/api/design/type-workspaces', json={'model_id':model['id'], 'content_sha256':model['content_sha256']})
        assert response.status_code == 201, response.text
        workspace = response.json()
        wid, revision = workspace['id'], workspace['revision']
        entry = next(item for item in client.get('/api/methods').json() if item['method']['plugin_id'] == 'cablesim.type-electrical')
        study = client.post(f'/api/workspaces/{wid}/studies', json={
            'title':'PDF saved clause evidence', 'input_source':'domain',
            'method':{**entry['method'], 'capability':'electrical'},
            'parameters':{'cable_type_id':workspace['domain']['cable_types'][0]['id']},
            'expected_revision':revision,
        })
        assert study.status_code == 201, study.text
        sid = study.json()['id']
        preflight_response = client.get(f'/api/workspaces/{wid}/studies/{sid}/preflight', params={'expected_revision':revision, 'expected_study_revision':study.json()['revision']})
        assert preflight_response.status_code == 200, preflight_response.text
        preflight = preflight_response.json()
        run = client.post(f'/api/workspaces/{wid}/studies/{sid}/runs', json={
            'request_id':str(uuid4()), 'expected_revision':revision,
            'expected_study_revision':study.json()['revision'],
            'lock_digest':preflight['lock_digest'], 'scope_acknowledged':True,
        })
        assert run.status_code == 200, run.text
        spec = client.get(f'/api/types/{wid}/specification').json()
        response = client.get(f'/api/types/{wid}/specification/file', params={'expected_revision':revision, 'specification_digest':spec['digest']})
        assert response.status_code == 200, response.text
        assert response.content.startswith(b'%PDF-')
        assert response.headers['x-artifact-sha256'] == sha256(response.content).hexdigest()
        assert response.headers['x-specification-sha256'] == spec['digest']
        with fitz.open(stream=response.content, filetype='pdf') as document:
            output = ''.join(page.get_text() for page in document)
            for value in ['电气参数', '修订', 'IEC 60287-1-1:2023', '5.1.2', spec['digest'], '0.3.0', '草稿']:
                assert ''.join(value.split()) in ''.join(output.split()), value
            assert document.page_count < 100
        # Digests are copied as exact hexadecimal text, including adjacent f characters.
        for digest in ['f' * 64, 'a6ec2d54db5e4a2ba86cd23b67b41c98e60a0b4cda4030d62bb8ff86b683f09c']:
            with fitz.open(stream=render_pdf({**spec, 'digest': digest}), filetype='pdf') as document:
                output = ''.join(page.get_text() for page in document)
                assert digest in ''.join(output.split())
        conflict = client.get(f'/api/types/{wid}/specification/file', params={'expected_revision':revision, 'specification_digest':'0'*64})
        assert conflict.status_code == 409
        conflict = client.get(f'/api/types/{wid}/specification/file', params={'expected_revision':revision+1, 'specification_digest':spec['digest']})
        assert conflict.status_code == 409


def test_customer_labels_units_missing_results_and_embedded_chinese(tmp_path):
    with TestClient(create_app(tmp_path/'customer.sqlite')) as client:
        model = next(item for item in system_models() if item['id'] == 'system.cu-xlpe-al-compacted-400')
        response = client.post('/api/design/type-workspaces', json={'model_id':model['id'], 'content_sha256':model['content_sha256']})
        response.raise_for_status()
        workspace = response.json()
        document = deepcopy(workspace['domain'])
        document['cable_types'][0]['cores'][0]['conductor']['conductor_class'] = 2
        response = client.put(f"/api/workspaces/{workspace['id']}/domain", json={'expected_revision':workspace['revision'], 'document':document})
        response.raise_for_status()
        spec = client.get(f"/api/types/{workspace['id']}/specification").json()
        html = spec['html']
        assert '铜（第 2 类 · 紧压）' in html and '交联聚乙烯' in html
        assert '12/20 kV' in html and '25.0' in html and '5.5' in html
        assert not re.search(r'<tbody>\s*</tbody>', html)
        for channel in ('geometry','electrical','rating','short_circuit','standards'):
            assert any(check['channel'] == channel and check['blocking'] for check in spec['payload']['checks'])
        assert not spec['ready']
        with fitz.open(stream=render_pdf(spec), filetype='pdf') as pdf:
            text = ''.join(page.get_text() for page in pdf)
            assert '产品规格书' in text and '编制单位' in text and '签字' in text
            assert '12/20kV' in ''.join(text.split()) and text.count('未计算') >= 4
            for forbidden in ('core/1','conductor_screen','insulation_screen','material/cu','material/xlpe','outer_diameter_m','input_digest','12000.0','20000.0'):
                assert forbidden not in text
            fonts = {font[0]:font for page in pdf for font in page.get_fonts(full=True)}
            assert any('DroidSansFallback' in font[3].replace('-', '') and len(pdf.extract_font(xref)[3]) > 1000 for xref,font in fonts.items())
            for page in pdf:
                assert '产品规格书' in page.get_text() and '共' in page.get_text()


def test_long_rating_tables_repeat_headers_without_splitting_rows(tmp_path):
    with TestClient(create_app(tmp_path/'tables.sqlite')) as client:
        model = system_models()[0]
        workspace = client.post('/api/design/type-workspaces',json={'model_id':model['id'],'content_sha256':model['content_sha256']}).json()
        spec = client.get(f"/api/types/{workspace['id']}/specification").json()
    # Deliberate print-only stress fixture; never saved as an engineering run.
    spec['payload']['results']['rating'] = {'rows':[
        {'name':f'工况 {index+1:02d}', 'value_a':123.456, 'status':'已计算', 'reason':None,
         'condition':{'layout':'trefoil','ambient_temperature_c':20,'depth_m':.8,'soil_rho_k_m_w':1,
                      'actual_spacing_m':.04,'bonding':'both_ends','source':'排版压力数据，不是工程计算结果'}}
        for index in range(48)]}
    with fitz.open(stream=render_pdf(spec), filetype='pdf') as pdf:
        pages = [page.get_text() for page in pdf if '123.456' in page.get_text()]
        assert len(pages) >= 2
        assert all(all(header in text for header in ('工况','排列','允许电流','状态与说明')) for text in pages)
        assert ''.join(page.get_text() for page in pdf).count('123.456') == 48
        for page in pdf:
            assert all(25 <= word[0] < word[2] <= page.rect.width-25 and 10 <= word[1] < word[3] < page.rect.height-10 for word in page.get_text('words'))


def test_empty_saved_artifacts_block_publication():
    for channel in ('electrical','short_circuit','standards','rating'):
        checks = []
        check_results({channel:{'run':{'freshness':'current','status':'succeeded'},'artifact':{'rows':[]},'rows':[]}}, checks)
        assert any(item['id'] == channel+'/empty' and item['blocking'] for item in checks)
