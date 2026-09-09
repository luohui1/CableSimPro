import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
async function enter(page:Page){await page.goto('/');await page.getByRole('button',{name:'进入专业工作台',exact:true}).click();await expect(page.getByTestId('session-revision')).toHaveText('rev.1');}
async function openStudy(page:Page){await page.getByRole('button',{name:'搜索命令',exact:true}).click();const input=page.getByRole('combobox',{name:'搜索工程命令'});await input.fill('preflight');await input.press('Enter');return page.getByRole('dialog',{name:'研究准备',exact:true});}

test('study preflight reads committed inputs, exports matching evidence and never writes',async({page},info)=>{
 await page.setViewportSize({width:1366,height:768});await enter(page);let writes=0;page.on('request',r=>{if(!['GET','HEAD','OPTIONS'].includes(r.method()))writes++});
 const response=page.waitForResponse(r=>r.url().includes('/api/foundation/workspaces/')&&r.url().includes('/preflight'));
 const dialog=await openStudy(page);const data=await(await response).json();
 await expect(dialog).toContainText('输入契约可打包');await expect(dialog.locator('tbody tr')).toHaveCount(6);
 await expect(dialog).toHaveClass(/eng-dialog/);await expect(dialog).toHaveCSS('display','flex');await expect(dialog.locator(':scope > .study-preparation')).toHaveCSS('overflow-y','auto');
 await expect(dialog).toContainText('未构建原生模型');await expect(dialog).toContainText('未求解');
 const download=page.waitForEvent('download');await dialog.getByRole('button',{name:'导出预检记录',exact:true}).click();
 const file=await(await download).path();const exported=JSON.parse(await readFile(file!,'utf8'));
 expect(exported.package_sha256).toBe(data.package_sha256);expect(exported.solver_executed).toBe(false);
 const axe=await new AxeBuilder({page}).include('[role="dialog"]').withTags(['wcag2a','wcag2aa']).analyze();expect(axe.violations).toEqual([]);
 await expect(dialog.getByRole('heading',{name:'研究准备',exact:true})).toBeInViewport();
 await expect(dialog.getByRole('button',{name:'关闭对话框',exact:true})).toBeInViewport();
 const bounds=(await dialog.boundingBox())!;expect(bounds.y).toBeGreaterThanOrEqual(0);expect(bounds.y+bounds.height).toBeLessThanOrEqual(768);expect(bounds.width).toBeLessThanOrEqual(900);
 await page.screenshot({path:info.outputPath('study-preflight.png'),fullPage:true});
 expect(writes).toBe(0);await expect(page.getByTestId('session-revision')).toHaveText('rev.1');
});

test('native target cannot pretend a COMSOL build or solve succeeded',async({page},info)=>{
 await enter(page);const dialog=await openStudy(page);await expect(dialog).toContainText('输入契约可打包');
 await dialog.getByLabel('研究准备目标',{exact:true}).selectOption('comsol');await expect(dialog).toContainText('原生执行器未接入');
 await expect(dialog).toContainText('不能声明兼容或模型已构建');await page.screenshot({path:info.outputPath('study-native-blocked.png'),fullPage:true});await expect(dialog.getByRole('button',{name:/运行仿真|批准执行/})).toHaveCount(0);
});

test('uncommitted input blocks study preparation instead of exporting previous values',async({page})=>{
 await enter(page);await page.getByLabel('导体截面积',{exact:true}).fill('');
 await page.getByRole('button',{name:'搜索命令',exact:true}).click();const input=page.getByRole('combobox',{name:'搜索工程命令'});await input.fill('preflight');
 await expect(page.getByRole('option')).toHaveAttribute('aria-disabled','true');await input.press('Enter');
 await expect(page.getByRole('dialog',{name:'研究准备',exact:true})).toHaveCount(0);
});
