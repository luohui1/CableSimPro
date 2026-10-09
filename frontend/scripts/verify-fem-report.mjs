import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect as baseExpect } from '@playwright/test';
import { openHeadlessBrowser, outputRoot } from './browser.mjs';
import { assertLayout } from './layout-assertions.mjs';

if(process.env.E2E_ISOLATED!=='1')throw Error('FEM report verification requires an isolated database');
const receipt=JSON.parse(await fs.readFile(process.env.FEM_RECEIPT,'utf8'));
const out=path.join(outputRoot,'fem-report');await fs.mkdir(out,{recursive:true});
const session=await openHeadlessBrowser(),{page}=session;
// External Edge/CDP does not own Playwright's temporary download directory.
// Capture the actual browser download in a task-owned directory instead.
const downloadDir=path.resolve(out,'downloads');
assert.ok(downloadDir.startsWith(path.resolve(out)+path.sep));
await fs.mkdir(downloadDir,{recursive:true});
const cdp=await session.browser.newBrowserCDPSession(),progress=new Map();
await cdp.send('Browser.setDownloadBehavior',{behavior:'allowAndName',downloadPath:downloadDir,eventsEnabled:true});
cdp.on('Browser.downloadProgress',event=>progress.set(event.guid,event.state));
const base=process.env.FRONTEND_URL,expect=baseExpect.configure({timeout:120000});
const report={errors:[],variants:[],writes:[]};
page.on('pageerror',error=>report.errors.push(error.message));
page.on('request',request=>{if(request.url().includes('/api/') && !['GET','HEAD','OPTIONS'].includes(request.method()))report.writes.push({path:new URL(request.url()).pathname,body:request.postDataJSON()});});
const wid=receipt.workspace,rid=receipt.latest_fem_run,sid=receipt.child_study;
const route=`/studies/${sid}/thermal-field/results?workspace=${wid}&run=${rid}&theme=light`;
let releaseProof;
async function variants(label,frames=true) {
  for(const size of [{width:1366,height:768},{width:1920,height:1080}])for(const theme of ['light','dark']) {
    await page.setViewportSize(size);await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
    await page.waitForTimeout(200);await assertLayout(page,label,{includeFrames:frames});report.variants.push({label,...size,theme});
  }
  await page.setViewportSize({width:1366,height:768});await page.evaluate(()=>document.documentElement.dataset.theme='light');
}
try {
  await page.setViewportSize({width:1366,height:768});
  const held=new Promise(resolve=>{releaseProof=resolve;});
  await page.route('**/fem-conclusion',async route=>{await held;await route.continue();});
  await page.goto(base+route);
  await expect(page.getByText('正在核验保存的网格与扩域证明',{exact:true})).toBeVisible();
  await variants('证明加载中');
  releaseProof();await page.unrouteAll({behavior:'wait'});
  const opened=Date.now();
  await expect(page.locator('.answer-bar')).toContainText('网格与扩域均 < 0.1 K');
  report.savedEvidenceMs=Date.now()-opened;
  await expect(page.locator('.answer-bar')).toContainText('359.6');
  await expect(page.locator('.answer-bar')).toContainText('108.4');
  await expect(page.locator('.answer-bar')).toContainText('−18.4');
  await expect(page.getByRole('table',{name:'有限元与 IEC 同输入对照'})).toContainText('362.24');
  await expect(page.getByRole('table',{name:'有限元与 IEC 同输入对照'})).toContainText('106.98');
  await variants('收敛结论与同输入对照');
  await page.screenshot({path:path.join(out,'conclusion.png')});
  report.summary=await page.evaluate(async({wid,rid})=>await(await fetch(`/api/workspaces/${wid}/runs/${rid}/fem-conclusion`)).json(),{wid,rid});
  assert.equal(report.summary.reference.iec_run_id,receipt.iecRun);
  assert.equal(report.summary.reference.convergence_id,receipt.convergence);
  await page.getByRole('tab',{name:'方法',exact:true}).click();
  await expect(page.locator('.workbench-inspector')).toContainText('Kennelly');
  await expect(page.locator('.workbench-inspector')).not.toContainText('kennelly_image');
  const generated=Date.now();
  await page.getByRole('toolbar',{name:'工程命令'}).getByRole('button',{name:'生成计算书',exact:true}).click();
  await expect(page.getByRole('button',{name:'下载 PDF',exact:true})).toBeEnabled();
  report.reportGenerationMs=Date.now()-generated;
  for(const audience of ['customer','internal']) {
    if(audience==='internal') {
      await page.getByRole('combobox',{name:'PDF 版本'}).click();await page.getByRole('option',{name:'内部审核版'}).click();
    }
    const pending=new Promise(resolve=>cdp.once('Browser.downloadWillBegin',resolve));
    await page.getByRole('button',{name:'下载 PDF',exact:true}).click();
    const {guid}=await pending;
    await expect.poll(()=>progress.get(guid)).toBe('completed');
    await fs.rename(path.join(downloadDir,guid),path.join(out,audience+'.pdf'));
  }
  await variants('有限元计算书预览',false);
  assert.ok(report.writes.some(r=>r.path.endsWith('/deliveries/current') && r.body.fem_chapter.convergence_id===receipt.convergence));
  assert.ok(!report.writes.some(r=>r.path.endsWith('/runs')),'No solver submission during result/report projection');
  await page.route('**/fem-conclusion',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'验收注入：保存证明暂不可用'})}));
  await page.goto(base+route);await expect(page.getByText('收敛证明不可用',{exact:true})).toBeVisible();await variants('证明读取错误');
  await page.unrouteAll();
  // An absent IEC reference is an empty state, never a fabricated comparison.
  await page.route('**/fem-conclusion',async route=>{
    const response=await route.fetch(),data=await response.json();
    assert.equal(response.status(),200);
    await route.fulfill({response,json:{...data,comparison:[],reference:null}});
  });
  await page.goto(base+route);
  await expect(page.getByText('尚无同输入的 IEC 保存运行，按同工况运行 IEC 后自动对照。',{exact:true})).toBeVisible();
  await variants('IEC 引用缺项（空状态注入）');await page.unrouteAll();
  const studies=await(await page.request.get(`${base}/api/workspaces/${wid}/studies`)).json();
  let oldStudy;
  for(const study of studies){
    const runs=await(await page.request.get(`${base}/api/workspaces/${wid}/studies/${study.id}/runs?view=summary&limit=100`)).json();
    if(runs.items.some(run=>run.id===receipt.old_fem_run)){oldStudy=study.id;break;}
  }
  assert.ok(oldStudy,'The historical run must be opened in its saved parent study');
  await page.goto(base+route.replace(sid,oldStudy).replace(rid,receipt.old_fem_run));
  await expect(page.locator('.answer-bar')).toContainText('未收敛');
  await expect(page.locator('.answer-bar .conclusion-metrics')).toHaveCount(0);await variants('未收敛与历史诊断');
  assert.deepEqual(report.errors,[]);
}catch(error){report.failure=error.stack;report.screen=await page.locator('body').innerText();await page.screenshot({path:path.join(out,'failure.png')});throw error;}
finally{releaseProof?.();await fs.writeFile(path.join(out,'acceptance.json'),JSON.stringify(report,null,2));await session.close();await fs.rm(downloadDir,{recursive:true,force:true});}
