import {test,expect,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const switcher=(page:Page)=>page.getByRole('navigation',{name:'工作模式'});
async function enter(page:Page){await page.goto('/');await page.getByRole('button',{name:'进入智能工程流',exact:true}).click();await expect(page.getByTestId('session-revision')).toHaveText('rev.1')}
async function propose(page:Page){await page.getByLabel('描述本次工程任务',{exact:true}).fill('截面积改为 400 mm²，重新计算');await page.getByRole('button',{name:'生成任务计划',exact:true}).click();await expect(page.getByRole('region',{name:'待审查工程变更'})).toBeVisible()}

test('light entry renders two engineering visuals without creating a project or calling outside services',async({page},info)=>{
 const creates:string[]=[],outside:string[]=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/workspaces'))creates.push(r.url());if(r.url().startsWith('http')&&!r.url().startsWith('http://127.0.0.1:8000'))outside.push(r.url())});
 await page.goto('/');await expect(page.getByRole('heading',{name:'选择你的工作方式'})).toBeVisible();await expect(page.getByTestId('cable-portrait')).toHaveCount(1);
 await expect(page.locator('.entry-task-asset img')).toHaveJSProperty('naturalWidth',1200);
 await expect(page.getByTestId('cable-portrait').first()).toHaveAttribute('data-renderer',/ready|fallback/);
 expect(creates).toEqual([]);expect(outside).toEqual([]);
 await page.screenshot({path:info.outputPath('entry-v072.png'),fullPage:true});
});

test('task studio has real engineering module navigation and readable accessible light layout',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await enter(page);
 await expect(page.getByRole('heading',{name:/这次，需要解决\s*什么电缆设计问题/})).toBeVisible();
 await expect(page.getByRole('complementary',{name:'任务工程依据'})).toBeVisible();
 await expect(page.locator('.cs-artifacts').getByTestId('cable-portrait')).toHaveAttribute('data-renderer',/ready|fallback/);
 await expect(page.getByRole('button',{name:'生成任务计划',exact:true})).toBeInViewport();
 const report=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();await info.attach('task-studio-axe.json',{body:JSON.stringify(report,null,2),contentType:'application/json'});expect(report.violations).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
 await page.screenshot({path:info.outputPath('agent-home-v072.png'),fullPage:true});expect(errors).toEqual([]);
});

test('candidate preview and unit diff are real, approval computes and history stays read only',async({page},info)=>{
 await enter(page);const workspace=new URL(page.url()).searchParams.get('project');await propose(page);
 await expect(page.locator('.cs-diff-table')).toContainText('mm²');await expect(page.getByTestId('session-revision')).toHaveText('rev.1');
 await expect(page.locator('.cs-artifacts').getByTestId('cable-portrait')).toHaveAttribute('data-area','400');
 await expect(page.getByRole('button',{name:'批准并执行',exact:true})).toBeInViewport();
 await page.screenshot({path:info.outputPath('agent-review-v072.png'),fullPage:true});
 await page.getByRole('button',{name:'批准并执行',exact:true}).click();await expect(page.getByTestId('session-revision')).toHaveText('rev.2');await expect(page.locator('.flow-result-metrics')).toBeVisible();
 await page.screenshot({path:info.outputPath('agent-result-v072.png'),fullPage:true});
 let invokes=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/invoke'))invokes++});
 await page.locator('.cs-rail-section>button').first().click();await expect(page.getByRole('region',{name:'执行记录详情'})).toContainText('不可变任务快照');await expect(page.locator('.cs-record-meta')).toContainText('输入版本 1');await expect(page.getByTestId('archived-task-summary')).toContainText('当次工程输入');await expect(page.getByTestId('archived-task-summary').locator('pre').first()).toBeHidden();expect(invokes).toBe(0);expect(new URL(page.url()).searchParams.get('project')).toBe(workspace);
 await switcher(page).getByRole('button',{name:'专业工作台',exact:true}).click();await expect(page.locator('.enterprise-inspector').getByLabel('导体截面积',{exact:true})).toHaveValue('400');
 await page.screenshot({path:info.outputPath('workbench-v072.png'),fullPage:true});
});

test('attachment tabs show engineering geometry and missing evidence, not invented validation',async({page})=>{
 await enter(page);await page.getByRole('button',{name:'敷设截面',exact:true}).click();await expect(page.getByLabel('当前直埋敷设截面示意')).toBeVisible();await expect(page.locator('.cs-artifact-content')).toContainText('0.8 m');
 await page.getByRole('button',{name:'参数依据',exact:true}).click();await expect(page.locator('.cs-artifact-content')).toContainText('演示默认值不等于厂家数据');await expect(page.locator('.cs-artifact-content')).toContainText('导体温度上限');
 await expect(page.getByTestId('session-revision')).toHaveText('rev.1');
});

