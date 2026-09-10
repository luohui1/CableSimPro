import {test,expect,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {writeFile} from 'node:fs/promises';
async function enter(page:Page){await page.goto('/');await page.getByRole('button',{name:'进入专业工作台',exact:true}).click();await expect(page.getByTestId('session-revision')).toHaveText('rev.1');await expect(page.getByTestId('cable-model-view')).toHaveAttribute('data-renderer','webgl');}
async function command(page:Page,q:string){await page.getByRole('button',{name:'搜索命令',exact:true}).click();const input=page.getByRole('combobox',{name:'搜索工程命令'});await input.fill(q);await input.press('Enter');await expect(page.getByRole('dialog',{name:'命令中心',exact:true})).toBeHidden();}

for(const [width,height] of [[1600,1000],[1366,768]])test(`PC R3 ${width}: compact chrome, actual inputs and bounded viewport`,async({page},info)=>{
 await page.setViewportSize({width,height});await enter(page);
 const selectors={header:'.ps-commandbar',rail:'.enterprise-outline',canvas:'[data-testid="cable-model-view"]',inspector:'.enterprise-inspector',ribbon:'.ps-result-ribbon',footer:'.ref-status-footer'};
 const boxes:Record<string,{x:number;y:number;width:number;height:number}>={};
 for(const [key,selector] of Object.entries(selectors)){const b=(await page.locator(selector).boundingBox())!;expect(b,key).not.toBeNull();boxes[key]=b;expect(b.y+b.height,key).toBeLessThanOrEqual(height+1);expect(b.x+b.width,key).toBeLessThanOrEqual(width+1);}
 expect(boxes.header.height).toBe(60);expect(boxes.rail.width).toBe(64);expect(boxes.inspector.width).toBe(312);expect(boxes.ribbon.height).toBe(76);expect(boxes.canvas.height).toBeGreaterThan(height-300);expect(boxes.canvas.width).toBeGreaterThan(width-450);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1&&document.documentElement.scrollHeight<=innerHeight+1)).toBe(true);
 await expect(page.getByRole('button',{name:'计算载流量',exact:true})).toHaveCount(1);await expect(page.getByRole('button',{name:'导出计算书',exact:true})).toBeDisabled();
 await expect(page.locator('.enterprise-property-tabs')).toBeVisible();await expect(page.getByLabel('导体截面积',{exact:true})).toBeVisible();await expect(page.getByLabel('土壤热阻率',{exact:true})).toBeHidden();
 await writeFile(info.outputPath(`pc-landmarks-${width}.json`),JSON.stringify(boxes,null,2));await page.screenshot({path:info.outputPath(`pc-model-${width}.png`),fullPage:true});
 const axe=await new AxeBuilder({page}).include('.ps-workbench').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();await info.attach('pc-axe.json',{body:JSON.stringify(axe),contentType:'application/json'});expect(axe.violations).toEqual([]);
});

test('PC R3: real solve, split/full/summary and retained canvas/evidence',async({page},info)=>{
 await page.setViewportSize({width:1600,height:1000});await enter(page);const canvas=page.getByTestId('cable-model-view').locator('canvas');await canvas.evaluate(e=>e.setAttribute('data-pc-retained','yes'));
 const r=page.waitForResponse(r=>r.url().endsWith('/invoke')&&r.request().postDataJSON()?.capability==='analysis.buried');await page.getByRole('button',{name:'计算载流量',exact:true}).click();const result=(await(await r).json()).result.output.result;
 await expect(page.getByTestId('workbench-metrics')).toContainText(result.summary.ampacity_a.toFixed(1));
 await page.getByRole('button',{name:'查看分析',exact:true}).click();await expect(page.locator('.ps-workbench')).toHaveAttribute('data-analysis-layout','split');await expect(canvas).toBeVisible();
 const model=(await canvas.boundingBox())!,drawer=(await page.locator('#workbench-analysis-drawer').boundingBox())!;expect(model.y+model.height).toBeLessThanOrEqual(drawer.y);expect(model.height).toBeGreaterThan(300);
 await page.screenshot({path:info.outputPath('pc-analysis-split.png'),fullPage:true});await page.getByRole('button',{name:'展开完整分析',exact:true}).click();await expect(page.locator('.ps-workbench')).toHaveAttribute('data-analysis-layout','full');await expect(canvas).toBeHidden();await expect(canvas).toHaveAttribute('data-pc-retained','yes');
 await page.screenshot({path:info.outputPath('pc-analysis-full.png'),fullPage:true});await page.getByRole('button',{name:'关闭结果分析',exact:true}).click();await expect(canvas).toBeVisible();await expect(canvas).toHaveAttribute('data-pc-retained','yes');
 await page.setViewportSize({width:1366,height:768});await page.getByRole('button',{name:'查看分析',exact:true}).click();await expect(page.locator('.ps-workbench')).toHaveAttribute('data-analysis-layout','full');await expect(page.getByRole('button',{name:'关闭结果分析',exact:true})).toBeInViewport();
 await page.getByRole('button',{name:'关闭结果分析',exact:true}).click();await page.getByLabel('导体截面积',{exact:true}).fill('300');await page.getByLabel('导体截面积',{exact:true}).press('Enter');await expect(page.getByTestId('session-revision')).toHaveText('rev.2');await expect(page.getByRole('button',{name:'导出计算书',exact:true})).toBeDisabled();
});

