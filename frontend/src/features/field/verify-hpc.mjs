/** One-page Edge/CDP regression. BACKEND_URL and FRONTEND_URL must be isolated.
 * Run: node src/features/field/verify-hpc.mjs [real-acceptance-receipt.json]
 * Exercises exported settings/report components before their owner mounts them.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openHeadlessBrowser, settle, repositoryRoot } from '../../../scripts/browser.mjs';
import { assertLayout } from '../../../scripts/layout-assertions.mjs';

const url = process.env.FRONTEND_URL || 'http://127.0.0.1:8118';
assert(!['8100', '8200'].includes(new URL(url).port), 'Use an isolated frontend');
const output = path.join(repositoryRoot, '.data', 'fem-convergence', 'browser');
await fs.mkdir(output, { recursive: true });
const source = { id: '00000000-0000-4000-8000-000000000001', workspace: 'w', study: 's', sequence: 5, created: '2026-10-08T12:00:00Z', integrity: 'verified', status: 'succeeded',
  snapshot: { definition: { title: '城北变电站 · 排管有限元', method: { plugin_id: 'cablesim.simulation', version: '1.0.1' } }, cases: [{ case_id: 'c', input: { load: 400 }, parameters: { iec: {} } }] },
  output: { cases: [{ case_id: 'c', status: 'succeeded', results: [{ key: 'conductor_temperature', entity: '回路甲', unit: 'K', case: 'operating', status: 'available', value: 380.55 }] }] } };
const iec = structuredClone(source); iec.id = '00000000-0000-4000-8000-000000000002'; iec.study = 'iec'; iec.sequence = 3;
iec.snapshot.definition = { title: '城北变电站 · IEC 询价', method: { plugin_id: 'cablesim.iec60287', version: '0.9.2' } }; iec.snapshot.cases[0].parameters = {}; iec.output.cases[0].results[0].value = 380.13;
let state = 'empty', kind = 'jobs', live = false, submissions = 0, cancellations = 0, transitions = [], real = false;
const workflow = { id: 'workflow', source_run_id: source.id, study: 'child', title: '城北变电站 · 自动收敛', request: { max_core_hours: 12 }, actual_core_hours: .2, per_step_upper_core_hours: 2.067,
  verdict: { status: 'unconverged' }, rows: [0.4, .15, .08, .04].map((change, i) => ({ kind: 'mesh', mesh_size_m: .008 / 2 ** i, hotspot_k: 380 + change, change_k: i ? change : null, nodes: 11000 * (i + 1), sequence: i + 1, created: source.created })), attempts: [] };
const browser = await openHeadlessBrowser(), { page } = browser;
const errors = []; page.on('pageerror', error => errors.push(error.message));
page.on('response', response => { if (response.status() >= 400 && !response.url().includes('/api/')) console.error(response.status(), response.url()); });
try {
  await page.route('**/field-acceptance', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>超算组件验收</title><script type="module">
