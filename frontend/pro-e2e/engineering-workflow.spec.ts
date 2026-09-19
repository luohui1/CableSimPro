import {test,expect,type APIRequestContext,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const sourceName='集成测试 · 合成参数，非厂家数据';
async function makeProject(request:APIRequestContext,r20=false){
 const response=await request.post('/api/workspaces',{data:{}});expect(response.status()).toBe(201);let w=await response.json();
 if(r20){const edit=await request.post(`/api/workspaces/${w.id}/edit`,{data:{expected_revision:w.revision,changes:[{path:'cable.r20_ohm_km',value:.0754}]}});expect(edit.ok()).toBe(true);w=await edit.json()}
 return w;
}
async function enter(page:Page,w:any){await page.goto(`/?workflow=1&project=${w.id}`);await expect(page.getByTestId('workflow-revision')).toHaveText(`rev.${w.revision}`);await expect(page.getByRole('img',{name:'已保存工程的等比例电缆截面'})).toBeVisible()}
async function select(page:Page,name:string){await page.getByRole('navigation',{name:'工程对象'}).getByRole('button',{name,exact:true}).click()}
async function run(page:Page){
 await select(page,'R-001 · 稳态研究');
 await page.getByRole('checkbox',{name:'已核对本版本参数来源、损耗系数与方法范围'}).check();
 const response=page.waitForResponse(r=>r.url().includes('/api/runtime/')&&r.url().endsWith('/invoke')&&r.request().postDataJSON()?.capability==='analysis.buried');
 await page.getByRole('button',{name:'运行当前版本',exact:true}).click();
 const r=await response;expect(r.ok()).toBe(true);const body=await r.json();
 await expect(page.getByRole('region',{name:'所选运行结果'})).toBeVisible();
 return body.result.output;
}

test('one initial document, real geometry and genuinely different object properties',async({page,request},info)=>{
 const w=await makeProject(request);await page.setViewportSize({width:1366,height:768});
 const posts:string[]=[];page.on('request',r=>{if(r.method()==='POST')posts.push(r.url())});
 await enter(page,w);await expect(page.getByRole('tab')).toHaveCount(1);
 await select(page,'XLPE 绝缘');await expect(page.getByLabel('绝缘厚度',{exact:true})).toBeVisible();await expect(page.getByLabel('护套厚度',{exact:true})).toHaveCount(0);
 const prepared=await (await request.get(`/api/foundation/workspaces/${w.id}/preflight?expected_revision=1`)).json();
 const diameter=prepared.package.geometry_recipe.layers[5].outer_radius_m*2000;
 await expect(page.getByRole('img',{name:'已保存工程的等比例电缆截面'})).toHaveAttribute('data-diameter-mm',diameter.toFixed(6));
 const editor=await page.locator('.wf-editor').boundingBox(),canvas=await page.locator('.wf-canvas').boundingBox();
 expect(canvas!.height/editor!.height).toBeGreaterThan(.75);
 await page.screenshot({path:info.outputPath('structure-1366.png')});
 await select(page,'外护套');await expect(page.getByLabel('护套厚度',{exact:true})).toBeVisible();await expect(page.getByLabel('绝缘厚度',{exact:true})).toHaveCount(0);
 expect(posts).toEqual([]);
 const axe=await new AxeBuilder({page}).include('.wf-root').withTags(['wcag2a','wcag2aa']).analyze();expect(axe.violations).toEqual([]);
});

test('invalid drafts survive document switches; whole-scenario validation and atomic save',async({page,request},info)=>{
 const w=await makeProject(request);await enter(page,w);await select(page,'XLPE 绝缘');
 await page.getByLabel('绝缘厚度',{exact:true}).fill('99');await expect(page.getByLabel('绝缘厚度',{exact:true})).toHaveAttribute('aria-invalid','true');
 await select(page,'R-001 · 稳态研究');await expect(page.getByRole('button',{name:'运行当前版本',exact:true})).toBeDisabled();
 await select(page,'XLPE 绝缘');await expect(page.getByLabel('绝缘厚度',{exact:true})).toHaveValue('99');await expect(page.getByRole('button',{name:'保存全部修改'})).toBeDisabled();
 await page.getByLabel('绝缘厚度',{exact:true}).fill('6.5');
 await select(page,'敷设方案 A');await page.getByLabel('相邻中心间距',{exact:true}).fill('0.02');
 await page.getByRole('button',{name:'保存全部修改'}).click();await expect(page.getByRole('alert')).toContainText('重叠');await expect(page.getByTestId('workflow-revision')).toHaveText('rev.1');
 await page.getByLabel('相邻中心间距',{exact:true}).fill('0.12');await page.getByRole('button',{name:'保存全部修改'}).click();await expect(page.getByTestId('workflow-revision')).toHaveText('rev.2');
 const saved=await (await request.get(`/api/workspaces/${w.id}`)).json();expect(saved.scenario.cable.insulation_mm).toBe(6.5);expect(saved.scenario.installation.spacing_m).toBe(.12);
 await select(page,'XLPE 绝缘');await expect(page.getByLabel('绝缘厚度',{exact:true})).toHaveValue('6.5');await expect(page.getByRole('button',{name:'保存全部修改'})).toBeDisabled();
 await page.screenshot({path:info.outputPath('saved-insulation.png')});await page.reload();await expect(page.getByTestId('workflow-revision')).toHaveText('rev.2');
});

test('concurrent server change never silently rebases a pending draft',async({page,request},info)=>{
 const w=await makeProject(request);await enter(page,w);await select(page,'XLPE 绝缘');await page.getByLabel('绝缘厚度',{exact:true}).fill('6.8');
 const remote=await request.post(`/api/workspaces/${w.id}/edit`,{data:{expected_revision:1,changes:[{path:'cable.insulation_mm',value:7}]}});expect(remote.ok()).toBe(true);
 await page.getByRole('button',{name:'保存全部修改'}).click();await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByLabel('绝缘厚度',{exact:true})).toHaveValue('6.8');
 await page.getByRole('button',{name:'读取最新版本'}).click();await expect(page.getByTestId('workflow-revision')).toHaveText('rev.2');await expect(page.getByRole('alert')).toContainText('草稿基于 rev.1');
 await expect(page.getByLabel('绝缘厚度',{exact:true})).toHaveValue('6.8');await expect(page.getByRole('button',{name:'保存全部修改'})).toBeDisabled();
 await page.screenshot({path:info.outputPath('revision-conflict.png')});
 expect((await (await request.get(`/api/workspaces/${w.id}`)).json()).scenario.cable.insulation_mm).toBe(7);
 await page.getByRole('button',{name:'撤销未保存输入'}).click();await expect(page.getByLabel('绝缘厚度',{exact:true})).toHaveValue('7');
});

