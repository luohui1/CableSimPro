import {test,expect,type APIRequestContext} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs/promises';

async function seed(request:APIRequestContext,area:number,suffix:string,price:number|null=100){
 const w=await (await request.post('/api/workspaces',{data:{}})).json();
 const code=`TEST-${suffix}-${area}-${Date.now()}`;
 const response=await request.post('/api/enterprise/products',{data:{code,name:`测试型号 ${suffix} ${area}`,manufacturer:'自动测试企业 / 非真实厂家',cable:{...w.scenario.cable,area_mm2:area,r20_ohm_km:17.241/area},rated_u0_kv:12,r20_basis:'manufacturer_maximum',evidence_note:'测试夹具中的假设保证值，不是真实供货产品',price_per_m:price}});
 expect(response.status()).toBe(201);const product=await response.json();
 const approved=await request.post(`/api/enterprise/versions/${product.id}/review`,{data:{content_sha256:product.content_sha256,reviewer:'测试程序',note:'仅用于验证产品生命周期与真实计算流程',confirmed:true}});
 expect(approved.status()).toBe(200);return await approved.json();
}
test.beforeEach(async({page})=>{await page.goto('/?enterprise=1');await expect(page.getByTestId('revision')).toHaveText('rev.1')});

test('enterprise default hierarchy has no persistent chat and computes without replacing model',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await expect(page.getByRole('navigation',{name:'应用导航'}).getByRole('button')).toHaveCount(4);
 await expect(page.locator('.task-dock,.eng-assistant')).toHaveCount(0);
 await expect(page.getByRole('region',{name:'设计任务'})).toBeHidden();
 const canvas=page.getByTestId('cable-model-view').locator('canvas');await expect(canvas).toBeVisible();
 await canvas.evaluate(el=>(el as HTMLCanvasElement&{same?:string}).same='persistent');
 const response=page.waitForResponse(r=>r.url().includes('/api/runtime/')&&r.url().endsWith('/invoke')&&r.request().postDataJSON().capability==='analysis.buried');
 await page.getByRole('button',{name:'计算载流量',exact:false}).click();const result=await (await response).json();
 await expect(page.locator('.enterprise-result-summary')).toContainText(result.result.output.result.summary.ampacity_a.toFixed(1));
 await expect(page.getByRole('heading',{name:'电缆结构',exact:true})).toBeVisible();
 expect(await canvas.evaluate(el=>(el as HTMLCanvasElement&{same?:string}).same)).toBe('persistent');
 await page.locator('.inline-results').getByRole('button',{name:'特性曲线',exact:true}).click();
 await expect(page.getByRole('img',{name:'电流温度曲线'})).toBeVisible();
 await page.screenshot({path:info.outputPath('enterprise-calculated.png'),fullPage:true});expect(errors).toEqual([]);
});

test('task is on demand, IME does not send, proposal reviewed in the same project',async({page},info)=>{
 await page.getByRole('button',{name:'设计任务',exact:true}).click();
 const task=page.getByRole('region',{name:'设计任务'});await expect(task).toBeVisible();
 const input=page.getByLabel('企业工程任务');await input.fill('截面积改为 400 mm²，重新计算');
 let count=0;page.on('request',r=>{if(r.url().endsWith('/invoke')&&r.postDataJSON()?.capability==='task.plan')count++});
 await input.dispatchEvent('compositionstart');await input.dispatchEvent('keydown',{key:'Enter',keyCode:229,isComposing:true});expect(count).toBe(0);await input.dispatchEvent('compositionend');
 await task.getByRole('button',{name:'规划任务',exact:false}).click();await expect(page.locator('.enterprise-proposal')).toContainText('400');
 await expect(page.getByTestId('revision')).toHaveText('rev.1');
 await page.screenshot({path:info.outputPath('enterprise-task-review.png'),fullPage:true});
 await task.getByRole('button',{name:'批准并执行',exact:true}).click();await expect(page.getByTestId('revision')).toHaveText('rev.2');
 await expect(page.locator('.enterprise-inspector').getByLabel('导体截面积',{exact:true})).toHaveValue('400');
 await page.getByRole('button',{name:'收起设计任务'}).click();await expect(task).toBeHidden();
});