import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
const {renderFixture}=await import('/src/features/field/browser-fixture.tsx');window.renderFixture=renderFixture;window.ready=true;
</script><style>body{margin:0}#test{height:100vh;overflow:auto;padding:var(--space-6);box-sizing:border-box;background:var(--panel);color:var(--text)}</style></head><body><main id="test"></main></body></html>` }));
  await page.route('**/api/**', async route => {
    if (real) return route.continue();
    const request = route.request(), target = new URL(request.url()).pathname;
    if (!target.startsWith('/api/')) return route.continue();
    const respond = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (state === 'loading') { await new Promise(resolve => setTimeout(resolve, 1500)); return respond({ items: [] }); }
    if (state === 'error') return respond({ detail: '超算连接中断，保存数据保留。' }, 503);
    if (request.method() === 'POST') {
      if (target.endsWith('/cancel')) { cancellations++; state = 'history'; return respond({ state: 'cancel_requested' }); }
      const body = request.postDataJSON(); assert.equal(body.budget_confirmed, true); assert.equal(body.tolerance_k, .1); assert.equal(body.max_core_hours, 12);
      submissions++; state = 'success'; live = true; return respond({ ...workflow, status: 'queued' }, 202);
    }
    if (target.endsWith('/jobs')) return respond({ total: state === 'empty' ? 0 : 1, next_offset: null, items: state === 'empty' ? [] : [{ id: 'job', study_name: '城北变电站 · 三回排管有限元收敛研究', sequence: 6, created: source.created,
      status: state === 'history' ? 'succeeded' : 'running', cancellable: state !== 'history', execution: { job_id: '799001' }, core_hours: .01472, started: source.created, finished: state === 'history' ? source.created : null }] });
    if (target.endsWith('/convergence')) {
      const status = live ? (['queued', 'running', 'completed'][Math.min(transitions.length, 2)]) : state === 'history' ? 'blocked' : 'completed';
      if (live) transitions.push(status);
      return respond({ items: state === 'empty' ? [] : [{ ...workflow, status, reason: status === 'blocked' ? '网格自由度超过保存上限，原阈值未改变。' : '', verdict: { status: status === 'completed' ? 'converged' : 'unconverged' } }] });
    }
    if (target.endsWith('/studies')) return respond(state === 'empty' ? [] : [{ id: 'iec', definition: iec.snapshot.definition }]);
    if (target.endsWith('/runs')) return respond([iec]);
    return respond(target.endsWith(source.id) ? source : iec);
  });
  await page.goto(url + '/field-acceptance'); await page.waitForFunction(() => window.ready).catch(error => { console.error(errors); throw error; });
  let serial = 0;
  async function mount(type, run = source) { kind = type; await page.evaluate(({ kind, run, key }) => window.renderFixture(kind, run, key), { kind, run, key: ++serial }); }
  const checks = [];
  for (const viewport of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize(viewport); await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.documentElement.dataset.reducedMotion = 'true'; }, theme);
    for (const type of ['jobs', 'adaptive', 'comparison']) for (const item of ['empty', 'loading', 'error', 'success', 'history']) {
      state = item; await mount(type); await page.waitForTimeout(item === 'loading' ? 100 : 400);
      const label = `${type}/${item}/${theme}/${viewport.width}`;
      const text = await page.locator('body').innerText(); assert(text.trim(), label + ' blank');
      assert(!/\b[0-9a-f]{8}-[0-9a-f-]{27}\b|\d{4}-\d\d-\d\dT\d\d:/.test(text), label + ' raw run identity');
      const collisions = await page.evaluate(() => [...document.querySelectorAll('tr,.field-scope>div,.hpc-actions')].flatMap(group => {
        const children = [...group.children].map(node => ({ text: node.textContent.slice(0, 60), box: node.getBoundingClientRect() })).filter(({ box }) => box.width && box.height);
        return children.flatMap((a, i) => children.slice(i + 1).filter(b => Math.min(a.box.right,b.box.right)-Math.max(a.box.left,b.box.left)>1 && Math.min(a.box.bottom,b.box.bottom)-Math.max(a.box.top,b.box.top)>1).map(b => [a.text,b.text]));
      }));
      assert.deepEqual(collisions, [], label + ' cell/control overlap');
      checks.push({ label, collisions, ...(await assertLayout(page, label)) });
    }
  }
  state = 'empty'; await mount('adaptive'); await page.getByRole('button', { name: '设置收敛预算' }).click();
  await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '设置收敛预算' }).click(); await page.getByRole('spinbutton').fill('0');
  await page.keyboard.press('Enter'); await page.getByRole('alert').waitFor(); assert.equal(submissions, 0);
  await page.getByRole('spinbutton').fill('12'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  await page.getByText('已完成 · 达到门槛', { exact: true }).waitFor({ timeout: 20000 });
  assert.equal(submissions, 1); assert.deepEqual(transitions.slice(0, 3), ['queued', 'running', 'completed']);
  live = false; state = 'success'; await mount('jobs'); await page.getByRole('button', { name: '取消作业' }).click();
  await page.getByText('已封存', { exact: true }).waitFor(); assert.equal(cancellations, 1);
  if (process.argv[2]) {
    const receipt = JSON.parse(await fs.readFile(path.resolve(process.argv[2]), 'utf8')); real = true;
    await page.setViewportSize({ width: 1366, height: 768 }); await page.evaluate(() => document.documentElement.dataset.theme = 'light');
    const realRun = { id: receipt.femRun, workspace: receipt.workspace, study: receipt.fem, sequence: 5, created: '2026-10-08T02:25:47.643898-07:00' };
    for (const type of ['adaptive', 'jobs', 'comparison']) {
      await mount(type, realRun);
      if (type === 'adaptive') await page.getByText('资源不足 · 尚未收敛', { exact: true }).waitFor({ timeout: 30000 });
      if (type === 'jobs') await page.getByText('798567', { exact: true }).waitFor({ timeout: 30000 });
      if (type === 'comparison') { await page.getByRole('table', { name: '有限元与IEC量值对照' }).waitFor({ timeout: 60000 }); await page.getByText('对照口径', { exact: true }).click(); }
      await settle(page); await assertLayout(page, `real/${type}`); await page.screenshot({ path: path.join(output, `${type}.png`) });
    }
  }
  assert.deepEqual(errors, []); await fs.writeFile(path.join(output, 'checks.json'), JSON.stringify({ checks, submissions, cancellations, transitions, errors }, null, 2));
  console.log(JSON.stringify({ checks: checks.length, submissions, cancellations, transitions, output }));
} finally { await browser.close(); }
