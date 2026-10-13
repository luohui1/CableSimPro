import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { openHeadlessBrowser, repositoryRoot } from './browser.mjs';
import { moduleDefinitions, moduleBehavior } from '../src/pages/study-modules.ts';
import { typeModules } from '../src/features/type/module-definitions.ts';
import { categories, identifyText, exceptionFor, whitelist, findingOwner, readOnlyPost } from './visible-text-policy.mjs';
import { installReadinessObserver, waitForPageReady } from './page-readiness.mjs';
import { performance as monotonicClock } from 'node:perf_hooks';

assert.equal(process.env.E2E_ISOLATED, '1', '文字巡检只能在隔离副本运行');
const base = process.env.FRONTEND_URL;
const performanceMode = process.env.PERFORMANCE_AUDIT === '1';
const requestedPhase = process.env.VISIBLE_TEXT_PASS;
if (requestedPhase && !/^[a-z-]+$/.test(requestedPhase)) throw Error('文字巡检输出名只能使用小写字母和连字符');
const phase = requestedPhase || (performanceMode ? 'performance-state' : process.env.REGULARITY_AUDIT === '1' && process.env.REGULARITY_WITH_VISIBLE !== '1' ? 'regularity-state' : 'after');
const out = path.join(repositoryRoot, '.data/fix-round/shared-shell/visible-text', phase);
await fs.mkdir(out, { recursive: true });
const session = await openHeadlessBrowser({ executable: 'C:/Program Files/Google/Chrome/Application/chrome.exe', routeGuard: !performanceMode });
const { page, context } = session;
const performanceAudit = performanceMode ? await (await import('./performance-audit.mjs')).createPerformanceAudit({ page, context, root: repositoryRoot, base }) : null;
if (!performanceMode) await installReadinessObserver(page);
const regularity = process.env.REGULARITY_AUDIT === '1' ? await (await import('./regularity-audit.mjs')).createRegularityAudit({ page, context, root: repositoryRoot }) : null;
const withVisibleText = process.env.REGULARITY_WITH_VISIBLE === '1';
const report = { phase, generated: new Date().toISOString(), source: '发布库只读备份；独立随机端口；不运行求解或批准提案', pages: [], findings: [], secondary: [], allowed: [], uncovered: [], errors: [], blockedWrites: [], readOnlyPosts: [], runChecks: [], whitelist, complete: false };
report.sourceDatabase = process.env.E2E_DATABASE_SOURCE || path.join(repositoryRoot, '.data/release/engineering.sqlite');
report.frontendSnapshot = process.env.E2E_FRONTEND_DIST || '当前前端构建';
const sizes = performanceMode ? [{ width: 1366, height: 768 }] : [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }];
const targets = [], queued = new Set(), issueKeys = new Set(), secondaryKeys = new Set(), shellHoverSizes = new Set(), sourceModules = new Map();
const requestedPaths = new Set((process.env.VISIBLE_TEXT_PATHS || '').split('|').filter(Boolean));
const modulesOnly = process.env.VISIBLE_TEXT_MODULES === '1';
report.scope = requestedPaths.size || modulesOnly ? 'targeted' : 'complete';
report.declaredModulesOnly = modulesOnly;
report.requestedPaths = [...requestedPaths];
const escaped = value => encodeURIComponent(value);
const studyOwner = module => ['thermal-field', 'transient', 'electrothermal', 'sheath-losses', 'simulation', 'batch'].includes(module) ? '仿真' : ['cable', 'section'].includes(module) ? '三维' : '研究';
function target(route, label, owner = '前端公共', extra = {}) {
  if (!queued.has(route)) { queued.add(route); targets.push({ route, label, owner, ...extra }); }
}
page.on('pageerror', error => report.errors.push({ page: page.url().replace(base, ''), error: error.message }));
// No audit action is permitted to start a run, create a session, or approve a proposal.
if (!performanceMode) await context.route('**/api/**', async route => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) {
    const pathname = new URL(route.request().url()).pathname, reason = route.request().method() === 'POST' && readOnlyPost(pathname);
    if (reason) { report.readOnlyPosts.push({ path: pathname, reason }); return route.fallback(); }
    report.blockedWrites.push({ path: new URL(route.request().url()).pathname, method: route.request().method() });
    return route.fulfill({ status: 403, json: { detail: '本次文字巡检只读，未执行计算或保存' } });
  }
  return route.fallback();
});
async function get(url) { const response = await fetch(base + url, { signal: AbortSignal.timeout(60000) }); if (!response.ok) throw Error(url + ': ' + response.status); return response.json(); }
async function all(kind) {
  const items = [];
  for (let offset = 0; offset < 5000; offset += 100) { const batch = await get(`/api/index/objects?kind=${kind}&limit=100&offset=${offset}`); items.push(...batch.items); if (items.length >= batch.total || !batch.items.length) return items; }
  throw Error('索引超过巡检上限，必须分页覆盖：' + kind);
}
async function settled() {
  const state = await waitForPageReady(page);
  await page.evaluate(() => document.fonts.ready);
  return state;
}

