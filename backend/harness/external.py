"""Scoped, audited tool bridge and a credential-free model transport for pi.

The kernel owns the model loop, the conversation file and the page. Every tool it calls is still one of this registry's tools, run by
the same ToolBroker inside a persisted session and turn, so argument validation, session scope, budgets, redaction and the audit
trail (agent_steps, agent_events) are those of the in-process loop. Business writes only create proposals; the existing human
decision route executes their fixed action. The model key never leaves this process: the kernel sends requests to /internal/llm/v1 and this process
adds the key, so neither the browser nor the kernel ever holds it.

Everything is off until CABLESIM_AGENT_SIDECAR_TOKEN is set; the token is what the kernel presents on every call it makes here.
"""
from copy import deepcopy
from dataclasses import dataclass
import hmac
import json
import os
import re
from pathlib import Path
from threading import Lock
from time import perf_counter
from urllib.parse import urlsplit
from uuid import UUID, uuid4

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from pydantic import Field, JsonValue
from starlette.staticfiles import StaticFiles

from backend.schemas import StrictModel

from .contracts import CreateSession
from .recipe_compiler import compile_calls
from .security import redact, remember_secret
from .tool_broker import ToolBroker, failure
from .external_actions import SCOPES as ACTION_SCOPES, tools as action_tools
from .external_stream import safe_sse, MAX_RESPONSE
from backend.kernel.workspace import stamp

# The tools offered, and where the scope of each comes from: nothing (global), a project (workspace) or a cable-type design (type).
READ_TOOLS = {
    'object_find': 'global', 'object_relations': 'global', 'workspace_list': 'global', 'cable_model_read': 'global', 'inbox_read': 'global',
    'workspace_read': 'workspace', 'study_list': 'workspace', 'project_digest': 'workspace', 'study_read': 'workspace',
    'run_list': 'workspace', 'run_read': 'workspace', 'type_read': 'type',
    'plugin_inspect': 'workspace', 'plugin_query': 'workspace',
}
PROPOSAL_TOOLS = {'propose_domain_changes': 'workspace', 'propose_method_parameters': 'workspace', 'propose_type_changes': 'type'}
TOOL_SCOPES = {**READ_TOOLS, **PROPOSAL_TOOLS, **ACTION_SCOPES}
# What a call outside any session reads has no session to hold: the cards and type structures it returns carry their own identity.
STATELESS_TASK = {'id': 'external-stateless', 'workspace_id': None, 'workspace_revision': None, 'study_id': None, 'study_revision': None,
                  'context': {'kind': 'project'}}
MAX_MODEL_REQUEST = 8 * 1024 * 1024
MAX_FORWARD_BODY = 2 * 1024 * 1024
DISABLED = 'Agent 的对话服务没有启用：需要设置边车令牌并启动它，方法见 studio/README.md 的“并入老版本的 Agent”一节。'
UNREACHABLE = 'Agent 的对话服务没有运行，暂时不能使用。方法见 studio/README.md 的“并入老版本的 Agent”一节。'


@dataclass(frozen=True)
class Link:
    token: str
    sidecar: str
    ui: Path

    @classmethod
    def from_environment(cls, root):
        return cls(os.environ.get('CABLESIM_AGENT_SIDECAR_TOKEN', '').strip(),
                   os.environ.get('CABLESIM_AGENT_SIDECAR_URL', 'http://127.0.0.1:8111').strip().rstrip('/'),
                   Path(os.environ.get('CABLESIM_AGENT_UI', str(root / 'studio/dist-fusion'))))


class OpenSession(StrictModel):
    workspace_id: UUID
    study_id: UUID | None = None
    message: str = Field(min_length=1, max_length=8000)


class ResumeSession(StrictModel):
    message: str = Field(min_length=1, max_length=8000)