test('real solve, stale result, two-run comparison and exact historical HTML export',async({page,request},info)=>{
 const w=await makeProject(request,true);await enter(page,w);
 await select(page,'R-001 · 稳态研究');await page.screenshot({path:info.outputPath('study-preflight.png')});
 const first=await run(page);expect(first.result.summary.ampacity_a).toBeGreaterThan(0);
 await expect(page.locator('.wf-result-values')).toContainText(first.result.summary.ampacity_a.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}));
 await select(page,'XLPE 绝缘');await page.getByLabel('绝缘厚度',{exact:true}).fill('7');await page.getByRole('button',{name:'保存全部修改'}).click();await expect(page.getByTestId('workflow-revision')).toHaveText('rev.3');
 await page.locator('.wf-outline nav button').filter({hasText:first.run_id.slice(0,8)}).click();
 await expect(page.getByRole('region',{name:'所选运行结果'})).toContainText('历史运行 rev.2');await page.screenshot({path:info.outputPath('historical-result.png')});
 const invoked:string[]=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/invoke'))invoked.push(r.postDataJSON().capability)});
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出此运行计算书'}).click();const file=await download;
 expect(file.suggestedFilename()).toContain(`rev2-${first.run_id.slice(0,8)}`);await file.saveAs(info.outputPath('historical-report.html'));
 expect(invoked).toEqual(['reports.render']);
 const second=await run(page);expect(second.run_id).not.toBe(first.run_id);expect(second.result.input.cable.insulation_mm).toBe(7);expect(first.result.input.cable.insulation_mm).toBe(5.5);
 await page.getByRole('region',{name:'所选运行结果'}).getByLabel('比较运行',{exact:true}).selectOption(first.run_id);await expect(page.getByRole('table',{name:'两次运行比较'})).toContainText('5.500');
 await page.screenshot({path:info.outputPath('result-comparison.png')});
 const final=await (await request.get(`/api/workspaces/${w.id}`)).json();expect(final.runs).toHaveLength(2);expect(final.revision).toBe(3);
 const history=await (await request.get(`/api/workspaces/${w.id}/runs/${first.run_id}`)).json();expect(history.output.result).toEqual(first.result);
 await info.attach('workflow-real-run-evidence.json',{body:JSON.stringify({fixture:sourceName,first:first.result.summary,second:second.result.summary,firstRun:first.run_id,secondRun:second.run_id,finalRevision:final.revision}),contentType:'application/json'});
 const axe=await new AxeBuilder({page}).include('.wf-root').withTags(['wcag2a','wcag2aa']).analyze();expect(axe.violations).toEqual([]);
});

