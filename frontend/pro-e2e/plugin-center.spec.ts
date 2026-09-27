import {test,expect,type APIRequestContext,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// The plugin center is only reachable inside a project workspace; there is no standalone entry.
async function project(request:APIRequestContext){const r=await request.post('/api/workspaces',{data:{}});expect(r.ok()).toBe(true);return r.json()}
async function open(page:Page,w:any){
 await page.goto(`/?project=${w.id}`);await expect(page.getByTestId('workflow-revision')).toHaveText(`rev.${w.revision}`);
 await page.getByRole('toolbar',{name:'工程操作'}).getByRole('button',{name:'插件中心',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'当前工程插件中心'});await expect(dialog).toBeVisible();return dialog;
}

test('market catalogue is real read-only metadata, roadmap cannot install',async({page,request},info)=>{
 const w=await project(request);
 const posts:string[]=[],external:string[]=[];
 page.on('request',r=>{if(r.method()!=='GET')posts.push(r.url());if(r.url().startsWith('http')&&!r.url().startsWith('http://127.0.0.1:8000'))external.push(r.url())});
 const dialog=await open(page,w);
 await expect(dialog.getByRole('heading',{name:'把工程能力接入项目'})).toBeVisible();
 await expect(dialog.getByTestId('cablesim.thermal2d')).toBeVisible();
 await dialog.getByTestId('cablesim.dolfinx').click();
 await expect(dialog.getByRole('complementary',{name:'插件详情'})).toContainText('尚未实现');
 await expect(dialog.getByRole('button',{name:'审查安装',exact:true})).toHaveCount(0);
 expect(posts).toEqual([]);expect(external).toEqual([]);
 await dialog.getByTestId('cablesim.thermal2d').click();
 await page.screenshot({path:info.outputPath('plugin-market.png')});
 const a11y=await new AxeBuilder({page}).include('.project-plugin-dialog').withTags(['wcag2a','wcag2aa']).analyze();
 expect(a11y.violations).toEqual([]);
});

test('review actual dependency plan then install and lock without changing scenario',async({page,request},info)=>{
 const w=await project(request);
 const before=await (await request.get(`/api/workspaces/${w.id}`)).json();
 const dialog=await open(page,w);await expect(dialog.getByLabel('当前项目',{exact:true})).toBeDisabled();
 await dialog.getByTestId('cablesim.thermal2d').click();
 await dialog.getByRole('button',{name:'审查安装',exact:true}).click();
 const review=dialog.getByRole('region',{name:'安装审查'});
 await expect(review).toContainText('cablesim.gmsh');await expect(review).toContainText('cablesim.meshio');
 await expect(dialog.getByRole('button',{name:'确认登记安装',exact:true})).toBeDisabled();
 await page.screenshot({path:info.outputPath('plugin-install-review.png')});
 await review.getByRole('checkbox').check();await dialog.getByRole('button',{name:'确认登记安装',exact:true}).click();
 await expect(review).toBeHidden();
 await dialog.getByRole('button',{name:'为当前项目启用',exact:true}).click();
 await expect(dialog.getByRole('button',{name:'从项目停用',exact:true})).toBeVisible();
 const download=page.waitForEvent('download');await dialog.getByRole('button',{name:'导出插件锁'}).click();
 expect((await download).suggestedFilename()).toBe('project-plugin-lock.json');
 const after=await (await request.get(`/api/workspaces/${w.id}`)).json();expect(after).toEqual(before);
 const pins=await (await request.get(`/api/plugins/workspaces/${w.id}/lock`)).json();
 expect(pins.lock.plugins.map((p:any)=>p.plugin_id)).toEqual(expect.arrayContaining(['cablesim.gmsh','cablesim.meshio','cablesim.thermal2d']));
 await page.reload();const reopened=await open(page,w);
 await reopened.getByTestId('cablesim.thermal2d').click();
 await expect(reopened.getByRole('button',{name:'从项目停用',exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath('plugin-project-lock.png')});
});

test('compact viewport searches and describes unavailable plugins without document overflow',async({page,request},info)=>{
 const w=await project(request);await page.setViewportSize({width:911,height:512});
 const dialog=await open(page,w);
 await dialog.getByLabel('搜索插件').fill('ReportEngine');
 await expect(dialog.locator('.plugin-row')).toHaveCount(1);
 await dialog.getByTestId('cablesim.reportengine').click();
 await expect(dialog.getByRole('complementary',{name:'插件详情'})).toContainText('独立 Report IR');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('plugin-market-compact.png')});
});
