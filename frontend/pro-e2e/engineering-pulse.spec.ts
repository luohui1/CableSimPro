import {test,expect} from '@playwright/test';

async function openWorkbenchPulse(page:any){
 const disclosure=page.locator('.wb-context-disclosure:visible');
 await expect(disclosure).toHaveCount(1);
 if(!(await disclosure.evaluate((el:HTMLDetailsElement)=>el.open)))await disclosure.locator('summary').click();
 await expect(disclosure).toHaveJSProperty('open',true);
 const pulse=disclosure.getByTestId('engineering-pulse');await expect(pulse).toBeVisible();return pulse;
}
const agentPulse=(page:any)=>page.locator('.dual-app.is-project > [data-testid="engineering-pulse"]');

test('shared engineering pulse carries one review and result across both modes',async({page},info)=>{
 test.slow();
 await page.goto('/');
 await page.getByRole('button',{name:'进入专业工作台',exact:true}).click();
 await expect(page.getByTestId('professional-mode')).toBeVisible();
 const workbenchPulse=await openWorkbenchPulse(page);
 await expect(workbenchPulse.getByTestId('pulse-cable')).toContainText('240 mm²');
 await expect(workbenchPulse.getByTestId('pulse-result')).toContainText('待计算');
 await workbenchPulse.getByRole('button',{name:'开始计算',exact:true}).click();
 await expect(page.getByTestId('agent-mode')).toBeVisible();
 const pulse=agentPulse(page);await expect(pulse).toBeVisible();
 const objective=page.getByLabel('描述本次工程任务',{exact:true});
 await expect(objective).toHaveValue('计算载流量');
 const planned=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/invoke')&&r.request().postDataJSON()?.capability==='task.plan');
 await page.getByRole('button',{name:'生成任务计划',exact:true}).click();expect((await planned).ok()).toBe(true);
 await expect(pulse).toContainText('等待工程审查');
 await expect(pulse.getByRole('button',{name:'审查提案',exact:true})).toBeVisible();
 const approved=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/approve'));
 await page.getByRole('button',{name:'批准并执行',exact:true}).click();expect((await approved).ok()).toBe(true);
 await expect(pulse).toContainText(/结果可复核|运行电流超过允许载流量/);
 await expect(pulse.getByTestId('pulse-result')).toContainText('A');
 await page.getByRole('navigation',{name:'工作模式'}).getByRole('button',{name:'专业工作台',exact:true}).click();
 await expect(page.getByTestId('professional-mode')).toBeVisible();
 await expect(page.locator('.enterprise-result-summary')).toBeVisible();
 const returnedPulse=await openWorkbenchPulse(page);
 await expect(returnedPulse).toContainText(/结果可复核|运行电流超过允许载流量/);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('engineering-pulse-v074.png'),fullPage:true});
});

test('engineering pulse keeps narrow layouts inside the application viewport',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto('/');
 await page.getByRole('button',{name:'进入智能工程流',exact:true}).click();
 await expect(page.getByTestId('agent-mode')).toBeVisible();
 const pulse=agentPulse(page);await expect(pulse).toBeVisible();
 expect(await pulse.evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await pulse.getByTestId('pulse-installation').scrollIntoViewIfNeeded();
 await pulse.getByTestId('pulse-installation').click();
 await expect(page.getByRole('heading',{name:'敷设与负荷',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
