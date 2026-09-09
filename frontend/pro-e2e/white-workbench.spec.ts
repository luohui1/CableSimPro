import {test,expect,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {readFile} from 'node:fs/promises';
async function enter(page:Page){await page.goto('/');await page.getByRole('button',{name:'进入专业工作台',exact:true}).click();await expect(page.getByTestId('session-revision')).toHaveText('rev.1');await expect(page.getByTestId('cable-model-view')).toHaveAttribute('data-renderer','webgl');}
const switcher=(p:Page)=>p.getByRole('navigation',{name:'工作模式'});

test('white workbench: real white shell, grouped controls, local backdrop and no preset results',async({page},info)=>{
 const external:string[]=[];page.on('request',r=>{if(r.url().startsWith('http')&&!r.url().startsWith('http://127.0.0.1:8000'))external.push(r.url())});
 await enter(page);
 await expect(page.locator('.white-workbench')).toHaveCSS('background-color','rgb(255, 255, 255)');
 await expect(page.getByTestId('professional-mode').locator('.enterprise-content')).toHaveCSS('background-color','rgb(255, 255, 255)');
 await expect(page.locator('.wb-context-disclosure')).not.toHaveAttribute('open');
 await expect(page.locator('.wb-navigation')).toHaveCount(1);
 await expect(page.getByRole('region',{name:'当前电缆分层预览'})).toBeVisible();
 await expect(page.locator('.wb-property-group').first()).toContainText('导体与电压');
 await expect(page.locator('.wb-brand-scene img')).toHaveJSProperty('naturalWidth',348);
 await expect(page.getByTestId('workbench-metrics').locator('.wb-metric')).toHaveCount(4);
 for(const v of await page.getByTestId('workbench-metrics').locator('strong').allTextContents())expect(v).toContain('—');
 await expect(page.getByRole('button',{name:'导出计算书',exact:true})).toBeDisabled();
 expect(external).toEqual([]);
 await page.screenshot({path:info.outputPath('white-workbench-initial.png'),fullPage:true});
 const result=await new AxeBuilder({page}).include('.white-workbench').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
 await info.attach('white-workbench-axe.json',{body:JSON.stringify(result),contentType:'application/json'});expect(result.violations).toEqual([]);
});

test('white workbench: calculation, live metrics, radial chart, export and canvas retention',async({page},info)=>{
 await enter(page);const canvas=page.getByTestId('cable-model-view').locator('canvas');await canvas.evaluate(e=>e.setAttribute('data-retained','white'));
 const response=page.waitForResponse(r=>r.url().endsWith('/invoke')&&r.request().postDataJSON()?.capability==='analysis.buried');
 await page.getByRole('button',{name:'计算载流量',exact:false}).click();const payload=await(await response).json(),summary=payload.result.output.result.summary;
 const cards=page.getByTestId('workbench-metrics').locator('.wb-metric');
 await expect(cards.nth(0)).toContainText(summary.ampacity_a.toFixed(1));
 await expect(cards.nth(1)).toContainText(summary.operating_max_temperature_c.toFixed(1));
 await expect(cards.nth(2)).toContainText(summary.thermal_margin_c.toFixed(1));
 await expect(cards.nth(3)).toContainText(summary.circuit_loss_kw.toFixed(2));
 const boxes=await Promise.all([0,1,2,3].map(i=>cards.nth(i).boundingBox()));
 for(let i=1;i<boxes.length;i++){
  expect(boxes[i]!.y).toBeCloseTo(boxes[0]!.y,0);
  expect(boxes[i]!.x).toBeGreaterThan(boxes[i-1]!.x+boxes[i-1]!.width);
 }
 const overview=page.getByTestId('workbench-metrics');
 expect((await overview.boundingBox())!.height).toBeLessThan(180);
 await expect(page.getByRole('img',{name:'当前运行径向温度曲线',exact:true})).toBeVisible();
 const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'导出计算书',exact:true}).click();const file=await downloaded;expect(file.suggestedFilename()).toContain('计算书');const report=await readFile((await file.path())!,'utf8');
 expect(report).toContain(`${summary.ampacity_a.toFixed(2)} A`);
 expect(report).toContain(payload.result.output.result.input_sha256);
 expect(report).toContain(`${summary.operating_max_temperature_c.toFixed(2)} °C`);
 await page.screenshot({path:info.outputPath('white-workbench-computed.png'),fullPage:true});
 await page.getByRole('region',{name:'运行结果分析',exact:true}).scrollIntoViewIfNeeded();
 await page.screenshot({path:info.outputPath('white-workbench-analysis.png'),fullPage:true});
 await switcher(page).getByRole('button',{name:'智能工程流',exact:true}).click();await expect(page.locator('.white-workbench')).toHaveCount(0);await expect(page.locator('.flow-result-metrics')).toContainText(summary.ampacity_a.toFixed(1));
 await switcher(page).getByRole('button',{name:'专业工作台',exact:true}).click();await expect(canvas).toHaveAttribute('data-retained','white');
});

