/** Real saved Chengnan input; private service, actual dg83, no API interception. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {openHeadlessBrowser,repositoryRoot} from '../../../scripts/browser.mjs';
const front=process.env.FRONTEND_URL,back=process.env.BACKEND_URL;
for(const url of [front,back])assert(url && new URL(url).hostname==='127.0.0.1' && !['8100','8200'].includes(new URL(url).port));
const out=process.env.HPC_REAL_EVIDENCE || path.join(repositoryRoot,'.data/fix-round/simulation-chengnan-steady');
const study=JSON.parse(await fs.readFile(path.join(out,'study.json'),'utf8'));
const phase=process.argv[2] || 'preflight';
const browser=await openHeadlessBrowser();const {page}=browser;const errors=[],requests=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('request',request=>requests.push({method:request.method(),url:new URL(request.url()).pathname}));
const start=performance.now();
try {
 await page.setViewportSize({width:1366,height:768});
 await page.goto(front+`/studies/${study.id}/thermal-field/field?theme=light`);
 const button=page.getByRole('button',{name:'预检并运行',exact:true});await button.waitFor({timeout:90000});
 await page.screenshot({path:path.join(out,'saved-input.png')});
 if(phase==='preflight' || phase==='submit') {
  const received=page.waitForResponse(r=>r.url().includes(`/studies/${study.id}/preflight`) && !r.url().includes('/input-preflight'),{timeout:240000});
  received.catch(()=>{});
  const inputReceived=page.waitForResponse(r=>r.url().includes(`/studies/${study.id}/input-preflight`),{timeout:90000});
  await button.click();
  const dialog=page.getByRole('dialog',{name:'运行前预检'});await dialog.waitFor();
  const inputResponse=await inputReceived,input=await inputResponse.json();
  assert(inputResponse.ok()&&input.input_ready,JSON.stringify(input));
  const response=await received,preflight=await response.json();
  await fs.writeFile(path.join(out,'native-preflight.json'),JSON.stringify({status:response.status(),seconds:(performance.now()-start)/1000,preflight},null,2));
  await page.screenshot({path:path.join(out,'native-preflight.png')});
  assert(response.ok() && preflight.ready,JSON.stringify(preflight));
  assert((await dialog.innerText()).includes('核时预算'));
  if(phase==='submit') {
   const runs=await (await fetch(back+`/api/workspaces/${study.workspace}/studies/${study.id}/runs?view=summary`)).json();
   assert(!(runs.items||runs).some(r=>['succeeded','partial','accepted','queued','running'].includes(r.status)),'Inspect existing run; never submit twice');
   const ack=dialog.getByRole('checkbox');if(await ack.count())await ack.check();
   const accepted=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith(`/studies/${study.id}/runs`));
   await dialog.getByRole('button',{name:'确认并运行',exact:true}).click();
   const response=await accepted,value=await response.json();assert(response.ok(),JSON.stringify(value));
   await fs.writeFile(path.join(out,'submitted.json'),JSON.stringify(value,null,2));
   await dialog.waitFor({state:'hidden',timeout:30000});await page.screenshot({path:path.join(out,'submitted.png')});
  }
 } else if(phase==='resume-convergence') {
  const workflow=await (await fetch(back+'/api/hpc/convergence/'+process.env.HPC_WORKFLOW)).json();
  assert.equal(workflow.status,'interrupted');
  await page.goto(front+`/studies/${workflow.study}/thermal-field/convergence?theme=light`);
  const button=page.getByRole('button',{name:'恢复原作业',exact:true});await button.waitFor({timeout:90000});
  const received=page.waitForResponse(r=>r.request().method()==='POST' && new URL(r.url()).pathname.endsWith('/resume'));
  await button.click();const response=await received,value=await response.json();assert(response.ok(),JSON.stringify(value));
  await fs.writeFile(path.join(out,'resumed-convergence.json'),JSON.stringify(value,null,2));
  await page.screenshot({path:path.join(out,'resumed-convergence.png')});
 } else if(phase==='cancel-convergence') {
  await page.goto(front+`/studies/${study.id}/thermal-field/convergence?theme=light`);
  const button=page.getByRole('button',{name:'停止后续级别',exact:true});await button.waitFor({timeout:90000});
  await button.click();await page.getByRole('button',{name:'用当前版本继续',exact:true}).waitFor({timeout:90000});
  await page.screenshot({path:path.join(out,'stopped-before-upgrade.png')});
 } else if(phase==='convergence' || phase==='rating') {
  const list=await (await fetch(back+`/api/hpc/convergence?workspace=${study.workspace}&study=${study.id}`)).json();
  const restart=process.env.HPC_RESTART_CONVERGENCE==='1';
  if(phase==='convergence')assert(restart?list.items.every(w=>['cancelled','blocked','failed','budget_exhausted'].includes(w.status)):!list.items.length,'Inspect the existing convergence; never start twice');
  else assert(list.items.some(w=>w.status==='completed'&&w.verdict?.status==='converged'&&!w.rating_run_id),'Only complete a verified temperature-only workflow');
  await page.goto(front+`/studies/${study.id}/thermal-field/convergence?theme=light`);
  await page.getByRole('button',{name:phase==='rating'?'完成载流量封存':restart?'用当前版本继续':'设置收敛预算',exact:true}).click({timeout:90000});
  const dialog=page.getByRole('dialog',{name:/收敛/});await dialog.waitFor();
  await dialog.getByRole('spinbutton').fill(process.env.HPC_CONVERGENCE_BUDGET || '28');
  const received=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/convergence'));
  await page.screenshot({path:path.join(out,'convergence-budget.png')});
  await dialog.getByRole('button',{name:'确认预算并开始',exact:true}).click();
  const response=await received,value=await response.json();assert(response.ok(),JSON.stringify(value));
  await fs.writeFile(path.join(out,phase==='rating'?'rating-start.json':'convergence-start.json'),JSON.stringify(value,null,2));
  await dialog.waitFor({state:'hidden'});await page.screenshot({path:path.join(out,'convergence-started.png')});
 } else if(phase==='comparison' || phase==='book') {
  const wf=await (await fetch(back+'/api/hpc/convergence/'+process.env.HPC_WORKFLOW)).json();
  assert(wf.status==='completed' && wf.verdict.status==='converged' && wf.rating_run_id,'Use the completed full-grid rating');
  const reference='0ef66a15-55a6-455f-9a89-a5193439890d';
  const chapterResponse=await fetch(back+`/api/hpc/workspaces/${study.workspace}/chapters/${wf.rating_run_id}?iec_run_id=${reference}&convergence_id=${wf.id}`);
  const chapter=await chapterResponse.json();assert(chapterResponse.ok,JSON.stringify(chapter));
  await fs.writeFile(path.join(out,'final-chapter.json'),JSON.stringify(chapter,null,2));
  if(phase==='comparison') {
   await page.goto(front+`/studies/${wf.study}/thermal-field/samples?theme=light&run=${wf.rating_run_id}`);
   const table=page.getByRole('table',{name:'有限元与IEC量值对照'});
   await table.waitFor({timeout:120000});await table.scrollIntoViewIfNeeded();
   const content=await table.innerText();
   for(const row of chapter.rows.filter(r=>r.key==='ampacity')) {
    assert(content.includes(row.fem.toFixed(2)) && content.includes(row.iec.toFixed(2)),content);
   }
   assert(!/\bcase-\d+\b/.test(content),content);
   await page.screenshot({path:path.join(out,'comparison.png')});
   await fs.writeFile(path.join(out,'comparison-visible.txt'),await page.locator('body').innerText());
  } else {
   await page.goto(front+`/studies/${wf.study}/report/preview?theme=light&run=${wf.rating_run_id}`);
   const picker=page.getByRole('combobox',{name:'IEC 对照运行',exact:true});
   await picker.waitFor({timeout:120000});await picker.click();
   await page.getByRole('option').filter({hasText:`第 ${chapter.iec.sequence} 次运行`}).click();
   const generate=page.getByRole('button',{name:'生成客户计算书',exact:true});
   for(let i=0;i<120 && !await generate.isEnabled();i++)await page.waitForTimeout(1000);
   assert(await generate.isEnabled(),'A current, converged saved chapter is required');
   await page.screenshot({path:path.join(out,'book-ready.png')});
   const received=page.waitForResponse(r=>r.request().method()==='POST' && new URL(r.url()).pathname.endsWith('/delivery-jobs'));
   const at=performance.now();await generate.click();const response=await received,job=await response.json();
   assert(response.ok(),JSON.stringify(job));
   assert(JSON.stringify(response.request().postDataJSON()).includes(reference));
   await page.getByRole('button',{name:'下载 PDF',exact:true}).waitFor({timeout:240000});
   const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载 PDF',exact:true}).click();
   await (await download).saveAs(path.join(out,'calculation-book.pdf'));
   await page.getByTitle('计算书预览').waitFor();await page.waitForTimeout(2000);
   await page.screenshot({path:path.join(out,'book-preview.png')});
   await fs.writeFile(path.join(out,'book-receipt.json'),JSON.stringify({job,workflow:wf.id,fem:wf.rating_run_id,iec:reference,generation_seconds:(performance.now()-at)/1000},null,2));
  }
 } else if(phase==='inspect') {
  const list=await (await fetch(back+`/api/hpc/convergence?workspace=${study.workspace}&study=${study.id}`)).json();
  const wf=process.env.HPC_WORKFLOW?await (await fetch(back+'/api/hpc/convergence/'+process.env.HPC_WORKFLOW)).json():list.items[0];const target=wf?.study||study.id,run=wf?.rows?.at(-1)?.run_id;
  const checks=[];
  for(const width of [1366,1920])for(const theme of ['light','dark'])for(const tab of ['field','convergence']) {
   await page.setViewportSize({width,height:width===1366?768:1080});
   await page.goto(front+`/studies/${target}/thermal-field/${tab}?theme=${theme}&view=field${run?'&run='+run:''}`);
   await page.locator('.study-field-slot .field-hotspot').waitFor({timeout:90000});
   // The result panel lazily paints its off-screen field. Inspect each actual
   // view after scrolling it into the engineer's visible area.
   for(const plot of await page.locator('.field-view').all()) {
    await plot.scrollIntoViewIfNeeded();await plot.locator('.field-colorbar').waitFor({timeout:90000});
   }
   if(tab==='convergence')await page.getByRole('table',{name:'自动收敛保存记录'}).waitFor({timeout:90000});
   await page.getByText('正在核验保存的网格与扩域证明',{exact:true}).waitFor({state:'hidden',timeout:90000});
   const body=await page.locator('body').innerText();assert(!/\bcase-\d+\b/.test(body));
   if(tab==='field') {
    const disclosure=page.locator('summary').filter({hasText:'建模假设：理想点接触 · 波纹等效热环'});
    await disclosure.waitFor();await disclosure.click();
    assert((await disclosure.locator('..').innerText()).includes('4.1.2.1'));
    await disclosure.click();
   }
   const layout=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,
    colorbars:[...document.querySelectorAll('.field-view')].filter(p=>p.querySelector('.field-overlay')).map(p=>p.querySelectorAll('.field-colorbar').length)}));
   assert(!layout.overflow&&layout.colorbars.every(n=>n===1),JSON.stringify(layout));
   checks.push({width,theme,tab,...layout});
   if(width===1366&&theme==='light')await page.screenshot({path:path.join(out,`result-${tab}.png`)});
  }
  await page.goto(front+'/studies/6bfdcf08-1912-4126-ab6d-e0e908dcf645/ampacity/results?theme=light');
  await page.getByRole('button',{name:'预检并运行',exact:true}).waitFor({timeout:90000});
  await page.waitForTimeout(2000);
  const unrelated=requests.filter(r=>r.url.includes('/studies/6bfdcf08-1912-4126-ab6d-e0e908dcf645/availability'));
  assert.equal(unrelated.length,0,'IEC mount must not ask for Slurm availability');
  await fs.writeFile(path.join(out,'layout-acceptance.json'),JSON.stringify({checks,iec_unrelated_availability_requests:unrelated},null,2));
 }
 assert.deepEqual(errors,[]);
} catch(error) {
 await fs.writeFile(path.join(out,'failure-visible.txt'),await page.locator('body').innerText());
 await page.screenshot({path:path.join(out,'failure.png')});throw error;
} finally {
 await fs.writeFile(path.join(out,`${phase}-use.json`),JSON.stringify({seconds:(performance.now()-start)/1000,errors,requests},null,2));
 await browser.close();console.log('Owned browser closed');
}
