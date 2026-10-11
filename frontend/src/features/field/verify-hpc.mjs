/** One-page Edge/CDP regression. BACKEND_URL and FRONTEND_URL must be isolated.
 * Run: node src/features/field/verify-hpc.mjs [real-acceptance-receipt.json]
 * Exercises exported settings/report components before their owner mounts them.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openHeadlessBrowser, settle, repositoryRoot } from '../../../scripts/browser.mjs';
import { assertLayout } from '../../../scripts/layout-assertions.mjs';

// Production main-canvas regression (separate from the component fixture).
if (process.env.HPC_WORKSPACE_ONLY === '1') {
  const { verifyWorkspace } = await import('./verify-workspace.mjs');
  await verifyWorkspace(process.argv[2]);
  process.exit(0);
}

const url = process.env.FRONTEND_URL || 'http://127.0.0.1:8118';
const realOnly = process.env.HPC_REAL_ONLY === '1';
assert(!realOnly || process.argv[2], 'HPC_REAL_ONLY requires a saved acceptance receipt');
assert(!['8100', '8200'].includes(new URL(url).port), 'Use an isolated frontend');
const output = process.env.FIELD_EVIDENCE || path.join(repositoryRoot, '.data', 'fem-convergence', 'browser');
await fs.mkdir(output, { recursive: true });
const source = { id: '00000000-0000-4000-8000-000000000001', workspace: 'w', study: 's', sequence: 5, created: '2026-10-08T12:00:00Z', integrity: 'verified', status: 'succeeded',
  snapshot: { definition: { title: '城北变电站 · 排管有限元', method: { plugin_id: 'cablesim.simulation', version: '1.0.1' } }, cases: [{ case_id: 'c', input: { load: 400 }, parameters: { iec: {} } }] },
  output: { cases: [{ case_id: 'c', status: 'succeeded', results: [{ key: 'conductor_temperature', entity: '回路甲', unit: 'K', case: 'operating', status: 'available', value: 380.55 }] }] } };
const iec = structuredClone(source); iec.id = '00000000-0000-4000-8000-000000000002'; iec.study = 'iec'; iec.sequence = 3;
const fieldRun = structuredClone(source);
fieldRun.artifact_status = { c: { 'x-cablesim.temperature-field': { status: 'verified' } } };
fieldRun.output.cases[0].artifact_digests = { 'x-cablesim.temperature-field': 'a', 'x-cablesim.simulation-bundle': 'b' };
fieldRun.output.cases[0].artifacts = {
  'x-cablesim.simulation-bundle': {},
  'x-cablesim.temperature-field': { schema_version: 'cablesim.temperature-field/1', association: 'node', temperature_unit: 'K',
    mesh: { points: [[0,0],[1,0],[0,1]], triangles: [[0,1,2]], domain_ids: [1], length_unit: 'm', coordinates: 'section-x-z; z-up' },
    temperature_k: [300,310,320], hotspot: { point_m: [0,1], temperature_k: 320, time_s: 0, method: 'saved node' }, samples: [],
    source: { bundle_sha256: 'b' }, convergence: { display_decimated: true, full_mesh_nodes: 600000 } }
};
iec.snapshot.definition = { title: '城北变电站 · IEC 询价', method: { plugin_id: 'cablesim.iec60287', version: '0.9.2' } }; iec.snapshot.cases[0].parameters = {}; iec.output.cases[0].results[0].value = 380.13;
let state = 'empty', kind = 'jobs', live = false, submissions = 0, continuations = 0, cancellations = 0, transitions = [], real = false;
let slowSamples = false, activeSamples = 0, peakSamples = 0, samples = 0;
const workflow = { id: 'workflow', source_run_id: source.id, study: 'child', title: '城北变电站 · 自动收敛', request: { max_core_hours: 12 }, actual_core_hours: .2, per_step_upper_core_hours: 2.067,
  verdict: { status: 'unconverged' }, rows: [0.4, .15, .08, .04].map((change, i) => ({ kind: 'mesh', run_id: i ? `saved-level-${i}` : source.id, mesh_size_m: .008 / 2 ** i, hotspot_k: 380 + change, change_k: i ? change : null, nodes: 11000 * (i + 1), sequence: i + 1, created: source.created })), attempts: [] };
const convergedRows = [0,1,2].map(i => ({ kind: 'mesh',run_id:i ? `saved-level-${i}` : source.id,mesh_size_m:.004/2**i,bounds_m:[-8,-8,8,0],hotspot_k:380+i*.01,change_k:i ? .01 : null,nodes:10000*(i+1) }));
convergedRows.push(...[16,32,64].map((depth,i) => ({kind:'domain',run_id:`domain-${i}`,mesh_size_m:.001,bounds_m:[-depth,-depth,depth,0],hotspot_k:380.03+i*.01,change_k:.01,nodes:40000*(i+1)})));
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
    if (target.endsWith('/progress') && (kind === 'setup' || state === 'running')) return respond({status:state === 'history' ? 'succeeded' : 'running',execution:{backend:'slurm',state:state === 'history' ? 'succeeded' : 'queued',job_id:'799002',actual_cpu_seconds:36,budget_core_hours:6.2,queue_position:4}});
    if (target.endsWith('/view') && kind === 'field') return respond(state === 'empty' ? source : state === 'running' && !target.includes('/previous/') ? {...source,status:'running',output:undefined} : { ...fieldRun, id:target.includes('/previous/') ? 'previous' : source.id, freshness: state === 'history' ? 'historical' : 'current' });
    if (state === 'running' && target.endsWith('/runs')) return respond({items:[{...source,id:'previous'}],next_cursor:null});
    if (target.endsWith('/sample')) {
      activeSamples++; samples++; peakSamples = Math.max(peakSamples, activeSamples);
      try { if (slowSamples) await new Promise(resolve => setTimeout(resolve, 500)); return await respond({ temperature_k: [307.5], mesh: 'full' }); }
      finally { activeSamples--; }
    }
    if (request.method() === 'POST') {
      if (target.endsWith('/cancel')) { cancellations++; state = 'history'; return respond({ state: 'cancel_requested' }); }
      const body = request.postDataJSON(); assert.equal(body.budget_confirmed, true); assert.equal(body.tolerance_k, .1); assert.equal(body.max_core_hours, 12);
      if (body.continue_from) { assert.equal(body.continue_from, workflow.id); assert.equal(body.source_run_id, state === 'failed' ? 'saved-level-2' : 'saved-level-3'); assert(target.includes('/studies/child/')); if(state === 'failed')assert.equal(body.retain_domain_levels,2); continuations++; }
      submissions++; state = 'success'; live = true; return respond({ ...workflow, status: 'queued' }, 202);
    }
    if (target.endsWith('/jobs')) return respond({ total: state === 'empty' ? 0 : 1, next_offset: null, items: state === 'empty' ? [] : [{ id: 'job', study_name: '城北变电站 · 三回排管有限元收敛研究', sequence: 6, created: source.created,
      status: state === 'history' ? 'succeeded' : 'running', cancellable: state !== 'history', execution: { job_id: '799001' }, core_hours: .01472, started: source.created, finished: state === 'history' ? source.created : null }] });
    if (target.endsWith('/convergence')) {
      if(state === 'failed')return respond({items:[{...workflow,status:'failed',reason:'最终载流量作业超时；保存温度验证保留。',rows:convergedRows,verdict:{status:'converged',mesh_passed:true,domain_passed:true,tolerance_k:.1}}]});
      const status = live ? (['queued', 'running', 'completed'][Math.min(transitions.length, 2)]) : state === 'history' ? 'blocked' : 'completed';
      if (live) transitions.push(status);
      return respond({ items: state === 'empty' ? [] : [{ ...workflow, status, reason: status === 'blocked' ? '网格自由度超过保存上限，原阈值未改变。' : '', verdict: { status: status === 'completed' ? 'converged' : 'unconverged' } }] });
    }
    if (target.endsWith('/studies')) return respond(state === 'empty' ? [] : [{ id: 'iec', definition: iec.snapshot.definition }]);
    if (target.endsWith('/runs')) return respond({items:[iec],next_cursor:null});
    return respond(target.endsWith(source.id) || target.includes(`/fields/${source.id}/`) ? source : iec);
  });
  await page.goto(url + '/field-acceptance'); await page.waitForFunction(() => window.ready).catch(error => { console.error(errors); throw error; });
  const limitChecks = await page.evaluate(async () => {
    const { savedConductorLimit } = await import('/src/features/field/saved-temperature-limit.ts');
    const run = {integrity:'verified',snapshot:{definition:{method:{plugin_id:'cablesim.simulation',capability:'iec-thermal-field'}},cases:[{case_id:'c',input:{schema_version:'cablesim.domain/1',cable_types:[{id:'t',rating:{max_conductor_temperature:{normal:363.15}}}],circuits:[{cable_type:'t',cables:[{id:'a'},{id:'b'}]}]}}]},output:{cases:[{case_id:'c',status:'succeeded',results:['a','b'].map(entity=>({key:'conductor_temperature',case:'operating',entity,unit:'K',status:'available',value:350}))}]}};
    const values = [];
    values.push(savedConductorLimit(run,'c')?.within === true);
    run.output.cases[0].results[1].value=381.15;
    values.push(savedConductorLimit(run,'c')?.within === false && Math.abs(savedConductorLimit(run,'c').excess_k-18)<1e-8);
    run.snapshot.cases[0].input.cable_types.push({id:'cold',rating:{max_conductor_temperature:{normal:323.15}}});
    run.snapshot.cases[0].input.circuits=[{cable_type:'t',cables:[{id:'a'}]},{cable_type:'cold',cables:[{id:'b'}]}];run.output.cases[0].results[1].value=330;
    values.push(savedConductorLimit(run,'c')?.within === false && savedConductorLimit(run,'c')?.shared_limit_c === null);
    run.output.cases[0].results[1].status='unavailable';values.push(savedConductorLimit(run,'c') === undefined);
    run.output.cases[0].results[1].status='available';run.output.cases[0].results[1].unit='degC';values.push(savedConductorLimit(run,'c') === undefined);
    run.output.cases[0].results[1].unit='K';run.snapshot.cases[0].input.cable_types[0].rating.max_conductor_temperature.normal=null;values.push(savedConductorLimit(run,'c') === undefined);
    run.snapshot.cases[0].input.cable_types[0].rating.max_conductor_temperature.normal=363.15;run.integrity='unverified';values.push(savedConductorLimit(run,'c') === undefined);
    run.integrity='verified';run.snapshot.definition.method.plugin_id='cablesim.iec60287';values.push(savedConductorLimit(run,'c') === undefined);
    return values;
  });
  assert(limitChecks.every(Boolean),'saved conductor limit comparison failed');
  const boundaryChecks = await page.evaluate(async () => {
    const { boundaryScope } = await import('/src/features/field/boundary-scope.ts');
    const input = { sections: [{ id:'s',kind:'ground',soil_layers:[],backfill:null,medium:{surface_temperature:293.15} }],load_cases:[{id:'l',kind:'steady'}] };
    const parameters = { domain_options:{section_id:'s',load_id:'l'} };
    const checks = [boundaryScope(input,parameters).label === '镜像远场（默认）',
      boundaryScope(input,{...parameters,outer_boundary:'ambient_truncated'}).label.includes('恒温截断')];
    input.sections[0].soil_layers.push({});checks.push(boundaryScope(input,parameters).reason.includes('分层'));
    input.sections[0].soil_layers=[];input.sections[0].backfill={};checks.push(boundaryScope(input,parameters).reason.includes('回填'));
    input.sections[0].backfill=null;input.sections[0].medium.surface_temperature=null;checks.push(boundaryScope(input,parameters).reason.includes('恒温'));
    return checks;
  });
  assert(boundaryChecks.every(Boolean),'default boundary scope failed');
  let serial = 0;
  async function mount(type, run = source) { kind = type; await page.evaluate(({ kind, run, key }) => window.renderFixture(kind, run, key), { kind, run: {...run,fixtureState:state}, key: ++serial }); }
  const checks = [];
  if (!realOnly) {
  for (const viewport of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize(viewport); await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.documentElement.dataset.reducedMotion = 'true'; }, theme);
    for (const type of ['jobs', 'adaptive', 'comparison', 'field', 'setup', 'diagnostic']) for (const item of ['empty', 'loading', 'error', 'success', 'history']) {
      state = item; await mount(type, type === 'field' ? { id: source.id, workspace: source.workspace, study: source.study } : source); await page.waitForTimeout(item === 'loading' ? 100 : 400);
      const label = `${type}/${item}/${theme}/${viewport.width}`;
      const text = await page.locator('body').innerText(); assert(text.trim(), label + ' blank: ' + errors.join('; '));
      if (type === 'field') {
        const expected = { empty: '该运行没有温度场工件', loading: '读取保存场图', error: '超算连接中断', success: '显示已降采样，计算用全网格', history: '显示已降采样，计算用全网格' }[item];
        assert(text.includes(expected), label + ' wrong state: ' + text);
        if (item === 'history') assert.equal(await page.getByRole('region', { name: '历史结论' }).count(), 1);
      }
      if (type === 'setup') {
        assert(text.includes({empty:'未运行',loading:'读取超算预算',error:'超算连接中断',success:'排队位置 4',history:'方法版本变化 1.0.3 → 1.0.4'}[item]),label+' wrong lifecycle: '+text);
        assert.equal(await page.locator('img,ol').count(),0,label+' illustrative workflow remains');
        if(item === 'empty')assert(text.includes('镜像远场（默认）'),label+' missing default boundary');
      }
      if (type === 'comparison' && ['success','history'].includes(item)) assert.equal(await page.getByRole('table',{name:'有限元与IEC量值对照'}).count(),1,label+' missing comparison');
      if(type === 'diagnostic') {
        assert(text.includes({empty:'尚无保存的排管敏感性诊断',loading:'读取排管诊断',error:'超算连接中断',success:'影响百分比以原有限元为分母',history:'历史'}[item]),label+' wrong diagnostic state');
        if(['success','history'].includes(item)) assert.equal(await page.getByRole('table',{name:'排管敏感性影响'}).count(),1);
      }
      if (type === 'adaptive' && ['success','history'].includes(item)) assert((await page.locator('.fem-chart-threshold').count())>0,label+' missing threshold');
      assert(!/\b[0-9a-f]{8}-[0-9a-f-]{27}\b|\d{4}-\d\d-\d\dT\d\d:/.test(text), label + ' raw run identity');
      const collisions = await page.evaluate(() => [...document.querySelectorAll('tr,.field-scope>div,.hpc-actions')].flatMap(group => {
        const children = [...group.children].map(node => ({ text: node.textContent.slice(0, 60), box: node.getBoundingClientRect() })).filter(({ box }) => box.width && box.height);
        return children.flatMap((a, i) => children.slice(i + 1).filter(b => Math.min(a.box.right,b.box.right)-Math.max(a.box.left,b.box.left)>1 && Math.min(a.box.bottom,b.box.bottom)-Math.max(a.box.top,b.box.top)>1).map(b => [a.text,b.text]));
      }));
      assert.deepEqual(collisions, [], label + ' cell/control overlap');
      checks.push({ label, collisions, ...(await assertLayout(page, label)) });
    }
  }
  state = 'success'; slowSamples = true; await mount('field', { id: source.id, workspace: source.workspace, study: source.study });
  await page.locator('.field-canvas').waitFor(); const sampleBox = await page.locator('.field-canvas').boundingBox();
  for (const fraction of [.4,.45,.5]) { await page.mouse.move(sampleBox.x + sampleBox.width*fraction, sampleBox.y + sampleBox.height*.5); await page.waitForTimeout(250); }
  await page.waitForFunction(() => document.querySelector('.field-probe')?.textContent.includes('34.4 °C'));
  assert.equal(peakSamples, 1, 'full field requests overlap'); assert(samples >= 2); slowSamples = false;
  state = 'empty'; await mount('adaptive'); await page.getByRole('button', { name: '设置收敛预算' }).click();
  await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '设置收敛预算' }).click(); await page.getByRole('spinbutton').fill('0');
  await page.keyboard.press('Enter'); await page.getByRole('alert').waitFor(); assert.equal(submissions, 0);
  await page.getByRole('spinbutton').fill('12'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  await page.getByText('已完成 · 达到门槛', { exact: true }).waitFor({ timeout: 20000 });
  assert.equal(submissions, 1); assert.deepEqual(transitions.slice(0, 3), ['queued', 'running', 'completed']);
  live = false; state = 'success'; await mount('jobs'); await page.getByRole('button', { name: '取消作业' }).click();
  await page.getByText('已封存', { exact: true }).waitFor(); assert.equal(cancellations, 1);
  state = 'history'; await mount('adaptive'); await page.getByRole('button', { name: '用当前版本继续' }).click();
  await page.getByRole('spinbutton').fill('12'); await page.keyboard.press('Enter');
  await page.getByRole('dialog').waitFor({ state: 'hidden' }); assert.equal(continuations, 1); assert.equal(submissions, 2); live = false;
  state='success'; await mount('setup'); await page.getByRole('button',{name:'停止',exact:true}).click();
  await page.getByText('已封存',{exact:true}).waitFor(); assert.equal(cancellations,2);
  state='running'; await mount('field',{...source,status:'running',output:undefined});
  await page.locator('.field-canvas').waitFor(); await page.getByRole('button',{name:'停止',exact:true}).waitFor();
  assert.equal(await page.getByRole('region',{name:'历史结论'}).count(),1,'running field lost prior result');
  for(const viewport of [{width:1366,height:768},{width:1920,height:1080}])for(const theme of ['light','dark']){
    await page.setViewportSize(viewport);await page.evaluate(theme => document.documentElement.dataset.theme=theme,theme);
    state='failed';await mount('adaptive');await page.getByText(/温度收敛已达标；最终允许电流运行失败/).waitFor();
    await page.getByRole('button',{name:'用当前版本继续'}).click();
    await page.getByRole('combobox',{name:'已验证计算域'}).selectOption('2');
    await assertLayout(page,`failed-rating/dialog/${theme}/${viewport.width}`);
    await page.keyboard.press('Escape');
  }
  await page.getByRole('button',{name:'用当前版本继续'}).click();await page.getByRole('spinbutton').fill('12');await page.keyboard.press('Enter');
  await page.getByRole('dialog').waitFor({state:'hidden'});assert.equal(continuations,2);assert.equal(submissions,3);live=false;
  }
  if (process.argv[2]) {
    const receipt = JSON.parse(await fs.readFile(path.resolve(process.argv[2]), 'utf8')); real = true;
    await page.setViewportSize({ width: 1366, height: 768 }); await page.evaluate(() => document.documentElement.dataset.theme = 'light');
    const realRun = { id: receipt.latest_fem_run || receipt.femRun, workspace: receipt.workspace, study: receipt.latest_fem_run ? receipt.child_study : receipt.fem };
    for (const type of ['adaptive', 'jobs', 'comparison']) {
      await mount(type, realRun);
      if (type === 'adaptive') await page.locator('.field-scope').first().waitFor({ timeout: 30000 });
      if (type === 'jobs') await page.getByRole('table').first().waitFor({ timeout: 30000 });
      if (type === 'comparison') {
        if (receipt.iecRun) {
          const label = await page.evaluate(async ({ wid, rid }) => {
            const { savedRunLabel } = await import('/src/features/field/run-label.ts');
            const response = await fetch(`/api/hpc/workspaces/${wid}/fields/${rid}/view`);
            if (!response.ok) throw Error('IEC acceptance run unavailable');
            return savedRunLabel(await response.json());
          }, { wid: receipt.workspace, rid: receipt.iecRun });
          await page.getByRole('combobox', { name: 'IEC 参考运行' }).click();
          await page.getByRole('option', { name: label, exact: true }).click();
        }
        await page.getByRole('table', { name: '有限元与IEC量值对照' }).waitFor({ timeout: 60000 });
        await page.getByText('对照口径', { exact: true }).click();
        if (receipt.outer_boundary === 'kennelly_image') assert((await page.locator('.field-scope').last().innerText()).includes('Kennelly 镜像远场'));
      }
      await settle(page); checks.push({label:`real/${type}`, ...(await assertLayout(page, `real/${type}`))});
      if (type === 'adaptive') await page.screenshot({ path: path.join(output, 'adaptive.png') });
    }
    if (receipt.latest_fem_run) {
      const started = performance.now(); await mount('field', realRun);
      await page.locator('.field-canvas').waitFor({ timeout: 30000 });
      await page.waitForFunction(() => document.querySelector('.field-canvas')?.width > 0);
      const openMs = performance.now() - started;
      await page.getByText('显示已降采样，计算用全网格', { exact: true }).waitFor();
      if(receipt.outer_boundary === 'kennelly_image') { await page.getByText('超温',{exact:true}).waitFor(); await page.getByText(/保存正常温限 90.*最大超出 18.4/).waitFor(); }
      assert(openMs <= 3000, `large field opening ${openMs.toFixed(0)} ms exceeds 3 s`);
      const canvas = page.locator('.field-canvas'), box = await canvas.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      const scaleBefore = await page.locator('.field-scale path').getAttribute('d');
      const zoomStart = performance.now(); await page.mouse.wheel(0, -400);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const zoomMs = performance.now() - zoomStart;
      assert.notEqual(await page.locator('.field-scale path').getAttribute('d'), scaleBefore, 'wheel did not change field camera');
      await page.waitForTimeout(200);
      await page.waitForFunction(() => !document.querySelector('.field-probe')?.textContent.includes('读取全网格'));
      assert(!(await page.locator('.field-probe').textContent()).includes('失败'), 'full mesh probe failed');
      checks.push({label:'large field', ...(await assertLayout(page, 'large field'))});
      await page.evaluate(() => { window.fieldFrameGap = 0; let last = performance.now(); window.fieldFrameTimer = setInterval(() => { const now = performance.now(); window.fieldFrameGap = Math.max(window.fieldFrameGap, now-last); last=now; }, 50); });
      const downloadStart = performance.now(); const download = page.waitForEvent('download');
      await page.getByRole('link', { name: '导出全网格' }).click(); const file = await download;
      await file.saveAs(path.join(output, 'full-field.npz'));
      assert.equal(await file.failure(), null);
      const exportMs = performance.now()-downloadStart;
      const exportMaxEventLoopGapMs = await page.evaluate(() => { clearInterval(window.fieldFrameTimer); return window.fieldFrameGap; });
      assert(exportMaxEventLoopGapMs < 250, 'export blocked browser interaction');
      // Show the actual cable neighbourhood in the evidence, using ordinary pan/zoom.
      await canvas.dblclick();
      const hotspot = await page.locator('.field-hotspot circle').boundingBox();
      await page.mouse.move(hotspot.x + hotspot.width / 2, hotspot.y + hotspot.height / 2);
      await page.mouse.down(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 }); await page.mouse.up();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
      const centered = await page.locator('.field-hotspot circle').boundingBox();
      assert(Math.abs(centered.x + centered.width / 2 - box.x - box.width / 2) < 2 && Math.abs(centered.y + centered.height / 2 - box.y - box.height / 2) < 2, 'pan did not move the saved hotspot');
      for (let i = 0; i < 24; i++) { await page.mouse.wheel(0, -400); await page.waitForTimeout(30); }
      await page.mouse.move(20, 20); await settle(page); checks.push({label:'focused saved field', ...(await assertLayout(page, 'focused saved field'))});
      await page.screenshot({ path: path.join(output, 'large-field.png') });
      await fs.writeFile(path.join(output, 'performance.json'), JSON.stringify({ openMs, zoomMs, exportMs, exportMaxEventLoopGapMs }, null, 2));
    }
  }
  if (!realOnly) {
    state='empty'; await page.setViewportSize({width:1366,height:768});
    await page.evaluate(() => document.documentElement.dataset.theme='light'); await mount('setup'); await settle(page);
    await page.screenshot({path:path.join(output,'default-boundary.png')});
  }
  assert.deepEqual(errors, []); await fs.writeFile(path.join(output, realOnly ? 'real-checks.json' : 'checks.json'), JSON.stringify({ checks, limitChecks, boundaryChecks, submissions, continuations, cancellations, transitions, peakSamples, samples, errors }, null, 2));
  console.log(JSON.stringify({ checks: checks.length, submissions, continuations, cancellations, transitions, output }));
} finally { await browser.close(); }
