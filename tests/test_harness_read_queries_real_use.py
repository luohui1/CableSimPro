"""Actual sealed query tool/API over a release copy; no substituted provider."""
from contextlib import closing
import json
import os
from pathlib import Path
import sqlite3

from fastapi import HTTPException
from fastapi.testclient import TestClient
import pytest

from backend.main import create_app
from backend.harness.evidence import grounded_text


pytestmark=pytest.mark.skipif(not os.environ.get('CABLESIM_REAL_USE_DATABASE'),
    reason='Requires an explicitly selected saved release-library source')


def test_saved_actual_draft_replay_keeps_quantity_guards():
    path=Path('.data/agent-live/evidence-replay-r24.json')
    if not path.is_file():pytest.skip('Actual provider draft archive not present')
    report=json.loads(path.read_text(encoding='utf-8'))
    assert len(report['samples'])==2
    for sample in report['samples']:
        assert grounded_text(sample['draft'],sample['observations'])==sample['draft']
        for text in ('允许电流999 A。','载流量余量158 A。','文献给出的允许电流2021 A。'):
            with pytest.raises(HTTPException):grounded_text(text,sample['observations'])


def test_read_query_contract_and_original_standard_rows(tmp_path):
    source=Path(os.environ['CABLESIM_REAL_USE_DATABASE']).resolve()
    database=tmp_path/'queries.sqlite'
    with closing(sqlite3.connect(source.as_uri()+'?mode=ro',uri=True)) as original,closing(sqlite3.connect(database)) as copied:
        original.backup(copied)
    with TestClient(create_app(database)) as client:
        workspaces=client.get('/api/workspaces').json()
        project=next(w for w in workspaces if '城南' in w['name'])
        sid=client.post('/api/agent/sessions',json={'workspace_id':project['id']}).json()['id']
        harness=client.app.state.harness
        harness.begin(sid,'只读查询标准原始依据，不批准或修改工程。')
        with harness.tasks.db() as db:task=harness.tasks.load(db,sid)
        arguments={'plugin_id':'cablesim.standards-basis','capability':'lookup'}
        schema=harness.platform.query(task,{**arguments,'view':'/properties/operation'})
        assert 'resolve' in schema.data['schema']['value']['enum']
        query={'schema_version':'cablesim.standards-query/1','operation':'list',
            'standard':'GB/T 12706.2','edition':'2020','locator':'10.2.3'}
        result=harness.platform.query(task,{**arguments,'input':query})
        original=result.data['response']['artifacts']['x-cablesim.standards-basis']
        row=next(r for r in original['records'] if r['quantity']['key']=='screen_tape_nominal_min' and r['value']==.1)
        assert row['printed_page']==10 and row['pdf_page']==18
        assert original['approval']=='not_granted'
        from backend.harness.fem import comparisons
        fem=comparisons(harness.research,task,{})
        assert fem.data['convergence']['status']=='converged'
        currents=[v for case in fem.data['comparisons'] for v in case['results'] if v['key']=='ampacity']
        assert next(v['value'] for v in currents if v['method']=='fem')==pytest.approx(746.538,abs=.001)
        assert next(v['value'] for v in currents if v['method']=='iec')==pytest.approx(748.322,abs=.001)
        assert fem.data['execution']['job_id']=='817014'
        text='GB/T 12706.2—2020 第10.2.3条，多芯铜带屏蔽标称厚度至少0.1 mm；印刷第10页，PDF第18页。'
        assert grounded_text(text,[result.model_dump(mode='json')])==text
        for text in ('允许电流999 A。','方案已批准。'):
            with pytest.raises(HTTPException):grounded_text(text,[result.model_dump(mode='json')])
        report={'mode':'actual_host_and_sealed_plugin_query_without_model_repetition',
            'query':query,'method':result.data['source'],'row':row,
            'statement':'原条款给出铜带厚度与搭盖规定；不得把它换成固定屏蔽截面。',
            'provider_retest_blocked':'HTTP 402 Insufficient Balance',
            'result':result.model_dump(mode='json'),'fem_comparison':fem.model_dump(mode='json'),
            'proposals':client.get('/api/agent/sessions/'+sid).json()['proposals']}
        assert report['proposals']==[]
        output=Path('.data/agent-live/standards-query-r24.json')
        output.parent.mkdir(parents=True,exist_ok=True)
        output.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
