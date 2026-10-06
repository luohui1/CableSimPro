import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {expect as expectBase} from '@playwright/test';
import {openHeadlessBrowser,outputRoot,settle} from './browser.mjs';
import {request} from './research-fixtures.mjs';
import {assertLayout} from './layout-assertions.mjs';
import {inspectVisibleNames} from './visible-names.mjs';
import {displayName} from '../src/lib/display-names.ts';
if(process.env.E2E_ISOLATED!=='1')throw Error('Requires isolated database');
const base=process.env.FRONTEND_URL,expect=expectBase.configure({timeout:30000});
const out=path.join(outputRoot,'host-connections');await fs.mkdir(out,{recursive:true});
const session=await openHeadlessBrowser(),{page}=session;
const report={checks:[],states:[],errors:[],requests:[]};
page.on('pageerror',e=>report.errors.push(e.message));
page.on('request',r=>{if(r.method()==='POST'&&/\/(undo|redo|runs)$/.test(new URL(r.url()).pathname))report.requests.push({url:r.url(),body:r.postDataJSON()});});
const api=(p,m,b)=>request(base,p,m,b);
async function go(p){await page.goto('about:blank');await page.goto(base+p);await settle(page);}
async function variants(label){for(const size of [{width:1366,height:768},{width:1920,height:1080}]){await page.setViewportSize(size);for(const theme of ['light','dark']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.waitForTimeout(250);await assertLayout(page,label,{includeFrames:label!=='交付历史'});report.states.push({label,...size,theme});}}}
async function shot(name){await page.setViewportSize({width:1366,height:768});await page.evaluate(()=>document.documentElement.dataset.theme='light');await page.screenshot({path:path.join(out,name+'.png')});}
async function downloaded(promise){const file=await promise,stream=await file.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);return{name:file.suggestedFilename(),bytes:Buffer.concat(chunks)};}
try{
  const workspaces=await api('/api/workspaces');let chosen,geometry;const archives=[];
  for(const w of workspaces){
    archives.push(...(await api(`/api/workspaces/${w.id}/deliveries`)));
    for(const s of await api(`/api/workspaces/${w.id}/studies`)){
      if(!geometry && s.definition.method.capability==='concentric-model'){
        const runs=(await api(`/api/workspaces/${w.id}/studies/${s.id}/runs`)).items;
        const r=runs.find(r=>r.integrity==='verified'&&r.output?.cases?.some(c=>c.artifacts?.['x-cablesim.cad-model']));
        if(r)geometry={w,r};
      }
      if(chosen||s.definition.driver.kind!=='selection')continue;
      const runs=(await api(`/api/workspaces/${w.id}/studies/${s.id}/runs`)).items;
      const run=runs.find(r=>r.integrity==='verified'&&r.output?.assessment?.some(a=>a.status==='satisfied'));
      if(run)chosen={w,s,run};
    }
  }
  assert.ok(chosen,'Existing authentic selection run');
  if(!archives.some(x=>x.kind==='specification') && geometry){
    await api(`/api/workspaces/${geometry.w.id}/deliveries`,'POST',{run_ids:[geometry.r.id]});
    archives.push(...await api(`/api/workspaces/${geometry.w.id}/deliveries`));
  }
  assert.ok(archives.some(x=>x.kind==='specification'),'真实结构运行生成的规格书存档');
  const {w,s,run}=chosen,root=`/api/workspaces/${w.id}`,studyRoot=`${root}/studies/${s.id}`;
  const archive=await api(root+'/deliveries','POST',{run_ids:[run.id]});
  const archiveList=await api(root+'/deliveries');assert.ok(archiveList.find(x=>x.id===archive.id));
  console.log('交付存档回归');
  await go(`/library/deliveries?workspace=${w.id}&delivery=${archive.id}`);
  await expect(page.getByRole('table',{name:'计算书与规格书历史'})).toBeVisible();
  await expect(page.getByTitle('交付存档预览')).toBeVisible();
  const row=page.getByRole('row',{name:`计算书 · 第 ${archiveList.find(x=>x.id===archive.id).version} 版`,exact:true});
  let filePromise=page.waitForEvent('download');await row.getByRole('button',{name:'HTML 存档'}).click();
  let file=await downloaded(filePromise);assert.equal(file.bytes.toString(),archive.html);assert.match(file.name,/计算书-第.*存档/);
  // Saved HTML is immutable host-rendered content; preserve it byte-for-byte and report its own presentation separately.
  report.archiveDocumentNames=(await inspectVisibleNames(page)).filter(item=>item.frame==='文档');
  await variants('交付历史');await shot('deliveries');
  await page.reload();await expect(page.getByTitle('交付存档预览')).toBeVisible();
  // Integrity rejection is a negative transport fixture, never a fabricated successful result.
  await page.route(`**/deliveries/${archive.id}/file`,async route=>{const response=await route.fetch();await route.fulfill({response,headers:{...response.headers(),'x-artifact-sha256':'0'.repeat(64)}});});
  await row.getByRole('button',{name:'HTML 存档'}).click();await expect(page.getByText('下载工件与计算书摘要不一致，拒绝导出')).toBeVisible();
  await page.unroute(`**/deliveries/${archive.id}/file`);
  for(const item of archives.filter(a=>a.kind==='specification').slice(0,1)){
    await go(`/library/deliveries?workspace=${item.workspace}&delivery=${item.id}`);
    await expect(page.getByTitle('交付存档预览')).toBeVisible();
    filePromise=page.waitForEvent('download');await page.getByRole('row',{name:`规格书 · 第 ${item.version} 版`,exact:true}).getByRole('button',{name:'HTML 存档'}).click();file=await downloaded(filePromise);assert.match(file.name,/规格书/);
    const book=await api(`/api/workspaces/${item.workspace}/deliveries/${item.id}`);assert.equal(file.bytes.toString(),book.html);report.checks.push('已有规格书存档下载与原文一致');
  }
  report.checks.push('真实计算书存档列表、预览、刷新深链接、逐字下载及错误摘要拒绝');
  console.log('研究历史回归');
  const workspace=await api(root),beforeDomain=JSON.stringify(workspace.domain);
  const beforeRunIds=(await api(studyRoot+'/runs')).items.map(x=>x.id);
  // Pin the test-only study to installed methods without changing or rerunning any saved result.
  const installed=await api('/api/methods'), baseline=structuredClone(s.definition);
  function pin(value){
    if(!value||typeof value!=='object')return;
    if(value.method?.plugin_id){const entry=installed.find(item=>item.method.plugin_id===value.method.plugin_id);assert.ok(entry,'installed method');value.method={...entry.method,capability:value.method.capability};}
    for(const child of Object.values(value))pin(child);
  }
  pin(baseline);
  Object.assign(s,await api(studyRoot,'PUT',{...baseline,expected_revision:workspace.revision,expected_study_revision:s.revision}));
  const definition={...s.definition,title:s.definition.title+' · 版本核对'};
  const changed=await api(studyRoot,'PUT',{...definition,expected_revision:workspace.revision,expected_study_revision:s.revision});
  const studyRoute=`/studies/${s.id}/selection/results?workspace=${w.id}`;
  await go(studyRoute);await expect(page.getByRole('button',{name:'撤销研究',exact:true})).toBeEnabled();
  await page.locator('body').click({position:{x:235,y:720}});await page.keyboard.press('Control+z');
  await expect(page.getByRole('button',{name:'重做研究',exact:true})).toBeEnabled();
  let saved=(await api(root+'/studies')).find(x=>x.id===s.id);assert.equal(saved.definition.title,s.definition.title);assert.equal(saved.revision,changed.revision+1);
  const redoReply=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname.endsWith('/redo'));
  await page.keyboard.press('Control+y');assert.equal((await redoReply).status(),200);
  await expect(page.getByRole('button',{name:'撤销研究',exact:true})).toBeEnabled();
  await expect(page.getByRole('button',{name:'重做研究',exact:true})).toBeDisabled();
  saved=(await api(root+'/studies')).find(x=>x.id===s.id);assert.equal(saved.definition.title,definition.title);assert.equal(saved.revision,changed.revision+2);
  let intercepted=false;
  await page.route('**/studies/*/undo',async route=>{if(!intercepted){intercepted=true;await route.fetch();await route.abort('failed');}else await route.continue();});
  await page.getByRole('button',{name:'撤销研究',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByRole('button',{name:'撤销研究',exact:true}).click();await expect(page.getByRole('button',{name:'重做研究',exact:true})).toBeEnabled();
  await page.unroute('**/studies/*/undo');
  const undos=report.requests.filter(r=>r.url.endsWith('/undo'));assert.equal(undos.at(-1).body.request_id,undos.at(-2).body.request_id);
  saved=(await api(root+'/studies')).find(x=>x.id===s.id);assert.equal(saved.revision,changed.revision+3);
  assert.equal(JSON.stringify((await api(root)).domain),beforeDomain);assert.deepEqual((await api(studyRoot+'/runs')).items.map(x=>x.id),beforeRunIds);
  await variants('研究撤销重做');await shot('study-history');
  report.checks.push('Ctrl+Z/Ctrl+Y调用真实研究历史；丢响应重试同一请求编号，不改变领域结构与运行记录');
  console.log('仿真输入契约回归');
  const simulationRoute=`/studies/${s.id}/simulation/inputs?workspace=${w.id}`;
  await go(simulationRoute);await page.getByRole('button',{name:'导入算例输入',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'导入仿真输入草稿'});
  await expect(dialog.getByText('输入格式已读取 · 长度 m / 温度 K / 电流 A')).toBeVisible();
  filePromise=page.waitForEvent('download');await dialog.getByRole('button',{name:'下载输入格式'}).click();file=await downloaded(filePromise);
  const contract=await api('/api/simulation/problem-contract');assert.deepEqual(JSON.parse(file.bytes.toString()),contract);
  const contracts=await api('/api/input-contracts'),method=contracts.find(x=>x.input_schema==='cablesim.simulation-problem/1'&&x.method.capability==='elmer-heat');assert.ok(method);
  const problem={schema_version:contract.schema_version,physics:'steady_heat',geometry:[{uid:'square',kind:'rectangle',values:[0,0,1,1],material:{k_w_m_k:1,source:'tests/test_host_api.py:118-123 synthetic validation input'}}],boundaries:[{uid:'outer',selector:'outer',values:[],kind:'temperature',value:293.15}],excitations:[{regions:['square'],kind:'heat_w_m',value:[1],source:'Synthetic 1 W/m source'}],provenance:{kind:'test'},assumptions:['2D fixed thermal properties; validation input only']};
  const payload=JSON.stringify({problem,parameters:{mesh:{size_m:.1,far_size_m:.2,transition_m:.3}}});
  await dialog.getByLabel('算例 JSON',{exact:true}).setInputFiles({name:'thermal-input.json',mimeType:'application/json',buffer:Buffer.from(payload)});
  await dialog.getByRole('combobox',{name:'准确方法版本'}).click();
  // Select the exact installed capability; labels may be localized but values retain the complete method pin.
  await page.getByRole('option',{name:displayName(method.method.plugin_id)+' · '+displayName(method.method.capability)+' · '+method.method.version,exact:true}).click();
  await dialog.getByLabel('来源与位置',{exact:true}).fill('tests/test_host_api.py:118–123 · 合成校验输入，不作为工程结果');
  await variants('仿真输入契约');await shot('simulation-import');
  await dialog.getByRole('button',{name:'采用输入草稿'}).click();await page.getByRole('button',{name:'保存修改',exact:true}).click();
  await expect(page.getByRole('button',{name:'保存修改',exact:true})).toHaveCount(0);
  saved=(await api(root+'/studies')).find(x=>x.id===s.id);assert.deepEqual(saved.definition.modules.simulation.method_input,problem);assert.equal(saved.definition.modules.simulation.method.release_digest,method.method.release_digest);
  await page.reload();await expect(page.getByRole('heading',{name:'固定问题输入',exact:true})).toBeVisible();
  assert.equal(report.requests.filter(r=>r.url.endsWith('/runs')).length,0);
  report.checks.push('GET输入契约原样下载、真实JSON文件导入并保存、刷新保持方法与输入；未提交求解');
  await page.route('**/simulation/problem-contract',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'输入格式暂不可用'})}));
  await go(simulationRoute);await page.getByRole('button',{name:'导入算例输入',exact:true}).click();
  await expect(dialog.getByText('输入格式暂不可用',{exact:false})).toBeVisible();
  await expect(dialog.getByRole('button',{name:'采用输入草稿'})).toBeDisabled();
  await variants('仿真契约读取失败');
  await page.unroute('**/simulation/problem-contract');
  for(const state of ['empty','loading','error']){
    let release;const gate=new Promise(resolve=>release=resolve);
    await page.route('**/workspaces/*/deliveries',async route=>{
      if(state==='loading')await gate;
      await route.fulfill({status:state==='error'?503:200,contentType:'application/json',body:JSON.stringify(state==='error'?{detail:'交付历史暂不可用'}:[])}).catch(()=>{});
    });
    try{
      await go(`/library/deliveries?workspace=${w.id}`);
      await expect(state==='empty'?page.getByText('尚无交付存档',{exact:true}):state==='loading'?page.getByText('正在读取交付历史',{exact:true}):page.getByText('交付历史暂不可用',{exact:false})).toBeVisible();
      await variants('交付历史'+state);
    }finally{release();await page.unrouteAll({behavior:'wait'});}
  }
  report.checks.push('契约读取失败禁止采用；交付历史空数据、加载和接口错误均明确显示');
  assert.deepEqual(report.errors,[]);
} catch(error){report.failure={message:error.message,page:await page.locator('body').innerText().catch(()=>'' )};throw error;}
finally{await fs.writeFile(path.join(out,'verification.json'),JSON.stringify(report,null,2));await session.close();}
console.log(JSON.stringify({checks:report.checks,states:report.states.length,errors:report.errors},null,2));
