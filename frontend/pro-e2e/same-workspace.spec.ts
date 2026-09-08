// Migration regression: v0.5 workspace lives at ?classic=1; enterprise.spec.ts tests the new default.
import {test,expect,type Page} from '@playwright/test';
async function nav(p:Page,name:string){await p.locator('.eng-sidebar nav').getByRole('button',{name,exact:true}).click()}
test.beforeEach(async({page})=>{await page.goto('/?classic=1');await expect(page.getByTestId('revision')).toHaveText('rev.1')});

test('direct bottom input expands without sidebar, canvas replacement or width loss',async({page},info)=>{
 const field=page.getByLabel('工程任务',{exact:true}),canvas=page.locator('.model-render canvas');
 await expect(field).toBeVisible();await expect(page.locator('.eng-assistant')).toHaveCount(0);await expect(canvas).toBeVisible();
 const width=(await canvas.boundingBox())!.width;
 await canvas.evaluate(e=>{e.setAttribute('data-retained','original')});
 await field.fill('先核对当前电缆');await page.getByRole('button',{name:'任务与会话',exact:true}).click();
 await expect(page.locator('.task-dock')).toHaveClass(/is-expanded/);
 expect((await canvas.boundingBox())!.width).toBeCloseTo(width,0);await expect(canvas).toHaveAttribute('data-retained','original');
 const body=(await page.locator('.eng-body').boundingBox())!,dock=(await page.locator('.task-dock').boundingBox())!;
 expect(body.y+body.height).toBeLessThanOrEqual(dock.y+1);
 await page.keyboard.press('Escape');await expect(field).toBeFocused();await expect(field).toHaveValue('先核对当前电缆');
 await expect(page.locator('.agent-scroll')).toBeHidden();await expect(canvas).toHaveAttribute('data-retained','original');
 await page.screenshot({path:info.outputPath('same-workspace-input.png'),fullPage:true});
});

test('model calculation and result views stay on current model and use real response',async({page},info)=>{
 const canvas=page.locator('.model-render canvas');await expect(canvas).toBeVisible();await canvas.evaluate(e=>e.setAttribute('data-retained','model'));
 const response=page.waitForResponse(r=>r.url().endsWith('/invoke')&&r.request().postDataJSON()?.capability==='analysis.buried');
 await page.getByRole('button',{name:'计算载流量',exact:false}).click();const r=await (await response).json();
 await expect(page.locator('h1')).toHaveText('电缆结构');await expect(page.locator('.inline-results .results-toolbar')).toContainText(r.result.output.result.summary.ampacity_a.toFixed(1));
 await expect(canvas).toHaveAttribute('data-retained','model');
 await page.getByRole('button',{name:'特性曲线',exact:true}).click();await expect(page.getByRole('img',{name:'电流温度曲线',exact:true})).toBeVisible();await expect(page.locator('h1')).toHaveText('电缆结构');
 await page.getByRole('button',{name:'土壤温度',exact:true}).click();await expect(page.getByLabel('土壤解析温度分布')).toBeVisible();await expect(canvas).toHaveAttribute('data-retained','model');
 await page.getByRole('button',{name:'结果表',exact:true}).click();await page.screenshot({path:info.outputPath('same-workspace-results.png'),fullPage:true});
});

test('IME composition and shift enter never accidentally submit a task',async({page})=>{
 const input=page.getByLabel('工程任务',{exact:true});let plans=0;
 page.on('request',r=>{if(r.url().endsWith('/invoke')&&r.postDataJSON()?.capability==='task.plan')plans++});
 await input.fill('计算载流量');
 await input.dispatchEvent('compositionstart',{data:'计'});
 await input.dispatchEvent('keydown',{key:'Enter',code:'Enter',keyCode:229,isComposing:true,bubbles:true});
 await input.dispatchEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,isComposing:false,bubbles:true});
 await expect(input).toHaveValue('计算载流量');expect(plans).toBe(0);
 await input.dispatchEvent('compositionend',{data:'计算'});await input.press('End');await input.press('Shift+Enter');
 await expect(input).toHaveValue('计算载流量\n');expect(plans).toBe(0);
 await input.press('Enter');await expect(page.locator('.proposal-card')).toBeVisible();expect(plans).toBe(1);
});

