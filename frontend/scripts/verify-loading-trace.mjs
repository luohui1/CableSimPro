// Real saved pages, no network throttling, synthetic input or solver execution.
import fs from 'node:fs/promises';
import path from 'node:path';
import { openHeadlessBrowser, repositoryRoot } from './browser.mjs';
import { installReadinessObserver, waitForPageReady } from './page-readiness.mjs';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import { loadingTraceReport } from './loading-trace-report.mjs';
import assert from 'node:assert/strict';

if (process.env.E2E_ISOLATED !== '1') throw Error('加载归因只运行于隔离宿主');
const out = path.resolve(process.env.LOADING_TRACE_OUTPUT || path.join(repositoryRoot, '.data/fix-round/shared-shell/loading-path/trace'));
await fs.mkdir(out, { recursive: true });
const routes = JSON.parse(process.env.LOADING_TRACE_ROUTES || '[{"name":"home","path":"/?theme=light"}]');
for (const route of routes) if (!/^[a-z][a-z0-9-]*$/.test(route.name) || !route.path.startsWith('/') || route.path.startsWith('//'))
  throw Error('追踪目标须是本地路由，名称只能使用小写字母、数字和连字符');
const resources = new Map();
async function source(frame) {
  if (!frame.url || !frame.url.startsWith(process.env.FRONTEND_URL)) return frame;
  try {
    const relative = new URL(frame.url).pathname.slice(1) + '.map';
    if (!resources.has(relative)) resources.set(relative, new TraceMap(JSON.parse(await fs.readFile(path.join(process.env.E2E_FRONTEND_DIST, relative), 'utf8'))));
    const original = originalPositionFor(resources.get(relative), { line:frame.lineNumber+1, column:frame.columnNumber });
    return { ...frame, original };
  } catch { return frame; }
}
const results = [];
async function useSharedControls(page) {
  const checks=[];
  if (process.env.LOADING_TRACE_RUNS === '1' && new URL(page.url()).pathname === '/runs') {
    const rows = page.locator('.run-record-list .data-row');
    const more = page.getByRole('button', { name: /^加载更多（已显示/ });
    const label = await more.textContent();
    const counts = label?.match(/已显示 (\d+) \/ (\d+)/);
    assert.ok(counts, '保存库须含超过一页的真实运行');
    assert.equal(await rows.count(), 10);
    const total = Number(counts[2]), loads = [];
    while (await more.count()) {
      const before = await rows.count(), start = Date.now();
      await more.click();
      await page.waitForFunction(previous => document.querySelectorAll('.run-record-list .data-row').length > previous, before);
      await waitForPageReady(page);
      const after = await rows.count();
      assert.ok(after > before && after <= total);
      assert.equal(new Set(await rows.evaluateAll(elements => elements.map(e => e.id))).size, after);
      loads.push({ before, after, ms: Date.now() - start });
    }
    assert.equal(await rows.count(), total);
    assert.equal(await rows.filter({ hasText: '摘要读取中' }).count(), 0);
    checks.push({ runPagination: { total, loads, noDuplicates: true, allRecordsRetained: true } });
  }
  if (process.env.LOADING_TRACE_TABS === '1' && await page.locator('.tabs-list[role="tablist"]').count()) {
    const list = page.locator('.tabs-list[role="tablist"]').first();
    const active = list.getByRole('tab', { selected: true });
    const original = await active.textContent();
    const originalIndex = await active.evaluate(element => [...element.parentElement.querySelectorAll('[role="tab"]')].indexOf(element));
    await active.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await page.waitForFunction(previous => document.querySelector('.tabs-list [role="tab"][aria-selected="true"]')?.textContent !== previous, original);
    await waitForPageReady(page);
    const changed = list.getByRole('tab', { selected: true });
    assert.notEqual(await changed.textContent(), original, '键盘应切换到下一页签');
    const panelId = await changed.getAttribute('aria-controls');
    const panel = page.locator(`[id="${panelId}"]`);
    assert.equal(await panel.isVisible(), true);
    assert.equal(await panel.getAttribute('aria-labelledby'), await changed.getAttribute('id'));
    const changedName = await changed.textContent();
    await list.getByRole('tab').nth(originalIndex).click();
    await waitForPageReady(page);
    assert.equal(await list.getByRole('tab', { selected: true }).textContent(), original);
    checks.push({ tabs: { original, changed: changedName, keyboard: true, accessiblePanel: true, restored: true } });
  }
  const theme=async name=>{
    if(await page.locator('html').getAttribute('data-theme')===name)return;
    await page.locator('.sidebar-foot').getByRole('button').click();
    await page.getByRole('menuitem',{name:name==='dark'?'切换深色模式':'切换浅色模式',exact:true}).click();
    await waitForPageReady(page);
  };
  for(const appearance of ['light','dark']) {
  await theme(appearance);
  for(const size of [{width:1920,height:1080},{width:1366,height:768}]) {
    await page.setViewportSize(size);
    await page.waitForFunction(() => [...document.querySelectorAll('.adaptive-command-bar')].every(bar => {
      const box=bar.getBoundingClientRect();
      return [...bar.children].filter(e=>!e.closest('[aria-hidden="true"]')).every(e=>e.getBoundingClientRect().right<=box.right+1);
    }));
    const layout=await page.locator('.adaptive-command-bar').evaluateAll(bars=>bars.map(bar=>{
      const box=bar.getBoundingClientRect(),buttons=[...bar.querySelectorAll(':scope > .button,:scope > .command-disabled > .button')];
      return {scroll:bar.scrollWidth>bar.clientWidth+1,primary:buttons.filter(b=>b.dataset.commandRole==='primary').length,
        fixedCount:buttons.filter(b=>b.dataset.commandRole).length,expectedFixed:bar.querySelectorAll('.command-measure [data-command-role]').length,
        fixedVisible:buttons.filter(b=>b.dataset.commandRole).every(b=>{const r=b.getBoundingClientRect();return r.width>0&&r.right<=box.right+1;}),
        labels:buttons.map(b=>b.textContent.trim()),more:!!bar.querySelector('[aria-label="更多操作"]')};
    }));
    for(const bar of layout){assert.equal(bar.scroll,false);assert.ok(bar.primary<=1);assert.equal(bar.fixedVisible,true);assert.equal(bar.fixedCount,bar.expectedFixed);}
    checks.push({theme:appearance,size,bars:layout});
  }
  }
  await theme('light');
  const more=page.locator('.adaptive-command-bar').getByRole('button',{name:'更多操作',exact:true}).first();
  if(await more.count()) {
    await more.click();await page.getByRole('menu').waitFor({state:'visible'});
    const labels=await page.getByRole('menuitem').allTextContents();assert.ok(labels.length);
    await page.keyboard.press('Escape');await page.getByRole('menu').waitFor({state:'hidden'});
    assert.equal(await more.evaluate(e=>e===document.activeElement),true);
    checks.push({menu:labels,escapeRestoresFocus:true});
  }
  // Deferred catalogue loading must finish and expose real names after the body.
  await page.waitForFunction(()=>!document.querySelector('.workbench-sidebar .tree-empty')?.textContent.includes('读取中'),null,{timeout:15000});
  const sidebarNames=await page.locator('.workbench-sidebar .tree-label').allTextContents();
  assert.ok(sidebarNames.length,'延后读取后必须显示真实工程/型号名称');
  checks.push({sidebarNames});
  return checks;
}
for (const route of routes) {
  const owned = await openHeadlessBrowser({ executable:'C:/Program Files/Google/Chrome/Application/chrome.exe', routeGuard:false });
  try {
    const {page,context} = owned;
    await page.setViewportSize({width:1366,height:768});
    await page.addInitScript(() => localStorage.setItem('theme','light'));
    if (process.env.LOADING_TRACE_STYLE === '1') await page.addInitScript(() => {
      // Diagnostic only: computed styles are lazy; time the property access too.
      // These instrumented visits are never used as performance-budget results.
      const original = window.getComputedStyle.bind(window);
      window.__styleReads = [];
      window.getComputedStyle = (element, pseudo) => {
        const styles = original(element, pseudo);
        return new Proxy(styles, { get(target, property) {
          const started = performance.now();
          const value = Reflect.get(target, property, target);
          const ms = performance.now() - started;
          if (ms >= 8 && window.__styleReads.length < 100) window.__styleReads.push({
            property: String(property), ms, at: started, tag: element.tagName,
            className: element.getAttribute('class'), role: element.getAttribute('role'),
            state: element.getAttribute('data-state'), id: element.id,
            parent: element.parentElement?.getAttribute('class'),
            text: element.textContent?.trim().slice(0, 160), stack: new Error().stack,
          });
          return typeof value === 'function' ? value.bind(target) : value;
        } });
      };
    });
    await installReadinessObserver(page);
    const cdp = await context.newCDPSession(page);
    const browserIdentity = {executable:'C:/Program Files/Google/Chrome/Application/chrome.exe', ...await cdp.send('Browser.getVersion')};
    await cdp.send('Network.enable');
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval',{interval:1000});
    for (const phase of ['cold','hot']) {
      const requests = new Map(), trace = [];
      const handlers = {
        'Network.requestWillBeSent': e => requests.set(e.requestId,{id:e.requestId,type:e.type,url:e.request.url,start:e.timestamp,wall:e.wallTime,initiator:e.initiator.type}),
        'Network.responseReceived': e => Object.assign(requests.get(e.requestId)||{}, {response:e.timestamp,status:e.response.status,cache:e.response.fromDiskCache,headers:e.response.headers,timing:e.response.timing}),
        'Network.dataReceived': e => { const r=requests.get(e.requestId); if(r){r.firstData??=e.timestamp;r.lastData=e.timestamp;r.chunks=(r.chunks||0)+1;r.encoded=(r.encoded||0)+e.encodedDataLength;} },
        'Network.loadingFinished': e => Object.assign(requests.get(e.requestId)||{}, {end:e.timestamp,bytes:e.encodedDataLength}),
        'Tracing.dataCollected': e => trace.push(...e.value),
      };
      for (const [event,handle] of Object.entries(handlers)) cdp.on(event,handle);
      await cdp.send('Tracing.start',{categories:'devtools.timeline,v8,blink.user_timing,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.stack',transferMode:'ReportEvents'});
      await cdp.send('Profiler.start');
      await page.goto(process.env.FRONTEND_URL+route.path,{waitUntil:'domcontentloaded'});
      const state = await waitForPageReady(page);
      const observed = await page.evaluate(() => ({...window.__loadAudit,timeOrigin:performance.timeOrigin,resources:performance.getEntriesByType('resource').map(e=>e.toJSON())}));
      const {profile} = await cdp.send('Profiler.stop');
      const tracingDone = new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));
      await cdp.send('Tracing.end'); await tracingDone;
      cdp.off('Tracing.dataCollected',handlers['Tracing.dataCollected']);
      const nodes = new Map(profile.nodes.map(n=>[n.id,n])), parents = new Map();
      for(const n of profile.nodes)for(const id of n.children||[])parents.set(id,n.id);
      const totals = new Map();
      for(let i=0;i<(profile.samples||[]).length;i++) {
        const duration=profile.timeDeltas[i];
        const node=nodes.get(profile.samples[i]); if(!node)continue;
        const key=node.id; const total=totals.get(key)||{frame:node.callFrame,selfMs:0,stack:[]};
        total.selfMs+=duration/1000;
        if(!total.stack.length){let id=node.id;while(id){const n=nodes.get(id);if(n)total.stack.push(n.callFrame);id=parents.get(id);}}
        totals.set(key,total);
      }
      const cpu = await Promise.all([...totals.values()].sort((a,b)=>b.selfMs-a.selfMs).slice(0,40).map(async v=>({...v,frame:await source(v.frame),stack:await Promise.all(v.stack.slice(0,12).map(source))})));
      const styleReads = process.env.LOADING_TRACE_STYLE === '1' ? await page.evaluate(() => window.__styleReads) : undefined;
      const item={route,phase,browserIdentity,state,observed,cpu,styleReads,requests:[...requests.values()],longTasks:trace.filter(e=>e.name==='RunTask'&&e.dur>=50000),traceEvents:trace.length};
      const name=route.name+'-'+phase;
      await fs.writeFile(path.join(out,name+'.json'),JSON.stringify(item,null,2));
      await fs.writeFile(path.join(out,name+'-cpu.json'),JSON.stringify(profile));
      await fs.writeFile(path.join(out,name+'-timeline.json'),JSON.stringify({traceEvents:trace}));
      if(phase==='hot') {
        await fs.writeFile(path.join(out,route.name+'-controls.json'),JSON.stringify(await useSharedControls(page),null,2));
        // Keep network observation through the real deferred catalogue reads.
        // They are labelled after-body and never added to the first-screen budget.
        item.observed.resources=await page.evaluate(()=>performance.getEntriesByType('resource').map(e=>e.toJSON()));
        item.requests=[...requests.values()];
        await fs.writeFile(path.join(out,name+'.json'),JSON.stringify(item,null,2));
        await page.screenshot({path:path.join(out,route.name+'.png')});
      }
      for (const [event,handle] of Object.entries(handlers)) cdp.off(event,handle);
      results.push({name,mainMs:observed.mainMs,frameMs:observed.frameMs,longTasks:observed.longTasks,errors:state.errors});
      console.log(JSON.stringify(results.at(-1)));
    }
  } finally { await owned.close(); }
}
await fs.writeFile(path.join(out,'summary.json'),JSON.stringify(results,null,2));
await loadingTraceReport(out,process.env.LOADING_SERVER_TRACE,process.env.E2E_FRONTEND_DIST || path.join(repositoryRoot,'frontend/dist'));
