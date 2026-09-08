import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {readFile} from 'node:fs/promises';

async function enter(page:any,agent=false){
 await page.goto('/');await page.getByRole('button',{name:agent?'进入智能工程流':'进入专业工作台',exact:true}).click();
 await expect(page.getByTestId('session-revision')).toHaveText('rev.1');
}

test('original plates load locally and entry never invents engineering results',async({page},info)=>{
 const external:string[]=[];page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith('http://127.0.0.1:8000'))external.push(r.url())});
 await page.goto('/');await expect(page.getByRole('heading',{name:'选择你的工作方式'})).toBeVisible();
 const images=page.locator('.visual-home .engineering-plate img');await expect(images).toHaveCount(3);
 for(const image of await images.all()){await image.scrollIntoViewIfNeeded();await expect(image).toHaveJSProperty('complete',true);expect(await image.evaluate((e:HTMLImageElement)=>e.naturalWidth)).toBe(1200)}
 expect(external).toEqual([]);await expect(page.locator('.visual-home')).toContainText('非厂家产品图');
 await expect(page.locator('.visual-home')).not.toContainText('100%');
 await page.locator('.mode-home').evaluate(e=>e.scrollTop=0);
 await page.screenshot({path:info.outputPath('v072-entry.png'),fullPage:true});
});

test('failed illustration has a descriptive fallback and never prevents mode entry',async({page})=>{
 await page.route('**/engineering/*.png',r=>r.abort());await page.goto('/');
 await expect(page.locator('.entry-hero .plate-unavailable')).toContainText('未能加载');
 await page.getByRole('button',{name:'进入智能工程流',exact:true}).click();
 await expect(page.getByLabel('描述本次工程任务',{exact:true})).toBeVisible();
});

test('live model stays interactive; presentation wire detail does not enter GLB engineering model',async({page},info)=>{
 await enter(page);const model=page.getByTestId('professional-mode').getByTestId('cable-model-view');
 await expect(model).toHaveAttribute('data-renderer','webgl');
 await page.getByRole('button',{name:'端面',exact:true}).click();await page.getByRole('button',{name:'轴测',exact:true}).click();
 const d=page.waitForEvent('download');await page.getByRole('button',{name:'导出 GLB',exact:true}).click();
 const bytes=await readFile((await (await d).path())!);expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
 const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
 const layers=json.nodes.filter((n:any)=>n.extras?.outer_radius_m);expect(layers).toHaveLength(6);
 expect(json.nodes.some((n:any)=>n.extras?.not_solver_geometry)).toBe(false);
 await expect(page.locator('.model-footer').first()).toContainText('外观线股不参与求解');
 await page.getByRole('button',{name:'计算载流量',exact:false}).click();await expect(page.locator('.enterprise-result-summary')).toBeVisible();
 await page.screenshot({path:info.outputPath('v072-workbench.png'),fullPage:true});
});

test('task visual guide yields to review and real current output',async({page},info)=>{
 await enter(page,true);await expect(page.locator('.flow-start .engineering-plate img')).toBeVisible();
 await page.screenshot({path:info.outputPath('v072-agent-start.png'),fullPage:true});
 await page.getByLabel('描述本次工程任务',{exact:true}).fill('截面积改为 400 mm²，重新计算');
 await page.getByRole('button',{name:'生成任务计划',exact:true}).click();await expect(page.locator('.flow-review')).toContainText('400');
 await expect(page.getByRole('button',{name:'批准并执行',exact:true})).toBeInViewport();
 await page.screenshot({path:info.outputPath('v072-agent-review.png'),fullPage:true});
 await page.getByRole('button',{name:'批准并执行',exact:true}).click();await expect(page.locator('.flow-result-metrics')).toBeVisible();
 await expect(page.getByTestId('session-revision')).toHaveText('rev.2');
});

test('display assets and light workbench retain AA automatic contrast checks',async({page},info)=>{
 await enter(page);
 const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
 await info.attach('v072-workbench-axe.json',{body:JSON.stringify(result,null,2),contentType:'application/json'});
 expect(result.violations).toEqual([]);
});

test('light entry and two-mode layout fit a narrow viewport without horizontal overflow',async({page},info)=>{
 await page.setViewportSize({width:390,height:844});await enter(page,true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 await page.screenshot({path:info.outputPath('v072-mobile-agent.png'),fullPage:true});
 await page.getByRole('navigation',{name:'工作模式'}).getByRole('button',{name:'专业工作台',exact:true}).click();
 await expect(page.getByTestId('professional-mode')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
});
