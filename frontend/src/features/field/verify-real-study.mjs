/** Real release-copy acceptance: no intercepted API and no local native solver.
 * FRONTEND_URL / BACKEND_URL must name private services; HPC_REAL_EVIDENCE is a
 * durable receipt directory. Use preflight, submit, inspect in separate phases.
 * Submissions require a successful native check and a displayed budget <= 50 h.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {openHeadlessBrowser,settle,repositoryRoot} from '../../../scripts/browser.mjs';
const frontend=process.env.FRONTEND_URL, backend=process.env.BACKEND_URL;
for(const url of [frontend,backend]) assert(url && ['127.0.0.1','localhost'].includes(new URL(url).hostname) && new URL(url).port && !['8100','8200'].includes(new URL(url).port),'Private loopback services required');
const output=process.env.HPC_REAL_EVIDENCE || path.join(repositoryRoot,'.data/fix-round/simulation-use');
await fs.mkdir(output,{recursive:true});
async function api(url){const r=await fetch(backend+url);if(!r.ok)throw Error(`${r.status} ${url}: ${await r.text()}`);return r.json();}
const workspaces=await api('/api/workspaces');let studies=[];
for(const workspace of workspaces) studies.push(...await api(`/api/workspaces/${workspace.id}/studies`));
const study=studies.find(s=>s.definition.title.includes('排管段有限元温度场') && !s.definition.title.includes('自动收敛'));assert(study,'Release FEM study missing');
const phase=process.argv[2] || 'preflight';
const browser=await openHeadlessBrowser();const {page}=browser;
const failures=[];page.on('pageerror',e=>failures.push(e.message));
let preflight;
page.on('response',async r=>{if(new URL(r.url()).pathname.includes(`/studies/${study.id}/`) && new URL(r.url()).pathname.endsWith('/preflight')){
  try {preflight={status:r.status(),data:await r.json()};await fs.writeFile(path.join(output,'native-preflight.json'),JSON.stringify(preflight,null,2));}catch{}
}});
const started=performance.now();
try {
 await page.setViewportSize({width:1366,height:768});
 await page.goto(frontend+`/studies/${study.id}/thermal-field/field?theme=light`);await settle(page);
 if(phase==='imported') {
  // Read-only acceptance of the release's immutable dg83 evidence. No run,
  // report-generation or SSH request is sent in this phase.
  const workflows=(await api('/api/hpc/convergence')).items;
  const wf=workflows.find(w=>w.status==='completed' && w.verdict?.status==='converged' && w.rating_run_id);
  assert(wf,'The offline seed must import the completed convergence evidence');
  const finalStudy=studies.find(s=>s.id===wf.study);assert(finalStudy);
  const wid=wf.workspace,rid=wf.rating_run_id;
  const execution=(await api(`/api/hpc/jobs`)).items.find(job=>job.run_id===rid || job.id===rid)?.execution;
  const expectedJob=wf.run_executions?.[rid]?.job_id;assert(expectedJob);assert.equal(execution?.job_id,expectedJob);assert(execution?.saved_evidence);
  const references=studies.filter(s=>s.workspace===wid && s.definition.title==='排管段 · IEC 同工况对照');assert.equal(references.length,1);
  const chapter=await api(`/api/hpc/workspaces/${wid}/chapters/${rid}?iec_run_id=${references[0].latest_run_id}&convergence_id=${wf.id}`);
  assert.equal(chapter.convergence.verdict.status,'converged');assert.equal(chapter.execution.job_id,expectedJob);
  assert.equal(chapter.field.full_mesh_nodes,1836625);
  await fs.writeFile(path.join(output,'imported-chapter.json'),JSON.stringify(chapter,null,2));
  const writes=[];page.on('request',request=>{if(['POST','PUT','PATCH','DELETE'].includes(request.method()))writes.push(request.method()+' '+new URL(request.url()).pathname);});
  const checks=[];
  for(const width of [1366,1920])for(const theme of ['light','dark']) {
   await page.setViewportSize({width,height:width===1366?768:1080});
   for(const tab of ['field','convergence','results']) {
    const start=performance.now();
    await page.goto(frontend+`/studies/${wf.study}/thermal-field/${tab}?theme=${theme}&view=field&run=${rid}`);
    await page.locator('.study-field-slot .field-hotspot').waitFor({timeout:90000});
    const firstFieldSeconds=(performance.now()-start)/1000;
    await settle(page);
    if(tab==='field')await page.getByText('超算实算结果',{exact:true}).waitFor({timeout:90000});
    if(tab==='convergence')await page.getByRole('region',{name:'自动加密与扩域'}).getByText('已完成 · 达到门槛',{exact:true}).waitFor({timeout:90000});
    const body=await page.locator('body').innerText();
    if(tab==='field') {
     await page.getByRole('heading',{name:'本次计算输入',exact:true}).waitFor();
     assert(body.includes('超算实算结果'));assert(body.includes('超温'));assert(!body.includes('保存工件未提供温限判定'));
     assert(body.includes('18.4 K'));
     if(wf.current_grid_recheck)assert(body.includes('计算网格') && /0\.125(?:0+)? m/.test(body));
     else assert(body.includes('起始网格') && /0\.5(?:0+)? m/.test(body));
     assert(body.includes('400.0 A') && body.includes('25.0'));
    }
    if(tab==='convergence')assert(body.includes('达到门槛') && body.includes('0.1 K'));
    if(tab==='results') {await page.getByRole('table',{name:'有限元与 IEC 同输入对照'}).waitFor({timeout:60000});assert((await page.locator('body').innerText()).includes('362.24'));}
    const layout=await page.evaluate(()=>{
     const overlaps=[];let groundOverlap=false;
     const plots=[...document.querySelectorAll('.field-view')];
     for(const plot of plots) {
      if(plot.querySelectorAll('.field-colorbar').length!==1)throw Error('Each field must have one colorbar');
      const labels=[...plot.querySelectorAll('[data-field-label] rect')].map(n=>n.getBoundingClientRect());
      for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++){
       const a=labels[i],b=labels[j];if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>0 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>0)overlaps.push([i,j]);
      }
      const ground=plot.querySelector('.field-ground')?.getBoundingClientRect();
      if(ground)for(const a of labels)if(a.top<=ground.top+4 && a.bottom>=ground.top-4 && a.right>ground.left && a.left<ground.right)groundOverlap=true;
     }
     return {overlaps,groundOverlap,overflow:document.documentElement.scrollWidth>innerWidth,plots:plots.length};
    });
    assert(!layout.overlaps.length && !layout.groundOverlap && !layout.overflow,JSON.stringify(layout));
    checks.push({width,theme,tab,firstFieldSeconds,...layout});
    if(width===1366&&theme==='light'&&tab!=='results')await page.screenshot({path:path.join(output,`imported-${tab}.png`)});
    if(tab==='field') {
     const toggle=page.getByRole('button',{name:'适配全域',exact:true});assert(await toggle.isVisible());await toggle.click();
     await page.getByRole('button',{name:'对准电缆区域',exact:true}).click();
    }
   }
  }
  const deliveries=await api(`/api/workspaces/${wid}/deliveries`);
  const values=deliveries.items || deliveries;
  const bookRun=wf.current_grid_recheck?.source_run_id || rid;
  const bookStudy=workflows.find(value=>value.rating_run_id===bookRun)?.study;assert(bookStudy);
  const delivery=values.find(value=>(value.sources || []).some(source=>source.run_id===bookRun));assert(delivery,'The accepted PDF must be imported, not regenerated');
  await page.setViewportSize({width:1366,height:768});
  await page.goto(frontend+`/studies/${bookStudy}/report/preview?theme=light&run=${bookRun}&delivery=${delivery.id}`);
  await page.locator('iframe[title="计算书预览"][src^="blob:"]').waitFor({timeout:90000});
  await page.waitForTimeout(3000);
  await page.screenshot({path:path.join(output,'imported-book-preview.png')});
  const pdfResponse=await fetch(backend+`/api/workspaces/${wid}/deliveries/${delivery.id}/pdf`);assert(pdfResponse.ok);
  const pdf=Buffer.from(await pdfResponse.arrayBuffer());assert(pdf.subarray(0,5).equals(Buffer.from('%PDF-')));
  await fs.writeFile(path.join(output,'imported-calculation-book.pdf'),pdf);
  assert(writes.every(value=>value.startsWith('POST ') && value.endsWith('/sample')),'Read-only acceptance cannot modify saved data: '+writes.join(';'));
  await fs.writeFile(path.join(output,'imported-acceptance.json'),JSON.stringify({checks,writes,job:expectedJob,new_core_hours:0,execution,receipt:delivery,book_run:bookRun,book_kind:bookRun===rid?'accepted_original':'historical'},null,2));
 } else if(phase==='library') {
  const catalog=await api('/api/foundation/reproductions');assert.equal(catalog.items.length,63);
  const record=await api('/api/foundation/reproductions/B02-2');
  const checks=[];
  for(const width of [1366,1920])for(const theme of ['light','dark']) {
    await page.setViewportSize({width,height:width===1366?768:1080});
    for(const tab of ['results','scope']) {
      await page.goto(frontend+`/validation/B02-2/${tab}?theme=${theme}`);await settle(page);
      const scope=page.getByRole('region',{name:'适用范围与关键限制'});
      await page.getByRole('heading',{name:'保存对拍范围',exact:true}).waitFor();
      const summary=page.locator('.validation-scope');
      assert((await page.locator('.evidence-summary').innerText()).includes('公开算例 · 保存对拍'));
      assert((await summary.innerText()).includes(record.scope));
      assert((await summary.innerText()).includes(record.limitations.find(x=>x.includes('口径差异'))));
      if(tab==='scope')for(const value of record.limitations)assert((await page.locator('main').innerText()).includes(value));
      const layout=await summary.evaluate(element=>{
        const leaves=[...element.querySelectorAll('h2,h3,p,li,a')], visible=leaves.filter(n=>n.getBoundingClientRect().width>0);
        const rgb=color=>(color.match(/[\d.]+/g)||[]).slice(0,3).map(Number);
        const luminance=arr=>arr.map(c=>{c/=255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;}).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);
        const base=getComputedStyle(element).getPropertyValue('--panel').trim();
        const probe=document.createElement('span');probe.style.color=base;element.append(probe);
        const bg=luminance(rgb(getComputedStyle(probe).color));probe.remove();
        const boxes=visible.map(n=>n.getBoundingClientRect());
        const overlap=[];for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
          const a=boxes[i],b=boxes[j];if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)overlap.push([i,j]);
        }
        return {font:Math.min(...visible.map(n=>parseFloat(getComputedStyle(n).fontSize))),
          contrast:visible.map(n=>{const fg=luminance(rgb(getComputedStyle(n).color));return (Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05);}),overlap,
          overflow:document.documentElement.scrollWidth>innerWidth,
          primary:document.querySelectorAll('.button-primary:not([disabled]),.button-run:not([disabled])').length};
      });
      assert(layout.font>=13 && layout.contrast.every(c=>c>=4.5) && !layout.overflow && layout.primary<=1 && !layout.overlap.length,JSON.stringify(layout));
      checks.push({width,theme,tab,...layout});
      if(width===1366&&theme==='light'&&tab==='results')await page.screenshot({path:path.join(output,'validation.png')});
    }
    await page.goto(frontend+`/validation/B01/sources?theme=${theme}`);await settle(page);
    assert(!(await page.locator('main').innerText()).includes('PDF —'));
    assert((await page.locator('main').innerText()).includes('解析交叉核对'));
    await page.goto(frontend+`/validation/E17/results?theme=${theme}`);await settle(page);
    assert((await page.locator('main').innerText()).includes('文献方法参考'));
    if(catalog.history.length>1){await page.goto(frontend+`/validation/B02-2/results?theme=${theme}&snapshot=${catalog.history[1].id}`);await settle(page);
      await page.getByText('历史证据', {exact:true}).waitFor();}
    await page.goto(frontend+`/validation?theme=${theme}`);await settle(page);
    await page.getByPlaceholder('目标、来源或编号').fill('不存在的验证目标');
    await page.getByText('没有匹配的验证目标',{exact:true}).waitFor();
  }
  await fs.writeFile(path.join(output,'library-layout.json'),JSON.stringify(checks,null,2));
 } else if(phase==='book') {
  const list=await api(`/api/hpc/convergence?workspace=${study.workspace}&study=${study.id}`);
  const wf=list.items.find(w=>w.status==='completed' && w.verdict?.status==='converged' && w.rating_run_id);
  assert(wf,'A converged final rating is required; do not bypass the report gate');
  const reference=studies.find(s=>s.definition.title==='排管段 · IEC 同工况对照');assert(reference?.latest_run_id);
  const chapter=await api(`/api/hpc/workspaces/${study.workspace}/chapters/${wf.rating_run_id}?iec_run_id=${reference.latest_run_id}&convergence_id=${wf.id}`);
  assert.equal(chapter.convergence.verdict.status,'converged');
  await fs.writeFile(path.join(output,'final-chapter.json'),JSON.stringify(chapter,null,2));
  await page.goto(frontend+`/studies/${wf.study}/report/preview?theme=light&run=${wf.rating_run_id}`);
  const picker=page.getByRole('combobox',{name:'IEC 对照运行',exact:true});
  await picker.waitFor({timeout:120000});await picker.click();
  assert(Number.isInteger(chapter.iec.sequence),'The saved reference must expose its run sequence');
  const referenceOption=page.getByRole('option').filter({hasText:`第 ${chapter.iec.sequence} 次运行`});
  await referenceOption.click();
  const generate=page.getByRole('button',{name:'生成客户计算书',exact:true});
  for(let i=0;i<120 && !await generate.isEnabled();i++)await page.waitForTimeout(1000);
  assert(await generate.isEnabled(),'Report must use the converged chapter and current saved inputs');
  await page.screenshot({path:path.join(output,'book-ready.png')});
  const submitted=page.waitForResponse(r=>r.request().method()==='POST' && new URL(r.url()).pathname.endsWith('/delivery-jobs'));
  const generatedAt=performance.now();await generate.click();
  const response=await submitted;const job=await response.json();assert(response.ok(),JSON.stringify(job));
  assert(JSON.stringify(response.request().postDataJSON()).includes(reference.latest_run_id),'The report must cite the selected saved IEC run');
  await page.getByRole('button',{name:'下载 PDF',exact:true}).waitFor({timeout:240000});
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载 PDF',exact:true}).click();
  await (await download).saveAs(path.join(output,'calculation-book.pdf'));
  await page.getByTitle('计算书预览').waitFor();await page.waitForTimeout(2000);
  await page.screenshot({path:path.join(output,'book-preview.png')});
  await fs.writeFile(path.join(output,'book-visible.txt'),await page.locator('body').innerText());
  await fs.writeFile(path.join(output,'book-receipt.json'),JSON.stringify({job,workflow:wf.id,fem:wf.rating_run_id,iec:reference.latest_run_id,generation_seconds:(performance.now()-generatedAt)/1000},null,2));
 } else if(phase==='recover-collection') {
  const workflows=(await api(`/api/hpc/convergence?workspace=${study.workspace}&study=${study.id}`)).items;
  const before=workflows.find(w=>w.status==='failed' && w.current_execution?.state==='collecting' && w.current_execution.slurm_states?.length && w.current_execution.slurm_states.every(s=>s==='COMPLETED'));
  assert(before,'Only recover an existing completed allocation whose collection failed');
  await page.goto(frontend+`/studies/${study.id}/thermal-field/convergence?theme=light`);
  const recover=page.getByRole('button',{name:'回收原作业结果',exact:true});await recover.waitFor({timeout:60000});
  await page.screenshot({path:path.join(output,'collection-failed.png')});
  const resumed=page.waitForResponse(r=>r.request().method()==='POST' && r.url().endsWith('/resume'));
  await recover.click();const response=await resumed;assert(response.ok());
  const after=await response.json();assert.equal(after.current_run_id,before.current_run_id);
  assert.equal(after.current_execution.job_id,before.current_execution.job_id);
  await fs.writeFile(path.join(output,'collection-recovery.json'),JSON.stringify({workflow:before.id,run:after.current_run_id,job:after.current_execution.job_id,unchanged_submission:true},null,2));
 } else if(phase==='convergence-watch') {
  const latest=(await api(`/api/hpc/convergence?workspace=${study.workspace}&study=${study.id}`)).items[0];assert(latest?.id,'An existing convergence workflow is required');
  await page.goto(frontend+`/studies/${study.id}/thermal-field/convergence?theme=light`);
  await page.getByRole('table',{name:'自动收敛保存记录'}).waitFor({timeout:120000});
  await page.screenshot({path:path.join(output,'convergence-watch-running.png')});
  let previous='',wf,resumes=0,lastResume=0;
  for(let i=0;i<720;i++) {
    wf=await api(`/api/hpc/convergence/${latest.id}`);
    const state=JSON.stringify({status:wf.status,rows:wf.rows.length,job:wf.current_execution?.job_id,phase:wf.pending?.kind,execution:wf.current_execution?.state});
    if(state!==previous){console.log(state);previous=state;}
    if(!['queued','running','interrupted'].includes(wf.status))break;
    assert((wf.live_core_hours ?? wf.actual_core_hours)<=44,'Keep the confirmed convergence budget');
    if(wf.status==='interrupted' && wf.current_execution?.state==='disconnected' && performance.now()-lastResume>60000) {
      assert(resumes<3,'Repeated connection failure: preserve the original job for manual recovery');
      await page.screenshot({path:path.join(output,'connection-interrupted.png')});
      const response=page.waitForResponse(r=>r.request().method()==='POST' && r.url().endsWith('/resume'));
      await page.getByRole('button',{name:'恢复原作业',exact:true}).click();
      const r=await response,after=await r.json();assert(r.ok(),JSON.stringify(after));
      assert.equal(after.current_run_id,wf.current_run_id);assert.equal(after.current_execution.job_id,wf.current_execution.job_id);
      await fs.writeFile(path.join(output,'connection-recovery.json'),JSON.stringify({before:wf,after,unchanged_submission:true},null,2));
      resumes++;lastResume=performance.now();
    }
    await page.waitForTimeout(10000);
  }
  await fs.writeFile(path.join(output,'final-convergence.json'),JSON.stringify(wf,null,2));
  assert.equal(wf.status,'completed',JSON.stringify({status:wf.status,reason:wf.reason}));assert.equal(wf.verdict.status,'converged');assert(wf.rating_run_id);
  await page.waitForTimeout(4000);await page.screenshot({path:path.join(output,'convergence-watch-completed.png')});
 } else if(phase==='convergence-status') {
  await page.goto(frontend+`/studies/${study.id}/thermal-field/convergence?theme=light`);
  const panel=page.getByRole('region',{name:'自动加密与扩域'});
  await page.getByRole('table',{name:'自动收敛保存记录'}).waitFor({timeout:120000});
  const wf=(await api(`/api/hpc/convergence?workspace=${study.workspace}&study=${study.id}`)).items[0];assert(wf);
  const table=page.getByRole('table',{name:'自动收敛保存记录'});
  await table.scrollIntoViewIfNeeded();
  assert((await page.locator('body').innerText()).includes('0.1 K'));
  await page.screenshot({path:path.join(output,'convergence-live.png')});
  await fs.writeFile(path.join(output,'convergence-live-visible.txt'),await page.locator('body').innerText());
  await fs.writeFile(path.join(output,'convergence-state.json'),JSON.stringify(wf,null,2));
 } else if(phase==='comparison') {
  await page.goto(frontend+`/studies/${study.id}/thermal-field/samples?theme=light`);
  const section=page.getByRole('region',{name:'有限元与IEC保存运行对照'});
  const picker=page.getByRole('combobox',{name:'IEC 参考运行'});
  await picker.waitFor({timeout:60000});await picker.click();
  await page.getByRole('option',{name:/IEC 同工况对照/}).click();
  await page.getByRole('table',{name:'有限元与IEC量值对照'}).waitFor({timeout:120000});
  const table=await page.getByRole('table',{name:'有限元与IEC量值对照'}).innerText();
  assert(table.includes('359.66') && table.includes('362.24'),table);
  await page.getByRole('table',{name:'有限元与IEC量值对照'}).scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(output,'comparison.png')});
  await fs.writeFile(path.join(output,'comparison-visible.txt'),await page.locator('body').innerText());
 } else if(phase==='iec-run') {
  const reference=studies.find(s=>s.definition.title==='排管段 · IEC 同工况对照');assert(reference);
  await page.goto(frontend+`/studies/${reference.id}/ampacity/results?theme=light&inspector=method`);
  await page.getByRole('combobox',{name:'额定模式',exact:true}).waitFor({timeout:60000});
  await page.getByRole('combobox',{name:'额定模式',exact:true}).click();
  await page.getByRole('option',{name:'共同电流',exact:true}).click();
  await page.keyboard.press('Control+s');
  await page.getByRole('button',{name:'已保存',exact:true}).waitFor({timeout:30000});
  const saved=await api(`/api/workspaces/${study.workspace}/studies/${reference.id}`);
  assert.equal(saved.definition.parameters.rating_mode,'simultaneous');
  const clean=p=>Object.fromEntries(Object.entries(p).filter(([k])=>k!=='operation'));
  assert.deepEqual(clean(saved.definition.parameters),clean(study.definition.parameters.iec));
  const runs=await api(`/api/workspaces/${study.workspace}/studies/${reference.id}/runs`);
  assert(!(runs.items || runs).some(r=>['succeeded','accepted','queued','running','partial'].includes(r.status)),'Do not duplicate an IEC run');
  await page.getByRole('button',{name:'预检并运行',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'运行前预检'});
  const confirm=dialog.getByRole('button',{name:'确认并运行',exact:true});
  await confirm.waitFor();for(let i=0;i<60 && !await confirm.isEnabled();i++)await page.waitForTimeout(1000);
  assert(await confirm.isEnabled());
  await page.screenshot({path:path.join(output,'iec-preflight.png')});
  await confirm.click();await dialog.waitFor({state:'hidden',timeout:60000});
  const current=await api(`/api/workspaces/${study.workspace}/studies/${reference.id}`);
  await fs.writeFile(path.join(output,'iec-receipt.json'),JSON.stringify({study:reference.id,workspace:study.workspace,run:current.latest_run_id,parameters:saved.definition.parameters},null,2));
  await page.waitForTimeout(1000);await page.screenshot({path:path.join(output,'iec-results.png')});
 } else if(phase==='iec') {
  assert(!studies.some(s=>s.definition.title==='排管段 · IEC 同工况对照'),'Inspect the saved IEC study rather than creating another');
  await page.getByRole('button',{name:'预检并运行',exact:true}).waitFor({timeout:60000});
  await page.getByRole('button',{name:'新建研究',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'新建研究'});
  await dialog.getByLabel('研究名称').fill('排管段 · IEC 同工况对照');
  await dialog.getByRole('combobox',{name:'方法参数来源'}).click();
  await page.getByRole('option',{name:/沿用最近研究/}).click();
  await page.screenshot({path:path.join(output,'iec-create.png')});
  await dialog.getByRole('button',{name:'建立研究',exact:true}).click();
  await dialog.waitFor({state:'hidden',timeout:60000});
  await page.waitForTimeout(3000);
  await fs.writeFile(path.join(output,'iec-method-visible.txt'),await page.locator('body').innerText());
  await page.screenshot({path:path.join(output,'iec-method.png')});
  console.log('IEC study URL',page.url());
 } else if(phase==='library-reconnect') {
  await page.goto(frontend+'/validation?theme=light');
  const row=page.getByRole('row').filter({hasText:'TB 880 算例 0-1'});
  await row.waitFor({timeout:60000});
  await browser.context.setOffline(true);
  await row.click();
  await page.waitForTimeout(8000);
  const offline=await page.locator('body').innerText();assert(offline.includes('读取失败') && offline.includes('网络连接已断开'),offline);
  await fs.writeFile(path.join(output,'library-offline-visible.txt'),offline);
  await page.screenshot({path:path.join(output,'library-offline.png')});
  await browser.context.setOffline(false);
  const retry=page.getByRole('button',{name:/重试|重新读取/});if(await retry.count())await retry.first().click();
  await page.getByRole('heading',{name:'保存对拍范围',exact:true}).waitFor({timeout:60000});
  await fs.writeFile(path.join(output,'library-reconnection.json'),JSON.stringify({fault:'Browser offline: connectivity fault only; no numerical API was replaced',recovered:true},null,2));
 } else if(phase==='module-entry') {
  const checks=[];
  for(const module of ['transient','electrothermal']) {
   await page.goto(frontend+`/studies/${study.id}/${module}/results?theme=light`);
   await page.getByText('尚未配置该模块',{exact:true}).waitFor({timeout:60000});
   await page.getByRole('link',{name:'配置方法与参数',exact:true}).click();
   await page.waitForTimeout(1500);
   const value=await page.locator('body').innerText();
   checks.push({module,url:page.url(),editor_missing:value.includes('当前研究没有该模块的方法配置')});
   if(module==='transient')await page.screenshot({path:path.join(output,'module-configuration-entry.png')});
  }
  await fs.writeFile(path.join(output,'module-configuration-entry.json'),JSON.stringify(checks,null,2));
 } else if(phase==='modules') {
  for(const module of ['transient','electrothermal'])for(const width of [1366,1920])for(const theme of ['light','dark']) {
    await page.setViewportSize({width,height:width===1366?768:1080});
    await page.goto(frontend+`/studies/${study.id}/${module}/results?theme=${theme}`);await settle(page);
    await page.getByText('尚未配置该模块',{exact:true}).waitFor();
    assert.equal(await page.getByText('读取计算位置',{exact:true}).count(),0);
    const link=page.getByRole('link',{name:'配置方法与参数'});assert(await link.isVisible());
    assert((await link.getAttribute('href')).includes('inspector=method'));
    if(width===1366&&theme==='light'&&module==='transient')await page.screenshot({path:path.join(output,'module-unconfigured.png')});
  }
 } else if(phase==='mesh-adjust') {
  const workflows=(await api(`/api/hpc/convergence?workspace=${study.workspace}&study=${study.id}`)).items;
  assert(workflows.every(w=>!['queued','running','interrupted'].includes(w.status)),'Finish the existing workflow first');
  assert(workflows.some(w=>w.status==='blocked' && w.blocked_phases.includes('domain')),'Only change the display-independent mesh after an actual capacity rejection');
  const before=await api(`/api/workspaces/${study.workspace}/studies/${study.id}`);
  const parameters=structuredClone(before.definition.modules['thermal-field']?.parameters ?? before.definition.parameters);
  assert.equal(parameters.mesh.far_size_m,.125);
  await page.goto(frontend+`/studies/${study.id}/thermal-field/results?theme=light&inspector=method`);
  const field=page.locator('[data-field-path="/mesh/far_size_m"] input');await field.waitFor({timeout:60000});
  await field.fill('500');await page.keyboard.press('Control+s');
  await page.getByRole('button',{name:'已保存',exact:true}).waitFor({timeout:30000});
  const after=await api(`/api/workspaces/${study.workspace}/studies/${study.id}`);
  const saved=after.definition.modules['thermal-field']?.parameters ?? after.definition.parameters;
  parameters.mesh.far_size_m=.5;assert.deepEqual(saved,parameters,'Only the far-field mesh starting size may change; all physical inputs remain frozen');
  await fs.writeFile(path.join(output,'mesh-adjustment.json'),JSON.stringify({before:before.revision,after:after.revision,change:{field:'mesh.far_size_m',from_m:.125,to_m:.5},physical_parameters_unchanged:true},null,2));
  await page.screenshot({path:path.join(output,'mesh-adjustment.png')});
 } else if(phase==='preflight' || phase==='submit' || phase==='submit-adjusted') {
  await page.getByRole('button',{name:'预检并运行',exact:true}).waitFor({timeout:60000});
  const runs=await api(`/api/workspaces/${study.workspace}/studies/${study.id}/runs`);
  const submit=phase==='submit'||phase==='submit-adjusted';
  if(phase==='submit-adjusted') {
    assert.equal(await fs.access(path.join(output,'adjusted-run-receipt.json')).then(()=>true,()=>false),false,'The adjusted run has already been submitted; inspect its saved receipt');
    assert.equal(study.definition.modules['thermal-field']?.parameters.mesh.far_size_m ?? study.definition.parameters.mesh.far_size_m,.5);
    assert(!(runs.items||runs).some(r=>['accepted','queued','running','validating'].includes(r.status)),'Do not duplicate active work');
    assert(!(runs.items||runs).some(r=>['succeeded','partial'].includes(r.status) && r.freshness?.status==='current'),'Do not repeat a current saved run');
  }
  if(phase==='submit' && (runs.items || runs).some(r=>['accepted','queued','running','validating','succeeded','partial'].includes(r.status)))
    throw Error('An existing saved/active FEM run exists: inspect it; do not submit again.');
  await page.getByRole('button',{name:'预检并运行',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'运行前预检'});
  await dialog.waitFor();await page.screenshot({path:path.join(output,'preflight-running.png')});
  const confirm=dialog.getByRole('button',{name:'确认并运行',exact:true});
  for(let i=0;i<90;i++) {
    if(preflight || await confirm.isEnabled())break;
    if(i%3===0)console.log('Native preflight elapsed',Math.round((performance.now()-started)/1000));
    await page.waitForTimeout(10000);
  }
  await page.screenshot({path:path.join(output,'preflight.png')});
  await fs.writeFile(path.join(output,'preflight-visible.txt'),await dialog.innerText());
  assert(preflight?.status===200,`Native preflight did not pass: ${JSON.stringify(preflight)}`);
  assert.equal(preflight.data.ready,true,JSON.stringify(preflight.data));
  if(submit) {
    const budget=preflight.data.cases.map(c=>c.evidence?.execution_budget).find(Boolean);
    assert(budget && budget.upper_core_hours<=50,'Displayed allocation must fit 50 core hours');
    const checkbox=dialog.getByRole('checkbox');await checkbox.check();
    await confirm.click();
    await dialog.waitFor({state:'hidden',timeout:180000});
    const current=await api(`/api/workspaces/${study.workspace}/studies/${study.id}`);
    const runId=current.latest_module_run_ids?.['thermal-field'] || current.latest_run_id;
    assert(runId,'Submission did not persist a run');
    await fs.writeFile(path.join(output,phase==='submit-adjusted'?'adjusted-run-receipt.json':'run-receipt.json'),JSON.stringify({study:study.id,workspace:study.workspace,run:runId,budget,submitted_at:new Date().toISOString()},null,2));
    await page.screenshot({path:path.join(output,'submitted.png')});
  }
 } else if(phase==='convergence' || phase==='convergence-adjusted') {
  const existing=await api(`/api/hpc/convergence?workspace=${study.workspace}&study=${study.id}`);
  if(phase==='convergence')assert.equal(existing.items.length,0,'Existing convergence must be inspected rather than resubmitted');
  else {assert(existing.items.every(w=>!['queued','running','interrupted'].includes(w.status)));assert(!existing.items.some(w=>w.source_run_id===study.latest_module_run_ids?.['thermal-field']));}
  await page.goto(frontend+`/studies/${study.id}/thermal-field/convergence?theme=light`);await settle(page);
  await page.getByRole('button',{name:'设置收敛预算',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'确认收敛研究预算'});
  await dialog.getByLabel('累计核时预算').fill(phase==='convergence-adjusted'?'44':'48');
  await page.screenshot({path:path.join(output,'convergence-budget.png')});
  const submitted=page.waitForResponse(r=>r.request().method()==='POST' && new URL(r.url()).pathname.endsWith('/convergence'));
  await dialog.getByRole('button',{name:'确认预算并开始',exact:true}).click();
  const response=await submitted;const value=await response.json();assert(response.ok(),JSON.stringify(value));
  await fs.writeFile(path.join(output,'convergence-receipt.json'),JSON.stringify(value,null,2));
  await dialog.waitFor({state:'hidden'});
  await page.screenshot({path:path.join(output,'convergence-started.png')});
 } else if(phase==='adjusted-progress') {
  const receipt=JSON.parse(await fs.readFile(path.join(output,'adjusted-run-receipt.json'),'utf8'));
  await page.getByRole('button',{name:'运行记录',exact:true}).click();await settle(page);
  await page.screenshot({path:path.join(output,'adjusted-progress.png')});
  let row;
  for(let i=0;i<180;i++) {
    row=(await api('/api/hpc/jobs')).items.find(r=>r.run_id===receipt.run);assert(row,'Saved allocation must stay visible');
    if(['succeeded','partial','failed','interrupted'].includes(row.status))break;
    if(i%3===0)console.log(JSON.stringify({job:row.job_id,status:row.status,used_core_hours:row.used_core_hours}));
    await page.waitForTimeout(10000);
  }
  assert.equal(row.status,'succeeded',JSON.stringify(row));
  await fs.writeFile(path.join(output,'adjusted-completed-job.json'),JSON.stringify(row,null,2));
  await page.screenshot({path:path.join(output,'adjusted-completed.png')});
 } else if(phase==='capacity-message') {
  const blocked=(await api(`/api/hpc/convergence?workspace=${study.workspace}&study=${study.id}`)).items.find(w=>w.status==='blocked' && w.blocked_phases?.includes('domain'));
  assert(blocked,'Inspect the actual saved capacity rejection');
  await page.goto(frontend+`/studies/${blocked.study}/thermal-field/convergence?theme=light`);
  await page.getByText(/请增大起始网格尺寸并重新验证/).waitFor({timeout:120000});
  assert(!(await page.locator('body').innerText()).includes('需提高可保存网格容量'));
  await page.screenshot({path:path.join(output,'capacity-guidance.png')});
 } else if(phase==='final-inspect') {
  const wf=(await api(`/api/hpc/convergence?workspace=${study.workspace}&study=${study.id}`)).items.find(w=>w.status==='completed' && w.rating_run_id);
  assert(wf && wf.verdict.status==='converged');
  const checks=[];
  for(const width of [1366,1920])for(const tab of ['field','diagnostics','convergence','results']) {
    await page.setViewportSize({width,height:width===1366?768:1080});
    await page.goto(frontend+`/studies/${wf.study}/thermal-field/${tab}?theme=light&run=${wf.rating_run_id}`);
    await page.getByRole('button',{name:'预检并运行',exact:true}).waitFor({timeout:120000});
    for(let i=0;i<120;i++) {if(!/正在读取研究模块|正在读取运行记录|读取保存场图|核验保存的网格|读取逐级收敛|正在核对保存结果/.test(await page.locator('body').innerText()))break;await page.waitForTimeout(1000);}
    if(tab==='field') {await page.locator('.field-view').first().waitFor({timeout:120000});for(const view of await page.locator('.field-view').all()){await view.locator('.field-colorbar').waitFor();assert.equal(await view.locator('.field-colorbar').count(),1);}}
    if(tab==='convergence') {
      const levels=page.getByRole('table',{name:'自动收敛保存记录'});await levels.waitFor({timeout:120000});
      await levels.scrollIntoViewIfNeeded();
    }
    if(tab==='results') {
      const table=page.getByRole('table',{name:'有限元与 IEC 同输入对照'});await table.waitFor({timeout:120000});
      assert((await table.innerText()).includes('362.24'),'The real same-input IEC rating must be present');
      await table.scrollIntoViewIfNeeded();
    }
    const layout=await page.evaluate(()=>({width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth}));
    assert(!layout.overflow,JSON.stringify({tab,...layout}));checks.push({tab,...layout});
    if(width===1366) {
      await page.screenshot({path:path.join(output,'final-'+tab+'.png')});
      await fs.writeFile(path.join(output,'final-'+tab+'-visible.txt'),await page.locator('body').innerText());
    }
  }
  await fs.writeFile(path.join(output,'final-layout.json'),JSON.stringify(checks,null,2));
 } else if(phase==='progress') {
  await page.getByRole('button',{name:'运行记录',exact:true}).click();await settle(page);
  await page.screenshot({path:path.join(output,'progress.png')});
  await fs.writeFile(path.join(output,'progress-visible.txt'),await page.locator('body').innerText());
 } else {
  for(const tab of ['field','diagnostics','convergence','samples','results']) {
    await page.goto(frontend+`/studies/${study.id}/thermal-field/${tab}?theme=light`);await settle(page);
    await page.getByRole('button',{name:'预检并运行',exact:true}).waitFor({timeout:120000});
    for(let i=0;i<120;i++) {const value=await page.locator('body').innerText();if(!/正在读取研究模块|读取研究工作区|正在读取运行记录|读取保存场图|核验保存的网格|读取逐级收敛|正在核对保存结果/.test(value))break;await page.waitForTimeout(1000);}
    await page.screenshot({path:path.join(output,tab+'.png')});
    await fs.writeFile(path.join(output,tab+'-visible.txt'),await page.locator('body').innerText());
  }
 }
 const receipt={phase,finished_at:new Date().toISOString(),elapsed_seconds:(performance.now()-started)/1000,page_errors:failures};
 assert.equal(failures.length,0,JSON.stringify(failures));
 await fs.writeFile(path.join(output,phase+'-timing.json'),JSON.stringify(receipt,null,2));
 console.log(JSON.stringify(receipt));
} catch(error) {
 await page.screenshot({path:path.join(output,'blocked-'+phase+'.png')}).catch(()=>{});
 await fs.writeFile(path.join(output,'blocked-'+phase+'.txt'),await page.locator('body').innerText()).catch(()=>{});
 throw error;
} finally {await browser.close();}
