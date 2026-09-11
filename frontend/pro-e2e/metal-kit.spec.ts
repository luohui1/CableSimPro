import {test,expect,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function enter(page:Page,agent=false){
 await page.goto('/');
 await page.getByRole('button',{name:agent?'进入智能工程流':'进入专业工作台',exact:true}).click();
 await expect(page.getByTestId('session-revision')).toHaveText('rev.1');
}

test('approved source-sheet subjects load locally and startup remains read only',async({page,request},info)=>{
 const writes:string[]=[],external:string[]=[];
 page.on('request',r=>{if(r.method()==='POST')writes.push(r.url());if(r.url().startsWith('http')&&!r.url().startsWith('http://127.0.0.1:8000'))external.push(r.url())});
 await page.goto('/');
 await expect(page.locator('.metal-studio')).toBeVisible();
 await expect(page.locator('.dual-brand [data-kit-icon=brand] img')).toHaveJSProperty('complete',true);
 expect(await page.locator('.dual-brand [data-kit-icon=brand] img').evaluate((el:HTMLImageElement)=>el.naturalWidth)).toBeGreaterThan(0);
 const manifest=await (await request.get('/engineering-kit/manifest.json')).json();
 expect(Object.keys(manifest.assets)).toHaveLength(20);
 expect(Object.values(manifest.assets).every((v:any)=>v.decorative_only)).toBe(true);
 expect(writes).toEqual([]);expect(external).toEqual([]);
 const a11y=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze();
 await info.attach('kit-entry-accessibility.json',{body:JSON.stringify(a11y),contentType:'application/json'});
 expect(a11y.violations).toEqual([]);
 await page.screenshot({path:info.outputPath('entry-metal-kit.png'),fullPage:true});
});

test('native inputs update actual data and extracted material icons without replacing canvas',async({page},info)=>{
 await enter(page);
 const canvas=page.getByTestId('cable-model-view').locator('canvas');
 await expect(canvas).toBeVisible();await canvas.evaluate(el=>(el as HTMLElement).dataset.kitRetained='true');
 await expect(page.locator('.enterprise-outline [data-kit-icon=cable]')).toBeVisible();
 await expect(page.getByRole('region',{name:'当前电缆材料摘要'})).toContainText('铜 Copper');
 await expect(page.locator('.kit-material [data-kit-icon=copper] img')).toHaveJSProperty('naturalWidth',64);
 await page.screenshot({path:info.outputPath('workbench-metal-kit.png'),fullPage:true});
 const input=page.locator('.enterprise-inspector').getByLabel('导体截面积',{exact:true});
 await input.fill('300');await input.press('Tab');await expect(page.getByTestId('session-revision')).toHaveText('rev.2');
 await expect(page.getByTestId('pulse-cable')).toContainText('300 mm²');
 await expect(canvas).toHaveAttribute('data-kit-retained','true');
 await page.locator('.enterprise-inspector').getByLabel('导体材料',{exact:true}).selectOption('aluminium');
 await expect(page.getByTestId('session-revision')).toHaveText('rev.3');
 await expect(page.locator('.kit-material [data-kit-icon=aluminium]')).toBeVisible();
 await expect(page.getByRole('region',{name:'当前电缆材料摘要'})).toContainText('铝 Aluminium');
 await expect(page.getByTestId('pulse-cable')).toContainText('Al');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

test('metal workbench and diagnosis still display solver results, not values from art',async({page},info)=>{
 await enter(page);
 const response=page.waitForResponse(r=>r.url().includes('/api/runtime/')&&r.url().endsWith('/invoke')&&r.request().postDataJSON().capability==='analysis.buried');
 await page.getByRole('button',{name:'计算载流量',exact:false}).click();
 const payload=await (await response).json();const result=payload.result.output.result;
 await expect(page.locator('.enterprise-result-summary')).toContainText(result.summary.ampacity_a.toFixed(1));
 await expect(page.getByTestId('pulse-result')).toContainText(result.summary.ampacity_a.toFixed(1));
 await page.screenshot({path:info.outputPath('workbench-calculated-metal-kit.png'),fullPage:true});
 await page.getByTestId('pulse-loss').click();
 const dialog=page.getByRole('dialog',{name:'载流量工况诊断'});
 await expect(dialog).toContainText(result.input_sha256);
 await expect(dialog.locator('[data-kit-icon=temperature]')).toBeVisible();
 await page.screenshot({path:info.outputPath('diagnosis-metal-kit.png'),fullPage:true});
 await page.getByRole('button',{name:'关闭载流量诊断',exact:true}).click();
 const input=page.locator('.enterprise-inspector').getByLabel('导体截面积',{exact:true});
 await input.fill('99999');await input.press('Tab');
 await expect(input).toHaveAttribute('aria-invalid','true');
 await expect(page.getByRole('button',{name:'计算载流量',exact:false})).toBeDisabled();
 await expect(page.locator('.enterprise-result-summary')).toBeHidden();
});

test('missing kit raster subjects fall back without disabling calculation or controls',async({page})=>{
 await page.route('**/engineering-kit/*.webp',route=>route.abort());
 await enter(page);
 await expect(page.locator('.dual-brand [data-kit-icon=brand]')).toHaveAttribute('data-asset-state','fallback');
 await expect(page.locator('.enterprise-outline [data-kit-icon=cable]')).toHaveAttribute('data-asset-state','fallback');
 await page.getByRole('button',{name:'计算载流量',exact:false}).click();
 await expect(page.locator('.enterprise-result-summary')).toBeVisible();
});

test('agent uses the same kit and retains explicit approval on a narrow display',async({page},info)=>{
 await page.setViewportSize({width:390,height:844});await enter(page,true);
 await page.getByLabel('描述本次工程任务',{exact:true}).fill('截面积改为 400 mm²，重新计算');
 await page.getByRole('button',{name:'生成任务计划',exact:true}).click();
 await expect(page.getByTestId('session-revision')).toHaveText('rev.1');
 await expect(page.getByRole('button',{name:'批准并执行',exact:true})).toBeEnabled();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('mobile-review-metal-kit.png'),fullPage:true});
});