class ExternalCall(StrictModel):
    session: UUID | None = None
    turn: str | None = Field(default=None, max_length=64)
    tool: str = Field(pattern=r'^[a-zA-Z0-9_-]{1,64}$')
    arguments: dict[str, JsonValue] = Field(default_factory=dict)
    discovery: UUID | None = None


class DiscoveryAudit:
    """Durable global reads before an actual workspace has been selected.

No artificial project is created just to search. Each discovery message has its
own budget and intent/receipt, and still executes through ToolBroker.
"""
    def __init__(self, harness, body):
        self.tasks = harness.tasks
        self.discovery = str(body.discovery or uuid4())
        self.identifier = str(uuid4())
        self.started = perf_counter()
        with harness.research.store.db(True) as db:
            db.execute('''CREATE TABLE IF NOT EXISTS agent_external_reads (
                id TEXT PRIMARY KEY, discovery TEXT NOT NULL, tool TEXT NOT NULL,
                arguments TEXT NOT NULL, state TEXT NOT NULL, result TEXT,
                events TEXT NOT NULL, elapsed_ms REAL, created TEXT NOT NULL)''')
            count = db.execute('SELECT COUNT(*) FROM agent_external_reads WHERE discovery=?', (self.discovery,)).fetchone()[0]
            if count >= harness.tasks.limits.max_tool_calls:
                raise HTTPException(429, {'code': 'BUDGET_EXCEEDED', 'message': '本轮全局查询达到工具预算，请先核对已有结果。'})
            db.execute('INSERT INTO agent_external_reads VALUES (?,?,?,?,?,?,?,?,?)',
                (self.identifier, self.discovery, body.tool, json.dumps(redact(body.arguments), ensure_ascii=False),
                 'running', None, '[]', None, stamp()))

    def emit(self, _tid, kind, data):
        with self.tasks.db(True) as db:
            current = json.loads(db.execute('SELECT events FROM agent_external_reads WHERE id=?', (self.identifier,)).fetchone()[0])
            current.append({'type': kind, 'data': redact(data)})
            db.execute('UPDATE agent_external_reads SET events=? WHERE id=?', (json.dumps(current, ensure_ascii=False), self.identifier))

    def finish(self, value):
        with self.tasks.db(True) as db:
            db.execute('UPDATE agent_external_reads SET state=?,result=?,elapsed_ms=? WHERE id=?',
                ('succeeded' if value['status'] == 'ok' else 'failed', json.dumps(redact(value), ensure_ascii=False),
                 (perf_counter() - self.started) * 1000, self.identifier))


def refusal(code, message, path=None):
    return failure(code, message, path).model_dump(mode='json')


