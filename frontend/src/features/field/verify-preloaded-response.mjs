/** Real saved full-field initial data and native dg83 run; no API interception. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {openHeadlessBrowser,repositoryRoot} from '../../../scripts/browser.mjs';
const front=process.env.FRONTEND_URL,back=process.env.BACKEND_URL;
for(const url of [front,back])assert(url&&new URL(url).hostname==='127.0.0.1'&&!['8100','8200'].includes(new URL(url).port));
const out=process.env.HPC_REAL_EVIDENCE||path.join(repositoryRoot,'.data/fix-round/simulation-preload-read');
const reference=JSON.parse(await fs.readFile(path.join(out,'reference.json'),'utf8'));
const phase=process.argv[2]||'reference';
async function api(url){const r=await fetch(back+url);if(!r.ok)throw Error(await r.text());return r.json();}
const browser=await openHeadlessBrowser(),{page}=browser,errors=[];page.on('pageerror',e=>errors.push(e.message));
const start=performance.now();
try{
 await page.setViewportSize({width:1366,height:768});
 const runs=await api(`/api/workspaces/${reference.workspace}/studies/${reference.study}/runs?view=summary`);
 if(phase==='reference'){
  assert(!(runs.items||runs).some(row=>['succeeded','accepted','running','validating'].includes(row.status)),'Inspect the saved submission before considering another');
  await page.goto(`${front}/studies/${reference.study}/ampacity/results?theme=light`);
  const received=page.waitForResponse(r=>r.url().includes(`/studies/${reference.study}/preflight`)&&!r.url().includes('input-preflight'),{timeout:360000});received.catch(()=>{});
  await page.getByRole('button',{name:'预检并运行',exact:true}).click({timeout:90000});
  const dialog=page.getByRole('dialog',{name:'运行前预检'});await dialog.waitFor();
  const response=await received,value=await response.json();
  await fs.writeFile(path.join(out,'reference-preflight.json'),JSON.stringify({seconds:(performance.now()-start)/1000,status:response.status(),value},null,2));
  await page.screenshot({path:path.join(out,'reference-preflight.png')});assert(response.ok()&&value.ready,JSON.stringify(value));
  const ack=dialog.getByRole('checkbox');if(await ack.count())await ack.check();
  const accepted=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith(`/studies/${reference.study}/runs`));
  await dialog.getByRole('button',{name:'确认并运行',exact:true}).click();
  const response2=await accepted,run=await response2.json();assert(response2.ok(),JSON.stringify(run));
  await fs.writeFile(path.join(out,'reference-submitted.json'),JSON.stringify(run,null,2));
 }else{
  const source=(runs.items||runs).find(row=>row.status==='succeeded');assert(source,'The actual native reference must finish first');
  await page.goto(`${front}/studies/${reference.study}/thermal-field/field?theme=light&run=${source.id}`);
  const tab=page.getByRole('tab',{name:'阶跃热响应',exact:true});await tab.waitFor({timeout:90000});await tab.click();
  const section=page.locator('section[aria-label="阶跃热响应"]');await section.waitFor({timeout:90000});
  if(phase==='submit'){
   const history=await api(`/api/hpc/workspaces/${reference.workspace}/studies/${reference.study}/step-responses`);assert(!history.items.some(row=>['queued','running','interrupted','succeeded','completed'].includes(row.status)),'Inspect the original transient job before another submission');
   await section.getByText('补充材料热容来源',{exact:true}).click();
   await section.getByRole('textbox').fill(JSON.stringify(reference.capacities));
   await section.locator('.capacity-site-inputs input').nth(0).fill('8');
   await section.locator('.hpc-budget input').fill('16');
   const received=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/step-responses/estimate'));
   await section.getByRole('button',{name:'预检响应与预算',exact:true}).click();
   const r=await received,estimate=await r.json();assert(r.ok(),JSON.stringify(estimate));assert(estimate.budget_core_hours<=16);
   await page.screenshot({path:path.join(out,'preload-budget.png')});
   const accepted=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/step-responses'),{timeout:120000});accepted.catch(()=>{});
   await page.getByRole('dialog',{name:'确认阶跃热响应核时预算'}).getByRole('button',{name:'提交 dg83',exact:true}).click();
   const r2=await accepted,state=await r2.json();assert(r2.ok(),JSON.stringify(state));
   await fs.writeFile(path.join(out,'preload-submitted.json'),JSON.stringify({source:source.id,estimate,state},null,2));
  }else{
   await section.getByText('预载暂态的时间步与网格达到门槛',{exact:true}).waitFor({timeout:90000});
   for(const width of [1366,1920])for(const theme of ['light','dark']){
    await page.setViewportSize({width,height:width===1366?768:1080});
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    assert(!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth));
   }
   await page.setViewportSize({width:1366,height:768});
   await page.evaluate(()=>document.documentElement.dataset.theme='light');
   await section.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'preload-overview.png')});
   const chart=section.getByRole('img',{name:'保存有限元阶跃温升曲线'});
   await chart.scrollIntoViewIfNeeded();
   for(const label of await chart.locator('text').all()){
    const size=await label.evaluate(node=>Number.parseFloat(getComputedStyle(node).fontSize)*node.getScreenCTM().a);
    assert(size>=13,`Curve label ${size}px`);
   }
   assert.equal(await section.getByRole('img',{name:'网格加密最大温升差',exact:true}).count(),1);
   await page.screenshot({path:path.join(out,'preload-curve.png')});
   assert((await section.innerText()).includes('非 IEC 官方算例'));assert.equal(await section.getByText('导出应急响应输入',{exact:true}).count(),0);
   const history=await api(`/api/hpc/workspaces/${reference.workspace}/studies/${reference.study}/step-responses`);
   const detail=await api('/api/hpc/step-responses/'+history.items[0].id);
   assert.equal(detail.response.saved_source.run_id,source.id);assert.equal(detail.response.phase_bindings.length,3);
   assert(detail.response.convergence.time_passed&&detail.response.convergence.mesh_passed);
   await fs.writeFile(path.join(out,'preload-result.json'),JSON.stringify(detail,null,2));
  }
 }
 assert.deepEqual(errors,[]);
}catch(e){await page.screenshot({path:path.join(out,'failure.png')});await fs.writeFile(path.join(out,'failure-visible.txt'),await page.locator('body').innerText());throw e;}
finally{await browser.close();console.log('本任务浏览器已关闭，剩余标签页 0。耗时 '+((performance.now()-start)/1000).toFixed(2)+' s');}
