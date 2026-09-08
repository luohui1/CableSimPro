import {test,expect} from '@playwright/test';
test('enterprise mobile task, model and result do not overflow',async({page},info)=>{
 await page.goto('/');await expect(page.getByTestId('revision')).toHaveText('rev.1');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 await expect(page.getByRole('region',{name:'设计任务'})).toBeHidden();
 await page.getByRole('button',{name:'计算载流量',exact:false}).click();await expect(page.locator('.enterprise-result-summary')).toContainText('允许载流量');
 await page.getByRole('button',{name:'设计任务',exact:true}).click();await page.getByLabel('企业工程任务').fill('计算载流量');await page.locator('.enterprise-task').getByRole('button',{name:'规划任务',exact:false}).click();await expect(page.locator('.enterprise-proposal')).toBeVisible();
 await page.locator('.enterprise-proposal').getByRole('button',{name:'批准并执行'}).click();await expect(page.getByTestId('revision')).toHaveText('rev.2');
 await page.screenshot({path:info.outputPath('enterprise-mobile-task.png'),fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
});
test('enterprise mobile sections expose product and installation tasks',async({page})=>{
 await page.goto('/');await expect(page.getByTestId('revision')).toHaveText('rev.1');
 await page.getByRole('button',{name:'产品型号',exact:true}).click();await expect(page.getByRole('button',{name:'从当前电缆建草稿'})).toBeVisible();
 await page.getByRole('button',{name:'显示工程目录'}).click();await page.getByRole('button',{name:'敷设与负荷',exact:true}).click();await expect(page.getByTestId('engineering-canvas')).toBeVisible();
 await page.getByRole('button',{name:'三维空间检查'}).click();await expect(page.getByTestId('installation-3d')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
});