class ExternalTools:
    def __init__(self, harness):
        self.harness = harness
        self.hosts = {tool.name: tool for tool in harness.registry.hosts}
        self.hosts.update(action_tools())
        harness.proposals.external_broker = harness.broker
        self.session_locks = {}

    def catalog(self):
        rows = []
        for name, scope in TOOL_SCOPES.items():
            tool = self.hosts[name]
            definition = tool.model()['function']
            rows.append({'name': name, 'title': tool.title, 'kind': tool.kind, 'scope': scope,
                         'description': definition['description'], 'parameters': definition['parameters']})
        return rows

    def open(self, body):
        """One question, one session on one project: the project's revision is pinned when the question starts, not when the chat did."""
        created = self.harness.create(CreateSession(workspace_id=body.workspace_id, study_id=body.study_id))
        self.harness.tasks.emit(created['id'], 'external.session.opened', {'workspace_id': str(body.workspace_id), 'study_id': str(body.study_id) if body.study_id else None})
        turn = self.harness.tasks.begin_turn(created['id'], redact(body.message))
        return {'session': created['id'], 'turn': turn, 'context': created['context']}

    def finish(self, session, turn):
        self.harness.tasks.finish_turn(session, turn, 'completed', None)
        return {'finished': True}

    def resume(self, session, body):
        with self.harness.tasks.db() as db:
            task = self.harness.tasks.load(db, session)
            suspended = db.execute("SELECT data FROM agent_events WHERE task_id=? AND type='external.turn.suspended' ORDER BY sequence DESC LIMIT 1", (session,)).fetchone()
        if not suspended or task['active_turn']:
            raise HTTPException(409, {'code': 'TURN_NOT_SUSPENDED', 'message': '没有可继续的待审回合。'})
        saved = json.loads(suspended['data'])
        with self.harness.tasks.db() as db:
            _, _, decision = self.harness.tasks.proposal(db, saved['proposal_id'])
            resumed = db.execute("SELECT 1 FROM agent_events WHERE task_id=? AND type='external.turn.resumed' AND json_extract(data,'$.proposal_id')=?", (session, saved['proposal_id'])).fetchone()
        if decision is None or resumed:
            raise HTTPException(409, {'code': 'PROPOSAL_DECISION_REQUIRED', 'message': '方案尚未决定或这一回合已经继续。'})
        turn = self.harness.tasks.begin_turn(session, redact(body.message))
        # An approval is part of the same model task: it cannot replenish the
        # tool/step budget. Only time spent waiting for the human is excluded.
        with self.harness.tasks.db(True) as db:
            budget = saved['budget']
            db.execute('UPDATE agent_tasks SET tool_calls=?,model_requests=?,steps_used=?,elapsed_ms=?,prompt_tokens=?,completion_tokens=? WHERE id=?',
                tuple(budget[key] for key in ('tool_calls', 'model_requests', 'steps_used', 'elapsed_ms', 'prompt_tokens', 'completion_tokens')) + (session,))
            self.harness.tasks.event(db, session, 'external.turn.resumed', {'turn_id': turn, 'proposal_id': saved['proposal_id']})
        return {'session': session, 'turn': turn, 'context': task['context']}

    def proposal(self, pid, session):
        with self.harness.tasks.db() as db:
            task, proposal, decision = self.harness.tasks.proposal(db, pid)
        if task['id'] != session:
            raise HTTPException(403, {'code': 'SCOPE_VIOLATION', 'message': '此方案不属于请求中的会话。'})
        return {'session': session, 'proposal': proposal['public'], 'status': decision['status'] if decision else 'pending',
                'receipt': decision.get('receipt', {key: decision[key] for key in ('workspace_revision','study_id','study_revision','type_id') if key in decision}) if decision else None}

    def call(self, body):
        scope = TOOL_SCOPES.get(body.tool)
        if scope is None:
            raise HTTPException(403, {'code': 'TOOL_NOT_ALLOWED', 'message': '这个工具不在外部 Agent 的白名单中；不能调用批准、发布或任意接口。'})
        if body.session is None:
            if scope != 'global':
                raise HTTPException(422, {'code': 'SESSION_REQUIRED', 'message': body.tool + ' 要在绑定工程的会话里调用；先开会话。'})
            audit = DiscoveryAudit(self.harness, body)
            broker = ToolBroker(self.harness.research, audit, self.harness.registry, self.harness.proposals)
            broker.platform = self.harness.platform
            node = {'id': audit.identifier, 'tool': body.tool, 'arguments': body.arguments, 'input_identity': {}}
            value = broker.execute(STATELESS_TASK, node, self.hosts[body.tool]).model_dump(mode='json')
            audit.finish(value)
            return value
        # Parallel provider tool calls must not create several pending actions
        # before the first one suspends its turn. A second request rechecks the
        # persisted turn after the first has finished and is refused if needed.
        session = str(body.session)
        with self.session_locks.setdefault(session, Lock()):
            return self.in_session(session, body.turn, body.tool, body.arguments)

    def in_session(self, session, turn, name, arguments):
        harness = self.harness
        with harness.tasks.db() as db:
            task = harness.tasks.load(db, session)
        if not turn or task['active_turn'] != turn:
            raise HTTPException(409, {'code': 'TURN_NOT_ACTIVE', 'message': '这个会话的这一回合已经结束或不存在；请重新开会话。'})
        record = harness.tasks.record(session, model_context=True)
        visible = harness.registry.visible(record)
        tools = {name: visible.get(name, tool) for name, tool in self.hosts.items() if name in TOOL_SCOPES}
        tools.update(action_tools())
        if name in ('type_read', 'propose_type_changes'):
            # Cross-type inspection remains possible through its own explicitly
            # bound session; one external call cannot borrow a foreign scope.
            tools[name] = deepcopy(tools[name])
            tools[name].parameters['properties']['type_id']['const'] = task['workspace_id']
        plan = compile_calls([{'id': 'external-' + uuid4().hex[:12], 'name': name, 'arguments': arguments}],
                             tools, record['workspace_id'], record['workspace_revision'])
        node = plan['nodes'][0]['id']
        try:
            # The same loop step the in-process agent runs: identity, intent, execution, receipt and audit events.
            for _ in harness.execute_plan(session, turn, plan, tools, record, source='external'):
                pass
        except HTTPException as error:
            # A spent budget or a repeated diagnostic: said to the model as a result, not as a failure of the host.
            detail = error.detail if isinstance(error.detail, dict) else {'message': str(error.detail)}
            return self.receipt(session, node) or refusal(detail.get('code', 'HOST_REQUEST_REJECTED'),
                                                          redact(detail.get('message') or '请求被拒绝。'), detail.get('path'))
        result = self.receipt(session, node) or refusal('NO_RECEIPT', '没有取得这一步的回执；未生成替代结果。')
        proposal = result.get('data', {}).get('proposal')
        if result['status'] == 'ok' and proposal:
            with harness.tasks.db() as db: current = harness.tasks.load(db, session)
            harness.tasks.emit(session, 'external.turn.suspended', {'turn_id': turn, 'proposal_id': proposal['id'],
                'budget': {key: current[key] for key in ('tool_calls', 'model_requests', 'steps_used', 'elapsed_ms', 'prompt_tokens', 'completion_tokens')}})
            harness.tasks.finish_turn(session, turn, 'reviewing', 'human_review')
        return result

    def receipt(self, session, node):
        with self.harness.tasks.db() as db:
            row = db.execute('SELECT result FROM agent_steps WHERE task_id=? AND node_id=? ORDER BY attempt DESC LIMIT 1',
                             (session, node)).fetchone()
        return json.loads(row['result']) if row and row['result'] else None


