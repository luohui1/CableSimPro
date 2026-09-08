import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{await page.goto('/?legacy=1');await expect(page.getByTestId('revision')).toHaveText('rev.1')});

test('high contrast property text and real field diagnostics',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const font=await page.getByLabel('平均中心埋深',{exact:true}).evaluate(el=>parseFloat(getComputedStyle(el).fontSize));expect(font).toBeGreaterThanOrEqual(12);
 await page.screenshot({path:info.outputPath('v04-workbench.png'),fullPage:true});
 await page.getByRole('button',{name:'场分析',exact:true}).click();
 await page.getByLabel('场分析网格').selectOption('129');
 await page.getByRole('button',{name:'运行场分析',exact:false}).click();
 await expect(page.getByTestId('field-title')).toContainText('有限差分');
 await expect(page.locator('.field-diagnostics')).toContainText('热流守恒差');
 await expect(page.locator('.field-diagnostics')).toContainText('细网格');
 await page.getByRole('button',{name:'专注工作区',exact:true}).click();
 await expect(page.locator('.field-panel')).toBeVisible();
 await page.locator('.field-map').screenshot({path:info.outputPath('v04-thermal.png')});
 await page.getByRole('button',{name:'绝缘电场',exact:false}).click();await page.getByRole('button',{name:'运行场分析',exact:false}).click();
 await expect(page.getByTestId('field-title')).toContainText('绝缘电场');await expect(page.locator('.field-diagnostics')).toContainText('电场积分');
 await page.locator('.field-map').screenshot({path:info.outputPath('v04-electric.png')});
 await page.getByRole('button',{name:'三相外部磁场',exact:false}).click();await page.getByRole('button',{name:'运行场分析',exact:false}).click();
 await expect(page.getByTestId('field-title')).toContainText('磁感应强度');
 await page.locator('.field-map').screenshot({path:info.outputPath('v04-magnetic.png')});
 await page.getByRole('button',{name:'专注工作区',exact:true}).click();
 await expect(page.getByLabel('工程任务')).toBeVisible();
 expect(errors).toEqual([]);
});

test('document upload review proposal and durable searchable citations',async({page},info)=>{
 const name=`enterprise-${Date.now()}.txt`;
 await page.getByRole('button',{name:'企业资料库',exact:true}).click();
 await page.locator('.library-toolbar input[type=file]').setInputFiles({name,mimeType:'text/plain',buffer:Buffer.from('示例企业\n截面积: 300 mm²\nR20: 0.0601 Ω/km\n绝缘厚度: 5.5 mm')});
 await expect(page.getByLabel('识别文字校对')).toHaveValue(/300 mm²/);
 await expect(page.getByRole('button',{name:'从资料生成工程变更提案',exact:false})).toBeDisabled();
 await page.getByRole('checkbox',{name:'我已对照原件检查文字和单位',exact:true}).check();
 await page.getByRole('button',{name:'确认页文字',exact:true}).click();
 await expect(page.getByRole('button',{name:'从资料生成工程变更提案',exact:false})).toBeEnabled();
 await page.getByRole('button',{name:'从资料生成工程变更提案',exact:false}).click();
 await expect(page.locator('.proposal-card')).toContainText('0.0601');await expect(page.getByTestId('revision')).toHaveText('rev.1');
 await page.screenshot({path:info.outputPath('v04-library-review.png'),fullPage:true});
 await page.getByRole('button',{name:'批准并执行'}).click();await expect(page.getByTestId('revision')).toHaveText('rev.2');
 await page.getByRole('button',{name:'企业资料库',exact:true}).click();
 await page.getByLabel('资料检索词').fill(name);await page.getByRole('button',{name:'检索原文',exact:true}).click();
 await expect(page.locator('.hit-card').first()).toContainText('R20');
});

test('unconfigured scan upload never pretends to OCR',async({page})=>{
 await page.getByRole('button',{name:'企业资料库',exact:true}).click();
 const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAFUlEQVR4nGP8//8/A27AhEduBEsDAKXjAxF9kqZqAAAAAElFTkSuQmCC','base64');
 await page.locator('.library-toolbar input[type=file]').setInputFiles({name:'scan.png',mimeType:'image/png',buffer:image});
 await expect(page.locator('.document-editor')).toContainText('pending-ocr');
 await expect(page.getByLabel('识别文字校对')).toHaveValue('');
 await expect(page.getByRole('button',{name:'运行当前页 OCR',exact:true})).toBeDisabled();
 await expect(page.getByRole('button',{name:'先配置 OCR',exact:false})).toBeVisible();
});

test('inverse selection re-solves catalog and applies only by approval',async({page},info)=>{
 await page.getByRole('button',{name:'反向选型',exact:true}).click();
 await page.getByLabel('选型目标电流').fill('500');await page.getByLabel('包含演示型号').check();
 await page.getByRole('button',{name:'运行反向选型',exact:false}).click();
 await expect(page.getByTestId('selection-summary')).toContainText('满足当前筛选约束');
 await expect(page.locator('.design-table tr.feasible')).not.toHaveCount(0);
 await page.getByRole('button',{name:'专注工作区',exact:true}).click();
 await page.setViewportSize({width:1920,height:1400});
 await page.getByTestId('selection-summary').scrollIntoViewIfNeeded();
 await page.screenshot({path:info.outputPath('v04-selection.png'),fullPage:true});
 await page.getByRole('button',{name:'专注工作区',exact:true}).click();
 await page.getByRole('button',{name:'候选送审',exact:true}).first().click();
 await expect(page.locator('.proposal-card')).toBeVisible();await expect(page.getByTestId('revision')).toHaveText('rev.1');
 await page.getByRole('button',{name:'批准并执行'}).click();await expect(page.getByTestId('revision')).toHaveText('rev.2');
 await expect(page.locator('.results-toolbar')).toContainText('允许载流量');
});

test('catalog stores explicit full model review and does not forge price',async({page})=>{
 await page.getByRole('button',{name:'反向选型',exact:true}).click();await page.getByRole('button',{name:/^型号库/}).click();
 const name='企业内部核对 '+Date.now();await page.getByLabel('入库型号名称').fill(name);
 await expect(page.getByRole('button',{name:'保存型号快照'})).toBeDisabled();
 await page.getByLabel('确认型号参数').check();await page.getByRole('button',{name:'保存型号快照'}).click();
 await expect(page.locator('.design-table')).toContainText(name);
 await expect(page.locator('.design-table tr').filter({hasText:name})).toContainText('用户核对');
});

test('integration credentials are masked and not exported',async({page},info)=>{
 await page.getByRole('button',{name:'接入设置',exact:true}).click();
 await expect(page.getByLabel('ocr API Key')).toHaveAttribute('type','password');
 await page.getByLabel('ocr 模型').fill('test-only');await page.getByLabel('ocr API Key').fill('E2E-NON-LIVE-KEY');
 const response=page.waitForResponse(r=>r.url().endsWith('/api/integrations/ocr')&&r.request().method()==='PUT');
 await page.getByRole('button',{name:'保存 OCR配置',exact:true}).click();const r=await response;expect((await r.text()).includes('E2E-NON-LIVE-KEY')).toBe(false);
 await expect(page.getByLabel('ocr API Key')).toHaveValue('');
 await page.getByRole('button',{name:'清除内存密钥',exact:true}).first().click();
 await page.screenshot({path:info.outputPath('v04-integrations.png'),fullPage:true});
});
