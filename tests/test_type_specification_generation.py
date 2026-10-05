"""Real algebra generation, edition separation and resumable saved evidence."""
from decimal import Decimal, localcontext
from uuid import uuid4
import re

import fitz
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.main import create_app
from backend.kernel.scenarios import system_models


def create_example(client):
    model = next(item for item in system_models() if item['id'] == 'system.specification-cu-xlpe-al-400')
    result = client.post('/api/design/type-workspaces', json={'model_id':model['id'], 'content_sha256':model['content_sha256']})
    assert result.status_code == 201, result.text
    return result.json()


def request(workspace):
    return {'request_id':str(uuid4()), 'expected_revision':workspace['revision'], 'scope_acknowledged':True}


def test_real_one_action_generates_both_editions_without_inventing_measurements(tmp_path):
    with TestClient(create_app(tmp_path/'generation.sqlite')) as client:
        workspace = create_example(client)
        wid = workspace['id']
        body = request(workspace)
        response = client.post(f'/api/types/{wid}/specification/generate', json=body)
        assert response.status_code == 200, response.text
        result = response.json()
        assert result['status'] == 'generated', result
        assert [step['channel'] for step in result['steps']] == ['geometry','electrical','rating','short_circuit','standards']
        assert all(step['status'] == 'calculated' for step in result['steps'])
        assert client.get(f'/api/workspaces/{wid}').json()['domain'] == workspace['domain']
        assert workspace['domain']['measurements'] == []
        assert client.post(f'/api/types/{wid}/specification/generate',json=body).json() == result
        replay = client.post(f'/api/types/{wid}/specification/generate',json=request(workspace)).json()
        assert all(step['status'] == 'reused' for step in replay['steps']), replay
        with client.app.state.workspace_store.db() as db:
            assert db.execute('SELECT COUNT(*) FROM study_runs WHERE workspace=?', (wid,)).fetchone()[0] == 5
        spec = client.get(f'/api/types/{wid}/specification').json()
        assert not spec['ready']  # Unsupported engineering branches still prevent publication.
        geometry = spec['payload']['results']['geometry']['artifact']
        # IEC 60287-1-1:2023 Table 3: unfilled XLPE U0=12 kV uses .004.
        # Verify the actual specification artifact, not only the seed material.
        from math import pi, log
        electrical = spec['payload']['results']['electrical']['artifact']['rows']
        dielectric = next(row for row in electrical if row['id'].endswith(':dielectric'))
        capacitance = 2*pi*8.854e-12*2.5/log(.0372/.0262)
        assert dielectric['value'] == pytest.approx(2*pi*50*capacitance*12000**2*.004, rel=1e-12)
        copper = next(row for row in geometry['layers'] if row['role'] == 'conductor')
        assert copper['mass_kg_per_km'] == pytest.approx(.0004*1.02*8900*1000, rel=1e-10)
        short = next(row for row in spec['payload']['results']['short_circuit']['artifact']['rows'] if row['id'].endswith(':conductor-adiabatic'))
        with localcontext() as context:
            context.prec = 45
            current = Decimal(226)*400*(Decimal('484.5')/Decimal('324.5')).ln().sqrt()
        assert short['value'] == pytest.approx(float(current), rel=1e-12)
        texts = {}
        for audience in ('customer','internal'):
            pdf = client.get(f'/api/types/{wid}/specification/file', params={'expected_revision':workspace['revision'], 'specification_digest':spec['digest'], 'audience':audience})
            assert pdf.status_code == 200, pdf.text
            assert pdf.headers['x-specification-audience'] == audience
            with fitz.open(stream=pdf.content, filetype='pdf') as document:
                texts[audience] = ''.join(page.get_text() for page in document)
                assert '未计算' not in texts[audience]
                assert not any(table.row_count < 2 for page in document for table in page.find_tables().tables)
                if audience == 'customer':
                    assert not re.search(r'[0-9a-f]{64}', ''.join(texts[audience].split()))
                    assert document.metadata['subject'] != spec['digest']
        for term in ('发布前待完成事项','t_n','来源与运行依据','铅套标称厚度','铅套最薄点'):
            assert term not in texts['customer']
        compact = ''.join(texts['customer'].split())
        for condition in ('短路持续时间1s', '导体初始温度90.0°C', '导体最终温度250.0°C', '导体工作温度90.0°C', '频率50Hz'):
            assert condition in compact
        assert spec['digest'] in ''.join(texts['internal'].split())
        assert '不适用条款' in texts['internal']
        internal = client.get(f'/api/types/{wid}/specification',params={'audience':'internal'}).json()['html']
        assert '<th>对象</th>' not in internal and '<td>共同层</td>' not in internal
        assert '<td>1</td>' not in internal.split('7. 标准核对结论与偏离表')[1].split('8. ')[0]
        before_details = internal.split('<details data-specification-inapplicable>')[0]
        assert '铅套标称厚度' not in before_details and '铅套最薄点' not in before_details


