import {test,expect,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {readFile} from 'node:fs/promises';
async function nav(p:Page,name:string){await p.locator('.eng-sidebar nav').getByRole('button',{name,exact:true}).click()}
test.beforeEach(async({page})=>{await page.goto('/');await expect(page.getByTestId('revision')).toHaveText('rev.1');await expect(page.locator('h1')).toHaveText('电缆结构')});

test('professional hierarchy typography and default local-only fonts',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await expect(page.locator('.eng-assistant')).toHaveCount(0);
 await expect(page.getByTestId('cable-model-view')).toHaveAttribute('data-renderer','webgl');
 const typography=await page.evaluate(()=>{const css=(s:string)=>getComputedStyle(document.querySelector(s)!);return {h:parseFloat(css('h1').fontSize),label:parseFloat(css('.property-title label').fontSize),input:parseFloat(css('input[type=number]').fontSize),family:css('input[type=number]').fontFamily}});
 expect(typography.h).toBeGreaterThanOrEqual(24);expect(typography.label).toBeGreaterThanOrEqual(13);expect(typography.h/typography.label).toBeGreaterThan(1.6);expect(typography.family).toContain('Mono');
 expect(await page.locator('#csp-optional-fonts').count()).toBe(0);
 await page.screenshot({path:info.outputPath('v05-model.png'),fullPage:true});
 expect(errors).toEqual([]);
});

test('three dimensional geometry export includes metric dimensions and input snapshot',async({page},info)=>{
 await expect(page.getByTestId('cable-model-view')).toHaveAttribute('data-renderer','webgl');
 await page.getByRole('button',{name:'端面',exact:true}).click();
 await page.getByRole('button',{name:'完整结构',exact:true}).click();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出 GLB',exact:true}).click();
 const file=await download;const data=await readFile((await file.path())!);
 expect(data.readUInt32LE(0)).toBe(0x46546c67);expect(data.readUInt32LE(4)).toBe(2);
 const size=data.readUInt32LE(12);const gltf=JSON.parse(data.subarray(20,20+size).toString());
 const root=gltf.nodes.find((n:{extras?:{units:string}})=>n.extras?.units==='metres');
 expect(root.extras.cable_input.area_mm2).toBe(240);expect(root.extras.not_route_length).toBe(true);
 const layers=gltf.nodes.filter((n:{extras?:{outer_radius_m:number}})=>n.extras?.outer_radius_m);
 expect(layers.length).toBe(6);expect(layers[0].extras.outer_radius_m).toBeCloseTo(Math.sqrt(240/(Math.PI*.92))/1000,8);
 await page.getByRole('button',{name:'分层展开',exact:true}).click();
 await page.screenshot({path:info.outputPath('v05-layers.png'),fullPage:true});
});

test('parametric generation previews before human approval and updates geometry',async({page},info)=>{
 await page.getByRole('button',{name:'生成电缆模型',exact:true}).click();
 const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
 await page.getByLabel('生成导体截面积',{exact:true}).fill('400');
 await page.getByLabel('生成绝缘标称厚度',{exact:true}).fill('6');
 await expect(page.getByTestId('revision')).toHaveText('rev.1');
 await page.screenshot({path:info.outputPath('v05-generator.png'),fullPage:true});
 await page.getByRole('button',{name:'生成变更并审查',exact:false}).click();
 await expect(dialog).toHaveCount(0);await expect(page.locator('.eng-assistant .diff-row').filter({hasText:'导体截面积'})).toContainText('400');
 await expect(page.getByTestId('revision')).toHaveText('rev.1');
 await page.getByRole('button',{name:'批准并执行',exact:true}).click();await expect(page.getByTestId('revision')).toHaveText('rev.2');
 await page.getByRole('button',{name:'关闭工程助手',exact:true}).click();await nav(page,'电缆结构');
 await expect(page.getByLabel('导体截面积',{exact:true})).toHaveValue('400');
});

test('uncommitted invalid input survives navigation and blocks stale calculations',async({page})=>{
 let calculations=0;page.on('request',r=>{if(r.url().includes('/invoke')&&r.postDataJSON()?.capability==='analysis.buried')calculations++});
 await page.getByLabel('导体截面积',{exact:true}).fill('');
 await nav(page,'敷设布置');await expect(page.locator('.draft-banner')).toBeVisible();
 await page.getByRole('button',{name:'计算载流量',exact:false}).click();
 await expect(page.locator('.eng-error-banner')).toContainText('未提交');expect(calculations).toBe(0);
 await nav(page,'电缆结构');await expect(page.getByLabel('导体截面积',{exact:true})).toHaveValue('');
 await page.getByRole('button',{name:'撤销未提交输入',exact:true}).click();
 await expect(page.getByLabel('导体截面积',{exact:true})).toHaveValue('240');await nav(page,'敷设布置');
 await page.getByRole('button',{name:'计算载流量',exact:false}).click();await expect(page.locator('.results-toolbar')).toContainText('允许载流量');expect(calculations).toBe(1);
});

