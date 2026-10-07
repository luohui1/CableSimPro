"""Four task-side tables, immutable plans/events and durable operation identities."""
from dataclasses import asdict
import json
from time import time
from uuid import uuid4, uuid5, NAMESPACE_URL

from fastapi import HTTPException

from backend.kernel.workspace import fingerprint, stamp
from .contracts import Limits
from .security import redact


def encode(value):
    return json.dumps(redact(value),ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False)


class TaskStore:
    def __init__(self,workspace_store,owner_epoch,limits=None):
        self.workspace = workspace_store
        self.owner_epoch = owner_epoch
        self.limits = limits or Limits()

    def initialize(self):
        with self.workspace.db(True) as db:
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

    def create(self,wid,sid,wrev,srev):
        tid,created = str(uuid4()),stamp()
        with self.workspace.db(True) as db:
            self.workspace.load(db,wid,wrev,allow_domain=True)
            db.execute('INSERT INTO agent_tasks(id,workspace_id,study_id,workspace_revision,study_revision,state,owner_epoch,deadline,limits,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                (tid,wid,sid,wrev,srev,'created',self.owner_epoch,time()+self.limits.lifetime_s,encode(asdict(self.limits)),created,created))
            self.event(db,tid,'execution.authorization',{'source':'human.session','workspace_id':wid,'workspace_revision':wrev,
                'study_id':sid,'study_revision':srev,'effects':['read','propose','preflight','local_fast_preview'],
                'limits':asdict(self.limits),'formal_run':False,'hpc_submit':False,'engineering_approval':False})
        return tid

    def budget(self,task,*,model=False,tool=False):
        limits = task['limits']
        exceeded = (time()>=task['deadline'] or task['elapsed_ms']>=limits['max_active_ms']
            or task['steps_used']>=limits['max_steps']
            or task['prompt_tokens']+task['completion_tokens']>=limits['max_tokens']
            or model and task['model_requests']>=limits['max_model_requests']
            or tool and task['tool_calls']>=limits['max_tool_calls'])
        if exceeded:raise HTTPException(429,{'code':'BUDGET_EXCEEDED','message':'本会话的工具、步骤、时间或模型用量已达到上限；未继续执行。'})

    def begin_turn(self,tid,content):
        turn = str(uuid4())
        with self.workspace.db(True) as db:
            task = self.load(db,tid)
            if task['active_turn']:raise HTTPException(409,'此 Agent 会话正在处理消息，请等待当前步骤完成。')
            db.execute("UPDATE agent_tasks SET active_turn=?,owner_epoch=?,state='planning',waiting_reason=NULL,updated=? WHERE id=?",(turn,self.owner_epoch,stamp(),tid))
            self.event(db,tid,'chat.message',{'role':'user','content':content,'turn_id':turn})
        return turn

    def begin_model(self,tid,turn,request_summary):
        with self.workspace.db(True) as db:
            task = self.load(db,tid);self.assert_turn(task,turn);self.budget(task,model=True)
            db.execute('UPDATE agent_tasks SET model_requests=model_requests+1,steps_used=steps_used+1,updated=? WHERE id=?',(stamp(),tid))
            self.event(db,tid,'model.request',request_summary)
            return task

    @staticmethod
    def assert_turn(task,turn):
        if task['active_turn']!=turn:raise HTTPException(409,'Agent 消息执行身份已变化；不会写回迟到结果。')

    def model_finished(self,tid,turn,elapsed_ms,usage,reply_summary):
        with self.workspace.db(True) as db:
            task=self.load(db,tid);self.assert_turn(task,turn)
            db.execute('UPDATE agent_tasks SET elapsed_ms=elapsed_ms+?,prompt_tokens=prompt_tokens+?,completion_tokens=completion_tokens+?,updated=? WHERE id=?',
                (elapsed_ms,usage.get('prompt_tokens',0),usage.get('completion_tokens',0),stamp(),tid))
            self.event(db,tid,'model.result',{'elapsed_ms':elapsed_ms,'usage':usage,**reply_summary})

    def add_plan(self,tid,body,proposal_id=None,connection=None):
        from contextlib import nullcontext
        with (nullcontext(connection) if connection is not None else self.workspace.db(True)) as db:
            task=self.load(db,tid)
            revision=task['plan_revision']+1
            encoded=encode(body)
            db.execute('INSERT INTO agent_plan_revisions VALUES (?,?,?,?,?,?)',(tid,revision,proposal_id,encoded,fingerprint(json.loads(encoded)),stamp()))
            db.execute('UPDATE agent_tasks SET plan_revision=?,updated=? WHERE id=?',(revision,stamp(),tid))
            self.event(db,tid,'plan.created',{'revision':revision,'digest':fingerprint(json.loads(encoded)),'proposal_id':proposal_id})
        return revision

    def issue(self,tid,turn,revision,node):
        with self.workspace.db(True) as db:
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

    def running(self,tid,operation):
        with self.workspace.db(True) as db:
            if not db.execute("UPDATE agent_steps SET state='running' WHERE task_id=? AND operation_id=? AND state='issued' AND owner_epoch=?",(tid,operation,self.owner_epoch)).rowcount:
                raise HTTPException(409,'工具操作身份或状态已变化。')

    def finish_step(self,tid,operation,result,elapsed_ms):
        with self.workspace.db(True) as db:
            state='succeeded' if result['status']=='ok' else 'failed'
            reference=result.get('execution_ref')
            if not db.execute("UPDATE agent_steps SET state=?,result=?,execution_ref=?,run_id=?,elapsed_ms=?,finished=? WHERE task_id=? AND operation_id=? AND state='running' AND owner_epoch=?",
                (state,encode(result),encode(reference) if reference else None,(reference or {}).get('run_id'),elapsed_ms,stamp(),tid,operation,self.owner_epoch)).rowcount:
                raise HTTPException(409,'工具结果不能覆盖已恢复或已结束的操作。')
            db.execute('UPDATE agent_tasks SET elapsed_ms=elapsed_ms+?,updated=? WHERE id=?',(elapsed_ms,stamp(),tid))

    def reconcile_step(self,tid,operation,result):
        with self.workspace.db(True) as db:
            self.load(db,tid)
            changed=db.execute("UPDATE agent_steps SET state=?,result=?,finished=?,owner_epoch=? WHERE task_id=? AND operation_id=? AND state='unknown'",
                ('succeeded' if result['status']=='ok' else 'failed',encode(result),stamp(),self.owner_epoch,tid,operation)).rowcount
            if changed:self.event(db,tid,'tool.reconciled',{'operation_id':operation,'execution_ref':result['execution_ref'],'status':result['status'],'reissued':False})

    def finish_turn(self,tid,turn,state='completed',waiting_reason=None):
        with self.workspace.db(True) as db:
            task=self.load(db,tid)
            if task['active_turn']!=turn:return
            db.execute("UPDATE agent_steps SET state='cancelled',finished=? WHERE task_id=? AND state='issued'",(stamp(),tid))
            unknown=db.execute("UPDATE agent_steps SET state='unknown' WHERE task_id=? AND state='running'",(tid,)).rowcount
            if unknown:state,waiting_reason='waiting','capability'
            db.execute('UPDATE agent_tasks SET active_turn=NULL,state=?,waiting_reason=?,updated=? WHERE id=?',(state,waiting_reason,stamp(),tid))
            self.event(db,tid,'task.state',{'state':state,'waiting_reason':waiting_reason})

    def emit(self,tid,kind,data):
        with self.workspace.db(True) as db:self.event(db,tid,kind,data)

    def proposal(self,db,pid):
        row=db.execute('SELECT * FROM agent_plan_revisions WHERE proposal_id=?',(pid,)).fetchone()
        if row is None:raise HTTPException(404,'Agent 方案不存在。')
        body=json.loads(row['body'])
        if fingerprint(body)!=row['digest']:raise HTTPException(409,'方案摘要不一致，拒绝批准。')
        task=self.load(db,row['task_id'])
        decision=db.execute("SELECT data FROM agent_events WHERE task_id=? AND type='proposal.decision' AND json_extract(data,'$.id')=? ORDER BY sequence DESC LIMIT 1",(task['id'],pid)).fetchone()
        return task,body['proposal'],json.loads(decision['data']) if decision else None

    def record(self,tid):
        with self.workspace.db() as db:
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
                'usage_reported_only':True,'usage_complete':all(event['data'].get('usage_available',False) for event in events if event['type']=='model.result')},
            'messages':[event['data'] for event in events if event['type']=='chat.message'],
            'tool_calls':[event['data'] for event in events if event['type']=='tool.call'],
            'results':[{'id':step['node_id'],**step['result']} for step in steps if step['result']],
            'proposals':proposals,'plans':plans,'steps':steps,'events':events}
