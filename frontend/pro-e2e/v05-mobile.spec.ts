// Migration regression: v0.5 workspace lives at ?classic=1; enterprise.spec.ts tests the new default.
import {test,expect} from '@playwright/test';

test('mobile task based navigation 3d fallback and retained input safety',async({page},info)=>{
 await page.goto('/?classic=1');await expect(page.getByTestId('revision')).toHaveText('rev.1');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
 await expect(page.locator('.eng-properties')).toHaveCount(0);
 await page.getByRole('button',{name:'显示或隐藏属性'}).click();await page.getByLabel('导体截面积',{exact:true}).fill('300');await page.getByLabel('导体截面积',{exact:true}).press('Tab');await expect(page.getByTestId('revision')).toHaveText('rev.2');
 await page.getByRole('button',{name:'显示或隐藏属性'}).click();
 await page.getByRole('button',{name:'打开导航'}).click();await page.locator('.eng-sidebar nav').getByRole('button',{name:'敷设布置',exact:true}).click();
 await page.getByRole('button',{name:'计算载流量',exact:false}).click();await expect(page.locator('.results-toolbar')).toContainText('允许载流量');
 await page.screenshot({path:info.outputPath('v05-mobile-results.png'),fullPage:true});
});

test('mobile assistant approval and settings dialog dismissal',async({page},info)=>{
 await page.goto('/?classic=1');await expect(page.getByTestId('revision')).toHaveText('rev.1');
 await page.getByRole('button',{name:'工程助手',exact:true}).click();await page.getByLabel('工程任务').fill('截面积改为 400 mm²，重新计算');await page.getByRole('button',{name:'规划任务',exact:true}).click();
 await expect(page.locator('.proposal-card')).toBeVisible();await page.getByRole('button',{name:'批准并执行'}).click();await expect(page.getByTestId('revision')).toHaveText('rev.2');
 await page.screenshot({path:info.outputPath('v05-mobile-assistant.png'),fullPage:true});
 await page.getByRole('button',{name:'关闭工程助手'}).click();await page.getByRole('button',{name:'打开导航'}).click();await page.getByRole('button',{name:'显示设置',exact:true}).click();
 await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('button',{name:'关闭对话框'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
});
