import {test,expect,type Page,type APIRequestContext} from '@playwright/test';
import {createHash} from 'node:crypto';
import type {Result} from '../src/types';
import {buildAmpacityDiagnostics} from '../src/dual-mode/ampacity-diagnostics';

async function enter(page:Page) {
 await page.goto('/');
 await page.getByRole('button',{name:'进入专业工作台',exact:true}).click();
 await expect(page.getByTestId('session-revision')).toHaveText('rev.1');
}
async function calculate(page:Page):Promise<Result> {
 const response=page.waitForResponse(r=>r.url().includes('/api/runtime/')&&r.url().endsWith('/invoke')&&r.request().postDataJSON().capability==='analysis.buried');
 await page.getByRole('button',{name:'计算载流量',exact:false}).click();
 const payload=await (await response).json();
 await expect(page.locator('.enterprise-result-summary')).toBeVisible();
 return payload.result.output.result as Result;
}
async function fixture(request:APIRequestContext):Promise<Result> {
 const presets=await (await request.get('/api/presets')).json();
 const response=await request.post('/api/calculate',{data:presets[0].scenario});
 expect(response.ok()).toBe(true);
 return response.json();
}

test('supplemental crops retain the approved original hash and independently load',async({request})=>{
 const first=await (await request.get('/engineering-kit/manifest.json')).json();
 const next=await (await request.get('/engineering-kit/controls-manifest.json')).json();
 expect(next.sheets.data.sha256).toBe(first.sheets.data.sha256);
 expect(Object.keys(next.assets)).toEqual(['locked','edit','database','resistance','error','lab']);
 for(const entry of Object.values(next.assets) as {file:string;sha256:string;decorative_only:boolean}[]) {
  expect(entry.decorative_only).toBe(true);
  const response=await request.get(`/engineering-kit/${entry.file}`);
  expect(response.ok()).toBe(true);
  expect(createHash('sha256').update(await response.body()).digest('hex')).toBe(entry.sha256);
 }
});

test('unit controls and native diagnostic instruments stay connected to the solved snapshot',async({page},info)=>{
 await enter(page);
 const canvas=page.getByTestId('cable-model-view').locator('canvas');
 await expect(canvas).toBeVisible();await canvas.evaluate(el=>el.setAttribute('data-preserved-kit','true'));
 const field=page.locator('.enterprise-inspector').getByLabel('导体截面积',{exact:true});
 await field.fill('300');await field.press('Tab');
 await expect(page.getByTestId('session-revision')).toHaveText('rev.2');
 await expect(page.getByTestId('pulse-cable')).toContainText('300 mm²');
 const result=await calculate(page);
 await page.screenshot({path:info.outputPath('native-workbench.png'),fullPage:true});
 const writes:string[]=[];page.on('request',r=>{if(r.method()==='POST')writes.push(r.url())});
 const opener=page.getByTestId('pulse-loss');await opener.click();
 const dialog=page.getByRole('dialog',{name:'载流量工况诊断'});
 await expect(dialog).toHaveJSProperty('open',true);
 await page.keyboard.press('F9');await page.keyboard.press('Control+k');
 await expect(dialog).toHaveJSProperty('open',true);
 const projected=buildAmpacityDiagnostics(result);
 for(const loss of projected.losses) {
  const arc=dialog.locator(`[data-loss-key=${loss.key}]`);
  expect(Number(await arc.getAttribute('data-share'))).toBeCloseTo(loss.sharePercent,9);
  expect(Number(await dialog.locator(`[data-loss-row=${loss.key}]`).getAttribute('data-w-m'))).toBeCloseTo(loss.wPerM,9);
 }
 await expect(dialog.getByTestId('kit-operating-temperature')).toContainText(projected.operatingMaxTemperatureC!.toFixed(1));
 await expect(dialog.getByTestId('kit-temperature-path')).toHaveAttribute('data-state','operating');
 await page.screenshot({path:info.outputPath('native-diagnosis.png'),fullPage:true});
 await dialog.locator('.kit-evidence>summary').click();
 await expect(dialog.getByTestId('kit-input-sha')).toHaveText(result.input_sha256);
 await expect(dialog.locator('[data-kit-icon=locked] img')).toHaveJSProperty('naturalWidth',64);
 await expect(dialog.locator('[data-kit-icon=database] img')).toHaveJSProperty('naturalWidth',64);
 await page.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(opener).toBeFocused();
 await expect(canvas).toHaveAttribute('data-preserved-kit','true');
 expect(writes).toEqual([]);
});

