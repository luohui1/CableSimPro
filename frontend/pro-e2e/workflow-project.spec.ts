import {test,expect,type APIRequestContext,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {readFile} from 'node:fs/promises';

async function project(request:APIRequestContext){const r=await request.post('/api/workspaces',{data:{}});expect(r.status()).toBe(201);return r.json()}
async function enter(page:Page,w:any){await page.goto(`/?project=${w.id}`);await expect(page.getByTestId('workflow-revision')).toHaveText(`rev.${w.revision}`)}
const layer=(page:Page,name:string)=>page.getByRole('navigation',{name:'工程对象'}).getByRole('button',{name,exact:true});

test('exported saved inputs re-import as a new independent project after server validation',async({page,request},info)=>{
 const w=await project(request);await enter(page,w);
 await page.locator('.wf-more>summary').click();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出已保存输入 JSON'}).click();
 const file=await download;const path=info.outputPath('project.json');await file.saveAs(path);
 const exported=JSON.parse(await readFile(path,'utf8'));expect(exported).toEqual(w.scenario);
 await page.getByRole('button',{name:'返回工程首页'}).click();await expect(page.getByRole('heading',{name:'从一个工程开始。'})).toBeVisible();
 const created=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/api/workspaces'));
 await page.getByLabel('选择工程 JSON 文件').setInputFiles(path);
 const imported=await (await created).json();expect(imported.id).not.toBe(w.id);expect(imported.scenario).toEqual(w.scenario);
 await expect(page.getByTestId('workflow-revision')).toHaveText('rev.1');expect(new URL(page.url()).searchParams.get('project')).toBe(imported.id);
 const original=await (await request.get(`/api/workspaces/${w.id}`)).json();expect(original.revision).toBe(w.revision);expect(original.scenario).toEqual(w.scenario);
});

test('invalid import files are rejected without creating a project',async({page})=>{
 await page.goto('/');await expect(page.getByRole('heading',{name:'从一个工程开始。'})).toBeVisible();
 const creates:string[]=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/workspaces'))creates.push(r.url())});
 const input=page.getByLabel('选择工程 JSON 文件');
 await input.setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from('{not json')});
 await expect(page.getByRole('alert')).toContainText('不是有效的 JSON');
 await input.setInputFiles({name:'unknown.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({name:'x',unexpected:true}))});
 await expect(page.getByRole('alert')).toBeVisible();
 await input.setInputFiles({name:'large.json',mimeType:'application/json',buffer:Buffer.alloc(120001,32)});
 await expect(page.getByRole('alert')).toContainText('120 KB');
 expect(creates).toEqual([]);
});

test('undo and redo move through saved revisions without losing history',async({page,request})=>{
 const w=await project(request);
 const edit=await request.post(`/api/workspaces/${w.id}/edit`,{data:{expected_revision:1,changes:[{path:'cable.insulation_mm',value:6.5}]}});expect(edit.ok()).toBe(true);
 await enter(page,{...w,revision:2});
 const undo=page.getByRole('button',{name:'撤销修改'}),redo=page.getByRole('button',{name:'重做修改'});
 await expect(redo).toBeDisabled();await undo.click();await expect(page.getByTestId('workflow-revision')).toHaveText('rev.3');
 expect((await (await request.get(`/api/workspaces/${w.id}`)).json()).scenario.cable.insulation_mm).toBe(w.scenario.cable.insulation_mm);
 await expect(redo).toBeEnabled();await redo.click();await expect(page.getByTestId('workflow-revision')).toHaveText('rev.4');
 expect((await (await request.get(`/api/workspaces/${w.id}`)).json()).scenario.cable.insulation_mm).toBe(6.5);
 await expect(redo).toBeDisabled();
 await layer(page,'XLPE 绝缘').click();await page.getByLabel('绝缘厚度',{exact:true}).fill('6.6');await expect(undo).toBeDisabled();await expect(redo).toBeDisabled();
});

test('design basis is checked read-only, then recorded only through an explicit approval',async({page,request},info)=>{
 const w=await project(request);await enter(page,w);await layer(page,'R-001 · 稳态研究').click();
 const basis=page.getByLabel('设计依据');await expect(basis).toContainText('尚未登记设计依据');
 const writes:string[]=[];page.on('request',r=>{if(r.method()==='POST')writes.push(r.postDataJSON()?.capability??r.url())});
 await basis.getByRole('button',{name:'登记设计依据'}).click();
 await basis.getByLabel(/IEC 60287-1-1:2023/).check();
 await basis.getByLabel('敷设环境').selectOption('duct');await basis.getByRole('button',{name:'检查适用范围'}).click();
 await expect(basis.getByRole('status')).toContainText('存在不适用项');await expect(basis.getByRole('button',{name:'提交依据变更审查'})).toBeDisabled();
 await basis.getByLabel('敷设环境').selectOption('buried');await basis.getByLabel('参数及环境依据').fill('合成测试依据，非厂家资料');
 await basis.getByRole('button',{name:'检查适用范围'}).click();await expect(basis.getByRole('status')).toContainText('可记录为设计参考');
 expect(writes).toEqual(['standards.inspect','standards.inspect']);
 expect((await (await request.get(`/api/workspaces/${w.id}`)).json()).revision).toBe(1);
 await basis.getByRole('button',{name:'提交依据变更审查'}).click();
 const review=page.getByRole('region',{name:'设计依据变更审查'});await expect(review).toContainText('IEC 60287-1-1:2023');
 expect((await (await request.get(`/api/workspaces/${w.id}`)).json()).design_basis??null).toBeNull();
 await page.screenshot({path:info.outputPath('design-basis-review.png')});
 const axe=await new AxeBuilder({page}).include('.wf-root').withTags(['wcag2a','wcag2aa']).analyze();expect(axe.violations).toEqual([]);
 await review.getByRole('button',{name:'批准依据变更'}).click();await expect(review).toBeHidden();await expect(page.getByTestId('workflow-revision')).toHaveText('rev.2');
 const saved=await (await request.get(`/api/workspaces/${w.id}`)).json();
 expect(saved.design_basis.reference_ids).toEqual(['iec60287-1-1']);expect(saved.design_basis.environment).toBe('buried');expect(saved.scenario).toEqual(w.scenario);
 await expect(basis).toContainText('合成测试依据，非厂家资料');
});

test('rejecting a design basis proposal leaves the project unchanged',async({page,request})=>{
 const w=await project(request);await enter(page,w);await layer(page,'R-001 · 稳态研究').click();
 const basis=page.getByLabel('设计依据');await basis.getByRole('button',{name:'登记设计依据'}).click();
 await basis.getByRole('button',{name:'检查适用范围'}).click();await basis.getByRole('button',{name:'提交依据变更审查'}).click();
 const review=page.getByRole('region',{name:'设计依据变更审查'});await review.getByRole('button',{name:'拒绝'}).click();await expect(review).toBeHidden();
 const after=await (await request.get(`/api/workspaces/${w.id}`)).json();expect(after.revision).toBe(1);expect(after.design_basis??null).toBeNull();
 await expect(basis).toContainText('尚未登记设计依据');
});
