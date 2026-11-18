// Exercise the production pi HTTP adapter, not the scripted model. A local
// provider refuses unsupported GLM fields, so the first request must be valid.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { Backend } from '../fusion/backend.ts';
import { resolveModel, modelBudget, TOKEN_VARIABLE } from '../fusion/model.ts';
import { FusionAgent } from '../fusion/agent.ts';
import { pi } from '../fusion/pi.ts';

for (const model of ['glm-4.7', 'glm-5.3-flash']) {
  test(`the first ${model} request retains its native wire protocol through the credential proxy`, { timeout: 20_000 }, async () => {
    const requests: { path: string; authorization?: string; body: any }[] = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', chunk => chunks.push(chunk as Buffer));
      request.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        requests.push({ path: request.url ?? '', authorization: request.headers.authorization, body });
        // These are the protocol differences in pi's pinned Z.AI catalogue.
        // Do not allow a retry to make an invalid initial request look healthy.
        if (!body.max_tokens || 'max_completion_tokens' in body || 'store' in body || !body.thinking
          || body.messages.some((item: any) => item.role === 'developer') || body.tool_stream !== true) {
          response.writeHead(502, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ error: { message: 'unsupported model protocol' } }));
          return;
        }
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.end('data: {"choices":[{"index":0,"delta":{"content":"已读取。"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
      });
    });
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    const token = 'test-proxy-protocol-token';
    const previousToken = process.env[TOKEN_VARIABLE];
    const previousThinking = process.env.CABLE_STUDIO_MODEL_THINKING;
    process.env[TOKEN_VARIABLE] = token;
    process.env.CABLE_STUDIO_MODEL_THINKING = 'off';
    try {
      const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      const backend = new Backend(url, token);
      backend.model = async () => ({ configured: true, source: 'settings', model, provider: 'private-gateway.example' });
      const config = await resolveModel(backend);
      assert.ok(config);
      // GLM-5.3 cannot turn thinking off; use its lowest supported setting.
      assert.equal(config.thinking, model === 'glm-5.3-flash' ? 'low' : 'off');
      assert.equal(config.model.baseUrl, url + '/internal/llm/v1');
      assert.equal(config.model.provider, 'cablesim-backend');
      assert.equal(config.model.contextWindow, 64000);
      assert.equal(config.model.maxTokens, 16384);
      for (let conversation = 0; conversation < 2; conversation++) {
        const result: AssistantMessage = await config.models.completeSimple(config.model, {
          systemPrompt: '所有业务写入必须人工接受。',
          messages: [{ role: 'user', content: '读取研究结论。', timestamp: Date.now() }],
          tools: [{ name: 'study_read', description: '读取已保存研究', parameters: { type: 'object', properties: {}, additionalProperties: false } }],
        }, { reasoning: config.thinking === 'off' ? undefined : config.thinking, maxTokens: 512, maxRetries: 0 });
        assert.equal(result.stopReason, 'stop', result.errorMessage);
        assert.equal(requests.length, conversation + 1, 'each fresh conversation succeeds on its first HTTP request');
      }
      for (const request of requests) {
        assert.equal(request.path, '/internal/llm/v1/chat/completions');
        assert.equal(request.authorization, 'Bearer ' + token, 'the sidecar uses only its own token');
        assert.equal(request.body.model, model);
        assert.equal(request.body.messages[0].role, 'system');
        assert.equal(request.body.max_tokens, 512);
        assert.deepEqual(request.body.thinking, model === 'glm-5.3-flash'
          ? { type: 'enabled', clear_thinking: false } : { type: 'disabled' });
        assert.equal(request.body.reasoning_effort, model === 'glm-5.3-flash' ? 'low' : undefined);
      }
    } finally {
      if (previousToken === undefined) delete process.env[TOKEN_VARIABLE]; else process.env[TOKEN_VARIABLE] = previousToken;
      if (previousThinking === undefined) delete process.env.CABLE_STUDIO_MODEL_THINKING; else process.env.CABLE_STUDIO_MODEL_THINKING = previousThinking;
      server.closeAllConnections();
      await new Promise<void>(done => server.close(() => done()));
    }
  });
}

test('model budgets use saved settings, unknown budgets default conservatively and invalid known limits are not inflated', () => {
  assert.deepEqual(modelBudget({}), { contextWindow: 64000, maxTokens: 16384 });
  assert.deepEqual(modelBudget({ context_window: 32768, max_output_tokens: 4096 }), { contextWindow: 32768, maxTokens: 4096 });
  assert.deepEqual(modelBudget({ context_window: 16384 }), { contextWindow: 16384, maxTokens: 8192 });
  for (const settings of [{ context_window: 8000 }, { context_window: 65536.5 }, { max_output_tokens: 64000 }, { max_output_tokens: -1 }])
    assert.throws(() => modelBudget(settings), /模型.*设置无效/);
});

test('changing saved model limits refreshes the next message of the same idle conversation', { timeout: 20_000 }, async () => {
  const requests: any[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', chunk => chunks.push(chunk as Buffer));
    request.on('end', () => {
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end('data: {"choices":[{"index":0,"delta":{"content":"已按当前模型设置答复。"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    });
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const home = mkdtempSync(join(tmpdir(), 'fusion-model-settings-'));
  const prior = process.env[TOKEN_VARIABLE];
  process.env[TOKEN_VARIABLE] = 'same-conversation-test-token';
  const backend = new Backend(`http://127.0.0.1:${(server.address() as { port: number }).port}`, 'same-conversation-test-token');
  let settings = { context_window: 64000, max_output_tokens: 16384 };
  backend.model = async () => ({ configured: true, source: 'settings', model: 'glm-4.7', provider: 'local-test', ...settings });
  backend.tools = async () => [];
  const agent = new FusionAgent({ home, backend, emit: () => undefined });
  try {
    const first = await agent.send(undefined, '解释第一条保存记录。');
    await agent.idle(first.session);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].max_tokens, 16384);
    settings = { context_window: 32768, max_output_tokens: 4096 };
    const second = await agent.send(first.session, '继续解释第二条保存记录。');
    assert.equal(second.session, first.session);
    await agent.idle(first.session);
    assert.equal(requests.length, 2);
    assert.equal(requests[1].max_tokens, 4096, 'the existing conversation must not reuse its old model output limit');
    const { SessionManager } = await pi();
    const sessions = await SessionManager.list(join(home, 'agent/workspace'), join(home, 'agent/sessions'));
    assert.equal(sessions.length, 1);
    const manager = SessionManager.open(sessions[0].path, join(home, 'agent/sessions'), join(home, 'agent/workspace'));
    const users = manager.getBranch().filter(entry => entry.type === 'message' && entry.message.role === 'user');
    assert.equal(users.length, 2, 'refresh keeps the same persisted conversation and does not replay the earlier prompt');
    assert.equal((await agent.view(first.session)).running, false);
  } finally {
    await agent.close();
    if (prior === undefined) delete process.env[TOKEN_VARIABLE]; else process.env[TOKEN_VARIABLE] = prior;
    server.closeAllConnections();
    await new Promise<void>(done => server.close(() => done()));
    rmSync(home, { recursive: true, force: true });
  }
});
