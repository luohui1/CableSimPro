// The Agent sidecar of the fused product. It runs the model loop (pi) and keeps the conversations; the old platform runs every tool and
// holds the model key. It speaks the same small protocol as Cable Studio's host (status, conversations, messages, events), so the
// conversation page is the same page, and it listens on the loopback only: the browser reaches it through the platform, never directly.
import { EventEmitter } from 'node:events';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StudioEvent } from '../shared/types.ts';
import type { ModelConfig } from '../host/agent.ts';
import { StudioError } from '../host/core.ts';
import { FusionAgent } from './agent.ts';
import { Backend } from './backend.ts';
import { TOKEN_VARIABLE } from './model.ts';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface Sidecar { agent: FusionAgent; server: Server; close(): Promise<void> }

async function body(request: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > 1_000_000) throw new StudioError({ code: 'REQUEST_TOO_LARGE', message: '内容太大。' }, 413);
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
  } catch {
    throw new StudioError({ code: 'REQUEST_INVALID', message: '请求不是有效的 JSON。' }, 400);
  }
}

function send(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

export function createSidecar(options: { backendUrl: string; token: string; home: string; port: number; runtime?: ModelConfig }): Sidecar {
  const events = new EventEmitter();
  const backend = new Backend(options.backendUrl, options.token);
  const agent = new FusionAgent({ home: options.home, backend, emit: event => events.emit('event', event), runtime: options.runtime });
  const hosts = new Set([`127.0.0.1:${options.port}`, `localhost:${options.port}`, `[::1]:${options.port}`]);

  async function api(request: IncomingMessage, response: ServerResponse, path: string[]): Promise<void> {
    const method = request.method ?? 'GET';
    // A page from another site must not reach this through a name that points at the loopback, nor drive it.
    if (!hosts.has(String(request.headers.host))) throw new StudioError({ code: 'HOST_REFUSED', message: '只接受本机地址。' }, 403);
    if (method === 'POST') {
      const origin = request.headers.origin;
      if (origin && new URL(origin).host !== request.headers.host) throw new StudioError({ code: 'ORIGIN_REFUSED', message: '拒绝来自其他站点的请求。' }, 403);
    }
    const [head, id, section, item] = path;
    if (method === 'GET' && head === 'status') return send(response, 200, { agent: await agent.status(), home: '' });
    if (method === 'GET' && head === 'events') {
      response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' });
      response.write(': connected\n\n');
      const forward = (event: StudioEvent) => response.write(`data: ${JSON.stringify(event)}\n\n`);
      const beat = setInterval(() => response.write(': beat\n\n'), 25_000);
      events.on('event', forward);
      request.on('close', () => { clearInterval(beat); events.off('event', forward); });
      return;
    }
    if (head === 'chat') {
      if (method === 'GET' && id === 'sessions' && !section) return send(response, 200, await agent.list());
      if (method === 'GET' && id === 'sessions' && section) return send(response, 200, await agent.view(section));
      if (method === 'POST' && id === 'messages') {
        const message = await body(request);
        if (typeof message.text !== 'string' || !message.text.trim()) throw new StudioError({ code: 'INPUT_INVALID', message: '请写下要交办的事。', path: '/text' });
        if (message.session !== undefined && typeof message.session !== 'string') throw new StudioError({ code: 'INPUT_INVALID', message: '对话标识不对。', path: '/session' });
        return send(response, 200, await agent.send(message.session, message.text));
      }
      if (method === 'POST' && id === 'sessions' && section && item === 'stop') { await agent.stop(section); return send(response, 200, { stopped: true }); }
    }
    throw new StudioError({ code: 'NOT_FOUND', message: '没有这个接口。' }, 404);
  }

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://local');
    if (!url.pathname.startsWith('/api/')) return send(response, 404, { error: { code: 'NOT_FOUND', message: '这里只有接口；页面由老平台提供。' } });
    api(request, response, url.pathname.slice(5).split('/').filter(Boolean)).catch(error => {
      if (response.headersSent) return response.end();
      if (error instanceof StudioError) return send(response, error.status, { error: error.issue() });
      console.error(error instanceof Error ? error.message : error);
      send(response, 500, { error: { code: 'INTERNAL', message: '边车出了意外：' + (error instanceof Error ? error.message : String(error)) } });
    });
  });

  return {
    agent, server,
    close: async () => {
      server.closeAllConnections();
      const stopped = new Promise<void>(done => server.close(() => done()));
      await agent.close();
      await stopped;
    },
  };
}

if (import.meta.main) {
  const token = process.env[TOKEN_VARIABLE]?.trim();
  if (!token) {
    console.error(`没有设置 ${TOKEN_VARIABLE}：边车只在拿到老平台的令牌时启动。`);
    process.exit(1);
  }
  const port = Number(process.env.FUSION_PORT ?? 8111);
  const home = process.env.FUSION_HOME ?? join(REPO, '.data', 'agent-fusion');
  const backendUrl = process.env.FUSION_BACKEND_URL ?? 'http://127.0.0.1:8100';
  const sidecar = createSidecar({ backendUrl, token, home, port });
  sidecar.server.listen(port, '127.0.0.1', async () => {
    const status = await sidecar.agent.status();
    console.log(`Agent 边车  http://127.0.0.1:${port}/  老平台 ${backendUrl}`);
    console.log(`对话目录    ${home}`);
    console.log(`Agent 模型  ${status.configured ? `${status.provider} · ${status.model}` : `未配置（${status.hint}）`}`);
  });
  const shutdown = () => { sidecar.close().then(() => process.exit(0)); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