test('task draft survives navigation and keyboard focus shortcut',async({page})=>{
 const input=page.getByLabel('工程任务',{exact:true});await input.fill('需要保留的工程任务');
 await nav(page,'敷设布置');await expect(input).toHaveValue('需要保留的工程任务');await page.keyboard.press('Control+k');await expect(input).toBeFocused();
 await page.getByRole('button',{name:'任务与会话',exact:true}).click();await page.getByRole('button',{name:'关闭工程助手',exact:true}).click();
 await expect(input).toBeVisible();await expect(input).toHaveValue('需要保留的工程任务');
});

test('uncommitted parameter blocks both assistant and same-page calculation',async({page})=>{
 let plans=0,calculations=0;
 page.on('request',r=>{if(!r.url().endsWith('/invoke'))return;const c=r.postDataJSON()?.capability;if(c==='task.plan')plans++;if(c==='analysis.buried')calculations++});
 await page.getByLabel('导体截面积',{exact:true}).fill('');
 const input=page.getByLabel('工程任务',{exact:true});await input.fill('计算载流量');await expect(page.getByRole('button',{name:'规划任务',exact:true})).toBeDisabled();await input.press('Enter');await expect(input).toHaveValue('计算载流量');
 await page.getByRole('button',{name:'计算载流量',exact:false}).click();await expect(page.locator('.eng-error-banner')).toContainText('未提交');
 expect(plans).toBe(0);expect(calculations).toBe(0);await expect(page.locator('h1')).toHaveText('电缆结构');
});

test('collapsed proposal persists and approval updates model without a page jump',async({page},info)=>{
 const input=page.getByLabel('工程任务',{exact:true});await input.fill('截面积改为 400 mm²，重新计算');await input.press('Enter');
 await expect(page.locator('.proposal-card')).toBeVisible();await expect(page.getByTestId('revision')).toHaveText('rev.1');
 await page.getByRole('button',{name:'关闭工程助手',exact:true}).click();await expect(page.getByRole('button',{name:'审查变更',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'审查变更',exact:true}).click();await expect(page.locator('.diff-row').filter({hasText:'导体截面积'})).toContainText('400');
 await page.screenshot({path:info.outputPath('same-workspace-approval.png'),fullPage:true});
 await page.getByRole('button',{name:'批准并执行',exact:true}).click();await expect(page.getByTestId('revision')).toHaveText('rev.2');await expect(page.locator('h1')).toHaveText('电缆结构');
 await expect(page.getByLabel('导体截面积',{exact:true})).toHaveValue('400');await expect(page.locator('.inline-results .results-toolbar')).toContainText('允许载流量');
});

test('manual edit invalidates pending proposal and computed temperature together',async({page})=>{
 await page.getByRole('button',{name:'计算载流量',exact:false}).click();await expect(page.locator('.inline-results .results-toolbar')).toContainText('允许载流量');
 await page.getByLabel('工程任务',{exact:true}).fill('截面积改为 400 mm²，重新计算');await page.getByRole('button',{name:'规划任务',exact:true}).click();await expect(page.locator('.proposal-card')).toBeVisible();
 await page.getByLabel('绝缘厚度',{exact:true}).fill('6');await page.getByLabel('绝缘厚度',{exact:true}).press('Tab');await expect(page.getByTestId('revision')).toHaveText('rev.2');
 await expect(page.getByRole('button',{name:'批准并执行',exact:true})).toBeDisabled();await expect(page.locator('.inline-stale')).toBeVisible();await expect(page.locator('.inline-results .results-toolbar')).toContainText('未计算');
 await page.getByRole('button',{name:'特性曲线',exact:true}).click();await expect(page.getByRole('img',{name:'电流温度曲线',exact:true})).toHaveCount(0);
});

test('edited input invalidates parameter scan rather than reusing stale curve',async({page})=>{
 await page.getByLabel('工程任务',{exact:true}).fill('比较土壤热阻率 0.8、1.2、1.6 下的载流量');await page.getByRole('button',{name:'规划任务',exact:true}).click();await page.getByRole('button',{name:'批准并执行',exact:true}).click();
 await expect(page.getByTestId('revision')).toHaveText('rev.2');await page.getByRole('button',{name:'关闭工程助手',exact:true}).click();await page.getByRole('button',{name:'特性曲线',exact:true}).click();await expect(page.getByRole('img',{name:'参数扫描曲线',exact:true})).toBeVisible();
 await page.getByLabel('绝缘厚度',{exact:true}).fill('6');await page.getByLabel('绝缘厚度',{exact:true}).press('Tab');await expect(page.getByTestId('revision')).toHaveText('rev.3');await expect(page.getByRole('img',{name:'参数扫描曲线',exact:true})).toHaveCount(0);await expect(page.locator('.inline-stale')).toBeVisible();
});
