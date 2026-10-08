"""Four task-side tables, immutable plans/events and durable operation identities."""
from dataclasses import asdict
import json
import sqlite3
import codecs
from contextlib import contextmanager
from time import time
from uuid import uuid4, uuid5, NAMESPACE_URL

from fastapi import HTTPException

from backend.kernel.workspace import fingerprint, stamp
from .contracts import Limits
from .security import redact
from .resilience import transaction
from .context_builder import compress_result


def encode(value):
    return json.dumps(redact(value),ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False)


class TaskStore:
    def __init__(self,workspace_store,owner_epoch,limits=None):
        self.workspace = workspace_store
        self.owner_epoch = owner_epoch
        self.limits = limits or Limits.configured()

    @contextmanager
    def db(self,write=False):
        # Task records use a short busy wait; retry only after transaction rollback.
        db=sqlite3.connect(self.workspace.path,timeout=.1,check_same_thread=False)
        try:
            with db:
                db.row_factory=sqlite3.Row
                if write:db.execute('BEGIN IMMEDIATE')
                yield db
        finally:db.close()

    def initialize(self):
        with self.db(True) as db:
            db.executescript('''
            CREATE TABLE IF NOT EXISTS agent_tasks (
              id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, study_id TEXT,
              workspace_revision INTEGER NOT NULL, study_revision INTEGER,
              state TEXT NOT NULL, waiting_reason TEXT, plan_revision INTEGER NOT NULL DEFAULT 0,
              owner_epoch TEXT NOT NULL, active_turn TEXT,
              tool_calls INTEGER NOT NULL DEFAULT 0, model_requests INTEGER NOT NULL DEFAULT 0,
              steps_used INTEGER NOT NULL DEFAULT 0, elapsed_ms REAL NOT NULL DEFAULT 0,
              prompt_tokens INTEGER NOT NULL DEFAULT 0, completion_tokens INTEGER NOT NULL DEFAULT 0,
              deadline REAL NOT NULL, limits TEXT NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL,
              FOREIGN KEY(workspace_id) REFERENCES workspaces(id), FOREIGN KEY(study_id) REFERENCES studies(id));
            CREATE TABLE IF NOT EXISTS agent_plan_revisions (
              task_id TEXT NOT NULL, revision INTEGER NOT NULL, proposal_id TEXT UNIQUE,
              body TEXT NOT NULL, digest TEXT NOT NULL, created TEXT NOT NULL,
              PRIMARY KEY(task_id,revision), FOREIGN KEY(task_id) REFERENCES agent_tasks(id));
            CREATE TABLE IF NOT EXISTS agent_steps (
              task_id TEXT NOT NULL, plan_revision INTEGER NOT NULL, node_id TEXT NOT NULL, attempt INTEGER NOT NULL,
              operation_id TEXT NOT NULL UNIQUE, tool TEXT NOT NULL, state TEXT NOT NULL,
              arguments TEXT NOT NULL, arguments_digest TEXT NOT NULL, input_identity TEXT NOT NULL,
              study_id TEXT, run_id TEXT, budget_ref TEXT NOT NULL, execution_ref TEXT,
              result TEXT, elapsed_ms REAL, owner_epoch TEXT NOT NULL, created TEXT NOT NULL, finished TEXT,
              PRIMARY KEY(task_id,plan_revision,node_id,attempt), FOREIGN KEY(task_id) REFERENCES agent_tasks(id));
            CREATE TABLE IF NOT EXISTS agent_events (
              sequence INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, type TEXT NOT NULL,
              data TEXT NOT NULL, created TEXT NOT NULL, FOREIGN KEY(task_id) REFERENCES agent_tasks(id));
            CREATE INDEX IF NOT EXISTS agent_events_task ON agent_events(task_id,sequence);
            CREATE TRIGGER IF NOT EXISTS agent_plans_immutable_update BEFORE UPDATE ON agent_plan_revisions
              BEGIN SELECT RAISE(ABORT,'agent plan revisions are immutable'); END;
            CREATE TRIGGER IF NOT EXISTS agent_plans_immutable_delete BEFORE DELETE ON agent_plan_revisions
              BEGIN SELECT RAISE(ABORT,'agent plan revisions are immutable'); END;
            CREATE TRIGGER IF NOT EXISTS agent_events_append_only_update BEFORE UPDATE ON agent_events
              BEGIN SELECT RAISE(ABORT,'agent events are append-only'); END;
            CREATE TRIGGER IF NOT EXISTS agent_events_append_only_delete BEFORE DELETE ON agent_events
              BEGIN SELECT RAISE(ABORT,'agent events are append-only'); END;
            ''')
            rows = db.execute("SELECT * FROM agent_tasks WHERE owner_epoch<>? AND (active_turn IS NOT NULL OR state IN ('planning','running') OR EXISTS (SELECT 1 FROM agent_steps WHERE task_id=agent_tasks.id AND state IN ('issued','running')))",(self.owner_epoch,)).fetchall()
            for row in rows:
                unknown = db.execute("UPDATE agent_steps SET state='unknown' WHERE task_id=? AND state IN ('issued','running')",(row['id'],)).rowcount
                db.execute("UPDATE agent_tasks SET state='waiting',waiting_reason='capability',active_turn=NULL,owner_epoch=?,updated=? WHERE id=?",(self.owner_epoch,stamp(),row['id']))
                self.event(db,row['id'],'task.recovered',{'unknown_steps':unknown,'message':'已保留中断意图；先对账，不自动重复执行。'})

    def event(self,db,tid,kind,data):
        db.execute('INSERT INTO agent_events(task_id,type,data,created) VALUES (?,?,?,?)',(tid,kind,encode(data),stamp()))

    def load(self,db,tid):
        row = db.execute('SELECT * FROM agent_tasks WHERE id=?',(tid,)).fetchone()
        if row is None:raise HTTPException(404,'Agent 会话不存在。')
        value = dict(row)
        value['limits'] = json.loads(value['limits'])
        return value

    @transaction
    def create(self,wid,sid,wrev,srev,limits=None):
        limits = limits or self.limits
        tid,created = str(uuid4()),stamp()
        with self.db(True) as db:
            self.workspace.load(db,wid,wrev,allow_domain=True)
            db.execute('INSERT INTO agent_tasks(id,workspace_id,study_id,workspace_revision,study_revision,state,owner_epoch,deadline,limits,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                (tid,wid,sid,wrev,srev,'created',self.owner_epoch,time()+limits.lifetime_s,encode(asdict(limits)),created,created))
            self.event(db,tid,'execution.authorization',{'source':'human.session','workspace_id':wid,'workspace_revision':wrev,
                'study_id':sid,'study_revision':srev,'effects':['read','propose','preflight','local_fast_preview'],
                'limits':asdict(limits),'formal_run':False,'hpc_submit':False,'engineering_approval':False})
        return tid

    def budget(self,task,*,model=False,tool=False):
        limits = task['limits']
        exceeded = (time()>=task['deadline'] or task['elapsed_ms']>=limits['max_active_ms']
            or task['steps_used']>=limits['max_steps']
            or task['prompt_tokens']+task['completion_tokens']>=limits['max_tokens']
            or model and task['model_requests']>=limits['max_model_requests']
            or tool and task['tool_calls']>=limits['max_tool_calls'])
        if exceeded:raise HTTPException(429,{'code':'BUDGET_EXCEEDED','message':'本条消息的工具、步骤、时间或模型用量已达到上限；未继续执行。'})

    def closing_reason(self,task,prompt_bytes,definition_bytes,*,repair=False):
        limits=task['limits']
        # UTF-8 bytes are a conservative token upper estimate, not reported usage.
        closing_reserve=min(48*1024+4096, prompt_bytes+4096)
        request_estimate=prompt_bytes+definition_bytes+2048
        if not repair and task['tool_calls']>=limits['max_tool_calls']:return '本条消息的工具调用预算不足。'
        if task['model_requests']>=limits['max_model_requests']-1:return '本条消息的模型请求预算不足，已预留一次收尾。'
        if task['steps_used']>=limits['max_steps']-2:return '本条消息的步骤预算不足。'
        if task['prompt_tokens']+task['completion_tokens']+request_estimate+closing_reserve>limits['max_tokens']:
            return '本条消息的剩余token预算不足以继续工具循环。'
        reserve_ms=min(5000,limits['max_active_ms']/4)
        if task['elapsed_ms']>=limits['max_active_ms']-reserve_ms or time()>=task['deadline']-reserve_ms/1000:
            return '本条消息的剩余时间不足以继续工具循环。'
        return None

    @transaction
    def begin_turn(self,tid,content,recipe=None):
        turn = str(uuid4())
        with self.db(True) as db:
            task = self.load(db,tid)
            if task['active_turn']:raise HTTPException(409,'此 Agent 会话正在处理消息，请等待当前步骤完成。')
            db.execute("UPDATE agent_tasks SET active_turn=?,owner_epoch=?,state='planning',waiting_reason=NULL,tool_calls=0,model_requests=0,steps_used=0,elapsed_ms=0,prompt_tokens=0,completion_tokens=0,deadline=?,limits=?,updated=? WHERE id=?",
                (turn,self.owner_epoch,time()+self.limits.lifetime_s,encode(asdict(self.limits)),stamp(),tid))
            self.event(db,tid,'chat.message',{'role':'user','content':content,'turn_id':turn,**({'recipe':recipe} if recipe else {})})
            self.event(db,tid,'turn.read_policy',{'turn_id':turn,'max_read_tool_calls':self.limits.max_read_tool_calls,
                'scope':'message','explicit_recipe':bool(recipe)})
        return turn

    @transaction
    def begin_model(self,tid,turn,request_summary,*,closing=False):
        with self.db(True) as db:
            task = self.load(db,tid);self.assert_turn(task,turn)
            if closing:
                previous=db.execute("SELECT 1 FROM agent_events WHERE task_id=? AND type='model.request' AND json_extract(data,'$.turn_id')=? AND json_extract(data,'$.phase')='closing'",(tid,turn)).fetchone()
                if previous:raise HTTPException(409,'本条消息已使用收尾请求。')
            else:self.budget(task,model=True)
            db.execute('UPDATE agent_tasks SET model_requests=model_requests+1,steps_used=steps_used+1,updated=? WHERE id=?',(stamp(),tid))
            self.event(db,tid,'model.request',{**request_summary,'turn_id':turn,'phase':'closing' if closing else request_summary.get('phase','tools'),'request_number':task['model_requests']+1})
            return task

    @staticmethod
    def assert_turn(task,turn):
        if task['active_turn']!=turn:raise HTTPException(409,'Agent 消息执行身份已变化；不会写回迟到结果。')

    @transaction
    def model_finished(self,tid,turn,elapsed_ms,usage,reply_summary):
        with self.db(True) as db:
            task=self.load(db,tid);self.assert_turn(task,turn)
            db.execute('UPDATE agent_tasks SET elapsed_ms=elapsed_ms+?,prompt_tokens=prompt_tokens+?,completion_tokens=completion_tokens+?,updated=? WHERE id=?',
                (elapsed_ms,usage.get('prompt_tokens',0),usage.get('completion_tokens',0),stamp(),tid))
            self.event(db,tid,'model.result',{'turn_id':turn,'request_number':task['model_requests'],'elapsed_ms':elapsed_ms,'usage':usage,**reply_summary})

    def add_plan(self,tid,body,proposal_id=None,connection=None):
        from contextlib import nullcontext
        with (nullcontext(connection) if connection is not None else self.db(True)) as db:
            task=self.load(db,tid)
            revision=task['plan_revision']+1
            encoded=encode(body)
            db.execute('INSERT INTO agent_plan_revisions VALUES (?,?,?,?,?,?)',(tid,revision,proposal_id,encoded,fingerprint(json.loads(encoded)),stamp()))
            db.execute('UPDATE agent_tasks SET plan_revision=?,updated=? WHERE id=?',(revision,stamp(),tid))
            self.event(db,tid,'plan.created',{'revision':revision,'digest':fingerprint(json.loads(encoded)),'proposal_id':proposal_id})
        return revision

    @transaction
    def issue(self,tid,turn,revision,node):
        with self.db(True) as db:
            task=self.load(db,tid);self.assert_turn(task,turn)
            operation = str(uuid5(NAMESPACE_URL,f"cablesim-agent:{tid}:{revision}:{node['id']}:1"))
            arguments=redact(node['arguments'])
            old=db.execute('SELECT arguments_digest,input_identity FROM agent_steps WHERE operation_id=?',(operation,)).fetchone()
            if old:
                if old['arguments_digest']!=fingerprint(arguments) or json.loads(old['input_identity'])!=node['input_identity']:
                    raise HTTPException(409,{'code':'OPERATION_INPUT_CONFLICT','message':'同一工具操作身份不能对应不同输入。'})
                return operation
            self.budget(task,tool=True)
            db.execute('INSERT INTO agent_steps(task_id,plan_revision,node_id,attempt,operation_id,tool,state,arguments,arguments_digest,input_identity,study_id,budget_ref,owner_epoch,created) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                (tid,revision,node['id'],1,operation,node['tool'],'issued',encode(arguments),fingerprint(arguments),encode(node['input_identity']),node['input_identity'].get('study_id'),tid,self.owner_epoch,stamp()))
            db.execute("UPDATE agent_tasks SET tool_calls=tool_calls+1,steps_used=steps_used+1,state='running',updated=? WHERE id=?",(stamp(),tid))
            self.event(db,tid,'tool.intent',{'id':node['id'],'operation_id':operation,'plan_revision':revision,
                'tool':node['tool'],'arguments_digest':fingerprint(arguments),'input_identity':node['input_identity']})
            return operation

    @transaction
    def running(self,tid,operation):
        with self.db(True) as db:
            if not db.execute("UPDATE agent_steps SET state='running' WHERE task_id=? AND operation_id=? AND state='issued' AND owner_epoch=?",(tid,operation,self.owner_epoch)).rowcount:
                raise HTTPException(409,'工具操作身份或状态已变化。')

    @transaction
    def finish_step(self,tid,operation,result,elapsed_ms):
        with self.db(True) as db:
            state='succeeded' if result['status']=='ok' else 'failed'
            reference=result.get('execution_ref')
            if not db.execute("UPDATE agent_steps SET state=?,result=?,execution_ref=?,run_id=?,elapsed_ms=?,finished=? WHERE task_id=? AND operation_id=? AND state='running' AND owner_epoch=?",
                (state,encode(result),encode(reference) if reference else None,(reference or {}).get('run_id'),elapsed_ms,stamp(),tid,operation,self.owner_epoch)).rowcount:
                raise HTTPException(409,'工具结果不能覆盖已恢复或已结束的操作。')
            db.execute('UPDATE agent_tasks SET elapsed_ms=elapsed_ms+?,updated=? WHERE id=?',(elapsed_ms,stamp(),tid))
            self.event(db,tid,'tool.observation',{'operation_id':operation,'result':compress_result(result),
                'original_ref':{'table':'agent_steps','operation_id':operation}})

    def reconcile_step(self,tid,operation,result):
        with self.db(True) as db:
            self.load(db,tid)
            changed=db.execute("UPDATE agent_steps SET state=?,result=?,finished=?,owner_epoch=? WHERE task_id=? AND operation_id=? AND state='unknown'",
                ('succeeded' if result['status']=='ok' else 'failed',encode(result),stamp(),self.owner_epoch,tid,operation)).rowcount
            if changed:self.event(db,tid,'tool.reconciled',{'operation_id':operation,'execution_ref':result['execution_ref'],'status':result['status'],'reissued':False})

    @transaction
    def finish_turn(self,tid,turn,state='completed',waiting_reason=None):
        with self.db(True) as db:
            task=self.load(db,tid)
            if task['active_turn']!=turn:return
            db.execute("UPDATE agent_steps SET state='cancelled',finished=? WHERE task_id=? AND state='issued'",(stamp(),tid))
            unknown=db.execute("UPDATE agent_steps SET state='unknown' WHERE task_id=? AND state='running'",(tid,)).rowcount
            if unknown:state,waiting_reason='waiting','capability'
            db.execute('UPDATE agent_tasks SET active_turn=NULL,state=?,waiting_reason=?,updated=? WHERE id=?',(state,waiting_reason,stamp(),tid))
            self.event(db,tid,'task.state',{'state':state,'waiting_reason':waiting_reason})

    @transaction
    def emit(self,tid,kind,data):
        with self.db(True) as db:self.event(db,tid,kind,data)

    def proposal(self,db,pid):
        row=db.execute('SELECT * FROM agent_plan_revisions WHERE proposal_id=?',(pid,)).fetchone()
        if row is None:raise HTTPException(404,'Agent 方案不存在。')
        body=json.loads(row['body'])
        if fingerprint(body)!=row['digest']:raise HTTPException(409,'方案摘要不一致，拒绝批准。')
        task=self.load(db,row['task_id'])
        decision=db.execute("SELECT data FROM agent_events WHERE task_id=? AND type='proposal.decision' AND json_extract(data,'$.id')=? ORDER BY sequence DESC LIMIT 1",(task['id'],pid)).fetchone()
        return task,body['proposal'],json.loads(decision['data']) if decision else None

    def sessions(self,wid=None,limit=100):
        """Newest first; the title is the first user message, pending counts undecided proposals."""
        with self.db() as db:
            rows=db.execute('SELECT * FROM agent_tasks'+(' WHERE workspace_id=?' if wid else '')+' ORDER BY updated DESC LIMIT ?',((wid,) if wid else ())+(limit,)).fetchall()
            summaries=[]
            for row in rows:
                first=db.execute("SELECT data FROM agent_events WHERE task_id=? AND type='chat.message' AND json_extract(data,'$.role')='user' ORDER BY sequence LIMIT 1",(row['id'],)).fetchone()
                pending=db.execute("""SELECT COUNT(*) FROM agent_plan_revisions p WHERE p.task_id=? AND p.proposal_id IS NOT NULL
                    AND NOT EXISTS (SELECT 1 FROM agent_events e WHERE e.task_id=p.task_id AND e.type='proposal.decision' AND json_extract(e.data,'$.id')=p.proposal_id)""",(row['id'],)).fetchone()[0]
                summaries.append({'id':row['id'],'workspace_id':row['workspace_id'],'study_id':row['study_id'],'state':row['state'],
                    'waiting_reason':row['waiting_reason'],'title':json.loads(first['data'])['content'][:80] if first else '',
                    'created':row['created'],'updated':row['updated'],'pending_proposals':pending})
        return summaries

    @transaction
    def record(self,tid):
        with self.db() as db:
            db.execute('BEGIN')
            task=self.load(db,tid)
            events=[{'sequence':row['sequence'],'type':row['type'],'created':row['created'],'data':json.loads(row['data'])}
                for row in db.execute('SELECT * FROM agent_events WHERE task_id=? ORDER BY sequence',(tid,))]
            plans=[{'revision':row['revision'],'digest':row['digest'],'created':row['created'],'body':json.loads(row['body'])}
                for row in db.execute('SELECT * FROM agent_plan_revisions WHERE task_id=? ORDER BY revision',(tid,))]
            steps=[]
            for row in db.execute('SELECT * FROM agent_steps WHERE task_id=? ORDER BY rowid',(tid,)):
                value=dict(row)
                for key in ('arguments','input_identity','result','execution_ref'):
                    value[key]=json.loads(value[key]) if value[key] else None
                steps.append(value)
            proposals=[]
            for plan in plans:
                private=plan['body'].get('proposal')
                if private:
                    _,_,decision=self.proposal(db,private['id'])
                    proposals.append({**private['public'],'status':decision['status'] if decision else 'pending'})
        return {'id':tid,'workspace_id':task['workspace_id'],'study_id':task['study_id'],
            'workspace_revision':task['workspace_revision'],'study_revision':task['study_revision'],
            'state':task['state'],'waiting_reason':task['waiting_reason'],'created':task['created'],'updated':task['updated'],
            'budget':{'limits':task['limits'],'tool_calls':task['tool_calls'],'model_requests':task['model_requests'],
                'steps_used':task['steps_used'],'elapsed_ms':task['elapsed_ms'],'prompt_tokens':task['prompt_tokens'],
                'completion_tokens':task['completion_tokens'],'deadline':task['deadline'],
                'scope':'message','turn_id':task['active_turn'] or next((event['data']['turn_id'] for event in reversed(events) if event['type']=='chat.message' and event['data'].get('role')=='user'),None),
                'session_totals':{key:sum(event['data'].get('usage',{}).get(key,0) for event in events if event['type']=='model.result') for key in ('prompt_tokens','completion_tokens')},
                'usage_reported_only':True,'usage_complete':all(event['data'].get('usage_available',False) for event in events if event['type']=='model.result')},
            'messages':[event['data'] for event in events if event['type']=='chat.message'],
            'tool_calls':[event['data'] for event in events if event['type']=='tool.call'],
            'results':[{'id':step['node_id'],**step['result']} for step in steps if step['result']],
            'proposals':proposals,'plans':plans,'steps':steps,'events':events,
            'enabled_tools':sorted({name for step in steps if step['tool']=='plugin_inspect' and step.get('result') and step['result']['status']=='ok'
                for name in step['result']['data'].get('enabled_tools',[])})}

    def stream_record(self,tid):
        """One consistent SQLite snapshot, raw JSON fields in bounded text slices.

        Never construct all steps/events or parse a large result. Connections allow
        ASGI's worker-thread iterator to resume on a different worker thread.
        """
        encoder=json.JSONEncoder(ensure_ascii=False,separators=(',',':'),allow_nan=False)
        with self.db() as db:
            db.execute('BEGIN')
            task=self.load(db,tid)
            user=db.execute("SELECT json_extract(data,'$.turn_id') FROM agent_events WHERE task_id=? AND type='chat.message' AND json_extract(data,'$.role')='user' ORDER BY sequence DESC LIMIT 1",(tid,)).fetchone()
            totals=db.execute("SELECT COALESCE(SUM(json_extract(data,'$.usage.prompt_tokens')),0),COALESCE(SUM(json_extract(data,'$.usage.completion_tokens')),0),COALESCE(MIN(json_extract(data,'$.usage_available')),1) FROM agent_events WHERE task_id=? AND type='model.result'",(tid,)).fetchone()
            head={key:task[key] for key in ('id','workspace_id','study_id','workspace_revision','study_revision','state','waiting_reason','created','updated')}
            head['budget']={key:task[key] for key in ('limits','tool_calls','model_requests','steps_used','elapsed_ms','prompt_tokens','completion_tokens','deadline')}
            head['budget'].update(scope='message',turn_id=task['active_turn'] or (user[0] if user else None),
                session_totals=dict(zip(('prompt_tokens','completion_tokens'),totals[:2])),usage_reported_only=True,usage_complete=bool(totals[2]))
            prefix=encoder.encode(head)
            yield prefix[:-1]

            def raw(table,column,rowid,start=1,stop=None):
                if column.isidentifier():
                    # SQLite's incremental blob API also reads TEXT bytes. Avoid
                    # materializing a giant TEXT column or rescanning it per slice.
                    with db.blobopen(table,column,rowid,readonly=True) as blob:
                        end=len(blob)-(1 if stop is not None else 0)
                        blob.seek(start-1);decoder=codecs.getincrementaldecoder('utf-8')()
                        while blob.tell()<end:
                            yield decoder.decode(blob.read(min(8192,end-blob.tell())))
                        tail=decoder.decode(b'',final=True)
                        if tail:yield tail
                    return
                size=stop if stop is not None else db.execute(f'SELECT length({column}) FROM {table} WHERE rowid=?',(rowid,)).fetchone()[0]
                for offset in range(start,(size or 0)+1,8192):
                    yield db.execute(f'SELECT substr({column},?,?) FROM {table} WHERE rowid=?',
                        (offset,min(8192,size-offset+1),rowid)).fetchone()[0]

            def array(name,items):
                yield ','+encoder.encode(name)+':['
                for index,item in enumerate(items):
                    if index:yield ','
                    yield from item
                yield ']'

            for name,kind in (('messages','chat.message'),('tool_calls','tool.call')):
                yield from array(name,(raw('agent_events','data',row[0]) for row in db.execute(
                    'SELECT rowid FROM agent_events WHERE task_id=? AND type=? ORDER BY sequence',(tid,kind))))

            def steps():
                for row in db.execute('SELECT rowid,task_id,plan_revision,node_id,attempt,operation_id,tool,state,arguments_digest,study_id,run_id,budget_ref,elapsed_ms,owner_epoch,created,finished FROM agent_steps WHERE task_id=? ORDER BY rowid',(tid,)):
                    def one(row=row):
                        value=dict(row);rid=value.pop('rowid')
                        yield encoder.encode(value)[:-1]
                        for key in ('arguments','input_identity','result','execution_ref'):
                            yield ','+encoder.encode(key)+':'
                            if db.execute(f'SELECT {key} IS NULL FROM agent_steps WHERE rowid=?',(rid,)).fetchone()[0]:yield 'null'
                            else:yield from raw('agent_steps',key,rid)
                        yield '}'
                    yield one()
            yield from array('steps',steps())
            def results():
                for row in db.execute('SELECT rowid,node_id,length(result) AS size FROM agent_steps WHERE task_id=? AND result IS NOT NULL ORDER BY rowid',(tid,)):
                    def one(row=row):
                        yield '{"id":'+encoder.encode(row['node_id'])+','
                        yield from raw('agent_steps','result',row['rowid'],2,row['size']-1)
                        yield '}'
                    yield one()
            yield from array('results',results())
            def events():
                for row in db.execute('SELECT rowid AS storage_rowid,sequence,type,created FROM agent_events WHERE task_id=? ORDER BY sequence',(tid,)):
                    def one(row=row):
                        yield encoder.encode({key:row[key] for key in ('sequence','type','created')})[:-1]+',"data":'
                        yield from raw('agent_events','data',row['storage_rowid']);yield '}'
                    yield one()
            yield from array('events',events())
            def plans():
                for row in db.execute('SELECT rowid,revision,digest,created FROM agent_plan_revisions WHERE task_id=? ORDER BY revision',(tid,)):
                    def one(row=row):
                        yield encoder.encode({key:row[key] for key in ('revision','digest','created')})[:-1]+',"body":'
                        yield from raw('agent_plan_revisions','body',row['rowid']);yield '}'
                    yield one()
            yield from array('plans',plans())
            def proposals():
                public="json_extract(body,'$.proposal.public')"
                for row in db.execute('SELECT rowid,proposal_id,length('+public+') AS size FROM agent_plan_revisions WHERE task_id=? AND proposal_id IS NOT NULL ORDER BY revision',(tid,)):
                    def one(row=row):
                        yield from raw('agent_plan_revisions',public,row['rowid'],1,row['size']-1)
                        decision=db.execute("SELECT json_extract(data,'$.status') FROM agent_events WHERE task_id=? AND type='proposal.decision' AND json_extract(data,'$.id')=? ORDER BY sequence DESC LIMIT 1",(tid,row['proposal_id'])).fetchone()
                        yield ',"status":'+encoder.encode(decision[0] if decision else 'pending')+'}'
                    yield one()
            yield from array('proposals',proposals())
            enabled=sorted({row[0] for row in db.execute("SELECT j.value FROM agent_steps s,json_each(s.result,'$.data.enabled_tools') j WHERE s.task_id=? AND s.tool='plugin_inspect' AND json_extract(s.result,'$.status')='ok'",(tid,))})
            yield ',"enabled_tools":'+encoder.encode(enabled)+'}'