test('new task preserves pending review and existing results without extra projects',async({page})=>{
 await enter(page);let creates=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/workspaces'))creates++});
 await propose(page);await expect(page.getByRole('button',{name:'新任务',exact:true})).toBeDisabled();await page.getByRole('button',{name:'拒绝提案',exact:true}).click();
 await page.getByRole('button',{name:'新任务',exact:true}).click();await expect(page.getByLabel('描述本次工程任务',{exact:true})).toHaveValue('');await expect(page.getByTestId('session-revision')).toHaveText('rev.1');expect(creates).toBe(0);
});

test('expired candidate is never presented as the current applied model',async({page})=>{
 await enter(page);await propose(page);await switcher(page).getByRole('button',{name:'专业工作台',exact:true}).click();const field=page.locator('.enterprise-inspector').getByLabel('导体截面积',{exact:true});await field.fill('300');await field.press('Tab');await expect(page.getByTestId('session-revision')).toHaveText('rev.2');
 await switcher(page).getByRole('button',{name:'智能工程流',exact:true}).click();await expect(page.getByRole('button',{name:'批准并执行',exact:true})).toBeDisabled();await expect(page.locator('.cs-artifacts').getByTestId('cable-portrait')).toHaveAttribute('data-area','300');await expect(page.locator('.cs-review')).toContainText('不可批准旧提案');
});

test('task module views open real selection, document and standards tools',async({page})=>{
 const hiddenLoads:string[]=[];
 page.on('request',r=>{const path=new URL(r.url()).pathname;if(['/api/enterprise/eligible','/api/enterprise/products','/api/library','/api/runtime/standards'].includes(path))hiddenLoads.push(path)});
 const provenance=page.waitForResponse(r=>r.url().includes('/provenance')&&r.status()===200);
 await enter(page);await provenance;
 // Task-first startup must not eagerly start hidden product/library/standards modules.
 expect(hiddenLoads).toEqual([]);
 const nav=page.getByRole('navigation',{name:'工程流内容'});
 await nav.getByRole('button',{name:'企业型号选型',exact:true}).click();await expect(page.locator('.cs-module-surface:not([hidden])')).toContainText('目标电流');
 await nav.getByRole('button',{name:'资料与参数核对',exact:true}).click();await expect(page.locator('.cs-module-surface:not([hidden])')).toContainText('资料与工程参数');
 await nav.getByRole('button',{name:'计算依据',exact:true}).click();await expect(page.locator('.cs-module-surface:not([hidden])')).toContainText('IEC');
 await nav.getByRole('button',{name:'当前任务',exact:true}).click();await expect(page.getByLabel('描述本次工程任务',{exact:true})).toBeVisible();
});


test('review preserves manufacturer resistance precision and never calculates before approval',async({page,request},info)=>{
 await enter(page);const wid=new URL(page.url()).searchParams.get('project');
 const response=await request.post(`/api/workspaces/${wid}/evidence`,{data:{expected_revision:1,title:'R20 精度测试资料',page:1,text:'R20: 0.0601 Ω/km'}});expect(response.status()).toBe(200);
 await page.reload();await expect(page.locator('.cs-diff-table')).toContainText('0.0601');await expect(page.getByTestId('session-revision')).toHaveText('rev.1');
 await expect(page.locator('.cs-result')).toHaveCount(0);await page.screenshot({path:info.outputPath('resistance-precision-v072.png'),fullPage:true});
});

test('engineering readiness: approval shows real evidence and method limits before execution',async({page},info)=>{
 await enter(page);await propose(page);const gate=page.getByTestId('engineering-readiness');
 await expect(gate).toBeVisible();await expect(gate).toContainText('可执行研究计算');await expect(gate).toContainText('研究级可执行');
 await expect(gate).toContainText('无已核对资料引用');await expect(gate).toContainText('R20 仍为估算');await expect(gate).toContainText('交流附加与屏蔽损耗系数');
 await expect(gate).toContainText('不是完整标准计算或最终工程签审');await expect(page.getByRole('button',{name:'批准并执行',exact:true})).toBeEnabled();
 await page.screenshot({path:info.outputPath('engineering-readiness-review.png'),fullPage:true});
 await switcher(page).getByRole('button',{name:'专业工作台',exact:true}).click();const field=page.locator('.enterprise-inspector').getByLabel('导体截面积',{exact:true});await field.fill('300');await field.press('Tab');await expect(page.getByTestId('session-revision')).toHaveText('rev.2');
 await switcher(page).getByRole('button',{name:'智能工程流',exact:true}).click();await expect(gate).toContainText('当前提案不可执行');await expect(gate).toContainText('提案基于 rev.1，当前工程为 rev.2');await expect(page.getByRole('button',{name:'批准并执行',exact:true})).toBeDisabled();
});
