import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {expect as expectBase} from '@playwright/test';
import {openHeadlessBrowser,outputRoot,settle} from './browser.mjs';
import {currentSelection,request} from './research-fixtures.mjs';
import {assertLayout} from './layout-assertions.mjs';
if(process.env.E2E_ISOLATED!=='1')throw Error('Requires isolated database');
const base=process.env.FRONTEND_URL,out=path.join(outputRoot,'report-pdf');
await fs.mkdir(out,{recursive:true});
const expect=expectBase.configure({timeout:60000});
const archiveOnly=process.env.REPORT_ARCHIVE_ONLY==='1';
console.log(archiveOnly?'使用已封存运行验证 PDF 与预览，不调用求解':'读取真实 IEC 当前结果与 PDF 交付');
async function archivedSelection(){
  for(const workspace of await request(base,'/api/workspaces'))for(const study of await request(base,`/api/workspaces/${workspace.id}/studies`)){
    if(study.definition.driver.kind!=='selection')continue;
    const run=(await request(base,`/api/workspaces/${workspace.id}/studies/${study.id}/runs`)).items.find(r=>r.integrity==='verified'&&['succeeded','partial'].includes(r.status));
    if(run){const book=await request(base,`/api/workspaces/${workspace.id}/deliveries`,'POST',{run_ids:[run.id]});return{study,run,book};}
  }
  throw Error('缺少真实封存选型运行');
}
const fixture=archiveOnly?await archivedSelection():await currentSelection(base),{study,run}=fixture;
const session=await openHeadlessBrowser(),{page}=session;
const report={checks:[],variants:[],errors:[],requests:[]};
page.on('pageerror',e=>report.errors.push(e.message));
page.on('request',r=>{if(/^https?:/.test(r.url()))report.requests.push(r.url());});
const root=`/api/workspaces/${study.workspace}`,studyRoot=`${root}/studies/${study.id}`;
async function go(route){await page.goto('about:blank');await page.goto(base+route);await settle(page);}
async function get(p){return request(base,p);}
async function downloaded(action){const pending=page.waitForEvent('download');await action();const file=await pending,stream=await file.createReadStream(),chunks=[];for await(const c of stream)chunks.push(c);return{name:file.suggestedFilename(),bytes:Buffer.concat(chunks),file};}
function embedded(book,audience){const pattern=new RegExp('<a[^>]*data-report-pdf="'+audience+'"[^>]*href="data:application/pdf;base64,([^"]+)"');const encoded=book.html.match(pattern)?.[1];assert.ok(encoded,'frozen PDF '+audience);return Buffer.from(encoded,'base64');}
function verify(file,book,audience){assert.match(file.name,/\.pdf$/);assert.equal(file.bytes.subarray(0,5).toString(),'%PDF-');assert.deepEqual(file.bytes,embedded(book,audience));}
async function variants(label){for(const size of [{width:1366,height:768},{width:1920,height:1080}]){await page.setViewportSize(size);for(const theme of ['light','dark']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await assertLayout(page,label,{includeFrames:false});report.variants.push({label,...size,theme});}}}
async function shot(name){await page.setViewportSize({width:1366,height:768});await page.evaluate(()=>document.documentElement.dataset.theme='light');await page.screenshot({path:path.join(out,name+'.png')});}
try{
  let did=fixture.book.id,book=fixture.book;
  if(!archiveOnly){
  await go(`/studies/${study.id}/selection/results?workspace=${study.workspace}&run=${run.id}`);
  await page.getByRole('toolbar',{name:'工程命令',exact:true}).getByRole('button',{name:'生成计算书',exact:true}).click();
  await expect(page.locator('iframe[title="计算书预览"]')).toHaveAttribute('src',/^blob:/);
  const customer=await downloaded(()=>page.getByRole('button',{name:'下载 PDF',exact:true}).click());
  did=new URL(page.url()).searchParams.get('delivery');assert.ok(did);
  book=await get(root+'/deliveries/'+did);verify(customer,book,'customer');
  await expect(page.locator('iframe[title="计算书预览"]')).toHaveAttribute('src',/^blob:/);
  await customer.file.saveAs(path.join(out,'customer.pdf'));
  await expect(page.getByRole('combobox',{name:'PDF 版本'})).toContainText('客户版');
  await page.getByRole('combobox',{name:'PDF 版本'}).click();await page.getByRole('option',{name:'内部审核版',exact:true}).click();
  const internal=await downloaded(()=>page.getByRole('button',{name:'下载 PDF',exact:true}).click());verify(internal,book,'internal');assert.notDeepEqual(internal.bytes,customer.bytes);
  await internal.file.saveAs(path.join(out,'internal.pdf'));
  const html=await downloaded(()=>page.getByRole('button',{name:'HTML 存档',exact:true}).click());assert.equal(html.bytes.toString(),book.html);
  await variants('研究 PDF 下载');await shot('study-pdf');
  report.checks.push('生成后预览真实客户 PDF，点击下载；切换内部版后字节与封存版本一致；HTML 为独立次入口');
  }
  await go(`/deliveries?workspace=${study.workspace}&delivery=${did}`);
  const list=await get(root+'/deliveries'),version=list.find(x=>x.id===did).version;
  const row=page.getByRole('row',{name:`计算书 · 第 ${version} 版`,exact:true});
  await expect(row).toBeVisible();await expect(page.getByRole('combobox',{name:'PDF 版本'})).toContainText('客户版');
  await expect(page.frameLocator('iframe[title="交付存档预览"]').locator('a[data-report-pdf]')).toHaveCount(0);
  verify(await downloaded(()=>row.getByRole('button',{name:'下载 PDF',exact:true}).click()),book,'customer');
  await page.getByRole('combobox',{name:'PDF 版本'}).click();await page.getByRole('option',{name:'内部审核版',exact:true}).click();
  verify(await downloaded(()=>row.getByRole('button',{name:'下载 PDF',exact:true}).click()),book,'internal');
  await variants('交付历史 PDF 下载');await shot('delivery-pdf');
  const ws=await get(root);ws.domain.name+=' · 历史下载核对';
  await request(base,root+'/domain','PUT',{expected_revision:ws.revision,document:ws.domain});
  await page.reload();await expect(row).toBeVisible();
  verify(await downloaded(()=>row.getByRole('button',{name:'下载 PDF',exact:true}).click()),book,'customer');
  report.checks.push('交付历史默认客户版、可选内部版；源输入改变后仍下载相同封存 PDF');
  let downloads=0;page.on('download',()=>downloads++);
  for(const fault of ['missing','remote','invalid']){
    await page.route(`**/deliveries/${did}`,async route=>{
      const response=await route.fetch(),value=await response.json();
      value.html=fault==='missing'?'<p>旧 HTML 存档</p>':`<a data-report-pdf="customer" href="${fault==='remote'?'https://invalid.example/report.pdf':'data:application/pdf;base64,bm90IGEgcGRm'}">PDF</a>`;
      await route.fulfill({response,json:value});
    });
    const before=downloads;await row.getByRole('button',{name:'下载 PDF',exact:true}).click();
    await expect(page.getByRole('alert').last()).toContainText(fault==='missing'?'未提供客户版 PDF':fault==='remote'?'不是交付内保存':'不是有效 PDF');
    assert.equal(downloads,before);await page.unroute(`**/deliveries/${did}`);
  }
  report.checks.push('负向注入：旧存档缺 PDF、外部地址及非 PDF 字节均拒绝，不静默切换版本或格式');
  assert.ok(report.requests.every(url=>new URL(url).origin===base),'新前端场景不访问其他服务');
  const child=spawn(process.execPath,['scripts/capture-handoff.mjs',`--route=/deliveries?workspace=${study.workspace}&delivery=${did}`],{cwd:process.cwd(),env:{...process.env,CAPTURE_DIRECTORY:'frontend-only'},windowsHide:true,stdio:'inherit'});
  const [code]=await once(child,'exit');assert.equal(code,0);
  const manifest=JSON.parse(await fs.readFile(path.join(outputRoot,'frontend-only','manifest.json'),'utf8'));
  assert.equal(manifest.pages.length,1);assert.deepEqual(manifest.blockedWrites,[]);assert.equal(new URL(manifest.pages[0].route,base).origin,base);
  report.checks.push('退役后 capture:handoff 实际访问正式前端路径，截图成功且没有写入');
  assert.deepEqual(report.errors,[]);
}catch(error){report.failure={message:error.message,page:await page.locator('body').innerText().catch(()=>'' )};throw error;}
finally{await fs.writeFile(path.join(out,archiveOnly?'archive-verification.json':'verification.json'),JSON.stringify(report,null,2));await session.close();}
console.log(JSON.stringify({checks:report.checks,variants:report.variants.length,errors:report.errors},null,2));
