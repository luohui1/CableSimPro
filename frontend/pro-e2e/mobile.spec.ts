import {test,expect} from '@playwright/test';
test('mobile model properties agent and results',async({page},info)=>{
 await page.goto('/');await expect(page.getByTestId('revision')).toHaveText('rev.1');
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);expect(overflow).toBe(false);
 await page.getByRole('button',{name:'属性',exact:true}).click();await page.getByLabel('平均中心埋深',{exact:true}).fill('1');await page.getByLabel('平均中心埋深',{exact:true}).press('Tab');await expect(page.getByTestId('revision')).toHaveText('rev.2');
 await page.getByRole('button',{name:'Copilot',exact:true}).click();await page.getByLabel('工程任务').fill('计算载流量');await page.getByRole('button',{name:'规划任务',exact:true}).click();await page.getByRole('button',{name:'批准并执行'}).click();await expect(page.getByTestId('revision')).toHaveText('rev.3');
 await page.screenshot({path:info.outputPath('mobile-agent.png'),fullPage:true});
 await page.getByRole('button',{name:'结果',exact:true}).click();await expect(page.locator('.results-toolbar')).toContainText('允许载流量');
});
