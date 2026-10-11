"""Workspace-scoped durable memory, with atomic background LangMem proposals."""
from importlib.metadata import PackageNotFoundError, version
import json
import re
import sqlite3
from threading import Event, Lock, Thread
from uuid import uuid4

from fastapi import HTTPException

from backend.kernel.workspace import fingerprint, stamp
from .context_builder import fits
from .memory_contracts import MemoryFact, MemorySettings
from .memory_extract import VERSION
from .security import redact
from .resilience import retry


def reject(code, message, status=409):
    raise HTTPException(status, {'code': code, 'message': message})


def terms(text):
    """Local lexical retrieval: words and Chinese bigrams, not embeddings."""
    words = set(re.findall(r'[a-zA-Z][a-zA-Z0-9_]+', text.casefold()))
    for run in re.findall(r'[\u3400-\u9fff]+', text):
        words.update(run[i:i+2] for i in range(len(run)-1))
    return words


class Memories:
    def __init__(self, harness):
        self.harness, self.tasks = harness, harness.tasks
        self.stop, self.wake, self.guard = Event(), Event(), Lock()
        self.worker = None
        self.extractor = None  # Lazy real engine; injectable only for offline tests.
        self.available = False
        self.runtime_error = 'MEMORY_DEPENDENCY_MISSING'
        self.worker_error = None
        self.pending_failure = None

    def initialize(self):
        try:
            self.available = version('langmem') == VERSION
            if not self.available: self.runtime_error = 'MEMORY_DEPENDENCY_VERSION'
        except PackageNotFoundError:
            pass
        with self.tasks.db(True) as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS agent_memory_settings (
                    id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS agent_memory_clock (
                    workspace_id TEXT PRIMARY KEY, generation INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS agent_memories (
                    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, study_id TEXT,
                    workspace_revision INTEGER, study_revision INTEGER,
                    kind TEXT NOT NULL, topic TEXT NOT NULL, content TEXT NOT NULL,
                    sources TEXT NOT NULL, methods TEXT NOT NULL, revision INTEGER NOT NULL,
                    status TEXT NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS agent_memories_scope ON agent_memories(workspace_id,status,study_id);
                CREATE TABLE IF NOT EXISTS agent_memory_jobs (
                    id TEXT PRIMARY KEY, task_id TEXT NOT NULL, turn_id TEXT NOT NULL UNIQUE,
                    workspace_id TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL,
                    code TEXT, usage TEXT NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL);
            ''')
            interrupted = db.execute("SELECT id,task_id FROM agent_memory_jobs WHERE status='running'").fetchall()
            db.execute("UPDATE agent_memory_jobs SET status='failed',code='MEMORY_INTERRUPTED',payload='{}',updated=? WHERE status='running'", (stamp(),))
            for job in interrupted:
                self.tasks.event(db,job['task_id'],'memory.failed',{'id':job['id'],'code':'MEMORY_INTERRUPTED','replayed':False})

    def settings(self):
        with self.tasks.db() as db:
            row = db.execute('SELECT value FROM agent_memory_settings WHERE id=1').fetchone()
        return MemorySettings.model_validate_json(row[0]) if row else MemorySettings()

    def status(self):
        return {**self.settings().model_dump(), 'engine': 'langmem', 'version': VERSION,
                'available': self.available, 'code': None if self.available else self.runtime_error,
                'retrieval': 'sqlite_lexical_and_scope', 'engineering_evidence': False,
                'worker_running':bool(self.worker and self.worker.is_alive()),'worker_error':self.worker_error}

    def configure(self, settings):
        if settings.enabled and not self.available:
            reject(self.runtime_error, '请按 backend/requirements.txt 安装固定版本 LangMem；对话仍可使用。', 503)
        with self.tasks.db(True) as db:
            db.execute('INSERT OR REPLACE INTO agent_memory_settings VALUES(1,?)', (settings.model_dump_json(),))
            if not settings.enabled:
                db.execute("UPDATE agent_memory_jobs SET status='cancelled',code='MEMORY_DISABLED',payload='{}',updated=? WHERE status IN ('pending','running')", (stamp(),))
        if settings.enabled: self.start()
        self.wake.set()
        return self.status()

    def start(self):
        with self.guard:
            if self.worker and self.worker.is_alive(): return
            self.stop.clear()
            if self.available and self.settings().enabled:
                self.worker = Thread(target=self.loop, name='agent-memory', daemon=True)
                self.worker.start()

    def close(self):
        self.stop.set(); self.wake.set()
        if self.worker:
            self.worker.join(timeout=40)
            if self.worker.is_alive(): raise RuntimeError('memory worker did not stop within its request timeout')

    @staticmethod
    def generation(db, wid):
        row = db.execute('SELECT generation FROM agent_memory_clock WHERE workspace_id=?', (wid,)).fetchone()
        return row[0] if row else 0

    @staticmethod
    def advance(db, wid):
        db.execute('INSERT INTO agent_memory_clock VALUES(?,1) ON CONFLICT(workspace_id) DO UPDATE SET generation=generation+1', (wid,))

    def card(self, row, current, study_revision, pins=None):
        item = dict(row)
        item['sources'], item['methods'] = json.loads(item['sources']), json.loads(item['methods'])
        reason = None
        if item['status'] != 'deleted':
            if item['workspace_revision'] is not None and item['workspace_revision'] != current:
                reason = '保存输入修订已变化，请重新核对这条历史记忆。'
            if item['study_revision'] is not None and item['study_revision'] != study_revision:
                reason = '研究配置修订已变化，请重新核对这条历史记忆。'
            for method in item['methods']:
                try:
                    pins = {} if pins is None else pins
                    pid = method['plugin_id']
                    if pid not in pins:
                        pins[pid] = self.harness.research.pin(self.harness.research.registry(pid).get(pid))
                    if pins[pid] != method: reason = '方法发行已变化，历史经验尚未重新核对。'
                except Exception:
                    reason = '无法核对历史方法发行，记忆未作为当前上下文。'
        item.update(status='outdated' if reason else item['status'], reason=reason,
                    engineering_evidence=False, authority=False)
        return item

    def listing(self, wid, sid=None, q='', limit=10, offset=0):
        if offset < 0 or not 1 <= limit <= 100:
            reject('MEMORY_PAGE_INVALID', 'offset须非负，limit须为1至100。', 422)
        with self.tasks.db() as db:
            db.execute('BEGIN')
            workspace = db.execute('SELECT revision FROM workspaces WHERE id=?', (wid,)).fetchone()
            if not workspace: reject('MEMORY_WORKSPACE_NOT_FOUND', '工作对象不存在。', 404)
            if sid and not db.execute('SELECT 1 FROM studies WHERE id=? AND workspace=?', (sid, wid)).fetchone():
                reject('MEMORY_STUDY_SCOPE', '研究不属于指定工程。', 422)
            scope = 'workspace_id=? AND (study_id IS NULL OR study_id IS ?) AND status<>?'
            arguments = (wid, sid, 'deleted')
            # SQL ranks the namespace; only one bounded page is materialized.
            words = sorted(terms(q))[:24]
            score = '+'.join("(instr(lower(topic||' '||content),?)>0)" for _ in words) or '0.0'
            total = db.execute('SELECT COUNT(*) FROM agent_memories WHERE '+scope, arguments).fetchone()[0]
            rows = db.execute('SELECT * FROM agent_memories WHERE '+scope+
                ' ORDER BY ('+score+') DESC,updated DESC,id LIMIT ? OFFSET ?',
                (*arguments, *words, limit, offset)).fetchall()
            revisions = {row['id']: row['revision'] for row in db.execute('SELECT id,revision FROM studies WHERE workspace=?', (wid,))}
        pins = {}
        cards = [self.card(row, workspace['revision'], revisions.get(row['study_id']), pins) for row in rows]
        return {'items': cards, 'total': total}

    def recall(self, record):
        settings = self.settings()
        if not settings.enabled: return {'enabled': False, 'items': [], 'engineering_evidence': False}
        if not self.available:
            return {'enabled': True, 'items': [], 'code': self.runtime_error, 'engineering_evidence': False}
        query = next((row['content'] for row in reversed(record['messages']) if row['role']=='user'), '')
        result = self.listing(record['workspace_id'], record['study_id'], query, limit=100)
        selected = []
        for card in result['items']:
            if card['status'] != 'active': continue
            if (card['workspace_revision'] is not None and card['workspace_revision'] != record['workspace_revision']
                    or card['study_revision'] is not None and card['study_revision'] != record['study_revision']):
                continue
            value = {key: card[key] for key in ('id','revision','kind','topic','content','sources','workspace_revision','study_revision')}
            if not fits([*selected, value], 5*1024): continue
            selected.append(value)
            if len(selected) >= settings.recall_limit: break
        return {'enabled': True, 'items': selected, 'engineering_evidence': False,
                'retrieval': 'sqlite_lexical_and_scope', 'omitted': max(0, result['total']-len(selected))}

    def edit(self, mid, body=None, expected_revision=None):
        with self.tasks.db(True) as db:
            row = db.execute('SELECT * FROM agent_memories WHERE id=?', (mid,)).fetchone()
            if not row or row['status']=='deleted': reject('MEMORY_NOT_FOUND', '记忆不存在或已删除。', 404)
            expected = body.expected_revision if body else expected_revision
            if expected != row['revision']: reject('MEMORY_REVISION_CONFLICT', '记忆已被修改，请重新读取后再操作。')
            if body:
                db.execute('UPDATE agent_memories SET content=?,revision=revision+1,updated=? WHERE id=?', (redact(body.content), stamp(), mid))
            else:
                db.execute("UPDATE agent_memories SET topic='',content='',sources='[]',methods='[]',status='deleted',revision=revision+1,updated=? WHERE id=?", (stamp(), mid))
            self.advance(db, row['workspace_id'])
            # Audit contains hashes and identity only; deletion does not keep an
            # extra copy of the forgotten memory in the memory audit.
            for tid in dict.fromkeys(source['task_id'] for source in json.loads(row['sources'])):
                self.tasks.event(db, tid, 'memory.corrected' if body else 'memory.deleted', {
                    'id': mid, 'revision': expected+1, 'previous_digest': fingerprint(row['content'])})
            saved = db.execute('SELECT * FROM agent_memories WHERE id=?', (mid,)).fetchone()
            current = db.execute('SELECT revision FROM workspaces WHERE id=?', (row['workspace_id'],)).fetchone()
            study = db.execute('SELECT revision FROM studies WHERE id=?', (row['study_id'],)).fetchone()
        return self.card(saved, current[0] if current else None, study[0] if study else None)

    def enqueue(self, tid, turn):
        if not self.settings().enabled: return None
        if not self.available: reject(self.runtime_error, 'LangMem运行时不可用，尚未抽取记忆。', 503)
        record = self.tasks.record(tid, model_context=True)
        user = next((event for event in record['events'] if event['type']=='chat.message'
                     and event['data'].get('turn_id')==turn and event['data'].get('role')=='user'), None)
        if not user: reject('MEMORY_TURN_NOT_FOUND', '原始用户消息不存在。', 404)
        following = next((event['sequence'] for event in record['events'] if event['sequence'] > user['sequence']
                          and event['type']=='chat.message' and event['data'].get('role')=='user'), float('inf'))
        # Only original user messages and host state receipts. Never include
        # assistant answers, rejected drafts, reasoning or document contents.
        events = [event for event in record['events'] if user['sequence'] <= event['sequence'] < following and (
            event['type']=='chat.message' and event['data'].get('role')=='user'
            or event['type'] in ('proposal.decision','task.state')
            or event['type']=='tool.result' and event['data'].get('status')=='error')][-8:]
        if user not in events: events = [user, *events[-7:]]
        methods = []
        for step in self.harness.turn_steps(record, turn):
            method = ((step.get('result') or {}).get('execution_ref') or {}).get('method')
            if method and all(key in method for key in ('plugin_id','version','release_digest')):
                pin = {key:method[key] for key in ('plugin_id','version','release_digest')}
                if pin not in methods: methods.append(pin)
        messages = []
        for event in events:
            data = event['data']
            if event['type']=='tool.result':
                data = {key:data.get(key) for key in ('id','status','diagnostics','next_actions')}
            messages.append({'role':'user','content':json.dumps(redact({'source_sequence':event['sequence'],
                'type':event['type'],'data':data}),ensure_ascii=False)})
        payload = {'workspace_id':record['workspace_id'], 'study_id':record['study_id'],
                   'workspace_revision':record['workspace_revision'], 'study_revision':record['study_revision'],
                   'messages':messages, 'sequences':[event['sequence'] for event in events], 'methods':methods[:8]}
        if not fits(payload, 24*1024): reject('MEMORY_SOURCE_TOO_LARGE', '原始消息超过记忆抽取上限，未截断或保存半句。', 422)
        identifier = str(uuid4())
        with self.tasks.db(True) as db:
            existing = db.execute('SELECT id FROM agent_memory_jobs WHERE turn_id=?', (turn,)).fetchone()
            if existing: return existing[0]
            pending = db.execute("SELECT COUNT(*) FROM agent_memory_jobs WHERE status IN ('pending','running')").fetchone()[0]
            if pending >= 32: reject('MEMORY_QUEUE_FULL', '记忆后台队列已满，对话结果保留。', 429)
            db.execute("INSERT INTO agent_memory_jobs VALUES(?,?,?,?, 'pending',?,NULL,'{}',?,?)",
                       (identifier, tid, turn, record['workspace_id'], json.dumps(payload, ensure_ascii=False), stamp(), stamp()))
            self.tasks.event(db, tid, 'memory.queued', {'id':identifier,'turn_id':turn,'engineering_evidence':False})
        self.wake.set()
        return identifier

    def jobs(self, tid):
        with self.tasks.db() as db:
            self.tasks.load(db, tid)
            rows = [dict(row) for row in db.execute('SELECT id,turn_id,status,code,usage,created,updated FROM agent_memory_jobs WHERE task_id=? ORDER BY created', (tid,))]
        return [{**row, 'usage':json.loads(row['usage'])} for row in rows]

    def process_one(self):
        if self.stop.is_set() or not self.settings().enabled: return False
        with self.tasks.db(True) as db:
            job = db.execute("SELECT * FROM agent_memory_jobs WHERE status='pending' ORDER BY created,id LIMIT 1").fetchone()
            if not job: return False
            db.execute("UPDATE agent_memory_jobs SET status='running',updated=? WHERE id=?", (stamp(),job['id']))
            payload = json.loads(job['payload'])
            generation = self.generation(db, job['workspace_id'])
            rows = [dict(row) for row in db.execute("SELECT * FROM agent_memories WHERE workspace_id=? AND study_id IS ? AND status='active' ORDER BY updated DESC LIMIT 16", (job['workspace_id'],payload['study_id']))]
        usage = {}
        try:
            with self.tasks.db() as db:
                current = db.execute('SELECT revision FROM workspaces WHERE id=?', (job['workspace_id'],)).fetchone()
                study = db.execute('SELECT revision FROM studies WHERE id=?', (payload['study_id'],)).fetchone()
            existing = []
            pins = {}
            for row in rows:
                card = self.card(row, current[0] if current else None, study[0] if study else None, pins)
                if card['status'] != 'active': continue
                if (card['workspace_revision'] is not None and card['workspace_revision'] != payload['workspace_revision']
                        or card['study_revision'] is not None and card['study_revision'] != payload['study_revision']):
                    continue
                item = {'id':row['id'], 'fact':{'kind':row['kind'],'topic':row['topic'],'content':row['content'],
                    'source_sequences':[source['sequence'] for source in json.loads(row['sources'])]}, 'row':row}
                if fits([*existing, item], 16*1024): existing.append(item)
            if self.extractor is None:
                from .memory_extract import extract
                extractor = extract
            else: extractor = self.extractor
            results, usage = extractor(self.harness.model, payload['messages'], existing, self.stop)
            self.commit(job, payload, existing, results, usage, generation)
        except Exception as error:
            code = error.detail.get('code') if isinstance(error, HTTPException) and isinstance(error.detail,dict) else getattr(error,'code',type(error).__name__)
            usage = getattr(error, 'memory_usage', usage)
            self.pending_failure = ({'id':job['id'],'task_id':job['task_id']},code,usage)
            self.failed(*self.pending_failure)
            self.pending_failure = None
        return True

    def failed(self,job,code,usage):
        # Retry persistence only, never the model request or a business action.
        def persist():
            with self.tasks.db(True) as db:
                db.execute("UPDATE agent_memory_jobs SET status=CASE WHEN status='cancelled' THEN status ELSE 'failed' END,code=CASE WHEN status='cancelled' THEN code ELSE ? END,payload='{}',usage=?,updated=? WHERE id=?", (code,json.dumps(usage),stamp(),job['id']))
                self.tasks.event(db,job['task_id'],'memory.failed',{'id':job['id'],'code':code,'usage':usage,'details_recorded':False})
        retry(persist)

    def commit(self, job, payload, existing, results, usage, generation):
        known = {row['id']:row for row in existing}
        if len(results) > 24: reject('MEMORY_BATCH_TOO_LARGE', '记忆抽取条目过多，整批未保存。', 422)
        removed = {result.content.json_doc_id for result in results if type(result.content).__name__ == 'RemoveDoc'}
        actions = []
        handled = set()
        for result in results:
            content, identifier = result.content, result.id
            if type(content).__name__ == 'RemoveDoc':
                target = content.json_doc_id
                if target not in known: reject('MEMORY_SOURCE_INVALID','不能移除未读取的记忆。',422)
                actions.append(('delete', target, None)); continue
            fact = MemoryFact.model_validate(content)
            old = known.get(identifier)
            if identifier in removed: continue
            if old and fact.model_dump() == old['fact']: continue  # LangMem also returns unchanged originals.
            if identifier in handled: reject('MEMORY_DUPLICATE','同一记忆有冲突更新，整批未保存。',422)
            handled.add(identifier)
            sources = {source['sequence']:source for source in json.loads(old['row']['sources'])} if old else {}
            sources.update({sequence:{'task_id':job['task_id'],'sequence':sequence} for sequence in payload['sequences']})
            if not set(fact.source_sequences) <= sources.keys():
                reject('MEMORY_SOURCE_INVALID','记忆引用了不存在或未读取的原始来源，整批未保存。',422)
            if old and not set(fact.source_sequences) & set(payload['sequences']):
                reject('MEMORY_SOURCE_INVALID','更新须引用本次读取的原始来源，不能无依据重写旧记忆。',422)
            refs = [sources[sequence] for sequence in dict.fromkeys(fact.source_sequences)]
            actions.append(('upsert', identifier if old else str(uuid4()), (fact,refs)))
        with self.tasks.db(True) as db:
            config = db.execute('SELECT value FROM agent_memory_settings WHERE id=1').fetchone()
            pending = db.execute('SELECT status FROM agent_memory_jobs WHERE id=?', (job['id'],)).fetchone()
            if self.stop.is_set() or not config or not json.loads(config[0])['enabled'] or pending[0]!='running':
                reject('MEMORY_DISABLED','记忆已关闭或任务取消，抽取未保存。')
            if self.generation(db,job['workspace_id']) != generation:
                reject('MEMORY_REVISION_CONFLICT','抽取期间记忆被纠正或删除，未覆盖人工操作。')
            total = db.execute("SELECT COUNT(*) FROM agent_memories WHERE workspace_id=? AND status<>'deleted'", (job['workspace_id'],)).fetchone()[0]
            if total + sum(action=='upsert' and mid not in known for action,mid,_ in actions) > 2000:
                reject('MEMORY_CAPACITY','工程记忆达到2000条，请人工整理后继续。',422)
            now = stamp()
            for action, mid, value in actions:
                if action == 'delete':
                    db.execute("UPDATE agent_memories SET topic='',content='',sources='[]',methods='[]',status='deleted',revision=revision+1,updated=? WHERE id=?", (now,mid))
                else:
                    fact, refs = value
                    # User preferences survive input edits; engineering decisions
                    # and goals remain pinned to the source workspace/study.
                    wrev = None if fact.kind=='preference' else payload['workspace_revision']
                    srev = None if fact.kind=='preference' else payload['study_revision']
                    old = known.get(mid)
                    db.execute("INSERT INTO agent_memories VALUES(?,?,?,?,?,?,?,?,?,?,1,'active',?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,topic=excluded.topic,content=excluded.content,sources=excluded.sources,methods=excluded.methods,workspace_revision=excluded.workspace_revision,study_revision=excluded.study_revision,revision=agent_memories.revision+1,status='active',updated=excluded.updated",
                        (mid,job['workspace_id'],old['row']['study_id'] if old else payload['study_id'],wrev,srev,fact.kind,redact(fact.topic),redact(fact.content),json.dumps(refs),json.dumps(payload['methods'] if fact.kind!='preference' else []),now,now))
            if actions: self.advance(db,job['workspace_id'])
            db.execute("UPDATE agent_memory_jobs SET status='completed',code=NULL,payload='{}',usage=?,updated=? WHERE id=?", (json.dumps(usage),now,job['id']))
            self.tasks.event(db,job['task_id'],'memory.extracted',{'id':job['id'],'changes':len(actions),'usage':usage,'engineering_evidence':False})

    def loop(self):
        while not self.stop.is_set():
            try:
                if self.pending_failure:
                    self.failed(*self.pending_failure)
                    self.pending_failure = None
                    continue
                if self.process_one(): continue
            except Exception as error:
                # A temporary DB failure must not kill the owned worker. The
                # health endpoint reports the category without sensitive text.
                self.worker_error = type(error).__name__
            self.wake.wait(.5); self.wake.clear()
