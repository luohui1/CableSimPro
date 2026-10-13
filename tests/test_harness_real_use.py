"""Opt-in real DeepSeek use of a release-library copy, with normal HTTP APIs.

PowerShell: $env:CABLESIM_AGENT_REAL_USE='1'; python -m pytest -s -q tests/test_harness_real_use.py
No model, response, tool, proposal, saved object or plugin is substituted.
"""
import json
from contextlib import closing
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import sys
from time import monotonic, sleep

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[1]
pytestmark = pytest.mark.skipif(os.environ.get('CABLESIM_AGENT_REAL_USE') != '1',
    reason='Real provider calls require explicit CABLESIM_AGENT_REAL_USE=1; no fake fallback.')


def serve(database, credential_database, port, stop):
    sys.path.insert(0, str(ROOT))
    from backend.main import create_app
    from backend.harness.model_settings import KeyStore
    from threading import Thread
    import uvicorn
    app = create_app(database)
    @app.get('/__acceptance/index-timing',include_in_schema=False)
    def index_timing():
        index=app.state.research.object_index
        return {'warm_state':index.warm_state,'build':index.last_build,'startup_wait_ms':index.startup_wait_ms,'read':index.last_read}
    @app.get('/__acceptance/index-compare',include_in_schema=False)
    def index_compare():
        """Compare the live incremental projection to an independent full read.

        Only this isolated acceptance host exposes the diagnostic. Both paths
        use the same host currentness rules, saved rows and installed seals.
        """
        from backend.index.service import Snapshot
        from backend.index.reproductions import identity
        from time import perf_counter
        index=app.state.research.object_index
        with index.lock:
            incremental=index.snapshot(copy=False)
            measured=index.last_build
            observed=identity(index.reproduction_library)
            reproductions=index.reproduction_library.snapshot()
            assert identity(index.reproduction_library)==observed
            started=perf_counter()
            with app.state.research.store.db() as db:
                db.execute('PRAGMA mmap_size=1073741824')
                db.execute('PRAGMA query_only=ON');db.execute('BEGIN')
                full=Snapshot(app.state.research,db,reproductions,execution_reader=index.execution_reader)
            ordered=lambda rows:sorted(json.dumps(row,sort_keys=True,ensure_ascii=False) for row in rows)
            differences=[]
            for field in ('cards','unresolved'):
                if getattr(incremental,field)!=getattr(full,field):differences.append(field)
            for field in ('edges','todos'):
                if ordered(getattr(incremental,field))!=ordered(getattr(full,field)):differences.append(field)
            return {'equal_to_full':not differences,'differences':differences,
                'full_build_ms':(perf_counter()-started)*1000,'full_source_timings':full.source_timings,
                'incremental_build':measured}
    @app.middleware('http')
    async def timed_index(request,call_next):
        from time import perf_counter
        started=perf_counter();response=await call_next(request)
        if request.url.path.startswith('/api/index/'):
            response.headers['X-Acceptance-Server-Ms']=str((perf_counter()-started)*1000)
        return response
    @app.get('/__acceptance/index-profile',include_in_schema=False)
    def index_profile(kind='study',id=None,uncached:bool=False):
        import cProfile
        import pstats
        profiler=cProfile.Profile()
        if uncached:profiler.runcall(app.state.research.object_index.load)
        elif id:profiler.runcall(app.state.research.object_index.relations,kind,id)
        else:profiler.runcall(app.state.research.object_index.objects,kind=kind,limit=100)
        stats=pstats.Stats(profiler)
        return {'total_seconds':stats.total_tt,'functions':[
            {'file':key[0],'line':key[1],'function':key[2],'calls':value[1],
             'self_seconds':value[2],'cumulative_seconds':value[3]}
            for key,value in sorted(stats.stats.items(),key=lambda row:row[1][3],reverse=True)[:25]]}
    @app.get('/__acceptance/execution-consistency',include_in_schema=False)
    def execution_consistency():
        index=app.state.research.object_index;executor=app.state.research.executor
        from backend.kernel.hpc_evidence import evidence_index
        catalog,_=evidence_index()
        targets=dict(index.runs)
        targets.update({operation:{'plugin_id':entry['plugin_id'],'capability':entry['capability']}
            for operation,entry in catalog['executions'].items()})
        direct=[]
        for operation,method in targets.items():
            value=executor.execution_status(operation,method['plugin_id'],method['capability'])
            if value:direct.append((operation,value))
        batch=index.execution_reader.read(executor,targets.items())
        return {'equal_to_host':batch==direct,'saved_runs':len(index.runs),
            'receipts':len(batch),'bundled_receipts':sum(bool(value.get('saved_evidence')) for _,value in batch)}
    # Reuse only the OS account identifier. The platform itself reads its key
    # through the ordinary KeyStore/provider path; the test never reads a key.
    app.state.harness.settings.keys.account = KeyStore(credential_database).account
    if not app.state.harness.settings.saved().get('base_url'):
        # Fresh official release seeds contain saved engineering evidence but
        # intentionally no connection settings. Copy only the four public
        # settings; never select a credential column or call KeyStore.get here.
        from backend.harness.contracts import ModelSettingsUpdate
        with closing(sqlite3.connect(Path(credential_database).resolve().as_uri()+'?mode=ro',uri=True)) as connection:
            values={name:json.loads(value) for name,value in connection.execute(
                "SELECT name,value FROM agent_settings WHERE name IN ('base_url','model','instructions','model_timeout_s')")}
        app.state.harness.settings.update(ModelSettingsUpdate(**values))
    server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=int(port), log_level='error'))
    def watch():
        while not Path(stop).exists() and not server.should_exit: sleep(.2)
        server.should_exit = True
    Thread(target=watch, daemon=True).start()
    server.run()


