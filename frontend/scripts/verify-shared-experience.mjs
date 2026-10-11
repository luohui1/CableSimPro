import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect as baseExpect } from '@playwright/test';
import { openHeadlessBrowser, settle, repositoryRoot } from './browser.mjs';
import { assertLayout, assertDropdownArrows } from './layout-assertions.mjs';
import { groupInbox } from '../src/lib/inbox-groups.ts';
import { runPresentation } from '../src/lib/run-presentation.ts';

assert.equal(process.env.E2E_ISOLATED, '1', '只允许隔离库验收');
assert.equal(process.env.E2E_DEV, '1', '本场景使用当前开发源码');
const base = process.env.FRONTEND_URL;
const out = path.join(repositoryRoot, '.data/fix-round/shared-shell/experience');
await fs.mkdir(out, { recursive: true });
const report = { checks: [], variants: [], errors: [], writes: [] };
const session = await openHeadlessBrowser({ executable: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const { page } = session;
const expect = baseExpect.configure({ timeout: 30000 });
page.setDefaultTimeout(30000);
page.on('pageerror', error => report.errors.push(error.message));
page.on('request', request => { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) report.writes.push({ method: request.method(), path: new URL(request.url()).pathname }); });
const sizes = [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }];
async function get(route) { const response = await fetch(base + route); assert.ok(response.ok, route + ': ' + response.status); return response.json(); }
async function fulfill(route, options) { try { await route.fulfill(options); } catch (error) { if (!/already handled|closed/i.test(error.message)) throw error; } }
async function go(route) { await page.goto('about:blank'); await page.goto(base + route); await settle(page); }
async function shot(name) { await page.screenshot({ path: path.join(out, name + '.png') }); }
async function shell(label) {
  await expect(page.locator('.brand-wordmark')).toHaveText('CableSimPro');
  await expect(page.locator('.brand-wordmark')).toBeVisible();
  const boxes = await page.locator('.workbench-sidebar').evaluate(sidebar => {
    const brand = sidebar.querySelector('.brand-wordmark').getBoundingClientRect();
    const button = sidebar.querySelector('.sidebar-collapse').getBoundingClientRect();
    const footer = sidebar.querySelector('.sidebar-foot').getBoundingClientRect();
    const nav = sidebar.querySelector('.sidebar-scroll').getBoundingClientRect();
    const container = sidebar.querySelector('.sidebar-scroll');
    const current = container.querySelector('.tree-row[aria-current="page"]') || container.querySelector('.module-item[aria-current="page"]');
    const active = current?.getBoundingClientRect();
    const text = [...container.querySelectorAll('.tree-label')].filter(node => node.checkVisibility()).map(node => node.getBoundingClientRect());
    return { brand: brand.right <= button.left + 1, footer: footer.bottom <= innerHeight && footer.top >= nav.bottom - 1, gutter: getComputedStyle(container).scrollbarGutter,
      activeVisible: !active || active.top >= nav.top - 1 && active.bottom <= nav.bottom + 1, textClear: text.every(box => box.right <= nav.left + container.clientWidth + 1) };
  });
  assert.equal(boxes.brand, true, label + ': 字标被遮挡'); assert.equal(boxes.footer, true, label + ': 用户菜单未固定'); assert.equal(boxes.gutter, 'stable');
  assert.equal(boxes.activeVisible, true, label + ': 当前项未滚入可见区域'); assert.equal(boxes.textClear, true, label + ': 滚动条压住名称');
  await assertLayout(page, label, { includeFrames: false });
}
async function matrix(route, label, check) {
  console.log('验收：' + label);
  for (const size of sizes) for (const theme of ['light', 'dark']) {
    await page.setViewportSize(size);
    for (let attempt = 0; ; attempt++) {
      try { await go(route + (route.includes('?') ? '&' : '?') + 'theme=' + theme); await check?.(); await shell(label); break; }
      catch (error) { if (attempt > 0 || !/Execution context was destroyed/.test(error.message)) throw error; }
    }
    report.variants.push({ label, ...size, theme });
  }
}

