import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { writeAuditJson } from './audit-json.mjs';
import { installReadinessObserver, waitForPageReady, readinessSnapshot } from './page-readiness.mjs';

async function writeReport(file, content) {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.writeFile(file + '.pending', content);
      await fs.rename(file + '.pending', file);
      return;
    }
    catch (error) {
      if (error.code !== 'EBUSY' || attempt === 4) throw Object.assign(error, { auditPersistence: true });
      // Windows readers may briefly lock the report. This only retries output I/O.
      await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
}

export function performanceFindings(report) {
  const cell = value => String(value ?? '未就绪').replaceAll('|','\\|').replaceAll('\n',' ');
  const rows = report.pages.map(p => `| ${cell(p.label)} | ${p.owner} | ${p.kind} | ${cell(p.mainMs)} / ${p.budgetMs} | ${p.canvases.length ? cell(p.frameMs) + ' / 5000' : '—'} | ${cell(p.slowestRequests[0] ? p.slowestRequests[0].url + ' · ' + Math.round(p.slowestRequests[0].durationMs) + ' ms' : '无已完成请求')} | ${p.longTasks[0] ? Math.round(p.longTasks[0].durationMs) + ' ms（未归因）' : '—'} | ${cell(p.terminalErrors.length ? '错误终态：' + p.terminalErrors.join('；') : p.failure || p.frameFailure ? '未就绪' : '内容已就绪')} | ${p.screenshot ? '[实屏](' + p.screenshot + ')' : '—'} |`);
  return '# 页面加载实测\n\n' + report.definition + '\n\n' + report.instrumentation + '\n\n完成：' + report.complete + '；' + JSON.stringify(report.counts) + '。耗时单位 ms。mainPassed 只表示时间预算；错误终态只测错误提示的呈现时间，不能当成功功能。加载超时不通过；空/未适用页只代表该保存状态。逐请求包体、开始/结束时间、Worker 和错误见 audit.json。\n\n| 页面 | 线程 | 首次/再次 | 内容 / 预算 | 首帧 / 预算 | 最慢已完成请求 | 最长主线程任务 | 界面终态 | 实屏 |\n|---|---|---|---|---|---|---|---|---|\n' + rows.join('\n') + '\n';
}

export function performanceProblems(report) {
  const cell = value => String(value ?? '—').replaceAll('|','\\|').replaceAll('\n',' ');
  const request = r => r ? `${r.url} · ${Math.round(r.durationMs)} ms · TTFB ${Math.round(r.ttfbMs)} ms · 解码 ${r.decodedBytes} B` : '无已完成请求';
  const groups = new Map();
  for (const p of report.pages.filter(p => !p.mainPassed || p.framePassed === false)) {
    if (!groups.has(p.owner)) groups.set(p.owner, []);
    groups.get(p.owner).push(p);
  }
  let text = '# 加载超预算问题清单\n\n' + report.definition + '\n\n按线程分组，只列超预算/未就绪测量。接口、下载与主线程任务分别列出；并行请求不自动等于阻塞原因，未归因任务不冒称 WASM 初始化。CAD 初始化采用视口自身回执，完整时间线与请求尚未完成的记录在 audit.json。错误终态详见 findings.md，不能当成功功能。\n';
  for (const [owner, pages] of groups) {
    text += `\n## ${owner} · ${pages.length} 次\n\n| 页面 / 路由 | 首次/再次 | 内容 / 预算 ms | 首帧 / 预算 ms | 最慢接口 | 最慢下载 | 任务 / 初始化 | 实屏 |\n|---|---|---|---|---|---|---|---|\n`;
    for (const p of pages.sort((a,b) => (b.mainMs || 0) - (a.mainMs || 0))) {
      const api = p.slowestApi?.[0] || p.resources.filter(r => r.url.startsWith('/api/')).sort((a,b) => b.durationMs - a.durationMs)[0];
      const download = p.slowestDownload?.[0] || p.resources.filter(r => !r.url.startsWith('/api/')).sort((a,b) => b.durationMs - a.durationMs)[0];
      const initialization = (p.rendering || []).filter(r => r.attributes['data-cad-initialization-ms']).map(r => 'CAD 初始化 ' + Math.round(Number(r.attributes['data-cad-initialization-ms'])) + ' ms');
      const tasks = [p.longTasks[0] ? '主线程 ' + Math.round(p.longTasks[0].durationMs) + ' ms（未归因）' : '', ...initialization,
        ...(p.workers || []).map(w => 'Worker 创建 ' + w.createdMs + ' ms · ' + w.url)].filter(Boolean).join('；') || '无已观测长任务';
      text += `| ${cell(p.label)} · ${cell(p.page)} | ${p.kind} | ${cell(p.mainMs)} / ${p.budgetMs} | ${p.canvases.length ? cell(p.frameMs) + ' / 5000' : '—'} | ${cell(request(api))} | ${cell(request(download))} | ${cell(tasks)} | ${p.screenshot ? '[实屏](' + p.screenshot + ')' : '—'} |\n`;
    }
  }
  return text;
}

