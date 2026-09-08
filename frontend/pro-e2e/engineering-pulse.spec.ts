import {test,expect} from '@playwright/test';

test('shared engineering pulse carries one review and result across both modes',async({page},info)=>{
 await page.goto('/');
 await page.getByRole('button',{name:'进入专业工作台',exact:true}).click();
 const pulse=page.getByTestId('engineering-pulse');
 await expect(pulse).toBeVisible();
 await expect(pulse.getByTestId('pulse-cable')).toContainText('240 mm²');
 await expect(pulse.getByTestId('pulse-result')).toContainText('待计算');
 await pulse.getByRole('button',{name:'开始计算',exact:true}).click();
 const objective=page.getByLabel('描述本次工程任务',{exact:true});
 await expect(objective).toHaveValue('计算载流量');
 await page.getByRole('button',{name:'生成任务计划',exact:true}).click();
 await expect(pulse).toContainText('等待工程审查');
 await expect(pulse.getByRole('button',{name:'审查提案',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'批准并执行',exact:true}).click();
 await expect(pulse).toContainText('结果可复核');
 await expect(pulse.getByTestId('pulse-result')).toContainText('A');
 await page.getByRole('button',{name:'专业工作台',exact:true}).click();
 await expect(page.locator('.enterprise-result-summary')).toBeVisible();
 await expect(page.getByTestId('engineering-pulse')).toContainText('结果可复核');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('engineering-pulse-v074.png'),fullPage:true});
});

test('engineering pulse keeps narrow layouts inside the application viewport',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto('/');
 await page.getByRole('button',{name:'进入智能工程流',exact:true}).click();
 const pulse=page.getByTestId('engineering-pulse');
 await expect(pulse).toBeVisible();
 expect(await pulse.evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await pulse.getByTestId('pulse-installation').scrollIntoViewIfNeeded();
 await pulse.getByTestId('pulse-installation').click();
 await expect(page.getByRole('heading',{name:'敷设与负荷',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
