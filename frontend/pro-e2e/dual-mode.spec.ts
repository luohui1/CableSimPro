import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function enter(page:any,mode='workbench'){
 await page.goto('/');await page.getByRole('button',{name:mode==='workbench'?'进入专业工作台':'进入智能工程流',exact:true}).click();
 await expect(page.getByTestId('session-revision')).toHaveText('rev.1');
 await expect(page.getByTestId(mode==='workbench'?'professional-mode':'agent-mode')).toBeVisible();
}
const switcher=(page:any)=>page.getByRole('navigation',{name:'工作模式'});

test('entry makes no project, shows two modes and accessible light hierarchy',async({page},info)=>{
 let creates=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/workspaces'))creates++});
 await page.goto('/');await expect(page.getByRole('button',{name:'进入专业工作台',exact:true})).toBeEnabled();
 await expect(page.getByRole('heading',{name:'选择你的工作方式'})).toBeVisible();
 expect(creates).toBe(0);
 const report=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
 await info.attach('entry-axe.json',{body:JSON.stringify(report,null,2),contentType:'application/json'});expect(report.violations).toEqual([]);
 await page.screenshot({path:info.outputPath('dual-mode-entry.png'),fullPage:true});
});

test('calculation and model survive mode switch with one workspace',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await enter(page);
 const id=await page.evaluate(()=>localStorage.getItem('cablesim-studio-id'));
 const canvas=page.getByTestId('professional-mode').getByTestId('cable-model-view').locator('canvas');await expect(canvas).toBeVisible();await canvas.evaluate((e:any)=>e.dataset.testIdentity='preserved');
 await page.getByRole('button',{name:'计算载流量',exact:false}).click();await expect(page.locator('.enterprise-result-summary')).toBeVisible();
 const value=await page.locator('.enterprise-result-summary>div').first().locator('b').innerText();
 await switcher(page).getByRole('button',{name:'智能工程流',exact:true}).click();await expect(page.locator('.flow-result-metrics')).toContainText(value.replace(/\s+/g,' ').trim());
 await expect(page.getByTestId('session-revision')).toHaveText('rev.1');expect(await page.evaluate(()=>localStorage.getItem('cablesim-studio-id'))).toBe(id);
 await page.screenshot({path:info.outputPath('dual-mode-agent-result.png'),fullPage:true});
 await switcher(page).getByRole('button',{name:'专业工作台',exact:true}).click();await expect(canvas).toHaveAttribute('data-test-identity','preserved');
 await page.screenshot({path:info.outputPath('dual-mode-workbench.png'),fullPage:true});expect(errors).toEqual([]);
});

test('agent plan review applies real parameter change and restores after reload',async({page},info)=>{
 await enter(page,'agent');await page.getByLabel('描述本次工程任务',{exact:true}).fill('截面积改为 400 mm²，重新计算');await page.getByRole('button',{name:'生成任务计划',exact:true}).click();
 const proposal=page.getByRole('region',{name:'待审查工程变更'});await expect(proposal).toContainText('400');await expect(page.getByTestId('session-revision')).toHaveText('rev.1');
 await page.screenshot({path:info.outputPath('dual-mode-review.png'),fullPage:true});
 await page.reload();await expect(proposal).toContainText('400');await page.getByRole('button',{name:'批准并执行',exact:true}).click();await expect(page.getByTestId('session-revision')).toHaveText('rev.2');await expect(page.locator('.flow-result-metrics')).toBeVisible();
 await switcher(page).getByRole('button',{name:'专业工作台',exact:true}).click();await expect(page.locator('.enterprise-inspector').getByLabel('导体截面积',{exact:true})).toHaveValue('400');
 await page.reload();await expect(page.getByTestId('professional-mode')).toBeVisible();await expect(page.getByTestId('session-revision')).toHaveText('rev.2');await expect(page.locator('.enterprise-result-summary')).toBeVisible();
});

test('mode and browser history preserve task draft without changing revision',async({page})=>{
 await enter(page,'agent');const input=page.getByLabel('描述本次工程任务',{exact:true});await input.fill('待补充的客户设计任务');
 await switcher(page).getByRole('button',{name:'专业工作台',exact:true}).click();await page.goBack();await expect(page.getByTestId('agent-mode')).toBeVisible();await expect(input).toHaveValue('待补充的客户设计任务');
 await page.goForward();await expect(page.getByTestId('professional-mode')).toBeVisible();await expect(page.getByTestId('session-revision')).toHaveText('rev.1');
});