async function fiveStates() {
  const inbox = await get('/api/index/inbox');
  const catalog = await get('/api/methods'), pid = catalog[0].method.plugin_id;
  for (const area of ['inbox', 'relation', 'ai']) for (const state of ['empty', 'loading', 'error', 'success', 'historical']) {
    let release; const gate = new Promise(resolve => release = resolve);
    const endpoint = area === 'inbox' ? '**/api/index/inbox' : area === 'relation' ? '**/api/index/objects/plugin/*/relations' : '**/api/agent/settings';
    await page.route(endpoint, async route => {
      if (state === 'loading') await gate;
      if (state === 'error') return fulfill(route, { status: 503, json: { detail: '验收读取失败，可重试' } });
      if (area === 'inbox') return fulfill(route, { json: state === 'empty' ? { items: [], counts: { stale: 0, review: 0, missing: 0, running: 0 } } : { ...inbox, items: inbox.items.map(item => state === 'historical' ? { ...item, category: 'stale', object: { ...item.object, status: { code: 'historical', label: '历史' } } } : item) } });
      if (area === 'relation') return fulfill(route, { json: { uses: state === 'empty' ? [] : [{ role: 'standard', freshness: state === 'historical' ? 'outdated' : 'current', reason: state === 'historical' ? '保存引用的标准版本已变化' : '', target: { kind: 'asset', subtype: 'rule', id: 'standard-year', name: '试验标准', version: '2024.0.0', status: { code: 'current', label: '当前' } } }], used_by: [], unresolved: [] } });
      return fulfill(route, { json: { source: state === 'empty' ? 'none' : 'settings', base_url: state === 'empty' ? '' : 'https://example.invalid/v1', model: state === 'empty' ? '' : 'saved-model', has_key: state !== 'empty', key_hint: null, key_source: 'memory', key_storage: 'memory', configured: state !== 'empty', instructions: '', model_timeout_s: null, environment: { base_url: false, model: false, api_key: false } } });
    });
    try { await matrix(area === 'inbox' ? '/inbox' : area === 'relation' ? '/plugins/' + pid : '/settings?section=ai', area + ' ' + state, async () => {
      if (area === 'inbox') {
        if (state === 'empty') await expect(page.getByText('没有待办事项。', { exact: true })).toBeVisible();
        else if (state === 'loading') await expect(page.getByText('正在汇总待办', { exact: true })).toBeVisible();
        else if (state === 'error') await expect(page.getByRole('button', { name: '重新读取', exact: true })).toBeVisible();
        else { const group = page.locator('.inbox-group').first(); await expect(group).toBeVisible(); await group.locator('summary').click(); if (state === 'historical') await expect(group.getByText('历史', { exact: true }).first()).toBeVisible(); }
      } else if (area === 'relation') {
        await page.getByRole('tab', { name: '关联', exact: true }).click();
        if (state === 'loading') await expect(page.getByText('正在读取关联', { exact: true })).toBeVisible();
        else if (state === 'error') await expect(page.getByText('关联读取失败', { exact: true })).toBeVisible();
        else { const summary = page.locator('.relation-summary'); await expect(summary).toBeVisible(); await summary.click(); if (state === 'empty') await expect(page.getByText('没有引用其他对象', { exact: true })).toBeVisible(); if (state === 'historical') await expect(page.getByText('已变化', { exact: true })).toBeVisible(); }
      } else {
        if (state === 'loading') await expect(page.getByText('正在读取模型设置', { exact: true })).toBeVisible();
        else if (state === 'error') await expect(page.getByText('模型设置读取失败', { exact: true })).toBeVisible();
        else { await expect(page.locator('#ai-model')).toBeVisible(); if (state === 'empty') { await expect(page.getByText('模型未配置', { exact: true })).toBeVisible(); await expect(page.getByText('待配置', { exact: true })).toBeVisible(); await expect(page.getByText('已保存 · 下一条消息起生效', { exact: true })).toHaveCount(0); } if (state === 'historical') { await page.locator('#ai-model').fill('unsaved-model'); await expect(page.locator('.settings-connection')).toContainText('saved-model'); await expect(page.getByText('修改未保存', { exact: true })).toBeVisible(); } }
      }
      await expect(page.getByText('已保存输入保留，可稍后查看。', { exact: true })).toHaveCount(0);
    }); } finally { release(); await page.unroute(endpoint); }
  }
  report.checks.push('待办与关联的空/加载/错误/成功/历史；AI 的未配置/加载/错误/已保存/未保存编辑，历史接口未提供，核对旧保存配置仍可见；两尺寸、深浅主题、字号/对比度/越界/箭头/字标');
}

