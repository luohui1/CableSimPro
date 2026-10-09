import assert from 'node:assert/strict';
import { expect as baseExpect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { typeFixture, root } from './fixture.mjs';
import { checkLayout } from './ui-checks.mjs';

// A private SQLite backup, one page, real saved first-party plugin outputs.
process.env.E2E_DATABASE_SOURCE ||= path.join(root,'.data/release/engineering.sqlite');
const output=path.join(root,'.data/type-modules');await fs.mkdir(output,{recursive:true});
const comparisonOnly=process.env.TYPE_COMPARISON_ONLY==='1';
const fixture=await typeFixture({main:true,build:path.join(root,'frontend/dist')}),{page,context}=fixture;
const expect=baseExpect.configure({timeout:30000}),result={modules:[],plans:[],layouts:[],errors:fixture.errors,screenshots:[],runtime:fixture.runtime};
const modules=[['structure','table','结构设计'],['requirements','list','要求与标准'],['standard-check','results','标准核对'],['electrical','results','电气参数'],['short-circuit','results','短路容量'],['rating-table','results','载流量表'],['comparison','matrix','方案对比'],['specification','content','规格书 / 校核报告']];
async function visit(wid,module,tab,theme='light'){await page.goto(`${fixture.url}/types/${wid}/${module}/${tab}?theme=${theme}`);await page.waitForLoadState('networkidle');await expect(page.locator('.type-page').first()).toBeVisible();await expect.poll(()=>page.locator('.type-page').first().getAttribute('data-type-state')).not.toBe('loading');}
async function runs(wid){const all=[];for(const study of await fixture.api(`/api/workspaces/${wid}/studies`))for(const run of (await fixture.api(`/api/workspaces/${wid}/studies/${study.id}/runs`)).items)all.push({study,run});return all;}
async function runModule(wid,module,label){
  const begin=performance.now();
  const control=page.getByRole('button',{name:label,exact:true});await expect(control).toBeVisible();
  if(!await control.isEnabled()){
    const reason=(await control.locator('..').innerText()).replace(label,'').trim();assert.ok(reason,'禁止运行应有原因');
    const next=page.getByRole('button',{name:'在方法页填写参数',exact:true});
    let unavailable=reason;
    if(await next.count()){await next.click();await page.waitForLoadState('networkidle');await expect.poll(async()=>await page.locator('.parameter-form').count() || await page.getByText('方法参数契约不可用',{exact:true}).count()).toBeGreaterThan(0);if(!await page.locator('.parameter-form').count()){unavailable+='；'+await page.locator('.state-view[role=alert]').innerText();await expect(page.getByRole('button',{name:'重新读取方法',exact:true})).toBeEnabled();}}
    return {canRun:false,reason:unavailable,next:'方法参数页 / 重新读取方法 / 型号名片缺项 / 添加工况',seconds:+((performance.now()-begin)/1000).toFixed(2)};
  }
  await control.click();const dialog=page.getByRole('dialog',{name:/ · 预检$/});await expect(dialog).toBeVisible({timeout:180000});
  const confirm=dialog.getByRole('button',{name:'确认并运行',exact:true});
  const ack=dialog.getByRole('checkbox',{name:'已核对输入来源与方法适用范围',exact:true});
  if(await ack.count())await ack.check();
  if(!await confirm.isEnabled()){
    const reason=await dialog.innerText(),locate=dialog.getByRole('button',{name:/^定位/}).first();let next='方法参数 / 结构设计';
    if(await locate.count()){next=(await locate.innerText()).trim();await locate.click();}else await page.keyboard.press('Escape');
    return {canRun:false,reason,next,seconds:+((performance.now()-begin)/1000).toFixed(2)};
  }
  await confirm.click();await expect(dialog).toBeHidden({timeout:180000});
  const entries=await runs(wid),entry=entries.sort((a,b)=>b.run.created.localeCompare(a.run.created))[0];
  const current=entry?.run;assert.ok(current&&['succeeded','partial'].includes(current.status)&&current.integrity==='verified');
  return {canRun:true,run:current.id,status:current.status,method:current.snapshot.definition.method,artifacts:current.output.cases.map(c=>c.artifacts),seconds:+((performance.now()-begin)/1000).toFixed(2)};
}
async function shot(name){const file=path.join(output,name+'.png');await page.screenshot({path:file});result.screenshots.push(file);}
async function createPlan(base,name){
  await visit(base,'comparison','matrix');await page.getByRole('button',{name:'建立方案',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'建立独立型号方案',exact:true});await dialog.getByRole('textbox',{name:'方案名称',exact:true}).fill(name);await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();const wid=new URL(page.url()).pathname.split('/')[2];assert.notEqual(wid,base);return wid;
}
async function save(wid){const saving=page.waitForResponse(r=>r.url().includes(`/api/types/${wid}/document`)&&r.request().method()==='PUT'||r.url().endsWith(`/api/workspaces/${wid}/domain`)&&r.request().method()==='PUT');await page.keyboard.press('Control+s');assert.ok((await saving).ok());await expect(page.getByRole('button',{name:'保存',exact:true})).toBeDisabled();}
try{
  await page.setViewportSize({width:1366,height:768});const types=await fixture.api('/api/design/type-workspaces');
  const selected=[types.find(t=>t.name.startsWith('起帆')),types.find(t=>t.name.startsWith('YJV22'))];assert.ok(selected.every(Boolean));
  for(const type of selected){
    if(comparisonOnly)break;
    for(const [module,tab,name] of modules){
      const begin=performance.now();await visit(type.id,module,tab);let operation;
      if(module==='structure'){await page.getByRole('tab',{name:'外径与用料',exact:true}).click();operation=await runModule(type.id,'geometry','更新结构推导');}
      else if(module==='requirements'){operation=await runModule(type.id,'standard-check',await page.getByRole('button',{name:'更新要求目录',exact:true}).count()?'更新要求目录':'生成要求目录');}
      else if(module==='standard-check')operation=await runModule(type.id,module,'执行标准核对');
      else if(module==='electrical'||module==='short-circuit')operation=await runModule(type.id,module,'计算'+name);
      else if(module==='rating-table')operation=await runModule(type.id,module,'计算所选工况');
      else if(module==='comparison') {await expect(page.getByRole('button',{name:'建立方案',exact:true})).toBeEnabled();operation={canRun:true,result:'可从已保存基准建立独立方案',next:'建立方案'};}
      else {await expect(page.getByRole('button',{name:'生成规格书',exact:true})).toBeEnabled();const downloaded=page.waitForEvent('download',{timeout:180000});downloaded.catch(()=>{});await page.getByRole('button',{name:'生成规格书',exact:true}).click();await expect.poll(async()=>await page.getByRole('button',{name:'生成规格书',exact:true}).getAttribute('aria-busy'),{timeout:180000}).not.toBe('true');const alert=page.locator('[role=alert]');if(await alert.count()){operation={canRun:false,reason:await alert.innerText(),next:await alert.getByRole('button').allTextContents()};}else {await(await downloaded).saveAs(path.join(output,(type.name.startsWith('起帆')?'qifan':'yjv')+'-specification.pdf'));operation={canRun:true,result:'生成真实结果规格书草稿'};}}
      const body=(await page.locator('.workbench').innerText()).slice(0,6500);assert.ok(!body.includes('Application error'));result.modules.push({type:type.name,module:name,...operation,totalSeconds:+((performance.now()-begin)/1000).toFixed(2),visibleConclusion:body});console.log(type.name+' · '+name+' · '+(operation.canRun?'完成':'明确缺项 / 范围拒绝'));
    }
    await page.goto(`${fixture.url}/types?create=1&theme=light`);await expect(page.getByRole('dialog',{name:'新建型号设计',exact:true})).toBeVisible();
    for(const name of ['从型号库复制','按标准生成','从资料导入','空白'])await expect(page.getByRole('dialog').getByText(name,{exact:true})).toBeVisible();
    result.modules.push({type:type.name,module:'新建入口',canRun:true,result:'四个起点可见；完整创建回归由 verify-creation 覆盖'});await page.keyboard.press('Escape');
  }
  const base=selected[1].id,baseline=await fixture.api(`/api/workspaces/${base}`),started=performance.now();
  if(comparisonOnly){await visit(base,'structure','quantities');assert.ok((await runModule(base,'geometry','更新结构推导')).canRun);await visit(base,'standard-check','results');assert.ok((await runModule(base,'standard-check','执行标准核对')).canRun);}
  const a=await createPlan(base,'绝缘加厚方案'),b=await createPlan(base,'外护套加厚方案');
  for(const [wid,role,delta] of [[a,'insulation',.2],[b,'oversheath',.2]]){
    const workspace=await fixture.api(`/api/workspaces/${wid}`),cable=workspace.domain.cable_types[0];
    await visit(wid,'structure','table');const label=role==='insulation'?'绝缘厚度':'外护套厚度',fields=page.getByRole('table',{name:'型号分层',exact:true}).getByRole('textbox',{name:label,exact:true});
    const layers=role==='insulation'?cable.cores.map(c=>c.layers.find(l=>l.role===role)):[cable.common_layers.find(l=>l.role===role)];assert.equal(await fields.count(),layers.length);
    for(let i=0;i<layers.length;i++){await fields.nth(i).fill(String(+(layers[i].thickness*1000+delta).toFixed(3)));await fields.nth(i).press('Enter');}
    await save(wid);await page.getByRole('tab',{name:'外径与用料',exact:true}).click();const geometry=await runModule(wid,'geometry','更新结构推导');assert.ok(geometry.canRun);
    await visit(wid,'standard-check','results');const standards=await runModule(wid,'standard-check','执行标准核对');assert.ok(standards.canRun);result.plans.push({name:role,wid,geometry,standards});
  }
  const data=await fixture.api(`/api/types/${base}/comparison`);assert.equal(data.items.length,3);assert.ok(data.requirements.length>0);
  for(const item of data.items)assert.equal(Object.keys(item.requirements).length,data.requirements.length);
  assert.ok(data.items.some(item=>Object.values(item.requirements).some(r=>r.verdict==='uncovered'||r.verdict==='missing')));
  assert.deepEqual((await fixture.api(`/api/workspaces/${base}`)).domain,baseline.domain);
  await visit(base,'comparison','matrix');await expect(page.getByRole('table',{name:'全部适用要求对比',exact:true})).toBeVisible();
  const summary=page.getByRole('table',{name:'方案结果矩阵',exact:true});await expect(summary.getByText('外径',{exact:true})).toBeInViewport();await expect(summary.getByText('单位长度用料',{exact:true})).toBeInViewport();await shot('comparison-matrix');
  await page.getByRole('tab',{name:'参数差异',exact:true}).click();await expect(page.getByRole('table',{name:'方案参数差异',exact:true})).toBeVisible();
  await page.getByRole('tab',{name:'结果矩阵',exact:true}).click();await page.getByRole('combobox',{name:'采纳方案',exact:true}).click();await page.getByRole('option',{name:'绝缘加厚方案',exact:true}).click();
  await page.getByRole('button',{name:'采纳为新版本草稿',exact:true}).click();const adopt=page.getByRole('dialog',{name:'采纳为新版本草稿',exact:true});await expect(adopt.getByRole('button',{name:'确认采纳',exact:true})).toBeDisabled();await page.keyboard.press('Escape');await expect(adopt).toBeHidden();
  await page.getByRole('button',{name:'采纳为新版本草稿',exact:true}).click();await adopt.getByRole('checkbox').check();await adopt.getByRole('button',{name:'确认采纳',exact:true}).click();await expect(adopt).toBeHidden();
  await page.getByRole('button',{name:'打开新草稿规格书',exact:true}).click();await expect(page).toHaveURL(new RegExp('/types/'+a+'/specification/'));
  const spec=await fixture.api(`/api/types/${a}/specification`);assert.equal(spec.payload.plan_reference.status,'version_draft');assert.equal(spec.lifecycle.approval,null);assert.equal(spec.ready,false);assert.ok(spec.html.includes('绝缘加厚方案')&&spec.html.includes('新版本草稿'));
  result.adoption={wid:a,status:spec.payload.plan_reference.status,revision:spec.payload.revision,sources:spec.payload.sources,checks:spec.payload.checks,seconds:+((performance.now()-started)/1000).toFixed(2)};
  await fs.writeFile(path.join(output,'comparison.json'),JSON.stringify(data,null,2));await fs.writeFile(path.join(output,'adopted-specification.json'),JSON.stringify(spec,null,2));
  for(const width of [1366,1920])for(const theme of ['light','dark'])for(const tab of ['matrix','parameters','geometry']){await page.setViewportSize({width,height:width===1366?768:1080});await visit(base,'comparison',tab,theme);result.layouts.push({tab,theme,...await checkLayout(page)});}
  let mode='empty',release;const pattern=`**/api/types/${base}/comparison`;
  await context.route(pattern,async route=>{if(mode==='loading')await new Promise(resolve=>release=resolve);if(mode==='error')return route.fulfill({status:503,json:{detail:'验收故障注入：方案读取失败'}});const value=structuredClone(data);if(mode==='empty')value.items=value.items.slice(0,1);if(mode==='historical')for(const item of value.items)for(const metric of Object.values(item.values))metric.state='historical';return route.fulfill({json:value});});
  try{for(const width of [1366,1920])for(const theme of ['light','dark'])for(const state of ['empty','loading','error','success','historical']){release?.();mode=state;await page.setViewportSize({width,height:width===1366?768:1080});await page.goto(`${fixture.url}/types/${base}/comparison/matrix?theme=${theme}`);await expect(page.locator('[data-type-page=comparison-results]')).toHaveAttribute('data-type-state',state);result.layouts.push({state,theme,...await checkLayout(page)});release?.();}}finally{release?.();await context.unroute(pattern);}
  await page.setViewportSize({width:1366,height:768});await visit(selected[0].id,'electrical','parameters');await shot('electrical-parameters');
  assert.deepEqual(fixture.errors,[]);
}catch(error){result.failure=String(error.stack||error);result.backendLog=fixture.log();console.error(result.failure);console.error((await page.locator('body').innerText()).slice(-6000));process.exitCode=1;}
finally{await fs.writeFile(path.join(output,comparisonOnly?'comparison-verification.json':'verification.json'),JSON.stringify(result,null,2));await fixture.close();}