export async function createPerformanceAudit({ page, context, root, base }) {
  const phase = process.env.PERFORMANCE_PASS || 'after';
  if (!/^[a-z-]+$/.test(phase)) throw Error('性能巡检输出名只能使用小写字母和连字符');
  const out = path.join(root, '.data/fix-round/shared-shell/performance', phase);
  await fs.mkdir(out, { recursive: true });
  const report = { generated: new Date().toISOString(), complete: false, pages: [], uncovered: [], budgets: { coldMs: 3000, hotMs: 1000, frameMs: 5000 },
    sourceDatabase: process.env.E2E_DATABASE_SOURCE || path.join(root, '.data/release/engineering.sqlite'), frontendSnapshot: process.env.E2E_FRONTEND_DIST || '当前前端构建',
    definition: '1366×768 浅色，真实发布库只读副本、真实宿主/插件；无节流。冷=每页清空浏览器 HTTP 缓存后完整导航；热=同页完整刷新，保留 HTTP 缓存。两次都重新建立页面及查询缓存。服务端先启动，跨页缓存/常驻几何进程不重启，故不是服务端冷启动。插件内部页签另测首次切换/再次切换。内容以工作面板实际文字/控件、可见加载态结束及连续两帧提交为准；画布单独以 CAD 实际 ready/首帧回执或场图真实 WebGL 绘制后的帧为准。',
    instrumentation: '只观察 DOM、Resource Timing、Long Tasks、CAD 已有初始化/显示回执和 Worker 创建；不把未归因的主线程长任务猜成 WASM 初始化。请求保留 fetch、DNS、连接、发送、首字节和响应完成的原始时点，零值按浏览器原样保留；最慢并行请求不自动等同于阻塞原因。所有 API 写请求由隔离后端拒绝；不使用 Playwright route，以保留真实浏览器缓存。' };
  await installReadinessObserver(page);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  let workers = [], failures = [], blocked = [], requests = new Map();
  const checkpointEvery = 32, measurementLog = path.join(out, 'measurements.jsonl');
  let journalStarted = false, checkpointMeasurements = 0, checkpointSurfaces = 0, traversedSurfaces = 0;
  report.persistence = { measurementLog: 'measurements.jsonl', checkpointEvery, persistedMeasurements: 0 };
  async function startJournal() {
    if (!journalStarted) { await writeReport(measurementLog, ''); journalStarted = true; }
  }
  async function appendMeasurement(row) {
    try {
      await startJournal();
      await fs.appendFile(measurementLog, JSON.stringify(row) + '\n');
      report.persistence.persistedMeasurements++;
    } catch (error) {
      report.complete = false;
      report.persistenceFailure = error.stack || String(error);
      throw Object.assign(error, { auditPersistence: true });
    }
  }
  page.on('request', request => requests.set(request, { url: request.url().replace(base, ''), startedAt: Date.now(), initiator: request.resourceType() }));
  page.on('requestfinished', request => { const timing = requests.get(request); if (timing) timing.finishedAt = Date.now(); });
  page.on('worker', worker => workers.push({ url: worker.url().replace(base, ''), observedAt: Date.now() }));
  page.on('requestfailed', request => failures.push({ url: request.url().replace(base, ''), reason: request.failure()?.errorText }));
  page.on('response', response => {
    const headers = response.headers(), request = requests.get(response.request());
    if (headers['x-audit-blocked']) blocked.push({ url: response.url().replace(base, ''), status: response.status() });
    if (request) Object.assign(request, { status: response.status(), serverTiming: headers['server-timing'] || null, readCache: headers['x-cablesim-read-cache'] || null });
  });
  async function measure(surface, kind, action) {
    workers = []; failures = []; blocked = []; requests = new Map();
    const started = Date.now(); let startMs = 0, actionTimeOrigin = null, failure = null;
    if (action) {
      ({ startMs, actionTimeOrigin } = await page.evaluate(() => {
        window.__loadAudit.mainMs = null; window.__loadAudit.frameMs = null;
        return { startMs: performance.now(), actionTimeOrigin: performance.timeOrigin };
      }));
    }
    try {
      if (action) await action();
      else {
        if (kind === 'cold') await cdp.send('Network.clearBrowserCache');
        await page.goto(base + surface.route + (surface.route.includes('?') ? '&' : '?') + 'theme=light', { waitUntil: 'domcontentloaded', timeout: 60000 });
      }
      await waitForPageReady(page, { includeCanvas: false });
      await page.waitForFunction(() => window.__loadAudit?.mainMs !== null, null, { timeout: 3000, polling: 25 });
    } catch (error) { failure = error.message; }
    let state = await page.evaluate(readinessSnapshot).catch(() => null), frameFailure = null;
    if (state?.canvases.length || state?.busy.some(b => b.canvas)) {
      try { await waitForPageReady(page, { timeout: 30000 }); }
      catch (error) { frameFailure = error.message; }
    }
    const readMetrics = () => page.evaluate(({ snapshot }) => {
      const audit = window.__loadAudit;
      return { ...audit, actualUrl: location.href, timeOrigin: performance.timeOrigin, state: (0, eval)('(' + snapshot + ')')(), now: performance.now(), resources: performance.getEntriesByType('resource').map(r => ({ url: r.name, startMs: r.startTime, endMs: r.responseEnd,
        fetchStartMs: r.fetchStart, domainLookupStartMs: r.domainLookupStart, domainLookupEndMs: r.domainLookupEnd,
        connectStartMs: r.connectStart, secureConnectionStartMs: r.secureConnectionStart, connectEndMs: r.connectEnd,
        requestStartMs: r.requestStart, responseStartMs: r.responseStart, nextHopProtocol: r.nextHopProtocol,
        durationMs: r.duration, ttfbMs: r.responseStart - r.requestStart, serverTiming: (r.serverTiming || []).map(t => ({ name: t.name, durationMs: t.duration, description: t.description })), transferBytes: r.transferSize, encodedBytes: r.encodedBodySize, decodedBytes: r.decodedBodySize, initiator: r.initiatorType })),
        navigation: performance.getEntriesByType('navigation').map(n => ({ ttfbMs: n.responseStart - n.requestStart, domContentLoadedMs: n.domContentLoadedEventEnd, transferBytes: n.transferSize })) };
    }, { snapshot: readinessSnapshot.toString() }).catch(() => null);
    let metrics = await readMetrics();
    if (metrics && (metrics.url !== metrics.actualUrl || metrics.mainMs === null || !metrics.state.mainReady)) {
      // The same measurement continues through a late client redirect. Its
      // clock and budget are unchanged; never pair a prior URL's time with the
      // target workspace's ready state.
      try {
        await waitForPageReady(page, { includeCanvas: false });
        await page.waitForFunction(() => window.__loadAudit?.url === location.href && window.__loadAudit?.mainMs !== null,
          null, { timeout: 3000, polling: 25 });
      } catch (error) { failure ||= error.message; }
      metrics = await readMetrics();
    }
    state = metrics?.state || state;
    let mainMs = metrics?.mainMs === null || metrics?.mainMs === undefined ? null : metrics.mainMs - startMs;
    if (mainMs < 0) mainMs = null;
    if (!state?.mainReady) failure ||= '测量结束时主内容仍未就绪：' + JSON.stringify(state);
    if (!metrics || metrics.url !== metrics.actualUrl) failure ||= '目标页面与就绪时间戳不属于同一地址';
    if (action && metrics?.timeOrigin !== actionTimeOrigin) failure ||= '页签操作进入了新文档，不能沿用原页面的计时起点';
    const rendering = (state?.canvases || []).flatMap(canvas => canvas.rendering ? [canvas.rendering] : []);
    const frameMs = metrics?.frameMs === null ? null : metrics?.frameMs - startMs;
    const applicableFrames = (state?.canvases || []).filter(c => !c.empty);
    const horizon = Math.max(metrics?.mainMs || 0, metrics?.frameMs || 0, (failure || frameFailure) ? metrics?.now || 0 : 0);
    const resources = (metrics?.resources || []).filter(r => r.startMs >= startMs && r.startMs <= horizon).map(r => {
      const url = r.url.replace(base, ''), response = [...requests.values()].filter(request => request.url === url && request.serverTiming !== undefined).at(-1);
      return { ...r, url, readCache: response?.readCache || null, serverTimingHeader: response?.serverTiming || null, status: response?.status };
    });
    const tasks = (metrics?.longTasks || []).filter(t => t.startMs >= startMs && t.startMs <= horizon);
    const row = { page: surface.route, actualUrl: (metrics?.actualUrl || page.url()).replace(base, ''), label: surface.label, owner: surface.owner, kind, navigation: action ? '页签切换' : '完整导航', mainMs: mainMs === null || mainMs === undefined ? null : Math.round(mainMs),
      budgetMs: kind === 'cold' ? 3000 : 1000, mainPassed: Number.isFinite(mainMs) && mainMs >= 0 && mainMs <= (kind === 'cold' ? 3000 : 1000) && !failure,
      frameMs: state?.canvases.length && frameMs !== null ? Math.round(frameMs) : null, canvases: state?.canvases || [],
      framePassed: applicableFrames.length ? Number.isFinite(frameMs) && frameMs >= 0 && frameMs <= 5000 && applicableFrames.every(c => c.ready && !c.error) && !failure && !frameFailure : null,
      unavailableFrames: (state?.canvases || []).filter(c => c.empty).map(c => ({ kind: c.kind, reason: '此保存状态没有几何工件；未制造首帧' })),
      terminalErrors: state?.errors || [], failure, frameFailure, rendering, slowestRequests: [...resources].sort((a,b) => b.durationMs - a.durationMs).slice(0,8),
      slowestApi: resources.filter(r => r.url.startsWith('/api/')).sort((a,b) => b.durationMs - a.durationMs).slice(0,3),
      slowestDownload: resources.filter(r => !r.url.startsWith('/api/')).sort((a,b) => b.durationMs - a.durationMs).slice(0,3), resources,
      longTasks: tasks.sort((a,b) => b.durationMs - a.durationMs), workers: workers.map(w => ({ url: w.url, createdMs: w.observedAt - started })), requestFailures: failures, blockedWrites: blocked,
      pendingRequests: [...requests.values()].filter(r => !r.finishedAt).map(r => ({ url: r.url, initiator: r.initiator, pendingMs: Date.now() - r.startedAt })).sort((a,b) => b.pendingMs - a.pendingMs),
      navigationTiming: metrics?.navigation, state, measuredAt: new Date().toISOString() };
    if (!action && kind === 'cold' || !row.mainPassed || row.framePassed === false) {
      row.screenshot = 'page-' + createHash('sha256').update(surface.route + kind).digest('hex').slice(0,12) + '.png';
      await page.screenshot({ path: path.join(out, row.screenshot) }).catch(() => {});
    }
    await appendMeasurement(row);
    report.pages.push(row);
    console.log('页面加载：' + JSON.stringify({ page: row.page, kind, mainMs: row.mainMs, frameMs: row.frameMs, mainPassed: row.mainPassed, framePassed: row.framePassed }));
    await save();
    return row;
  }
  async function save(traversal, { force = false } = {}) {
    if (traversal) {
      report.complete = traversal.complete && !traversal.failure && !report.persistenceFailure;
      report.scope = traversal.scope; report.uncovered = traversal.uncovered; report.errors = traversal.errors; report.runChecks = traversal.runChecks;
      report.failure = traversal.failure;
      traversedSurfaces = traversal.pages.length + traversal.uncovered.length;
    }
    if (traversal?.complete || traversal?.failure) force = true;
    // Rows are written individually; only rebuild the growing compatibility reports in bounded batches.
    if (!force && report.pages.length - checkpointMeasurements < checkpointEvery && traversedSurfaces - checkpointSurfaces < checkpointEvery) return;
    try {
      await startJournal();
      report.counts = { measurements: report.pages.length, pages: new Set(report.pages.map(p => p.page)).size, mainOverBudget: report.pages.filter(p => !p.mainPassed).length, frameOverBudget: report.pages.filter(p => p.framePassed === false).length,
        terminalErrorStates: report.pages.filter(p => p.terminalErrors.length).length, blockedWrites: report.pages.reduce((n,p) => n + p.blockedWrites.length,0) };
      await writeReport(path.join(out,'findings.md'), performanceFindings(report));
      await writeReport(path.join(out,'problems.md'), performanceProblems(report));
      // Publish complete only after the auxiliary reports have also been written.
      await writeAuditJson(path.join(out,'audit.json'), report);
      checkpointMeasurements = report.pages.length; checkpointSurfaces = traversedSurfaces;
    } catch (error) {
      report.complete = false;
      report.persistenceFailure = error.stack || String(error);
      throw Object.assign(error, { auditPersistence: true });
    }
  }
  return { measure, save, report, out };
}