test('white workbench: drafts, locked inputs and stale output stay guarded',async({page})=>{
 await enter(page);await page.getByRole('button',{name:'计算载流量',exact:false}).click();await expect(page.locator('.enterprise-result-summary')).toBeVisible();
 const field=page.getByLabel('导体截面积',{exact:true});await field.fill('');await field.press('Tab');await expect(page.getByRole('button',{name:'计算载流量',exact:false})).toBeDisabled();await expect(page.getByRole('button',{name:'导出计算书',exact:true})).toBeDisabled();
 await expect(page.getByTestId('workbench-metrics').locator('.wb-metric strong').first()).toContainText('—');
 await page.getByRole('button',{name:'撤销未提交输入',exact:true}).click();await field.fill('300');await field.press('Tab');await expect(page.getByTestId('session-revision')).toHaveText('rev.2');
 await expect(page.getByRole('region',{name:'当前电缆分层预览'})).toContainText('300 mm²');await expect(page.getByRole('img',{name:'当前运行径向温度曲线',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'锁定导体截面积',exact:true}).click();await expect(field).toBeDisabled();await expect(page.getByTestId('session-revision')).toHaveText('rev.3');
});

for(const width of [1366,390])test(`white workbench: ${width}px layout keeps controls reachable when artwork fails`,async({page},info)=>{
 await page.setViewportSize({width,height:width===390?844:900});await page.route('**/engineering/white-workbench/**',r=>r.abort());await enter(page);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await expect(page.getByRole('button',{name:'计算载流量',exact:false})).toBeVisible();
 const field=page.getByLabel('导体截面积',{exact:true});await field.scrollIntoViewIfNeeded();await expect(field).toBeVisible();await field.fill('300');await field.press('Tab');await expect(page.getByTestId('session-revision')).toHaveText('rev.2');
 if(width===390){await page.getByRole('button',{name:'显示工程目录',exact:true}).click();await page.getByRole('button',{name:'敷设与负荷',exact:true}).click();await expect(page.getByRole('heading',{name:'敷设与负荷',exact:true})).toBeVisible();
  const plot=page.getByTestId('engineering-canvas');
  await expect.poll(async()=>Number(await plot.getAttribute('data-scale'))*Number(await plot.getAttribute('data-ruler-step'))).toBeGreaterThanOrEqual(56-1e-6);
  expect(Number(await plot.getAttribute('data-scale'))*Number(await plot.getAttribute('data-grid-step'))).toBeGreaterThanOrEqual(14-1e-6);
 }
 await page.screenshot({path:info.outputPath(`white-workbench-${width}.png`),fullPage:true});
});


test('white workbench: collapsed parameter groups retain drafts, locks and keyboard access',async({page})=>{
 await enter(page);
 const group=page.getByRole('button',{name:'导体与电压',exact:true});
 const field=page.getByLabel('导体截面积',{exact:true});
 await field.fill('');await group.click();
 await expect(group).toHaveAttribute('aria-expanded','false');
 await expect(group).toContainText('1 项未提交');
 await expect(field).toBeHidden();
 await expect(page.getByRole('button',{name:'计算载流量',exact:false})).toBeDisabled();
 await expect(page.getByTestId('workbench-save-state')).toHaveText('输入待提交');
 await group.focus();await page.keyboard.press('Space');
 await expect(group).toHaveAttribute('aria-expanded','true');await expect(field).toHaveValue('');
 await page.getByRole('button',{name:'撤销未提交输入',exact:true}).click();
 await page.getByRole('button',{name:'锁定导体截面积',exact:true}).click();
 await expect(page.getByTestId('session-revision')).toHaveText('rev.2');
 await group.click();await expect(page.getByRole('region',{name:'导体与电压',exact:true})).toContainText('1 项参数已锁定');
 await group.press('Enter');await expect(field).toBeDisabled();
 await expect(page.getByTestId('session-revision')).toHaveText('rev.2');
});

test('white workbench: focus canvas preserves model, draft and original side panels',async({page},info)=>{
 await enter(page);
 const model=page.getByTestId('cable-model-view'),canvas=model.locator('canvas');
 await canvas.evaluate(e=>e.setAttribute('data-retained','focus'));
 const before=(await model.boundingBox())!.width;
 const field=page.getByLabel('导体截面积',{exact:true});await field.fill('');
 let writes=0;page.on('request',r=>{if(r.method()==='POST')writes++});
 await page.getByRole('button',{name:'专注画布',exact:true}).click();
 await expect(page.locator('.enterprise-outline')).toBeHidden();await expect(page.locator('.enterprise-inspector')).toBeHidden();
 expect((await model.boundingBox())!.width).toBeGreaterThan(before);
 await expect(page.getByRole('button',{name:'计算载流量',exact:false})).toBeDisabled();
 await expect(canvas).toHaveAttribute('data-retained','focus');
 await page.screenshot({path:info.outputPath('white-workbench-focus.png'),fullPage:true});
 await page.keyboard.press('Escape');
 await expect(page.getByRole('button',{name:'专注画布',exact:true})).toHaveAttribute('aria-pressed','false');
 await expect(page.locator('.enterprise-outline')).toBeVisible();await expect(field).toBeVisible();await expect(field).toHaveValue('');
 await expect(canvas).toHaveAttribute('data-retained','focus');expect(writes).toBe(0);
 await page.getByRole('button',{name:'撤销未提交输入',exact:true}).click();
 await expect(page.getByTestId('session-revision')).toHaveText('rev.1');
 // A global navigation action must not leave the user trapped in focus layout.
 await page.getByRole('button',{name:'专注画布',exact:true}).click();
 await page.getByRole('button',{name:'双模式服务设置',exact:true}).click();
 await expect(page.getByRole('heading',{name:'服务接入',exact:true})).toBeVisible();
 await expect(page.locator('.enterprise-outline')).toBeVisible();
});
