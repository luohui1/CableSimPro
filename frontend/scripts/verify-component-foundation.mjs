import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { expect as baseExpect } from '@playwright/test';
import { openHeadlessBrowser, settle, outputRoot } from './browser.mjs';
import { request } from './research-fixtures.mjs';
import { assertLayout } from './layout-assertions.mjs';
if(process.env.E2E_ISOLATED!=='1')throw Error('Only run against an isolated database');
const base=process.env.FRONTEND_URL, expect=baseExpect.configure({timeout:30000});
const session=await openHeadlessBrowser(),{page,context}=session;
page.setDefaultTimeout(30000);
const out=path.join(outputRoot,'round2'), report={checks:[],variants:[],errors:[],writes:[],initialJavaScript:[]};
await fs.mkdir(out,{recursive:true});
page.on('pageerror',e=>report.errors.push(e.message));
page.on('request',r=>{if(['PUT','PATCH','POST'].includes(r.method()))report.writes.push({url:r.url(),method:r.method(),body:r.postDataJSON()});});
async function go(route){await page.goto('about:blank');await page.goto(base+route);await settle(page);}
async function variants(label){for(const size of [{width:1366,height:768},{width:1920,height:1080}])for(const theme of ['light','dark']){await page.setViewportSize(size);await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.waitForTimeout(250);await assertLayout(page,label);report.variants.push({label,...size,theme});}}
try{verification:{
  const scripts=[]; const listener=response=>{if(response.request().resourceType()==='script'&&response.url().includes('/assets/'))scripts.push(response.body().then(body=>({url:new URL(response.url()).pathname,gzip:gzipSync(body).length})));};
  page.on('response',listener);await go('/studies');await expect(page.getByRole('table').first()).toBeVisible();await page.waitForTimeout(17000);page.off('response',listener);
  report.initialJavaScript=await Promise.all(scripts);report.initialGzipBytes=report.initialJavaScript.reduce((n,item)=>n+item.gzip,0);
  assert.equal(await page.getByText('读取中',{exact:true}).count(),0,'Runs must resolve or give an error within the timeout');
  await variants('研究列表');report.checks.push('运行列表不永久读取中');console.log('研究列表完成');
  if(process.env.COMPONENT_BUNDLE_ONLY==='1')break verification;
  await page.getByRole('radio',{name:'Agent',exact:true}).click();await expect(page.locator('[data-page="agent"]')).toBeVisible();await expect(page.getByText('未连接模型',{exact:true}).first()).toBeVisible();await page.getByRole('radio',{name:'工作台',exact:true}).click();await expect(page).toHaveURL(/\/studies/);
  const all=[];for(const w of await request(base,'/api/workspaces'))for(const s of await request(base,`/api/workspaces/${w.id}/studies`))all.push({w,s});
  const single=all.find(({s})=>s.definition.title.includes('城南')&&s.definition.driver.kind==='single');assert.ok(single,'Existing single study');
  const {w,s}=single,prefix=`/api/workspaces/${w.id}/studies/${s.id}`,url=tab=>`/studies/${s.id}/${tab}?workspace=${w.id}`;
  await go(url('ampacity/parameters'));await page.getByRole('combobox',{name:'方法版本',exact:true}).click();
  const options=page.getByRole('option').filter({hasText:'IEC 60287',hasNotText:'保存版本'});await expect(options.first()).toBeVisible();await options.first().click();
  await expect(page.locator('.buzzform-contract')).toBeVisible();await variants('真实方法参数');
  await page.setViewportSize({width:1366,height:768});await page.evaluate(()=>document.documentElement.dataset.theme='light');await page.screenshot({path:path.join(out,'parameters-light.png')});
  report.parameterFields=await page.locator('.buzzform-contract input').evaluateAll(nodes=>nodes.map(n=>({path:n.dataset.fieldPath,value:n.value,type:n.type,label:n.getAttribute('aria-label')})));
  console.log('PARAMETER_FIELDS',JSON.stringify(report.parameterFields));
  const factor=page.locator('input[data-field-path="/ks"]');await expect(factor).toBeEditable();
  await factor.fill('1.2');await page.getByRole('button',{name:'保存修改',exact:true}).click();await expect(factor).toHaveAttribute('aria-invalid','true');await expect(factor).toBeFocused();assert.equal(report.writes.length,0);
  await factor.fill('0.8');await factor.blur();
  const parameterSave=page.waitForResponse(r=>r.request().method()==='PUT'&&new URL(r.url()).pathname===prefix);
  await page.getByRole('button',{name:'保存修改',exact:true}).click();assert.equal((await parameterSave).status(),200);
  const saved=(await request(base,`/api/workspaces/${w.id}/studies`)).find(row=>row.id===s.id);assert.equal(saved.definition.parameters.ks,0.8);report.checks.push('Buzzform范围校验定位字段、正式保存与读回');
  await go(url('cable/layers'));await expect(page.locator('[role="grid"]')).toBeVisible();await variants('真实分层表');
  report.grid=await page.locator('[role="grid"]').innerText();report.gridCells=await page.locator('[role="gridcell"]').evaluateAll(nodes=>nodes.slice(0,24).map(n=>({text:n.textContent,attrs:[...n.attributes].map(a=>[a.name,a.value])})));
  await page.setViewportSize({width:1366,height:768});await page.evaluate(()=>document.documentElement.dataset.theme='light');await page.screenshot({path:path.join(out,'layers-light.png')});
  console.log('分层表完成');
  await expect(page.locator('[role="gridcell"][data-column-id="diameter"]').first()).toHaveAttribute('data-readonly','true');
  const unlocked=all.find(({w,s})=>w.id==='b9ee1ceb-92d4-48ed-8f3b-bd7b8818b88c'&&s.definition.driver.kind==='single');assert.ok(unlocked);
  await go(`/studies/${unlocked.s.id}/cable/layers?workspace=${unlocked.w.id}`);await expect(page.locator('[role="grid"]')).toBeVisible();
  const cells=page.locator('[role="gridcell"][data-column-id="thickness"]:not([data-readonly])');assert.ok(await cells.count()>=2);
  const initial=await cells.allTextContents();await cells.first().dblclick();const editor=page.locator('[role="gridcell"][data-editing] input');await editor.fill('2.5');await editor.press('Enter');await expect(cells.first()).toHaveText('2.5');
  await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(cells.first()).toHaveText(initial[0]);await page.getByRole('button',{name:'重做',exact:true}).click();await expect(cells.first()).toHaveText('2.5');
  await cells.first().click();await context.grantPermissions(['clipboard-read','clipboard-write']);await page.evaluate(()=>navigator.clipboard.writeText('2.6\n2.7'));await page.keyboard.press('Control+v');await expect(cells.first()).toHaveText('2.6');await expect(cells.nth(1)).toHaveText('2.7');
  await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(cells.first()).toHaveText('2.5');await expect(cells.nth(1)).toHaveText(initial[1]);
  await cells.first().click();await page.keyboard.press('Shift+ArrowDown');await page.keyboard.press('Control+d');await expect(cells.nth(1)).toHaveText('2.5');await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(cells.nth(1)).toHaveText(initial[1]);
  const domainPath=`/api/workspaces/${unlocked.w.id}/domain`,write=page.waitForResponse(r=>r.request().method()==='PUT'&&new URL(r.url()).pathname===domainPath);await page.getByRole('button',{name:'保存分层',exact:true}).click();assert.equal((await write).status(),200);
  const payload=report.writes.findLast(r=>r.url.endsWith(domainPath)).body;assert.ok(Number.isInteger(payload.expected_revision));assert.ok(JSON.stringify(payload.document).includes('0.0025'));await expect(page.getByRole('button',{name:'保存分层',exact:true})).toBeDisabled();
  await cells.first().dblclick();await editor.fill('2.8');await editor.press('Enter');await context.route('**'+domainPath,route=>route.request().method()==='PUT'?route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({detail:{code:'REVISION_CONFLICT',message:'工程修订已变化'}})}):route.continue());await page.getByRole('button',{name:'保存分层',exact:true}).click();await expect(page.locator('.layer-grid-module [role="alert"]')).toBeVisible();await expect(cells.first()).toHaveText('2.8');await context.unroute('**'+domainPath);report.checks.push('真实锁定输入只读；分层编辑、粘贴、填充、单次撤销、SI保存、409保留草稿');
  report.checks.push('真实接口方法表单与分层表渲染');
  const selection=all.find(({s})=>s.definition.title.includes('城北')&&s.definition.driver.kind==='selection');assert.ok(selection);
  const runPath=`/api/workspaces/${selection.w.id}/studies/${selection.s.id}/runs`,runs=(await request(base,runPath)).items,run=runs.at(-1);assert.ok(run);
  const resultUrl=`/studies/${selection.s.id}/selection/results?workspace=${selection.w.id}&run=${run.id}`;
  await go(resultUrl);await expect(page.locator('table[data-slot="table"]').first()).toBeVisible();await variants('真实运行结果');
  await page.setViewportSize({width:1366,height:768});await page.evaluate(()=>document.documentElement.dataset.theme='light');await page.screenshot({path:path.join(out,'results-light.png')});
  await page.getByRole('button',{name:'运行记录',exact:true}).click();const drawer=page.getByRole('dialog',{name:'运行记录',exact:true});await expect(drawer.locator('.run-records-content')).toBeVisible();await expect(drawer).toContainText('历史结果');await variants('历史运行记录');await page.screenshot({path:path.join(out,'runs-dark.png')});await page.keyboard.press('Escape');
  for(const state of ['empty','loading','error','queued','running','failed','succeeded']){
    let release;const gate=new Promise(resolve=>release=resolve),mask='**'+runPath+'*';
    await context.route(mask,async route=>{if(state==='loading')await gate;await route.fulfill({status:state==='error'?503:200,contentType:'application/json',body:JSON.stringify(state==='error'?{detail:'运行记录暂不可用'}:{items:state==='empty'||state==='loading'?[]:[{...run,status:state,finished:['queued','running'].includes(state)?null:run.finished}]})}).catch(()=>{});});
    await go(resultUrl);await page.getByRole('button',{name:'运行记录',exact:true}).click();
    const copy={empty:'尚无运行记录',loading:'正在读取运行记录',error:'运行记录读取失败',queued:'排队',running:'执行中',failed:'失败',succeeded:'成功'}[state];await expect(drawer).toContainText(copy);await variants('运行记录'+state);release();await page.keyboard.press('Escape');await context.unroute(mask,{behavior:'wait'});
  }
  report.checks.push('真实结果与历史快照；运行记录空、加载、错误及排队/执行/成功/失败状态');
  assert.deepEqual(report.errors,[]);
}}catch(error){report.failure=String(error.stack||error);console.error(report.failure);console.error((await page.locator('body').innerText()).slice(0,5000));process.exitCode=1;}
finally{await fs.writeFile(path.join(out,process.env.COMPONENT_BUNDLE_ONLY==='1'?'bundle.json':'verification.json'),JSON.stringify(report,null,2));await context.unrouteAll({behavior:'ignoreErrors'});await session.close();}
console.log(JSON.stringify({checks:report.checks,variants:report.variants.length,initialGzipBytes:report.initialGzipBytes,errors:report.errors,failure:report.failure?.slice(0,600)}));
