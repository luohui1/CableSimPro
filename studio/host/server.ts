// Local host of Cable Studio: serves the workbench, exposes the operation layer over HTTP
// and runs the agent. It listens on 127.0.0.1 only.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StudioEvent } from '../shared/types.ts';
import { AgentService, modelFromEnvironment, type ModelRuntime } from './agent.ts';
import { Core, StudioError } from './core.ts';
import { Library } from './library.ts';
import { Studio } from './operations.ts';
import { saveUpload } from './products.ts';
import { Store } from './store.ts';
import { specificationFile } from './specification.ts';

const STUDIO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(STUDIO, '..');
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon',
};

export interface App { studio: Studio; agent: AgentService; server: Server; close(): Promise<void> }

async function bytes(request: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new StudioError({ code: 'REQUEST_TOO_LARGE', message: `内容超过 ${Math.round(limit / 1_000_000)} MB 的上限。` }, 413);
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function body(request: IncomingMessage): Promise<any> {
  const data = await bytes(request, 2_000_000);
  if (!data.length) return {};
  try {
    return JSON.parse(data.toString('utf-8'));
  } catch {
    throw new StudioError({ code: 'REQUEST_INVALID', message: '请求不是有效的 JSON。' }, 400);
  }
}

function send(response: ServerResponse, status: number, value: unknown): void {
  const text = JSON.stringify(value);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(text);
}

export function createApp(options: { home?: string; runtime?: ModelRuntime | null; dist?: string } = {}): App {
  const core = new Core(REPO);
  const store = new Store(options.home ?? process.env.CABLE_STUDIO_HOME ?? join(REPO, '.data', 'studio'));
  const library = new Library(store.home);
  const studio = new Studio(core, store, library);
  const agent = new AgentService(studio, options.runtime === undefined ? modelFromEnvironment() : options.runtime);
  const dist = options.dist ?? join(STUDIO, 'dist');

  async function api(request: IncomingMessage, response: ServerResponse, path: string[]): Promise<void> {
    const method = request.method ?? 'GET';
    if (method === 'POST') {
      // A page from another origin must not be able to drive the local workbench.
      const origin = request.headers.origin;
      if (origin && new URL(origin).host !== request.headers.host) {
        throw new StudioError({ code: 'ORIGIN_REFUSED', message: '拒绝来自其他站点的请求。' }, 403);
      }
    }
    const [head, id, section, item, action] = path;
    if (method === 'GET' && head === 'status') return send(response, 200, { agent: agent.status(), home: store.home, user: studio.user });
    if (method === 'GET' && head === 'specifications' && id) {
      const snapshot = section === 'snapshot';
      if (section && !snapshot) throw new StudioError({ code: 'NOT_FOUND', message: '没有这个文件。' }, 404);
      const file = specificationFile(store.home, id, snapshot);
      const inline = !snapshot && new URL(request.url ?? '/', 'http://local').searchParams.get('preview') === '1';
      response.writeHead(200, { 'content-type': snapshot ? 'application/json; charset=utf-8' : 'application/pdf', 'cache-control': 'no-store',
        'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${id}.${snapshot ? 'json' : 'pdf'}"` });
      response.end(readFileSync(file));
      return;
    }
    if (method === 'POST' && head === 'uploads') {
      // A structure table or an inquiry file: the bytes as they are, the name in the query.
      const name = new URL(request.url ?? '/', 'http://local').searchParams.get('name') ?? '';
      return send(response, 200, saveUpload(store.home, name, await bytes(request, 25_000_000)));
    }
    if (method === 'GET' && head === 'events') {
      response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' });
      response.write(': connected\n\n');
      const forward = (event: StudioEvent) => response.write(`data: ${JSON.stringify(event)}\n\n`);
      const beat = setInterval(() => response.write(': beat\n\n'), 25_000);
      studio.events.on('event', forward);
      request.on('close', () => { clearInterval(beat); studio.events.off('event', forward); });
      return;
    }
    if (method === 'GET' && head === 'projects' && !id) return send(response, 200, await studio.invoke('project.list', {}, { by: 'human' }));
    if (method === 'GET' && head === 'library') return send(response, 200, await studio.invoke('library.list', {}, { by: 'human' }));
    if (method === 'GET' && head === 'methods') return send(response, 200, await studio.invoke('methods.list', {}, { by: 'human' }));
    if (method === 'POST' && head === 'ops' && id) return send(response, 200, await studio.invoke(id, await body(request), { by: 'human' }));
    if (method === 'POST' && head === 'proposals' && id && section === 'decision') {
      const decision = await body(request);
      return send(response, 200, agent.decide(id, decision.accept === true, typeof decision.note === 'string' ? decision.note : undefined));
    }
    if (head === 'projects' && id) {
      if (method === 'GET' && !section) return send(response, 200, await studio.view(id));
      if (method === 'GET' && section === 'runs' && item) return send(response, 200, store.run(id, item));
      if (method === 'GET' && section === 'reports' && item) {
        const html = store.report(id, item);
        if (html === null) throw new StudioError({ code: 'REPORT_UNKNOWN', message: '这条记录还没有导出计算书。' }, 404);
        const download = new URL(request.url ?? '/', 'http://local').searchParams.has('download');
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
          ...(download ? { 'content-disposition': `attachment; filename="calculation-${item}.html"` } : {}) });
        response.end(html);
        return;
      }
      if (section === 'agent') {
        store.meta(id);
        if (method === 'GET' && !item) return send(response, 200, { status: agent.status(), tasks: agent.tasks(id), proposals: agent.proposals(id) });
        if (method === 'POST' && item === 'instruct') {
          const request_ = await body(request);
          if (typeof request_.instruction !== 'string' || !request_.instruction.trim()) {
            throw new StudioError({ code: 'INPUT_INVALID', message: '请写下要交办的事。', path: '/instruction' });
          }
          return send(response, 200, agent.instruct(id, request_.instruction.trim(), typeof request_.context === 'string' ? request_.context : undefined));
        }
        if (method === 'POST' && item === 'stop') { agent.stop(id); return send(response, 200, { stopped: true }); }
      }
    }
    void action;
    throw new StudioError({ code: 'NOT_FOUND', message: '没有这个接口。' }, 404);
  }

  function asset(response: ServerResponse, pathname: string): void {
    const relative = normalize(decodeURIComponent(pathname)).replace(/^[\\/]+/, '');
    let file = join(dist, relative);
    if (!file.startsWith(dist) || !existsSync(file) || !statSync(file).isFile()) file = join(dist, 'index.html');
    if (!existsSync(file)) {
      response.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('界面尚未构建：在 studio 目录运行 npm run build。');
      return;
    }
    response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': file.endsWith('index.html') ? 'no-store' : 'public, max-age=31536000, immutable' });
    response.end(readFileSync(file));
  }

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://local');
    if (!url.pathname.startsWith('/api/')) return asset(response, url.pathname);
    api(request, response, url.pathname.slice(5).split('/').filter(Boolean)).catch(error => {
      if (response.headersSent) return response.end();
      if (error instanceof StudioError) return send(response, error.status, { error: error.issue() });
      console.error(error);
      send(response, 500, { error: { code: 'INTERNAL', message: error instanceof Error ? error.message : String(error) } });
    });
  });

  return {
    studio, agent, server,
    close: async () => {
      server.closeAllConnections();
      const stopped = new Promise<void>(done => server.close(() => done()));
      await core.stop();
      library.close();
      await stopped;
    },
  };
}

if (import.meta.main) {
  const port = Number(process.env.CABLE_STUDIO_PORT ?? 8200);
  const app = createApp();
  app.server.listen(port, '127.0.0.1', () => {
    const status = app.agent.status();
    console.log(`Cable Studio  http://127.0.0.1:${port}/`);
    console.log(`工程目录      ${app.studio.store.home}`);
    console.log(`Agent 模型    ${status.configured ? `${status.provider} · ${status.model}` : '未配置（其余功能照常可用）'}`);
  });
  const shutdown = () => { app.close().then(() => process.exit(0)); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