test('native modal holds keyboard focus and remains within 390 px',async({page},info)=>{
 await page.setViewportSize({width:390,height:844});await enter(page);await calculate(page);
 await page.getByTestId('pulse-loss').click();
 const dialog=page.getByRole('dialog',{name:'载流量工况诊断'});
 await expect(dialog).toHaveJSProperty('open',true);
 for(let i=0;i<16;i++) {
  await page.keyboard.press(i<8?'Tab':'Shift+Tab');
  expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true);
 }
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 expect(await dialog.locator('.kit-diagnosis').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 await dialog.locator('.kit-diagnosis').evaluate(el=>el.scrollTop=0);
 await page.screenshot({path:info.outputPath('native-diagnosis-mobile.png'),fullPage:true});
 await page.keyboard.press('Escape');await expect(dialog).toBeHidden();
});

test('a failed copper subject does not poison the aluminium subject after editing',async({page})=>{
 await page.route('**/engineering-kit/copper.webp',route=>route.abort());await enter(page);
 await expect(page.locator('.kit-material [data-kit-icon=copper]')).toHaveAttribute('data-asset-state','fallback');
 await page.locator('.enterprise-inspector').getByLabel('导体材料',{exact:true}).selectOption('aluminium');
 await expect(page.getByTestId('session-revision')).toHaveText('rev.2');
 await expect(page.locator('.kit-material [data-kit-icon=aluminium] img')).toHaveJSProperty('naturalWidth',64);
});

test('projection preserves missing operating values and handles zero-loss and phase edge cases',async({request})=>{
 const result=await fixture(request);
 // Deliberately synthetic projection fixtures, never substituted into the UI or solver.
 const missing=structuredClone(result);missing.operating=null;missing.operating_error='fixture: no operating steady state';
 const fallback=buildAmpacityDiagnostics(missing);
 expect(fallback.operatingAvailable).toBe(false);expect(fallback.stateMode).toBe('rating');
 expect(fallback.operatingMaxTemperatureC).toBeNull();expect(fallback.temperatureMarginC).toBeNull();
 const zero=structuredClone(result);zero.operating=structuredClone(result.rating);
 zero.operating.conductor_losses_w_m=[0,0,0];zero.operating.screen_losses_w_m=[0,0,0];
 zero.operating.dielectric_loss_w_m=0;zero.operating.total_losses_w_m=[0,0,0];
 zero.operating.temperatures_c=[25,25,25];zero.operating.surface_temperatures_c=[25,25,25];
 zero.input.installation.ambient_temperature_c=25;
 const empty=buildAmpacityDiagnostics(zero);
 expect(empty.losses.every(item=>item.sharePercent===0)).toBe(true);
 expect(empty.internalRiseShare).toBe(0);expect(empty.externalRiseShare).toBe(0);
 const phases=structuredClone(zero);phases.summary.limiting_phase='B';
 phases.operating!.temperatures_c=[80,70,60];phases.operating!.surface_temperatures_c=[50,45,40];
 const different=buildAmpacityDiagnostics(phases);
 expect(different.limitingPhase).toBe('B');expect(different.displayPhase).toBe('A');
 expect(different.operatingMaxTemperatureC).toBe(80);expect(different.internalRiseC).toBe(30);
});
