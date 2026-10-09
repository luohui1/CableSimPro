import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openHeadlessBrowser } from '../../../../scripts/browser.mjs';

export const root = fileURLToPath(new URL('../../../../../', import.meta.url));
export const output = path.join(root, '.data/frontend-type');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  const server = net.createServer(); await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function run(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, windowsHide: true, ...options });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }); if (code !== 0) throw Error(command + '退出' + code);
}
export async function typeFixture({ main = false, build, setup } = {}) {
  const python = process.env.PYTHON || path.join(root, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
  const backendRoot=process.env.E2E_BACKEND_ROOT ? path.resolve(process.env.E2E_BACKEND_ROOT) : root;
  if(backendRoot!==root && (!backendRoot.startsWith(path.resolve(root,'.tmp')+path.sep)
      || !await fs.stat(path.join(backendRoot,'runtime-manifest.json')).then(()=>true,()=>false)))throw Error('冻结后端须为本仓库临时目录内带源码清单的运行时');
  const scratchRoot = path.resolve(root, '.tmp/frontend-e2e'), scratch = path.join(scratchRoot, 'type-' + randomUUID());
  if (!scratch.startsWith(scratchRoot + path.sep)) throw Error('临时目录越界');
  const owned = []; let backendOutput = '', browser;
  async function close() {
    try { await browser?.close(); } finally {
      for (const child of owned.reverse()) { if (child.exitCode === null) { const done = once(child, 'exit'); child.kill(); await Promise.race([done, delay(4000)]); } }
      if (path.resolve(scratch).startsWith(scratchRoot + path.sep)) { await fs.rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 }); console.log('型号验收临时数据库清理：' + !await fs.stat(scratch).then(() => true, () => false)); }
    }
  }
  try {
    await fs.mkdir(scratch, { recursive: true }); await fs.mkdir(path.join(output, 'screenshots'), { recursive: true });
    const database = path.join(scratch, 'workspace.sqlite');
    await run(python, ['-c', "import sqlite3,sys;from pathlib import Path;a=Path(sys.argv[1]).resolve();b=Path(sys.argv[2]).resolve();assert a!=b;s=sqlite3.connect(a.as_uri()+'?mode=ro',uri=True);t=sqlite3.connect(b);s.backup(t);t.close();s.close()", process.env.E2E_DATABASE_SOURCE || path.join(root, '.data/frontend-integration/engineering.sqlite'), database], { stdio: 'inherit' });
    if (setup) await setup(database);
    const backendPort = await freePort(), frontendPort = await freePort();
    const environment = { ...process.env, CABLESIM_DB: database, CABLESIM_DATASETS_DIR: path.join(scratch, 'datasets'), TEMP: scratch, TMP: scratch, BACKEND_URL: 'http://127.0.0.1:' + backendPort };
    const backend = spawn(python, ['-m', 'uvicorn', 'backend.main:app', '--host', '127.0.0.1', '--port', String(backendPort)], { cwd: backendRoot, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); backend.on('error', error => { backendOutput += String(error); }); owned.push(backend);
    for (const stream of [backend.stdout, backend.stderr]) stream.on('data', data => { backendOutput = (backendOutput + data.toString()).slice(-12000); });
    async function ready(url, child) { for (let i = 0; i < 120; i++) { if (child.exitCode !== null || child.pid === undefined) throw Error(backendOutput.slice(-3000)); try { if ((await fetch(url, { signal: AbortSignal.timeout(1500) })).ok) return; } catch {} await delay(250); } throw Error('服务启动超时：' + url + '\n' + backendOutput.slice(-3000)); }
    await ready(environment.BACKEND_URL + '/api/health', backend);
    const preview = spawn(process.execPath, [path.join(root, 'frontend/node_modules/vite/bin/vite.js'), 'preview', '--config', main ? 'vite.config.ts' : 'src/features/type/preview.config.ts', ...(main ? ['--outDir', build || path.join(output, 'main-build')] : []), '--host', '127.0.0.1', '--port', String(frontendPort), '--strictPort'], { cwd: path.join(root, 'frontend'), env: environment, windowsHide: true, stdio: 'ignore' }); preview.on('error', error => { backendOutput += String(error); }); owned.push(preview);
    const url = 'http://127.0.0.1:' + frontendPort; await ready(url, preview);
    process.env.FRONTEND_URL = url; process.env.E2E_ISOLATED = '1'; browser = await openHeadlessBrowser();
    const errors = []; browser.page.on('pageerror', error => errors.push(error.message));
    browser.page.on('console', message => { if (message.type() === 'error' && !message.text().includes('Failed to load resource')) errors.push(message.text()); });
    const writes = []; browser.page.on('request', request => { if (new URL(request.url()).origin !== url && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) throw Error('跨环境写入被拒绝'); if (request.url().includes('/api/') && !['GET', 'HEAD'].includes(request.method())) writes.push({ method: request.method(), url: request.url() }); });
    return { ...browser, url, database, errors, writes, close, log: () => backendOutput,
      api: async (endpoint, method = 'GET', body, headers = {}) => { const response = await fetch(url + endpoint, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }); const value = await response.json(); if (!response.ok) throw Error(endpoint + ':' + response.status + ' ' + JSON.stringify(value)); return value; } };
  } catch (error) { await close(); throw error; }
}
