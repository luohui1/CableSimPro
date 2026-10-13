"""Actual release-copy commits; incremental metadata must equal a full read."""
import os
from copy import deepcopy
from time import perf_counter
from uuid import uuid4

import pytest
from test_harness_real_use import real_use, projects

pytestmark=pytest.mark.skipif(os.environ.get('CABLESIM_AGENT_REAL_USE')!='1',
    reason='Explicit isolated release-library HTTP/model acceptance')


def measured_commit(run,operation):
    start=perf_counter()
    response=run.client.get('/api/index/objects',params={'kind':'study','limit':100})
    elapsed=(perf_counter()-start)*1000
    response.raise_for_status()
    comparison=run.api('GET','/__acceptance/index-compare')
    run.report.setdefault('index_incremental',[]).append({'operation':operation,'http_ms':elapsed,**comparison})
    run.save()
    assert comparison['equal_to_full'],comparison
    return comparison['incremental_build']


def test_real_saved_run_and_input_refresh(real_use):
    run=real_use;workspaces,_=projects(run)
    project=next(w for w in workspaces if '城南' in w['name'])
    studies=run.api('GET',f'/api/workspaces/{project["id"]}/studies')
    study=next(s for s in studies if s['definition']['method']['plugin_id']=='cablesim.iec60287'
        and s['definition']['driver']['kind']=='single')
    root=f'/api/workspaces/{project["id"]}/studies/{study["id"]}'
    measured_commit(run,'initial')
    workspace=run.api('GET','/api/workspaces/'+project['id'])
    prepared=run.api('GET',root+'/preflight',params={
        'expected_revision':workspace['revision'],'expected_study_revision':study['revision']})
    assert prepared['ready'],prepared
    saved=run.api('POST',root+'/runs',json={'request_id':str(uuid4()),
        'expected_revision':workspace['revision'],'expected_study_revision':study['revision'],
        'lock_digest':prepared['lock_digest'],'scope_acknowledged':True})
    assert saved['status']=='succeeded',saved
    measured=measured_commit(run,'saved_run')
    assert measured['source_timings']['study_runs']['loaded_rows']==1,measured
    definition=deepcopy(study['definition'])
    document=definition['method_input'] if definition['input_source']=='study' else deepcopy(workspace['domain'])
    circuit=next(iter(document['load_cases'][0]['currents']))
    document['load_cases'][0]['currents'][circuit]+=1
    # An explicit study-owned saved input avoids changing the unrelated project.
    definition.update(input_source='study',method_input=document)
    changed=run.api('PUT',root,json={**definition,'expected_revision':workspace['revision'],
        'expected_study_revision':study['revision']})
    measured=measured_commit(run,'study_input_saved')
    assert measured['source_timings']['studies']['loaded_rows']==1,measured
    assert measured['source_timings']['study_runs']['loaded_rows']==0,measured
    assert changed['revision']==study['revision']+1


def test_real_proposal_human_approval_refresh(real_use):
    run=real_use;_,types=projects(run)
    # A real model proposes; only the explicit human API call below approves.
    design=next(t for t in types if 'YJV22' in t['name'])
    original=run.api('GET','/api/workspaces/'+design['id'])
    layer=next(l for l in original['domain']['cable_types'][0]['cores'][0]['layers'] if l['role']=='insulation')
    _,item=run.ask('incremental_type_proposal',design['id'],
        f'只提出第一芯绝缘厚度改为 {layer["thickness"]*1000+.1:.4f} mm 的单项方案，等待我批准，不试算、不发布。')
    pending=[p for p in item['proposals'] if p['status']=='pending'];assert len(pending)==1,item
    measured_commit(run,'proposal_created')
    receipt=run.api('POST',f'/api/agent/proposals/{pending[0]["id"]}/approve')
    assert receipt['status']=='approved',receipt
    measured=measured_commit(run,'proposal_human_approved')
    assert measured['source_timings']['workspaces']['loaded_rows']==1,measured
    revised=run.api('GET','/api/workspaces/'+design['id'])
    assert revised['revision']==original['revision']+1


def test_real_resource_version_publish_refresh(real_use):
    run=real_use
    # Publish a new version of actual, already published resource metadata.
    # No invented material facts, solver results, or manufacturer approval.
    assets=run.api('GET','/api/foundation/assets',params={'kind':'material','status':'published','limit':100})['items']
    asset=next(a for a in assets if a['status']=='published' and a['kind']=='material')
    original_asset=run.api('GET','/api/foundation/assets/'+asset['id'])
    major,minor,patch=map(int,original_asset['version'].split('.'))
    imported=run.api('POST','/api/foundation/assets/'+asset['id']+'/derive',json={
        'expected_revision':original_asset['revision'],'content_sha256':original_asset['content_sha256'],
        'new_version':f'{major}.{minor}.{patch+1}'})
    measured_commit(run,'resource_version_imported')
    for action in ('review','publish'):
        imported=run.api('POST','/api/foundation/assets/'+imported['id']+'/transition',json={
            'expected_revision':imported['revision'],'content_sha256':imported['content_sha256'],
            'action':action,'acknowledge_sources':True,'note':'隔离发布库，人工逐项核对原资源来源及字段'})
        measured=measured_commit(run,'resource_'+action)
        assert measured['source_timings']['engineering_assets']['loaded_rows']==1,measured
    assert imported['status']=='published'
