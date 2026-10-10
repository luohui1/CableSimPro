/** One headless Edge page; fake scheduling, actual saved dg83 curve/exports. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openHeadlessBrowser,settle,repositoryRoot } from '../../../scripts/browser.mjs';
import { assertLayout } from '../../../scripts/layout-assertions.mjs';

const base=process.env.FRONTEND_URL;if(!base)throw Error('Set FRONTEND_URL to an existing dev service');
const folder=path.join(repositoryRoot,'.data/simulation/step-response'),out=path.join(folder,'browser');await fs.mkdir(out,{recursive:true});
const saved=JSON.parse(await fs.readFile(path.join(folder,'response.json'),'utf8')),run=JSON.parse(await fs.readFile(path.join(folder,'steady.json'),'utf8'));
assert.equal(saved.response.convergence.status,'converged');assert(saved.emergency_input);
const session=await openHeadlessBrowser(),{page}=session,checks=[],errors=[];let mode='empty',key=0,submissions=0,requestId,held=[];
const entry=()=>({...saved,status:mode==='active' ? 'running' : 'completed',execution:{...saved.execution,state:mode==='active' ? 'queued' : 'completed',queue_position:mode==='active' ? 2 : null}});
try {
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url()),method=route.request().method();
    if(!url.pathname.startsWith('/api/'))return route.continue();
    if(mode==='loading'){held.push(route);return;}
    if(mode==='error')return route.fulfill({status:503,json:{detail:'超算连接中断，保存数据保留。'}});
    if(url.pathname.endsWith('/estimate'))return route.fulfill({json:{budget_core_hours:12.4,node_limit:120000}});
    if(method==='POST' && url.pathname.endsWith('/step-responses')){submissions++;requestId=route.request().postDataJSON().request_id;mode='active';return route.fulfill({json:entry()});}
    if(url.pathname.endsWith('/cancel')){mode='success';return route.fulfill({json:{...entry(),status:'cancelled',cancel_requested:true}});}
    if(url.pathname.includes('/step-responses/'))return route.fulfill({json:entry()});
    if(url.pathname.endsWith('/step-responses'))return route.fulfill({json:{items:mode==='empty' ? [] : mode==='history' ? [entry(),{...entry(),id:'older-response',sequence:0,created:'2026-10-01T10:00:00Z'}] : [entry()]}});
    return route.fulfill({status:404,json:{detail:'Browser fixture route not covered'}});
  });
  await page.route('**/step-response-browser',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>阶跃响应检查</title><script type="module">
import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
const {renderFixture}=await import('/src/features/field/browser-fixture.tsx');window.renderFixture=renderFixture;window.ready=true;
</script><style>body{margin:0}#test{height:100vh;overflow:auto;padding:var(--space-6);box-sizing:border-box;background:var(--panel);color:var(--text)}</style></head><body><main id="test"></main></body></html>`}));
  await page.setViewportSize({width:1366,height:768});await page.goto(base+'/step-response-browser');await page.waitForFunction(()=>window.ready).catch(error=>{console.error(errors);throw error;});
  await page.evaluate(({run,key})=>window.renderFixture('field',run,key),{run,key:++key});
  await page.getByRole('tab',{name:'阶跃热响应',exact:true}).click();
  await page.getByRole('button',{name:'预检响应与预算',exact:true}).click();
  await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});assert.equal(await page.getByRole('dialog').count(),0);
  await page.getByRole('button',{name:'预检响应与预算',exact:true}).click();await page.getByRole('dialog').waitFor();
  await page.getByRole('button',{name:'提交 dg83',exact:true}).focus();await page.keyboard.press('Enter');await page.keyboard.press('Enter');
  await page.getByRole('button',{name:'停止响应作业',exact:true}).waitFor();assert.equal(submissions,1);assert(requestId);
  assert((await page.locator('body').innerText()).includes('排队位置 2'));
  await page.getByRole('button',{name:'停止响应作业',exact:true}).click();
  mode='success';await page.evaluate(({run,key})=>window.renderFixture('step',run,key),{run,key:++key});
  await page.getByRole('img',{name:'保存有限元阶跃温升曲线',exact:true}).waitFor();
  assert((await page.locator('body').innerText()).includes('0.010 K'));
  const downloadPromise=page.waitForEvent('download');await page.keyboard.press('Control+s');const download=await downloadPromise;
  const file=path.join(out,'iec60853-response.json');await download.saveAs(file);assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')),saved.emergency_input);
  await page.screenshot({path:path.join(out,'response.png')});checks.push({case:'submit-budget-keyboard-cancel-export',submissions:1,job:saved.response.job_id});
  for(const viewport of [{width:1366,height:768},{width:1920,height:1080}])for(const theme of ['light','dark'])for(const state of ['empty','loading','error','success','history']){
    for(const route of held.splice(0))await route.fulfill({json:{items:[]}}).catch(()=>{});
    mode=state;await page.setViewportSize(viewport);await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    await page.evaluate(({run,state,key})=>window.renderFixture('step',{...run,freshness:state==='history' ? 'historical' : 'current'},key),{run,state,key:++key});
    if(state==='loading')await page.getByText('读取保存阶跃响应',{exact:true}).waitFor();
    else if(state==='empty')await page.getByText('尚无阶跃响应',{exact:true}).waitFor();
    else if(state==='error')await page.getByText('超算连接中断，保存数据保留。',{exact:true}).waitFor();
    else {await page.getByRole('img',{name:'保存有限元阶跃温升曲线',exact:true}).waitFor();assert.equal(await page.getByRole('table',{name:'阶跃响应收敛记录'}).locator('tbody tr:not(.group-row)').count(),saved.response.convergence.levels.length);}
    if(state==='history'){
      const selector=page.getByRole('combobox',{name:'保存响应'});await selector.waitFor();await selector.click();
      const options=page.getByRole('option');assert.equal(await options.count(),2);
      const labels=await options.allTextContents();assert(labels.every(label=>label.includes('运行 ') && !label.includes('T10:00') && !label.includes('older-response')));
      await options.nth(1).click();await page.getByRole('img',{name:'保存有限元阶跃温升曲线',exact:true}).waitFor();
    }
    await settle(page);checks.push({case:`step/${state}/${theme}/${viewport.width}`,...await assertLayout(page,`step/${state}/${theme}/${viewport.width}`)});
  }
  assert.deepEqual(errors,[]);await fs.writeFile(path.join(out,'checks.json'),JSON.stringify({checks,errors,realCurveJob:saved.response.job_id,simulatedScheduling:true},null,2));console.log(JSON.stringify({checks:checks.length,out}));
}finally{for(const route of held)await route.abort().catch(()=>{});await page.unrouteAll({behavior:'ignoreErrors'});await session.close();}