/** Read only painted viewport text; clipped scroll text is scanned at its later scroll position. */
async function entries(layer = 'ordinary') {
  return page.evaluate(layer => {
    const result = [];
    const selector = element => {
      const parts = []; let e = element;
      for (let n = 0; e && e !== document.body && n < 5; n++, e = e.parentElement) {
        if (e.id) { parts.unshift('#' + CSS.escape(e.id)); break; }
        const tag = e.tagName.toLowerCase();
        const siblings = e.parentElement ? [...e.parentElement.children].filter(s => s.tagName === e.tagName) : [];
        parts.unshift(tag + (siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(e) + 1})` : ''));
      }
      return parts.join(' > ');
    };
    const metadata = element => ({ selector: selector(element), agentAnswer: !!element.closest('.agent-answer,.agent-user-message,.agent-step-list'), field: !!element.closest('[data-field-page],.field-results,.hpc-job-list'), standard: !!element.closest('.basis-page,.standards-browser'), cad: !!element.closest('.type-page,.drawing-panel') });
    function visibleBox(element, original) {
      if (!element.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true })) return null;
      let left = Math.max(0, original.left), top = Math.max(0, original.top), right = Math.min(innerWidth, original.right), bottom = Math.min(innerHeight, original.bottom);
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const css = getComputedStyle(ancestor), r = ancestor.getBoundingClientRect();
        if (/(?:hidden|clip|auto|scroll)/.test(css.overflowX)) { left = Math.max(left, r.left); right = Math.min(right, r.right); }
        if (/(?:hidden|clip|auto|scroll)/.test(css.overflowY)) { top = Math.max(top, r.top); bottom = Math.min(bottom, r.bottom); }
      }
      return right > left && bottom > top ? { x: left, y: top, width: right - left, height: bottom - top } : null;
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode, e = node.parentElement, text = node.textContent.trim();
      if (!e || !text || e.closest('script,style,template,[hidden],option')) continue;
      const closed = e.closest('details:not([open])');
      if (closed && !closed.querySelector(':scope > summary')?.contains(e)) {
        if (!closed.parentElement.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true })) continue;
        result.push({ text, layer: 'folded', summary: closed.querySelector(':scope > summary')?.textContent.trim(), ...metadata(e), rect: null }); continue;
      }
      const range = document.createRange(); range.selectNodeContents(node);
      const rect = visibleBox(e, range.getBoundingClientRect());
      const panel = e.closest('[role="tabpanel"]'), tab = panel && document.getElementById(panel.getAttribute('aria-labelledby'));
      const actualLayer = /技术信息|追溯/.test(tab?.textContent || '') ? 'technical' : layer === 'technical' && !panel ? 'ordinary' : layer;
      if (rect) result.push({ text, layer: actualLayer, rect, ...metadata(e) });
    }
    for (const e of document.querySelectorAll('input:not([type=password]):not([type=hidden]),textarea,select,[title]')) {
      const rect = visibleBox(e, e.getBoundingClientRect()); if (!rect) continue;
      if (e.title) result.push({ text: e.title, layer: 'hover', rect, ...metadata(e) });
      if (e.matches('input,textarea,select')) {
        if (e.tagName === 'INPUT' && ['checkbox', 'radio', 'range', 'color', 'image'].includes(e.type)) continue; // The value is an attribute, not painted text.
        const text = e.tagName === 'SELECT' ? [...e.selectedOptions].map(o => o.textContent).join(' ') : e.type === 'file' ? [...(e.files || [])].map(f => f.name).join(' ') : e.value || e.placeholder;
        if (text) result.push({ text, layer, rect, ...metadata(e) });
      }
    }
    for (const e of document.querySelectorAll('img[alt]')) if (e.complete && !e.naturalWidth && e.alt) {
      const rect = visibleBox(e, e.getBoundingClientRect());
      if (rect) result.push({ text: e.alt, layer, rect, ...metadata(e) }); // Browser-painted fallback when an image fails.
    }
    return result;
  }, layer);
}
async function record(surface, size, layer = 'ordinary') {
  if (regularity) { await regularity.record(surface, size, layer); if (!withVisibleText) return; }
  for (const node of await entries(layer)) for (const match of identifyText(node.text)) {
    const hit = { page: surface.route, label: surface.label, ...size, text: node.text.slice(0, 1000), ...match, categoryLabel: categories[match.category], layer: node.layer, summary: node.summary, selector: node.selector, rect: node.rect, owner: findingOwner(surface, node) };
    const exception = exceptionFor(hit);
    const key = [surface.route, layer, node.layer, node.selector, node.text, match.category, match.token, size.width].join('|');
    if (exception) {
      if (secondaryKeys.has(key)) continue; secondaryKeys.add(key);
      (node.layer === 'ordinary' ? report.allowed : report.secondary).push({ ...hit, exception: exception.id, reason: exception.reason });
    } else {
      if (issueKeys.has(key)) continue; issueKeys.add(key);
      if (node.rect) {
        const name = createHash('sha256').update(key).digest('hex').slice(0, 12) + '.png';
        const margin = 16, x = Math.max(0, node.rect.x - margin), y = Math.max(0, node.rect.y - margin);
        await page.screenshot({ path: path.join(out, name), clip: { x, y, width: Math.min(size.width - x, node.rect.width + margin * 2), height: Math.min(size.height - y, node.rect.height + margin * 2) } });
        hit.screenshot = name;
      }
      report.findings.push(hit);
    }
  }
}
async function scan(surface, size, layer = 'ordinary') {
  if (regularity) await regularity.capture(surface, size);
  // Include independent main/inspector/table scroll panes, not only window scrolling.
  const panes = await page.evaluate(() => {
    const values = [];
    for (const e of [document.scrollingElement, ...document.querySelectorAll('body *')]) {
      if (!e || !e.checkVisibility({ checkVisibilityCSS: true }) || e.clientHeight < 50) continue;
      const css = getComputedStyle(e);
      const vertical = e.scrollHeight > e.clientHeight + 2 && (e === document.scrollingElement || /(auto|scroll)/.test(css.overflowY));
      const horizontal = e.scrollWidth > e.clientWidth + 2 && (e === document.scrollingElement || /(auto|scroll)/.test(css.overflowX));
      if (!vertical && !horizontal) continue;
      if (values.some(v => v.element === e)) continue;
      e.dataset.textAuditPane = String(values.length); values.push({ element: e, height: vertical ? e.scrollHeight : 1, client: e.clientHeight, width: horizontal ? e.scrollWidth : 1, clientWidth: e.clientWidth }); e.scrollTop = 0; e.scrollLeft = 0;
    }
    return values.map(({ element, ...value }, i) => ({ ...value, id: String(i) }));
  });
  await settled(); await record(surface, size, layer);
  for (const pane of panes) {
    for (let left = 0; left < pane.width; left += Math.max(1, pane.clientWidth * 0.8)) {
      await page.locator(`[data-text-audit-pane="${pane.id}"]`).evaluate((e, left) => { e.scrollLeft = left; e.scrollTop = 0; }, left); await settled(); await record(surface, size, layer);
      for (let top = Math.max(1, pane.client * 0.8); top < pane.height; top += Math.max(1, pane.client * 0.8)) {
        await page.locator(`[data-text-audit-pane="${pane.id}"]`).evaluate((e, top) => e.scrollTop = top, top); await settled(); await record(surface, size, layer);
      }
    }
    await page.locator(`[data-text-audit-pane="${pane.id}"]`).evaluate(e => { e.scrollTop = 0; e.scrollLeft = 0; });
    await settled();
  }
  // Radix tooltips are mounted on hover; titles above are counted without opening them.
  await page.evaluate(() => document.querySelectorAll('[data-text-audit-pane]').forEach(e => e.removeAttribute('data-text-audit-pane')));
  if (regularity && !withVisibleText) return;
  // Shared navigation is identical across routes; count its mounted tooltips once per viewport.
  const auditShell = !shellHoverSizes.has(size.width);
  const triggers = page.locator('[data-state="closed"]:not([aria-haspopup]):not([aria-expanded])');
  for (let i = 0; i < await triggers.count(); i++) {
    const trigger = triggers.nth(i); if (!await trigger.isVisible()) continue;
    if (!auditShell && await trigger.evaluate(e => !!e.closest('.workbench-sidebar'))) continue;
    await trigger.hover({ timeout: 1000 }).catch(() => {});
    await page.locator('[role="tooltip"]').first().waitFor({ state:'visible', timeout:1000 }).catch(() => {});
    const tooltipText = await page.locator('[role="tooltip"]').allTextContents();
    for (const text of tooltipText) for (const match of identifyText(text)) {
      const key = [surface.route, size.width, text, match.token, 'radix-hover'].join('|');
      if (!secondaryKeys.has(key)) { secondaryKeys.add(key); report.secondary.push({ page: surface.route, label: surface.label, ...size, text, ...match, categoryLabel: categories[match.category], layer: 'hover', owner: surface.owner, exception: 'hover', reason: whitelist[0].reason }); }
    }
    await page.mouse.move(1, 1);
  }
  shellHoverSizes.add(size.width);
}
async function save() {
  if (performanceAudit) { await performanceAudit.save(report); return; }
  if (regularity) { await regularity.save(report); if (!withVisibleText) return; }
  const ordinary = report.findings.length, counts = {};
  for (const hit of report.findings) counts[hit.owner] = (counts[hit.owner] || 0) + 1;
  const secondaryByLayer = {};
  for (const hit of report.secondary) secondaryByLayer[hit.layer] = (secondaryByLayer[hit.layer] || 0) + 1;
  report.counts = { ordinary, secondary: report.secondary.length, secondaryByLayer, whitelistedVisible: report.allowed.length, byOwner: counts };
  await fs.writeFile(path.join(out, 'audit.json'), JSON.stringify(report, null, 2));
  const cell = value => String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
  const rows = report.findings.map(h => `| ${cell(h.label)} (${h.width}) | ${cell(h.text)} | ${h.categoryLabel} | ${h.owner} | ${cell(h.selector)} | [定位](${h.screenshot}) |`);
  await fs.writeFile(path.join(out, 'findings.md'), `# 可见文字巡检\n\n完成：${report.complete}；普通界面 ${ordinary} 项；悬停/折叠/技术层 ${report.secondary.length} 项（允许但单独计数）；可见白名单 ${report.allowed.length} 项。\n\n扫描 ${report.pages.length} 个页面/视口；未覆盖 ${report.uncovered.length} 项。标识仅在巡检证据中保留，不改业务数据。\n\n| 页面 | 文字 | 类别 | 负责线程 | 位置 | 截图 |\n| --- | --- | --- | --- | --- | --- |\n${rows.join('\n')}\n\n## 白名单\n\n${whitelist.map(w => `- ${w.id}：${w.reason}`).join('\n')}\n\n## 未覆盖\n\n${report.uncovered.map(u => '- ' + cell(u.page || u.label) + (u.width ? ` (${u.width})` : '') + (u.owner ? ' · ' + u.owner : '') + '：' + cell(u.reason) + (u.screenshot ? ` [定位](${u.screenshot})` : '')).join('\n') || '无'}\n`);
}
try {
  const [spaces, types, studies, plugins, assets, cables, runs, deliveries, documents, validations, tasks] = await Promise.all([
    get('/api/workspaces'), get('/api/design/type-workspaces'), all('study'), all('plugin'), all('asset'), all('cable_version'), all('run'), all('delivery'), all('document'), all('validation'), all('agent_task'),
  ]);
  for (const [route, label, owner] of [['/', '首页'], ['/inbox', '待办'], ['/studies', '研究列表'], ['/studies?kind=ampacity', '载流量研究'], ['/studies?kind=simulation', '仿真研究'], ['/types', '型号列表', '三维'], ['/resources/cables', '型号版本'], ['/resources/cables/imports', '资料导入'], ['/resources/materials', '材料与部件'], ['/resources/templates', '模板与计算方案'], ['/resources/standards', '标准与规则', '标准'], ['/runs', '运行与作业'], ['/deliveries', '交付'], ['/plugins', '插件'], ['/validation', '验证算例', '仿真'], ['/agent', 'Agent']]) target(route, label, owner);
  for (const section of ['general', 'ai', 'data', 'report', 'about']) target('/settings?section=' + section, '设置 · ' + section);
  target('/settings/compute', '设置 · 计算位置');
  for (const w of spaces.filter(w => !types.some(t => t.id === w.id))) target('/studies?workspace=' + escaped(w.id), '工程 · ' + w.name, '研究');
  for (const study of studies.filter(s => !types.some(t => t.id === s.parent?.id))) target('/studies/' + escaped(study.id), '研究 · ' + study.name, '研究', { study: study.id, discover: true });
  // A driver's own module need not be another option in the analysis switcher.
  // Read its saved declaration as well; never infer applicability from the study title.
  for (const workspace of spaces.filter(w => !types.some(t => t.id === w.id))) for (const study of await get('/api/workspaces/' + escaped(workspace.id) + '/studies')) {
    const definition = study.definition || {};
    for (const module of new Set([definition.driver?.kind, ...Object.keys(definition.modules || {})])) if (moduleDefinitions[module] && !sourceModules.has(module)) {
      sourceModules.set(module, study.id);
      for (const tab of moduleDefinitions[module].tabs) target(`/studies/${escaped(study.id)}/${module}/${tab.id}`, '研究 · ' + moduleDefinitions[module].label + ' · ' + tab.label, studyOwner(module), { moduleDetail: true });
    }
  }
  for (const type of types) for (const module of typeModules) for (const [tab, title] of module.tabs) target(`/types/${escaped(type.id)}/${module.id}/${tab}`, `${type.name} · ${module.label} · ${title}`, '三维');
  const assetKinds = new Set();
  for (const card of assets) if (!assetKinds.has(card.subtype)) { assetKinds.add(card.subtype); const group = { installation: 'templates', study_template: 'templates', rule: 'standards' }[card.subtype] || 'materials'; target('/resources/' + group + '?item=' + escaped(card.id), '资源详情 · ' + card.name, group === 'standards' ? '标准' : '前端公共'); }
  if (!requestedPaths.size && !modulesOnly) for (const [kind, label] of [['material', '材料'], ['installation', '敷设模板'], ['study_template', '研究模板']]) if (!assetKinds.has(kind)) report.uncovered.push({ label: '资源详情 · ' + label, reason: '来源库无此类保存资源；分类列表已扫描，详情未造数据。' });
  for (const card of cables.slice(0, 2)) target('/resources/cables?item=' + escaped(card.id), '型号版本详情 · ' + card.name);
  for (const card of documents.slice(0, 2)) target('/resources/cables/imports?document=' + escaped(card.id), '原件详情 · ' + card.name);
  for (const card of plugins) target('/plugins/' + escaped(card.id), '插件详情 · ' + card.name, '前端公共', { tabs: true });
  const runKinds = new Set();
  for (const card of runs) if (!runKinds.has(card.parent?.id) && card.parent?.kind === 'study') { runKinds.add(card.parent.id); target('/studies/' + escaped(card.parent.id) + '?run=' + escaped(card.id), '保存运行 · ' + card.parent.name, '研究'); }
  for (const card of deliveries.slice(0, 3)) target('/deliveries?delivery=' + escaped(card.id), '交付详情 · ' + card.name);
  // A representative per catalogue family; the first-level list still exposes every row.
  const validationFamilies = new Set();
  for (const card of validations.filter(v => v.subtype === 'reproduced')) {
    const family = /CIGRE|IEC|GB\//i.test(card.name) ? '标准算例' : /COMSOL/i.test(card.name) ? 'COMSOL 算例' : /tutorial|teaching|benchmark/i.test(card.name) ? '教学基准' : '文献算例';
    if (validationFamilies.has(family)) continue; validationFamilies.add(family);
    for (const tab of ['results', 'overlay', 'convergence', 'sources', 'scope']) target('/validation/' + escaped(card.id) + '/' + tab, '验证详情 · ' + card.name + ' · ' + tab, '仿真');
  }
  for (const card of tasks.slice(0, 3)) target('/agent?task=' + escaped(card.id), 'Agent 任务 · ' + card.name);
  if (!requestedPaths.size && !modulesOnly) for (const [label, cards] of [['资源', assets], ['型号版本', cables], ['原件', documents], ['运行', runs], ['交付', deliveries], ['验证', validations], ['Agent 任务', tasks]]) if (!cards.length) report.uncovered.push({ label, reason: '隔离来源库无此类保存对象；仅检查空状态，未造数据。' });
  for (const route of requestedPaths) if (!queued.has(route)) {
    const url = new URL(route, base), parts = url.pathname.split('/'), [, kind, sid, module, tab] = parts;
    assert.ok(url.origin === new URL(base).origin && parts.length === 5 && kind === 'studies' && studies.some(s => s.id === decodeURIComponent(sid)) && moduleDefinitions[module]?.tabs.some(t => t.id === tab), '补查只能使用实际研究对象与登记模块/页签');
    target(route, '研究补查 · ' + moduleDefinitions[module].label + ' · ' + moduleDefinitions[module].tabs.find(t => t.id === tab).label, studyOwner(module));
  }
  const discoveredModules = new Set(sourceModules.keys()), surfaces = requestedPaths.size ? targets.filter(t => requestedPaths.has(t.route) || modulesOnly && t.moduleDetail) : modulesOnly ? targets.filter(t => t.moduleDetail) : targets;
  let fallbackQueued = false;
  if (requestedPaths.size) assert.equal(surfaces.filter(t => requestedPaths.has(t.route)).length, requestedPaths.size, '指定巡检页面必须都存在于实际覆盖清单');
  for (let i = 0; i < surfaces.length; i++) for (const size of sizes) {
    const surface = surfaces[i]; console.log(`${regularity && !withVisibleText ? '规整巡检' : '文字巡检'} ${i + 1}/${surfaces.length} ${size.width}：${surface.label}`);
    try {
      await page.setViewportSize(size);
      let readiness;
      if (performanceAudit) {
        await performanceAudit.measure(surface, 'cold');
        await performanceAudit.measure(surface, 'hot');
        if (surface.route === '/') {
          // Actually open the deferred editor; do not mistake a smaller bundle for working UI.
          const open = page.locator('.topbar-actions').getByRole('button', { name: '新建研究', exact: true });
          const started = monotonicClock.now();
          await open.click();
          await page.locator('.create-study-form').waitFor({ state: 'visible', timeout: 30000 });
          await waitForPageReady(page);
          assert.ok(await page.getByRole('dialog').locator('input').count(), '新建研究真实表单未出现');
          await page.keyboard.press('Escape');
          await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 5000 });
          assert.ok(await open.evaluate(e => e === document.activeElement), '首次关闭按需加载的研究表单后未恢复触发焦点');
          // Also exercise the retained dialog on its second opening.
          await page.keyboard.press('Enter');
          await page.locator('.create-study-form').waitFor({ state: 'visible', timeout: 30000 });
          await page.keyboard.press('Escape');
          await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 5000 });
          assert.ok(await open.evaluate(e => e === document.activeElement), '关闭新建研究后未恢复触发按钮焦点');
          const cards = studies.filter(s => s.parent?.kind === 'project');
          for (const w of spaces.filter(w => !types.some(t => t.id === w.id)).slice(0, 3)) {
            const row = page.locator(`.tree-object[href*="workspace=${escaped(w.id)}"]`);
            if (await row.count()) assert.equal(await row.locator('.tree-count').innerText(), String(cards.filter(s => s.parent.id === w.id).length), '侧栏计数必须与保存研究名片相符');
          }
          // Verify the display projection against real full saved definitions,
          // after measurement so these comparison reads cannot warm its requests.
          const definitions = (await Promise.all(spaces.map(w => get('/api/workspaces/' + escaped(w.id) + '/studies')))).flat().map(s => s.definition);
          const simulations = definitions.filter(d => {
            const capability = d.method.capability;
            if (capability === 'physics-comparison') return false;
            if (d.method_input?.schema_version === 'cablesim.simulation-problem/1') return true;
            if (d.method.plugin_id === 'cablesim.hybrid-rating') return false;
            return ['transient-temperature', 'sheath-losses', 'electrothermal-steady', 'thermal-field', 'iec-thermal-field', 'multiregion-thermal'].includes(capability) ||
              capability.includes('temperature-field') || d.driver.kind === 'batch';
          }).length;
          for (const [name, expected] of [['载流量计算', definitions.length - simulations], ['电缆仿真', simulations]]) {
            const domain = page.locator('.home-domains > div').filter({ has: page.getByText(name, { exact: true }) });
            assert.equal(await domain.locator('span.muted').innerText(), `${expected} 项研究`, '首页领域计数必须与完整保存定义一致');
          }
          performanceAudit.report.realUse = { deferredStudyEditor: '点击及 Enter 打开真实表单，Esc 关闭后焦点恢复；未保存或计算', sidebarCounts: '与发布库名片实际工程归属逐项对拍', homeCounts: { studies: definitions.length, simulation: simulations, ampacity: definitions.length - simulations }, elapsedMs: Math.round(monotonicClock.now() - started), passed: true };
        }
      } else {
        await page.goto(base + surface.route + (surface.route.includes('?') ? '&' : '?') + 'theme=light', { waitUntil: 'domcontentloaded', timeout: 60000 }); readiness = await settled();
      }
      if (surface.route === '/runs') {
        await page.getByText('正在读取方法与结论', { exact: true }).waitFor({ state: 'hidden', timeout: 30000 });
        const table = page.getByRole('table', { name: '运行', exact: true });
        if (await table.isVisible()) {
          const text = await table.innerText(), ratingRows = table.getByRole('row').filter({ hasText: '载流量表' });
          for (let row = 0; row < await ratingRows.count(); row++) assert.match((await ratingRows.nth(row).getByRole('cell').first().innerText()).replace(/\s+/g, ' '), /第 \d+ 次运行 · 载流量表$/, '载流量表所属的保存运行必须显示明确任务名');
          for (const type of types) assert.ok(!text.includes(type.name + ' · ' + type.name), '所属不得重复型号名');
          report.runChecks.push({ ...size, label: '真实发布库型号载流量表命名与归属去重', ratingRows: await ratingRows.count(), passed: true });
          if (performanceMode && await ratingRows.count()) {
            const count = await ratingRows.count();
            const name = (await ratingRows.first().getByRole('cell').first().innerText()).replace(/\s+/g, ' ');
            const search = page.getByPlaceholder('研究、型号或方法');
            await search.fill('载流量表');
            await page.waitForFunction(expected => {
              const table = document.querySelector('table[aria-label="运行"]');
              return table && table.querySelectorAll('tbody tr').length === expected &&
                ![...document.querySelectorAll('[role="status"]')].some(e => e.textContent === '正在读取方法与结论');
            }, count, { timeout: 30000 });
            assert.equal((await table.getByRole('row').filter({ hasText: '载流量表' }).first().getByRole('cell').first().innerText()).replace(/\s+/g, ' '), name, '筛选后型号范围内的运行编号不能变化');
            report.runChecks.push({ ...size, label: '真实检索载流量表后型号运行编号保留', name, passed: true });
            await search.fill('');
            await page.getByText('正在读取方法与结论', { exact: true }).waitFor({ state: 'hidden', timeout: 30000 });
          }
        }
        if (size.width === 1366) await page.screenshot({ path: path.join(out, 'runs-light.png') });
      }
      if (!performanceMode) await scan(surface, size);
      if (!requestedPaths.size && !modulesOnly && surface.discover && size.width === 1366) {
        const links = await page.locator(`a[href^="/studies/${surface.study}/"]`).evaluateAll(links => links.map(l => l.getAttribute('href')));
        links.push(page.url()); // The active analysis may be selected by a combobox, not an anchor.
        const analysis = page.getByRole('combobox', { name: '分析', exact: true });
        if (await analysis.isVisible()) {
          await analysis.click();
          const options = await page.getByRole('option').evaluateAll(items => items.filter(item => item.getAttribute('aria-disabled') !== 'true').map(item => item.textContent.replaceAll('✓', '').trim()));
          if (!performanceMode) await record({ ...surface, route: surface.route + '#analysis-menu' }, size);
          await page.keyboard.press('Escape');
          for (const name of options) {
            await page.getByRole('combobox', { name: '分析', exact: true }).click();
            await page.getByRole('option', { name, exact: true }).click(); await settled(); links.push(page.url());
          }
        }
        for (const link of links) {
          const url = new URL(link, base), [, , sid, module] = url.pathname.split('/');
          if (!moduleDefinitions[module] || discoveredModules.has(module)) continue;
          discoveredModules.add(module);
          for (const tab of moduleDefinitions[module].tabs) target(`/studies/${sid}/${module}/${tab.id}${url.search}`, '研究 · ' + moduleDefinitions[module].label + ' · ' + tab.label, studyOwner(module));
        }
      }
      if (surface.tabs) {
        const labels = await page.locator('.plugin-detail [role="tab"]').allTextContents();
        for (const label of labels) {
          const tab = { ...surface, route: surface.route + '#tab=' + escaped(label), label: surface.label + ' · ' + label };
          const click = () => page.locator('.plugin-detail [role="tab"]').filter({ hasText: label }).click();
          if (performanceAudit) {
            if (label === labels[0] && labels.length > 1) { await page.locator('.plugin-detail [role="tab"]').filter({ hasText: labels[1] }).click(); await settled(); }
            await performanceAudit.measure(tab, 'cold', click);
            const other = labels.find(l => l !== label);
            if (other) { await page.locator('.plugin-detail [role="tab"]').filter({ hasText: other }).click(); await settled(); }
            await performanceAudit.measure(tab, 'hot', click);
          } else {
            await click(); await settled(); await scan(tab, size, /技术|追溯/.test(label) ? 'technical' : 'ordinary');
          }
          report.pages.push({ ...tab, ...size });
        }
      }
      report.pages.push({ ...surface, actualUrl: page.url().replace(base, ''), readiness, ...size });
    } catch (error) {
      const screenshot = 'uncovered-' + createHash('sha256').update(surface.route + size.width).digest('hex').slice(0, 12) + '.png';
      await page.screenshot({ path: path.join(out, screenshot) }).catch(() => {});
      report.uncovered.push({ page: surface.route, label: surface.label, owner: surface.owner, ...size, reason: error.message, screenshot });
      if (page.isClosed() || !session.browser.isConnected()) throw Error('浏览器会话退出，停止该批巡检；未访问的页面不能计为通过。' + error.message);
      if (performanceMode && surface.route === '/') throw error; // Stop if the changed real creation flow fails.
      // Record the visible error/loading words, while keeping readiness coverage explicitly failed.
      if (!performanceMode) await record(surface, size).catch(() => {});
    }
    if (!requestedPaths.size && !modulesOnly && !fallbackQueued && i === surfaces.length - 1 && size.width === sizes.at(-1).width) {
      fallbackQueued = true;
      const sample = studies.find(s => !types.some(t => t.id === s.parent?.id));
      for (const [module, spec] of Object.entries(moduleDefinitions)) if (!discoveredModules.has(module)) {
        const input = moduleBehavior.input.has(module);
        if (!input || !sample) report.uncovered.push({ label: '研究 · ' + spec.label, reason: sample ? '来源库没有该模块的适用保存配置；另扫描该模块空/不适用态，不声称结果态已覆盖。' : '来源库无研究对象，未造数据。' });
        if (sample) for (const tab of spec.tabs) target(`/studies/${escaped(sample.id)}/${module}/${tab.id}`, '研究 · ' + spec.label + ' · ' + tab.label + (input ? '（输入详情）' : '（空/不适用态）'), studyOwner(module), { emptyModule: !input });
      }
    }
    await save();
  }
  if (regularity && process.env.REGULARITY_PUBLIC_LAYOUT === '1') {
    const { assertLayout } = await import('./layout-assertions.mjs');
    const material = assets.find(card => card.subtype === 'material');
    const materialRoute = material ? '/resources/materials?item=' + escaped(material.id) : null;
    const routes = ['/', '/runs', '/settings?section=ai', '/settings/compute', '/plugins', '/resources/materials', '/agent', ...(materialRoute ? [materialRoute] : [])];
    for (const route of routes) for (const size of sizes) for (const theme of ['light', 'dark']) {
      const check = { route, ...size, theme, passed: false };
      try {
        await page.setViewportSize(size);
        await page.goto(base + (route === materialRoute ? '/resources/materials' : route) + (route !== materialRoute && route.includes('?') ? '&' : '?') + 'theme=' + theme, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await settled();
        if (route === materialRoute) {
          // Open the real saved material from its catalogue, rather than constructing a demo strip.
          await page.locator(`tr[id$="-${material.id}"]`).click();
          await settled();
          const strip = page.getByRole('region', { name: '已登记物性覆盖', exact: true });
          await strip.waitFor({ state: 'visible', timeout: 30000 });
          const parts = await strip.locator('[data-conclusion-part]').evaluateAll(elements => elements.map(element => {
            const style = getComputedStyle(element), box = element.getBoundingClientRect();
            return { part: element.dataset.conclusionPart, text: element.innerText, font: parseFloat(style.fontSize), weight: Number(style.fontWeight), numeric: style.fontVariantNumeric, align: style.textAlign,
              inFirstScreen: box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth };
          }));
          assert.ok(parts.some(part => part.part === 'sentence' && part.text), '真实物性结论未出现');
          for (const part of parts) {
            assert.equal(part.font, { sentence: 14, value: 20, unit: 13, label: 13 }[part.part]);
            assert.equal(part.weight, ['sentence', 'value'].includes(part.part) ? 600 : 400);
            if (part.part === 'value') { assert.match(part.numeric, /tabular-nums/); assert.equal(part.align, 'right'); assert.ok(part.inFirstScreen, '材料关键数必须在详情首屏可见'); }
          }
          check.realUse = { action: '从材料列表点开真实保存资源，核对结论句与关键数字号、字重、数字对齐', parts };
        }
        if (await page.locator('html').getAttribute('data-theme') !== theme) {
          await page.locator('.sidebar-foot').getByRole('button').click();
          await page.getByRole('menuitem', { name: theme === 'dark' ? '切换深色模式' : '切换浅色模式', exact: true }).click();
        }
        assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
        if (route === materialRoute) {
          await scan({ route, label: '材料详情 · ' + material.name, owner: '前端公共' }, size);
          if (size.width === 1366 && theme === 'light') await page.screenshot({ path: path.join(regularity.out, 'material-conclusion-light.png') });
        }
        await assertLayout(page, `${route} ${size.width} ${theme}`);
        check.passed = true;
      } catch (error) {
        check.error = error.message;
        check.screenshot = 'appearance-' + createHash('sha256').update(route + size.width + theme).digest('hex').slice(0, 12) + '.png';
        await page.screenshot({ path: path.join(regularity.out, check.screenshot) }).catch(() => {});
        process.exitCode = 1;
      }
      regularity.report.appearanceChecks.push(check);
      console.log('公共页面外观：' + JSON.stringify(check));
    }
  }
  report.complete = true; await save();
  if (performanceAudit) {
    console.log(JSON.stringify(performanceAudit.report.counts));
    if (performanceAudit.report.pages.some(p => !p.mainPassed || p.framePassed === false || p.blockedWrites.length)) process.exitCode = 1;
  }
  if (regularity) { await regularity.overview(); console.log(JSON.stringify({ pages: report.pages.length, ...regularity.report.counts, uncovered: report.uncovered.length, errors: report.errors.length })); }
  console.log(JSON.stringify({ pages: report.pages.length, ...report.counts, uncovered: report.uncovered.length, errors: report.errors.length }));
  const strict = process.env.VISIBLE_TEXT_STRICT || 'all';
  if (report.errors.length || report.blockedWrites.length || report.uncovered.some(u => u.page) || report.findings.some(h => strict === 'all' || h.owner === '前端公共')) process.exitCode = 1;
  if (regularity?.report.findings.length) process.exitCode = 1;
} catch (error) { report.failure = error.stack; process.exitCode = 1; await save(); console.error(error); }
finally { await session.close(); }
