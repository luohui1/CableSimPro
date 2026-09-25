import {test,expect,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const referenceLayout=JSON.parse(readFileSync(fileURLToPath(new URL('../../docs/REFERENCE_LAYOUT.json',import.meta.url)),'utf8')) as {landmarks_at_source_size:{rail:[number,number,number,number]}};
async function enter(page:Page){await page.goto('/');await page.getByRole('button',{name:'进入专业工作台',exact:true}).click();await expect(page.getByTestId('session-revision')).toHaveText('rev.1');await expect(page.getByTestId('cable-model-view')).toHaveAttribute('data-renderer','webgl');}
async function palette(page:Page){await page.getByRole('button',{name:'搜索命令',exact:true}).click();const input=page.getByRole('combobox',{name:'搜索工程命令'});await expect(input).toBeFocused();return input;}

test('progressive: a single command bar, large canvas and collapsed analysis use real components',async({page},info)=>{
 await enter(page);
 await expect(page.getByRole('banner',{name:'工程命令栏'})).toHaveCount(1);
 await expect(page.locator('.dual-context')).toHaveCount(0);
 await expect(page.locator('.ps-analysis-drawer')).toBeHidden();
 await expect(page.getByRole('region',{name:'当前电缆分层预览'})).toBeHidden();
 const model=(await page.getByTestId('cable-model-view').boundingBox())!;
 const rail=(await page.locator('.enterprise-outline').boundingBox())!;
 expect(rail.width).toBe(referenceLayout.landmarks_at_source_size.rail[2]);expect(model.width).toBeGreaterThan(800);expect(model.height).toBeGreaterThan(440);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await expect(page.getByRole('button',{name:'绝缘与护套',exact:true})).toHaveAttribute('aria-expanded','false');
 await page.screenshot({path:info.outputPath('progressive-default.png'),fullPage:true});
 const result=await new AxeBuilder({page}).include('.progressive-studio').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
 await info.attach('progressive-axe.json',{body:JSON.stringify(result),contentType:'application/json'});expect(result.violations).toEqual([]);
});

test('progressive: command search supports keyboard, reasons, preferences and focus return',async({page},info)=>{
 test.slow();
 await enter(page);const canvas=page.getByTestId('cable-model-view').locator('canvas');await canvas.evaluate(e=>e.setAttribute('data-retained','commands'));
 let writes=0;page.on('request',r=>{if(r.method()==='POST')writes++});
 const input=await palette(page);await input.fill('report');
 await expect(page.getByRole('option')).toHaveCount(1);await expect(page.getByRole('option')).toHaveAttribute('aria-disabled','true');
 await expect(page.locator('.ps-command-reason')).toContainText('没有当前版本');await input.press('Enter');await expect(input).toBeVisible();expect(writes).toBe(0);
 await input.fill('jiemian');await expect(page.getByRole('option')).toHaveCount(1);
 await page.getByRole('button',{name:'收藏命令',exact:true}).click();await expect(page.getByRole('button',{name:'取消收藏',exact:true})).toHaveAttribute('aria-pressed','true');
 const dialog=page.getByRole('dialog',{name:'命令中心'});
 await dialog.screenshot({path:info.outputPath('progressive-command-center.png')});
 await input.press('Enter');await expect(page.getByRole('dialog',{name:'命令中心'})).toHaveCount(0);
 await expect(page.getByRole('img',{name:'电缆二维截面'})).toBeVisible();await expect(canvas).toHaveAttribute('data-retained','commands');expect(writes).toBe(0);
 await page.keyboard.press('Control+k');await expect(input).toBeFocused();await page.getByRole('button',{name:'最近使用',exact:true}).click();await expect(page.getByRole('option')).toContainText('显示二维截面');
 await input.press('Escape');await expect(page.getByRole('button',{name:'搜索命令',exact:true})).toBeFocused();
});

test('progressive: command execution respects drafts and composition without writing',async({page})=>{
 await enter(page);await page.getByLabel('导体截面积',{exact:true}).fill('');
 const input=await palette(page);let writes=0;page.on('request',r=>{if(r.method()==='POST')writes++});
 await input.fill('运行载流量');await expect(page.getByRole('option')).toHaveAttribute('aria-disabled','true');await input.press('Enter');expect(writes).toBe(0);
 await input.fill('截面');await input.dispatchEvent('compositionstart');await input.dispatchEvent('keydown',{key:'Enter',keyCode:229,isComposing:true});await input.dispatchEvent('compositionend');await input.dispatchEvent('keydown',{key:'Enter',keyCode:13});await expect(input).toBeVisible();
 await input.press('Escape');await expect(page.getByLabel('导体截面积',{exact:true})).toHaveValue('');
 await expect(page.getByRole('button',{name:'计算载流量',exact:true})).toBeDisabled();expect(writes).toBe(0);
});

test('progressive: an explicit sweep command prepares an Agent draft and never auto approves',async({page})=>{
 await enter(page);const input=await palette(page);let writes=0;page.on('request',r=>{if(r.method()==='POST')writes++});
 await input.fill('比较环境温度');await input.press('Enter');
 await expect(page.getByTestId('agent-mode')).toBeVisible();await expect(page.getByLabel('描述本次工程任务',{exact:true})).toHaveValue('比较环境温度 -10、25、40 °C 下的载流量');
 expect(writes).toBe(0);await expect(page.getByTestId('session-revision')).toHaveText('rev.1');
 await expect(page.getByRole('button',{name:'批准并执行',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'生成任务计划',exact:true}).click();await expect(page.getByRole('region',{name:'扫描计划明细'})).toContainText('-10 / 25 / 40');
 await expect(page.getByTestId('session-revision')).toHaveText('rev.1');
});

test('progressive: object inspection, comparison and result drawer retain canvas and current evidence',async({page},info)=>{
 await enter(page);const model=page.getByTestId('cable-model-view'),canvas=model.locator('canvas');await canvas.evaluate(e=>e.setAttribute('data-retained','analysis'));
 await page.getByRole('button',{name:'收起参数检查器',exact:true}).click();await expect(page.locator('.enterprise-inspector')).toBeHidden();
 await page.locator('.ps-layer-menu>summary').click();await page.getByRole('button',{name:'检查XLPE 绝缘参数',exact:true}).click();
 await expect(page.locator('.enterprise-inspector')).toBeVisible();await expect(page.getByLabel('绝缘厚度',{exact:true})).toBeVisible();
 await page.locator('.ps-layer-menu>summary').click();
 const response=page.waitForResponse(r=>r.url().endsWith('/invoke')&&r.request().postDataJSON()?.capability==='analysis.buried');await page.getByRole('button',{name:'计算载流量',exact:true}).click();const data=await(await response).json();
 await expect(page.getByTestId('workbench-metrics')).toContainText(data.result.output.result.summary.ampacity_a.toFixed(1));
 await expect(page.locator('.ps-analysis-drawer')).toBeHidden();await page.screenshot({path:info.outputPath('progressive-computed.png'),fullPage:true});
 let writes=0;page.on('request',r=>{if(r.method()==='POST')writes++});await page.getByRole('button',{name:'查看分析',exact:true}).click();
 await expect(page.getByRole('img',{name:'当前运行径向温度曲线',exact:true})).toBeVisible();await expect(canvas).toHaveAttribute('data-retained','analysis');
 await page.screenshot({path:info.outputPath('progressive-analysis-drawer.png'),fullPage:true});
 await page.getByRole('navigation',{name:'分析内容'}).getByRole('button',{name:'运行证据',exact:true}).click();await expect(page.locator('.ps-run-evidence')).toContainText(data.result.output.run_id);expect(writes).toBe(0);
 const field=page.getByLabel('导体截面积',{exact:true});await field.fill('300');await field.press('Tab');await expect(page.getByTestId('session-revision')).toHaveText('rev.2');
 await expect(page.locator('.ps-run-evidence')).toContainText('暂无可用于当前版本');await expect(page.getByRole('button',{name:'导出计算书',exact:true})).toBeDisabled();await expect(canvas).toHaveAttribute('data-retained','analysis');
});

test('progressive: project center exposes real saved workspaces and remains bounded on narrow screens',async({page},info)=>{
 await enter(page);const stored=await(await page.request.get('/api/workspaces')).json();await page.getByRole('banner',{name:'工程命令栏'}).getByRole('button',{name:'打开工程中心',exact:true}).click();
 const hub=page.getByRole('dialog',{name:'工程中心',exact:true});await expect(hub.locator('.eng-project-list button')).toHaveCount(stored.length);await expect(hub).toContainText('240 mm²');await page.screenshot({path:info.outputPath('progressive-project-center.png'),fullPage:true});
 await page.getByRole('button',{name:'关闭对话框',exact:true}).click();await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 const input=await palette(page);await input.fill('参数');await expect(input).toBeInViewport();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('progressive-command-mobile.png'),fullPage:true});await input.press('Escape');
});
