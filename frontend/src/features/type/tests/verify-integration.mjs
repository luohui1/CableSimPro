import { expect as baseExpect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { typeFixture, output } from './fixture.mjs';
import { checkLayout } from './ui-checks.mjs';

const expect=baseExpect.configure({timeout:25000}),fixture=await typeFixture({main:true}),{page}=fixture;
const result={workflows:[],layouts:[],screenshots:[],errors:fixture.errors};
try {
  await page.setViewportSize({width:1366,height:768});await page.goto(fixture.url+'/types');await expect(page.locator('[data-type-page=list]')).toBeVisible();
  const models=await fixture.api('/api/design/cable-models'),model=models.find(item=>item.id==='system.cu-xlpe-al-compacted-400');
  const workspace=await fixture.api('/api/design/type-workspaces','POST',{model_id:model.id,content_sha256:model.content_sha256});
  for(const width of [1366,1920])for(const theme of ['light','dark']){
    await page.setViewportSize({width,height:width===1366?768:1080});await page.goto(`${fixture.url}/types/${workspace.id}/structure/table?theme=${theme}`);
    await expect(page.getByRole('columnheader',{name:'尺寸 / mm',exact:true})).toBeVisible();await expect(page.getByText('直径',{exact:true})).toBeVisible();expect(await page.getByText('厚度',{exact:true}).count()).toBeGreaterThan(0);
    result.layouts.push(await checkLayout(page));
    if(width===1366&&theme==='light'){const file=path.join(output,'screenshots/structure-dimensions.png');await page.screenshot({path:file});result.screenshots.push(file);}
  }
  await page.getByRole('button',{name:'设置',exact:true}).click();await expect(page.locator('[data-page=settings]')).toBeVisible();await page.getByRole('radio',{name:'浅色',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','light');await page.goto(`${fixture.url}/types/${workspace.id}/structure/table?theme=light`);
  await page.getByRole('tab',{name:'外径与用料',exact:true}).click();await page.getByRole('button',{name:'更新结构推导',exact:true}).click();await expect(page.getByRole('dialog',{name:'更新结构推导 · 预检',exact:true})).toBeVisible();await page.getByRole('checkbox',{name:'已核对输入来源与方法适用范围',exact:true}).check();await page.getByRole('button',{name:'确认并运行',exact:true}).click();
  await expect(page.locator('[data-type-page=quantities]')).toHaveAttribute('data-type-state','success',{timeout:90000});await expect(page.getByRole('table',{name:'外径与用料',exact:true})).toBeVisible();
  result.workflows.push('正式主入口、分层尺寸、设置主题、复用运行控件的真实CAD结构推导');
  expect(fixture.errors).toEqual([]);
}catch(error){result.failure=String(error.stack||error);result.backendLog=fixture.log();console.error(result.failure);console.error((await page.locator('body').innerText()).slice(0,2200));process.exitCode=1;}
finally{await fs.writeFile(path.join(output,'integration-verification.json'),JSON.stringify(result,null,2));await fixture.close();}
