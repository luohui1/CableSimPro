/** Browser regression for a library imported by the release seed; no solver. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openHeadlessBrowser, settle, repositoryRoot } from '../../../scripts/browser.mjs';
import { assertLayout } from '../../../scripts/layout-assertions.mjs';

const base=process.env.FRONTEND_URL,api=process.env.REPRODUCTION_API_URL;
if(!base||!api)throw Error('Set FRONTEND_URL and REPRODUCTION_API_URL to task-owned services');
const out=path.join(repositoryRoot,'.data/reproduction-release-acceptance/browser');await fs.mkdir(out,{recursive:true});
const response=await fetch(api+'/api/foundation/reproductions/B02-2');assert(response.ok);const saved=await response.json();
const catalog=await (await fetch(api+'/api/foundation/reproductions')).json();assert.equal(catalog.items.length,63);
assert.equal(saved.sensitivity.rows.length,13);
const session=await openHeadlessBrowser(),{page}=session,checks=[],errors=[];
try{
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url());if(!url.pathname.startsWith('/api/'))return route.continue();
    assert.equal(route.request().method(),'GET','Browser acceptance never writes host data');
    const origin=url.pathname.startsWith('/api/foundation/reproductions')?api:(process.env.HOST_API_URL||'http://127.0.0.1:8100');
    const reply=await route.fetch({url:origin+url.pathname+url.search});return route.fulfill({response:reply});
  });
  await page.setViewportSize({width:1366,height:768});await page.goto(base+'/validation');
  const table=page.getByRole('table',{name:'复现目标',exact:true});await table.waitFor();
  assert.equal(await table.locator('tbody tr').count(),63);
  await page.getByPlaceholder('目标、来源或编号').fill('B02-2');await page.keyboard.press('Enter');
  await table.locator('tbody tr').first().focus();await page.keyboard.press('Enter');
  await page.getByRole('tab',{name:'覆盖与限制',exact:true}).click();
  const sensitivity=page.getByRole('table',{name:'排管敏感性影响'});await sensitivity.waitFor();
  assert.equal(await sensitivity.locator('tbody tr').count(),13);
  const notes=await page.locator('.input-section').filter({has:page.getByRole('heading',{name:'限制与假设',exact:true})}).innerText();
  assert(!/[+−-]\d+\.\d+\s*(A|%)/.test(notes));assert(!notes.includes('排管敏感性诊断：'));
  assert(notes.includes('停在预检'));assert(notes.includes('p.85'));assert(notes.includes('口径差异'));
  checks.push({case:'release-catalog-navigation',targets:63,diagnosticRows:13,notes});
  await page.screenshot({path:path.join(out,'coverage.png')});
  await page.getByRole('heading',{name:'排管敏感性诊断',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'sensitivity.png')});
  await page.getByRole('link',{name:'全部复现目标',exact:true}).focus();
  const downloadPromise=page.waitForEvent('download');await page.keyboard.press('Control+s');const download=await downloadPromise;
  const file=path.join(out,'reproduction.json');await download.saveAs(file);assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')),saved);
  await page.route('**/release-evidence-states',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>保存证据状态检查</title><script type="module">
import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
const {renderFixture}=await import('/src/features/field/browser-fixture.tsx');window.renderFixture=renderFixture;window.ready=true;
</script><style>body{margin:0}#test{height:100vh;overflow:auto;padding:var(--space-6);box-sizing:border-box;background:var(--panel);color:var(--text)}</style></head><body><main id="test"></main></body></html>`}));
  await page.goto(base+'/release-evidence-states');await page.waitForFunction(()=>window.ready);let key=0;
  for(const viewport of [{width:1366,height:768},{width:1920,height:1080}])for(const theme of ['light','dark'])for(const mode of ['empty','loading','error','success','history']){
    await page.setViewportSize(viewport);await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    await page.evaluate(({saved,mode,key})=>window.renderFixture('diagnostic',{sensitivity:saved,fixtureState:mode},key),{saved,mode,key:++key});await settle(page);
    if(mode==='loading')await page.getByText('读取排管诊断',{exact:true}).waitFor();
    if(mode==='error')await page.getByText('排管诊断不可用',{exact:true}).waitFor();
    if(mode==='empty')await page.getByText('尚无保存的排管敏感性诊断',{exact:true}).waitFor();
    if(['success','history'].includes(mode))assert.equal(await page.getByRole('table',{name:'排管敏感性影响'}).locator('tbody tr').count(),13);
    if(mode==='history')assert((await page.locator('body').innerText()).includes('历史'));
    const label=`coverage/${mode}/${theme}/${viewport.width}`;
    checks.push({case:label,...await assertLayout(page,label)});
  }
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(out,'checks.json'),JSON.stringify({snapshot:saved.snapshot_id,stateFixtures:true,checks,errors,downloadMatches:true},null,2));
  console.log(JSON.stringify({checks:checks.length,snapshot:saved.snapshot_id,out}));
}finally{await page.unrouteAll({behavior:'ignoreErrors'});await session.close();}
