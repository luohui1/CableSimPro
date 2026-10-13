"""Use the real host/Executor and an isolated copy of the saved release library."""
import json
from pathlib import Path
import sqlite3
import pytest
from decimal import Decimal, ROUND_HALF_UP

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]


def test_five_engineering_queries_on_saved_release_copy(tmp_path, monkeypatch):
    source = ROOT/'.data/release/engineering.sqlite'
    # This acceptance deliberately requires saved release data, not generated fixtures.
    if not source.is_file(): pytest.skip('真实发布库缺失：不能用夹具冒充真实使用验收。')
    target = tmp_path/'engineering.sqlite'
    with sqlite3.connect(source.as_uri()+'?mode=ro', uri=True) as original, sqlite3.connect(target) as copy:
        original.backup(copy)
    monkeypatch.setenv('CABLESIM_DB', str(target))
    monkeypatch.setenv('CABLESIM_DATASETS_DIR', str(tmp_path/'datasets'))
    from backend.main import create_app
    app = create_app(target)
    app.state.previews.jobs = tmp_path/'previews'
    app.state.previews.jobs.mkdir()
    cases = [
        ('Nielsen et al.', '2019', 'Table 1', 'volumetric_heat_capacity', {'material':'copper'}, 3460000, 8, 9),
        ('GB/T 12706.1', '2020', '表 A.2', 'bundle_factor', {'core_count':4,'equal_core_sections':True,'cable_arrangement':'standard'}, 2.42, 35, 41),
        ('GB/T 3956', '2008', '表 1', 'resistance_20_max', {'area_m2':185e-6,'conductor_class':1,'conductor_material':'copper','coating':'plain','conductor_form':'circular'}, .101, 3, 6),
        ('GB/T 12706.1', '2020', '表 18', 'insulation_mechanical_test_requirement', {'test_item':'老化前抗张强度最小','insulation':'EPR','insulation_test_group':'other_cable'}, 4.2, 29, 35),
        ('GB/T 12706.4', '2020', '表14', 'test_voltage', {'test_item':'冲击电压试验（峰值）','u0_v':3600,'u_v':6000,'um_v':7200}, 60, 15, 19),
    ]
    with TestClient(app) as client:
        methods = client.get('/api/methods'); assert methods.status_code==200
        pin = next(m['method'] for m in methods.json() if m['method']['plugin_id']=='cablesim.standards-basis')
        assert pin['version']=='0.4.0'
        for standard,edition,locator,quantity,conditions,value,printed,pdf in cases:
            query={'schema_version':'cablesim.standards-query/1','standard':standard,'edition':edition,
                   'locator':locator,'quantity':quantity,'conditions':conditions}
            reply=client.post('/api/plugin-queries/cablesim.standards-basis/lookup',
                              json={'release_digest':pin['release_digest'],'input':query})
            assert reply.status_code==200,reply.text
            envelope=reply.json(); answer=envelope['artifacts']['x-cablesim.standards-basis']
            assert envelope['plugin_version']=='0.4.0' and len(envelope['request_sha256'])==64
            assert answer['status']=='resolved' and len(answer['records'])==1, (query,answer)
            record=answer['records'][0]
            assert (record['value'],record['printed_page'],record['pdf_page'])==(value,printed,pdf)
            assert record['verification']['status']=='verified' and len(record['verification']['methods'])>=2
        # Consume the returned parameters against original public examples/hand products.
        for locator in ('B.1','B.2'):
            request=dict(schema_version='cablesim.standards-query/1',standard='GB/T 12706.1',edition='2020',
                         locator=locator,quantity='fictitious_rounding',conditions={})
            reply=client.post('/api/plugin-queries/cablesim.standards-basis/lookup',json={'release_digest':pin['release_digest'],'input':request})
            assert reply.status_code==200,reply.text
            record=reply.json()['artifacts']['x-cablesim.standards-basis']['records'][0]
            assert (record['printed_page'],record['pdf_page'])==(38,44)
            params=record['value']; assert params['mode']=='half_up' and params['unit']=='mm'
            if locator=='B.1':
                assert Decimal('2.449').quantize(Decimal(str(params['increment'])),rounding=ROUND_HALF_UP)==Decimal('2.4')
                assert Decimal('30.050').quantize(Decimal(str(params['increment'])),rounding=ROUND_HALF_UP)==Decimal('30.1')
            else: assert params['requires_explicit_increment'] is True and 'increment' not in params
        request=dict(schema_version='cablesim.standards-query/1',standard='Huang and Niu',edition='2025',
                     locator='Table A1',quantity='volumetric_heat_capacity',conditions={'material':'MPP','material_role':'pipe'})
        reply=client.post('/api/plugin-queries/cablesim.standards-basis/lookup',json={'release_digest':pin['release_digest'],'input':request})
        assert reply.status_code==200,reply.text
        record=reply.json()['artifacts']['x-cablesim.standards-basis']['records'][0]
        assert record['value']==920*670==616400
        assert record['semantic']=='literature_derived_reference'
        assert (record['printed_page'],record['pdf_page'])==(68,13)
        # Never accept string booleans or silently use a three-core factor for four cores.
        bad=dict(schema_version='cablesim.standards-query/1',standard='GB/T 12706.1',edition='2020',
                 locator='表 A.2',quantity='bundle_factor',conditions={'core_count':4,'equal_core_sections':'true','cable_arrangement':'standard'})
        reply=client.post('/api/plugin-queries/cablesim.standards-basis/lookup',json={'release_digest':pin['release_digest'],'input':bad})
        assert reply.status_code==422 and reply.json()['detail']['path']=='/conditions/equal_core_sections'
        blocked=dict(schema_version='cablesim.standards-query/1',standard='GB/T 12706.2',edition='2020',
                     locator='表 18',quantity='impulse_test_voltage',conditions={'u_v':10000})
        # The exact old record can still be browsed, but its ambiguous voltage axis is blocked.
        blocked['record_id']='mv-表18/r2/test_voltage'
        reply=client.post('/api/plugin-queries/cablesim.standards-basis/lookup',json={'release_digest':pin['release_digest'],'input':blocked})
        assert reply.status_code==422 and reply.json()['detail']['code']=='EVIDENCE_BLOCKED'