test('product draft review project binding and independent revisions work through UI',async({page},info)=>{
 await page.getByRole('button',{name:'产品型号',exact:true}).click();
 await page.getByRole('button',{name:'从当前电缆建草稿'}).click();
 const code='UI-'+Date.now();await page.getByLabel('企业型号编码').fill(code);await page.getByLabel('企业产品名称').fill('UI 核对样例 240');await page.getByLabel('生产企业').fill('自动化测试 / 非真实企业');
 await page.getByLabel('产品 R20',{exact:true}).fill('0.08');await page.getByLabel('电阻数据性质').selectOption('manufacturer_maximum');await page.getByLabel('型号核对依据').fill('测试数据声明，不是实际厂家保证文件。');
 await page.getByRole('button',{name:'保存为待核对版本'}).click();await expect(page.getByRole('button',{name:'引用到当前方案'})).toBeDisabled();
 await page.getByRole('button',{name:'核对本版本'}).click();await page.getByLabel('型号核对人').fill('测试核对人');await page.getByLabel('型号核对说明').fill('逐项核对测试样例的完整结构和电阻');await page.getByLabel('确认型号核对').check();await page.getByRole('button',{name:'确认核对版本'}).click();
 await expect(page.getByRole('button',{name:'引用到当前方案'})).toBeEnabled();
 await page.screenshot({path:info.outputPath('enterprise-product.png'),fullPage:true});
 await page.getByRole('button',{name:'引用到当前方案'}).click();await expect(page.locator('.enterprise-proposal')).toContainText(code);
 await page.locator('.enterprise-proposal').getByRole('button',{name:'批准并执行'}).click();await expect(page.getByTestId('revision')).toHaveText('rev.2');await expect(page.locator('.outline-product')).toContainText(code);
 await page.locator('.enterprise-inspector').getByLabel('导体截面积',{exact:true}).fill('300');await page.locator('.enterprise-inspector').getByLabel('导体截面积',{exact:true}).press('Tab');await expect(page.getByTestId('revision')).toHaveText('rev.3');await expect(page.locator('.outline-product')).toContainText('项目修改副本');
 await page.getByRole('button',{name:'产品型号',exact:true}).click();await expect(page.locator('.product-facts')).toContainText('240');
 await page.getByRole('button',{name:'修订为新版本'}).click();await page.getByLabel('产品 R20',{exact:true}).fill('0.081');await page.getByRole('button',{name:'保存为待核对版本'}).click();await expect(page.locator('.product-detail-heading')).toContainText('版本 2');
 await page.getByLabel('型号历史版本').selectOption({label:'v1 · 已核对'});await expect(page.locator('.product-facts')).toContainText('0.08000');
});

test('reviewed catalog selection calls real engine, explains failures, compares and exports original report',async({page,request},info)=>{
 const suffix='S'+Date.now();await seed(request,95,suffix);await seed(request,240,suffix);const selected=await seed(request,400,suffix);
 // Reload refreshes catalog availability; current project is retained.
 await page.reload();await expect(page.getByTestId('revision')).toHaveText('rev.1');await page.getByRole('button',{name:'按目标电流选型',exact:true}).click();
 await page.getByLabel('企业选型目标电流').fill('400');await expect(page.getByRole('button',{name:'计算企业候选'})).toBeEnabled();await page.getByRole('button',{name:'计算企业候选'}).click();
 await expect(page.locator('.candidate-table tbody tr')).not.toHaveCount(0);
 await page.getByRole('button',{name:`测试型号 ${suffix} 95`,exact:true}).click();await expect(page.locator('.candidate-explanation')).toContainText('载流量不满足');await expect(page.getByRole('button',{name:'形成方案变更'})).toBeDisabled();
 await page.getByRole('button',{name:`测试型号 ${suffix} 400`,exact:true}).click();await expect(page.getByRole('button',{name:'形成方案变更'})).toBeEnabled();
 await expect(page.locator('.candidate-comparison')).toBeVisible();
 await page.screenshot({path:info.outputPath('enterprise-selection.png'),fullPage:true});
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'导出研究记录'}).click();const file=await pending;const html=await fs.readFile((await file.path())!,'utf8');expect(html).toMatch(/目标 400(?:\.0+)? A/);expect(html).toContain(selected.content_sha256);
 await page.getByLabel('企业选型目标电流').fill('350');await expect(page.getByRole('button',{name:'形成方案变更'})).toBeDisabled();await expect(page.locator('.selection-results')).toContainText('输入或版本已变化');
});

test('stale product lifecycle cannot be applied after a study',async({page,request})=>{
 const suffix='WITHDRAW-'+Date.now();const v=await seed(request,400,suffix);
 await page.reload();await page.getByRole('button',{name:'按目标电流选型',exact:true}).click();await page.getByLabel('企业选型目标电流').fill('200');await page.getByRole('button',{name:'计算企业候选'}).click();
 await page.getByRole('button',{name:`测试型号 ${suffix} 400`,exact:true}).click();await expect(page.getByRole('button',{name:'形成方案变更'})).toBeEnabled();
 await request.post(`/api/enterprise/versions/${v.id}/withdraw`,{data:{content_sha256:v.content_sha256,reviewer:'撤销测试',note:'测试计算之后产品停用的保护',confirmed:true}});
 await page.getByRole('button',{name:'形成方案变更'}).click();await expect(page.locator('.selection-results [role="alert"]')).toContainText('更新或停用');await expect(page.getByTestId('revision')).toHaveText('rev.1');
});

