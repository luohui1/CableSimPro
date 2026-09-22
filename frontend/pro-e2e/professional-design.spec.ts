import {test,expect,type Page,type APIRequestContext} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
async function project(request:APIRequestContext){
 const r=await request.post('/api/workspaces',{data:{}});expect(r.status()).toBe(201);return r.json();
}
async function enter(page:Page,w:any){await page.goto(`/?workflow=1&project=${w.id}`);await expect(page.getByRole('img',{name:'已保存工程的等比例电缆截面'})).toBeVisible()}
const layer=(page:Page,name:string)=>page.getByRole('navigation',{name:'工程对象'}).getByRole('button',{name,exact:true});

test('professional layout has real geometry, restrained chrome and read-only view controls',async({page,request},info)=>{
 const w=await project(request);await page.setViewportSize({width:1440,height:900});await enter(page,w);
 const writes:string[]=[];page.on('request',r=>{if(r.method()==='POST')writes.push(r.url())});
 await layer(page,'XLPE 绝缘').click();
 const section=page.getByRole('img',{name:'已保存工程的等比例电缆截面'});
 const diameter=await section.getAttribute('data-diameter-mm');
 const editor=await page.locator('.wf-editor').boundingBox(),canvas=await page.getByTestId('workflow-canvas').boundingBox();
 expect(canvas!.height/editor!.height).toBeGreaterThan(.8);
 expect(await page.locator('.wf-top').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(39, 46, 55)');
 await page.screenshot({path:info.outputPath('professional-structure.png')});
 await page.getByRole('button',{name:'放大截面',exact:true}).click();await expect(page.getByLabel('显示缩放',{exact:true})).toHaveText('110%');
 await expect(section).toHaveAttribute('data-diameter-mm',diameter!);
 await page.getByRole('button',{name:'显示截面尺寸',exact:true}).click();await expect(section.locator('.wf-dimension')).toHaveCount(0);
 await page.getByRole('button',{name:'截面适合画布',exact:true}).click();await expect(page.getByLabel('显示缩放',{exact:true})).toHaveText('100%');
 expect(writes).toEqual([]);
 const axe=await new AxeBuilder({page}).include('.wf-root').withTags(['wcag2a','wcag2aa']).analyze();expect(axe.violations).toEqual([]);
});

test('focus mode retains inputs and command search cannot silently execute a solve',async({page,request},info)=>{
 const w=await project(request);await enter(page,w);await layer(page,'XLPE 绝缘').click();
 const input=page.getByLabel('绝缘厚度',{exact:true});await input.fill('6.2');
 const writes:string[]=[];page.on('request',r=>{if(r.method()==='POST')writes.push(r.url())});
 await page.getByRole('button',{name:'专注画布',exact:true}).click();await expect(page.getByRole('complementary',{name:'上下文属性检查器'})).toBeHidden();
 await page.keyboard.press('Escape');await expect(input).toHaveValue('6.2');
 await page.keyboard.press('Control+k');const dialog=page.getByRole('dialog',{name:'工程命令',exact:true});await expect(dialog).toBeVisible();
 await dialog.getByLabel('搜索工程命令').fill('study');await expect(dialog.getByRole('button',{name:'打开稳态研究'})).toBeVisible();
 await page.screenshot({path:info.outputPath('professional-command-search.png')});
 await dialog.getByRole('button',{name:'打开稳态研究'}).click();await expect(dialog).toBeHidden();await expect(page.getByRole('button',{name:'运行当前版本',exact:true})).toBeDisabled();
 await layer(page,'XLPE 绝缘').click();await expect(input).toHaveValue('6.2');expect(writes).toEqual([]);
 await input.focus();await page.keyboard.press('Control+s');await expect(page.getByTestId('workflow-revision')).toHaveText('rev.2');
 expect(writes.filter(x=>x.endsWith('/edit'))).toHaveLength(1);
});

test('object filtering and accessible document tabs preserve committed geometry and drafts',async({page,request})=>{
 const w=await project(request);await enter(page,w);await layer(page,'XLPE 绝缘').click();await page.getByLabel('绝缘厚度',{exact:true}).fill('6.8');
 await page.getByLabel('筛选工程对象').fill('不存在');await expect(page.locator('.wf-layer-list')).toContainText('没有匹配的结构层');
 await expect(page.getByLabel('绝缘厚度',{exact:true})).toHaveValue('6.8');
 await page.getByRole('button',{name:'清除对象筛选'}).click();await layer(page,'R-001 · 稳态研究').click();
 const tabs=page.getByRole('tablist',{name:'已打开的工程文档'});await expect(tabs.getByRole('tab')).toHaveCount(2);
 await tabs.getByRole('tab',{name:'R-001 · 稳态研究'}).focus();await page.keyboard.press('ArrowLeft');await expect(tabs.getByRole('tab',{name:'C-001 · 电缆'})).toBeFocused();
 await layer(page,'XLPE 绝缘').click();await expect(page.getByLabel('绝缘厚度',{exact:true})).toHaveValue('6.8');
 await page.getByRole('button',{name:'关闭C-001 · 电缆',exact:true}).click();await expect(tabs.getByRole('tab')).toHaveCount(1);
 await layer(page,'XLPE 绝缘').click();await expect(page.getByLabel('绝缘厚度',{exact:true})).toHaveValue('6.8');
 const axe=await new AxeBuilder({page}).include('.wf-root').withTags(['wcag2a','wcag2aa']).analyze();expect(axe.violations).toEqual([]);
});

test('research diagram and result curve show the real saved snapshot',async({page,request},info)=>{
 const initial=await project(request);
 const edit=await request.post(`/api/workspaces/${initial.id}/edit`,{data:{expected_revision:1,changes:[{path:'cable.r20_ohm_km',value:.0754}]}});expect(edit.ok()).toBe(true);const w=await edit.json();
 await page.setViewportSize({width:1600,height:1000});await enter(page,w);await layer(page,'敷设方案 A').click();
 await expect(page.getByRole('img',{name:'当前已保存敷设方案示意'})).toContainText(`${w.scenario.installation.spacing_m} m`);
 await page.screenshot({path:info.outputPath('professional-study.png')});
 await page.getByRole('checkbox',{name:'已核对本版本参数来源、损耗系数与方法范围'}).check();
 const response=page.waitForResponse(r=>r.url().endsWith('/invoke')&&r.request().postDataJSON()?.capability==='analysis.buried');
 await page.getByRole('button',{name:'运行当前版本',exact:true}).click();const run=await (await response).json();
 const plot=page.getByRole('img',{name:'保存运行的电流与导体温度曲线'});await expect(plot).toBeVisible();
 expect(run.result.output.result.curve.length).toBeGreaterThan(1);
 await expect(page.getByRole('region',{name:'所选运行结果'})).toContainText(run.result.output.result.summary.ampacity_a.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}));
 await page.screenshot({path:info.outputPath('professional-results.png')});
 const after=await (await request.get(`/api/workspaces/${w.id}`)).json();expect(after.revision).toBe(w.revision);expect(after.runs.length).toBe(1);
 const axe=await new AxeBuilder({page}).include('.wf-root').withTags(['wcag2a','wcag2aa']).analyze();expect(axe.violations).toEqual([]);
});

test('reduced motion and desktop scaling retain access to save controls',async({page,request},info)=>{
 const w=await project(request);await page.emulateMedia({reducedMotion:'reduce'});
 for(const size of [[1920,1080],[1366,768],[1093,615],[911,512]]){
  const [width,height]=size;await page.setViewportSize({width,height});await enter(page,w);await layer(page,'XLPE 绝缘').click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  const save=await page.getByRole('button',{name:'保存全部修改',exact:true}).boundingBox();expect(save!.y+save!.height).toBeLessThanOrEqual(height);expect(save!.x+save!.width).toBeLessThanOrEqual(width);
  await page.screenshot({path:info.outputPath(`professional-${width}x${height}.png`)});
 }
});