test('three-dimensional production renderer survives document switches and matches saved inputs',async({page,request},info)=>{
 const w=await makeProject(request);await enter(page,w);await page.getByRole('button',{name:'三维结构',exact:true}).click();
 const render=page.getByTestId('cable-model-view');await expect(render).toHaveAttribute('data-renderer','webgl');
 const canvas=render.locator('canvas');await canvas.evaluate(el=>(el as HTMLElement).dataset.workflowIdentity='retained');
 await select(page,'R-001 · 稳态研究');await page.getByRole('tab',{name:'C-001 · 电缆',exact:true}).click();await expect(canvas).toHaveAttribute('data-workflow-identity','retained');
 await select(page,'XLPE 绝缘');await page.getByLabel('绝缘厚度',{exact:true}).fill('6.5');await page.getByRole('button',{name:'保存全部修改'}).click();await expect(page.getByTestId('workflow-revision')).toHaveText('rev.2');await expect(render).toHaveAttribute('data-renderer','webgl');await expect(canvas).toHaveAttribute('data-workflow-identity','retained');
 // Snapshot validity is checked through the real saved geometry endpoint, not a screenshot's text.
 const shape=await (await request.get(`/api/foundation/workspaces/${w.id}/preflight?expected_revision=2`)).json();expect(shape.package.geometry_recipe.layers[2].outer_radius_m-shape.package.geometry_recipe.layers[2].inner_radius_m).toBeCloseTo(.0065,10);
 await page.screenshot({path:info.outputPath('production-3d-view.png')});
});

test('R20 requirement, parameter lock and backend unavailability fail visibly',async({page,request})=>{
 const w=await makeProject(request);await enter(page,w);await select(page,'R-001 · 稳态研究');await page.getByRole('checkbox',{name:'已核对本版本参数来源、损耗系数与方法范围'}).check();await expect(page.getByRole('button',{name:'运行当前版本',exact:true})).toBeDisabled();
 const lock=await request.post(`/api/workspaces/${w.id}/lock`,{data:{expected_revision:1,path:'cable.insulation_mm',locked:true}});expect(lock.ok()).toBe(true);
 await page.getByRole('button',{name:'读取最新版本'}).click();await expect(page.getByTestId('workflow-revision')).toHaveText('rev.2');await select(page,'XLPE 绝缘');await expect(page.getByLabel(/绝缘厚度/)).toBeDisabled();
 // Fault injection only. Never substitute a successful engine response.
 await page.route(`**/api/workspaces/${w.id}`,r=>r.abort('connectionrefused'));
 await page.getByRole('button',{name:'读取最新版本'}).click();await expect(page.getByRole('alert')).toContainText('无法连接');await expect(page.getByTestId('workflow-revision')).toHaveText('rev.2');
});

test('desktop layouts, long project names and task-specific content remain usable',async({page,request},info)=>{
 const w=await makeProject(request);const renamed=await request.post(`/api/workspaces/${w.id}/edit`,{data:{expected_revision:1,changes:[{path:'name',value:'长名称工程 / 电缆结构与稳态载流量研究 / 集成审查用例'}]}});expect(renamed.ok()).toBe(true);const updated=await renamed.json();
 for(const [width,height] of [[1366,768],[1920,1080],[1093,615],[911,512]]){
  await page.setViewportSize({width,height});await enter(page,updated);await select(page,'XLPE 绝缘');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  const button=await page.getByRole('button',{name:'保存全部修改'}).boundingBox();expect(button!.x+button!.width).toBeLessThanOrEqual(width);expect(button!.y+button!.height).toBeLessThanOrEqual(height);
  expect(await page.getByRole('tab').count()).toBe(1);
  await page.screenshot({path:info.outputPath(`desktop-${width}x${height}.png`)});
 }
});
