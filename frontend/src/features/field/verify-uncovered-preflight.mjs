/** Replay an actual saved host preflight response in the production dialog.
 * This tests reading a real rejection, not a fabricated solver or SSH response.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {openHeadlessBrowser,settle,repositoryRoot} from '../../../scripts/browser.mjs';
const origin=process.env.FRONTEND_URL;
assert(origin && !['8100','8200'].includes(new URL(origin).port));
const source=process.env.PREFLIGHT_SAVED_RECEIPT;
assert(source,'Provide the saved real-use receipt containing fourPreflight');
const receipt=JSON.parse(await fs.readFile(source,'utf8')),data=receipt.fourPreflight;
assert(data && data.ready===false && data.cases.some(c=>c.status==='not_applicable' && c.error?.code==='DOMAIN_NOT_SUPPORTED' && c.error.message.includes('四芯')));
const out=path.join(repositoryRoot,'.data/fix-round/simulation-transient/method-validation');await fs.mkdir(out,{recursive:true});
const session=await openHeadlessBrowser(),{page}=session,errors=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));
const markup=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>已保存预检</title><script type="module">
import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
const {renderSavedPreflight}=await import('/src/features/field/layout-fixture.tsx');await import('/src/styles/theme.css');await import('/src/styles/research.css');await import('/src/styles/workbench.css');
const data=await (await fetch('/saved-preflight-response')).json();
renderSavedPreflight(data);window.ready=true;
</script></head><body><main id="root"></main></body></html>`;
try{
 await page.route('**/saved-preflight-response',route=>route.fulfill({json:data}));
 await page.route('**/saved-preflight-reading',route=>route.fulfill({contentType:'text/html',body:markup}));
 for(const width of [1366,1920])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:width===1366?768:1080});await page.goto(origin+'/saved-preflight-reading');await page.waitForFunction(()=>window.ready);await settle(page);
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  const dialog=page.getByRole('dialog',{name:'运行前预检'});await dialog.waitFor();
  assert((await dialog.innerText()).includes('当前不覆盖四芯'));assert.equal(await dialog.getByRole('button',{name:/修正.*分层/}).count(),0);
  assert(await dialog.getByRole('button',{name:'确认并运行'}).isDisabled());assert((await dialog.innerText()).includes('当前方法不覆盖此工况'));
  const layout=await dialog.evaluate(node=>{const r=node.getBoundingClientRect();return {width:r.width,left:r.left,right:r.right,top:r.top,bottom:r.bottom,viewportWidth:innerWidth,viewportHeight:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth};});
  assert(!layout.overflow && layout.left>=0 && layout.right<=width && layout.top>=0 && layout.bottom<=layout.viewportHeight,JSON.stringify(layout));
  if(width===1366 && theme==='light')await page.screenshot({path:path.join(out,'four-core-preflight.png')});
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});checks.push({width,theme,layout,uncovered:true,repairButton:false});
 }
 assert.deepEqual(errors,[]);await fs.writeFile(path.join(out,'four-core-browser.json'),JSON.stringify({source,sourceContext:data.cases[0].evidence?.research_context,checks,errors,kind:'saved_real_preflight_reading'},null,2));
 console.log(JSON.stringify({checks:checks.length,errors}));
}catch(error){console.error(errors);throw error;}finally{await session.close();}
