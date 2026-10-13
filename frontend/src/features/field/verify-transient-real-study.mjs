/** Real release-copy check. Never replaces a duct curve with a validation model.
 * The only Slurm action is the explicitly requested steady native preflight;
 * the unsupported transient stops locally. No transient solver or run is sent.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {openHeadlessBrowser,settle,repositoryRoot} from '../../../scripts/browser.mjs';
const backend=process.env.BACKEND_URL,frontend=process.env.FRONTEND_URL;
for(const url of [backend,frontend])assert(url && ['127.0.0.1','localhost'].includes(new URL(url).hostname) && !['8100','8200'].includes(new URL(url).port));
const output=process.env.HPC_REAL_EVIDENCE || path.join(repositoryRoot,'.data/fix-round/simulation-transient');
await fs.mkdir(output,{recursive:true});
const wid='da924def-cbfe-4f1b-8378-8ea05f472359',sid='752abaea-d1c5-496c-bf7b-647713c69f52',finalStudy='652df961-2589-4a94-bc75-a88c02d29c84',rid='cdf461c4-875a-425d-a2c8-20513669aaa8';
const phase=process.argv[2] || 'inspect',browser=await openHeadlessBrowser();
async function api(url){const response=await fetch(backend+url);if(!response.ok)throw Error(await response.text());return response.json();}
const errors=[],writes=[];browser.page.on('pageerror',error=>errors.push(error.message));
browser.page.on('request',r=>{if(['POST','PUT','PATCH','DELETE'].includes(r.method()))writes.push(r.method()+' '+new URL(r.url()).pathname);});
try {
 const page=browser.page;await page.setViewportSize({width:1366,height:768});
 if(phase==='preflight') {
  const start=performance.now();let receipt;
  await page.goto(frontend+`/studies/${sid}/thermal-field/field?theme=light`);await settle(page);
  const received=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/workspaces/${wid}/studies/${sid}/preflight`,{timeout:240000});
  await page.getByRole('button',{name:'预检并运行',exact:true}).click();
  const nativeResponse=await received;const nativeText=await nativeResponse.text();let value;
  try{value=JSON.parse(nativeText);}catch{value={message:'宿主返回了非结构化错误',body:nativeText};}
  receipt={status:nativeResponse.status(),value};
  await fs.writeFile(path.join(output,'native-preflight.json'),JSON.stringify({...receipt,wall_seconds:(performance.now()-start)/1000},null,2));
  if(receipt.status!==200 || !receipt.value.ready)throw Error('预检未通过：'+JSON.stringify(receipt.value));
  await page.getByText('已通过超算原生预检',{exact:false}).waitFor({timeout:15000});
  assert(receipt?.status===200 && receipt.value.ready);
  const execution=receipt.value.cases[0].evidence.preflight_execution;
  assert(execution?.job_id && execution.actual_cpu_seconds>=0);
  assert(execution.actual_cpu_seconds/3600<=30);
  await page.screenshot({path:path.join(output,'native-preflight.png')});
  await fs.writeFile(path.join(output,'native-preflight.json'),JSON.stringify({...receipt,wall_seconds:(performance.now()-start)/1000,new_core_hours:execution.actual_cpu_seconds/3600},null,2));
  // Do not click Submit: the requested transient model is outside scope.
 }else{
  const checks=[];
  for(const width of [1366,1920])for(const theme of ['light','dark']) {
   await page.setViewportSize({width,height:width===1366?768:1080});
   const start=performance.now();
   await page.goto(frontend+`/studies/${finalStudy}/thermal-field/field?theme=${theme}&view=field&run=${rid}`);
   await page.getByRole('tab',{name:'阶跃热响应',exact:true}).waitFor({timeout:90000});
   await page.getByRole('tab',{name:'阶跃热响应',exact:true}).click();
   const section=page.getByRole('region',{name:'阶跃热响应',exact:true});
   await section.getByText('该工况的阶跃响应尚未覆盖',{exact:true}).waitFor({timeout:60000});
   await section.scrollIntoViewIfNeeded();
   assert.equal(await section.getByRole('button',{name:'预检响应与预算'}).count(),0);
   assert.equal(await section.getByRole('button',{name:'提交 dg83'}).count(),0);
   assert((await section.innerText()).includes('三芯排管与多回路'));
   assert(!(await section.innerText()).includes('曲线仍按其保存输入显示'),'No curve exists for this saved duct case.');
   const layout=await section.evaluate(el=>({overflow:document.documentElement.scrollWidth>innerWidth,font:Math.min(...[...el.querySelectorAll('h3,p')].map(node=>parseFloat(getComputedStyle(node).fontSize)))}));
   assert(!layout.overflow && layout.font>=13);
   checks.push({width,theme,wall_seconds:(performance.now()-start)/1000,...layout});
   if(width===1366 && theme==='light')await page.screenshot({path:path.join(output,'unsupported-transient.png')});
   await page.goto(frontend+`/runs?theme=${theme}`);await settle(page);
   const table=page.getByRole('table',{name:'所有研究超算作业'});await table.waitFor({timeout:30000});
   const values=(await api('/api/hpc/jobs')).items;
   const job=values.find(row=>row.kind==='preflight' && row.study_id===sid) || values.find(row=>row.run_id===rid);
   assert(job?.study_href===`/studies/${job.study_id}`);
   const row=table.getByRole('row').filter({hasText:job.execution.job_id});assert.equal(await row.count(),1);
   assert((await row.getByRole('link',{name:job.study_name,exact:true}).getAttribute('href'))===job.study_href);
   await row.getByRole('button',{name:'作业详情'}).click();
   const dialog=page.getByRole('dialog',{name:'超算作业详情'});await dialog.getByText('所属研究',{exact:true}).waitFor();
   assert((await dialog.getByRole('link',{name:job.study_name,exact:true}).getAttribute('href'))===job.study_href);
   if(width===1366 && theme==='light')await page.screenshot({path:path.join(output,'job-study-binding.png')});
   await dialog.getByRole('link',{name:job.study_name,exact:true}).click();
   await page.waitForURL('**/studies/'+job.study_id+'/**');
  }
  assert.equal(errors.length,0,errors.join('\n'));
  assert(writes.every(row=>row.endsWith('/sample')),'No solver, transient run or report may be submitted outside its scope: '+writes.join(';'));
  const sourceCheck=await api(`/api/hpc/workspaces/${wid}/studies/${finalStudy}/step-responses/source-check?source_run_id=${rid}`);
  assert(sourceCheck.status==='unsupported' && sourceCheck.solver_submitted===false);
  await fs.writeFile(path.join(output,'acceptance.json'),JSON.stringify({checks,errors,writes,sourceCheck,transient_core_hours:0,transient_result:'not_covered'},null,2));
 }
}catch(error){await browser.page.screenshot({path:path.join(output,'blocked-'+phase+'.png')});await fs.writeFile(path.join(output,'blocked-'+phase+'.txt'),String(error)+'\n'+await browser.page.locator('body').innerText());throw error;}
finally{await browser.close();}
