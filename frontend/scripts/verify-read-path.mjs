/** Read actual archived deliveries and saved Chengnan fields; never submit a job. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openHeadlessBrowser, repositoryRoot } from './browser.mjs';
import { installReadinessObserver, readinessSnapshot, waitForPageReady } from './page-readiness.mjs';

assert.equal(process.env.E2E_ISOLATED, '1');
const base = process.env.FRONTEND_URL;
assert.ok(!['8100', '8200'].includes(new URL(base).port));
const phase = process.env.READ_PATH_PHASE || 'after';
assert.ok(['before', 'after'].includes(phase));
const out = path.join(repositoryRoot, '.data/fix-round/shared-shell/read-path', phase);
await fs.mkdir(out, { recursive: true });
const report = { phase, source: process.env.E2E_DATABASE_SOURCE || '.data/release/engineering.sqlite', writes: [], pages: [], errors: [], complete: false };
const session = await openHeadlessBrowser({ routeGuard: false });
const { page } = session;
page.setDefaultTimeout(30000);
page.on('pageerror', e => report.errors.push(e.message));
page.on('request', r => { if (!['GET','HEAD','OPTIONS'].includes(r.method())) report.writes.push({ method: r.method(), path: new URL(r.url()).pathname }); });
const get = async url => { const r = await fetch(base + url); assert.ok(r.ok, url + ': ' + r.status); return r.json(); };
const resources = () => page.evaluate(() => performance.getEntriesByType('resource').filter(r => new URL(r.name).pathname.startsWith('/api/')).map(r => ({ url: new URL(r.name).pathname + new URL(r.name).search, startMs: r.startTime, durationMs: r.duration, decodedBytes: r.decodedBodySize, transferBytes: r.transferSize })));
try {
  await page.setViewportSize({ width:1366, height:768 });
  await installReadinessObserver(page);
  if (process.env.READ_PATH_CHENGNAN === '1') {
    await page.setViewportSize({ width:1920, height:1080 });
    const sid = '2625752f-12f1-4783-a507-d10e04851302', wid = '8f1c2530-4701-46cd-82fc-58bc5d318486';
    const route = `/studies/${sid}/thermal-field/field?workspace=${wid}&theme=light`;
    await page.goto(base + route, { waitUntil:'domcontentloaded' });
    await waitForPageReady(page, { includeCanvas:false });
    await page.waitForFunction(() => document.querySelectorAll('canvas.field-canvas').length >= 2);
    let failure = null;
    try { await waitForPageReady(page, { timeout:30000 }); } catch (e) { failure = e.message; }
    const initial = await page.evaluate(readinessSnapshot);
    report.chengnan = { route, failure, initial, frames:[] };
    if (phase === 'after') {
      assert.equal(failure, null);
      assert.ok(initial.canvases.length && initial.canvases.every(c => c.visible && c.ready), '首屏只核对实际可见且真正绘制的画布');
      const fields = page.locator('.field-view');
      for (let i=0; i<await fields.count(); i++) {
        await fields.nth(i).scrollIntoViewIfNeeded();
        const canvas = fields.nth(i).locator('canvas.field-canvas');
        await canvas.waitFor({ state:'visible' });
        const state = await waitForPageReady(page);
        assert.ok(state.canvases.length && state.canvases.every(c => c.visible && c.ready));
        assert.ok(await canvas.getAttribute('data-audit-first-draw'), '滚入视口后仍须等待该场图真实首帧');
        report.chengnan.frames.push({ index:i, state });
      }
      assert.ok(report.chengnan.frames.length >= 2);
    } else assert.ok(failure?.includes('页面未就绪'), '须实际复现离屏第二画布导致的旧巡检超时');
    await page.screenshot({ path:path.join(out,'chengnan-light.png') });
    report.chengnan.resources = await resources();
    if (phase === 'after') assert.ok(report.chengnan.resources.filter(r => r.url.startsWith('/api/methods')).every(r => r.url.includes('view=summary')), '共享研究外壳不再读取完整方法清单');
  } else {
    const spaces = await get('/api/workspaces');
    let row, wid;
    for (const w of spaces) {
      const items = await get(`/api/workspaces/${w.id}/deliveries?view=summary`);
      const selected = process.env.READ_PATH_DELIVERY_ID ? items.find(item => item.id === process.env.READ_PATH_DELIVERY_ID) : items[0];
      if (selected) { row=selected; wid=w.id; break; }
    }
    assert.ok(row, '必须使用发布库真实保存交付，不造存档');
    const route = `/deliveries?workspace=${wid}&delivery=${row.id}&theme=light`;
    const response = page.waitForResponse(r => new URL(r.url()).pathname === `/api/workspaces/${wid}/deliveries/${row.id}`);
    await page.goto(base + route, { waitUntil:'domcontentloaded' });
    const receipt = await response; assert.equal(receipt.status(),200);
    await receipt.finished();
    await waitForPageReady(page);
    const selected = await receipt.json();
    assert.equal(selected.digest,row.digest); assert.deepEqual(selected.sources,row.sources);
    report.pages.push({ route, stage:'selected', requests:await resources(), bytes:Buffer.byteLength(JSON.stringify(selected)), hasHtml:typeof selected.html === 'string' });
    if (phase === 'after') {
      assert.equal(new URL(receipt.url()).searchParams.get('view'),'summary');
      assert.equal(typeof selected.html,'undefined');
      assert.equal(await page.locator('iframe[title="交付存档预览"]').count(),0);
      const full = page.waitForResponse(r => new URL(r.url()).pathname === `/api/workspaces/${wid}/deliveries/${row.id}` && new URL(r.url()).searchParams.get('view') === 'full');
      await page.getByRole('button',{ name:'预览存档',exact:true }).click();
      await (await full).finished(); await waitForPageReady(page);
    }
    const frame = page.frameLocator('iframe[title="交付存档预览"]');
    await frame.locator('body').waitFor({ state:'visible' });
    assert.ok((await frame.locator('body').innerText()).trim().length > 30, '真实保存正文必须渲染');
    report.pages.push({ route, stage:'preview', requests:await resources() });
    await page.screenshot({ path:path.join(out,'delivery-preview-light.png') });
    if (phase === 'after') {
      await page.getByRole('button',{ name:'收起预览',exact:true }).click();
      assert.equal(await page.locator('iframe[title="交付存档预览"]').count(),0);
      await page.getByRole('button',{ name:'预览存档',exact:true }).focus();
      await page.keyboard.press('Enter');
      await frame.locator('body').waitFor({ state:'visible' });
      report.previewToggle = { closed:true, keyboardReopened:true };
    }
    const download = page.waitForEvent('download');
    await page.getByRole('button',{ name:'下载 PDF',exact:true }).first().click();
    const file = await download;
    assert.equal(await file.failure(),null);
    const pdf = await fs.readFile(await file.path());
    assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
    report.download = { name:file.suggestedFilename(), bytes:pdf.length, actualPdf:true };
    report.pages.push({ route, stage:'download', requests:await resources() });
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.writes, [], '只读存档及场图不保存、计算或提交作业');
  report.complete=true;
} finally {
  await fs.writeFile(path.join(out, process.env.READ_PATH_CHENGNAN === '1' ? 'chengnan.json':'delivery.json'),JSON.stringify(report,null,2));
  await session.close();
}
console.log(JSON.stringify({ complete:report.complete, selected:report.pages[0], chengnan:report.chengnan && { failure:report.chengnan.failure, initial:report.chengnan.initial, checkedFrames:report.chengnan.frames.length }, download:report.download }));