class RealUse:
    def __init__(self, client, output):
        self.client = client
        self.output = Path(output)
        self.report = json.loads(self.output.read_text(encoding='utf-8')) if self.output.exists() else {'mode':'real_deepseek_http_release_copy','tasks':[],
            'credentials':'OS account metadata only; platform authentication; no key read or file write',
            'solver_jobs_submitted':0}

    def save(self):
        self.report['mode']='real_deepseek_http_release_copy' if any(
            item.get('budget',{}).get('model_requests',0) for item in self.report['tasks']) else 'real_host_http_release_copy_no_model'
        self.output.parent.mkdir(parents=True, exist_ok=True)
        self.output.write_text(json.dumps(self.report, ensure_ascii=False, indent=2), encoding='utf-8')

    def api(self, method, path, **kwargs):
        response = self.client.request(method, path, **kwargs)
        response.raise_for_status()
        return response.json()

    def ask(self, name, workspace_id, content, *, study_id=None, recipe=None):
        sid = self.api('POST','/api/agent/sessions',json={'workspace_id':workspace_id,'study_id':study_id})['id']
        start = monotonic()
        with self.client.stream('POST',f'/api/agent/sessions/{sid}/messages',json={
                'content':content,**({'recipe':recipe} if recipe else {})}) as response:
            response.raise_for_status()
            for _ in response.iter_lines():pass
        record = self.api('GET',f'/api/agent/sessions/{sid}')
        item = {'name':name,'session_id':sid,'workspace_id':workspace_id,'study_id':study_id,
            'source_database':self.report.get('source_database'),'isolated_database':self.report.get('isolated_database'),
            'elapsed_s':round(monotonic()-start,3),'state':record['state'],
            'waiting_reason':record['waiting_reason'],'budget':record['budget'],
            'answer':'\n'.join(m['content'] for m in record['messages'] if m['role']=='assistant' and m.get('content')),
            'object_refs':[m.get('object_refs',[]) for m in record['messages'] if m.get('content') and m['role']=='assistant'],
            'proposals':record['proposals'],'steps':[{'id':s['node_id'],'tool':s['tool'],'state':s['state'],
                'arguments':s['arguments'],'input_identity':s['input_identity'],
                'summary':s['result']['summary'],'diagnostics':s['result']['diagnostics'],
                'next_actions':s['result']['next_actions']} for s in record['steps'] if s.get('result')],
            'audit':[e for e in record['events'] if e['type'] in ('model.request','model.result','turn.answer_only','recipe.finished','tool.result_reused',
                'answer.accepted','answer.rejected','answer.repair','answer.fallback','answer.diagnostic','error','harness.error','plan.blocked','tool.diagnostic_reused','preflight.scopes_satisfied')]}
        self.report['tasks'].append(item);self.save()
        print(json.dumps({'task':name,'model_requests':record['budget']['model_requests'],
            'tool_calls':record['budget']['tool_calls'],'elapsed_s':item['elapsed_s'],'state':record['state']},ensure_ascii=False),flush=True)
        assert any(e['type']=='answer.accepted' for e in record['events']), item
        assert not any(e['type']=='answer.fallback' for e in record['events']), item
        assert not any(e['data'].get('code')=='LLM_HTTP_ERROR' for e in record['events']), item
        assert not any(s['tool'].startswith('plugin__') for s in record['steps']), 'This task must not launch a solver'
        return record,item