test('manual edit makes old agent proposal stale instead of overwriting engineering state',async({page})=>{
 await enter(page,'agent');await page.getByLabel('描述本次工程任务',{exact:true}).fill('截面积改为 400 mm²，重新计算');await page.getByRole('button',{name:'生成任务计划',exact:true}).click();await expect(page.getByRole('region',{name:'待审查工程变更'})).toBeVisible();
 await switcher(page).getByRole('button',{name:'专业工作台',exact:true}).click();const field=page.locator('.enterprise-inspector').getByLabel('导体截面积',{exact:true});await field.fill('300');await field.press('Tab');await expect(page.getByTestId('session-revision')).toHaveText('rev.2');
 await switcher(page).getByRole('button',{name:'智能工程流',exact:true}).click();await expect(page.getByRole('button',{name:'批准并执行',exact:true})).toBeDisabled();await expect(page.locator('.flow-review')).toContainText('不可批准旧提案');
 await page.getByRole('button',{name:'拒绝提案',exact:true}).click();await page.reload();await expect(page.getByRole('region',{name:'待审查工程变更'})).toHaveCount(0);
});

test('uncommitted property survives mode switch and blocks plan and approval',async({page})=>{
 await enter(page);const field=page.locator('.enterprise-inspector').getByLabel('导体截面积',{exact:true});await field.fill('');await field.press('Tab');
 await switcher(page).getByRole('button',{name:'智能工程流',exact:true}).click();await page.getByLabel('描述本次工程任务',{exact:true}).fill('计算载流量');await expect(page.getByRole('button',{name:'生成任务计划',exact:true})).toBeDisabled();
 await expect(page.locator('.dual-draft-warning')).toContainText('1 项未提交输入');await switcher(page).getByRole('button',{name:'专业工作台',exact:true}).click();await expect(field).toHaveValue('');
 await page.getByRole('button',{name:'撤销未提交输入',exact:true}).click();await expect(field).toHaveValue('240');
});

test('missing project deep link does not silently create or fall back',async({page})=>{
 let creates=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/workspaces'))creates++});
 await page.goto('/?mode=agent&project=missing-project');await expect(page.locator('.dual-alert')).toContainText('工程不存在');
 await expect(page.getByTestId('agent-mode')).toHaveCount(0);expect(creates).toBe(0);
 await page.getByRole('button',{name:'返回模式选择',exact:true}).last().click();await expect(page.getByRole('heading',{name:'选择你的工作方式'})).toBeVisible();
});

test('explicit workspace link opens exact project in either mode',async({page,request})=>{
 const w=await (await request.post('/api/workspaces',{data:{}})).json();
 await request.post(`/api/workspaces/${w.id}/edit`,{data:{expected_revision:1,changes:[{path:'cable.area_mm2',value:300}]}});
 await page.goto(`/?mode=agent&project=${w.id}`);await expect(page.getByTestId('session-revision')).toHaveText('rev.2');await expect(page.locator('.flow-context')).toContainText('300 mm²');
 await switcher(page).getByRole('button',{name:'专业工作台',exact:true}).click();await expect(page.locator('.enterprise-inspector').getByLabel('导体截面积',{exact:true})).toHaveValue('300');
 expect(new URL(page.url()).searchParams.get('project')).toBe(w.id);
});

test('Chinese composition and shift enter do not send, hidden workbench cannot steal focus',async({page})=>{
 await enter(page);await switcher(page).getByRole('button',{name:'智能工程流',exact:true}).click();let plans=0;page.on('request',r=>{if(r.url().endsWith('/invoke')&&r.postDataJSON()?.capability==='task.plan')plans++});
 const input=page.getByLabel('描述本次工程任务',{exact:true});await input.fill('计算载流量');await input.dispatchEvent('compositionstart');await input.dispatchEvent('keydown',{key:'Enter',keyCode:229,isComposing:true});await input.dispatchEvent('compositionend');await input.press('Shift+Enter');expect(plans).toBe(0);
 await page.keyboard.press('Control+k');await expect(input).toBeFocused();await expect(page.locator('.enterprise-task')).toBeHidden();
 await page.getByRole('button',{name:'生成任务计划',exact:true}).click();await expect(page.getByRole('region',{name:'待审查工程变更'})).toBeVisible();expect(plans).toBe(1);
});

test('cloud credentials are not invented and local mode is clearly marked',async({page},info)=>{
 await enter(page,'agent');await expect(page.getByLabel('工程流解析方式')).toHaveValue('local');await expect(page.getByLabel('工程流解析方式').locator('option[value=openai]')).toBeDisabled();
 await expect(page.locator('.flow-context')).toContainText('演示默认值不等于厂家数据');
 const report=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();await info.attach('agent-axe.json',{body:JSON.stringify(report,null,2),contentType:'application/json'});expect(report.violations).toEqual([]);
});
