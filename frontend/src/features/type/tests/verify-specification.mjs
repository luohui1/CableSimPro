import { expect as baseExpect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { typeFixture, output, root } from './fixture.mjs';
import { checkLayout } from './ui-checks.mjs';

const expect=baseExpect.configure({timeout:25000}),fixture=await typeFixture({main:process.env.TYPE_E2E_MAIN==='1'}),{page,context}=fixture;
const result={workflows:[],layouts:[],states:{specification:[],requirements:[]},pdf:{},screenshots:[],errors:fixture.errors};
async function visit(wid,module,tab,width=1366,theme='light'){await page.setViewportSize({width,height:width===1366?768:1080});await page.goto(`${fixture.url}/types/${wid}/${module}/${tab}?theme=${theme}`);}
async function state(module,expected){await expect(page.locator(`[data-type-page=${module}-results]`)).toHaveAttribute('data-type-state',expected);result.states[module].push(expected);result.layouts.push({module,state:expected,...await checkLayout(page)});}
async function shot(name){await page.evaluate(()=>document.fonts.ready);const file=path.join(output,'screenshots',name+'.png');await page.screenshot({path:file});result.screenshots.push(file);}
async function edition(name){await page.getByRole('combobox',{name:'文档版本',exact:true}).click();await page.getByRole('option',{name,exact:true}).click();await expect(page.frameLocator('iframe').getByRole('heading',{name:'产品规格书',exact:true})).toBeVisible();}
async function pdf(download,audience,digest){const file=path.join(output,`specification-${audience}.pdf`);await download.saveAs(file);const checked=spawnSync(path.join(root,'.venv/Scripts/python.exe'),[path.join(root,'frontend/src/features/type/tests/check-pdf.py'),file,digest,audience],{encoding:'utf8',windowsHide:true});expect(checked.status,checked.stderr||checked.stdout).toBe(0);result.pdf[audience]={file,...JSON.parse(checked.stdout)};}
try{
  const catalog=await fixture.api('/api/design/cable-models'),model=catalog.find(item=>item.id==='system.specification-cu-xlpe-al-400');
  expect(model).toBeTruthy();
  const initial=await fixture.api('/api/design/type-workspaces','POST',{model_id:model.id,content_sha256:model.content_sha256}),wid=initial.id;
  await page.goto(`${fixture.url}/types/${wid}/requirements`);await state('requirements','empty');
  for(const width of [1366,1920])for(const theme of ['light','dark'])for(const module of ['specification','requirements']){await visit(wid,module,module==='requirements'?'list':'preview',width,theme);await state(module,'empty');}
  await visit(wid,'specification','preview');
  await state('specification','empty');
  await expect(page.getByRole('combobox',{name:'文档版本',exact:true})).toContainText('客户版');
  const download=page.waitForEvent('download',{timeout:180000});
  download.catch(()=>{});
  const generation=page.waitForResponse(response=>response.url().endsWith(`/api/types/${wid}/specification/generate`)&&response.request().method()==='POST',{timeout:180000});
  await expect(page.getByRole('button',{name:'生成规格书',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'生成规格书',exact:true}).focus();await page.keyboard.press('Enter');
  await expect(page.getByRole('button',{name:'生成规格书',exact:true})).toBeDisabled();
  await expect(page.locator('[data-type-page=specification-results]')).toHaveAttribute('data-type-state','loading');
  const generated=await generation;expect(generated.ok()).toBe(true);const generationResult=await generated.json();expect(generationResult.status,JSON.stringify(generationResult)).toBe('generated');
  const downloaded=await download;await state('specification','success');
  const spec=await fixture.api(`/api/types/${wid}/specification`);
  await pdf(downloaded,'customer',spec.digest);
  const after=await fixture.api(`/api/workspaces/${wid}`);expect(after.domain).toEqual(initial.domain);expect(after.revision).toBe(initial.revision);
  expect(after.domain.measurements).toEqual([]);
  for(const channel of ['geometry','electrical','rating','short_circuit','standards'])expect(spec.payload.results[channel]).toBeTruthy();
  expect(spec.ready).toBe(false);expect(spec.lifecycle.approval).toBeNull();
  const studies=await fixture.api(`/api/workspaces/${wid}/studies`),runIds=[];
  for(const study of studies){const runs=(await fixture.api(`/api/workspaces/${wid}/studies/${study.id}/runs`)).items;for(const run of runs){expect(run.integrity).toBe('verified');expect(run.freshness).toBe('current');runIds.push(run.id);}}
  expect(runIds).toHaveLength(5);
  result.workflows.push({name:'Enter一键预检、五项真实保存运行、客户PDF自动下载；原始输入不变且未伪造实测',wid,revision:after.revision,runIds});
  await shot('specification-customer');
  const repeat=page.waitForEvent('download',{timeout:90000});await page.getByRole('button',{name:'生成规格书',exact:true}).click();await repeat;
  for(const study of studies)expect((await fixture.api(`/api/workspaces/${wid}/studies/${study.id}/runs`)).items).toHaveLength(1);
  result.workflows.push({name:'重复生成复用当前结果，五项运行未重复执行'});
  await edition('内部审核版');
  const frame=page.frameLocator('iframe[title="正式规格书预览"]');
  await expect(frame.getByRole('heading',{name:'发布前待完成事项',exact:true})).toBeVisible();
  await expect(frame.locator('[data-specification-inapplicable]')).toHaveCount(1);
  expect(await frame.locator('[data-specification-inapplicable]').getAttribute('open')).toBeNull();
  const internalDownload=page.waitForEvent('download');await page.getByRole('button',{name:'导出内部审核稿',exact:true}).click();await pdf(await internalDownload,'internal',spec.digest);
  await shot('specification-internal');
  result.workflows.push({name:'客户/内部版本隔离，内部保留偏离、来源摘要和折叠不适用清单'});
  for(const width of [1366,1920])for(const theme of ['light','dark']){
    for(const tab of ['content','preview','review','revisions']){await visit(wid,'specification',tab,width,theme);await state('specification','success');}
    for(const tab of ['list','standards','pending']){await visit(wid,'requirements',tab,width,theme);await state('requirements','success');}
  }
  await visit(wid,'requirements','list');
  const source=spec.payload.sources.find(source=>source.channel==='standards'),ledger=await fixture.api(`/api/design/type-workspaces/${wid}/requirements?run_id=${source.run_id}`);
  const bound=ledger.items.find(item=>item.bindable);expect(bound).toBeTruthy();
  await page.getByRole('row',{name:bound.definition.title,exact:true}).click();
  await expect(page.getByRole('heading',{name:bound.definition.title,exact:true})).toBeVisible();
  await page.getByRole('checkbox',{name:'选择'+bound.definition.title,exact:true}).check();
  await shot('requirements-list');
  await page.getByRole('button',{name:'批准所选要求',exact:true}).click();
  const approval=page.getByRole('dialog',{name:'批准所选要求',exact:true});
  await expect(approval.getByRole('button',{name:'批准所选要求',exact:true})).toBeDisabled();
  await approval.getByRole('textbox',{name:'审批人',exact:true}).fill('隔离界面门禁验证');
  await approval.getByRole('checkbox',{name:'本人已核对所选要求的来源和判定绑定',exact:true}).check();
  const requests=[];
  await context.route('**/requirements/reviews',async route=>{requests.push(route.request().postDataJSON());await route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({detail:'验收拒绝代替人工批准'})});});
  await approval.getByRole('button',{name:'批准所选要求',exact:true}).click();await expect(approval.getByRole('alert')).toContainText('拒绝代替人工批准');
  expect(requests).toHaveLength(1);expect(requests[0].row_ids).toEqual([bound.row_id]);
  await page.keyboard.press('Escape');await context.unroute('**/requirements/reviews');
  expect((await fixture.api(`/api/design/type-workspaces/${wid}/requirements?run_id=${source.run_id}`)).approved_count).toBe(0);
  result.workflows.push({name:'要求清单/执行标准/待批准导入、条款定位、人工门禁与403保留；没有代替人工批准'});
  await visit(wid,'specification','review');
  for(const label of ['采纳为版本草稿','提交评审']){
    await page.getByRole('button',{name:label,exact:true}).click();const dialog=page.getByRole('dialog',{name:label,exact:true});
    if(label==='提交评审'){await dialog.getByRole('textbox',{name:'变更摘要',exact:true}).fill('首次编制规格书；声明结构、电气、短路与三个地下工况的设计计算值');await dialog.getByRole('textbox',{name:'编制人',exact:true}).fill('演示文档编制');}
    await dialog.getByRole('checkbox',{name:'已核对当前版本与提交前校核清单',exact:true}).check();await dialog.getByRole('button',{name:label,exact:true}).click();await expect(dialog).not.toBeVisible();
  }
  await expect(page.getByRole('button',{name:'人工批准',exact:true})).toBeDisabled();
  const reviewed=await fixture.api(`/api/types/${wid}/specification`);expect(reviewed.payload.revisions).toHaveLength(1);expect(reviewed.payload.revisions[0].author).toBe('演示文档编制');expect(reviewed.lifecycle.stale).toBe(false);
  await fs.writeFile(path.join(output,'specification-source.json'),JSON.stringify(reviewed));
  await visit(wid,'specification','revisions');await expect(page.getByRole('table',{name:'文档修订记录',exact:true})).toBeVisible();
  expect(await page.getByRole('table',{name:'文档修订记录',exact:true}).innerText()).not.toMatch(/保存领域文档|保存研究/);
  // Deliver the same reviewed content in both editions, with no approval or publication.
  await visit(wid,'specification','preview');const customerReviewed=page.waitForEvent('download');await page.getByRole('button',{name:'生成规格书',exact:true}).click();await pdf(await customerReviewed,'customer',reviewed.digest);
  await edition('内部审核版');const internalReviewed=page.waitForEvent('download');await page.getByRole('button',{name:'导出内部审核稿',exact:true}).click();await pdf(await internalReviewed,'internal',reviewed.digest);
  result.workflows.push({name:'提交生成一次正式文档修订；含版本、摘要、编制人、日期；未覆盖仍阻止发布',revision:reviewed.payload.revisions[0]});
  const edited=structuredClone(after.domain);edited.name+=' · 历史校核';await fixture.api(`/api/workspaces/${wid}/domain`,'PUT',{expected_revision:after.revision,document:edited});
  expect((await fixture.api(`/api/types/${wid}/specification`)).payload.revisions).toEqual(reviewed.payload.revisions);
  for(const width of [1366,1920])for(const theme of ['light','dark'])for(const module of ['specification','requirements']){await visit(wid,module,module==='requirements'?'list':'preview',width,theme);await state(module,'historical');if(module==='requirements')await expect(page.getByRole('button',{name:'批准所选要求',exact:true})).toBeDisabled();}
  for(const module of ['specification','requirements'])for(const kind of ['loading','error'])for(const width of [1366,1920])for(const theme of ['light','dark']){
    const pattern=module==='specification'?`**/api/types/${wid}/specification?*`:`**/api/workspaces/${wid}/studies`;
    await context.route(pattern,async route=>{if(kind==='loading'){await new Promise(resolve=>setTimeout(resolve,1800));return route.continue();}return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'读取连接中断；保存输入仍保留'})});});
    await visit(wid,module,module==='requirements'?'list':'preview',width,theme);await state(module,kind);await context.unroute(pattern);
  }
  expect(fixture.errors).toEqual([]);
}catch(error){result.failure=String(error.stack||error);result.backendLog=fixture.log();console.error(result.failure);console.error(page.url());console.error((await page.locator('body').innerText()).slice(0,2800));await shot('specification-failure').catch(()=>{});process.exitCode=1;}
finally{for(const module of Object.keys(result.states))result.states[module]=[...new Set(result.states[module])];await fs.writeFile(path.join(output,'specification-verification.json'),JSON.stringify(result,null,2));await fixture.close();}