@pytest.fixture(scope='module')
def real_use(tmp_path_factory):
    source = Path(os.environ.get('CABLESIM_REAL_USE_DATABASE',ROOT/'.data/release/engineering.sqlite')).resolve()
    credential_source = Path(os.environ.get('CABLESIM_REAL_USE_CREDENTIAL_DATABASE',ROOT/'.data/release/engineering.sqlite')).resolve()
    assert source.is_file() and credential_source.is_file(), 'A saved release library is required'
    scratch = tmp_path_factory.mktemp('agent-real-use')
    database=scratch/'workspace.sqlite'; stop=scratch/'stop'; log_path=scratch/'host.log'
    with closing(sqlite3.connect(source.as_uri()+'?mode=ro',uri=True)) as original, closing(sqlite3.connect(database)) as copied:
        original.backup(copied)
    with socket.socket() as listener:
        listener.bind(('127.0.0.1',0));port=listener.getsockname()[1]
    env={**os.environ,'CABLESIM_AGENT_KEY_STORE':'system','CABLESIM_DB':str(database),
        'CABLESIM_DATASETS_DIR':str(scratch/'datasets'),
        'CABLESIM_REPRODUCTION_LIBRARY':str(ROOT/'.data/release/library'),
        'PYTHONIOENCODING':'utf-8','LANGSMITH_TRACING':'false'}
    # Test configuration does not transport credentials through environment variables.
    env.pop('CABLESIM_LLM_API_KEY',None)
    with log_path.open('w',encoding='utf-8') as log:
        process=subprocess.Popen([sys.executable,'-B',str(Path(__file__).resolve()),'--serve',
            str(database),str(credential_source),str(port),str(stop)],cwd=ROOT,env=env,
            stdout=log,stderr=subprocess.STDOUT,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        with httpx.Client(base_url=f'http://127.0.0.1:{port}',timeout=300,trust_env=False) as client:
            run=RealUse(client, os.environ.get('CABLESIM_AGENT_REAL_USE_OUTPUT') or scratch/'real-use.json')
            try:
                deadline=monotonic()+40
                while monotonic()<deadline:
                    assert process.poll() is None, f'Host exited; see {log_path}'
                    try:
                        status=run.api('GET','/api/agent/status');break
                    except httpx.ConnectError:sleep(.2)
                else:raise AssertionError(f'Host did not start; see {log_path}')
                assert status['configured'] and status['model']=='deepseek-flash', 'Use the configured real DeepSeek provider'
                run.report.update(model=status['model'],port=port,source_database=str(source),isolated_database=str(database))
                started=monotonic()
                inbox=run.api('GET','/api/index/inbox')
                run.report['index_first_request']={'elapsed_ms':(monotonic()-started)*1000,
                    'counts':inbox['counts'],**run.api('GET','/__acceptance/index-timing')}
                run.save()
                yield run
            finally:
                run.save();stop.touch()
                forced=False
                try:process.wait(timeout=45)
                except subprocess.TimeoutExpired:
                    forced=True;process.terminate();process.wait(timeout=10)
                with socket.socket() as check:closed=check.connect_ex(('127.0.0.1',port))!=0
                run.report['service_shutdown']={'forced':forced,'exit_code':process.returncode}
                run.report['service_closed']=closed;run.save()
                assert closed, f'Owned temporary port {port} remains open'
                # Real Windows lifecycle check, including the index mapping and
                # managed warm-up. No gc, busy-loop, force-unlock or fake handle.
                with closing(sqlite3.connect(database,timeout=1)) as check:
                    journal=check.execute('PRAGMA journal_mode=DELETE').fetchone()[0]
                moved=database.with_suffix('.closed.sqlite')
                database.rename(moved);moved.rename(database)
                run.report['database_closed']={'journal_mode':journal,'rename_after_shutdown':True,'forced_shutdown':forced}
                run.save()


def projects(run):
    types=run.api('GET','/api/design/type-workspaces');type_ids={t['id'] for t in types}
    return [w for w in run.api('GET','/api/workspaces') if w['id'] not in type_ids],types


def test_real_inbox_grouping_and_type_module_homes(real_use):
    run=real_use;workspaces,types=projects(run);assert workspaces
    record,item=run.ask('inbox_triage',workspaces[0]['id'],'帮我理一下待办，按原因分组说明处理顺序。',
        recipe={'id':'inbox_triage','parameters':{}})
    assert record['budget']['model_requests']<=2,item
    observed=[row for step in record['steps'] if step['tool']=='inbox_read' and step.get('result')
        for row in step['result']['data'].get('items',[])]
    assert observed,item
    modules=[row for row in observed if row['object']['kind']=='study' and row['object'].get('parent',{}).get('kind')=='type']
    item['type_module_inbox']=[{'title':row['title'],'home':row['home'],'next_step':row['next_step']} for row in modules]
    run.save()
    for row in modules:
        assert row['home']['kind']=='type' and row['home']['name'] in row['title'],row
        assert '型号工作台' in row['next_step'] and '研究工作台' not in row['next_step'],row
        assert row['object']['name'] in row['next_step'],row
        assert row['home']['name'] in item['answer'],item
    assert '原因：' in item['answer'] and '下一步：' in item['answer'],item
    item['acceptance']='passed';run.save()


def test_real_changed_method_stops_preflight_and_explains_next_step(real_use):
    run=real_use;workspaces,_=projects(run)
    pin=lambda method:tuple(method[key] for key in ('plugin_id','version','release_digest'))
    methods={pin(m['method']) for m in run.api('GET','/api/methods')}
    selected=None
    for workspace in workspaces:
        for study in run.api('GET',f'/api/workspaces/{workspace["id"]}/studies'):
            if pin(study['definition']['method']) not in methods and study['definition']['driver']['kind']=='single':
                selected=(workspace,study);break
        if selected:break
    assert selected, 'The real library has no method-release mismatch; this scenario is not covered'
    workspace,study=selected
    record,item=run.ask('missing_inputs_changed_method',workspace['id'],
        '检查这个研究还缺哪些输入。只检查已保存输入，按影响说明缺项和下一步；不要修改、运行计算或提交作业。',study_id=study['id'])
    preflights=[s for s in record['steps'] if s['tool']=='study_preflight']
    assert len(preflights)==1,item
    assert any(d['code']=='METHOD_RELEASE_CHANGED' for d in preflights[0]['result']['diagnostics']),item
    assert not any(e['type']=='tool.diagnostic_reused' for e in record['events']),item
    assert record['budget']['model_requests']<=8,item
    assert '方法' in item['answer'] and any(word in item['answer'] for word in ('升级','更新')),item
    assert '工作台' in item['answer'] and any(word in item['answer'] for word in ('预检','重算')),item
    assert all(code not in item['answer'] for code in ('HOST_REQUEST_REJECTED','DIAGNOSTIC_ALREADY_REPORTED','METHOD_RELEASE_CHANGED')),item
    item['acceptance']='passed';run.save()


def test_real_type_proposal_human_approval_and_workspace_undo(real_use):
    run=real_use;_,types=projects(run);assert types
    design=next((t for t in types if 'YJV22' in t['name']),types[0])
    original=run.api('GET','/api/workspaces/'+design['id'])
    core=original['domain']['cable_types'][0]['cores'][0]
    insulation=next(layer for layer in core['layers'] if layer['role']=='insulation')
    before=insulation['thickness'];after_mm=round(before*1000+.1,4)
    record,item=run.ask('type_proposal',design['id'],
        f'请给「{design["name"]}」第一芯的绝缘层厚度提出一项修改方案：改为 {after_mm} mm。只提方案供我批准，不保存、不试算、不运行、不提交作业，保留已有材料和来源。')
    pending=[p for p in record['proposals'] if p['status']=='pending'];assert len(pending)==1,item
    assert record['budget']['model_requests']<=8,item
    proposal=pending[0];assert proposal['kind']=='type',proposal
    held=run.api('GET','/api/workspaces/'+design['id']);assert held['revision']==original['revision']
    receipt=run.api('POST',f'/api/agent/proposals/{proposal["id"]}/approve');assert receipt['status']=='approved'
    item['human_operations']={'approval':receipt};run.save()
    changed=run.api('GET','/api/workspaces/'+design['id'])
    layer=lambda state:next(l for l in state['domain']['cable_types'][0]['cores'][0]['layers'] if l['role']==insulation['role'])
    assert changed['revision']==original['revision']+1 and abs(layer(changed)['thickness']-after_mm/1000)<1e-12
    restored=run.api('POST',f'/api/workspaces/{design["id"]}/history/undo',json={'expected_revision':changed['revision']})
    assert restored['revision']==changed['revision']+1 and layer(restored)['thickness']==before
    item['human_operations']={'approval':receipt,'before_mm':before*1000,'after_mm':after_mm,
        'restored_mm':layer(restored)['thickness']*1000,'before_revision':original['revision'],
        'approved_revision':changed['revision'],'undo_revision':restored['revision']}
    item['acceptance']='passed';run.save()


if __name__=='__main__':
    assert sys.argv[1]=='--serve'
    serve(*sys.argv[2:])
