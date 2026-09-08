import {test,expect} from '@playwright/test';
test('mobile local artwork and mode entry do not introduce horizontal page scrolling',async({page},info)=>{
 await page.goto('/');
 for(const figure of await page.getByTestId('engineering-illustration').all())await expect(figure).toHaveAttribute('data-status','ready');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
 await page.getByRole('button',{name:'进入智能工程流',exact:true}).click();
 await expect(page.getByTestId('session-revision')).toHaveText('rev.1');
 await expect(page.getByRole('button',{name:'生成任务计划',exact:true})).toBeInViewport({ratio:1});
 await page.screenshot({path:info.outputPath('mobile-agent-v073.png'),fullPage:true});
 await page.getByLabel('描述本次工程任务',{exact:true}).fill('截面积改为 400 mm²，重新计算');
 await page.getByRole('button',{name:'生成任务计划',exact:true}).click();
 await expect(page.getByRole('region',{name:'待审查工程变更'})).toBeVisible();
 await expect(page.locator('.cs-welcome-visual')).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
});
