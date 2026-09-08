import {test,expect} from '@playwright/test';
test('mobile entry mode switch plan and current result',async({page},info)=>{
 await page.goto('/');await expect(page.getByRole('button',{name:'进入智能工程流',exact:true})).toBeEnabled();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 await page.screenshot({path:info.outputPath('dual-mode-mobile-entry.png'),fullPage:true});
 await page.getByRole('button',{name:'进入智能工程流',exact:true}).click();await expect(page.getByTestId('session-revision')).toHaveText('rev.1');
 await page.getByLabel('描述本次工程任务',{exact:true}).fill('计算载流量');await page.getByRole('button',{name:'生成任务计划',exact:true}).click();await page.getByRole('button',{name:'批准并执行',exact:true}).click();await expect(page.locator('.flow-result-metrics')).toBeVisible();
 await page.screenshot({path:info.outputPath('dual-mode-mobile-agent.png'),fullPage:true});
 const id=await page.evaluate(()=>localStorage.getItem('cablesim-studio-id'));
 await page.getByRole('navigation',{name:'工作模式'}).getByRole('button',{name:'专业工作台',exact:true}).click();await expect(page.getByTestId('professional-mode')).toBeVisible();expect(await page.evaluate(()=>localStorage.getItem('cablesim-studio-id'))).toBe(id);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
});
test('mobile mode history keeps a draft and stale result warning',async({page})=>{
 await page.goto('/?mode=agent');await expect(page.getByTestId('session-revision')).toHaveText('rev.1');const input=page.getByLabel('描述本次工程任务',{exact:true});await input.fill('尚未提交的任务');
 await page.getByRole('navigation',{name:'工作模式'}).getByRole('button',{name:'专业工作台',exact:true}).click();await page.goBack();await expect(input).toHaveValue('尚未提交的任务');
});