test('direct calculation matches API snapshot and interactive chart exports actual samples',async({page},info)=>{
 await nav(page,'敷设布置');
 const response=page.waitForResponse(r=>r.url().includes('/invoke')&&r.request().postDataJSON()?.capability==='analysis.buried');
 await page.getByRole('button',{name:'计算载流量',exact:false}).click();const envelope=await (await response).json();
 await expect(page.locator('.results-toolbar')).toContainText(envelope.result.output.result.summary.ampacity_a.toFixed(1));
 await page.getByRole('button',{name:'特性曲线',exact:true}).click();
 await expect(page.getByRole('img',{name:'电流温度曲线',exact:true})).toBeVisible();
 await page.getByText('查看曲线数据表',{exact:true}).click();await expect(page.locator('.chart-data tbody tr')).toHaveCount(envelope.result.output.result.curve.length);
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出数据',exact:true}).click();const data=await readFile((await (await download).path())!,'utf8');expect(data).toContain('series,x,y');expect(data.split('\n').length).toBe(envelope.result.output.result.curve.length+1);
 await page.screenshot({path:info.outputPath('v05-results.png'),fullPage:true});
 await nav(page,'任务记录');await expect(page.locator('.journal')).toContainText('直埋载流量计算');
});

test('design basis checks unsupported domains and records reviewed references',async({page},info)=>{
 await nav(page,'设计依据');await expect(page.locator('.standard-entry')).toHaveCount(8);
 await page.locator('.standard-entry').filter({hasText:'IEC 60502-2:'}).getByRole('checkbox').check();
 await page.getByLabel('设计敷设环境').selectOption('duct');await page.getByRole('button',{name:'检查适用范围',exact:true}).click();
 await expect(page.locator('.basis-check')).toContainText('不适用');await expect(page.getByRole('button',{name:'提交依据变更审查'})).toBeDisabled();
 await page.getByLabel('设计敷设环境').selectOption('buried');await page.getByRole('button',{name:'检查适用范围',exact:true}).click();
 await expect(page.getByRole('button',{name:'提交依据变更审查'})).toBeEnabled();
 await page.screenshot({path:info.outputPath('v05-standards.png'),fullPage:true});
 await page.getByRole('button',{name:'提交依据变更审查'}).click();await expect(page.locator('.basis-proposal')).toBeVisible();await page.getByRole('button',{name:'批准并执行'}).click();
 await expect(page.getByTestId('revision')).toHaveText('rev.2');
 await page.reload();await expect(page.getByTestId('revision')).toHaveText('rev.2');await nav(page,'设计依据');await expect(page.locator('.standard-entry').filter({hasText:'IEC 60502-2:'}).getByRole('checkbox')).toBeChecked();
});

test('isolated vertical thermal study uses native execution and real engineering chart',async({page},info)=>{
 await nav(page,'计算分析');await page.getByRole('button',{name:'竖向电热',exact:true}).click();await page.getByLabel('竖向轴向网格').selectOption('20');
 const response=page.waitForResponse(r=>r.url().includes('/invoke')&&r.request().postDataJSON()?.capability==='analysis.vertical');
 await page.getByRole('button',{name:'运行竖向电热',exact:false}).click();const r=await (await response).json();
 await expect(page.getByTestId('vertical-summary')).toContainText(r.result.ampacity_a.toFixed(1));
 await expect(page.getByRole('img',{name:'竖向沿高温度曲线',exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath('v05-vertical.png'),fullPage:true});
 await page.getByLabel('顶部空气温度',{exact:true}).fill('55');await expect(page.getByRole('button',{name:'导出研究快照'})).toBeDisabled();
});

test('geometry overlap error retained instead of silently computing last valid input',async({page})=>{
 await nav(page,'敷设布置');await page.getByLabel('相邻中心间距',{exact:true}).fill('.02');await page.getByLabel('相邻中心间距',{exact:true}).press('Tab');
 await expect(page.locator('.eng-error-banner')).toContainText('重叠');await expect(page.locator('.draft-banner')).toBeVisible();await expect(page.getByTestId('revision')).toHaveText('rev.1');
 await page.getByRole('button',{name:'撤销未提交输入'}).click();await expect(page.getByLabel('相邻中心间距',{exact:true})).toHaveValue('0.12');
});

test('neutral application navigation and accessible dialog keyboard focus',async({page},info)=>{
 const before=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
 await test.info().attach('accessibility-model.json',{body:JSON.stringify(before,null,2),contentType:'application/json'});
 expect(before.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
 await page.getByRole('button',{name:'显示设置',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();
 const dialog=await new AxeBuilder({page}).include('[role="dialog"]').withTags(['wcag2a','wcag2aa']).analyze();
 await test.info().attach('accessibility-dialog.json',{body:JSON.stringify(dialog,null,2),contentType:'application/json'});expect(dialog.violations).toEqual([]);
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'显示设置',exact:true})).toBeFocused();
});

test('enterprise document review still feeds current engineering model',async({page},info)=>{
 await nav(page,'企业资料');
 await page.locator('.library-toolbar input[type=file]').setInputFiles({name:'v05-example.txt',mimeType:'text/plain',buffer:Buffer.from('截面积: 300 mm²\nR20: 0.0601 Ω/km\n绝缘厚度: 5.5 mm')});
 await page.getByRole('checkbox',{name:'我已对照原件检查文字和单位',exact:true}).check();await page.getByRole('button',{name:'确认页文字',exact:true}).click();
 await page.getByRole('button',{name:'从资料生成工程变更提案',exact:false}).click();await expect(page.locator('.eng-assistant .proposal-card')).toContainText('0.0601');
 await page.screenshot({path:info.outputPath('v05-documents.png'),fullPage:true});
 await page.getByRole('button',{name:'批准并执行'}).click();await expect(page.getByTestId('revision')).toHaveText('rev.2');
 await nav(page,'任务记录');await expect(page.locator('.journal')).toContainText('当前数值引用');
});
