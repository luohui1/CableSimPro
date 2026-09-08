import {test,expect} from '@playwright/test';
test('mobile composer and approved results remain in model context',async({page},info)=>{
 await page.goto('/');await expect(page.getByTestId('revision')).toHaveText('rev.1');
 await expect(page.getByLabel('工程任务',{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
 await page.getByLabel('工程任务',{exact:true}).fill('计算载流量');await page.getByRole('button',{name:'规划任务',exact:true}).click();await page.getByRole('button',{name:'批准并执行',exact:true}).click();await expect(page.getByTestId('revision')).toHaveText('rev.2');
 await page.getByRole('button',{name:'关闭工程助手',exact:true}).click();await expect(page.locator('h1')).toHaveText('电缆结构');await expect(page.locator('.inline-results .results-toolbar')).toContainText('允许载流量');
 const body=(await page.locator('.eng-body').boundingBox())!,dock=(await page.locator('.task-dock').boundingBox())!;expect(body.y+body.height).toBeLessThanOrEqual(dock.y+1);
 await page.screenshot({path:info.outputPath('same-workspace-mobile.png'),fullPage:true});
});
