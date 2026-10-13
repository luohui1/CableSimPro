"""Real saved inputs, real provider, free text: no shortcut or fake response."""
import json
import os
from pathlib import Path
import subprocess

import pytest

from test_harness_real_use import real_use,projects,ROOT

pytestmark=pytest.mark.skipif(os.environ.get('CABLESIM_AGENT_REAL_USE')!='1',reason='Explicit real-provider acceptance only')


@pytest.mark.parametrize('question',[
    '检查这个研究还缺哪些输入。只检查已保存输入，按影响说明缺项和下一步；不要修改、运行计算或提交作业。',
    '请核对这项研究的输入完整性，哪些必填信息还没齐？说明检查覆盖了什么，哪些还没检查；只读，不试算。',
    '先别计算，帮我查一下这个研究是否具备运行所需输入，把缺项和工程师下一步讲清楚。',
])
def test_real_free_question_finishes_with_one_preflight(real_use,question):
    run=real_use;workspaces,_=projects(run)
    pin=lambda method:tuple(method[key] for key in ('plugin_id','version','release_digest'))
    methods={pin(m['method']) for m in run.api('GET','/api/methods')}
    target=next(((w,s) for w in workspaces for s in run.api('GET',f'/api/workspaces/{w["id"]}/studies')
        if s['definition']['driver']['kind']=='single' and pin(s['definition']['method']) in methods),None)
    if target is None:
        w,s=next((w,s) for w in workspaces for s in run.api('GET',f'/api/workspaces/{w["id"]}/studies')
            if s['definition']['driver']['kind']=='single' and s['definition']['method']['plugin_id']=='cablesim.iec60287')
        workspace=run.api('GET',f'/api/workspaces/{w["id"]}')
        before=s['definition']['method']
        s=run.api('POST',f'/api/workspaces/{w["id"]}/studies/{s["id"]}/upgrade-methods',json={
            'expected_revision':workspace['revision'],'expected_study_revision':s['revision']})
        run.report.setdefault('human_preparation',[]).append({'action':'upgrade-methods','workspace_id':w['id'],
            'study_id':s['id'],'before':before,'after':s['definition']['method'],'study_revision':s['revision']})
        run.save();target=w,s
    w,s=target
    record,item=run.ask('free_missing_inputs',w['id'],question,study_id=s['id'])
    item['question']=question
    preflights=[step for step in record['steps'] if step['tool']=='study_preflight']
    physical=[step for step in preflights if not any(e['type']=='tool.result_reused' and e['data']['node_id']==step['node_id'] for e in record['events'])]
    assert len(physical)==1,item
    assert record['state'] in ('completed','waiting') and record['waiting_reason']!='budget',item
    assert record['budget']['model_requests']<=8 and record['budget']['tool_calls']<=12,item
    assert not record['proposals'] and not any(step['tool']=='study_preview' for step in record['steps']),item
    projection=preflights[0]['result']['data']['agent_projection']
    item['preflight_coverage']=projection['coverage'];item['preflight_ready']=projection['ready']
    assert '预检' in item['answer'] and any(word in item['answer'] for word in ('范围','检查','覆盖')),item
    assert any(word in item['answer'] for word in ('未','不代表','不能')),item
    item['acceptance']='passed';run.save()


def test_real_index_and_openapi_client_generation(real_use,tmp_path):
    run=real_use;timing=run.report['index_first_request']
    assert timing['warm_state']=='ready' and timing['elapsed_ms']<=300,timing
    spec=run.api('GET','/openapi.json')
    extension=spec['paths']['/api/agent/sessions/{id}/messages']['post']['x-sse-events']
    references=[]
    def visit(value):
        if isinstance(value,dict):
            if '$ref' in value:references.append(value['$ref'])
            if 'discriminator' in value:references.extend(value['discriminator'].get('mapping',{}).values())
            for child in value.values():visit(child)
        elif isinstance(value,list):
            for child in value:visit(child)
    visit(extension)
    for reference in references:
        value=spec
        for token in reference.removeprefix('#/').split('/'):value=value[token.replace('~1','/').replace('~0','~')]
        assert isinstance(value,dict),reference
    executable=ROOT/'frontend/node_modules/openapi-typescript/bin/cli.js'
    assert executable.is_file(),'Use the installed real client generator'
    generated=subprocess.run(['node',str(executable),str(run.client.base_url).rstrip('/')+'/openapi.json','-o',str(tmp_path/'schema.ts')],
        cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=90)
    run.report['openapi_generation']={'returncode':generated.returncode,'stdout':generated.stdout,'stderr':generated.stderr,
        'sse_refs_resolved':len(references)};run.save()
    assert generated.returncode==0 and 'Could not resolve' not in generated.stderr+generated.stdout,generated.stderr
    assert 'Discriminator mapping has an invalid schema' not in generated.stderr+generated.stdout,generated.stderr
