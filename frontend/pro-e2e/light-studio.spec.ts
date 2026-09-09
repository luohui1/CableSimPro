import {test,expect,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function enter(page:Page,mode:'agent'|'workbench'='workbench'){
 await page.goto('/');await page.getByRole('button',{name:mode==='agent'?'进入智能工程流':'进入专业工作台',exact:true}).click();
 await expect(page.getByTestId('session-revision')).toHaveText('rev.1');
}
const views=(page:Page)=>page.getByRole('navigation',{name:'画布视图'});

test('light entry uses local assets, contains no preset results and creates no projects',async({page},info)=>{
 const external:string[]=[],writes:string[]=[];
 page.on('request',r=>{if(r.url().startsWith('http')&&!r.url().startsWith('http://127.0.0.1:8000'))external.push(r.url());if(r.method()==='POST')writes.push(r.url())});
 await page.goto('/');await expect(page.getByRole('heading',{name:'选择你的工作方式'})).toBeVisible();
 await expect(page.locator('.entry-task-asset img')).toHaveJSProperty('naturalWidth',1200);
 await expect(page.getByTestId('cable-portrait')).toHaveAttribute('data-renderer','ready');
 expect(writes).toEqual([]);expect(external).toEqual([]);
 const report=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
 await info.attach('entry-accessibility.json',{body:JSON.stringify(report),contentType:'application/json'});expect(report.violations).toEqual([]);
 await page.screenshot({path:info.outputPath('entry-v074.png'),fullPage:true});
});

test('model section field and curve share saved input and retain original WebGL canvas',async({page},info)=>{
 await enter(page);const canvas=page.getByTestId('cable-model-view').locator('canvas');await expect(canvas).toBeVisible();
 await canvas.evaluate(el=>(el as HTMLElement).dataset.retained='v074');
 await page.screenshot({path:info.outputPath('workbench-initial-v074.png'),fullPage:true});
 let invokes=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/invoke'))invokes++});
 // The approved presenter puts section selection in the canvas view switcher.
 await page.getByRole('button',{name:'二维截面',exact:true}).click();await expect(page.getByRole('img',{name:'电缆二维截面'})).toBeVisible();
 await views(page).getByRole('button',{name:'温度分布',exact:true}).click();await expect(page.locator('.field-pane .viewport-empty')).toContainText('尚无当前工况结果');
 expect(invokes).toBe(0);
 await page.getByRole('button',{name:'计算载流量',exact:false}).click();await expect(page.locator('.enterprise-result-summary')).toBeVisible();
 await expect(page.locator('.field-pane').getByLabel('土壤解析温度分布')).toBeVisible();await expect(page.locator('.field-pane')).toContainText('非有限元');
 await page.screenshot({path:info.outputPath('thermal-same-canvas-v074.png'),fullPage:true});
 await views(page).getByRole('button',{name:'载流量曲线',exact:true}).click();await expect(page.locator('.curve-pane')).toContainText('最高导体温度');
 await views(page).getByRole('button',{name:'三维结构',exact:true}).click();await expect(canvas).toHaveAttribute('data-retained','v074');
 expect(invokes).toBe(1);
 // The approved drawing shows dimensions by default; they remain user-switchable.
 const dimensions=page.getByRole('button',{name:'尺寸',exact:true});
 await expect(page.locator('.model-render .model-callouts')).toBeVisible();
 await dimensions.click();await expect(page.locator('.model-render .model-callouts')).toBeHidden();
 await dimensions.click();await expect(page.locator('.model-render .model-callouts')).toBeVisible();
 await expect(canvas).toHaveAttribute('data-retained','v074');expect(invokes).toBe(1);await page.screenshot({path:info.outputPath('workbench-result-v074.png'),fullPage:true});
});

test('changed input removes current field and curve rather than showing stale colors',async({page})=>{
 await enter(page);await page.getByRole('button',{name:'计算载流量',exact:false}).click();await expect(page.locator('.enterprise-result-summary')).toBeVisible();
 const canvas=page.getByTestId('cable-model-view').locator('canvas');await canvas.evaluate(el=>(el as HTMLElement).dataset.revisionPersistent='true');
 const field=page.locator('.enterprise-inspector').getByLabel('导体截面积',{exact:true});await field.fill('300');await field.press('Tab');await expect(page.getByTestId('session-revision')).toHaveText('rev.2');
 await expect(canvas).toHaveAttribute('data-revision-persistent','true');await expect(page.locator('.model-dimensions')).toContainText('300 mm²');
 await views(page).getByRole('button',{name:'温度分布',exact:true}).click();await expect(page.locator('.field-pane')).toContainText('输入已变化，请重新计算');
 await expect(page.locator('.field-pane').getByLabel('土壤解析温度分布')).toHaveCount(0);
 await views(page).getByRole('button',{name:'载流量曲线',exact:true}).click();await expect(page.locator('.curve-pane')).toContainText('输入已变化，请重新计算');
});

test('illustrated agent keeps real candidate review primary and draft recoverable',async({page},info)=>{
 await enter(page,'agent');await expect(page.locator('.cs-welcome-illustration img')).toHaveJSProperty('naturalWidth',1200);
 const report=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();await info.attach('agent-accessibility.json',{body:JSON.stringify(report),contentType:'application/json'});expect(report.violations).toEqual([]);
 await page.screenshot({path:info.outputPath('agent-start-v074.png'),fullPage:true});
 await page.getByLabel('描述本次工程任务',{exact:true}).fill('截面积改为 400 mm²，重新计算');await page.getByRole('button',{name:'生成任务计划',exact:true}).click();
 await expect(page.getByRole('button',{name:'批准并执行',exact:true})).toBeInViewport();await expect(page.locator('.cs-welcome-illustration')).toHaveCount(0);
 await expect(page.locator('.pending-composer')).not.toHaveAttribute('open');await expect(page.getByLabel('描述本次工程任务',{exact:true})).toBeHidden();
 await expect(page.locator('.engineering-task-stages [aria-current=step]')).toContainText('审查变更');
 await page.screenshot({path:info.outputPath('agent-review-v074.png'),fullPage:true});
 await page.locator('.pending-composer>summary').click();await expect(page.getByLabel('描述本次工程任务',{exact:true})).toHaveValue('截面积改为 400 mm²，重新计算');
 await page.getByRole('button',{name:'批准并执行',exact:true}).click();await expect(page.getByTestId('session-revision')).toHaveText('rev.2');
 await expect(page.locator('.flow-result-metrics')).toBeVisible();await expect(page.locator('.engineering-task-stages [aria-current=step]')).toContainText('复核结果');
 await page.getByRole('button',{name:'新任务',exact:true}).click();await expect(page.locator('.engineering-task-stages [aria-current=step]')).toContainText('描述任务');
});

test('missing art degrades to accessible explanation while task entry still works',async({page})=>{
 await page.route('**/engineering/*.png',route=>route.abort());await page.goto('/');await expect(page.locator('.plate-unavailable').first()).toContainText('参数编辑与计算不受影响');
 await page.getByRole('button',{name:'进入智能工程流',exact:true}).click();await expect(page.getByTestId('session-revision')).toHaveText('rev.1');
 await page.getByLabel('描述本次工程任务',{exact:true}).fill('计算载流量');await page.getByRole('button',{name:'生成任务计划',exact:true}).click();await expect(page.getByRole('button',{name:'批准并执行',exact:true})).toBeEnabled();
});

test('compact laptop layout has readable controls and no document overflow',async({page},info)=>{
 await page.setViewportSize({width:1440,height:900});await enter(page);await expect(page.getByTestId('cable-model-view')).toHaveAttribute('data-renderer','webgl');
 await expect(page.getByRole('button',{name:'计算载流量',exact:false})).toBeInViewport();await expect(page.locator('.enterprise-inspector')).toBeVisible();
 const font=await page.locator('.enterprise-inspector').getByLabel('导体截面积',{exact:true}).evaluate(el=>parseFloat(getComputedStyle(el).fontSize));expect(font).toBeGreaterThanOrEqual(14);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('laptop-v074.png'),fullPage:true});
});

test('narrow screen remains operable through mode choice and review',async({page},info)=>{
 await page.setViewportSize({width:390,height:844});await enter(page,'agent');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.getByLabel('描述本次工程任务',{exact:true}).fill('截面积改为 400 mm²，重新计算');await page.getByRole('button',{name:'生成任务计划',exact:true}).click();await expect(page.getByRole('button',{name:'批准并执行',exact:true})).toBeInViewport();
 await page.screenshot({path:info.outputPath('mobile-review-v074.png'),fullPage:true});
});

test('tablet navigation and keyboard review draft remain accessible',async({page})=>{
 await page.setViewportSize({width:650,height:900});await enter(page,'agent');
 await page.getByRole('button',{name:'显示任务导航',exact:true}).click();await expect(page.getByRole('button',{name:'企业型号选型',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'关闭任务导航',exact:true}).click();
 const input=page.getByLabel('描述本次工程任务',{exact:true});await input.fill('截面积改为 400 mm²，重新计算');await page.getByRole('button',{name:'生成任务计划',exact:true}).click();
 await expect(page.locator('.pending-composer')).toBeVisible();await page.keyboard.press('Control+k');await expect(input).toBeFocused();await expect(input).toHaveValue('截面积改为 400 mm²，重新计算');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
