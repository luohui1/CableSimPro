import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect as baseExpect } from '@playwright/test';
import { openHeadlessBrowser, settle, outputRoot } from './browser.mjs';
import { request } from './research-fixtures.mjs';
import { assertLayout } from './layout-assertions.mjs';
if (process.env.E2E_ISOLATED !== '1') throw Error('Requires isolated database');
const base = process.env.FRONTEND_URL, expect = baseExpect.configure({ timeout: 90000 });
const session = await openHeadlessBrowser(), { page, context } = session;
page.setDefaultTimeout(90000);
const out = path.join(outputRoot, 'version-status'), report = { checks: [], variants: [], errors: [], posts: [] };
const uiOnly = process.env.VERSION_UI_ONLY === '1'; report.uiOnly = uiOnly;
await fs.mkdir(out, { recursive: true }); page.on('pageerror', e => report.errors.push(e.message));
async function go(route) { await page.goto('about:blank'); await page.goto(base + route); await settle(page); }
async function variants(label) { for (const size of [{width:1366,height:768},{width:1920,height:1080}]) for (const theme of ['light','dark']) { await page.setViewportSize(size); await page.evaluate(t => document.documentElement.dataset.theme = t, theme); await assertLayout(page, label); report.variants.push({label,...size,theme}); } }
const stale = {status:'stale',display_name:'internal_unused',reasons:[{code:'METHOD_VERSION_CHANGED',kind:'method',id:'cablesim.iec60287',message:'cablesim.iec60287 fake_hash_not_for_UI'}]};
try {
  await page.setViewportSize({width:1366,height:768});
  let selected, thermal;
  for (const w of await request(base, '/api/workspaces')) for (const s of await request(base, `/api/workspaces/${w.id}/studies`)) {
    if (s.definition.title.includes('城北变电站') && s.definition.driver.kind === 'selection') selected = {w,s};
    if (s.definition.title === '城北变电站 · 排管段电热温度场') thermal = {w,s};
  }
  assert.ok(selected); assert.ok(thermal); const {w,s} = selected, prefix = `/api/workspaces/${w.id}/studies/${s.id}`;
  const savedRuns = (await request(base, prefix + '/runs')).items, saved = savedRuns.at(-1); assert.ok(saved);
  const installed=(await request(base,'/api/methods')).find(row=>row.method?.plugin_id===s.definition.method.plugin_id).method.version;
  Object.assign(stale.reasons[0],{from_version:saved.snapshot.definition.method.version,to_version:installed});
  const studyRoute=`/studies/${s.id}/selection/results?workspace=${w.id}`;
  // Only inject version metadata/faults. Numeric evidence remains the real saved output.
  await context.route('**/api/workspaces/*/studies', async route => { const response=await route.fetch({timeout:180000}), rows=await response.json(); await route.fulfill({response,json:rows.map(row=>row.id===s.id?{...row,version_status:stale}:row)}); });
  await context.route('**'+prefix+'/runs*', async route => { const response=await route.fetch({timeout:180000}), data=await response.json(); await route.fulfill({response,json:Array.isArray(data.items)?{...data,items:data.items.map(run=>({...run,version_status:stale}))}:{...data,version_status:stale}}); });
  await go(studyRoute); const row = page.locator('.topbar .status-wrap').first();
  await row.getByRole('button',{name:/已过期/}).click(); await expect(row).toContainText('方法');
  await expect(row.getByRole('button',{name:'重算',exact:true})).toBeVisible();
  assert.doesNotMatch(await row.innerText(),/cablesim\.|internal_unused|fake_hash/); await variants('研究列表过期');
  await page.setViewportSize({width:1366,height:768}); await page.screenshot({path:path.join(out,'studies.png')});
  await row.getByRole('button',{name:'重算',exact:true}).click(); const dialog=page.getByRole('dialog',{name:'按当前版本重算',exact:true}), confirm=dialog.getByRole('button',{name:'确认范围并重算',exact:true});
  await expect(confirm).toBeDisabled(); await expect(dialog.getByRole('checkbox')).toBeVisible(); await page.keyboard.press('Escape');
  assert.equal(report.posts.length,0);
  for (const [code,copy] of [['STUDY_REVISION_CONFLICT','数据已被修改，请刷新'],['MODEL_REBASE_REQUIRED','请先合并型号新版本']]) {
    await context.route('**'+prefix+'/recalculate', async route => {report.posts.push(route.request().postDataJSON());await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({detail:{code,message:'raw_internal_error'}})});});
    await row.getByRole('button',{name:'重算',exact:true}).click(); await dialog.getByRole('checkbox').check(); await confirm.click(); await expect(dialog.getByRole('alert')).toHaveText(copy); await variants('重算冲突 '+code); await page.keyboard.press('Escape'); await context.unroute('**'+prefix+'/recalculate');
  }
  const route=`/studies/${s.id}/selection/results?workspace=${w.id}&run=${saved.id}`;
  await go(route); await expect(page.locator('.topbar .status-mark')).toContainText('已过期');
  await page.getByRole('button',{name:'运行记录',exact:true}).click(); await expect(page.getByRole('dialog',{name:'运行记录',exact:true}).getByText('结果已过期',{exact:true}).first()).toBeVisible(); await page.keyboard.press('Escape');
  await go(`/studies/${s.id}/report/preview?workspace=${w.id}&run=${saved.id}`); await expect(page.getByRole('button',{name:'生成客户计算书',exact:true})).toHaveCount(0); await variants('过期计算书禁止生成');
  let books=await request(base,`/api/workspaces/${w.id}/deliveries`);
  if(!books.length){await request(base,`/api/workspaces/${w.id}/deliveries`,'POST',{run_ids:[saved.id]});books=await request(base,`/api/workspaces/${w.id}/deliveries`);}
  if (books.length) {
    await context.route(`**/api/workspaces/${w.id}/deliveries`,async route=>{const response=await route.fetch({timeout:180000});await route.fulfill({response,json:(await response.json()).map(book=>({...book,version_status:stale}))});});
    await go(`/deliveries?workspace=${w.id}`); await expect(page.getByRole('table',{name:'计算书与规格书历史',exact:true}).getByText('结果已过期',{exact:true}).first()).toBeVisible(); await variants('交付存档过期');
    await page.screenshot({path:path.join(out,'deliveries.png')});
  }
  await context.unrouteAll({behavior:'wait'});
  // A real recalculate POST adopts the current installed IEC; only its returned async transport is delayed for polling coverage.
  await go(studyRoute);
  const actual=await request(base,prefix), originalCount=(await request(base,prefix+'/runs')).items.length;
  if (actual.version_status.status!=='stale') await context.route('**/api/workspaces/*/studies',async route=>{const response=await route.fetch({timeout:180000});await route.fulfill({response,json:(await response.json()).map(row=>row.id===s.id?{...row,version_status:stale}:row)});});
  await go(studyRoute); let actualRun, polls=0;
  await context.route('**'+prefix+'/recalculate',async route=>{report.posts.push(route.request().postDataJSON());if(uiOnly){actualRun=saved;return route.fulfill({status:202,contentType:'application/json',body:JSON.stringify({...saved,status:'accepted'})});}const response=await route.fetch({timeout:180000});const data=await response.json();if(!response.ok()){report.hostFailure=data;return route.fulfill({response});}actualRun=data;await route.fulfill({status:202,contentType:'application/json',body:JSON.stringify({...data,status:'accepted'})});});
  await context.route('**'+prefix+'/runs/*',async route=>{polls++;return uiOnly?route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(saved)}):route.continue();});
  await row.getByRole('button',{name:/已过期/}).click(); await row.getByRole('button',{name:'重算',exact:true}).click(); await dialog.getByRole('checkbox').check();
  await confirm.evaluate(button=>{button.click();button.click();}); await expect(dialog.getByText('正在重算，旧结果保留',{exact:true})).toBeVisible();
  await expect(dialog).not.toBeVisible({timeout:180000}); assert.ok(polls>0); assert.ok(actualRun);
  const current=(await request(base,prefix+'/runs')).items; assert.equal(current.length,originalCount+(uiOnly?0:1)); if(!uiOnly){assert.equal(current.at(-1).version_status.status,'current'); assert.equal(current.at(-1).snapshot.definition.method.version,installed);}
  assert.ok(report.posts.every(body=>body.scope_acknowledged===true && body.request_id && Number.isInteger(body.expected_revision) && Number.isInteger(body.expected_study_revision)));
  await context.unrouteAll({behavior:'wait'}); await go(studyRoute); if(!uiOnly)await expect(page.locator('.topbar .status-mark')).not.toContainText('已过期');
  report.checks.push('显式勾选前无重算；409与型号合并错误；202轮询；旧结果不能生成当前计算书；'+(uiOnly?'轮询使用原有真实运行的响应注入，未执行求解':'真实IEC重算一条、当前版本及列表刷新'));
  await go(`/studies/${thermal.s.id}/thermal-field/field?workspace=${thermal.w.id}&run=${thermal.s.latest_run_id}`);
  await expect(page.locator('.conclusion').getByText('无法判断',{exact:true})).toBeVisible(); await expect(page.locator('.conclusion')).toContainText('108.3'); await expect(page.locator('.conclusion')).toContainText('未提供温限判定与超出量');
  assert.doesNotMatch(await page.locator('.conclusion').innerText(),/18\.3|超温|满足温限$/); await variants('真实温度场缺少判定'); await page.screenshot({path:path.join(out,'temperature.png')});
  for (const state of ['empty','loading','error']) {
    let release;const gate=new Promise(resolve=>release=resolve); const mask=`**/api/workspaces/${thermal.w.id}/studies/${thermal.s.id}/runs*`;
    await context.route(mask,async route=>{if(state==='loading')await gate;await route.fulfill({status:state==='error'?503:200,contentType:'application/json',body:JSON.stringify(state==='error'?{detail:'温度场暂不可用'}:{items:[]})}).catch(()=>{});});
    await go(`/studies/${thermal.s.id}/thermal-field/field?workspace=${thermal.w.id}`);
    await expect(state==='loading'?page.locator('[aria-busy=true]').first():state==='error'?page.getByRole('alert').first():page.getByText('尚无温度场运行',{exact:true})).toBeVisible(); await variants('温度场'+state);release();await context.unroute(mask,{behavior:'wait'});
  }
  assert.deepEqual(report.errors,[]);
}catch(error){report.failure=String(error.stack||error);console.error(report.failure);console.error((await page.locator('body').innerText()).slice(0,2600));process.exitCode=1;}
finally{await fs.writeFile(path.join(out,'verification.json'),JSON.stringify(report,null,2));await context.unrouteAll({behavior:'ignoreErrors'});await session.close();}
console.log(JSON.stringify(report));
