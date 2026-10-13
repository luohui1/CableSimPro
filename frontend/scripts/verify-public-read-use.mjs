import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openHeadlessBrowser, repositoryRoot } from './browser.mjs';
import { installReadinessObserver, waitForPageReady } from './page-readiness.mjs';

assert.equal(process.env.E2E_ISOLATED, '1', '只能读取发布库隔离副本');
const base = process.env.FRONTEND_URL;
const phase = process.env.PUBLIC_READ_PHASE || 'after';
assert.ok(['before', 'after'].includes(phase));
const out = path.join(repositoryRoot, '.data/fix-round/shared-shell/private-read', phase);
await fs.mkdir(out, { recursive: true });
const session = await openHeadlessBrowser({ executable: 'C:/Program Files/Google/Chrome/Application/chrome.exe', routeGuard: false });
const { page, context } = session;
page.setDefaultTimeout(60000);
const result = { phase, source: process.env.E2E_DATABASE_SOURCE || '.data/release/engineering.sqlite', realSavedResult: true,
  cacheBaseline: phase === 'before' ? process.env.PUBLIC_READ_BASELINE || 'HEAD' : null,
  submittedJobs: 0, pages: [], requests: [], writes: [], checks: [], errors: [], complete: false };
page.on('pageerror', error => result.errors.push(error.message));
page.on('request', request => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()))
    result.writes.push({ method: request.method(), path: new URL(request.url()).pathname });
});
const get = async url => { const response = await fetch(base + url); assert.ok(response.ok, url + ': ' + response.status); return response.json(); };
function integrityFault(mode, wid, rid) {
  const database = path.resolve(process.env.CABLESIM_DB);
  assert.ok(database.startsWith(path.join(repositoryRoot, '.tmp/frontend-e2e') + path.sep), '损坏注入只能作用于本任务隔离副本');
  const code = [
    'import hashlib,json,sqlite3,sys', 'from pathlib import Path',
    'database,mode,wid,rid=sys.argv[1:]',
    "backup=Path(database).with_name('field-integrity-original')",
    "metadata=backup.with_suffix('.json')",
    'with sqlite3.connect(database,timeout=20) as db:',
    " original=db.execute('SELECT output FROM study_runs WHERE workspace=? AND id=?',(wid,rid)).fetchone()[0]",
    " if mode=='inject':",
    "  raw=original if isinstance(original,bytes) else original.encode('utf-8')",
    "  backup.write_bytes(raw); metadata.write_text(json.dumps({'binary':isinstance(original,bytes)}))",
    "  damaged=json.loads(raw); damaged['_integrity_fault']='damaged saved envelope'",
    "  value=json.dumps(damaged,ensure_ascii=False,separators=(',',':')).encode('utf-8')",
    "  if not isinstance(original,bytes): value=value.decode('utf-8')",
    ' else:',
    "  raw=backup.read_bytes(); value=raw if json.loads(metadata.read_text())['binary'] else raw.decode('utf-8')",
    " db.execute('UPDATE study_runs SET output=? WHERE workspace=? AND id=?',(value,wid,rid)); db.commit()",
    " if mode=='restore': backup.unlink(); metadata.unlink()",
    " print(json.dumps({'mode':mode,'originalBytesSha256':hashlib.sha256(raw).hexdigest()}))",
  ].join('\n');
  return JSON.parse(execFileSync(process.env.E2E_PYTHON, ['-c', code, database, mode, wid, rid], { windowsHide: true, encoding: 'utf8' }));
}
try {
  await page.setViewportSize({ width: 1366, height: 768 });
  await installReadinessObserver(page);
  const wid = process.env.FIELD_WORKSPACE || 'da924def-cbfe-4f1b-8378-8ea05f472359';
  const sid = process.env.FIELD_STUDY || '6db331de-e79e-446a-9dec-5d41166097b4';
  const rid = process.env.FIELD_RUN || '00c54351-4a2c-49f5-bf88-7e86e6a9615f';
  const field = `/api/hpc/workspaces/${wid}/fields/${rid}/view`;
  const saved = await get(`/api/workspaces/${wid}/studies/${sid}/runs/${rid}`);
  result.saved = { id: rid, outputDigest: saved.output_digest, inputDigest: saved.input_digest, versionStatus: saved.version_status };
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  const requests = new Map(); let pass = '';
  cdp.on('Network.requestWillBeSent', event => {
    if (new URL(event.request.url).pathname !== field) return;
    const row = { pass, id: event.requestId, headers: event.request.headers };
    requests.set(event.requestId, row); result.requests.push(row);
  });
  cdp.on('Network.responseReceived', event => {
    const row = requests.get(event.requestId);
    if (row) Object.assign(row, { browserStatus: event.response.status, policy: event.response.headers['Cache-Control'], etag: event.response.headers.Etag || event.response.headers.ETag,
      serverTiming: event.response.headers['Server-Timing'], fromDiskCache: event.response.fromDiskCache });
  });
  cdp.on('Network.requestWillBeSentExtraInfo', event => {
    const row = requests.get(event.requestId); if (row) row.wireRequestHeaders = event.headers;
  });
  cdp.on('Network.responseReceivedExtraInfo', event => {
    const row = requests.get(event.requestId); if (row) { row.wireStatus = event.statusCode; row.wireResponseHeaders = event.headers; }
  });
  const route = `/studies/${sid}/thermal-field/field?workspace=${wid}&run=${rid}&theme=light`;
  for (const kind of ['cold', 'hot-one', 'hot-two', 'hot-three']) {
    pass = kind;
    if (kind === 'cold') await cdp.send('Network.clearBrowserCache');
    await page.goto(base + route, { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log('真实场图：' + kind);
    // The original modal is closed only in the baseline, using its real control.
    if (phase === 'before') {
      const close = page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true });
      if (await close.isVisible().catch(() => false)) await close.click();
    }
    await waitForPageReady(page, { timeout: 60000 });
    await page.waitForFunction(() => document.querySelector('canvas.field-canvas')?.dataset.auditFirstDraw, null, { timeout: 60000 });
    const metrics = await page.evaluate(() => ({ mainMs: window.__loadAudit.mainMs, frameMs: window.__loadAudit.frameMs,
      firstDrawMs: Number(document.querySelector('canvas.field-canvas').dataset.auditFirstDraw),
      fieldResource: performance.getEntriesByType('resource').filter(r => /\/fields\/[^/]+\/view$/.test(new URL(r.name).pathname)).map(r => ({ durationMs: r.duration, transferBytes: r.transferSize, decodedBytes: r.decodedBodySize })) }));
    result.pages.push({ kind, ...metrics });
    assert.ok(metrics.firstDrawMs > 0, '必须真正绘制保存场图');
    if (kind === 'cold' && phase === 'after') {
      assert.equal(await page.getByRole('dialog').count(), 0, '说明更新不得打开模态对话框');
      await page.screenshot({ path: path.join(out, 'field-information-light.png') });
      const notice = page.locator('.information-notice').filter({ hasText: '保存结果仍有效' });
      if (await notice.isVisible()) {
        const titleStyle = await notice.locator('h2').evaluate(e => ({ size: getComputedStyle(e).fontSize, weight: getComputedStyle(e).fontWeight }));
        assert.deepEqual(titleStyle, { size: '16px', weight: '600' });
        await notice.getByRole('button', { name: '关闭信息提示' }).click();
        await notice.waitFor({ state: 'detached' });
        result.checks.push('公共信息提示非阻断、可关闭，区块标题16/600');
      } else {
        result.noticeIntegration = {
          inlineVisible: await page.locator('.study-history-line[role="status"]').filter({ hasText: '保存结果仍有效' }).isVisible().catch(() => false),
          owner: '研究', pending: '研究线程已改为行内通知；需接入InformationNotice的关闭按钮，并核对选中历史运行的通知来源。未制造通知响应。',
        };
      }
      result.checks.push('保存场图真正绘制；说明更新未打开阻断对话框');
    }
    if (kind !== 'cold' && phase === 'after') {
      assert.equal(await page.locator('.information-notice').filter({ hasText: '保存结果仍有效' }).count(), 0, '同一说明更新只提示一次');
      if (result.noticeIntegration?.inlineVisible)
        assert.equal(await page.locator('.study-history-line[role="status"]').filter({ hasText: '保存结果仍有效' }).isVisible().catch(() => false), false, '刷新后行内说明更新不得重复提示');
    }
  }
  const response = await fetch(base + field);
  assert.equal(response.status, 200);
  result.fieldPolicy = response.headers.get('cache-control');
  const etag = response.headers.get('etag');
  const conditional = await fetch(base + field, { headers: { 'If-None-Match': etag } });
  assert.equal(conditional.status, 304);
  assert.match(conditional.headers.get('server-timing'), /(?:verify|host-read);dur=/, '304须经过直接核验或宿主回执的代际重新校验');
  if (conditional.headers.get('server-timing').includes('host-read'))
    assert.ok(['hit', 'miss'].includes(conditional.headers.get('x-cablesim-read-cache')), '宿主回执须报告读取状态');
  const payload = await response.json();
  assert.equal(payload.output_digest, saved.output_digest, '浏览器投影保持保存结果身份');
  assert.equal((await fetch(base + '/api/health')).headers.get('cache-control'), 'no-store');
  assert.equal((await fetch(base + field.replace('/view', '/not-a-view'))).headers.get('cache-control'), 'no-store');
  result.checks.push('条件请求真实返回304，记录直接核验或宿主回执代际校验耗时；其他端点和错误仍no-store');
  const hot = result.requests.filter(r => r.pass.startsWith('hot'));
  result.hot304 = { total: hot.length, hits: hot.filter(r => r.wireStatus === 304).length };
  if (phase === 'after') {
    assert.equal(result.fieldPolicy, 'private, no-cache');
    assert.ok(result.hot304.hits > 0, '真实页面热加载必须命中304');
    const all = await get('/api/input-contracts');
    const method = all.find(c => c.method.plugin_id === 'cablesim.iec60287' && c.method.capability === 'model-completion').method;
    const pin = new URLSearchParams(method).toString();
    const selected = await get('/api/input-contracts?' + pin);
    assert.deepEqual(selected, all.filter(c => Object.entries(method).every(([key, value]) => c.method[key] === value)));
    assert.deepEqual(await get('/api/input-contracts?' + new URLSearchParams({ ...method, release_digest: '0'.repeat(64) })), []);
    result.contract = { fullBytes: Buffer.byteLength(JSON.stringify(all)), selectedBytes: Buffer.byteLength(JSON.stringify(selected)), method };
    const inquiryRequests = [];
    page.on('request', request => { if (new URL(request.url()).pathname === '/api/input-contracts') inquiryRequests.push(request.url()); });
    await page.goto(base + '/?theme=light', { waitUntil: 'domcontentloaded' });
    await waitForPageReady(page);
    await page.getByRole('button', { name: '新建研究', exact: true }).first().click();
    await page.getByRole('dialog').waitFor({ state: 'visible' });
    await page.getByRole('dialog').getByRole('combobox', { name: '研究任务' }).click();
    await page.getByRole('option', { name: /询价|问询/ }).click();
    await page.getByRole('dialog').getByText('正在读取', { exact: false }).waitFor({ state: 'hidden' }).catch(() => {});
    await page.waitForFunction(() => document.querySelector('[role="dialog"] select,[role="dialog"] input'));
    assert.ok(inquiryRequests.some(url => new URL(url).searchParams.get('capability') === 'model-completion'));
    assert.ok(inquiryRequests.some(url => new URL(url).searchParams.get('capability') === 'steady-rating'));
    assert.ok(inquiryRequests.every(url => new URL(url).searchParams.has('capability')), '公共询价表单不读取全量契约');
    result.inquiryRequests = inquiryRequests.map(url => url.replace(base, ''));
    await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
    result.checks.push('真实询价入口按两项能力读取；方法完整封签匹配，错误摘要不回退其他版本');
    // Only an integrity failure is injected: it cannot be produced by a valid UI
    // save. All positive field values above come from the real saved HPC result.
    let injected = false;
    try {
      injected = true;
      const fault = integrityFault('inject', wid, rid);
      const rejected = await fetch(base + field, { headers: { 'If-None-Match': etag } });
      result.integrityFault = { kind: '隔离输出损坏注入；保留原摘要；不造成功结果', ...fault,
        conditionalStatus: rejected.status, policy: rejected.headers.get('cache-control'), detail: await rejected.text() };
      assert.equal(rejected.status, 409, '真实保存输出损坏后，旧ETag不能复用核验回执或返回304');
      assert.equal(rejected.headers.get('cache-control'), 'no-store');
    } finally {
      if (injected) result.restoredSource = integrityFault('restore', wid, rid);
    }
    assert.equal(result.restoredSource.originalBytesSha256, result.integrityFault.originalBytesSha256);
    const restored = await fetch(base + field);
    assert.equal(restored.status, 200, '恢复原始字节后须重新核验成功');
    assert.equal((await restored.json()).output_digest, saved.output_digest);
    const restoredConditional = await fetch(base + field, { headers: { 'If-None-Match': restored.headers.get('etag') } });
    assert.equal(restoredConditional.status, 304);
    result.checks.push('损坏注入后的旧ETag被409拒绝且no-store；恢复原字节后200/304，验证回执随真实数据库提交失效');
  }
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.writes, [], '保存场图和打开询价表单不得提交作业或保存新输入');
  result.complete = true;
} finally {
  await fs.writeFile(path.join(out, 'result.json'), JSON.stringify(result, null, 2));
  await session.close();
}
console.log(JSON.stringify({ complete: result.complete, fieldPolicy: result.fieldPolicy, hot304: result.hot304, pages: result.pages, checks: result.checks }, null, 2));
