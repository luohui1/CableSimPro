import { walkthrough } from './verify-workbench-support.mjs';

// Operate the real isolated application. API reads only corroborate what was
// selected or imported in the UI; no seed repair, mocked responses or API writes.
await walkthrough('resources', async ({ page, expect, base, api, choose, capture, step, check, size, tag }) => {
  const marker = `${tag}-${size.width}`.replace(/[^A-Za-z0-9_.:/-]/g, '-');
  const main = page.getByRole('main');
  const sidebar = page.getByRole('navigation', { name: '对象', exact: true });
  const properties = page.getByRole('complementary', { name: '所选对象属性', exact: true });
  const groupTitles = { materials: '材料与部件', templates: '模板与计算方案', standards: '标准与规则' };
  const knownKindLabels = { material: '材料', component: '部件', assembly: '结构', installation: '敷设模板', study_template: '计算方案', rule: '规则' };
  const knownStatuses = { draft: '草稿', reviewed: '已审核', published: '已发布', deprecated: '已停用' };

  async function branch(label, action) {
    try { return await step(label, action); }
    catch (error) {
      if (process.env.WORKBENCH_PHASE !== 'before') throw error;
      // step already saved the blocked screen and error. Continue an independent
      // catalog journey, but keep this failure for product/script triage.
      check(`${label}执行受阻`, false, { classification: '需根据截图区分产品卡点与脚本定位错误', error: error.message });
      await page.keyboard.press('Escape');
      const leave = dialog => dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss();
      page.on('dialog', leave);
      try { await page.goto(base + '/'); }
      finally { page.off('dialog', leave); }
      return undefined;
    }
  }

  async function openCableVersions() {
    await sidebar.getByRole('link', { name: '电缆型号版本', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: '电缆型号版本', exact: true })).toBeVisible();
    await expect(page.getByText('正在读取电缆型号版本', { exact: true })).toHaveCount(0);
  }

  async function openGroup(group) {
    await sidebar.getByRole('link', { name: groupTitles[group], exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/resources/${group}(?:\\?|$)`));
    await expect(page.getByRole('heading', { name: groupTitles[group], level: 1, exact: true })).toBeVisible();
    if (group === 'standards') await page.getByRole('tab', { name: '资源版本', exact: true }).click();
    await expect(page.getByText('正在读取资源', { exact: true })).toHaveCount(0);
    await expect(page.locator('.topbar-actions').getByRole('button', { name: '导入资源草稿', exact: true })).toBeVisible();
    // Category pages share the same component. Reset any retained filters using
    // the visible controls before beginning the next category's walkthrough.
    const search = main.getByRole('textbox', { name: '检索', exact: true });
    if (await search.isVisible()) await search.clear();
    if (await main.getByRole('combobox', { name: '状态', exact: true }).isVisible()) await choose('状态', '全部');
    if (await main.getByRole('combobox', { name: '类别', exact: true }).isVisible()) await choose('类别', '全部');
    await expect(page.getByText('正在读取资源', { exact: true })).toHaveCount(0);
  }

  async function inspectSelectedResource(name) {
    await expect(properties).toBeVisible();
    await expect(properties.getByRole('heading', { name, exact: true })).toBeVisible();
    const id = new URL(page.url()).searchParams.get('item');
    await check('选中资源有可重新打开的地址', !!id, { name, url: page.url() });
    if (!id) return null;
    const saved = await api(`/api/foundation/assets/${encodeURIComponent(id)}`);
    await check('资源详情对应选中的真实版本', saved.name === name && !!saved.content_sha256 && Number.isInteger(saved.revision), {
      name, status: saved.status, version: saved.version, revision: saved.revision,
    });
    await expect(properties).toContainText(knownStatuses[saved.status] || saved.status);
    return saved;
  }

  async function searchResource(group, name) {
    const search = main.getByRole('textbox', { name: '检索', exact: true });
    await expect(search).toBeVisible();
    await search.fill(name);
    const table = main.getByRole('table', { name: groupTitles[group], exact: true });
    const row = table.getByRole('row', { name, exact: true }).first();
    await expect(row).toBeVisible();
    await row.focus();
    await row.press('Enter');
    return inspectSelectedResource(name);
  }

  async function emptySearch() {
    const search = main.getByRole('textbox', { name: '检索', exact: true });
    await search.fill(`不存在的资源-${marker}`);
    await expect(main.getByText('没有匹配的资源', { exact: true })).toBeVisible();
    const clear = main.getByRole('button', { name: /清除筛选|清空筛选|清空检索/ }).first();
    await check('资源筛选空状态提供恢复操作', await clear.isVisible(), '没有匹配记录时，应有清除筛选操作。');
    await capture('resource-search-empty');
    // Clearing the actual search input is the existing keyboard recovery path.
    if (await clear.isVisible()) await clear.click();
    else { await search.focus(); await search.press('Control+a'); await search.press('Backspace'); }
    await expect(search).toHaveValue('');
  }

  async function importResource(group, kind, parameters) {
    const name = `隔离验收-${knownKindLabels[kind]}-${marker}`;
    const release = {
      asset_id: `local.walkthrough.${kind}.${marker}`,
      version: '1.0.0', kind, name, parameters,
      dependencies: [], files: [], geometry_recipe: null,
      sources: [{
        kind: 'project_input', reviewed: false,
        reference: '隔离浏览器验收的工程师手工输入，仅验证资源版本操作；不是厂家数据、标准条款或工程推荐值。',
      }],
    };
    await page.locator('.topbar-actions').getByRole('button', { name: '导入资源草稿', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '导入资源草稿', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: '校验并导入', exact: true })).toBeDisabled();
    await capture(`${group}-import-empty`);
    // A file chosen by the engineer is the product's supported import path.
    // Bytes are supplied to the real file input, not to an API request.
    await dialog.locator('input[type=file]').setInputFiles({
      name: `${kind}-resource.json`, mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ schema_version: 'csp-asset/0.1', release }, null, 2)),
    });
    await expect(dialog.getByRole('textbox', { name: '定义内容', exact: true })).toHaveValue(JSON.stringify({ schema_version: 'csp-asset/0.1', release }, null, 2));
    await expect(dialog.getByRole('button', { name: '校验并导入', exact: true })).toBeEnabled();
    await capture(`${group}-import-review`);
    await dialog.getByRole('button', { name: '校验并导入', exact: true }).click();
    await expect(dialog).toBeHidden();
    const saved = await searchResource(group, name);
    await check('导入保留来源且只创建未发布草稿', !!saved && saved.status === 'draft'
      && saved.release.sources.every(source => source.reviewed === false)
      && JSON.stringify(saved.release.parameters) === JSON.stringify(parameters.map(parameter => ({ ...parameter, overridable: false }))),
    { name, status: saved?.status, sources: saved?.release.sources, parameters: saved?.release.parameters });
    const edit = properties.getByRole('button', { name: /编辑草稿|编辑资源|修改草稿/ }).first();
    const review = properties.getByRole('button', { name: /核对来源|核对并提交|审核资源|核对资源/ }).first();
    await check('导入的资源草稿可以从详情编辑', await edit.isVisible(), { name, detail: await properties.innerText() });
    await check('导入的资源有继续核对和发布的操作', await review.isVisible(), { name, detail: await properties.innerText() });
    await capture(`${group}-imported-draft`);
    return saved;
  }

  await branch('从首页打开电缆型号版本', async () => {
    await page.goto(base + '/');
    await openCableVersions();
    const table = main.getByRole('table', { name: '电缆型号版本', exact: true });
    const rows = table.locator('tbody tr.data-row');
    const models = await api('/api/domain-cable-models');
    await check('电缆型号版本可浏览真实目录', models.length > 0 && await rows.count() > 0, { savedModels: models.length, visibleRows: await rows.count() });
    if (await rows.count()) {
      await rows.first().focus();
      await rows.first().press('Enter');
      await expect(properties).toBeVisible();
      await expect(properties).toContainText('来源');
    }
    const search = main.getByRole('textbox', { name: /检索|查找型号|搜索/ }).or(main.getByRole('searchbox')).first();
    await check('电缆型号版本提供名称检索', await search.isVisible(), '目录目前只有来源筛选；型号数量多时不能按名称直接定位。');
    const selected = properties.getByRole('button', { name: /用于研究|用于载流量研究|基于此版本新建|建立型号草稿/ }).first();
    await check('型号资源详情给出工程或型号引用入口', await selected.isVisible(), '查看版本后应能带着准确版本进入研究或型号设计。');
    await capture('cable-versions');
  });

  await branch('按来源筛选型号版本', async () => {
    await openCableVersions();
    const origin = main.getByRole('combobox', { name: '来源', exact: true });
    if (await origin.isVisible()) {
      await origin.click();
      await expect(page.getByRole('listbox')).toBeVisible();
      // Radix's selected indicator is aria-hidden. Do not turn its textContent
      // ("全部✓") into a different accessible name and reopen a stale selection.
      const candidate = page.getByRole('option', { selected: false, disabled: false }).first();
      if (await candidate.count()) {
        await candidate.click();
        await expect(origin).not.toHaveText('全部');
        await expect(main.getByRole('table', { name: '电缆型号版本', exact: true })).toBeVisible();
        await capture('cable-source-filter');
        await choose('来源', '全部');
      } else await page.keyboard.press('Escape');
    }
  });

  await branch('核对厂家资料导入入口', async () => {
    await openCableVersions();
    await page.locator('.topbar-actions').getByRole('button', { name: '从厂家资料导入', exact: true }).click();
    await expect(page).toHaveURL(/\/resources\/cables\/imports(?:\?|$)/);
    await expect(page.getByRole('button', { name: '上传 PDF', exact: true })).toBeVisible();
    await capture('manufacturer-import');
    // Workbook import belongs to T3; record what the real UI accepts without
    // uploading fabricated manufacturer documents or invoking an OCR service.
    const formats = await page.getByLabel('上传 PDF 文件', { exact: true }).getAttribute('accept');
    await check('厂家结构表可从资源库导入', /xlsx|xls|csv/.test(formats || ''), { acceptedFormats: formats, owner: 'T3 数据导入接口与 T1 前端接线' });
  });

  for (const [group, kind, parameters] of [
    ['materials', 'material', [{ name: 'thermal_resistivity', quantity: { value: 1.2, unit: 'K.m/W', dimension: 'thermal_resistivity' } }]],
    ['templates', 'installation', [{ name: 'burial_depth', quantity: { value: 0.8, unit: 'm', dimension: 'length' } }]],
    ['standards', 'rule', [{ name: 'conductor_limit', quantity: { value: 90, unit: 'degC', dimension: 'absolute_temperature' } }]],
  ]) {
    await branch(`${groupTitles[group]}浏览与键盘选择`, async () => {
      await openGroup(group);
      const rows = main.getByRole('table', { name: groupTitles[group], exact: true }).locator('tbody tr.data-row');
      const create = page.locator('.topbar-actions').getByRole('button', { name: /新建资源|新建材料|新建模板|新建规则/ }).first();
      await check(`${groupTitles[group]}可以直接新建`, await create.isVisible(), '工程师应能填写名称、数值、单位和来源，无需了解资源 JSON。');
      if (await rows.count()) {
        const name = await rows.first().getAttribute('aria-label');
        await rows.first().focus();
        await rows.first().press('Enter');
        await inspectSelectedResource(name);
        if (await rows.count() > 1) {
          const nextName = await rows.nth(1).getAttribute('aria-label');
          await rows.first().focus();
          await rows.first().press('ArrowDown');
          await expect(rows.nth(1)).toBeFocused();
          await inspectSelectedResource(nextName);
        }
        await capture(`${group}-selected`);
      } else {
        await capture(`${group}-empty`);
        await check(`${groupTitles[group]}空状态可开始操作`, await page.locator('.topbar-actions').getByRole('button', { name: '导入资源草稿', exact: true }).isEnabled(), '空目录可以从可见的导入操作开始。');
      }
      const pages = await Promise.all((group === 'materials' ? ['material', 'component', 'assembly'] : group === 'templates' ? ['installation', 'study_template'] : ['rule'])
        .map(value => api(`/api/foundation/assets?kind=${value}&limit=50&offset=0`)));
      if (pages.some(value => value.total > value.items.length)) {
        const next = main.getByRole('button', { name: /下一页|加载更多|继续加载/ }).first();
        await check(`${groupTitles[group]}可以读取下一页`, await next.isVisible() && await next.isEnabled(), { total: pages.map(value => value.total), firstPage: pages.map(value => value.items.length) });
      }
    });

    await branch(`${groupTitles[group]}导入和草稿闭环`, async () => {
      await openGroup(group);
      const imported = await importResource(group, kind, parameters);
      if (!imported) return;
      await expect(main.getByRole('textbox', { name: '检索', exact: true })).toBeVisible();
      const category = main.getByRole('combobox', { name: '类别', exact: true });
      if (await category.isVisible()) await choose('类别', knownKindLabels[kind]);
      await choose('状态', '草稿');
      await expect(main.getByRole('row', { name: imported.name, exact: true })).toBeVisible();
      await capture(`${group}-filtered-draft`);
      await emptySearch();
      await choose('状态', '全部');
      if (await category.isVisible()) await choose('类别', '全部');
      const published = await api(`/api/foundation/assets?kind=${kind}&status=published&limit=50&offset=0`);
      if (published.items.length) {
        const current = published.items[0];
        await choose('状态', '已发布');
        const selected = await searchResource(group, current.name);
        await check(`${groupTitles[group]}已发布筛选对应真实版本`, selected?.status === 'published', { name: selected?.name, version: selected?.version, status: selected?.status });
        const derive = properties.getByRole('button', { name: /新建版本|派生新版本|建立新版本/ }).first();
        await check(`${groupTitles[group]}已发布版本可以改版`, await derive.isVisible(), { name: current.name, version: current.version });
        await capture(`${group}-published-version`);
      }
      const multiSelect = main.getByRole('table', { name: groupTitles[group], exact: true }).getByRole('checkbox');
      await check(`${groupTitles[group]}列表支持多选批量操作`, await multiSelect.count() > 0, '资源列表应能选择确切版本进行批量核对或导出。');
    });
  }

  await branch('浏览标准依据并检查搜索空态', async () => {
    await openGroup('standards');
    await page.getByRole('tab', { name: '依据浏览', exact: true }).click();
    const browser = page.locator('[data-page=standards-basis]');
    await expect(browser).toHaveAttribute('data-state', /success|error|empty/);
    const state = await browser.getAttribute('data-state');
    await check('标准依据能读取已有来源', state === 'success', { state, text: await browser.innerText() });
    if (state !== 'success') return;
    // The outer success state means the catalogue is loaded; the selected
    // table has its own request and may still be loading at this point.
    await expect(browser.getByRole('table', { name: '标准完整表格', exact: true })).toBeVisible();
    const cells = browser.getByRole('button', { name: /^查看依据：/ });
    await check('标准表格提供可选择的真实依据格', await cells.count() > 0);
    if (await cells.count()) {
      await cells.first().focus();
      await cells.first().press('Space');
      await expect(browser.getByLabel('选中格详情', { exact: true })).toBeVisible();
      await expect(browser.getByLabel('选中格详情', { exact: true })).toContainText('PDF 第');
      await capture('standard-source');
    }
    const search = browser.getByRole('textbox', { name: '按量或条款检索', exact: true });
    await search.fill(`没有此条款-${marker}`);
    await expect(browser.getByText('没有匹配的量或条款，请清空检索。', { exact: true })).toBeVisible();
    await check('标准检索空状态提供清除操作', await browser.getByRole('button', { name: /清除筛选|清空检索/ }).first().isVisible(), '空状态提示清空检索，应提供可直接执行的操作。');
    await capture('standard-search-empty');
    await search.clear();
    await expect(browser.getByRole('table', { name: '标准完整表格', exact: true })).toBeVisible();
  });
});
