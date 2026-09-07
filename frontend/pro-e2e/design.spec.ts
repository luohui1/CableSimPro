import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{await page.goto('/');await expect(page.getByTestId('revision')).toHaveText('rev.1');await page.getByRole('button',{name:'设计中心 · OCR / 选型',exact:true}).click();});

test('vertical finite-volume and coaxial field studies return real snapshots',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.getByRole('button',{name:'求解竖向热模型'}).click();await expect(page.locator('.convergence')).toContainText('热平衡残差');
 await expect(page.locator('.design-metrics').first()).toContainText('733.6');
 await expect(page.getByRole('img',{name:'温度 / °C分布曲线'})).toBeVisible();
 await page.screenshot({path:info.outputPath('vertical-thermal.png'),fullPage:true});
 await page.getByRole('button',{name:'绝缘电场',exact:true}).click();await page.getByRole('button',{name:'求解绝缘电场'}).click();
 await expect(page.getByLabel('同轴绝缘电场分布')).toBeVisible();await expect(page.locator('.design-metrics')).toContainText('nF/km');
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出场数据'}).click();const file=await download;
 const fs=await import('node:fs/promises');const payload=JSON.parse(await fs.readFile((await file.path())!,'utf8'));expect(payload.output.model).toBe('COAX-ELECTRIC-0.4');expect(payload.output.field_rms_kv_mm.length).toBe(91);
 await page.screenshot({path:info.outputPath('electric-field.png'),fullPage:true});expect(errors).toEqual([]);
});

test('document upload extraction review catalogue and local source retrieval',async({page},info)=>{
 await page.getByRole('button',{name:'企业资料库',exact:true}).click();
 await page.getByLabel('企业资料集').fill('E2E '+info.project.name);
 await page.locator('.design-hub input[type=file]').setInputFiles({name:'Product-300-'+info.project.name+'.txt',mimeType:'text/plain',buffer:Buffer.from('截面积: 300 mm²\nR20: 0.0601 Ω/km\n绝缘厚度: 5.5 mm\n护套厚度: 2.5 mm')});
 await expect(page.locator('.document-text')).toContainText('0.0601');await page.getByRole('button',{name:'解析本页电缆参数'}).click();
 await expect(page.locator('.extraction-review')).toContainText('0.0601');await expect(page.getByRole('button',{name:'确认保存到选型库'})).toBeDisabled();
 await page.screenshot({path:info.outputPath('enterprise-library-review.png'),fullPage:true});
 await page.getByLabel('选型条目名称').fill('E2E Cable 300 '+info.project.name);await page.getByLabel('确认候选参数入库').check();await page.getByRole('button',{name:'确认保存到选型库'}).click();
 await expect(page.locator('.design-notice')).toContainText('部分来源已核对');await expect(page.getByTestId('revision')).toHaveText('rev.1');
 await page.getByRole('button',{name:'资料与选型 Agent',exact:true}).click();await page.getByLabel('资料研究任务').fill('检索资料: R20');await page.getByRole('button',{name:'开始资料研究'}).click();
 await expect(page.locator('.research-output')).toContainText('不是大模型生成答案');await expect(page.locator('.citation-card').first()).toContainText('0.0601');
 await page.screenshot({path:info.outputPath('grounded-library-search.png'),fullPage:true});
});

test('reverse selection respects constraints and needs explicit apply review',async({page},info)=>{
 await page.getByRole('button',{name:'反向选型',exact:true}).click();await expect(page.getByLabel('纳入演示选型库')).not.toBeChecked();
 await page.getByLabel('纳入演示选型库').check();await page.getByRole('button',{name:'运行反向选型'}).click();await expect(page.locator('.selection-summary')).toContainText('550.0');
 await expect(page.locator('.recommended')).toHaveCount(1);await page.screenshot({path:info.outputPath('inverse-selection.png'),fullPage:true});
 await page.locator('.recommended').getByRole('button',{name:'审查应用'}).click();await expect(page.locator('.candidate-approval')).toBeVisible();await expect(page.getByTestId('revision')).toHaveText('rev.1');
 await page.getByRole('button',{name:'批准应用电缆'}).click();await expect(page.getByTestId('revision')).toHaveText('rev.2');await expect(page.locator('.design-notice')).toContainText('请按所选域重新计算');
 await page.getByLabel('目标运行电流').fill('3000');await page.getByRole('button',{name:'运行反向选型'}).click();await expect(page.locator('.selection-summary')).toContainText('无符合');await expect(page.locator('.recommended')).toHaveCount(0);
});

test('OCR waits for credentials and preserves the original scan',async({page},info)=>{
 await page.getByRole('button',{name:'OCR / Agent 接入',exact:true}).click();await expect(page.locator('.connection-grid')).toContainText('未配置');
 await page.getByRole('button',{name:'企业资料库',exact:true}).click();
 // Real PNG fixture; no OCR provider is mocked into being configured.
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAFUlEQVR4nGP8//8/A27AhEduBEsDAKXjAxF9kqZqAAAAAElFTkSuQmCC','base64');
 await page.locator('.design-hub input[type=file]').setInputFiles({name:'scan-'+info.project.name+'.png',mimeType:'image/png',buffer:png});
 await expect(page.locator('.document-text')).toContainText('没有可提取文字');await expect(page.getByRole('button',{name:'OCR 此页',exact:true})).toBeDisabled();
 await expect(page.getByRole('button',{name:'解析本页电缆参数'})).toBeDisabled();
 await page.getByRole('button',{name:'返回建模',exact:true}).click();await expect(page.getByTestId('engineering-canvas')).toBeVisible();
 await page.screenshot({path:info.outputPath('contrast-workbench.png'),fullPage:true});
});
