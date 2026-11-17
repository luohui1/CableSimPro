import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
export const outputRoot = path.join(repositoryRoot, '.data', 'frontend-handoff');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const startupTimeout = 60000;
const outputTailLimit = 16384;
const errorDetail = error => ({
  name: error?.name || 'Error', message: error?.message || String(error),
  ...(error?.code ? { code: error.code } : {}), ...(error?.stack ? { stack: error.stack } : {}),
});
async function bounded(work, timeout, label) {
  let timer;
  try {
    return await Promise.race([work, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label + '超时。')), Math.max(1, timeout));
    })]);
  } finally { clearTimeout(timer); }
}
function localWebSocket(value) {
  try {
    const url = new URL(value), port = Number(url.port);
    if (url.protocol !== 'ws:' || !['127.0.0.1', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.search || url.hash
      || !/^\d+$/.test(url.port) || !Number.isInteger(port) || port < 1 || port > 65535
      || !/^\/devtools\/browser\/[A-Za-z0-9_-]+$/.test(url.pathname)) return undefined;
    return url.href;
  } catch { return undefined; }
}

export async function openHeadlessBrowser({ headed = false, executable: requestedExecutable, routeGuard = true } = {}) {
  const executable = requestedExecutable || process.env.BROWSER_EXECUTABLE || [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', chromium.executablePath(),
  ].find(existsSync);
  if (!executable) throw new Error('未找到 Edge / Chrome；可设置 BROWSER_EXECUTABLE。');
  const scratchRoot = path.resolve(repositoryRoot, '.tmp', 'frontend');
  const profile = path.join(scratchRoot, `browser-profile-${randomUUID()}`);
  await fs.mkdir(profile, { recursive: true });
  const started = Date.now(), deadline = started + startupTimeout;
  const output = { stdout: '', stderr: '' }, partial = { stdout: '', stderr: '' };
  let child, browser, context, spawnError, exited, closed, announced, endpoint, endpointSource, lastPortReadError;
  let closing = false;
  let endProcess, finishClose, cleanupPromise;
  const processEnded = new Promise(resolve => { endProcess = resolve; });
  const processClosed = new Promise(resolve => { finishClose = resolve; });
  const processFailure = () => spawnError || new Error('本任务浏览器已退出：PID ' + child?.pid
    + '，code=' + exited?.code + '，signal=' + exited?.signal);
  const assertRunning = () => { if (spawnError || exited) throw processFailure(); };
  const snapshot = () => ({
    executable, pid: child?.pid ?? null, profile, started: new Date(started).toISOString(),
    elapsedMs: Date.now() - started, timeoutMs: startupTimeout, endpoint: endpoint || announced || null, endpointSource,
    spawnError: spawnError ? errorDetail(spawnError) : null, exit: exited || null,
    close: closed || null, lastPortReadError: lastPortReadError || null,
  });
  function readLine(line, stream) {
    const match = /^\s*DevTools listening on (ws:\/\/\S+)\s*$/.exec(line);
    const endpoint = match && localWebSocket(match[1]);
    if (endpoint) { announced = endpoint; endpointSource = stream; }
  }
  function collect(stream, chunk) {
    output[stream] = (output[stream] + chunk).slice(-outputTailLimit);
    const lines = (partial[stream] + chunk).split(/\r?\n/);
    partial[stream] = lines.pop().slice(-outputTailLimit);
    for (const line of lines) readLine(line, stream);
  }
  async function duringStartup(action, label) {
    assertRunning();
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('浏览器 CDP 启动超时（60 秒）。');
    const value = await bounded(Promise.race([
      Promise.resolve().then(action),
      processEnded.then(() => { throw processFailure(); }),
    ]), remaining, label);
    assertRunning();
    return value;
  }
  function cleanup() {
    return cleanupPromise ??= (async () => {
      closing = true;
      const warnings = [], failures = [];
      let profileRemoved = false;
      async function attempt(label, action, timeout = 2000) {
        try { return await bounded(Promise.resolve().then(action), timeout, label); }
        catch (error) { warnings.push({ stage: label, ...errorDetail(error) }); }
      }
      if (context) {
        await Promise.all(context.pages().map(page => page.isClosed() ? undefined
          : attempt('关闭本任务标签页', () => page.close())));
        console.log('浏览器清理：剩余标签页 ' + context.pages().length + '。');
      }
      if (browser?.isConnected()) {
        await attempt('关闭本任务浏览器', async () => {
          const cdp = await browser.newBrowserCDPSession();
          await cdp.send('Browser.close');
        });
      }
      if (browser) await attempt('断开本任务 CDP', () => browser.close());
      const kill = signal => {
        try { child.kill(signal); }
        catch (error) { warnings.push({ stage: '终止本任务浏览器', ...errorDetail(error) }); }
      };
      if (child && !closed) {
        if (child.pid && !exited) kill('SIGTERM');
        await bounded(processClosed, 3000, '等待浏览器退出').catch(() => {});
        if (!closed && child.pid && !exited) {
          kill('SIGKILL');
          await bounded(processClosed, 2000, '等待浏览器强制退出').catch(() => {});
        }
      }
      if (child?.pid && !closed) {
        failures.push({ stage: 'process-close', message: '尚未确认本任务浏览器关闭，保留其 profile 避免与进程写入竞争。' });
      } else if (!path.resolve(profile).startsWith(scratchRoot + path.sep)) {
        failures.push({ stage: 'profile', message: '拒绝删除工作区外的浏览器目录。' });
      } else {
        try {
          await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 });
          profileRemoved = true;
        }
        catch (error) { failures.push({ stage: 'profile', ...errorDetail(error) }); }
      }
      if (warnings.length) console.warn('本任务浏览器清理附加信息：' + JSON.stringify(warnings));
      if (failures.length) console.error('本任务浏览器清理未完成：' + JSON.stringify(failures));
      const result = { warnings, failures, exit: exited || null, close: closed || null, profileRemoved };
      console.log('本任务浏览器清理结果：' + JSON.stringify({ pid: child?.pid ?? null, exit: result.exit, close: result.close, profileRemoved }));
      return result;
    })();
  }
  try {
    child = spawn(executable, [
      ...(!headed ? ['--headless=new'] : []), '--remote-debugging-port=0', `--user-data-dir=${profile}`,
      '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
      '--disable-component-update', 'about:blank',
    ], { windowsHide: !headed, stdio: ['ignore', 'pipe', 'pipe'] });
    child.on('error', error => {
      spawnError = error;
      endProcess();
      if (!closing) console.error('本任务浏览器进程错误：' + JSON.stringify(errorDetail(error)));
    });
    child.on('exit', (code, signal) => {
      exited = { code, signal, elapsedMs: Date.now() - started };
      endProcess();
      if (!closing) console.error('本任务浏览器意外退出：PID ' + child.pid + '，code=' + code + '，signal=' + signal);
    });
    child.on('close', (code, signal) => {
      closed = { code, signal, elapsedMs: Date.now() - started };
      finishClose();
    });
    for (const stream of ['stdout', 'stderr']) {
      const pipe = child[stream];
      if (!pipe) continue;
      pipe.setEncoding('utf8');
      pipe.on('data', chunk => collect(stream, chunk));
      pipe.on('end', () => { if (partial[stream]) readLine(partial[stream], stream); });
    }
    console.log('正在启动本任务浏览器：' + JSON.stringify(snapshot()));
    endpoint = await duringStartup(async () => {
      while (Date.now() < deadline) {
        assertRunning();
        if (announced) return announced;
        try {
          const [portText, browserPath] = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/);
          const port = Number(portText);
          if (/^\d+$/.test(portText) && Number.isInteger(port) && port > 0 && port <= 65535) {
            const value = browserPath ? localWebSocket('ws://127.0.0.1:' + port + browserPath) : 'http://127.0.0.1:' + port;
            if (value) { endpointSource = 'DevToolsActivePort'; return value; }
          }
          lastPortReadError = { message: 'DevToolsActivePort 尚未包含有效的本机 CDP 地址。' };
        } catch (error) { lastPortReadError = errorDetail(error); }
        await Promise.race([pause(Math.min(200, Math.max(1, deadline - Date.now()))), processEnded]);
      }
      throw new Error('浏览器 CDP 启动超时（60 秒）。');
    }, '浏览器 CDP 启动');
    browser = await duringStartup(() => chromium.connectOverCDP(endpoint, { timeout: Math.max(1, deadline - Date.now()) }), '连接浏览器 CDP');
    context = browser.contexts()[0];
    if (!context) throw new Error('本任务浏览器没有提供可用的默认上下文。');
    if(process.env.E2E_ISOLATED==="1" && routeGuard)await duringStartup(() => context.route('**/api/**',route=>{
      if(!['GET','HEAD','OPTIONS'].includes(route.request().method()) && new URL(route.request().url()).origin!==process.env.FRONTEND_URL)return route.abort('blockedbyclient');
      return route.fallback();
    }), '设置隔离请求保护');
    const page = await duringStartup(() => context.newPage(), '创建本任务页面');
    page.on('crash', () => console.error('本任务页面渲染进程崩溃：' + page.url()));
    // This browser and all its tabs are task-owned, with an isolated profile.
    for (const initial of context.pages()) if (initial !== page) await duringStartup(() => initial.close(), '关闭本任务初始页面');
    console.log('本任务浏览器已连接：' + JSON.stringify(snapshot()));
    return { browser, context, page, close: async () => {
      const result = await cleanup();
      if (result.failures.length) throw new Error('本任务浏览器清理未完成：' + JSON.stringify(result.failures));
    } };
  } catch (error) {
    const diagnostic = { ...snapshot(), originalError: errorDetail(error) };
    diagnostic.cleanup = await cleanup().catch(cleanupError => ({ failures: [{ stage: 'cleanup', ...errorDetail(cleanupError) }] }));
    diagnostic.stdout = output.stdout;
    diagnostic.stderr = output.stderr;
    console.error('本任务浏览器启动失败：' + JSON.stringify(diagnostic));
    const failure = new Error(error?.message || String(error), { cause: error });
    failure.name = 'BrowserStartupError';
    failure.browserStartup = diagnostic;
    throw failure;
  }
}

export async function settle(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 5000))]));
  await page.waitForTimeout(400);
}
