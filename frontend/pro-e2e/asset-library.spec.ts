import {test,expect,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {readFile} from 'node:fs/promises';

async function enter(page:Page){
 await page.goto('/');await page.getByRole('button',{name:'进入专业工作台',exact:true}).click();
 await expect(page.getByTestId('session-revision')).toHaveText('rev.1');
 await expect(page.getByTestId('cable-model-view')).toHaveAttribute('data-renderer','webgl');
}
async function assets(page:Page){
 await page.getByRole('button',{name:'搜索命令',exact:true}).click();
 const input=page.getByRole('combobox',{name:'搜索工程命令'});await input.fill('asset');await input.press('Enter');
 await expect(page.getByRole('heading',{name:'工程资产库',exact:true})).toBeVisible();
 await expect(page.getByRole('region',{name:'资产列表',exact:true})).toHaveAttribute('aria-busy','false');
}
async function capture(page:Page,name:string){
 await page.getByRole('button',{name:'保存当前结构',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'保存结构草稿',exact:true});await dialog.getByLabel('资产名称',{exact:true}).fill(name);
 const response=page.waitForResponse(r=>r.url().endsWith('/assets/capture')&&r.request().method()==='POST');
 await dialog.getByRole('button',{name:'保存草稿',exact:true}).click();const r=await response;expect(r.status()).toBe(201);
 const data=await r.json();await expect(dialog).toBeHidden();
 await expect(page.getByRole('complementary',{name:'资产详情',exact:true}).getByRole('heading',{name,exact:true})).toBeVisible();return data;
}
async function action(page:Page,button:string,title:string,submit:string){
 await page.getByRole('complementary',{name:'资产详情',exact:true}).getByRole('button',{name:button,exact:true}).click();
 const dialog=page.getByRole('dialog',{name:title,exact:true});
 if(title==='记录人工核对')await dialog.getByRole('checkbox',{name:'确认已核对资产定义与来源',exact:true}).check();
 await dialog.getByLabel('资产操作说明',{exact:true}).fill('验收：核对当前结构与来源，仅本机参考。');
 const response=page.waitForResponse(r=>r.url().includes('/transition')&&r.request().method()==='POST');
 await dialog.getByRole('button',{name:submit,exact:true}).click();const r=await response;expect(r.status()).toBe(200);await expect(dialog).toBeHidden();return await r.json();
}

test('asset library: actual capture, review, publish, export and version derivation preserve the project',async({page},info)=>{
 await page.setViewportSize({width:1600,height:1000});await enter(page);
 const wid=new URL(page.url()).searchParams.get('project')!;
 const before=await(await page.request.get(`/api/workspaces/${wid}`)).json();
 const canvas=page.getByTestId('cable-model-view').locator('canvas');await canvas.evaluate(e=>e.setAttribute('data-asset-retained','yes'));
 await assets(page);await expect(page.getByRole('region',{name:'当前结果摘要',exact:true})).toBeHidden();
 const a=await capture(page,'验收 · 单芯 XLPE 结构');
 await expect(page.getByRole('img',{name:'资产结构截面（比例预览）',exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath('assets-draft.png'),fullPage:true});
 const reviewed=await action(page,'记录核对','记录人工核对','记录人工核对');expect(reviewed.reviewed_sha256).toBe(a.content_sha256);
 const published=await action(page,'发布此版本','发布此版本','发布此版本');expect(published.status).toBe('published');expect(published.content_sha256).toBe(a.content_sha256);
 const detail=page.getByRole('complementary',{name:'资产详情',exact:true});
 const download=page.waitForEvent('download');await detail.getByRole('button',{name:'导出资产定义',exact:true}).click();
 const file=await(await download).path();const exported=JSON.parse(await readFile(file!,'utf8'));expect(exported.release).toEqual(published.release);
 await page.screenshot({path:info.outputPath('assets-published.png'),fullPage:true});
 await detail.getByRole('button',{name:'派生版本',exact:true}).click();const dialog=page.getByRole('dialog',{name:'派生新版本',exact:true});
 await dialog.getByLabel('新资产版本号',{exact:true}).fill('1.0.1');await dialog.getByRole('button',{name:'创建新版本草稿',exact:true}).click();
 await expect(dialog).toBeHidden();await expect(detail).toContainText('v1.0.1');await expect(detail.getByRole('button',{name:'编辑定义',exact:true})).toBeVisible();
 expect((await(await page.request.get(`/api/foundation/assets/${a.id}`)).json()).status).toBe('published');
 expect(await(await page.request.get(`/api/workspaces/${wid}`)).json()).toEqual(before);
 await page.getByRole('button',{name:'返回电缆结构',exact:true}).click();await expect(canvas).toHaveAttribute('data-asset-retained','yes');await expect(canvas).toBeVisible();
});

test('asset library: PC list-detail layout and dialogs have readable dimensions and accessible controls',async({page},info)=>{
 await page.setViewportSize({width:1366,height:768});await enter(page);await assets(page);await capture(page,'验收 · 1366px 布局');
 const pane=page.getByRole('complementary',{name:'资产详情',exact:true});
 const list=page.getByRole('region',{name:'资产列表',exact:true});const box=(await list.boundingBox())!;const detail=(await pane.boundingBox())!;
 expect(box.width).toBeGreaterThan(300);expect(box.x+box.width).toBeLessThanOrEqual(detail.x);
 await expect(pane.getByRole('button',{name:'记录核对',exact:true})).toBeInViewport();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 const axe=await new AxeBuilder({page}).include('.collection-workspace').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(axe.violations).toEqual([]);
 await page.screenshot({path:info.outputPath('assets-1366.png'),fullPage:true});
 await pane.getByRole('button',{name:'记录核对',exact:true}).click();const dialog=page.getByRole('dialog',{name:'记录人工核对',exact:true});
 await expect(dialog.getByRole('heading',{name:'记录人工核对',exact:true})).toBeInViewport();await expect(dialog.getByRole('button',{name:'关闭对话框',exact:true})).toBeInViewport();
 expect((await new AxeBuilder({page}).include('.asset-editor').withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([]);
 await page.screenshot({path:info.outputPath('assets-review.png'),fullPage:true});await dialog.press('Escape');await expect(dialog).toBeHidden();
});

test('asset library: dirty engineering input survives browsing and cannot be captured as old data',async({page})=>{
 await enter(page);await page.getByLabel('导体截面积',{exact:true}).fill('');await assets(page);
 await expect(page.getByRole('button',{name:'保存当前结构',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'返回电缆结构',exact:true}).click();await expect(page.getByLabel('导体截面积',{exact:true})).toHaveValue('');
 await expect(page.getByTestId('session-revision')).toHaveText('rev.1');
});

test('asset library: invalid import and stale review do not report success',async({page})=>{
 await enter(page);await assets(page);await page.getByRole('button',{name:'导入 JSON',exact:true}).click();
 let dialog=page.getByRole('dialog',{name:'导入资产定义',exact:true});await dialog.getByLabel('资产包 JSON',{exact:true}).fill('{invalid');await dialog.getByRole('button',{name:'保存草稿',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('JSON 格式无效');await dialog.getByRole('button',{name:'取消',exact:true}).click();
 const a=await capture(page,'验收 · 冲突阻止');await page.getByRole('complementary',{name:'资产详情',exact:true}).getByRole('button',{name:'记录核对',exact:true}).click();
 dialog=page.getByRole('dialog',{name:'记录人工核对',exact:true});
 const newer=await page.request.put(`/api/foundation/assets/${a.id}`,{data:{expected_revision:a.revision,release:{...a.release,name:'外部修改的新名称'}}});expect(newer.status()).toBe(200);
 await dialog.getByRole('checkbox',{name:'确认已核对资产定义与来源',exact:true}).check();await dialog.getByLabel('资产操作说明',{exact:true}).fill('尝试核对已过期的定义');await dialog.getByRole('button',{name:'记录人工核对',exact:true}).click();
 await expect(dialog.getByRole('alert')).toContainText('资产已被其他操作更新');expect((await(await page.request.get(`/api/foundation/assets/${a.id}`)).json()).status).toBe('draft');
});