test('uncommitted input blocks calculation and task submission across navigation',async({page})=>{
 const field=page.locator('.enterprise-inspector').getByLabel('导体截面积',{exact:true});await field.fill('');await field.press('Tab');
 await expect(page.getByRole('button',{name:'计算载流量',exact:false})).toBeDisabled();await page.getByRole('button',{name:'设计任务',exact:true}).click();await page.getByLabel('企业工程任务').fill('计算载流量');await expect(page.locator('.enterprise-task').getByRole('button',{name:'规划任务',exact:false})).toBeDisabled();
 await page.getByRole('button',{name:'产品型号',exact:true}).click();await expect(page.getByRole('button',{name:'从当前电缆建草稿'})).toBeDisabled();await page.getByRole('button',{name:'工程设计',exact:true}).click();await expect(field).toHaveValue('');
 await page.getByRole('button',{name:'撤销未提交输入'}).click();await expect(field).toHaveValue('240');await expect(page.getByRole('button',{name:'计算载流量',exact:false})).toBeEnabled();
});

test('fork creates independent project and keeps original unchanged',async({page,request})=>{
 const original=await page.evaluate(()=>localStorage.getItem('cablesim-studio-id'));
 await page.getByRole('button',{name:'另存方案',exact:true}).click();await page.getByLabel('另存方案名称').fill('客户方案 B');await page.getByRole('button',{name:'建立独立方案'}).click();await expect(page.locator('.enterprise-project-name')).toContainText('客户方案 B');await expect(page.getByTestId('revision')).toHaveText('rev.1');
 const current=await page.evaluate(()=>localStorage.getItem('cablesim-studio-id'));expect(current).not.toBe(original);
 const field=page.locator('.enterprise-inspector').getByLabel('导体截面积',{exact:true});await field.fill('300');await field.press('Tab');await expect(page.getByTestId('revision')).toHaveText('rev.2');
 expect((await (await request.get(`/api/workspaces/${original}`)).json()).scenario.cable.area_mm2).toBe(240);
});

test('3D installation exports exact transverse coordinates, not arbitrary scene geometry',async({page},info)=>{
 await page.getByRole('button',{name:'敷设与负荷',exact:true}).click();
 const depth=page.locator('.enterprise-inspector').getByLabel('平均中心埋深',{exact:true});await depth.fill('1.1');await depth.press('Tab');await expect(page.getByTestId('revision')).toHaveText('rev.2');
 await page.getByRole('button',{name:'三维空间检查'}).click();await expect(page.getByTestId('installation-3d')).toHaveAttribute('data-ready','true');await expect(page.getByTestId('installation-3d').locator('canvas')).toBeVisible();
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'导出敷设 GLB'}).click();const d=await pending;const bytes=await fs.readFile((await d.path())!);expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
 const gltf=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString('utf8').trim());const root=gltf.nodes.find((n:any)=>n.extras?.kind==='installation-preview');expect(root.extras.units).toBe('metres');expect(root.extras.display_length_m).toBe(1.2);expect(root.extras.not_route_length).toBe(true);
 expect(root.extras.positions_x_depth_m).toEqual([[-.12,1.1],[0,1.1],[.12,1.1]]);expect(root.children).toHaveLength(3);
 await page.screenshot({path:info.outputPath('enterprise-installation.png'),fullPage:true});
});

test('default page has readable hierarchy and automated accessibility checks',async({page},info)=>{
 const sizes=await page.evaluate(()=>({title:parseFloat(getComputedStyle(document.querySelector('.enterprise-section-heading h1')!).fontSize),label:parseFloat(getComputedStyle(document.querySelector('.property-title label')!).fontSize),value:parseFloat(getComputedStyle(document.querySelector('.property-value input')!).fontSize),overflow:document.documentElement.scrollWidth-innerWidth}));
 expect(sizes.title).toBeGreaterThan(sizes.value);expect(sizes.label).toBeGreaterThanOrEqual(13);expect(sizes.value).toBeGreaterThanOrEqual(15);expect(sizes.overflow).toBeLessThanOrEqual(1);
 const report=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();await info.attach('enterprise-axe.json',{body:JSON.stringify(report,null,2),contentType:'application/json'});expect(report.violations).toEqual([]);
});
