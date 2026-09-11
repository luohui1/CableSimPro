import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('market catalogue is real read-only metadata, roadmap cannot install',async({page},info)=>{
 const posts:string[]=[],external:string[]=[];
 page.on('request',r=>{if(r.method()!=='GET')posts.push(r.url());if(r.url().startsWith('http')&&!r.url().startsWith('http://127.0.0.1:8000'))external.push(r.url())});
 await page.goto('/?plugins=1');
 await expect(page.getByRole('heading',{name:'把工程能力接入项目'})).toBeVisible();
 await expect(page.getByTestId('cablesim.thermal2d')).toBeVisible();
 await page.getByTestId('cablesim.dolfinx').click();
 await expect(page.getByRole('complementary',{name:'插件详情'})).toContainText('尚未实现');
 await expect(page.getByRole('button',{name:'审查安装',exact:true})).toHaveCount(0);
 expect(posts).toEqual([]);expect(external).toEqual([]);
 await page.getByTestId('cablesim.thermal2d').click();
 await page.screenshot({path:info.outputPath('plugin-market.png'),fullPage:true});
 const a11y=await new AxeBuilder({page}).include('.plugin-center').withTags(['wcag2a','wcag2aa']).analyze();
 expect(a11y.violations).toEqual([]);
});

test('review actual dependency plan then install and lock without changing scenario',async({page,request},info)=>{
 const response=await request.post('/api/workspaces',{data:{}});expect(response.ok()).toBe(true);const w=await response.json();
 const before=await (await request.get(`/api/workspaces/${w.id}`)).json();
 await page.goto('/?plugins=1');
 await page.getByLabel('当前项目',{exact:true}).selectOption(w.id);
 await page.getByTestId('cablesim.thermal2d').click();
 await page.getByRole('button',{name:'审查安装',exact:true}).click();
 const review=page.getByRole('region',{name:'安装审查'});
 await expect(review).toContainText('cablesim.gmsh');await expect(review).toContainText('cablesim.meshio');
 await expect(page.getByRole('button',{name:'确认登记安装',exact:true})).toBeDisabled();
 await page.screenshot({path:info.outputPath('plugin-install-review.png'),fullPage:true});
 await review.getByRole('checkbox').check();await page.getByRole('button',{name:'确认登记安装',exact:true}).click();
 await expect(review).toBeHidden();
 await page.getByRole('button',{name:'为当前项目启用',exact:true}).click();
 await expect(page.getByRole('button',{name:'从项目停用',exact:true})).toBeVisible();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出插件锁'}).click();
 expect((await download).suggestedFilename()).toBe('project-plugin-lock.json');
 const after=await (await request.get(`/api/workspaces/${w.id}`)).json();expect(after).toEqual(before);
 const pins=await (await request.get(`/api/plugins/workspaces/${w.id}/lock`)).json();
 expect(pins.lock.plugins.map((p:any)=>p.plugin_id)).toEqual(expect.arrayContaining(['cablesim.gmsh','cablesim.meshio','cablesim.thermal2d']));
 await page.reload();await page.getByLabel('当前项目',{exact:true}).selectOption(w.id);
 await expect(page.getByRole('button',{name:'从项目停用',exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath('plugin-project-lock.png'),fullPage:true});
});

test('mobile market searches and describes unavailable plugins without document overflow',async({page},info)=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/?plugins=1');
 await page.getByLabel('搜索插件').fill('ReportEngine');
 await expect(page.locator('.plugin-row')).toHaveCount(1);
 await page.getByTestId('cablesim.reportengine').click();
 await expect(page.getByRole('complementary',{name:'插件详情'})).toContainText('独立 Report IR');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('plugin-market-mobile.png'),fullPage:true});
});
