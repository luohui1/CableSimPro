/** Real release-copy admission audit. No fixture, solver or curve substitution.
 * An incomplete source stops here; a successful audit is not transient acceptance.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {openHeadlessBrowser,settle,repositoryRoot} from '../../../scripts/browser.mjs';
const backend=process.env.BACKEND_URL,frontend=process.env.FRONTEND_URL;
for(const url of [backend,frontend])assert(url && ['127.0.0.1','localhost'].includes(new URL(url).hostname) && !['8100','8200'].includes(new URL(url).port));
const output=process.env.HPC_REAL_EVIDENCE || path.join(repositoryRoot,'.data/fix-round/simulation-transient/supported-study');
await fs.mkdir(output,{recursive:true});
const identity=JSON.parse(await fs.readFile(path.join(output,'release-inventory.json'),'utf8'));
const source=identity.find(row=>row.title.includes('110 kV') && row.runs.length);
assert(source,'The real release-copy citysouth study must exist.');
const runId=source.runs[0].id;
async function read(url){const r=await fetch(backend+url);if(!r.ok)throw Error(await r.text());return r.json();}
const started=performance.now();
const saved=await read(`/api/workspaces/${source.workspace}/studies/${source.id}/runs/${runId}?view=full`);
assert(saved.integrity==='verified' && saved.output_digest===source.runs[0].output_sha256);
const check=await read(`/api/hpc/workspaces/${source.workspace}/studies/${source.id}/step-responses/source-check?source_run_id=${runId}`);
assert(check.status==='unsupported' && check.solver_submitted===false);
assert(check.reason.includes('标准方法结果') && !check.next_step.includes('三芯排管'),'A single-circuit standard source must not be called a duct FEM result.');
const input=saved.snapshot.cases[0].input;
assert.equal(input.circuits.length,1);assert.equal(input.circuits[0].cables.length,3);
const browser=await openHeadlessBrowser(),page=browser.page,errors=[],writes=[],steps=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{if(['POST','PUT','PATCH','DELETE'].includes(r.method()))writes.push(r.method()+' '+new URL(r.url()).pathname);});
try {
 for(const width of [1366,1920])for(const theme of ['light','dark']) {
  await page.setViewportSize({width,height:width===1366?768:1080});
  const at=performance.now();
  await page.goto(frontend+`/studies/${source.id}/transient/history?theme=${theme}`);
  await page.getByRole('heading',{name:'尚无保存工件',exact:true}).waitFor({timeout:60000});
  const configurationEntry=await page.getByRole('link',{name:'配置方法与参数',exact:true}).count();
  // Record the actual integration gap instead of treating an empty plot as a result.
  const historyText=await page.locator('body').innerText();
  if(width===1366 && theme==='light') {
   await page.screenshot({path:path.join(output,'history-entry.png')});
   await fs.writeFile(path.join(output,'history-visible.txt'),historyText);
  }
  await page.goto(frontend+`/studies/${source.id}/transient/parameters?theme=${theme}&inspector=method`);await settle(page);
  await page.getByRole('button',{name:'为该模块建立方法配置',exact:true}).waitFor({timeout:60000});
  const layout=await page.locator('.parameter-form').evaluate(el=>({overflow:document.documentElement.scrollWidth>innerWidth,font:Math.min(...[...el.querySelectorAll('p,button,label')].map(n=>parseFloat(getComputedStyle(n).fontSize)))}));
  assert(!layout.overflow && layout.font>=13);
  steps.push({width,theme,wall_seconds:(performance.now()-at)/1000,history_configuration_entry_present:!!configurationEntry,method_configuration_entry_present:true,...layout});
  if(width===1366 && theme==='light') {
   await page.screenshot({path:path.join(output,'method-preparation.png')});
   await fs.writeFile(path.join(output,'method-visible.txt'),await page.locator('body').innerText());
  }
 }
 assert.equal(errors.length,0,errors.join('\n'));assert.equal(writes.length,0,writes.join('\n'));
 const after=await read(`/api/workspaces/${source.workspace}/studies/${source.id}/runs/${runId}?view=full`);
 assert.equal(after.output_digest,saved.output_digest);
 await fs.writeFile(path.join(output,'browser-admission.json'),JSON.stringify({status:'blocked_before_native_preflight',source_check:check,steps,errors,writes,total_wall_seconds:(performance.now()-started)/1000,new_core_hours:0,source_unchanged:true},null,2));
 console.log('真实来源与界面检查完成；暂态验收仍受阻，新增核时 0。');
}catch(e){await page.screenshot({path:path.join(output,'browser-blocked.png')});throw e;}
finally{await browser.close();}
