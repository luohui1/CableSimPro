import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('professional home and command dialog remain readable without hidden writes',async({page,request},info)=>{
 const created=await request.post('/api/workspaces',{data:{}});expect(created.status()).toBe(201);const w=await created.json();
 const writes:string[]=[];page.on('request',r=>{if(r.method()==='POST')writes.push(r.url())});
 await page.goto('/?workflow=1');await expect(page.getByRole('heading',{name:'从一个工程开始。'})).toBeVisible();
 await expect(page.locator('.wf-recent>button').first()).toBeVisible();
 const home=await new AxeBuilder({page}).include('.wf-root').withTags(['wcag2a','wcag2aa']).analyze();expect(home.violations).toEqual([]);
 await page.screenshot({path:info.outputPath('professional-home.png')});expect(writes).toEqual([]);
 await page.goto(`/?workflow=1&project=${w.id}`);await expect(page.getByTestId('workflow-canvas')).toBeVisible();
 await page.keyboard.press('Control+k');const dialog=page.getByRole('dialog',{name:'工程命令',exact:true});await expect(dialog).toBeVisible();
 const search=await new AxeBuilder({page}).include('.wf-command-dialog').withTags(['wcag2a','wcag2aa']).analyze();expect(search.violations).toEqual([]);
 await dialog.getByLabel('搜索工程命令').fill('not-a-command');await expect(dialog).toContainText('没有匹配命令');
 await page.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(page.locator('#wf-command-trigger')).toBeFocused();expect(writes).toEqual([]);
});
