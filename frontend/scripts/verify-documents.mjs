import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { expect as expectBase } from '@playwright/test';
import { openHeadlessBrowser, settle, outputRoot, repositoryRoot } from './browser.mjs';
import { assertLayout } from './layout-assertions.mjs';
import { displayName } from '../src/lib/display-names.ts';
if (process.env.E2E_ISOLATED !== '1') throw Error('资料核对验收只允许独立数据库');
const base = process.env.FRONTEND_URL, expect = expectBase.configure({timeout: 30000});
const output = path.join(outputRoot, 'import'); await fs.mkdir(output, {recursive: true});
const report = { workflows: [], states: [], errors: [], screenshots: [] }, session = await openHeadlessBrowser(), {page, context} = session;
page.on('pageerror', error => report.errors.push(error.message));
page.on('response', response => { if(response.url().includes('/api/documents') && response.request().method()==='POST') console.log('资料接口', new URL(response.url()).pathname, response.status()); });
page.on('requestfailed', request => { if(request.url().includes('/api/documents')) console.log('资料网络失败',new URL(request.url()).pathname,request.failure()?.errorText); });
async function api(url, options={}) { const response=await fetch(base+url, options); const data=await response.json(); assert.ok(response.ok, url+' '+JSON.stringify(data)); return data; }
async function go(url) { await page.goto(base+url,{waitUntil:'domcontentloaded'}); await settle(page); }
async function variants(label) { for(const viewport of [{width:1366,height:768},{width:1920,height:1080}]) { await page.setViewportSize(viewport); for(const theme of ['light','dark']) { await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme); await page.waitForTimeout(80); await assertLayout(page,label); report.states.push({label,theme,...viewport}); } } await page.setViewportSize({width:1366,height:768});await page.evaluate(()=>document.documentElement.dataset.theme='light'); }
async function originalReady() { await expect(page.locator('.document-page-image img')).toBeVisible({timeout:120000});await expect.poll(()=>page.locator('.document-page-image img').evaluate(img=>img.complete && img.naturalWidth>0),{timeout:120000}).toBe(true);await expect(page.locator('.document-page-scroll')).toHaveAttribute('aria-busy','false'); }
async function shot(name) { if(process.env.E2E_SCREENSHOTS==='0')return;if(name==='review'||name==='proposal')await originalReady();await page.locator('.main-content').evaluate(node=>node.scrollTop=0); await page.screenshot({path:path.join(output,name+'.png')});report.screenshots.push(name); }
async function scope(sample) {
  await page.locator('.document-extraction-config').evaluate(node=>node.open=true);
  await page.getByLabel('型号系列',{exact:true}).fill(sample.model.designation);
  await page.getByLabel('规格行／列',{exact:true}).fill(sample.model.specification);
  await page.getByLabel('厂家、电压、导体与护套分支',{exact:true}).fill(sample.model.identity_note);
  for(const selection of sample.selections) { await page.getByRole('spinbutton',{name:'原文页码',exact:true}).fill(String(selection.page)); await page.getByRole('button',{name:'加入整页',exact:true}).click(); }
}
async function start(captureLoading=false) {
  let release;const held=new Promise(resolve=>release=resolve);const runPattern=/\/api\/documents\/[^/]+\/extractions\/[^/]+$/;
  if(captureLoading)await context.route(runPattern,async route=>{await held;return route.fallback();});
  const response = page.waitForResponse(r=>r.url().endsWith('/extractions') && r.request().method()==='POST');
  await page.getByRole('button',{name:'开始离线提取',exact:true}).click(); const saved=await (await response).json(); assert.ok(saved.id,JSON.stringify(saved));
  if(captureLoading){await expect(page.getByRole('progressbar',{name:'资料提取进度'})).toBeVisible();await variants('资料核对·加载');release();await context.unroute(runPattern);}
  await expect.poll(async()=> (await api(`/api/documents/${saved.document_id}/extractions/${saved.id}`)).status,{timeout:120000}).toBe('succeeded');
  await expect(page.getByRole('heading',{name:/候选参数/})).toBeVisible();
  return api(`/api/documents/${saved.document_id}/extractions/${saved.id}`);
}
try {
  // Read-state faults are transport interventions; the successful workflow below uses real PDF and plugin output.
  await context.route('**/api/documents',route=>route.request().method()==='GET'?route.fulfill({status:200,contentType:'application/json',body:'[]'}):route.fallback());
  await go('/library/documents');await expect(page.getByText('尚无厂家资料',{exact:true})).toBeVisible();await variants('资料目录·空');await context.unroute('**/api/documents');
  let release; const held=new Promise(resolve=>release=resolve);await context.route('**/api/documents',async route=>{await held;await route.fallback();});
  await go('/library/documents');await expect(page.getByText('正在读取资料目录',{exact:true})).toBeVisible();await variants('资料目录·加载');release();await context.unroute('**/api/documents');
  await context.route('**/api/documents',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:{message:'资料服务暂时断开，原件保留'}})}));await go('/library/documents');await expect(page.getByText('资料目录读取失败',{exact:true})).toBeVisible();await variants('资料目录·错误');await context.unroute('**/api/documents');
  await go('/library/documents');
  const sample=JSON.parse(await fs.readFile(path.join(repositoryRoot,'plugins/cablesim.datasheet-extract/validation/labels.json'),'utf8')).samples[0];
  const source=path.join(repositoryRoot,'.data/datasheet-import/sources',sample.file), bytes=await fs.readFile(source);assert.equal(createHash('sha256').update(bytes).digest('hex'),sample.sha256);
  const uploaded=page.waitForResponse(r=>r.url().endsWith('/api/documents')&&r.request().method()==='POST',{timeout:120000});await page.getByLabel('上传 PDF 文件').setInputFiles(source);assert.equal((await uploaded).status(),201);const doc=(await api('/api/documents')).find(item=>item.sha256===sample.sha256);assert.ok(doc);await expect(page.locator('.documents-workspace')).toBeVisible();await scope(sample);
  // Viewing a disclosure never invokes Mistral; no confirmation or external extraction occurs in this acceptance.
  await page.getByLabel('识别方法',{exact:true}).selectOption('hybrid');await page.getByRole('button',{name:'查看外发说明',exact:true}).click();await expect(page.getByRole('dialog',{name:'确认外发所选内容'})).toBeVisible();await expect(page.getByRole('button',{name:'确认并开始提取',exact:true})).toBeDisabled();await expect(page.getByText('字段提取地址',{exact:true})).toBeVisible();await page.keyboard.press('Escape');await page.getByLabel('识别方法',{exact:true}).selectOption('rules');
  let run=await start(true);assert.equal(run.result.provider_calls.length,0);assert.ok(run.result.candidates.length>=4);
  for(const candidate of run.result.candidates) { const truth=sample.truth[candidate.field];if(truth && !candidate.ambiguities.length) {assert.equal(candidate.unit_si,truth.unit_si);assert.ok(Math.abs(candidate.value_si-truth.value_si)<1e-10);} }
  await page.locator('.document-extraction-config').evaluate(node=>node.open=false);await originalReady();await variants('资料核对·成功');await shot('review');
  const highlight=page.locator('.evidence-highlight');await expect(highlight).toHaveAttribute('x',String(run.result.candidates[0].bbox_pt[0]));
  // Server commits a review but its response is lost. Retry must reuse the same
  // request ID and must not apply the decision twice or discard entered reasons.
  const first=run.result.candidates[0],firstForm=page.getByRole('form',{name:'逐项核对'});
  await firstForm.getByLabel('核对人',{exact:true}).fill('隔离验收工程师');await firstForm.getByLabel('核对理由',{exact:true}).fill('断线重试保留原文核对');
  let replayBody,reviewPosts=0;
  await context.route('**/reviews',async route=>{if(route.request().method()!=='POST')return route.fallback();reviewPosts++;if(reviewPosts===1){replayBody=route.request().postDataJSON();await route.fetch();return route.abort('failed');}assert.equal(route.request().postDataJSON().request_id,replayBody.request_id);return route.fallback();});
  await firstForm.getByRole('button',{name:'保存此项核对',exact:true}).click();await expect(page.getByText('连接中断，已填写的核对内容保留；可重试同一操作。',{exact:true})).toBeVisible();await expect(firstForm.getByLabel('核对理由',{exact:true})).toHaveValue('断线重试保留原文核对');await variants('资料核对·错误');
  const replay=page.waitForResponse(r=>r.url().endsWith('/reviews')&&r.request().method()==='POST');await firstForm.getByRole('button',{name:'保存此项核对',exact:true}).click();run=await (await replay).json();assert.equal(run.revision,1);await context.unroute('**/reviews');
  report.workflows.push({name:'核对响应丢失后重试，复用请求编号且只保存一个修订',revision:run.revision});
  for (const candidate of run.result.candidates) {
    await page.locator('.document-candidates').getByRole('button',{name:displayName(candidate.field),exact:true}).first().click();
    const form=page.getByRole('form',{name:'逐项核对'});await expect(form.getByRole('heading',{name:displayName(candidate.field),exact:true})).toBeVisible();await form.getByLabel('核对人',{exact:true}).fill('隔离验收工程师');await form.getByLabel('核对理由',{exact:true}).fill('对拍已人工标注的厂家原件行列、数值和单位');
    const agrees=sample.truth[candidate.field] && Math.abs(candidate.value_si-sample.truth[candidate.field].value_si)<1e-10;
    if(candidate.field==='weight' && agrees) {await form.getByLabel('修改',{exact:true}).check();await form.getByLabel('修订值',{exact:true}).fill('403');await form.getByLabel('修订单位',{exact:true}).selectOption('kg/100m');}
    else await form.getByLabel(agrees?'接受':'拒绝',{exact:true}).check();
    const checked=page.waitForResponse(r=>r.url().endsWith('/reviews')&&r.request().method()==='POST');await form.getByRole('button',{name:'保存此项核对',exact:true}).click();run=await (await checked).json();assert.ok(run.revision>0,JSON.stringify(run));await expect(form.getByRole('button',{name:'保存此项核对',exact:true})).toBeEnabled();
  }
  const weight=run.reviews.find(review=>run.result.candidates.find(c=>c.id===review.candidate_id)?.field==='weight');if(weight)assert.ok(Math.abs(weight.value_si-4.03)<1e-10,'403kg/100m must equal4.03kg/m');
  await page.getByRole('button',{name:'准备提案',exact:true}).click();const proposalForm=page.getByRole('form',{name:'型号草稿提案'});
  await proposalForm.getByLabel('型号名称',{exact:true}).fill('Bahra 6/10 kV 1×185 · 资料核对');await proposalForm.getByLabel('厂家',{exact:true}).fill('Bahra');await proposalForm.getByLabel('相对地电压（kV）',{exact:true}).fill('6');await proposalForm.getByLabel('额定电压（kV）',{exact:true}).fill('10');await proposalForm.getByLabel('芯数',{exact:true}).fill('1');await proposalForm.getByLabel('每芯截面（mm²）',{exact:true}).fill('185');await proposalForm.getByLabel('身份信息原文依据',{exact:true}).fill('Bahra MV Lead Sheathed PDF20–21，CU/XLPE/LC/PVC，6/10kV，单芯185mm²');await proposalForm.getByLabel('新版本名称',{exact:true}).fill('原文核对稿');
  await context.route('**/proposals',route=>route.fulfill({status:422,contentType:'application/json',body:JSON.stringify({detail:[{loc:['body','new_model','u0_v'],msg:'请核对相对地电压',type:'value_error'}]})}));
  await proposalForm.getByRole('button',{name:'生成提案',exact:true}).click();await page.getByRole('button',{name:'定位相对地电压',exact:true}).click();await expect(proposalForm.getByLabel('相对地电压（kV）',{exact:true})).toBeFocused();await expect(proposalForm.getByLabel('额定电压（kV）',{exact:true})).not.toBeFocused();await context.unroute('**/proposals');report.workflows.push({name:'资料提案嵌套请求路径精确定位，保留同名/邻近字段'});
  const before=await api('/api/domain-cable-models'),proposed=page.waitForResponse(r=>r.url().endsWith('/proposals')&&r.request().method()==='POST');await proposalForm.getByRole('button',{name:'生成提案',exact:true}).click();const proposal=await (await proposed).json();assert.ok(proposal.sha256,JSON.stringify(proposal));assert.equal((await api('/api/domain-cable-models')).length,before.length,'No model before explicit approval');
  await page.getByRole('button',{name:'核对并批准',exact:true}).click();const dialog=page.getByRole('dialog',{name:'批准型号草稿提案'});await expect(dialog.getByRole('button',{name:'批准并生成草稿',exact:true})).toBeDisabled();await dialog.getByLabel('批准人',{exact:true}).fill('隔离验收工程师');await dialog.getByRole('checkbox').check();
  const approved=page.waitForResponse(r=>r.url().endsWith('/approval')&&r.request().method()==='POST');await dialog.getByRole('button',{name:'批准并生成草稿',exact:true}).click();const saved=await (await approved).json();assert.ok(saved.new_model_id,JSON.stringify(saved));await expect(page.getByRole('heading',{name:'型号草稿已生成',exact:true})).toBeVisible();await variants('资料提案·批准成功');await shot('proposal');
  const current=(await api('/api/domain-cable-models')).find(model=>model.id===saved.new_model_id);assert.equal(current.payload.confirmed,false);assert.equal(current.state,'incomplete');assert.equal(current.payload.specification.area_m2,.000185);
  const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'下载原件',exact:true}).click();const download=await downloaded;const downloadedBytes=await fs.readFile(await download.path());assert.equal(createHash('sha256').update(downloadedBytes).digest('hex'),sample.sha256);
  report.workflows.push({name:'真实PDF→规则离线提取→逐项接受修改拒绝→提案→显式批准→型号草稿→原件摘要校验',document:doc.id,extraction:run.id,candidates:run.result.candidates.length,proposal:proposal.id,model:saved.new_model_id,externalCalls:run.result.provider_calls.length,handCheck:'403kg/100m=4.03kg/m'});
  // A second genuine extraction makes the first an actual historical record.
  await go(`/library/documents?document=${doc.id}`);await scope(sample);const next=await start();assert.notEqual(next.id,run.id);await page.getByLabel('提取记录',{exact:true}).selectOption(run.id);await expect(page.getByText('历史提取',{exact:true})).toBeVisible();await page.locator('.document-extraction-config').evaluate(node=>node.open=false);await variants('资料核对·历史');await expect(page.getByRole('button',{name:'保存此项核对',exact:true})).toBeDisabled();
  await go('/library/documents');await expect(page.locator('.document-catalog')).toBeVisible();await variants('资料目录·成功');
  await context.route('**/api/documents',route=>route.request().method()==='GET'?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:{message:'资料目录网络中断'}})}):route.fallback());await page.getByRole('button',{name:'刷新目录',exact:true}).click();await expect(page.getByText('上次资料目录',{exact:true})).toBeVisible();await expect(page.locator('.document-catalog')).toBeVisible();await variants('资料目录·历史');await context.unroute('**/api/documents');
  // Real manufacturer scan, offline OCR, with the public manual labels as an independent check.
  const scan=JSON.parse(await fs.readFile(path.join(repositoryRoot,'plugins/cablesim.datasheet-extract/validation/scans.json'),'utf8')).samples[0];
  const scanUploaded=page.waitForResponse(r=>r.url().endsWith('/api/documents')&&r.request().method()==='POST',{timeout:120000});await page.getByLabel('上传 PDF 文件').setInputFiles(path.join(repositoryRoot,'.data/datasheet-import/sources',scan.file));assert.equal((await scanUploaded).status(),201);const scanDoc=(await api('/api/documents')).find(item=>item.sha256===scan.sha256);assert.ok(scanDoc);await expect(page.locator('.documents-workspace')).toBeVisible();await scope(scan);
  await expect.poll(()=>api(`/api/documents/${scanDoc.id}/pages/${scan.selections[0].page}`).then(value=>value.requires_ocr),{timeout:120000}).toBe(true);
  await variants('资料核对·空');
  const scanRun=await start();assert.equal(scanRun.result.provider_calls.length,0);assert.ok(scanRun.result.ocr_evidence.length);assert.ok(scanRun.result.candidates.every(item=>item.evidence_source==='ocr'&&item.evidence_sha256));assert.ok(scanRun.result.candidates.some(item=>item.ambiguities.length));
  for(const candidate of scanRun.result.candidates.filter(item=>!item.ambiguities.length)){const truth=scan.truth[candidate.field];if(truth)assert.ok(Math.abs(candidate.value_si-truth.value_si)<1e-10);}
  await expect(page.getByRole('heading',{name:/待消歧/})).toBeVisible();report.workflows.push({name:'真实厂家扫描页→自动离线识别→证据坐标/摘要→歧义项单列',candidates:scanRun.result.candidates.length,externalCalls:0});
  for(const route of ['/','/studies','/library','/plugins']){await go(route);await expect(page.locator('.topbar').getByText('已保存',{exact:true})).toHaveCount(0);if(route==='/'||route==='/studies')await expect(page.locator('.topbar .status-mark')).toHaveCount(0);await expect(page.locator('.module-sidebar').getByText('型号工作区',{exact:true})).toHaveCount(0);await variants('导航修正'+route);if(route==='/studies'){await expect(page.locator('.main-content').getByText('历史',{exact:true}).first()).toBeVisible();await shot('studies');}}
  const studies=[];for(const workspace of await api('/api/workspaces'))for(const study of await api(`/api/workspaces/${workspace.id}/studies`))studies.push({...study,wid:workspace.id});
  const sweep=studies.find(item=>item.definition.driver.kind==='sweep'),inquiry=studies.find(item=>item.definition.driver.kind==='selection');assert.ok(sweep&&inquiry);
  const savedRuns=(await api(`/api/workspaces/${sweep.wid}/studies/${sweep.id}/runs`)).items;const sourceRun=savedRuns.find(item=>item.integrity==='verified'&&item.status==='succeeded');assert.ok(sourceRun);
  await go(`/studies/${sweep.id}/sweep/curve?workspace=${sweep.wid}&run=${sourceRun.id}`);await expect(page.locator('.evidence-summary h2')).toContainText('结果非单调/突变，请检查');await expect(page.locator('.evidence-summary h2')).not.toContainText('平均');await variants('扫描·已保存突变结果');await shot('sweep');
  // A transport-supplied preflight rejection exercises JSON Pointer navigation;
  // all displayed engineering inputs remain the real isolated workspace inputs.
  const ws=await api(`/api/workspaces/${inquiry.wid}`), circuit=ws.domain.circuits[0].id,load=ws.domain.load_cases[0].id;
  const field='/load_cases/0/currents/'+circuit.replaceAll('~','~0').replaceAll('/','~1');
  await context.route('**/preflight?**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ready:false,cases:[{case_id:'case-0',status:'failed',error:{code:'INPUT_INVALID',message:'回路电流需要核对',path:field,issues:[{code:'INPUT_INVALID',message:'回路电流需要核对',path:field}]}}]})}));
  await go(`/studies/${inquiry.id}/selection/settings?workspace=${inquiry.wid}&preflight=true`);await page.getByRole('dialog',{name:'运行前预检'}).getByRole('button',{name:'前往工况输入',exact:true}).click();const stable='/load_cases/'+load.replaceAll('~','~0').replaceAll('/','~1')+'/currents/'+circuit.replaceAll('~','~0').replaceAll('/','~1');await expect(page.locator(`[data-field-path="${stable}"] input`)).toBeFocused();await context.unroute('**/preflight?**');report.workflows.push({name:'预检RFC6901数组下标和斜杠转义定位真实电流字段'});
  assert.deepEqual(report.errors,[]);console.log(JSON.stringify({flows:report.workflows.length,states:report.states.length,jsErrors:report.errors.length}));
} catch(error) { report.failure=String(error);report.visible=await page.locator('body').innerText().catch(()=> '页面已关闭');throw error; } finally {await fs.writeFile(path.join(output,'verification.json'),JSON.stringify(report,null,2));await session.close();}
