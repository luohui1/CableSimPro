import assert from 'node:assert/strict';
import { expect as baseExpect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { typeFixture, root } from './fixture.mjs';
import { checkLayout } from './ui-checks.mjs';

// One browser page and private SQLite copy. All calculation evidence is real saved plugin output.
process.env.E2E_DATABASE_SOURCE ||= path.join(root,'.data/release/engineering.sqlite');
const output=path.join(root,'.data/type-modification');await fs.mkdir(output,{recursive:true});
const fixture=await typeFixture({main:true,build:path.join(root,'frontend/dist')}),{page,context}=fixture;
const expect=baseExpect.configure({timeout:30000}),started=performance.now();
const result={steps:[],layouts:[],threeSecondChecks:[],clicks:0,keyboardActions:0,blockers:[],fixes:[
  '规格书编辑态即时标为历史；保存输入与方法后刷新规格书、方案对照和保存运行缓存',
  '删除结构页重复历史提示；用料历史提示给出保存与更新结构推导入口',
  '客户核对表保留缺项、未覆盖与原始余量；PDF补入保存轮廓、材料版本、用料和来源版本',
  '型号属性栏复用Agent页签，切换输入不丢会话'
],harnessCorrections:['按公共控件的关联label定位输入','等待保存响应后读取新修订','单芯绝缘位于共同层','手算用料包含所有外侧层半径变化'],screenshots:[],errors:fixture.errors};
let release;
async function click(locator){result.clicks++;await locator.click();}
async function key(value){result.keyboardActions++;await page.keyboard.press(value);}
async function timed(name,work){const begin=performance.now();const value=await work();result.steps.push({name,elapsedSeconds:+((performance.now()-begin)/1000).toFixed(2),clicks:result.clicks,keyboardActions:result.keyboardActions});console.log(name);return value;}
async function readable(purpose,conclusion,next){const begin=performance.now();await expect(conclusion).toBeVisible();await expect(next).toBeEnabled();const nextLabel=(await next.innerText()).trim()||await next.evaluate(node=>node.labels?.[0]?.textContent||node.getAttribute('aria-label')||'数值输入');result.threeSecondChecks.push({purpose,conclusion:(await conclusion.innerText()).slice(0,300),next:nextLabel,elapsedSeconds:+((performance.now()-begin)/1000).toFixed(2),kind:'自动可见性与下一步检查；未代替人工3秒测试'});}
const runArtifacts=(spec,channel)=>spec.payload.results[channel].artifact;
try{
  const models=await fixture.api('/api/design/cable-models'),model=models.find(m=>m.id==='system.specification-cu-xlpe-al-400');assert.ok(model);
  const workspace=await fixture.api('/api/design/type-workspaces','POST',{model_id:model.id,content_sha256:model.content_sha256}),wid=workspace.id;
  const initial=await timed('隔离库准备：五项真实保存运行（不计入用户操作）',()=>fixture.api(`/api/types/${wid}/specification/generate`,'POST',{expected_revision:workspace.revision,request_id:crypto.randomUUID(),audience:'customer',scope_acknowledged:true}));assert.equal(initial.status,'generated');
  const before=await fixture.api(`/api/types/${wid}/specification`),old=runArtifacts(before,'geometry');
  const scenarioStart=performance.now();
  await timed('打开型号并修改绝缘厚度',async()=>{
    await page.setViewportSize({width:1366,height:768});await page.goto(`${fixture.url}/types/${wid}/structure/table?theme=light`);
    const field=page.locator('.workbench-dock').getByLabel('绝缘厚度',{exact:true});await expect(field).toBeVisible();
    await readable('结构设计：修改绝缘厚度',page.getByRole('tab',{name:'分层表',exact:true}),field);
    await field.fill('5.8');await key('Enter');
    await expect(page.getByText('结构修改待保存；已保存的外径、用料和校核结果已标为历史。',{exact:true})).toHaveCount(1);
    const browser=page.getByRole('navigation',{name:'型号浏览器'});
    for(const name of ['标准核对','电气参数','短路容量','载流量表','规格书'])await expect(browser.getByRole('button',{name:new RegExp('^'+name)})).toContainText('过期');
  });
  await timed('未保存修改：用料和规格书即时标为历史',async()=>{
    await click(page.getByRole('tab',{name:'外径与用料',exact:true}));
    await expect(page.locator('[data-type-page=quantities]')).toHaveAttribute('data-type-state','historical');
    await expect(page.getByRole('button',{name:'更新结构推导',exact:true})).toBeDisabled();
    await click(page.getByRole('navigation',{name:'型号浏览器'}).getByRole('button',{name:/^规格书/}));
    await expect(page.locator('[data-type-page=specification-results]')).toHaveAttribute('data-type-state','historical');
    await expect(page.getByRole('button',{name:'生成规格书',exact:true})).toBeDisabled();
    const saving=page.waitForResponse(response=>response.url().endsWith(`/api/workspaces/${wid}/domain`)&&response.request().method()==='PUT');
    await key('Control+s');assert.ok((await saving).ok());await expect(page.getByText('已保存 · 演示',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'保存',exact:true})).toBeDisabled();
    await expect(page.locator('[data-type-page=specification-results]')).toHaveAttribute('data-type-state','historical');
  });
  const saved=await fixture.api(`/api/workspaces/${wid}`);assert.equal(saved.revision,workspace.revision+1);
  const savedCable=saved.domain.cable_types[0];assert.equal([...savedCable.cores.flatMap(c=>c.layers),...savedCable.common_layers].find(l=>l.role==='insulation').thickness,.0058);
  async function runModule(module,label){
    if(module.startsWith('structure/')){
      await click(page.getByRole('navigation',{name:'型号浏览器'}).getByRole('region',{name:'结构',exact:true}).getByRole('button'));
      await click(page.getByRole('tab',{name:'外径与用料',exact:true}));
    }else await click(page.getByRole('navigation',{name:'型号浏览器'}).getByRole('button',{name:/^标准核对/}));
    await readable(label+'：历史结果需要重算',page.locator('.stale-banner').first(),page.getByRole('button',{name:label,exact:true}));
    await click(page.getByRole('button',{name:label,exact:true}));const dialog=page.getByRole('dialog',{name:label+' · 预检',exact:true});
    await expect(dialog).toBeVisible();result.clicks++;await dialog.getByRole('checkbox',{name:'已核对输入来源与方法适用范围',exact:true}).check();
    await click(dialog.getByRole('button',{name:'确认并运行',exact:true}));await expect(dialog).toBeHidden({timeout:180000});
  }
  await timed('更新外径与用料：真实实体推导',()=>runModule('structure/quantities','更新结构推导'));
  const afterGeometry=await fixture.api(`/api/types/${wid}/specification`),updated=runArtifacts(afterGeometry,'geometry');
  const delta=.0058-.0055;assert.ok(Math.abs(updated.outer_diameter_m-old.outer_diameter_m-2*delta)<1e-9);
  const oldLayer=old.layers.find(l=>l.role==='insulation'),newLayer=updated.layers.find(l=>l.role==='insulation');
  const expectedVolume=Math.PI*(newLayer.outer_radius_m**2-oldLayer.outer_radius_m**2)*updated.length_m;
  assert.ok(Math.abs(newLayer.material_volume_m3-oldLayer.material_volume_m3-expectedVolume)<1e-10);
  const expectedMassChange=updated.layers.reduce((sum,layer,index)=>{const prior=old.layers[index],density=saved.domain.materials.find(m=>m.id===layer.material).density;
    return sum+Math.PI*(layer.outer_radius_m**2-layer.inner_radius_m**2-prior.outer_radius_m**2+prior.inner_radius_m**2)*1000*density;},0);
  assert.ok(Math.abs(updated.mass_kg_per_km-old.mass_kg_per_km-expectedMassChange)<1e-6);
  result.handCheck={beforeODmm:old.outer_diameter_m*1000,afterODmm:updated.outer_diameter_m*1000,beforeKgKm:old.mass_kg_per_km,afterKgKm:updated.mass_kg_per_km,expectedODChangeMm:2*delta*1000,expectedInsulationVolumeChangeM3:expectedVolume,expectedMassChangeKgKm:expectedMassChange};
  await timed('标准核对：缺项、未覆盖仍明确保留',()=>runModule('standard-check/results','执行标准核对'));
  const standardSpec=await fixture.api(`/api/types/${wid}/specification`),standards=runArtifacts(standardSpec,'standards');
  assert.ok(standards.rows.some(r=>r.verdict==='missing'||r.verdict==='uncovered'));assert.equal(standardSpec.ready,false);
  await readable('标准核对：逐条结论与下一步',page.locator('[data-type-page=standard-check-results] .type-result-summary'),page.getByRole('toolbar',{name:'型号命令'}).getByRole('button',{name:'规格书',exact:true}));
  await timed('生成客户规格书草稿：更新剩余模块并下载PDF',async()=>{
    await click(page.getByRole('toolbar',{name:'型号命令'}).getByRole('button',{name:'规格书',exact:true}));
    const download=page.waitForEvent('download',{timeout:240000});download.catch(()=>{});
    await click(page.getByRole('button',{name:'生成规格书',exact:true}));
    const file=path.join(output,'specification.pdf');await(await download).saveAs(file);
    const spec=await fixture.api(`/api/types/${wid}/specification`);assert.equal(spec.ready,false);assert.equal(spec.lifecycle.approval,null);
    assert.ok(spec.payload.sources.every(s=>s.freshness==='current'));
    const checked=spawnSync(path.join(root,'.venv/Scripts/python.exe'),[path.join(root,'frontend/src/features/type/tests/check-modification-pdf.py'),file,output],{encoding:'utf8',windowsHide:true});assert.equal(checked.status,0,checked.stdout+checked.stderr);result.pdf={file,...JSON.parse(checked.stdout)};
    await fs.writeFile(path.join(output,'saved-specification.json'),JSON.stringify(spec,null,2));
    await readable('规格书草稿：未批准，不能冒充发布',page.locator('.type-result-toolbar').getByText('草稿',{exact:true}),page.getByRole('button',{name:'生成规格书',exact:true}));
  });
  result.scenarioSeconds=+((performance.now()-scenarioStart)/1000).toFixed(2);result.scenarioClicks=result.clicks;result.scenarioKeyboardActions=result.keyboardActions;
  await page.goto(`${fixture.url}/types/${wid}/structure/table?theme=light`);await click(page.getByRole('tab',{name:'Agent',exact:true}));
  await expect(page.getByRole('region',{name:'Agent',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'检查这个型号的问题',exact:true})).toBeVisible();
  const agent=page.locator('.type-agent-panel');await click(page.getByRole('tab',{name:'输入',exact:true}));await expect(agent).toBeHidden();await click(page.getByRole('tab',{name:'Agent',exact:true}));await expect(agent).toBeVisible();
  await expect(page.getByRole('navigation',{name:'型号浏览器'}).getByRole('button',{name:/^标准核对/})).toContainText('当前');
  await expect(page.getByText('检查中',{exact:true})).toBeHidden();
  const screenshot=path.join(output,'workbench-agent.png');await page.screenshot({path:screenshot});result.screenshots.push(screenshot);
  for(const width of [1366,1920])for(const theme of ['light','dark']){
    await page.setViewportSize({width,height:width===1366?768:1080});await page.goto(`${fixture.url}/types/${wid}/structure/table?theme=${theme}`);await click(page.getByRole('tab',{name:'Agent',exact:true}));await expect(agent).toBeVisible();result.layouts.push({name:'Agent',theme,...await checkLayout(page)});
  }
  const spec=await fixture.api(`/api/types/${wid}/specification`);let mode='success';
  const pattern=`**/api/types/${wid}/specification?*`;
  await context.route(pattern,async route=>{if(mode==='loading')await new Promise(resolve=>{release=resolve});if(mode==='error')return route.fulfill({status:503,json:{detail:'验收故障注入：来源暂不可用，请重试'}});const value=structuredClone(spec);if(mode==='empty')value.payload.sources=[];if(mode==='historical')for(const source of value.payload.sources)source.freshness='historical';return route.fulfill({json:value});});
  for(const width of [1366,1920])for(const theme of ['light','dark'])for(const state of ['empty','loading','error','success','historical']){
    release?.();release=undefined;mode=state;await page.setViewportSize({width,height:width===1366?768:1080});await page.goto(`${fixture.url}/types/${wid}/specification/preview?theme=${theme}`);await expect(page.locator('[data-type-page=specification-results]')).toHaveAttribute('data-type-state',state);result.layouts.push({name:'specification',state,theme,...await checkLayout(page)});release?.();release=undefined;
  }
  await context.unroute(pattern);assert.deepEqual(fixture.errors,[]);
}catch(error){result.failure=String(error.stack||error);console.error(result.failure);console.error((await page.locator('body').innerText()).slice(-5000));process.exitCode=1;}
finally{release?.();result.totalSeconds=+((performance.now()-started)/1000).toFixed(2);result.writes=fixture.writes;await fs.writeFile(path.join(output,'verification.json'),JSON.stringify(result,null,2));await fixture.close();}