async function runsOnly() {
  await matrix('/runs', '运行结论摘要', async () => {
    const table = page.getByRole('table', { name: '运行', exact: true });
    await expect(table).toBeVisible(); await expect(page.getByText('正在读取方法与结论', { exact: true })).toHaveCount(0);
    await expect(table).not.toContainText('可用结论数');
    await expect(table).not.toContainText('不满足项数');
    await expect(table.getByRole('link', { name: '查看结果', exact: true }).first()).toBeVisible();
    await expect(table).toContainText('IEC 60287');
  });
  await page.setViewportSize(sizes[0]); await go('/runs?theme=light'); await expect(page.getByText('正在读取方法与结论', { exact: true })).toHaveCount(0); await shot('runs-light');
  report.checks.push('统计数不再作为工程结论；没有 headline 时提供查看结果入口；两尺寸深浅主题与字号/对比度断言');
  assert.deepEqual(report.writes, []);
}

try {
  if (process.env.SHARED_MODE === 'states') await fiveStates();
  else if (process.env.SHARED_MODE === 'runs') await runsOnly();
  else {
  if (process.env.SHARED_MODE !== 'controls') {
  const inbox = await get('/api/index/inbox');
  await matrix('/inbox', '待办实际数据', async () => {
    if (!inbox.items.length) return;
    await expect(page.locator('.inbox-group')).toHaveCount(groupInbox(inbox.items).length);
    const group = page.locator('.inbox-group').first();
    await expect(group).not.toHaveAttribute('open'); await group.locator('summary').press('Enter');
    await expect(group).toHaveAttribute('open', ''); await expect(group.locator('li a').first()).toBeVisible();
  });
  await page.setViewportSize(sizes[0]); await go('/inbox?theme=light');
  if (inbox.items.length) await expect(page.locator('.inbox-group').first()).toBeVisible(); await shot('inbox-light');
  const methodItems = Array.from({ length: 6 }, (_, i) => ({ category: 'stale', origin: 'study', title: '待重算研究 ' + (i + 1), reason: 'IEC 方法 1.1.1 → 1.1.2', object: { kind: 'study', id: 'group-study-' + i, name: '待重算研究 ' + (i + 1), status: { code: 'outdated', label: '已过期' } } }));
  await page.route('**/api/index/inbox', route => fulfill(route, { json: { items: methodItems, counts: { stale: 6, missing: 0, review: 0, running: 0 } } }));
  await matrix('/', '首页方法更新分组', async () => {
    const group = page.locator('.home-todo .inbox-group');
    await expect(group).toHaveCount(1); await expect(group.locator('summary')).toContainText('方法更新 · 6 项结果需重算');
    await group.locator('summary').press('Enter'); await expect(group.locator('li')).toHaveCount(6);
    await group.locator('summary').press('Enter'); await expect(group).not.toHaveAttribute('open');
  });
  await page.unroute('**/api/index/inbox');
  report.checks.push('同来源同原因的待办合组；首页六项方法更新一组；键盘展开后六个独立对象入口保留');

  const workspaces = await get('/api/workspaces');
  const studies = (await Promise.all(workspaces.map(async workspace => (await get('/api/workspaces/' + workspace.id + '/studies')).map(study => ({ ...study, workspace: workspace.id }))))).flat();
  await matrix('/', '首页实际计数', async () => {
    const counts = await page.evaluate(async rows => {
      const { rootModule } = await import('/src/lib/study-config.ts');
      const simulation = rows.filter(row => ['simulation', 'electrothermal', 'transient', 'sheath-losses', 'thermal-field', 'batch'].includes(rootModule(row.definition))).length;
      return { ampacity: rows.length - simulation, simulation };
    }, studies);
    report.counts = counts;
    await expect(page.locator('.home-domains > div').nth(0)).toContainText(counts.ampacity + ' 项研究');
    await expect(page.locator('.home-domains > div').nth(2)).toContainText(counts.simulation + ' 项研究');
  });
  await page.setViewportSize(sizes[0]); await go('/?theme=light'); await expect(page.locator('.home-domains').getByText('正在读取计数')).toHaveCount(0); await shot('home-light');
  for (const state of ['loading', 'error']) {
    let release; const gate = new Promise(resolve => release = resolve);
    await page.route('**/api/workspaces/*/studies', async route => { if (state === 'loading') await gate; return fulfill(route, { status: 503, json: { detail: '验收计数读取失败' } }); });
    try { await matrix('/', '首页计数 ' + state, async () => {
      await expect(page.locator('.home-domains').getByText(state === 'loading' ? '正在读取计数' : '计数读取失败', { exact: true })).toHaveCount(2);
      await expect(page.locator('.home-domains')).not.toContainText('0 项研究');
    }); } finally { release(); await page.unroute('**/api/workspaces/*/studies'); }
  }
  report.checks.push('发布库只读备份中核对首页分类数量；读取与错误不会伪装为零');

  await matrix('/settings/compute', '计算位置', async () => {
    await expect(page.getByRole('region', { name: '本机能力', exact: true })).toBeVisible();
    const versions = await page.locator('.settings-plugins small').evaluateAll(nodes => nodes.map(node => parseFloat(getComputedStyle(node).fontSize)));
    assert.ok(versions.length && versions.every(size => size >= 13));
    await expect(page.locator('.settings-content')).not.toContainText('宿主读取此超算配置文件');
  });
  await page.setViewportSize(sizes[0]); await go('/settings/compute?theme=light'); await expect(page.locator('.settings-plugins')).not.toHaveCount(0); await shot('compute-light');

  const runIndex = await get('/api/index/objects?kind=run&limit=50');
  const study = studies.find(study => runIndex.items.some(run => run.parent?.id === study.id));
  if (study) {
    const saved = await get(`/api/workspaces/${study.workspace}/studies/${study.id}/runs?view=summary&limit=100`);
    const run = saved.items.find(run => runIndex.items.some(card => card.id === run.id));
    report.runEvidence = run ? { name: runPresentation(run).name, method: runPresentation(run).method, conclusion: runPresentation(run).conclusion } : null;
  }
  await matrix('/runs', '运行摘要', async () => {
    await expect(page.getByRole('columnheader', { name: '结论摘要', exact: true })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: '方法', exact: true })).toBeVisible();
    if (report.runEvidence) await expect(page.getByRole('table', { name: '运行', exact: true })).toContainText(report.runEvidence.method);
  });
  await page.setViewportSize(sizes[0]); await go('/runs?theme=light'); await expect(page.getByRole('table', { name: '运行', exact: true })).toBeVisible(); await expect(page.getByText('正在读取方法与结论', { exact: true })).toHaveCount(0); await shot('runs-light');
  report.checks.push('运行名称、方法版本、结论摘要从实际保存运行读取；没有封存摘要时明确缺项');
  }

  const catalog = await get('/api/methods');
  const pid = catalog[0].method.plugin_id;
  await matrix('/plugins/' + pid, '关联摘要', async () => {
    await page.getByRole('tab', { name: '关联', exact: true }).click();
    const summary = page.locator('.relation-summary').first(); await summary.scrollIntoViewIfNeeded();
    await expect(summary).toBeVisible(); const panel = page.locator('.relation-panel').first();
    await expect(panel).not.toHaveAttribute('open'); await summary.press('Enter'); await expect(panel).toHaveAttribute('open', '');
  });
  await page.route('**/api/index/objects/plugin/*/relations', route => fulfill(route, { json: { uses: [{ role: 'standard', freshness: 'current', target: { kind: 'asset', id: 'standard-year', name: '试验标准', subtype: 'rule', version: '2024.0.0', status: { code: 'current', label: '当前' } } }], used_by: [], unresolved: [] } }));
  await go('/plugins/' + pid); await page.getByRole('tab', { name: '关联', exact: true }).click(); await page.locator('.relation-summary').first().scrollIntoViewIfNeeded(); await page.locator('.relation-summary').first().click();
  await expect(page.locator('.relation-panel')).toContainText('2024 版'); await expect(page.locator('.relation-panel')).not.toContainText('2024.0.0'); await page.unroute('**/api/index/objects/plugin/*/relations');
  report.checks.push('关联默认计数摘要、Enter 展开；标准年度版本只展示年度，软件修订号保持完整');

  const types = await get('/api/design/type-workspaces');
  if (types.length) {
    const shortType = types.find(type => /110/.test(type.name)) || types[0];
    await matrix('/types/' + shortType.id + '/short-circuit/results', '短路下拉箭头', async () => {
      await expect(page.locator('[data-type-page="short-circuit-results"]')).toBeVisible();
      await expect(page.locator('[data-type-page="short-circuit-results"]')).not.toHaveAttribute('data-type-state', 'loading');
      if (!await page.locator('.type-curve [data-select-arrow]').count()) {
        // 发布库可能只有缺项的短路工件。使用当前页面真正的图表容器 CSS，
        // 挂载真实共享 Select 测尺寸；夹具不生成或替代工程计算结果。
        await page.evaluate(async () => {
          const react = await import('/node_modules/.vite/deps/react.js');
          const reactDOM = await import('/node_modules/.vite/deps/react-dom_client.js');
          const createElement = react.createElement || react.default.createElement;
          const createRoot = reactDOM.createRoot || reactDOM.default.createRoot;
          const { Select } = await import('/src/components/ui/select.tsx');
          const target = document.createElement('section'); target.className = 'type-curve'; target.dataset.arrowFixture = 'true';
          document.querySelector('[data-type-page="short-circuit-results"]').prepend(target);
          createRoot(target).render(createElement(Select, { label: '下拉尺寸回归夹具', value: 'component', onChange() {}, options: [{ value: 'component', label: '组件选择' }, { value: 'sampling', label: '采样选择' }] }));
        });
        report.arrowFixture = '发布库该型号没有有效时间曲线；在原页面图表容器 CSS 下挂载真实共享 Select，只有交互夹具，不生成工程结果';
      }
      await expect(page.locator('.type-curve [data-select-arrow]')).not.toHaveCount(0); await assertDropdownArrows(page, '短路页');
      const trigger = page.locator('.type-curve .select-trigger').first(); await trigger.click(); await expect(page.getByRole('option').first()).toBeVisible(); await page.keyboard.press('Escape');
    });
  } else report.checks.push('隔离发布库无型号设计，短路页面未覆盖');

  let ai = { source: 'settings', base_url: 'https://example.invalid/v1', model: 'saved-model', has_key: true, key_hint: '1234', key_source: 'memory', key_storage: 'memory', configured: true, instructions: '', model_timeout_s: 30, environment: { base_url: false, model: false, api_key: false } };
  let failSave = false, saveCount = 0, saveGate;
  await page.route('**/api/agent/status', route => fulfill(route, { json: { configured: true, model: ai.model, tools: 8 } }));
  await page.route('**/api/agent/settings', async route => {
    if (route.request().method() === 'PUT') { saveCount++; if (saveGate) await saveGate; if (failSave) return fulfill(route, { status: 503, json: { detail: '保存失败，请重试' } }); ai = { ...ai, ...route.request().postDataJSON() }; }
    return fulfill(route, { json: ai });
  });
  await matrix('/settings?section=ai', 'AI 保存交互', async () => {
    await expect(page.getByText('已保存 · 下一条消息起生效', { exact: true })).toBeVisible();
    await expect(page.getByText('修改即时生效', { exact: true })).toHaveCount(0);
    await page.locator('#ai-model').fill('edited-model-' + saveCount);
    await expect(page.getByText('修改未保存', { exact: true })).toBeVisible();
    let finishSave; saveGate = new Promise(resolve => finishSave = resolve);
    const before = saveCount; await page.keyboard.press('Control+s');
    await expect(page.getByText('保存中', { exact: true })).toBeVisible(); await expect(page.locator('#ai-model')).toBeDisabled();
    await page.keyboard.press('Control+s'); assert.equal(saveCount, before + 1); finishSave(); saveGate = undefined;
    await expect(page.getByText('已保存 · 下一条消息起生效', { exact: true })).toBeVisible(); assert.equal(saveCount, before + 1);
    await page.locator('#ai-model').fill('discarded-model'); await page.getByRole('button', { name: '放弃修改', exact: true }).click();
    await expect(page.locator('#ai-model')).toHaveValue(ai.model);
    failSave = true; await page.locator('#ai-model').fill('retry-model-' + saveCount); await page.locator('#ai-model').press('Enter');
    await expect(page.getByText('保存失败，请重试', { exact: true })).toBeVisible(); await expect(page.locator('#ai-model')).toHaveValue('retry-model-' + (saveCount - 1));
    failSave = false; await page.getByRole('button', { name: '保存', exact: true }).click(); await expect(page.getByText('已保存 · 下一条消息起生效', { exact: true })).toBeVisible();
    await page.locator('#ai-timeout').fill('9'); await expect(page.getByText('取 10–180 之间的整数秒。', { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
    await page.locator('#ai-timeout').fill('30'); await page.locator('#ai-base').fill('ftp://example.invalid'); await expect(page.getByText('填写以 http:// 或 https:// 开头的完整服务地址。', { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '放弃修改', exact: true }).click(); await expect(page.locator('#ai-base')).toHaveValue(ai.base_url);
  });
  await page.setViewportSize(sizes[0]); await go('/settings?section=ai&theme=light'); await expect(page.locator('#ai-model')).toHaveValue(ai.model); await shot('ai-light');
  await page.unroute('**/api/agent/settings'); await page.unroute('**/api/agent/status');
  report.checks.push('AI 未保存/保存/放弃/保存失败保留/重试、Ctrl+S 与 Enter；连接测试未调用，保存由浏览器接口夹具接收');
  assert.ok(report.writes.every(write => write.method === 'PUT' && write.path === '/api/agent/settings'), '只允许被夹具接收的设置保存');
  }
  assert.deepEqual(report.errors, []);
} catch (error) { report.failure = { message: error.message, body: await page.locator('body').innerText().catch(() => '') }; throw error; }
finally { await fs.writeFile(path.join(out, process.env.SHARED_MODE === 'states' ? 'experience-states-verification.json' : process.env.SHARED_MODE ? process.env.SHARED_MODE + '-verification.json' : 'verification.json'), JSON.stringify(report, null, 2)); await session.close(); }
console.log(JSON.stringify({ checks: report.checks, counts: report.counts, variants: report.variants.length }, null, 2));
