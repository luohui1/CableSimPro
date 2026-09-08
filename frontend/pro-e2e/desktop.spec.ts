import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{await page.goto('/?legacy=1');await expect(page.getByTestId('revision')).toHaveText('rev.1')});

test('model, real calculation, row selection and export',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await expect(page.getByTestId('engineering-canvas')).toBeVisible();
 await page.getByRole('button',{name:'执行计算',exact:false}).click();
 await expect(page.locator('.results-toolbar')).toContainText('允许载流量');
 await expect(page.locator('.data-table tbody tr').first()).toContainText('47.');
 await page.getByRole('row').filter({hasText:'CKT-01 / C 相'}).click();
 await expect(page.locator('.inspector-title')).toContainText('C 相');
 const file=page.waitForEvent('download');await page.getByRole('button',{name:'计算书',exact:true}).click();
 const downloaded=await file;expect(downloaded.suggestedFilename()).toContain('计算书');
 const path=await downloaded.path();const fs=await import('node:fs/promises');expect(await fs.readFile(path!,'utf8')).toContain('SHA');
 await page.screenshot({path:info.outputPath('workbench-calculated.png'),fullPage:true});
 expect(errors).toEqual([]);
});

test('versioned properties, stale results, undo redo and reload',async({page})=>{
 await page.getByRole('button',{name:'执行计算',exact:false}).click();await expect(page.locator('.results-toolbar')).toContainText('允许载流量');
 await page.getByLabel('平均中心埋深',{exact:true}).fill('1.2');await page.getByLabel('平均中心埋深',{exact:true}).press('Tab');
 await expect(page.getByTestId('revision')).toHaveText('rev.2');await expect(page.locator('.results-toolbar')).toContainText('未计算');
 await expect(page.getByRole('button',{name:'计算书',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(page.getByLabel('平均中心埋深',{exact:true})).toHaveValue('0.8');
 await page.getByRole('button',{name:'重做',exact:true}).click();await expect(page.getByTestId('revision')).toHaveText('rev.4');
 await page.reload();await expect(page.getByLabel('平均中心埋深',{exact:true})).toHaveValue('1.2');await expect(page.getByTestId('revision')).toHaveText('rev.4');
});

test('agent plan preview approval and durable run',async({page},info)=>{
 await page.getByLabel('工程任务').fill('截面积改为 400 mm²，重新计算');await page.getByRole('button',{name:'规划任务',exact:true}).click();
 await expect(page.locator('.proposal-card')).toBeVisible();await expect(page.getByTestId('revision')).toHaveText('rev.1');
 await expect(page.locator('.diff-row')).toContainText('400');
 await page.screenshot({path:info.outputPath('agent-review.png'),fullPage:true});
 await page.getByRole('button',{name:'批准并执行'}).click();await expect(page.getByTestId('revision')).toHaveText('rev.2');
 await expect(page.locator('.results-toolbar')).toContainText('允许载流量');await expect(page.locator('.tool-record')).toContainText('calculate');
 await page.getByRole('button',{name:'CKT-01 · 电缆结构',exact:true}).click();await expect(page.getByLabel('导体截面积',{exact:true})).toHaveValue('400');
 await page.getByRole('button',{name:'运行记录',exact:true}).click();await expect(page.locator('.run-list button')).toHaveCount(1);
});

test('stale agent plan rejected after manual edit',async({page})=>{
 await page.getByLabel('工程任务').fill('截面积改为 400 mm²，重新计算');await page.getByRole('button',{name:'规划任务',exact:true}).click();await expect(page.locator('.proposal-card')).toBeVisible();
 await page.getByLabel('平均中心埋深',{exact:true}).fill('1');await page.getByLabel('平均中心埋深',{exact:true}).press('Tab');await expect(page.getByTestId('revision')).toHaveText('rev.2');
 await expect(page.getByRole('button',{name:'批准并执行'})).toBeDisabled();await expect(page.locator('.proposal-card')).toContainText('旧提案不能应用');
 await page.getByRole('button',{name:'拒绝',exact:true}).click();await expect(page.locator('.proposal-card')).toHaveCount(0);
});

test('canvas drag updates constrained geometry, locks and validation',async({page})=>{
 const canvas=page.getByTestId('engineering-canvas');const box=(await canvas.boundingBox())!;
 const scale=Number(await canvas.getAttribute('data-scale')),ox=Number(await canvas.getAttribute('data-origin-x')),oy=Number(await canvas.getAttribute('data-origin-y'));
 await page.mouse.move(box.x+ox,box.y+oy+.8*scale);await page.mouse.down();await page.mouse.move(box.x+ox,box.y+oy+1.1*scale,{steps:12});await page.mouse.up();
 await expect(page.getByLabel('平均中心埋深',{exact:true})).toHaveValue('1.1');
 await page.getByRole('button',{name:'锁定平均中心埋深',exact:true}).click();await expect(page.getByLabel('平均中心埋深',{exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'解锁平均中心埋深',exact:true}).click();await expect(page.getByLabel('平均中心埋深',{exact:true})).toBeEnabled();
 // Dockview also exposes an empty accessibility alert; assert the actual validation banner.
 await page.getByLabel('相邻中心间距',{exact:true}).fill('0.02');await page.getByLabel('相邻中心间距',{exact:true}).press('Tab');await expect(page.locator('.error-banner[role="alert"]')).toContainText('重叠');
});

test('evidence extraction needs review and stores actual quotes',async({page})=>{
 await page.getByRole('button',{name:'资料来源',exact:true}).last().click();
 await page.getByLabel('资料名称').fill('厂家参数测试');await page.getByLabel('资料原文').fill('截面积: 300 mm²\nR20: 0.0601 Ω/km\n绝缘厚度: 5.5 mm');
 await page.getByRole('button',{name:'提取为待审批变更'}).click();await expect(page.locator('.proposal-card')).toContainText('0.0601');await expect(page.getByTestId('revision')).toHaveText('rev.1');
 await page.getByRole('button',{name:'批准并执行'}).click();await expect(page.getByTestId('revision')).toHaveText('rev.2');
 await page.getByRole('button',{name:'资料来源',exact:true}).last().click();await expect(page.locator('.source-list')).toContainText('厂家参数测试');await expect(page.locator('.source-list')).toContainText('0.0601 Ω/km');
});

test('scan, section, WebGL and heat views render',async({page},info)=>{
 await page.getByRole('button',{name:'电缆截面',exact:true}).click();await expect(page.getByRole('img',{name:'电缆二维截面'})).toBeVisible();
 await page.getByRole('button',{name:'三维结构',exact:true}).click();await expect(page.locator('.scene')).toBeVisible();await expect(page.locator('.scene')).toHaveAttribute('data-webgl',/ready|unavailable/);
 await page.getByRole('button',{name:'执行计算',exact:false}).click();await expect(page.locator('.results-toolbar')).toContainText('允许载流量');
 await page.getByRole('button',{name:'土壤温度',exact:true}).click();await expect(page.getByLabel('土壤解析温度分布')).toBeVisible();
 await page.screenshot({path:info.outputPath('soil-thermal.png'),fullPage:true});
 await page.getByLabel('工程任务').fill('比较土壤热阻率 0.8、1.2、1.6 下的载流量');await page.getByRole('button',{name:'规划任务',exact:true}).click();await page.getByRole('button',{name:'批准并执行'}).click();await expect(page.locator('.agent-scroll')).toContainText('已求解 3 个独立工况');
 await page.getByRole('button',{name:'特性曲线',exact:true}).click();await expect(page.getByRole('img',{name:'参数扫描曲线'})).toBeVisible();
});

test('empty numeric input prevents accidental calculation',async({page})=>{
 let count=0;page.on('request',r=>{if(r.url().endsWith('/calculate'))count++});
 await page.getByLabel('平均中心埋深',{exact:true}).fill('');await page.getByRole('button',{name:'执行计算',exact:false}).click();await expect(page.locator('.error-banner[role="alert"]')).toContainText('输入');expect(count).toBe(0);
});