def upstream_failure(message, status):
    return JSONResponse({'error': {'message': message, 'type': 'upstream_error'}}, status_code=status)


def make_router(harness, link):
    tools = ExternalTools(harness)
    # Not part of the platform's public API contract (the generated client types are made from it): the kernel's own interface.
    router = APIRouter(tags=['agent-external'], include_in_schema=False)

    def authorized(request: Request):
        if not link.token:
            raise HTTPException(503, {'code': 'AGENT_SIDECAR_DISABLED', 'message': DISABLED})
        header = request.headers.get('authorization', '')
        given = header[7:] if header.lower().startswith('bearer ') else ''
        if not hmac.compare_digest(given.encode(), link.token.encode()):
            raise HTTPException(401, {'code': 'AGENT_SIDECAR_TOKEN_INVALID', 'message': '边车令牌不对。'})

    @router.get('/api/agent/external/tools', dependencies=[Depends(authorized)])
    def catalog():
        return tools.catalog()

    @router.post('/api/agent/external/sessions', dependencies=[Depends(authorized)])
    def open_session(body: OpenSession):
        return tools.open(body)

    @router.post('/api/agent/external/sessions/{session}/resume', dependencies=[Depends(authorized)])
    def resume(session: UUID, body: ResumeSession):
        return tools.resume(str(session), body)

    @router.get('/api/agent/external/proposals/{pid}', dependencies=[Depends(authorized)])
    def proposal(pid: UUID, session: UUID):
        return tools.proposal(str(pid), str(session))

    @router.get('/api/agent/files/{pid}')
    def file(pid: UUID):
        from hashlib import sha256
        from fastapi.responses import Response
        with harness.research.store.db() as db:
            if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='agent_external_files'").fetchone():
                raise HTTPException(404, '没有此已生成文件。')
            row = db.execute('SELECT * FROM agent_external_files WHERE proposal_id=?', (str(pid),)).fetchone()
        if not row: raise HTTPException(404, '没有此已生成文件。')
        with harness.tasks.db() as db:
            task, _, decision = harness.tasks.proposal(db, str(pid))
        if task['workspace_id'] != row['workspace'] or not decision or decision['status'] != 'approved':
            raise HTTPException(403, '文件尚未完成此会话的人工接受。')
        content = bytes(row['content'])
        if sha256(content).hexdigest() != row['sha256']: raise HTTPException(409, '文件完整性校验未通过。')
        return Response(content, media_type=row['media_type'], headers={'Content-Disposition': 'inline; filename="' + row['filename'] + '"',
            'X-Artifact-SHA256': row['sha256'], 'Cache-Control': 'no-store'})

    @router.post('/api/agent/external/sessions/{session}/turns/{turn}/finish', dependencies=[Depends(authorized)])
    def finish(session: UUID, turn: str):
        return tools.finish(str(session), turn)

    @router.post('/api/agent/external/calls', dependencies=[Depends(authorized)])
    def call(body: ExternalCall):
        return tools.call(body)

    @router.get('/internal/agent/model', dependencies=[Depends(authorized)])
    def model():
        """Which model, never with the key."""
        current = harness.settings.resolve()
        configured = bool(current['base_url'] and current['model'] and current['api_key'])
        return {'configured': configured, 'source': current['source'], 'model': current['model'] if configured else None,
                'provider': urlsplit(current['base_url']).hostname if configured else None}

    @router.post('/internal/llm/v1/chat/completions', dependencies=[Depends(authorized)])
    async def completions(request: Request):
        """The kernel's model request, sent on with the key this process holds. The kernel's own token is not passed on."""
        current = harness.settings.resolve()
        if not (current['base_url'] and current['model'] and current['api_key']):
            return upstream_failure('模型未配置；请在“设置 · AI 模型”里填写服务地址、模型名与密钥。', 409)
        raw = await request.body()
        if len(raw) > MAX_MODEL_REQUEST:
            return upstream_failure('请求太大。', 413)
        try:
            payload = json.loads(raw)
            if not isinstance(payload, dict):
                raise ValueError('object required')
        except ValueError:
            return upstream_failure('请求不是 JSON 对象。', 400)
        payload['model'] = current['model']
        base = current['base_url']
        parsed = urlsplit(base)
        if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            return upstream_failure('模型配置不合法；地址须为无凭据、查询串或片段的 HTTP(S) API 基址。', 409)
        tls = getattr(harness.model, 'tls', None)
        remember_secret(current['api_key'])
        remember_secret(link.token)
        client = httpx.AsyncClient(timeout=httpx.Timeout(connect=8.0, read=240.0, write=60.0, pool=8.0), follow_redirects=False,
                                   verify=tls() if tls else True)
        try:
            upstream = await client.send(client.build_request('POST', base.rstrip('/') + '/chat/completions', content=json.dumps(payload).encode(),
                headers={'Authorization': 'Bearer ' + current['api_key'], 'Content-Type': 'application/json',
                         'Accept': request.headers.get('accept', '*/*')}), stream=True)
        except httpx.TimeoutException:
            await client.aclose()
            return upstream_failure('模型服务没有及时响应。', 504)
        except httpx.HTTPError:
            await client.aclose()
            return upstream_failure('连不上模型服务；请检查网络、代理或地址。', 502)
        if upstream.status_code != 200:
            text = (await upstream.aread()).decode('utf-8', 'replace')[:4000]
            await upstream.aclose()
            await client.aclose()
            return upstream_failure(redact(' '.join(text.split()))[:1000] or '模型服务拒绝了请求。', upstream.status_code)

        async def relay():
            try:
                if upstream.headers.get('content-type', '').split(';')[0].strip() == 'text/event-stream':
                    async for chunk in safe_sse(upstream, (current['api_key'], link.token)):
                        yield chunk
                else:
                    content = await upstream.aread()
                    if len(content) > MAX_RESPONSE:
                        yield json.dumps({'error': {'message': '模型响应超过大小限制。', 'type': 'response_too_large'}})
                    else:
                        try: value = json.loads(content)
                        except ValueError: value = {'error': {'message': '模型返回了无效响应。', 'type': 'invalid_response'}}
                        yield json.dumps(redact(value), ensure_ascii=False)
            finally:
                await upstream.aclose()
                await client.aclose()
        return StreamingResponse(relay(), media_type=upstream.headers.get('content-type', 'text/event-stream'),
                                 headers={'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no'})

    @router.api_route('/agent-sidecar/{path:path}', methods=['GET', 'POST'], include_in_schema=False)
    async def sidecar(path: str, request: Request):
        """The page's way to the kernel: the same origin as the page, so the kernel is never exposed to a browser directly."""
        if not link.token:
            return JSONResponse({'error': {'code': 'AGENT_SIDECAR_DISABLED', 'message': DISABLED}}, status_code=503)
        if not re.fullmatch(r'api/(?:status|events|chat/(?:messages|sessions(?:/[A-Za-z0-9_-]+(?:/stop)?)?)|proposals/[A-Za-z0-9_-]+/decision)', path):
            return JSONResponse({'error': {'code': 'SIDECAR_PATH_REJECTED', 'message': '此地址不是对话界面接口。'}}, status_code=404)
        body = await request.body() if request.method != 'GET' else None
        if body is not None and len(body) > MAX_FORWARD_BODY:
            return JSONResponse({'error': {'code': 'REQUEST_TOO_LARGE', 'message': '请求太大。'}}, status_code=413)
        url = link.sidecar + '/' + path + ('?' + request.url.query if request.url.query else '')
        headers = {name: request.headers[name] for name in ('content-type', 'accept') if name in request.headers}
        headers['authorization'] = 'Bearer ' + link.token
        client = httpx.AsyncClient(timeout=httpx.Timeout(connect=3.0, read=None, write=30.0, pool=3.0), follow_redirects=False, trust_env=False)
        try:
            upstream = await client.send(client.build_request(request.method, url, headers=headers, content=body), stream=True)
        except httpx.HTTPError:
            await client.aclose()
            return JSONResponse({'error': {'code': 'SIDECAR_UNREACHABLE', 'message': UNREACHABLE}}, status_code=502)

        async def relay():
            try:
                async for chunk in upstream.aiter_raw():
                    yield chunk
            finally:
                await upstream.aclose()
                await client.aclose()
        response_headers = {'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no'}
        if 'content-disposition' in upstream.headers:
            response_headers['Content-Disposition'] = upstream.headers['content-disposition']
        return StreamingResponse(relay(), status_code=upstream.status_code,
                                 media_type=upstream.headers.get('content-type', 'application/json'), headers=response_headers)

    return router


def install(app, harness, root):
    """Routes and the built page; called once by create_app, before its catch-all."""
    link = Link.from_environment(root)
    app.include_router(make_router(harness, link))
    if link.ui.is_dir():
        app.mount('/agent-app', StaticFiles(directory=link.ui, html=True), name='agent-app')
    else:
        @app.get('/agent-app/{rest:path}', include_in_schema=False)
        def unbuilt(rest: str):
            return HTMLResponse('<p style="font:14px sans-serif;padding:24px">对话界面尚未构建：在 studio 目录运行 npm run build:fusion。</p>', status_code=503)
