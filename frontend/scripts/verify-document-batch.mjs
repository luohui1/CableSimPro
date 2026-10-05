import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {expect as baseExpect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {openHeadlessBrowser,settle,outputRoot,repositoryRoot} from './browser.mjs';
import {assertLayout} from './layout-assertions.mjs';
if(process.env.E2E_ISOLATED!=='1')throw Error('仅允许隔离数据库');
const base=process.env.FRONTEND_URL, expect=baseExpect.configure({timeout:30000});
const out=path.join(outputRoot,'batch-review');await fs.mkdir(out,{recursive:true});
const session=await openHeadlessBrowser(),{page,context}=session,report={checks:[],states:[],errors:[]};
page.on('pageerror',e=>report.errors.push(e.message));
async function api(p,body){const r=await fetch(base+p,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const data=await r.json();assert.ok(r.ok,p+JSON.stringify(data));return data;}
async function variants(label){for(const viewport of [{width:1366,height:768},{width:1920,height:1080}]){await page.setViewportSize(viewport);for(const theme of ['light','dark']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.waitForTimeout(80);await assertLayout(page,label);const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.deepEqual(axe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[]);report.states.push({label,theme,...viewport});}}await page.setViewportSize({width:1366,height:768});await page.evaluate(()=>document.documentElement.dataset.theme='light');}
async function saveKey(key){const response=page.waitForResponse(r=>r.url().endsWith('/reviews')&&r.request().method()==='POST');await page.locator('[data-candidate-id][aria-pressed=true]').focus();await page.keyboard.press(key);const r=await response;assert.equal(r.status(),200);return r.json();}
try{
  const fixture=JSON.parse(await fs.readFile(path.join(repositoryRoot,'plugins/cablesim.datasheet-extract/validation/batch-example.json'),'utf8')),source=fixture.source;
  const file=path.join(repositoryRoot,'.data/datasheet-import/sources',source.file);
  assert.equal(createHash('sha256').update(await fs.readFile(file)).digest('hex'),source.sha256);
  await page.goto(base+'/library/documents');await settle(page);
  const uploaded=page.waitForResponse(r=>r.url().endsWith('/api/documents')&&r.request().method()==='POST',{timeout:120000});await page.getByLabel('上传 PDF 文件').setInputFiles(file);assert.equal((await uploaded).status(),201);const doc=(await api('/api/documents')).find(d=>d.sha256===source.sha256);assert.ok(doc?.id);console.log('真实厂家原件已上传');
  const runs=[];
  for(const row of fixture.rows){let run=await api(`/api/documents/${doc.id}/extractions`,{request_id:randomUUID(),method:'rules',model:{designation:source.designation,specification:String(row.area_mm2),identity_note:'Bahra single-core copper CU/XLPE/LC/PVC 6/10 kV, lead sheathed'},selections:source.selections});
    await expect.poll(async()=>{run=await api(`/api/documents/${doc.id}/extractions/${run.id}`);return run.status;},{timeout:120000}).toBe('succeeded');
    assert.equal(run.result.provider_calls.length,0);for(const c of run.result.candidates){const i=fixture.fields.indexOf(c.field);assert.ok(i>=0);assert.equal(c.raw_value,row.values[i]);assert.ok(Math.abs(c.value_si-row.values[i]*.001)<1e-10);}
    runs.push(run);
    console.log('提取 '+row.area_mm2+' mm²：'+run.result.candidates.length+' 项');
  }
  await page.goto(base+`/library/documents?document=${doc.id}&extraction=${runs[0].id}`);await settle(page);
  await expect(page.getByRole('combobox',{name:'规格',exact:true}).locator('option')).toHaveCount(5);
  const firstForm=page.getByRole('form',{name:'逐项核对'});await firstForm.getByLabel('核对人',{exact:true}).fill('批量验收工程师');
  const sheath=runs[0].result.candidates.find(c=>c.field==='oversheath_thickness');await page.locator(`[data-candidate-id="${sheath.id}"]`).click();await expect(page.locator(`[data-candidate-id="${sheath.id}"]`).locator('xpath=../..')).toContainText('2.0 mm');
  await page.locator('[data-candidate-id][aria-pressed=true]').focus();const before=await page.locator('[data-candidate-id][aria-pressed=true]').getAttribute('data-candidate-id');await page.keyboard.press('j');assert.notEqual(await page.locator('[data-candidate-id][aria-pressed=true]').getAttribute('data-candidate-id'),before);await page.keyboard.press('k');assert.equal(await page.locator('[data-candidate-id][aria-pressed=true]').getAttribute('data-candidate-id'),before);
  await firstForm.getByLabel('核对理由',{exact:true}).fill('逐项核对，演示拒绝键');let reviewed=await saveKey('x');assert.equal(reviewed.reviews.find(r=>r.candidate_id===before).action,'reject');
  await firstForm.getByLabel('核对理由',{exact:true}).fill('复查原件 2.0 mm，逐项确认');reviewed=await saveKey('Enter');assert.equal(reviewed.reviews.find(r=>r.candidate_id===before).action,'accept');
  report.checks.push('2.0 mm 原文精度、J/K 双向切换、X 拒绝与 Enter 接受');
  for(let i=0;i<runs.length;i++){
    if(i){const select=page.getByRole('combobox',{name:'规格',exact:true});const option=select.locator('option').filter({hasText:' · '+fixture.rows[i].area_mm2+' · '});await select.selectOption(await option.getAttribute('value'));}
    await expect(page.getByRole('button',{name:/确认本规格 [1-9]/})).toBeEnabled();
    await page.getByRole('form',{name:'逐项核对'}).getByLabel('核对人',{exact:true}).fill('批量验收工程师');
    const response=page.waitForResponse(r=>r.url().endsWith('/reviews')&&r.request().method()==='POST');await page.locator('[data-candidate-id][aria-pressed=true]').focus();await page.keyboard.press('a');let accepted=await(await response).json();assert.ok(accepted.reviews.length>=5 && accepted.reviews.length<=7);assert.ok(accepted.reviews.every(r=>r.action==='accept'));
    const remaining=accepted.result.candidates.filter(c=>!accepted.reviews.some(r=>r.candidate_id===c.id));
    for(const c of remaining){await page.locator(`[data-candidate-id="${c.id}"]`).click();await page.getByRole('form',{name:'逐项核对'}).getByLabel('核对理由',{exact:true}).fill('原件区域无法自动逐字匹配，按标注值逐项人工核对');accepted=await saveKey('Enter');}
    assert.equal(accepted.reviews.length,7);console.log('规格 '+fixture.rows[i].area_mm2+' 完成：'+(7-remaining.length)+' 项批量或已核对，'+remaining.length+' 项逐项核对');
    if(i===0){await variants('批量核对成功');await page.locator('.main-content').evaluate(e=>e.scrollTop=0);await page.screenshot({path:path.join(out,'review.png')});}
    await page.getByRole('button',{name:'准备提案',exact:true}).click();const form=page.getByRole('form',{name:'型号草稿提案'});
    for(const [label,value] of [['型号名称',`Bahra 6/10kV 1×${fixture.rows[i].area_mm2}`],['厂家','Bahra'],['相对地电压（kV）','6'],['额定电压（kV）','10'],['芯数','1'],['每芯截面（mm²）',String(fixture.rows[i].area_mm2)],['身份信息原文依据','Bahra PDF20–21，铜单芯铅套 6/10kV，截面 '+fixture.rows[i].area_mm2+' mm²'],['新版本名称','批量核对稿']])await form.getByLabel(label,{exact:true}).fill(value);
    await form.getByRole('button',{name:'加入多规格批量',exact:true}).click();
  }
  const modelCount=(await api('/api/domain-cable-models')).length;
  let posts=0,batchPost;await context.route('**/batches',async route=>{if(route.request().method()!=='POST')return route.fallback();posts++;if(posts===1){batchPost=route.request().postDataJSON();await route.fetch();return route.abort('failed');}assert.equal(route.request().postDataJSON().request_id,batchPost.request_id);return route.fallback();});
  await page.getByRole('button',{name:'生成 5 个规格提案',exact:true}).click();await expect(page.locator('.document-batch [role=alert]')).toBeVisible();await variants('批量提案断线错误');
  const proposed=page.waitForResponse(r=>r.url().endsWith('/batches')&&r.request().method()==='POST');await page.getByRole('button',{name:'生成 5 个规格提案',exact:true}).click();const batch=await(await proposed).json();assert.equal(batch.proposals.length,5);assert.equal((await api('/api/domain-cable-models')).length,modelCount);await context.unroute('**/batches');
  await page.getByRole('button',{name:'核对并批准整批',exact:true}).click();const dialog=page.getByRole('dialog',{name:'批准多规格型号草稿'});await expect(dialog.getByRole('button',{name:'批准并生成 5 个草稿',exact:true})).toBeDisabled();await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(page.getByRole('button',{name:'核对并批准整批',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'核对并批准整批',exact:true}).click();await dialog.getByLabel('批量批准人').fill('人工批准验收');await dialog.getByRole('checkbox').check();const approved=page.waitForResponse(r=>r.url().endsWith('/approval')&&r.request().method()==='POST');await dialog.getByRole('button',{name:'批准并生成 5 个草稿',exact:true}).click();assert.equal((await(await approved).json()).status,'approved');await expect(page.getByRole('heading',{name:'批量型号草稿已生成',exact:true})).toBeVisible();
  const models=await api('/api/domain-cable-models');assert.equal(models.length,modelCount+5);for(const proposal of batch.proposals){const model=models.find(m=>m.payload.name===proposal.draft.name);assert.equal(model.payload.confirmed,false);assert.equal(model.state,'incomplete');}
  await variants('多规格草稿批准成功');await page.locator('.main-content').evaluate(e=>e.scrollTop=0);await page.screenshot({path:path.join(out,'proposal.png')});await page.reload();await expect(page.getByRole('heading',{name:'批量型号草稿已生成',exact:true})).toBeVisible();
  report.checks.push('5 个真实规格、35 项候选、SI 对拍、批量响应丢失幂等重试、批准门禁、5 个未发布草稿、刷新恢复批量提案、Esc 及焦点归还');
  // Fault injection checks the client gate; successful batch values above are
  // unmodified plugin output. These added ambiguity/geometry faults are not data.
  let guarded=await api(`/api/documents/${doc.id}/extractions`,{request_id:randomUUID(),method:'rules',model:runs[0].result.model,selections:source.selections});
  await expect.poll(async()=>{guarded=await api(`/api/documents/${doc.id}/extractions/${guarded.id}`);return guarded.status;},{timeout:120000}).toBe('succeeded');
  const denied=guarded.result.candidates.slice(0,3).map(c=>c.id), routePattern=`**/extractions/${guarded.id}`;
  await context.route(routePattern,async route=>{const r=await route.fetch(),data=await r.json();data.result.candidates[0].ambiguities=['测试注入：待人工消歧'];data.result.candidates[1].bbox_pt=[0,0,10,10];data.result.candidates[2].raw_value+=1;await route.fulfill({response:r,json:data});});
  await page.goto(base+`/library/documents?document=${doc.id}&extraction=${guarded.id}`);await settle(page);
  await page.getByRole('form',{name:'逐项核对'}).getByLabel('核对人',{exact:true}).fill('门禁验收');
  const gate=page.waitForResponse(r=>r.url().endsWith('/reviews')&&r.request().method()==='POST');await page.getByRole('button',{name:/确认本规格 [1-9]/}).click();const response=await gate;const decisions=response.request().postDataJSON().decisions;
  assert.ok(decisions.length>0 && decisions.every(d=>!denied.includes(d.candidate_id)));await context.unroute(routePattern);
  report.checks.push('注入歧义、错位高亮及原文数值不一致后，A 请求排除这三项，保留逐项核对');
  assert.deepEqual(report.errors,[]);console.log(JSON.stringify(report));
}catch(e){report.failure=String(e);report.visible=await page.locator('body').innerText().catch(()=> 'closed');throw e;}finally{await fs.writeFile(path.join(out,'verification.json'),JSON.stringify(report,null,2));await session.close();}
