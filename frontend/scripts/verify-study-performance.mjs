import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect as baseExpect } from '@playwright/test';
import { openHeadlessBrowser, outputRoot } from './browser.mjs';
import { assertLayout } from './layout-assertions.mjs';

// Browser-cache measurements only: warm one isolated host, keep immutable
// source runs, and never submit a solver or rewrite their version bindings.
if(process.env.E2E_ISOLATED!=='1')throw Error('Use an isolated database');
const receipt=JSON.parse(await fs.readFile(process.env.FEM_RECEIPT,'utf8'));
const base=process.env.FRONTEND_URL,expect=baseExpect.configure({timeout:60000});
const latest=process.env.STUDY_PERFORMANCE_LATEST==='1';
const out=path.join(outputRoot,'study-performance',(process.env.STUDY_PERFORMANCE_PHASE || 'after')+(latest ? '-latest' : ''));
await fs.mkdir(out,{recursive:true});
const session=await openHeadlessBrowser(),{page,context}=session;
// Playwright routing disables HTTP cache. This measurement session is read-only;
// remove the helper's mutation guard so cold/hot mean real browser cache states.
await context.unrouteAll();
const cdp=await context.newCDPSession(page);
await cdp.send('Network.enable');
await page.setViewportSize({width:1366,height:768});
await page.addInitScript(()=>{
  window.__studyLongTasks=[];
  new PerformanceObserver(list=>window.__studyLongTasks.push(...list.getEntries().map(e=>({startMs:e.startTime,durationMs:e.duration,name:e.name})))).observe({type:'longtask',buffered:true});
  // Measure paint readiness in the renderer, not Playwright's assertion retry
  // intervals. Two frames after visible saved metrics + a sized canvas.
  function ready(){
    const answer=document.querySelector('.answer-bar'),canvas=document.querySelector('.study-field-slot canvas');
    const rect=canvas?.getBoundingClientRect();
    if(answer && /359\.6|允许电流/.test(answer.textContent) && canvas && canvas.width>0 && rect.width>0 && rect.height>0){
      requestAnimationFrame(()=>requestAnimationFrame(()=>{window.__studyReady=performance.now();}));
    }else requestAnimationFrame(ready);
  }
  requestAnimationFrame(ready);
});
const report={viewport:{width:1366,height:768},host:'preheated isolated read-only source copy',warmup:[],measurements:[],errors:[],writes:[]};
let current,origin;
const requests=new Map();
page.on('pageerror',error=>report.errors.push(error.message));
page.on('request',r=>{if(r.url().includes('/api/')&&!['GET','HEAD','OPTIONS'].includes(r.method()))report.writes.push({method:r.method(),url:r.url()});});
cdp.on('Network.requestWillBeSent',e=>{
  if(!current)return;
  origin??=e.timestamp;
  const row={path:new URL(e.request.url).pathname,method:e.request.method,startMs:(e.timestamp-origin)*1000,type:e.type};
  current.requests.push(row);requests.set(e.requestId,row);
});
cdp.on('Network.responseReceived',e=>{
  const row=requests.get(e.requestId);if(!row)return;
  row.status=e.response.status;row.responseMs=(e.timestamp-origin)*1000;
  row.cache=e.response.fromDiskCache?'disk':e.response.fromServiceWorker?'worker':'network';
  row.hostCache=e.response.headers['x-cablesim-read-cache'];row.serverTiming=e.response.headers['server-timing'];
  row.etag=e.response.headers.etag;
});
cdp.on('Network.loadingFinished',e=>{
  const row=requests.get(e.requestId);if(row){row.endMs=(e.timestamp-origin)*1000;row.durationMs=row.endMs-row.startMs;row.encodedBytes=e.encodedDataLength;}
});
cdp.on('Network.loadingFailed',e=>{const row=requests.get(e.requestId);if(row)row.failure=e.errorText;});
async function warm(route){
  const start=performance.now(),response=await page.request.get(base+route);
  assert.equal(response.status(),200,`Warmup ${route}: ${await response.text()}`);
  await response.body();report.warmup.push({path:route,ms:performance.now()-start});
}
try{
  const wid=receipt.workspace;
  for(const route of ['/api/methods','/api/input-contracts',`/api/workspaces/${wid}`])await warm(route);
  // Health means startup accepted, not that background index/catalog preheat
  // has finished. Complete it explicitly before the requested warm-host test.
  await warm('/api/index/inbox');
  await warm(`/api/workspaces/${wid}/studies`);
  const spaces=await(await page.request.get(base+'/api/workspaces')).json();
  for(const space of spaces)if(space.id!==wid)await warm(`/api/workspaces/${space.id}/studies`);
  const cases=[
    {kind:'fem',sid:receipt.child_study,rid:receipt.latest_fem_run,module:'thermal-field',thresholdMs:3000},
    {kind:'iec',sid:receipt.iec,rid:receipt.iecRun,module:'ampacity',thresholdMs:1500},
  ];
  for(const item of cases){
    await warm(`/api/workspaces/${wid}/studies/${item.sid}`);
    await warm(`/api/workspaces/${wid}/studies/${item.sid}/runs/${item.rid}`);
    if(item.kind==='fem')await warm(`/api/workspaces/${wid}/runs/${item.rid}/fem-conclusion`);
    for(const cache of ['cold','hot'])for(let sample=1;sample<=3;sample++){
      await page.goto('about:blank');
      if(cache==='cold')await cdp.send('Network.clearBrowserCache');
      await cdp.send('Network.setCacheDisabled',{cacheDisabled:false});
      origin=undefined;requests.clear();current={kind:item.kind,cache,sample,requests:[]};
      await page.goto(`${base}/studies/${item.sid}/${item.module}/results?workspace=${wid}&run=${latest ? '' : item.rid}&theme=light`,{waitUntil:'domcontentloaded'});
      await expect(page.locator('.answer-bar')).toContainText(item.kind==='fem'?'359.6':'允许电流');
      await expect(page.locator('.study-field-slot canvas')).toBeVisible();
      await page.waitForFunction(()=>!!document.querySelector('.study-field-slot canvas')?.width);
      await page.waitForFunction(()=>!!window.__studyReady);
      current.firstScreenMs=await page.evaluate(()=>window.__studyReady);
      await page.waitForTimeout(600);
      current.longTasks=await page.evaluate(()=>window.__studyLongTasks);
      report.measurements.push(current);current=undefined;
      console.log(`${item.kind} ${cache} #${sample}: ${report.measurements.at(-1).firstScreenMs.toFixed(0)} ms`);
      if(cache==='hot' && sample===3)await page.screenshot({path:path.join(out,`${item.kind}.png`)});
    }
  }
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.writes,[]);
  if(process.env.STUDY_PERFORMANCE_PHASE!=='before')for(const row of report.measurements){
    assert.ok(row.firstScreenMs<=(row.kind==='fem'?3000:1500),`${row.kind} ${row.cache} #${row.sample}: ${row.firstScreenMs.toFixed(0)} ms`);
    assert.ok(!row.requests.some(r=>r.path.endsWith('/view')),'Verified saved display artifact must not be fetched twice');
    assert.ok(!row.requests.some(r=>r.path.includes('/convergence')||r.path.endsWith('/sample')),'Proof and sampling are not first-screen reads');
    assert.ok(!row.requests.some(r=>/\/studies\/[^/]+\/runs$/.test(r.path)),'Saved-run history is loaded only when opened');
    const details=row.requests.filter(r=>/\/studies\/[^/]+\/runs\/[^/]+$/.test(r.path));
    assert.equal(details.length,1,'Loader, hover and component use one saved-run cache');
    const studyResponses=row.requests.filter(r=>/\/studies\/[^/]+$/.test(r.path));
    assert.equal(studyResponses.length,1,'Context and latest-run lookup share one study response');
  }
  if(process.env.STUDY_PERFORMANCE_PHASE!=='before') {
    const item=cases[0];
    await page.goto(`${base}/studies/${item.sid}/${item.module}/results?workspace=${wid}&run=${item.rid}&theme=light`);
    await expect(page.locator('.answer-bar')).toContainText('359.6');
    report.layout=[];
    for(const size of [{width:1366,height:768},{width:1920,height:1080}])for(const theme of ['light','dark']){
      await page.setViewportSize(size);await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
      await page.waitForTimeout(100);await assertLayout(page,`FEM ${theme}`);
      report.layout.push({...size,theme});
    }
    // History/proof stay independently interactive while their saved evidence is
    // fetched. No solver submission or remote full-grid sampling is performed.
    const history=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/workspaces/${wid}/studies/${item.sid}/runs`);
    const started=performance.now();await page.getByRole('button',{name:'运行记录',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'运行记录'})).toBeVisible();
    const responsive=await page.evaluate(()=>new Promise(resolve=>{const start=performance.now();requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(performance.now()-start)));}));
    const loaded=await history;assert.equal(loaded.status(),200);await loaded.finished();
    report.lazyHistory={ms:performance.now()-started,responsiveFrameMs:responsive};
    await page.keyboard.press('Escape');
    await page.getByRole('tab',{name:'收敛',exact:true}).click();
    await expect(page.getByRole('tab',{name:'收敛',exact:true})).toHaveAttribute('aria-selected','true');
    report.lazyProof={responsiveFrameMs:await page.evaluate(()=>new Promise(resolve=>{const start=performance.now();requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(performance.now()-start)));}))};
    assert.ok(responsive<250 && report.lazyProof.responsiveFrameMs<250,'Saved evidence tabs must keep rendering responsive');
  }
}catch(error){report.failure=error.stack;report.screen=await page.locator('body').innerText();throw error;}
finally{
  await fs.writeFile(path.join(out,'waterfall.json'),JSON.stringify(report,null,2));
  await fs.writeFile(path.join(out,'waterfall.txt'),report.measurements.map(r=>`${r.kind} ${r.cache} #${r.sample} first screen ${r.firstScreenMs.toFixed(0)} ms\n`+r.requests.map(q=>`${q.startMs.toFixed(0)} → ${q.endMs?.toFixed(0) || '?'} ms ${q.encodedBytes || 0} B ${q.path} [${q.hostCache || q.cache || ''}; ${q.serverTiming || ''}]`).join('\n')+'\nlong tasks: '+JSON.stringify(r.longTasks)).join('\n\n'));
  await session.close();
}