test('PC R3: inspector categories and resource navigation keep uncommitted input',async({page},info)=>{
 await enter(page);await page.getByLabel('导体截面积',{exact:true}).fill('');await page.locator('.enterprise-property-tabs').getByRole('button',{name:'材料',exact:true}).click();await expect(page.getByLabel('导体截面积',{exact:true})).toBeHidden();await expect(page.getByRole('button',{name:'热物性参数',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'计算载流量',exact:true})).toBeDisabled();
 await command(page,'asset');await expect(page.getByRole('heading',{name:'工程资产库',exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'当前结果摘要',exact:true})).toBeHidden();await page.screenshot({path:info.outputPath('pc-assets-empty.png'),fullPage:true});
 await page.getByRole('button',{name:'返回电缆结构',exact:true}).click();await expect(page.getByLabel('导体截面积',{exact:true})).toHaveValue('');await expect(page.getByTestId('session-revision')).toHaveText('rev.1');
});

test('PC R3: domain pages and reusable component gallery contain real controls',async({page},info)=>{
 test.setTimeout(120000);await page.setViewportSize({width:1600,height:1000});await enter(page);
 for(const [q,title,file] of [['打开产品型号','产品型号','products'],['打开企业资料','企业资料','documents'],['打开专项场计算','场计算','fields'],['服务接入设置','服务接入','settings'],['components','组件参考','components']]){
  await command(page,q);await expect(page.getByRole('heading',{name:title,exact:true}).first()).toBeVisible();await expect(page.getByRole('region',{name:'当前结果摘要',exact:true})).toBeHidden();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:info.outputPath(`pc-${file}.png`),fullPage:true});
 }
 await page.getByLabel('组件状态',{exact:true}).selectOption('locked');await expect(page.getByLabel('厚度组件示例',{exact:true})).toBeDisabled();await expect(page.getByTestId('session-revision')).toHaveText('rev.1');
});

test('PC R3: Agent uses the same revision; review remains explicit',async({page},info)=>{
 await page.setViewportSize({width:1600,height:1000});await enter(page);await page.getByRole('button',{name:'智能工程流',exact:true}).click();await expect(page.getByRole('main',{name:'智能工程流工作区',exact:true})).toBeVisible();await expect(page.getByTestId('session-revision')).toHaveText('rev.1');
 await page.screenshot({path:info.outputPath('pc-agent.png'),fullPage:true});await page.getByLabel('描述本次工程任务',{exact:true}).fill('截面积改为 300 mm²');await page.getByRole('button',{name:'生成任务计划',exact:true}).click();await expect(page.getByRole('button',{name:'批准并执行',exact:true})).toBeVisible();await expect(page.getByTestId('session-revision')).toHaveText('rev.1');
 await page.screenshot({path:info.outputPath('pc-agent-review.png'),fullPage:true});await page.getByRole('button',{name:'拒绝提案',exact:true}).click();await expect(page.getByTestId('session-revision')).toHaveText('rev.1');
});