def test_generation_stops_at_missing_configuration_and_keeps_completed_runs(tmp_path):
    with TestClient(create_app(tmp_path/'blocked.sqlite')) as client:
        workspace = create_example(client)
        wid = workspace['id']
        # A saved user configuration takes precedence over the explicit demo template.
        method = next(item for item in client.get('/api/methods').json() if item['method']['plugin_id'] == 'cablesim.type-electrical')['method']
        study = client.post(f'/api/workspaces/{wid}/studies',json={'title':'缺少方法条件的电气参数', 'input_source':'domain', 'method':{**method,'capability':'electrical'}, 'parameters':{'cable_type_id':workspace['domain']['cable_types'][0]['id']}, 'expected_revision':workspace['revision']})
        assert study.status_code == 201, study.text
        result = client.post(f'/api/types/{wid}/specification/generate',json=request(workspace)).json()
        assert result['status'] == 'blocked' and result['channel'] == 'electrical', result
        assert [step['channel'] for step in result['steps']] == ['geometry']
        assert client.get(f'/api/workspaces/{wid}').json()['domain'] == workspace['domain']
        spec = client.get(f'/api/types/{wid}/specification').json()
        assert client.get(f'/api/types/{wid}/specification/file',params={'expected_revision':workspace['revision'],'specification_digest':spec['digest']}).status_code == 422


def test_connection_failure_retry_reuses_the_same_accepted_request(tmp_path, monkeypatch):
    with TestClient(create_app(tmp_path/'retry.sqlite')) as client:
        workspace = create_example(client)
        wid = workspace['id']
        research = client.app.state.research
        execute = research.execute
        failed = False
        def disconnect(workspace_id, study_id, body, **kwargs):
            nonlocal failed
            result = execute(workspace_id, study_id, body, **kwargs)
            if not failed:
                failed = True
                raise HTTPException(503, '连接中断，运行已经保存。')
            return result
        monkeypatch.setattr(research, 'execute', disconnect)
        body = request(workspace)
        first = client.post(f'/api/types/{wid}/specification/generate',json=body).json()
        assert first['status'] == 'blocked' and first['channel'] == 'geometry'
        second = client.post(f'/api/types/{wid}/specification/generate',json=body).json()
        assert second['status'] == 'generated', second
        assert second['steps'][0]['status'] == 'reused'
        with client.app.state.workspace_store.db() as db:
            assert db.execute('SELECT COUNT(*) FROM study_runs WHERE workspace=?', (wid,)).fetchone()[0] == 5


def test_missing_geometry_environment_reports_the_prepare_command(tmp_path,monkeypatch):
    monkeypatch.delenv('CABLESIM_PLUGIN_PYTHON',raising=False)
    monkeypatch.delenv('SLURM_JOB_ID',raising=False)
    monkeypatch.setattr('backend.plugin_host.runtime.environment_python',lambda directory:tmp_path/'missing-python')
    with TestClient(create_app(tmp_path/'missing-environment.sqlite')) as client:
        workspace=create_example(client)
        response=client.post(f'/api/types/{workspace["id"]}/specification/generate',json=request(workspace))
        assert response.status_code==200,response.text
        result=response.json()
        assert result['status']=='blocked' and result['channel']=='geometry'
        assert '环境缺失' in result['message']
        assert 'python scripts/prepare_plugin_environment.py cablesim.cable-geometry' in result['message']
        assert result['steps']==[]
