import {test,expect} from '@playwright/test';
test('mobile agent navigation review and composer remain usable without page overflow',async({page},info)=>{
 await page.goto('/');await page.getByRole('button',{name:'进入智能工程流',exact:true}).click();await expect(page.getByTestId('session-revision')).toHaveText('rev.1');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
 await page.getByLabel('描述本次工程任务',{exact:true}).fill('截面积改为 400 mm²，重新计算');await page.getByRole('button',{name:'生成任务计划',exact:true}).click();await expect(page.getByRole('region',{name:'待审查工程变更'})).toBeVisible();await page.getByRole('button',{name:'批准并执行',exact:true}).click();await expect(page.getByTestId('session-revision')).toHaveText('rev.2');
 await page.getByRole('button',{name:'显示任务导航',exact:true}).click();await expect(page.getByRole('navigation',{name:'工程流内容'})).toBeVisible();await page.getByRole('button',{name:'关闭任务导航',exact:true}).click();
 await page.screenshot({path:info.outputPath('agent-mobile-v072.png'),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
});
