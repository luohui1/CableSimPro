import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect as expectBase } from '@playwright/test';
import { openHeadlessBrowser, settle, repositoryRoot } from './browser.mjs';
import { assertLayout } from './layout-assertions.mjs';

const base = process.env.FRONTEND_URL;
const mode = process.env.SHARED_MODE || 'pages';
const expect = expectBase.configure({ timeout: 30000 });
if (process.env.E2E_ISOLATED !== '1' && !(mode === 'pdf' && process.env.PDF_SOURCE)) throw Error('只允许隔离数据库验收；已有 PDF 文件预览不访问数据库');
const out = path.resolve(repositoryRoot, process.env.SHARED_OUTPUT || '.data/fix-round/shared-shell');
await fs.mkdir(out, { recursive: true });
const report = { mode, checks: [], variants: [], errors: [], writes: [] };
const session = await openHeadlessBrowser({ headed: mode === 'pdf', executable: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const { page, context } = session;
page.setDefaultTimeout(30000);
page.on('pageerror', error => report.errors.push(error.message));
page.on('request', request => { if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method())) report.writes.push(request.url()); });
async function get(route) { const reply = await fetch(base + route); assert.ok(reply.ok, route + ': ' + reply.status); return reply.json(); }
// 切换尺寸/主题会取消上一页的读取；已取消的延迟响应无需再写入。
async function fulfill(route, options) { try { await route.fulfill(options); } catch (error) { if (!/already handled|has been closed/i.test(error.message)) throw error; } }
async function go(route) { await page.goto('about:blank'); await page.goto(base + route); await settle(page); await expect(page.getByRole('region', { name: '正在打开', exact: true })).toHaveCount(0); }
async function shot(name) { await page.screenshot({ path: path.join(out, name + '.png') }); }
const sizes = [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }];
async function variants(route, label, check = () => {}) {
  for (const size of sizes) for (const theme of ['light', 'dark']) {
    await page.setViewportSize(size); await go(route + (route.includes('?') ? '&' : '?') + 'theme=' + theme);
    await check(); await assertLayout(page, label, { includeFrames: false }); await nameLayout(); report.variants.push({ label, ...size, theme });
  }
}
async function commandLayout() {
  const data = await page.locator('.adaptive-command-bar').evaluate(bar => {
    const bounds = bar.getBoundingClientRect();
    const children = [...bar.children].filter(node => !node.matches('[aria-hidden="true"]') && node.getBoundingClientRect().width);
    const boxes = children.map(node => node.getBoundingClientRect());
    return { width: bar.clientWidth, scroll: bar.scrollWidth, out: boxes.some(box => box.left < bounds.left - 1 || box.right > bounds.right + 1),
      overlap: boxes.some((a, i) => boxes.some((b, j) => i < j && Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1)),
      minFont: Math.min(...children.map(node => parseFloat(getComputedStyle(node).fontSize))) };
  });
  assert.equal(data.scroll <= data.width + 1, true, '命令栏横向滚动'); assert.equal(data.out, false, '按钮被裁'); assert.equal(data.overlap, false, '按钮重叠'); assert.ok(data.minFont >= 13);
}
async function nameLayout() {
  const broken = await page.locator('.sidebar-scroll .tree-object').evaluateAll(rows => rows.filter(row => {
    const label = row.querySelector('.tree-label');
    if (!label || !row.checkVisibility()) return false;
    const box = row.getBoundingClientRect(), text = label.getBoundingClientRect();
    return text.top < box.top - 1 || text.bottom > box.bottom + 1 || !row.getAttribute('title')
      || innerWidth >= 1920 && row.title.length <= 40 && label.scrollHeight > label.clientHeight + 1;
  }).map(row => row.title));
  assert.deepEqual(broken, [], '侧栏名称不得重叠，常见名称在 1920 下完整显示');
}
async function gallery() {
  assert.equal(process.env.E2E_DEV, '1', '陈列只在开发模式验收');
  for (const size of sizes) for (const theme of ['light', 'dark']) for (const state of ['empty', 'loading', 'error', 'success', 'historical']) {
    await page.setViewportSize(size); await go('/gallery?example=command-bar&theme=' + theme);
    await page.getByRole('combobox', { name: '页面状态', exact: true }).click();
    await page.getByRole('option', { name: { empty: '空', loading: '加载', error: '错误', success: '成功', historical: '历史结果' }[state], exact: true }).click();
    const bar = page.getByRole('toolbar', { name: '命令栏收纳示例', exact: true });
    await expect(bar.getByRole('button', { name: '保存修改', exact: true })).toBeVisible();
    await expect(bar.getByRole('button', { name: '生成计算书', exact: true })).toBeVisible();
    await commandLayout(); await nameLayout(); report.variants.push({ label: '命令栏 ' + state, ...size, theme });
    if (size.width === 1366) {
      await expect(bar.getByRole('button', { name: '更多操作', exact: true })).toBeVisible();
      await bar.getByRole('button', { name: '更多操作', exact: true }).click();
      await expect(page.getByRole('menuitem', { name: '重做', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
    }
  }
  await page.setViewportSize(sizes[0]); await go('/gallery?example=command-bar&theme=light');
  await expect(page.getByRole('toolbar', { name: '命令栏收纳示例', exact: true })).toBeVisible();
  await shot('command-bar-light');
  const bar = page.getByRole('toolbar', { name: '命令栏收纳示例', exact: true });
  await bar.getByRole('button', { name: '更多操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '重做', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible(); await page.keyboard.press('Escape');
  report.checks.push('命令栏两种尺寸、深浅主题、五态：固定主操作与保存、按优先级收纳、无滚动/遮挡、更多菜单可执行与 Esc 关闭');
}
async function pages() {
  await variants('/', '首页', async () => {
    await expect(page.getByRole('link', { name: '全部待办', exact: true })).toBeVisible();
    const link = await page.getByRole('link', { name: '全部待办', exact: true }).boundingBox();
    const section = await page.getByRole('region', { name: '需要处理', exact: true }).boundingBox();
    assert.ok(link.x >= section.x && link.x + link.width <= section.x + section.width + 1, '全部待办被裁');
  });
  await page.setViewportSize(sizes[0]); await go('/?theme=light');
  await expect(page.getByRole('table', { name: '继续工作', exact: true })).toBeVisible(); await shot('home-light');
  for (const [domain, task] of [['载流量计算', '额定载流量'], ['电缆仿真', '暂态温升']]) {
    await page.locator('.home-domains > div').filter({ has: page.getByRole('link', { name: new RegExp(domain) }) }).getByRole('button', { name: '新建研究', exact: true }).click();
    await expect(page.getByRole('combobox', { name: '研究任务', exact: true })).toContainText(task);
    await page.keyboard.press('Escape');
  }
  report.checks.push('首页全部待办完整可见；两个领域新建传入对应任务');
  const catalog = await get('/api/methods');
  assert.ok(catalog.length);
  const plugin = catalog.find(row => row.capabilities.some(cap => cap.solver === 'slurm')) || catalog[0];
  const pid = plugin.method.plugin_id;
  await variants('/plugins/' + pid, '插件能力', async () => {
    await page.getByRole('tab', { name: /^能力 / }).click();
    await expect(page.locator('.capability-list .solver-location').first()).toBeVisible();
  });
  await variants('/settings/compute', '计算位置');
  await variants('/runs', '运行记录');
  const unset = { configured: false, status: 'not_configured', connection_checked: false, remote_plugins: [], remote_capabilities: {}, configuration_file: '.data/hpc/config.json', configuration_note: '验收配置投影' };
  const localPid = catalog.find(row => row.capabilities.some(cap => !cap.solver || cap.solver === 'local'))?.method.plugin_id;
  assert.ok(localPid, '需本机能力验证配置冲突');
  for (const state of ['not-configured', 'loading', 'error', 'configured', 'invalid', 'conflict']) {
    let release;
    const gate = new Promise(resolve => release = resolve);
    await page.route('**/api/hpc/profile', async route => {
      if (state === 'loading') await gate;
      if (state === 'error') return fulfill(route, { status: 503, json: { detail: '验收读取失败' } });
      return fulfill(route, { json: ['configured', 'conflict'].includes(state) ? { ...unset, configured: true, status: 'configured', remote_plugins: [state === 'conflict' ? localPid : pid] } : state === 'invalid' ? { ...unset, status: 'invalid' } : unset });
    });
    try {
      for (const size of sizes) for (const theme of ['light', 'dark']) {
        await page.setViewportSize(size); await go('/settings/compute?theme=' + theme);
        if (state === 'error') { await expect(page.getByText('计算位置读取失败', { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: '重试', exact: true })).toBeVisible(); }
        else if (state === 'loading') await expect(page.getByText('读取配置中', { exact: true })).toBeVisible();
        else { await expect(page.getByRole('region', { name: '本机能力', exact: true })).toBeVisible(); await expect(page.getByRole('region', { name: '超算能力', exact: true })).toBeVisible(); }
        if (state === 'conflict') await expect(page.getByText('· 配置与能力声明冲突', { exact: true }).first()).toBeVisible();
        await assertLayout(page, '计算位置 ' + state, { includeFrames: false }); report.variants.push({ label: '计算位置 ' + state, ...size, theme });
      }
    } finally { release(); await page.unroute('**/api/hpc/profile'); }
  }
  await page.route('**/api/hpc/profile', route => fulfill(route, { status: 503, json: {} }));
  await go('/plugins/' + pid); await page.getByRole('tab', { name: /^能力 / }).click();
  await expect(page.locator('.capability-list').getByText(/配置读取失败/).first()).toBeVisible();
  await page.unroute('**/api/hpc/profile'); await page.locator('.capability-list').getByRole('button', { name: '重试', exact: true }).first().click();
  await expect(page.locator('.capability-list .solver-location').first()).not.toContainText('配置读取失败');
  report.checks.push('逐能力运行位置、配置读取失败重试、设置按能力分组计数；两种尺寸与深浅主题');
  await page.setViewportSize(sizes[0]); await go('/settings/compute?theme=light');
  await expect(page.getByRole('region', { name: '超算能力', exact: true })).toBeVisible(); await shot('compute-light');
  assert.deepEqual(report.writes, [], '公共只读验收不应写入或计算');
}
async function states() {
  for (const [route, kind, name] of [['/', 'study', '首页'], ['/runs', 'run', '运行记录']]) {
    const fixture = await get('/api/index/objects?kind=' + kind + '&limit=100');
    assert.ok(fixture.items.length, name + '成功与历史验收需真实保存对象');
    for (const state of ['empty', 'loading', 'error', 'success', 'historical']) {
      let release;
      const gate = new Promise(resolve => release = resolve);
      await page.route('**/api/index/objects?*', async request => {
        const requestedKind = new URL(request.request().url()).searchParams.get('kind');
        if (requestedKind !== kind && !(route === '/' && requestedKind === 'type')) return request.continue();
        if (state === 'loading') await gate;
        if (state === 'error') return request.fulfill({ status: 503, json: { detail: '记录暂时读取失败，请重试' } });
        const items = state === 'empty' || requestedKind !== kind ? [] : fixture.items.map(item => state === 'historical' ? { ...item, status: { code: 'historical', label: '历史' } } : item);
        return request.fulfill({ json: { items, total: items.length } }).catch(error => { if (!/already handled|has been closed/i.test(error.message)) throw error; });
      });
      try {
        for (const size of sizes) for (const theme of ['light', 'dark']) {
          await page.setViewportSize(size); await go(route + '?theme=' + theme);
          const region = page.getByRole('region', { name: route === '/' ? '继续工作' : '运行', exact: true });
          await expect(region).toBeVisible();
          if (state === 'loading') await expect(region.getByText(route === '/' ? '正在读取最近的研究与型号' : '正在读取运行', { exact: true })).toBeVisible();
          else if (state === 'error') await expect(region.getByRole('button', { name: '重新读取', exact: true })).toBeVisible();
          else if (state === 'empty') await expect(region.getByText(route === '/' ? '还没有研究或型号设计。' : '还没有运行。在研究或型号里预检并运行后会出现在这里。', { exact: true })).toBeVisible();
          else {
            await expect(region.getByRole('table')).toBeVisible();
            if (state === 'historical') await expect(region.getByText('历史', { exact: true }).first()).toBeVisible();
          }
          await assertLayout(page, name + ' ' + state, { includeFrames: false });
          report.variants.push({ label: name + ' ' + state, ...size, theme });
        }
      } finally { release(); await page.unroute('**/api/index/objects?*'); }
    }
  }
  report.checks.push('首页与运行列表两种尺寸、深浅主题、空/加载/错误/成功/历史自动断言；接口故障与状态投影仅浏览器注入，无数据库写入');
  await page.setViewportSize(sizes[0]); await go('/?theme=light'); await expect(page.locator('.home-domains').getByText('正在读取计数')).toHaveCount(0); await shot('home-light');
  await go('/runs?theme=light'); await expect(page.getByRole('table', { name: '运行', exact: true })).toBeVisible(); await expect(page.getByText('正在读取方法与结论', { exact: true })).toHaveCount(0); await shot('runs-light');
  assert.deepEqual(report.writes, []);
}
async function drawer() {
  const spaces = await get('/api/workspaces');
  let source;
  for (const workspace of spaces) {
    for (const study of await get('/api/workspaces/' + workspace.id + '/studies')) {
      if (study.definition?.method?.capability !== 'steady-rating' || study.definition?.driver?.kind !== 'single') continue;
      const endpoint = '/api/workspaces/' + workspace.id + '/studies/' + study.id + '/runs?view=summary';
      const reply = await get(endpoint);
      if (reply.items?.length) { source = { workspace, study, endpoint, reply }; break; }
    }
    if (source) break;
  }
  assert.ok(source, '发布备份缺运行，抽屉成功与历史未覆盖');
  const { workspace, study, endpoint, reply } = source;
  const match = url => url.pathname === endpoint.split('?')[0] && url.searchParams.get('view') === 'summary';
  for (const state of ['empty', 'loading', 'error', 'success', 'historical']) {
    let release;
    const gate = new Promise(resolve => release = resolve);
    await page.route(match, async route => {
      if (state === 'loading') await gate;
      if (state === 'error') return fulfill(route, { status: 503, json: { detail: '验收读取失败' } });
      const items = state === 'empty' ? [] : reply.items.map(run => state === 'historical' ? { ...run, freshness: 'historical' } : run);
      return fulfill(route, { json: { ...reply, items, total: items.length } });
    });
    try {
      for (const size of sizes) for (const theme of ['light', 'dark']) {
        await page.setViewportSize(size);
        await go('/studies/' + study.id + '/ampacity/results?workspace=' + workspace.id + '&theme=' + theme);
        await page.getByRole('button', { name: '运行记录', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: '运行记录', exact: true });
        await expect(dialog).toBeVisible();
        if (state === 'loading') await expect(dialog.getByText('正在读取运行记录', { exact: true })).toBeVisible();
        else if (state === 'error') await expect(dialog.getByRole('button', { name: '重新读取', exact: true })).toBeVisible();
        else if (state === 'empty') await expect(dialog.getByText('尚无运行记录', { exact: true })).toBeVisible();
        else await expect(dialog.getByRole('heading', { name: '对比两次运行', exact: true })).toBeVisible();
        const framing = await dialog.evaluate(node => {
          const box = node.getBoundingClientRect(), close = node.querySelector('.drawer-close')?.getBoundingClientRect();
          return { out: box.right > innerWidth + 1 || box.bottom > innerHeight + 1 || box.left < -1, width: box.width, close: !!close && close.top >= box.top && close.top < box.top + 64 && close.right <= box.right };
        });
        assert.equal(framing.out, false); assert.equal(framing.close, true); assert.ok(framing.width <= 600, '常规抽屉过宽');
        await assertLayout(page, '运行抽屉 ' + state, { includeFrames: false });
        report.variants.push({ label: '运行抽屉 ' + state, ...size, theme });
        if (state === 'success' && size.width === 1366 && theme === 'light') await shot('drawer-light');
        await dialog.locator('.drawer-close').click(); await expect(dialog).not.toBeVisible();
      }
    } finally { release(); await page.unroute(match); }
  }
  assert.deepEqual(report.writes, []);
  report.checks.push('运行抽屉两种尺寸、深浅主题与五态；标准右上关闭、内容宽度、比较入口，无写入');
}
async function inquiry() {
  const spaces = await get('/api/workspaces'), types = await get('/api/design/type-workspaces');
  const project = spaces.find(row => !types.some(type => type.id === row.id));
  assert.ok(project, '隔离发布库缺工程，问询保存流程未覆盖');
  const before = await get('/api/workspaces/' + project.id + '/studies');
  await page.setViewportSize(sizes[0]); await go('/studies?workspace=' + project.id);
  await page.locator('.sidebar-new').click(); await page.getByRole('menuitem', { name: '新建研究', exact: true }).click();
  await page.getByRole('combobox', { name: '研究任务', exact: true }).click();
  await page.getByRole('option', { name: '客户问询选型', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建问询', exact: true });
  await expect(dialog.getByRole('combobox', { name: '所属工程', exact: true })).toContainText(project.name);
  await dialog.locator('input[type=radio]').first().check();
  const current = dialog.getByLabel('目标电流', { exact: true });
  await current.fill('400'); await current.press('Tab');
  const name = dialog.getByLabel('研究名称', { exact: true });
  await expect(name).toHaveValue('400 A 客户问询');
  await name.fill(''); await expect(name).toHaveValue('');
  await name.fill('公共组件验收问询'); await expect(name).toHaveValue('公共组件验收问询');
  await dialog.getByRole('button', { name: '建立研究', exact: true }).click();
  const completion = page.getByRole('dialog', { name: '补录工程师给定参数', exact: true });
  await expect(completion).toBeVisible();
  await expect(completion.getByText('所属工程：' + project.name, { exact: true })).toBeVisible();
  await completion.getByRole('button', { name: '采用参考输入', exact: true }).click();
  await expect(completion.locator('.source-badge').filter({ hasText: '教学' }).first()).toBeVisible();
  for (const size of sizes) for (const theme of ['light', 'dark']) {
    await page.setViewportSize(size); await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await assertLayout(page, '问询所属工程与来源标记', { includeFrames: false });
    report.variants.push({ label: '问询所属工程与来源标记', ...size, theme });
    if (size.width === 1366 && theme === 'light') await shot('inquiry-light');
  }
  const created = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/api/workspaces/' + project.id + '/studies'));
  await completion.getByRole('button', { name: '保存并预检', exact: true }).click();
  const response = await created;
  assert.ok(response.ok(), '保存问询失败：' + await response.text());
  const saved = await response.json();
  assert.equal(saved.definition?.title, '公共组件验收问询');
  await expect(completion).not.toBeVisible();
  const after = await get('/api/workspaces/' + project.id + '/studies');
  assert.equal(after.length, before.length + 1);
  assert.ok(after.some(row => row.id === saved.id));
  assert.equal((await get('/api/workspaces')).length, spaces.length, '不能额外创建工程');
  await go('/');
  assert.deepEqual(report.writes, [base + '/api/workspaces/' + project.id + '/studies'], '只保存一次，不能发起新工程或求解请求');
  report.checks.push('问询默认当前工程，采用明示参考输入后真实保存到既有工程；仅隔离库新增一条研究，未创建额外工程、未求解；补录对话框两种尺寸与深浅主题');
}
async function pdf() {
  const spaces = process.env.PDF_SOURCE ? [] : await get('/api/workspaces');
  let selected;
  for (const workspace of spaces) {
    const books = await get('/api/workspaces/' + workspace.id + '/deliveries');
    const studies = await get('/api/workspaces/' + workspace.id + '/studies');
    for (const book of books.filter(book => book.kind !== 'specification')) {
      const detail = await get('/api/workspaces/' + workspace.id + '/deliveries/' + book.id);
      if (!/data-report-pdf="customer"/.test(detail.html)) continue;
      for (const study of studies) {
        const runs = (await get('/api/workspaces/' + workspace.id + '/studies/' + study.id + '/runs?view=summary')).items;
        const run = runs.find(run => detail.sources.some(source => source.run_id === run.id));
        if (run) { selected = { workspace, study, run, book: detail }; break; }
      }
      if (selected) break;
    }
    if (selected) break;
  }
  if (!selected) {
    const file = process.env.PDF_SOURCE || path.join(repositoryRoot, '.data/frontend-handoff/fem-report/customer.pdf');
    const bytes = await fs.readFile(file);
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    await page.setViewportSize(sizes[0]);
    await page.goto(pathToFileURL(file).href + '#page=1&zoom=90');
    await page.waitForTimeout(2500); await shot('pdf-preview-chrome');
    await page.goto('about:blank');
    await page.goto(pathToFileURL(file).href + '#page=4&zoom=90');
    await page.waitForTimeout(2500); await shot('pdf-diagram-chrome');
    const cdp = await session.browser.newBrowserCDPSession();
    const targets = (await cdp.send('Target.getTargets')).targetInfos;
    report.pdf = { source: file, bytes: bytes.length, headed: true, browser: await session.browser.version(), appPreview: '发布库无已封存 PDF，打开已有计算书文件核验阅读器', targets: targets.map(target => ({ type: target.type, url: target.url })) };
    assert.ok(targets.some(target => target.url.includes('mhjfbmdgcfjbbpaeojofohoefgiehjai')), 'Chrome PDF 阅读器未启动');
    report.checks.push('有界面 Chrome 打开已有 16 页有限元计算书，封面与图表页真机预览；发布库缺 PDF，应用内预览未覆盖');
    assert.deepEqual(report.writes, []); return;
  }
  const { workspace, study, run, book } = selected;
  await page.setViewportSize(sizes[0]);
  await go(`/studies/${study.id}/report/preview?workspace=${workspace.id}&run=${run.id}&delivery=${book.id}`);
  await expect(page.locator('iframe[title="计算书预览"]')).toHaveAttribute('src', /^blob:/);
  await page.waitForTimeout(1800);
  await shot('pdf-preview-chrome');
  const bytes = Buffer.from(book.html.match(/data-report-pdf="customer"[^>]*href="data:application\/pdf;base64,([^"]+)"/)[1], 'base64');
  await fs.writeFile(path.join(out, 'preview-customer.pdf'), bytes);
  const cdp = await session.browser.newBrowserCDPSession();
  const targets = (await cdp.send('Target.getTargets')).targetInfos;
  report.pdf = { workspace: workspace.id, study: study.id, run: run.id, delivery: book.id, bytes: bytes.length, headed: true, browser: await session.browser.version(), targets: targets.map(target => ({ type: target.type, url: target.url })) };
  assert.ok(targets.some(target => target.url.includes('mhjfbmdgcfjbbpaeojofohoefgiehjai') || target.url.includes('pdf')), 'Chrome PDF 阅读器未启动');
  report.checks.push('有界面 Chrome 打开发布库已生成计算书预览；源运行与交付固定，无新计算/写入');
  assert.deepEqual(report.writes, []);
}
try {
  await ({ pages, gallery, pdf, states, inquiry, drawer }[mode])();
  assert.deepEqual(report.errors, []);
} catch (error) { report.failure = { message: error.message, body: await page.locator('body').innerText().catch(() => '') }; await shot(mode + '-failure').catch(() => {}); throw error; }
finally { await fs.writeFile(path.join(out, mode + '-verification.json'), JSON.stringify(report, null, 2)); await session.close(); }
console.log(JSON.stringify({ checks: report.checks, variants: report.variants.length }, null, 2));
