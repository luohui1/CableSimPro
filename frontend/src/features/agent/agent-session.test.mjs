import test from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient } from '@tanstack/react-query';
import { agentSession, sendMessage } from './agent-api.ts';
import { AgentTurnOwner, savedTurnMatches, submittedQuestionMatches } from './session-operation.ts';

const encoder = new TextEncoder();
function response(chunks, { close = true, cancelled = () => {} } = {}) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
      if (close) controller.close();
    },
    cancel: cancelled,
  }), { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
}
function transport(t, reply) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (...args) => { calls.push(args); return typeof reply === 'function' ? reply(...args) : reply; });
  return calls;
}

test('SSE 使用真实 ReadableStream 解码任意分块的 CRLF、UTF-8 和多行 JSON，只发送一次请求', async t => {
  const bytes = encoder.encode(': heartbeat\r\nevent: message.delta\r\ndata: {"text":\r\ndata: "已读取工程"}\r\n\r\nevent: done\r\ndata: {}\r\n\r\n');
  const calls = transport(t, response(Array.from(bytes, byte => Uint8Array.of(byte))));
  const events = [], order = [];
  const recipe = { id: 'missing_inputs', parameters: {} };
  await sendMessage('s/1', '检查缺项', event => { events.push(event); order.push(event.type); }, undefined, recipe, () => order.push('accepted'));
  assert.deepEqual(events, [{ text: '已读取工程', type: 'message.delta' }, { type: 'done' }]);
  assert.deepEqual(order, ['accepted', 'message.delta', 'done']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/api/agent/sessions/s%2F1/messages');
  assert.equal(calls[0][1].method, 'POST');
  assert.deepEqual(JSON.parse(calls[0][1].body), { content: '检查缺项', recipe });
});

test('SSE 支持 LF 和 CR 分行；done 后立即释放本地连接而不发送服务端取消', async t => {
  for (const newline of ['\n', '\r']) {
    let cancelled = false;
    // CR at the final byte needs EOF or the next byte to distinguish CRLF.
    // Add a comment prefix as a following chunk, as a live connection would.
    const chunks = [`event: done${newline}data: {}${newline}${newline}`, ...(newline === '\r' ? [':'] : [])];
    const calls = transport(t, response(chunks, { close: false, cancelled: () => { cancelled = true; } }));
    const events = [];
    await sendMessage('s', '继续', event => events.push(event));
    assert.equal(calls.length, 1);
    assert.deepEqual(events, [{ type: 'done' }]);
    assert.equal(cancelled, true);
    t.mock.restoreAll();
  }
});

test('缺少 done 的 EOF 明确拒绝，已经收到的正文和方案完整交给调用方', async t => {
  const calls = transport(t, response([
    'event: message.delta\ndata: {"text":"已有证据"}\n\n',
    'event: proposal.created\ndata: {"id":"p","title":"待审核","changes":[]}\n\n',
  ]));
  const events = [];
  let accepted = 0;
  await assert.rejects(sendMessage('s', '检查', event => events.push(event), undefined, undefined, () => accepted++), /完成回执前结束/);
  assert.equal(accepted, 1);
  assert.deepEqual(events.map(event => event.type), ['message.delta', 'proposal.created']);
  assert.equal(events[0].text, '已有证据');
  assert.equal(events[1].id, 'p');
  assert.equal(calls.length, 1, '断流不能自动重发工程操作');
});

test('数据中的 type 不得伪造 done；不完整的最后一块也不能宣布完成', async t => {
  for (const stream of [
    'event: message.delta\ndata: {"type":"done","text":"仅正文"}\n\n',
    'event: done\ndata: {}\n',
  ]) {
    transport(t, response([stream]));
    const events = [];
    await assert.rejects(sendMessage('s', '检查', event => events.push(event)), /完成回执前结束/);
    assert.equal(events.some(event => event.type === 'done'), false);
    t.mock.restoreAll();
  }
});

test('HTTP 409 保留真实拒绝信息，不触发输入接受回调或事件', async t => {
  const calls = transport(t, new Response(JSON.stringify({ detail: { message: '上一轮仍在执行' } }), { status: 409 }));
  let accepted = false, emitted = false;
  await assert.rejects(sendMessage('s', '继续', () => { emitted = true; }, undefined, undefined, () => { accepted = true; }), /上一轮仍在执行/);
  assert.equal(accepted, false);
  assert.equal(emitted, false);
  assert.equal(calls.length, 1);
});

test('HTTP 2xx 非事件流明确提示已接收但待核对，不能按成功完成处理', async t => {
  transport(t, new Response('{}', { headers: { 'Content-Type': 'application/json' } }));
  let accepted = false;
  await assert.rejects(sendMessage('s', '继续', () => assert.fail('没有有效流事件'), undefined, undefined, () => { accepted = true; }), /已接收.*没有返回事件流/);
  assert.equal(accepted, true);
});

test('收到 HTTP 2xx 的同时停止接收仍保留接受事实，不伪造请求撤回', async t => {
  const controller = new AbortController();
  const calls = transport(t, () => {
    controller.abort();
    return response(['event: done\ndata: {}\n\n']);
  });
  let accepted = false;
  await assert.rejects(sendMessage('s', '继续', () => assert.fail('停止后不读事件'), controller.signal, undefined, () => { accepted = true; }), { name: 'AbortError' });
  assert.equal(accepted, true);
  assert.equal(calls[0][1].signal, controller.signal);
  assert.equal(calls.length, 1);
});

test('正文中停止只释放当前 reader，已收内容保留且无 cancel 或重发请求', async t => {
  let cancelled = false;
  const calls = transport(t, response(['event: message.delta\ndata: {"text":"已收内容"}\n\n'], { close: false, cancelled: () => { cancelled = true; } }));
  const controller = new AbortController(), events = [];
  await assert.rejects(sendMessage('s', '继续', event => { events.push(event); controller.abort(); }, controller.signal), { name: 'AbortError' });
  assert.equal(cancelled, true);
  assert.deepEqual(events, [{ text: '已收内容', type: 'message.delta' }]);
  assert.equal(calls.length, 1);
  assert.match(calls[0][0], /\/messages$/);
});

const at = '2026-10-09T10:44:00+00:00';
const event = (sequence, content = '继续') => ({ sequence, type: 'chat.message', created: at, data: { role: 'user', content } });
const record = (state = 'completed', events = [event(11)], id = 's') => ({
  id, workspace_id: 'w', study_id: null, state, waiting_reason: null, created: at, updated: at, proposals: [], steps: [], events,
});
const begin = (owner, boundary = 10, liveId = 'live-1') => owner.begin({ sessionId: 's', question: '继续', boundary, liveId });

test('收尾仅承认已接受、同会话、边界之后同一问题的真实终态', () => {
  const owner = new AgentTurnOwner(), operation = begin(owner);
  assert.equal(savedTurnMatches(operation, record()), false, '未被接收不能认作这一轮的成功回执');
  operation.accepted = true;
  for (const state of ['created', 'planning', 'running']) assert.equal(owner.finish(operation, record(state)), false);
  assert.equal(owner.finish(operation, record('completed', [event(10)])), false, '同文旧轮不是当前回执');
  assert.equal(owner.finish(operation, record('completed', [event(11, '另一问题')])), false);
  assert.equal(owner.finish(operation, record('completed', [event(11)], 'another-session')), false);
  assert.equal(owner.owns(operation), true);
  for (const state of ['waiting', 'reviewing', 'completed', 'blocked', 'failed', 'cancelled']) assert.equal(savedTurnMatches(operation, record(state)), true);
  assert.equal(owner.finish(operation, record()), true);
  assert.equal(owner.current, null);
});

test('读回仍 running、HTTP 失败后重读终态，轮次所有权持续保留到真实记录可替换 live', async t => {
  const replies = [
    new Response(JSON.stringify(record('running'))),
    new Response(JSON.stringify({ detail: 'record unavailable' }), { status: 503 }),
    new Response(JSON.stringify(record('waiting'))),
  ];
  const calls = transport(t, () => replies.shift());
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const read = () => queries.fetchQuery({ queryKey: ['agent-session', 's'], queryFn: ({ signal }) => agentSession('s', signal), staleTime: 0 });
  const owner = new AgentTurnOwner(), operation = begin(owner);
  operation.accepted = true;
  try {
    assert.equal(owner.finish(operation, await read()), false);
    await assert.rejects(read(), /record unavailable/);
    assert.equal(owner.owns(operation), true, '读失败不抹掉待核对轮次');
    assert.equal(owner.finish(operation, await read()), true);
    assert.equal(owner.current, null);
    assert.equal(calls.length, 3);
    assert.equal(calls.every(([url, options]) => url === '/api/agent/sessions/s' && !options.method), true, '恢复只读取记录，不再发消息');
  } finally { queries.clear(); }
});

test('同会话重复同一问题也有独立所有权：旧收尾/计时器不得清掉新轮', () => {
  const owner = new AgentTurnOwner(), first = begin(owner);
  first.accepted = true;
  assert.equal(owner.finish(first, record()), true);
  const second = begin(owner, 11, 'live-2');
  second.accepted = true;
  assert.notEqual(second.generation, first.generation);
  assert.equal(owner.finish(first, record('completed', [event(12)])), false, '晚到旧 fetch 不能完成新轮');
  assert.equal(owner.finish(second, record()), false, '边界前同文不能替代新轮');
  assert.equal(owner.current, second);
  assert.equal(owner.finish(second, record('completed', [event(12)])), true);
});

test('响应头前断网的未确认请求只能由边界之后的真实记录确认，不伪称已接收或已取消', () => {
  const owner = new AgentTurnOwner(), operation = begin(owner);
  operation.uncertain = true;
  assert.equal(operation.accepted, false, 'HTTP 接受事实不被浏览器取消推断替代');
  assert.equal(submittedQuestionMatches(operation, record('completed', [event(10)])), false);
  assert.equal(owner.finish(operation, record('completed', [event(10)])), false);
  assert.equal(submittedQuestionMatches(operation, record('running')), true);
  assert.equal(owner.finish(operation, record('running')), false, '服务端还在执行时不能结束等待');
  assert.equal(owner.finish(operation, record('completed')), true);
  assert.equal(operation.accepted, false);
  assert.equal(owner.current, null);
});

test('外部切换或卸载重置所有权，迟到 create/stream/settle 不能接管新会话', () => {
  const owner = new AgentTurnOwner(), old = begin(owner);
  old.accepted = true;
  owner.reset();
  assert.equal(owner.owns(old), false);
  assert.equal(owner.finish(old, record()), false);
  const current = owner.begin({ sessionId: 'other', question: '继续', boundary: 0, liveId: 'live-new' });
  assert.equal(owner.owns(old), false);
  assert.equal(owner.current, current);
  assert.equal(owner.finish(old, record()), false);
});
