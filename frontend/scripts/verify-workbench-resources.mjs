import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { walkthrough } from './verify-workbench-support.mjs';
import { walkResourceApplications } from '../src/features/library-import/resource-application-walk.mjs';

// Operate the real isolated application. API reads only corroborate what was
// selected or imported in the UI; no seed repair or mocked responses. The reused
// saved-input application walk separately records its isolated target setup.
await walkthrough('resources', async ({ page, expect, base, api, choose, capture, step, check, size, tag, out, report }) => {
  const after = report.phase === 'after';
  const marker = `${tag}-${size.width}`.replace(/[^A-Za-z0-9_.:/-]/g, '-');
  const main = page.getByRole('main');
  const sidebar = page.getByRole('navigation', { name: '对象', exact: true });
  const properties = page.getByRole('complementary', { name: '所选对象属性', exact: true });
  const groupTitles = { materials: '材料与部件', templates: '模板与计算方案', standards: '标准与规则' };
  const knownKindLabels = { material: '材料', component: '部件', assembly: '结构', installation: '敷设模板', study_template: '计算方案', rule: '规则' };
  const knownStatuses = { draft: '草稿', reviewed: '已审核', published: '已发布', deprecated: '已停用' };
  let referenceWorkspace;
  const fixedBindings = new Map();

  async function branch(label, action) {
    try { return await step(label, action); }
    catch (error) {
      // step already saved the blocked screen and error. Continue an independent
      // catalog journey, but keep this failure for product/script triage.
      check(`${label}执行受阻`, false, { classification: '需根据截图区分产品卡点与脚本定位错误', error: error.message }, { fatal: false });
      await page.keyboard.press('Escape');
      const leave = dialog => dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss();
      page.on('dialog', leave);
      try { await page.goto(base + '/'); }
      finally { page.off('dialog', leave); }
      return undefined;
    }
  }

  async function savedInputApplications() {
    // The imported T3 walk prepares separate blank/copy targets through existing
    // APIs and records that setup explicitly. Every new resource capture,
    // review, publication, adoption and undo below is a real visible UI action.
    const entryWrites = report.writes.length;
    const beforeEntry = referenceWorkspace ? await api('/api/workspaces/' + referenceWorkspace.id) : null;
    for (const group of ['materials', 'templates']) {
      await openGroup(group);
      const entry = main.getByRole('link', { name: '从保存输入建立与应用资源', exact: true });
      await expect(entry).toBeVisible();
      const entrySource = new URL(page.url());
      const expectedTheme = entrySource.searchParams.get('theme') || await page.locator('html').getAttribute('data-theme');
      check('应用入口沿用当前已显示主题', ['light', 'dark'].includes(expectedTheme),
        { group, source: page.url(), theme: expectedTheme });
      const href = await entry.getAttribute('href'), destination = new URL(href, page.url());
      check('应用入口链接保留主题且不携带目录选择', destination.origin === new URL(base).origin &&
        destination.pathname === '/resources/cables/structure-import' &&
        destination.searchParams.get('theme') === expectedTheme && !destination.searchParams.has('item'),
        { group, href, sourceItem: entrySource.searchParams.get('item'), theme: expectedTheme });
      await capture(group + '-saved-input-application-entry');
      if (size.width === 1366) { await entry.focus(); await entry.press('Enter'); }
      else await entry.click();
      await expect(page).toHaveURL(/\/resources\/cables\/structure-import(?:\?|$)/);
      const opened = new URL(page.url());
      check('实际应用入口保留主题且未带入旧资源', opened.searchParams.get('theme') === expectedTheme &&
        !opened.searchParams.has('item'), { group, url: page.url(), sourceItem: entrySource.searchParams.get('item'),
          input: size.width === 1366 ? 'keyboard' : 'mouse', theme: expectedTheme });
      const tab = page.getByRole('tab', { name: '部件与研究模板', exact: true });
      if (size.width === 1366) { await tab.focus(); await tab.press('Enter'); }
      else await tab.click();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('heading', { name: '从保存输入创建参考草稿', exact: true })).toBeVisible();
      await capture(group + '-saved-input-application-ready');
    }
    const afterEntry = beforeEntry ? await api('/api/workspaces/' + referenceWorkspace.id) : null;
    check('材料与模板入口只打开真实应用工作区，不代替选择或改写型号',
      report.writes.length === entryWrites && JSON.stringify(afterEntry) === JSON.stringify(beforeEntry),
      { writes: report.writes.slice(entryWrites), workspace: referenceWorkspace?.id ?? null });
    const afterAction = async (waiter, action) => {
      const [response] = await Promise.all([waiter, Promise.resolve().then(action)]);
      return response;
    };
    const select = async (label, option) => {
      if (size.width === 1920) { await choose(label, option); return; }
      const field = page.getByRole('combobox', { name: label, exact: true });
      await expect(field).toBeEnabled();
      await field.focus(); await expect(field).toBeFocused(); await field.press('Enter');
      const choices = page.getByRole('option');
      await expect(page.getByRole('option', { name: option, exact: true })).toBeVisible();
      await expect(page.locator('[role="option"]:focus')).toHaveCount(1);
      const index = await choices.evaluateAll((items, text) =>
        items.findIndex(item => item.textContent.replace(/✓/g, '').trim() === text), option);
      check('应用资源键盘选择包含真实目标', index >= 0, { label, option, index });
      await page.keyboard.press('Home'); await expect(choices.first()).toBeFocused();
      for (let i = 1; i <= index; i++) {
        await page.keyboard.press('ArrowDown'); await expect(choices.nth(i)).toBeFocused();
      }
      await page.keyboard.press('Enter');
      await expect(field).toHaveText(option); await expect(field).toBeFocused();
    };
    const responseIndex = [];
    const recordResponse = async (name, response, value) => {
      const raw = await response.body();
      const file = String(size.width) + '-' + name.replace(/[\/\\]/g, '-') + '-raw.json';
      await fs.writeFile(path.join(out, file), raw);
      const request = response.request(), headers = request.headers();
      const record = { name, endpoint: new URL(response.url()).pathname, method: request.method(),
        request: request.postDataJSON(), request_headers: Object.fromEntries(
          ['content-type', 'x-cablesim-actor'].filter(key => headers[key] !== undefined).map(key => [key, headers[key]])),
        status: response.status(), response: value,
        raw_response: { file, bytes: raw.length, sha256: createHash('sha256').update(raw).digest('hex') } };
      responseIndex.push(record);
      await fs.writeFile(path.join(out, String(size.width) + '-applications-visible-response-index.json'),
        JSON.stringify(responseIndex, null, 2));
    };
    const applicationReport = { checks: [] };
    const applicationCapture = async label => {
      await page.waitForFunction(() => [...document.querySelectorAll('.dialog-stage')]
        .every(stage => Number(getComputedStyle(stage).opacity) >= .999));
      const shot = await capture('saved-input-application-' + label);
      for (const dialog of await page.getByRole('dialog').all()) {
        await expect(dialog.locator('.dialog-title')).toBeInViewport({ ratio: 1 });
        for (const button of await dialog.locator('.dialog-actions button').all())
          await expect(button).toBeInViewport({ ratio: 1 });
      }
      return shot;
    };
    // The upstream helper records successful UI responses and API fixture
    // readback bodies. Observe failed page responses here before its status assertion can
    // throw; this observer never replaces a request, response or application state.
    const failedResponses = [], failedResponseTasks = [], observerErrors = [];
    const onFailedResponse = response => {
      const url = new URL(response.url());
      if (response.status() < 400 || url.origin !== new URL(base).origin || !url.pathname.startsWith('/api/')) return;
      const record = { sequence: failedResponses.length + 1, endpoint: url.pathname,
        query: url.search, status: response.status(), statusText: response.statusText() };
      failedResponses.push(record);
      const task = (async () => {
        let stage = 'request';
        try {
          const request = response.request(), requestHeaders = request.headers(), responseHeaders = response.headers();
          const safeHeaders = headers => Object.fromEntries(
            ['content-type', 'content-length', 'x-cablesim-actor'].filter(key => headers[key] !== undefined).map(key => [key, headers[key]]));
          const prefix = String(size.width) + '-applications-failed-http-' + String(record.sequence).padStart(3, '0');
          const requestBody = request.postDataBuffer();
          record.method = request.method();
          record.request_headers = safeHeaders(requestHeaders);
          record.response_headers = safeHeaders(responseHeaders);
          record.request_body = { available: requestBody !== null };
          if (requestBody !== null) {
            stage = 'write_request_body';
            const file = prefix + '-request.body';
            await fs.writeFile(path.join(out, file), requestBody);
            record.request_body = { available: true, file, bytes: requestBody.length,
              sha256: createHash('sha256').update(requestBody).digest('hex') };
          }
          stage = 'response_body';
          const raw = await response.body(), file = prefix + '-response.body';
          stage = 'write_response_body';
          await fs.writeFile(path.join(out, file), raw);
          record.raw_response = { file, bytes: raw.length, sha256: createHash('sha256').update(raw).digest('hex') };
        } catch (error) {
          record.observer_error = { stage, message: error instanceof Error ? error.message : String(error) };
          observerErrors.push(new Error('应用失败响应存证 ' + record.sequence + ' / ' + stage + ': ' + record.observer_error.message, { cause: error }));
        }
      })();
      failedResponseTasks.push(task);
    };
    let applicationError, applicationFailed = false;
    page.on('response', onFailedResponse);
    try {
      await walkResourceApplications({ page, base, viewport: size, out, expect,
        capture: applicationCapture, select, afterAction, recordResponse, report: applicationReport });
    } catch (error) {
      applicationFailed = true; applicationError = error;
    } finally {
      page.off('response', onFailedResponse);
      await Promise.all(failedResponseTasks);
      try {
        await fs.writeFile(path.join(out, String(size.width) + '-applications-failed-http-index.json'),
          JSON.stringify({ scope: 'Same-origin failed page API responses during the real saved-input application walk; API fixture evidence remains in the upstream setup and HTTP indexes.',
            responses: failedResponses, observerErrors: observerErrors.map(error => error.message) }, null, 2));
      } catch (error) {
        observerErrors.push(new Error('应用失败响应索引写盘: ' + (error instanceof Error ? error.message : String(error)), { cause: error }));
      }
    }
    if (observerErrors.length) {
      const errors = applicationFailed ? [applicationError, ...observerErrors] : observerErrors;
      throw new AggregateError(errors, errors.map(error => error instanceof Error ? error.message : String(error)).join('\n'));
    }
    if (applicationFailed) throw applicationError;
    const summaryFile = String(size.width) + '-applications-summary.json';
    const summary = JSON.parse(await fs.readFile(path.join(out, summaryFile), 'utf8'));
    const parts = summary.components.map(item => item.capture.evidence.selection.part).sort();
    check('三类真实部件完成捕获发布、目标字段采用与原型号界面撤销',
      JSON.stringify(parts) === JSON.stringify(['common_layer', 'conductor', 'core_layer']) &&
      summary.components.every(item => item.capture.asset.status === 'published' &&
        item.restored.revision === item.readback.revision + 1 &&
        JSON.stringify(item.restored.domain) === JSON.stringify(item.target_before.domain)),
      { summaryFile, parts, componentCount: summary.components.length });
    const study = summary.study;
    check('保存研究模板完成固定来源发布、明确映射采用与原研究入口回读，未自动运行',
      applicationReport.checks.length > 0 && !!study &&
      study.capture.asset.status === 'published' && study.adopted.value.run_started === false &&
      study.adopted.value.approval === 'not_granted' && study.automatic_run_requests.length === 0 &&
      study.opened_runs.items.length === 0 && study.opened_runs.next_cursor === null &&
      JSON.stringify(study.opened_target.domain) === JSON.stringify(study.target_before.domain) &&
      JSON.stringify(study.opened_study.definition) === JSON.stringify(study.saved.definition) &&
      summary.study_opening?.outcome === 'passed',
      { summaryFile, openedUrl: study?.opened_url, runRequests: study?.automatic_run_requests,
        source: study?.capture.evidence.source, setupIsFixtureOnly: true });
    report.resourceApplications ||= [];
    report.resourceApplications.push({ ...size, summaryFile, checks: applicationReport.checks,
      responseCount: responseIndex.length, setupIsFixtureOnly: true });
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
    const currentSearch = await search.evaluateAll(inputs => inputs[0]?.value || '');
    if (currentSearch) await search.clear();
    for (const label of ['状态', '类别']) {
      // An unfiltered empty catalogue removes its toolbar. Read the current
      // value without waiting for a disappearing element, and avoid clicking
      // an already-default control after the preceding reset emptied the list.
      const current = await main.getByRole('combobox', { name: label, exact: true })
        .evaluateAll(controls => controls[0]?.textContent?.trim() || '');
      if (current && current !== '全部') await choose(label, '全部');
    }
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

  async function searchResource(group, name, version) {
    const search = main.getByRole('textbox', { name: '检索', exact: true });
    await expect(search).toBeVisible();
    await search.fill(name);
    const table = main.getByRole('table', { name: groupTitles[group], exact: true });
    const matching = table.getByRole('row', { name, exact: true });
    const row = (version ? matching.filter({ has: page.getByRole('checkbox', { name: `选择资源 ${name} ${version}`, exact: true }) }) : matching).first();
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
    // Closing preserves the engineer's draft; explicitly begin this import empty.
    const definition = dialog.getByRole('textbox', { name: '定义内容', exact: true });
    await definition.fill('');
    await expect(definition).toHaveValue('');
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

  async function typedResource(group, kind, parameter) {
    await openGroup(group);
    await page.locator('.topbar-actions').getByRole('button', { name: '新建资源', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '新建资源', exact: true });
    await expect(dialog.getByRole('button', { name: '保存资源草稿', exact: true })).toBeDisabled();
    const name = `隔离验收-表单-${knownKindLabels[kind]}-${marker}`;
    await dialog.getByRole('textbox', { name: '资源名称', exact: true }).fill(name);
    await choose('资源类别', knownKindLabels[kind], dialog);
    await dialog.getByRole('textbox', { name: '版本号', exact: true }).fill('1.0.0');
    await dialog.getByRole('button', { name: '新增参数', exact: true }).click();
    await choose('参数 1', { thermal_resistivity: '热阻率', burial_depth: '埋深', conductor_limit: '导体温度上限' }[parameter.name], dialog);
    await dialog.getByRole('textbox', { name: '参数数值 1', exact: true }).fill(String(parameter.quantity.value));
    if (kind === 'installation') {
      await choose('单位 1', 'mm', dialog);
      await expect(dialog.getByRole('textbox', { name: '参数数值 1', exact: true })).toHaveValue(String(parameter.quantity.value * 1000));
      await choose('单位 1', 'm', dialog);
      await expect(dialog.getByRole('textbox', { name: '参数数值 1', exact: true })).toHaveValue(String(parameter.quantity.value));
      check('单位切换换算数值而不改变物理量', true, '埋深在 m 与 mm 间切换，再恢复原值。');
    }
    await choose('来源类别 1', '工程师填写', dialog);
    await dialog.getByRole('textbox', { name: '来源说明 1', exact: true }).fill('隔离浏览器验收手工输入，用于验证表单、单位和版本操作；不是厂家、标准或工程推荐数据。');
    await capture(`${group}-typed-definition`);
    await dialog.getByRole('button', { name: '保存资源草稿', exact: true }).click();
    await expect(dialog).toBeHidden();
    const saved = await inspectSelectedResource(name);
    check('表单真实保存名称、数量、单位和手工来源', saved.status === 'draft' && saved.revision === 1 && saved.kind === kind &&
      saved.release.parameters[0].name === parameter.name && saved.release.parameters[0].quantity.value === parameter.quantity.value &&
      saved.release.parameters[0].quantity.unit === parameter.quantity.unit && saved.release.sources[0].kind === 'project_input' && saved.release.sources[0].reviewed === false,
    { id: saved.id, status: saved.status, parameters: saved.release.parameters, sources: saved.release.sources });
    return saved;
  }

  async function verifyMaterialQuantity(spec) {
    // Read a fixed installed source record, then type/import its exact value in
    // the visible UI. These isolated drafts never become engineering inputs.
    const tablePath = '/api/library/resources/table?category=materials&table_id=' + encodeURIComponent(spec.table);
    const table = await api(tablePath), source = table.rows.find(row => row.id === spec.record);
    expect(source, '发布资料库须包含指定物性及完整出处').toBeTruthy();
    expect(source.quantity).toMatchObject({ key: spec.parameter, dimension: spec.dimension, unit: spec.sourceUnit });
    expect(Number.isFinite(source.value)).toBe(true);
    expect(source.source_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(source.record_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(source.citation.trim()).not.toBe('');
    const provenance = { record_id: source.id, source_sha256: source.source_sha256, record_sha256: source.record_sha256, conditions: source.conditions };
    const sources = [
      { kind: spec.sourceKind, reviewed: false, reference: source.citation + '; 原值: ' + source.value + '; 原单位: ' + source.quantity.unit },
      { kind: 'project_input', reviewed: false, reference: JSON.stringify(provenance) },
      ...(source.limitations || []).map(reference => ({ kind: 'project_input', reviewed: false, reference: '原资料适用限制：' + reference })),
      { kind: 'project_input', reviewed: false, reference: '隔离浏览器验收：仅将上列真实资料值手工录入独立参考草稿，保留原单位和条件；未核准用于工程，未应用到研究，不补齐其他物性。' },
    ];
    for (const item of sources) expect(item.reference.length, '原出处须完整落入来源栏，不能截短').toBeLessThanOrEqual(512);
    const beforeWorkspaces = await api('/api/workspaces'), writesBefore = report.writes.length, identities = new Set();
    (report.materialQuantitySources ||= []).push({ width: size.width, table: spec.table, release_digest: table.release_digest,
      data_sha256: table.data_sha256, record: source, intendedUse: 'reference_only', appliedToWorkspace: false });

    async function readDraft(name, unit) {
      const saved = await inspectSelectedResource(name);
      expect(saved.status).toBe('draft');
      expect(saved.reviewed_sha256).toBeNull();
      expect(saved.release.parameters).toEqual([{ name: spec.parameter,
        quantity: { value: source.value, unit, dimension: spec.dimension }, overridable: false }]);
      expect(saved.release.sources).toEqual(sources);
      const row = properties.locator('section').filter({ has: page.getByRole('heading', { name: '计算参数', exact: true }) })
        .locator('.property-row').filter({ has: page.getByText(spec.label, { exact: true }) });
      await expect(row).toHaveCount(1);
      await row.scrollIntoViewIfNeeded();
      await expect(row).toContainText(spec.displayUnit);
      return saved;
    }

    async function verifyOriginalSource(label) {
      const citation = properties.locator('.property-row').filter({ has: page.getByText('出处 1 · 待核对', { exact: true }) });
      await expect(citation).toContainText(sources[0].reference);
      const original = properties.locator('pre[data-source-reference="raw"][aria-label="出处 2 原文"]');
      const disclosure = original.locator('..'), summary = disclosure.locator(':scope > summary');
      await expect(summary).toHaveText('查看结构化出处原文');
      await expect(original).toBeHidden();
      await summary.scrollIntoViewIfNeeded();
      if (size.width === 1366) {
        await summary.focus(); await page.keyboard.press('Enter');
        await expect(original).toBeVisible();
        await page.keyboard.press('Tab'); await expect(original).toBeFocused();
      } else {
        await summary.click(); await expect(original).toBeVisible();
      }
      await expect(disclosure).toHaveAttribute('open', '');
      await original.scrollIntoViewIfNeeded();
      expect(await original.textContent(), '出处原文不经翻译、替换或截短').toBe(sources[1].reference);
      expect(JSON.parse(await original.textContent())).toEqual(provenance);
      const bounds = await original.evaluate(element => {
        const box = element.getBoundingClientRect(), css = getComputedStyle(element);
        let left = 0, top = 0, right = innerWidth, bottom = innerHeight;
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent), rect = parent.getBoundingClientRect();
          if (/(hidden|clip|auto|scroll)/.test(style.overflowX)) { left = Math.max(left, rect.left); right = Math.min(right, rect.right); }
          if (/(hidden|clip|auto|scroll)/.test(style.overflowY)) { top = Math.max(top, rect.top); bottom = Math.min(bottom, rect.bottom); }
        }
        return { width: box.width, height: box.height, fontSize: parseFloat(css.fontSize), whiteSpace: css.whiteSpace,
          scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight,
          fullyVisible: box.width > 0 && box.height > 0 && box.left >= left - 1 && box.right <= right + 1 && box.top >= top - 1 && box.bottom <= bottom + 1 };
      });
      const shot = await capture('material-quantity-' + spec.dimension + '-' + label + '-expanded-source');
      check('结构化出处原文完整可见且能以鼠标或键盘展开收起', bounds.fullyVisible && bounds.fontSize >= 13 && bounds.whiteSpace === 'pre-wrap'
        && bounds.scrollWidth <= bounds.clientWidth + 1 && bounds.scrollHeight <= bounds.clientHeight + 1,
      { dimension: spec.dimension, source: source.id, screenshot: shot.screenshot, interaction: size.width === 1366 ? 'keyboard' : 'mouse', bounds });
      expect(shot.layoutError, '明确原文层之外仍执行全部界面断言').toBeUndefined();
      if (size.width === 1366) {
        await expect(original).toBeFocused();
        await page.keyboard.press('Shift+Tab'); await expect(summary).toBeFocused();
        await page.keyboard.press('Enter');
      } else await summary.click();
      await expect(disclosure).not.toHaveAttribute('open', '');
      await expect(original).toBeHidden();
    }

    async function editAndReload(saved, unit, label) {
      await properties.getByRole('button', { name: '编辑资源草稿', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '编辑资源草稿', exact: true });
      await expect(dialog.getByRole('combobox', { name: '参数 1', exact: true })).toContainText(spec.label);
      const value = dialog.getByRole('textbox', { name: '参数数值 1', exact: true });
      await expect(value).toHaveValue(String(source.value));
      const units = dialog.getByRole('combobox', { name: '单位 1', exact: true });
      await expect(units).toContainText(spec.displayUnit);
      await units.focus(); await units.press('Enter');
      await expect(page.getByRole('option', { name: spec.displayUnit, exact: true })).toHaveCount(1);
      await page.keyboard.press('Escape');
      // A real keyboard edit changes only the draft name. The original unit
      // spelling, value, provenance and conditions must survive this PUT.
      const editedName = saved.name + '-编辑';
      await dialog.getByRole('textbox', { name: '资源名称', exact: true }).fill(editedName);
      await value.fill(String(source.value));
      await value.scrollIntoViewIfNeeded();
      await capture('material-quantity-' + spec.dimension + '-' + label + '-editor');
      await dialog.getByRole('button', { name: '保存资源草稿', exact: true }).click();
      await expect(dialog).toBeHidden();
      const edited = await readDraft(editedName, unit);
      expect(edited.id).toBe(saved.id);
      expect(edited.revision).toBe(saved.revision + 1);
      expect(edited.release.sources).toEqual(saved.release.sources);
      expect(edited.release.parameters).toEqual(saved.release.parameters);
      const readOnlyStart = report.writes.length;
      await page.reload({ waitUntil: 'domcontentloaded' });
      const loaded = await readDraft(editedName, unit);
      expect(loaded.id).toBe(edited.id);
      expect(loaded.revision).toBe(edited.revision);
      expect(loaded.content_sha256).toBe(edited.content_sha256);
      expect(loaded.release).toEqual(edited.release);
      expect(report.writes.slice(readOnlyStart)).toEqual([]);
      await verifyOriginalSource(label);
      expect(report.writes.slice(readOnlyStart)).toEqual([]);
      await capture('material-quantity-' + spec.dimension + '-' + label + '-reloaded');
      return loaded;
    }

    await openGroup('materials');
    await page.locator('.topbar-actions').getByRole('button', { name: '新建资源', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: '新建资源', exact: true });
    const name = '隔离验收-资料物性-' + spec.label + '-' + marker;
    await dialog.getByRole('textbox', { name: '资源名称', exact: true }).fill(name);
    await choose('资源类别', '材料', dialog);
    await dialog.getByRole('button', { name: '新增参数', exact: true }).click();
    await choose('参数 1', spec.label, dialog);
    const value = dialog.getByRole('textbox', { name: '参数数值 1', exact: true });
    await expect(value).toHaveValue('');
    await value.fill(String(source.value));
    await expect(dialog.getByRole('combobox', { name: '单位 1', exact: true })).toContainText(spec.displayUnit);
    for (const [index, item] of sources.entries()) {
      if (index) await dialog.getByRole('button', { name: '新增来源', exact: true }).click();
      await choose('来源类别 ' + (index + 1), { standard: '标准依据', literature: '文献资料', project_input: '工程师填写' }[item.kind], dialog);
      await dialog.getByRole('textbox', { name: '来源说明 ' + (index + 1), exact: true }).fill(item.reference);
    }
    await dialog.getByRole('button', { name: '保存资源草稿', exact: true }).click();
    await expect(dialog).toBeHidden();
    const typed = await readDraft(name, spec.unit);
    identities.add(typed.id);
    const typedReloaded = await editAndReload(typed, spec.unit, 'typed');

    // Import the same source into a separate, explicitly labelled draft using
    // its original unit spelling. Do not overwrite the typed draft or a seed.
    await openGroup('materials');
    const sourceName = '隔离验收-原文单位-' + spec.label + '-' + marker;
    const definition = { schema_version: 'csp-asset/0.1', release: {
      asset_id: 't1.quantity.source.' + spec.dimension + '.' + marker, version: '1.0.0', kind: 'material', name: sourceName,
      parameters: [{ name: spec.parameter, quantity: { value: source.value, unit: source.quantity.unit, dimension: spec.dimension }, overridable: false }],
      sources,
    } };
    const filename = path.join(out, 'material-quantity-' + spec.dimension + '-source-unit-' + size.width + '.json');
    await fs.writeFile(filename, JSON.stringify(definition, null, 2) + '\n');
    await page.locator('.topbar-actions').getByRole('button', { name: '导入资源草稿', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '导入资源草稿', exact: true });
    await dialog.locator('input[type=file]').setInputFiles(filename);
    await expect(dialog.getByRole('textbox', { name: '定义内容', exact: true })).toHaveValue(await fs.readFile(filename, 'utf8'));
    await dialog.getByRole('button', { name: '校验并导入', exact: true }).click();
    await expect(dialog).toBeHidden();
    const imported = await readDraft(sourceName, spec.sourceUnit);
    identities.add(imported.id);
    expect(imported.id).not.toBe(typed.id);
    const originalUnitReloaded = await editAndReload(imported, spec.sourceUnit, 'source-unit');
    expect(originalUnitReloaded.release.parameters[0].quantity.value).toBe(typedReloaded.release.parameters[0].quantity.value);
    expect(originalUnitReloaded.release.parameters[0].quantity.unit).toBe(source.quantity.unit);
    const sourceAfter = (await api(tablePath)).rows.find(row => row.id === source.id);
    expect(sourceAfter).toEqual(source);
    expect(await api('/api/workspaces')).toEqual(beforeWorkspaces);
    const writes = report.writes.slice(writesBefore);
    check('四类物性可用真实表单录入并保留原文单位来源且不改工程', writes.length === 4 && writes.every(write =>
      write.method === 'POST' && write.path === '/api/foundation/assets/import'
      || write.method === 'PUT' && [...identities].some(id => write.path === '/api/foundation/assets/' + id)),
    { dimension: spec.dimension, source: source.id, value: source.value, canonicalUnit: spec.unit, sourceUnit: spec.sourceUnit,
      typed: { id: typedReloaded.id, revision: typedReloaded.revision, content_sha256: typedReloaded.content_sha256 },
      imported: { id: originalUnitReloaded.id, revision: originalUnitReloaded.revision, content_sha256: originalUnitReloaded.content_sha256 },
      writes, sourceUnchanged: true, workspacesUnchanged: true });
  }

  async function transition(group, saved, action, label, standard) {
    await searchResource(group, saved.name, saved.version);
    const opener = properties.getByRole('button', { name: label, exact: true });
    await expect(opener).toBeEnabled();
    await opener.click();
    let dialog = page.getByRole('dialog', { name: label, exact: true });
    await expect(dialog.locator('[data-resource-state="ready"]')).toHaveCount(1);
    if (action === 'review' && group === 'materials' && saved.status === 'draft' && saved.revision === 2) {
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(opener).toBeFocused();
      check('核对对话框 Esc 返回原入口且未修改资源', (await api(`/api/foundation/assets/${saved.id}`)).revision === saved.revision);
      await opener.press('Enter');
      dialog = page.getByRole('dialog', { name: label, exact: true });
      await expect(dialog.locator('[data-resource-state="ready"]')).toHaveCount(1);
    }
    await expect(dialog.getByRole('button', { name: new RegExp(`^确认${label}`) })).toBeDisabled();
    await dialog.locator('summary').filter({ hasText: '参数、来源与固定版本依据' }).click();
    await expect(dialog).toContainText(standard ? standard.standard : '隔离浏览器验收');
    await dialog.getByRole('textbox', { name: '资源操作说明', exact: true }).fill(standard
      ? `隔离浏览器验收${label}：仅核对 ${standard.standard} 的版本声明与原来源摘要一致，完整保留出处；不是内容工程认证，不批准型号、要求或计算结果。`
      : `隔离验收${label}：已查看本条定义、单位与手工出处，仅验证版本流程，不作为工程物性依据。`);
    if (action === 'review') {
      await expect(dialog.getByRole('button', { name: '确认核对来源 1 项', exact: true })).toBeDisabled();
      await dialog.getByRole('checkbox', { name: `已核对资源 ${saved.name}`, exact: true }).check();
    }
    await capture(`${group}-${action}-confirmation`);
    await dialog.getByRole('button', { name: `确认${label} 1 项`, exact: true }).click();
    await expect(dialog.locator('[data-resource-state="success"]')).toHaveCount(1);
    const current = await api(`/api/foundation/assets/${saved.id}`);
    const desired = { review: 'reviewed', publish: 'published', return_to_draft: 'draft', deprecate: 'deprecated' }[action];
    check(`${label}只执行明确的状态变化并保留原始来源`, current.status === desired && current.revision === saved.revision + 1 &&
      current.content_sha256 === saved.content_sha256 && JSON.stringify(current.release.sources) === JSON.stringify(saved.release.sources) &&
      current.events.some(event => event.action === action && event.revision === current.revision), { id: current.id, status: current.status, revision: current.revision });
    if (action === 'return_to_draft') check('退回草稿清除当前审核摘要', current.reviewed_sha256 === null);
    if (action === 'review') check('来源核对没有自动发布', current.status === 'reviewed' && current.reviewed_sha256 === current.content_sha256);
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(dialog).toBeHidden();
    return current;
  }

  async function openTypeBinding(role, targetId) {
    const label = role === 'material' ? '材料' : '规则';
    if (!check(`${label}引用具有经UI新建的隔离型号`, !!referenceWorkspace, '固定型号创建步骤未完成，不能用其他工程代替。', { fatal: false })) return null;
    // Reopen the exact address reached by UI creation, then use visible modules
    // and tabs. No workspace, target, or resource identity is invented here.
    await page.goto(referenceWorkspace.url);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(referenceWorkspace.name);
    const explorer = page.getByRole('navigation', { name: '型号浏览器', exact: true });
    if (role === 'material') {
      await explorer.getByRole('button', { name: /^结构 ·/ }).click();
      await expect(page.getByRole('table', { name: '型号分层', exact: true })).toBeVisible();
    } else {
      await explorer.getByRole('button', { name: /^要求与标准/ }).click();
      await page.getByRole('tab', { name: '执行标准', exact: true }).click();
    }
    const view = await api(`/api/types/${referenceWorkspace.id}/resources`);
    const target = view.targets.find(item => item.role === role && item.input_digest !== null && (!targetId || item.id === targetId));
    if (!target) {
      if (role === 'standard') {
        await page.getByRole('button', { name: '绑定标准版本', exact: true }).click();
        await expect(page.getByRole('dialog', { name: '绑定执行标准版本', exact: true })).toContainText('尚无已核对的执行版本或已批准要求');
      }
      const shot = await capture(`${role}-reference-target-unavailable`);
      check(`${label}有真实且可绑定的设计目标`, false, { targets: view.targets, screenshot: shot.screenshot,
        reason: '必须由当前型号提供设计材料或已核对执行标准；不会为验收伪造声明、来源或批准。' }, { fatal: false });
      if (role === 'standard') {
        report.handoffs ||= [];
        report.handoffs.push({ label: '规则发布后固定引用到型号', status: '未通过', owner: '型号标准声明/来源核对', screenshot: shot.screenshot,
          detail: '隔离型号没有真实已核对执行标准目标；已保留发布流程证据，引用尚未通过。' });
        await page.getByRole('dialog', { name: '绑定执行标准版本', exact: true }).getByRole('button', { name: '关闭', exact: true }).click();
      }
      return null;
    }
    if (role === 'material') {
      const row = page.getByRole('table', { name: '型号分层', exact: true }).getByRole('row').filter({
        has: page.getByRole('checkbox', { name: `选择全部${target.name}层`, exact: true }),
      }).first();
      await row.focus(); await row.press('Enter');
    }
    await page.getByRole('button', { name: role === 'material' ? '绑定材料版本' : '绑定标准版本', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: role === 'material' ? '绑定材料资源版本' : '绑定执行标准版本', exact: true });
    const targetLabel = role === 'material' ? '设计材料' : '执行标准';
    const targetSelect = dialog.getByRole('combobox', { name: targetLabel, exact: true });
    if (role === 'standard' && !(await targetSelect.innerText()).includes(target.name)) await choose(targetLabel, target.name, dialog);
    await expect(targetSelect).toContainText(target.name);
    return { dialog, target, view };
  }

  async function bindPublishedResource(group, published, draft, targetId) {
    const role = published.kind === 'material' ? 'material' : 'standard';
    const context = await openTypeBinding(role, targetId);
    if (!context) return;
    const { dialog, target, view } = context;
    const before = await api(`/api/workspaces/${referenceWorkspace.id}`);
    const current = await api(`/api/foundation/assets/${published.id}`);
    check(`${knownKindLabels[published.kind]}新发布版本进入真实可引用目录`, current.status === 'published' &&
      view.resources.some(item => item.id === current.id && item.version === current.version && item.content_sha256 === current.content_sha256));
    await dialog.getByRole('combobox', { name: '资源版本', exact: true }).click();
    await expect(page.getByRole('listbox')).toBeVisible();
    if (draft) {
      const unapproved = await api(`/api/foundation/assets/${draft.id}`);
      check(`${knownKindLabels[published.kind]}草稿不能被新引用`, unapproved.status === 'draft' &&
        !view.resources.some(item => item.id === draft.id) && await page.getByRole('option', { name: `${draft.name} · ${draft.version}`, exact: true }).count() === 0,
      { id: draft.id, status: unapproved.status });
    }
    await capture(`${group}-binding-published-and-draft-eligibility`);
    await page.getByRole('option', { name: `${current.name} · ${current.version}`, exact: true }).click();
    await expect(dialog).toContainText('固定来源引用；设计材料参数保持当前保存值');
    const response = page.waitForResponse(value => new URL(value.url()).pathname === `/api/types/${referenceWorkspace.id}/resources/bind` && value.request().method() === 'POST');
    await dialog.getByRole('button', { name: '确认绑定', exact: true }).click();
    const receipt = await response;
    check(`${knownKindLabels[published.kind]}通过界面确认真实固定引用`, receipt.ok(), { status: receipt.status(), response: await receipt.json() });
    await expect(dialog).toBeHidden();
    const saved = await api(`/api/workspaces/${referenceWorkspace.id}`), actual = await api(`/api/types/${referenceWorkspace.id}/resources`);
    const pin = saved.type_resource_bindings?.[role]?.[target.id];
    check(`${knownKindLabels[published.kind]}引用保存准确身份版本摘要`, pin?.resource_id === current.id && pin?.id === current.id && pin?.asset_id === current.asset_id &&
      pin?.version === current.version && pin?.content_sha256 === current.content_sha256 && !!pin?.input_digest &&
      actual.targets.some(item => item.role === role && item.id === target.id && item.state === 'current'), { target: target.id, pin });
    check(`${knownKindLabels[published.kind]}固定来源不替换工程物性或批准要求`, JSON.stringify(saved.domain) === JSON.stringify(before.domain), { beforeRevision: before.revision, afterRevision: saved.revision });
    fixedBindings.set(role, { target: target.id, pin: structuredClone(pin), domain: structuredClone(saved.domain), resource: current });
    const link = page.getByRole('link', { name: `${current.name} · ${current.version}`, exact: true }).first();
    await expect(link).toBeVisible();
    await capture(`${group}-fixed-reference-in-type`);
    const typeUrl = page.url();
    await link.focus(); await link.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/resources/${group}\\?`));
    check(`${knownKindLabels[published.kind]}固定引用可用键盘返回确切资源版本`, new URL(page.url()).searchParams.get('item') === current.id);
    if (group === 'standards') await expect(page.getByRole('tab', { name: '资源版本', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(properties.getByRole('heading', { name: current.name, exact: true })).toBeVisible();
    await capture(`${group}-fixed-reference-reopened-keyboard`);
    await page.goBack();
    await expect(page).toHaveURL(typeUrl);
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/resources/${group}\\?`));
    check(`${knownKindLabels[published.kind]}固定引用可用鼠标返回同一资源版本`, new URL(page.url()).searchParams.get('item') === current.id);
    if (group === 'standards') await expect(page.getByRole('tab', { name: '资源版本', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(properties.getByRole('heading', { name: current.name, exact: true })).toBeVisible();
    await capture(`${group}-fixed-reference-reopened`);
  }

  async function verifyStandardDeepLink(published) {
    const binding = fixedBindings.get('standard');
    if (!check('标准深链接使用实际已固定的发布版本', binding?.resource.id === published.id,
      { expected: published.id, bound: binding?.resource.id }, { fatal: false })) return;
    const before = await api(`/api/foundation/assets/${published.id}`);
    const workspaceBefore = await api(`/api/workspaces/${referenceWorkspace.id}`);
    const writesBefore = report.writes.length;
    await openGroup('standards');
    await searchResource('standards', before.name, before.version);
    const resourceUrl = page.url();
    check('标准深链接来自界面所选确切资源', new URL(resourceUrl).searchParams.get('item') === before.id, { url: resourceUrl });
    const resourcesTab = page.getByRole('tab', { name: '资源版本', exact: true });
    const basisTab = page.getByRole('tab', { name: '依据浏览', exact: true });
    const browser = page.locator('[data-page="standards-basis"]');
    const table = main.getByRole('table', { name: groupTitles.standards, exact: true });
    const versionRow = table.getByRole('row', { name: before.name, exact: true }).filter({
      has: page.getByRole('checkbox', { name: `选择资源 ${before.name} ${before.version}`, exact: true }),
    });
    const sourceEditions = before.release.sources.flatMap(source => {
      try { const value = JSON.parse(source.reference); return value.schema === 'cablesim.reference-data/1' && typeof value.edition === 'string' ? [value.edition] : []; }
      catch { return []; }
    });
    check('标准资源显示的版次来自真实保存的标准出处', sourceEditions.length > 0,
      { id: before.id, version: before.version, editions: sourceEditions });
    const expectVersion = async () => {
      await expect(resourcesTab).toHaveAttribute('aria-selected', 'true');
      await expect(browser).toBeHidden();
      await expect(properties.getByRole('heading', { name: before.name, exact: true })).toBeVisible();
      await expect(properties).toContainText(knownStatuses[before.status]);
      await expect(versionRow).toHaveCount(1);
      const displayedVersion = versionRow.locator('[data-resource-version]');
      await expect(displayedVersion).toHaveAttribute('data-resource-version', before.version);
      await expect(displayedVersion).toHaveText(sourceEditions[0]);
      await expect(properties).toContainText(sourceEditions[0]);
      await displayedVersion.focus();
      await expect(page.getByRole('tooltip')).toHaveText(`资源版本 ${before.version} · 第 ${before.revision} 修订`);
      await displayedVersion.press('Escape');
      await expect(page.getByRole('tooltip')).toHaveCount(0);
      check('标准资源页完整显示所指名称和版次', new URL(page.url()).searchParams.get('item') === before.id,
        { id: before.id, name: before.name, version: before.version, edition: sourceEditions[0], url: page.url() });
    };
    const expectBasis = async () => {
      await expect(basisTab).toHaveAttribute('aria-selected', 'true');
      await expect(browser).toBeVisible();
      await expect(properties).toBeHidden();
      check('主动返回依据浏览会清除固定资源选择', !new URL(page.url()).searchParams.has('item'), { url: page.url() });
    };
    // Reopen the observed UI URL in a fresh document; no API-created identity,
    // retained component state or extra resource-tab click may repair the route.
    await page.goto(base + '/');
    await page.goto(resourceUrl);
    await expectVersion();
    await capture('standard-fixed-link-cold-open');
    await page.reload();
    await expectVersion();
    await capture('standard-fixed-link-reloaded');
    await basisTab.click();
    await expectBasis();
    await capture('standard-fixed-link-basis-mouse');
    await resourcesTab.focus(); await resourcesTab.press('Enter');
    await expect(resourcesTab).toHaveAttribute('aria-selected', 'true');
    await versionRow.focus(); await versionRow.press('Enter');
    await expectVersion();
    await capture('standard-fixed-link-resource-keyboard');
    await basisTab.focus(); await basisTab.press('Enter');
    await expectBasis();
    await capture('standard-fixed-link-basis-keyboard');
    await resourcesTab.click();
    await versionRow.click();
    await expectVersion();
    await capture('standard-fixed-link-resource-mouse');
    const saved = await api(`/api/foundation/assets/${before.id}`);
    const workspaceAfter = await api(`/api/workspaces/${referenceWorkspace.id}`);
    const requests = report.writes.slice(writesBefore);
    // This exact POST is the sealed read_only lookup in plugin_host/query_router.py,
    // also admitted by the existing read-only audits. Keep every raw request;
    // no other POST (including previews, saves or approvals) is a read here.
    const isReadOnlyLookup = request => request.method === 'POST'
      && request.path === '/api/plugin-queries/cablesim.standards-basis/lookup';
    const readOnlyQueries = requests.filter(isReadOnlyLookup);
    const mutations = requests.filter(request => !isReadOnlyLookup(request));
    check('标准深链接刷新与键鼠页签往返不写入或漂移固定引用', mutations.length === 0
      && saved.id === before.id && saved.version === before.version && saved.revision === before.revision
      && saved.status === before.status && saved.content_sha256 === before.content_sha256
      && JSON.stringify(saved.release) === JSON.stringify(before.release) && JSON.stringify(saved.events) === JSON.stringify(before.events)
      && workspaceAfter.revision === workspaceBefore.revision
      && JSON.stringify(workspaceAfter.domain) === JSON.stringify(workspaceBefore.domain)
      && JSON.stringify(workspaceAfter.type_resource_bindings) === JSON.stringify(workspaceBefore.type_resource_bindings),
    { writes: requests, readOnlyQueries, mutations,
      readOnlyQueryReason: '标准库查询核对 read_only 声明与发行摘要，仅返回依据和查询工件；不保存资源、工程或批准要求。',
      resource: before.id, version: before.version, digest: saved.content_sha256,
      beforeRevision: workspaceBefore.revision, afterRevision: workspaceAfter.revision });
  }

  async function verifyPinnedHistory(group, versions) {
    const role = group === 'materials' ? 'material' : 'standard', savedBinding = fixedBindings.get(role);
    if (!check(`${groupTitles[group]}具有实际已绑定版本可核对历史`, !!savedBinding, '前面的固定引用未完成，不能用资源发布结果代替。', { fatal: false })) return;
    const context = await openTypeBinding(role, savedBinding.target);
    if (!context) return;
    const saved = await api(`/api/workspaces/${referenceWorkspace.id}`), newer = await api(`/api/foundation/assets/${versions.derived.id}`), old = await api(`/api/foundation/assets/${versions.original.id}`);
    const pin = saved.type_resource_bindings?.[role]?.[savedBinding.target];
    check(`${groupTitles[group]}新版本发布及旧版本停用不漂移原引用`, newer.status === 'published' && old.status === 'deprecated' &&
      newer.id !== old.id && newer.asset_id === old.asset_id && JSON.stringify(pin) === JSON.stringify(savedBinding.pin), { old: old.id, newer: newer.id, pin });
    check(`${groupTitles[group]}资源改版后原工程物性保持不变`, JSON.stringify(saved.domain) === JSON.stringify(savedBinding.domain));
    const resourceSelect = context.dialog.getByRole('combobox', { name: '资源版本', exact: true });
    await expect(resourceSelect).toContainText(old.name);
    await expect(resourceSelect).toContainText(old.version);
    await expect(resourceSelect).toContainText('当前固定，不能新选');
    await expect(context.dialog.getByRole('button', { name: '确认绑定', exact: true })).toBeDisabled();
    await expect(context.dialog.getByText(context.target.reason, { exact: false })).toBeVisible();
    await capture(`${group}-historical-pin-retained`);
    await resourceSelect.click();
    await expect(page.getByRole('listbox')).toBeVisible();
    const oldOption = page.getByRole('option').filter({ hasText: `${old.name} · ${old.version}` });
    const newOption = page.getByRole('option', { name: `${newer.name} · ${newer.version}`, exact: true });
    await expect(oldOption).toBeVisible();
    await expect(oldOption).toHaveAttribute('aria-disabled', 'true');
    await expect(newOption).toBeVisible();
    await expect(newOption).toBeEnabled();
    check(`${groupTitles[group]}已停用版本不能新选且新发布版本可明确选择`,
      !context.view.resources.some(item => item.id === old.id) && context.view.resources.some(item => item.id === newer.id) &&
      await oldOption.getAttribute('aria-disabled') === 'true' && await newOption.isEnabled(),
    { oldVersion: old.version, newVersion: newer.version, reason: context.target.reason });
    await capture(`${group}-old-pin-and-new-version-eligibility`);
    await newOption.click();
    await expect(resourceSelect).toContainText(newer.version);
    await expect(context.dialog.getByRole('button', { name: '确认绑定', exact: true })).toBeEnabled();
    await capture(`${group}-new-version-selected-before-cancel`);
    await context.dialog.getByRole('button', { name: '关闭', exact: true }).click();
    const reread = await api(`/api/workspaces/${referenceWorkspace.id}`);
    check(`${groupTitles[group]}查看新版本并取消没有写入或升级引用`, reread.revision === saved.revision && JSON.stringify(reread.type_resource_bindings?.[role]?.[savedBinding.target]) === JSON.stringify(savedBinding.pin));
  }

  async function declareSourcedStandard() {
    if (!check('真实标准声明使用经UI建立的隔离型号', !!referenceWorkspace,
      '固定型号创建尚未完成，不能借用或修改其他设计。', { fatal: false })) return null;
    await page.goto(referenceWorkspace.url);
    await page.getByRole('navigation', { name: '型号浏览器', exact: true }).getByRole('button', { name: /^要求与标准/ }).click();
    await page.getByRole('tab', { name: '执行标准', exact: true }).click();
    const before = await api(`/api/workspaces/${referenceWorkspace.id}`), writesBefore = report.writes.length;
    const basisPath = `/api/design/type-workspaces/${referenceWorkspace.id}/requirements/basis`;
    const reading = page.waitForResponse(response => new URL(response.url()).pathname === basisPath && response.request().method() === 'POST');
    await page.getByRole('button', { name: '声明执行标准', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '确认执行标准版本', exact: true });
    const response = await reading, plan = await response.json();
    report.standardReferences ||= [];
    const trace = { width: size.width, workspace: referenceWorkspace.id, plan, sources: [] };
    report.standardReferences.push(trace);
    check('执行版本来自当前输入的真实依据查询', response.ok() && plan.workspace_revision === before.revision
      && Array.isArray(plan.undeclared_standards) && Array.isArray(plan.missing_fields),
    { status: response.status(), revision: before.revision,
      declaredCount: plan.undeclared_standards.length, missingFields: plan.missing_fields, sourceCount: Object.keys(plan.parameters?.basis_references || {}).length });
    const declarations = plan.undeclared_standards;
    if (!declarations.length) {
      // Do not manufacture a new edition or sign a new revision when the host
      // reports all standards already declared. Surface the actual remaining
      // modelling gaps in the UI instead of an unhelpful disabled confirm.
      const gaps = plan.missing_fields.map(item => item.reason).filter(Boolean);
      const status = dialog.getByRole('status', { name: '执行标准版本与缺项', exact: true });
      await expect(status).toBeVisible();
      for (const reason of gaps) await expect(status).toContainText(reason);
      check('无待声明版本时不得重复写入执行标准且必须定位真实缺项',
        plan.unbound_standard_count > 0 && gaps.length > 0
          && await dialog.getByRole('button', { name: '返回要求清单', exact: true }).isEnabled(),
        { gaps, unboundCount: plan.unbound_standard_count, versionCount: 0 });
      await capture('standard-existing-editions-with-real-missing-inputs');
      await dialog.getByRole('button', { name: '返回要求清单', exact: true }).click();
      const after = await api(`/api/workspaces/${referenceWorkspace.id}`);
      check('只读查询和关闭缺项提示不创建新标准版本',
        after.revision === before.revision && JSON.stringify(after.domain) === JSON.stringify(before.domain),
        { before: before.revision, after: after.revision });
      check('执行标准所需型号条件仍未闭合，不能宣称完整核对', false,
        { gaps, unboundCount: plan.unbound_standard_count, owner: 'T3 方法与材料依据' },
        { fatal: false });
      return null;
    }
    for (const declaration of declarations) {
      check('待声明版本有真实标准名和来源摘要', typeof declaration.standard === 'string' && !!declaration.standard
        && /^[a-f0-9]{64}$/.test(declaration.source_digest), declaration);
      await expect(dialog).toContainText(declaration.standard);
      const catalogue = await api(`/api/foundation/assets?kind=rule&status=published&q=${encodeURIComponent(declaration.standard)}&limit=100&offset=0`);
      // The unchanged seed edition is the source. Previously derived local test
      // versions are not silently treated as a newer edition of the standard.
      const candidates = catalogue.items.filter(item => item.name === declaration.standard && !item.version.includes('-'));
      const matches = [];
      for (const candidate of candidates) {
        const source = await api(`/api/foundation/assets/${candidate.id}`);
        const matched = source.release.sources.some(item => {
          if (item.kind !== 'standard' || item.reviewed !== true) return false;
          try {
            const reference = JSON.parse(item.reference);
            return reference.schema === 'cablesim.reference-data/1' && reference.standard === declaration.standard
              && reference.source_digest === declaration.source_digest;
          } catch { return false; }
        });
        if (matched && source.status === 'published' && source.reviewed_sha256 === source.content_sha256) matches.push(source);
      }
      check('声明版本与已发布原标准的完整出处精确一致', matches.length === 1,
        { declaration, candidates: candidates.map(item => ({ id: item.id, name: item.name, version: item.version })), matches: matches.map(item => item.id) });
      trace.sources.push({ declaration, source: matches[0] });
    }
    const confirm = dialog.getByRole('button', { name: '确认执行标准并查询依据', exact: true });
    await expect(confirm).toBeDisabled();
    await expect(dialog).toContainText('要求批准需单独确认');
    await capture('standard-real-editions-before-explicit-confirmation');
    await dialog.getByRole('checkbox', { name: '已核对执行标准版本', exact: true }).check();
    await expect(confirm).toBeEnabled();
    const rereading = page.waitForResponse(value => new URL(value.url()).pathname === basisPath && value.request().method() === 'POST');
    await confirm.click();
    const resolvedResponse = await rereading, resolved = await resolvedResponse.json();
    trace.resolved = resolved;
    await expect(dialog.getByLabel('当前输入标准依据', { exact: true })).toBeVisible();
    check('声明后重新查询真实固定依据且保留未覆盖条件', resolvedResponse.ok()
      && Array.isArray(resolved.undeclared_standards) && resolved.undeclared_standards.length === 0,
    { status: resolvedResponse.status(), missing: resolved.missing, missing_fields: resolved.missing_fields, undeclared: resolved.undeclared_standards });
    await capture('standard-real-editions-resolved-without-product-approval');
    await dialog.getByRole('button', { name: '返回要求清单', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByLabel('已声明执行标准', { exact: true })).toBeVisible();
    const saved = await api(`/api/workspaces/${referenceWorkspace.id}`);
    const declarationSource = saved.domain?.provenance?.['/execution_standards'];
    let savedDeclaration;
    try { savedDeclaration = JSON.parse(declarationSource?.reference || 'null'); } catch { savedDeclaration = null; }
    check('显式声明保存返回的版本与摘要而不捏造标准', declarationSource?.kind === 'standard' && declarationSource.reviewed === true
      && savedDeclaration?.schema === 'cablesim.execution-standards/1'
      && declarations.every(item => savedDeclaration.items?.some(value => value.standard === item.standard && value.source_digest === item.source_digest))
      && saved.revision === before.revision + 1 && resolved.workspace_revision === saved.revision,
    { beforeRevision: before.revision, afterRevision: saved.revision, declaration: savedDeclaration });
    const oldDomain = structuredClone(before.domain), newDomain = structuredClone(saved.domain);
    delete oldDomain.provenance['/execution_standards']; delete newDomain.provenance['/execution_standards'];
    check('版本声明不更改结构物性且未替用户批准要求或型号', JSON.stringify(oldDomain) === JSON.stringify(newDomain)
      && !report.writes.slice(writesBefore).some(write => /\/requirements\/reviews|\/approve(?:\/|$)|\/publish(?:\/|$)/.test(write.path)),
    { writes: report.writes.slice(writesBefore), scope: '仅核验执行版本声明与原来源一致；不代表内容工程认证。' });
    const view = await api(`/api/types/${referenceWorkspace.id}/resources`), selected = trace.sources[0];
    const target = view.targets.find(item => item.role === 'standard' && item.declaration === true
      && item.name === selected.declaration.standard && item.input_digest !== null);
    check('真实执行版本声明产生可绑定目标', !!target,
      { declaration: selected.declaration, targets: view.targets.filter(item => item.role === 'standard') });
    trace.target = target.id;
    const checkEntry = page.getByRole('button', { name: '去标准核对', exact: true });
    await expect(checkEntry).toBeVisible();
    const navigationWrites = report.writes.length;
    await checkEntry.focus(); await checkEntry.press('Enter');
    await expect(page).toHaveURL(new RegExp('/types/' + referenceWorkspace.id + '/standard-check/results'));
    await expect(page.locator('[data-type-page="standard-check-results"]')).not.toHaveAttribute('data-type-state', 'loading');
    await expect(page.getByRole('button', { name: '执行标准核对', exact: true })).toBeVisible();
    await capture('standard-empty-state-opens-real-check');
    await page.getByRole('button', { name: '要求与批准记录', exact: true }).click();
    await page.getByRole('tab', { name: '执行标准', exact: true }).click();
    await expect(page.getByLabel('已声明执行标准', { exact: true })).toBeVisible();
    await expect(checkEntry).toBeVisible();
    check('执行标准空状态可用键盘进入核对并返回且没有写入', report.writes.length === navigationWrites,
      { workspace: referenceWorkspace.id, writes: report.writes.slice(navigationWrites) });
    const approvalBefore = await api(`/api/types/${referenceWorkspace.id}/standards-summary`);
    expect(approvalBefore.revision).toBe(saved.revision);
    expect(approvalBefore.standards, '刚声明执行版本，没有代替工程师批准要求').toEqual([]);
    const directory = page.locator('.workbench-sidebar').getByRole('link', { name: '型号设计', exact: true });
    if (size.width === 1366) { await directory.focus(); await directory.press('Enter'); }
    else await directory.click();
    await page.waitForURL(url => url.pathname === '/types' && url.searchParams.get('theme') === 'light');
    const names = [...new Set(savedDeclaration.items.map(item => item.standard.trim()))];
    const catalogStandard = page.locator(`[data-type-execution-standards="${referenceWorkspace.id}"]`);
    for (const reload of [false, true]) {
      if (reload) await page.reload();
      await expect(page.locator('[data-type-page="list"]')).toHaveAttribute('data-type-state', 'success');
      await expect(catalogStandard).toHaveAttribute('data-declaration-state', 'declared');
      await expect(catalogStandard).toHaveAttribute('data-approval-state', 'ready');
      await expect(catalogStandard).toHaveText(names.join('、'));
      await catalogStandard.scrollIntoViewIfNeeded();
      await expect(catalogStandard).toBeInViewport({ ratio: 1 });
      await capture(reload ? 'standard-declaration-catalog-after-refresh' : 'standard-declaration-catalog-without-approval');
    }
    const catalogRow = page.getByRole('table', { name: '型号', exact: true })
      .locator('[id="row-型号-' + referenceWorkspace.id + '"]');
    const openType = catalogRow.locator('button.object-link');
    if (size.width === 1920) { await openType.focus(); await openType.press('Enter'); }
    else await openType.click();
    await page.waitForURL(url => url.pathname === `/types/${referenceWorkspace.id}/structure/section`
      && !url.searchParams.get('run') && !url.searchParams.get('revision'));
    await expect(page.locator('.type-root .topbar h1')).toContainText(referenceWorkspace.name);
    await page.getByRole('navigation', { name: '型号浏览器', exact: true }).getByRole('button', { name: /^要求与标准/ }).click();
    const executionTab = page.getByRole('tab', { name: '执行标准', exact: true });
    if (size.width === 1920) { await executionTab.focus(); await executionTab.press('Enter'); }
    else await executionTab.click();
    const declared = page.getByLabel('已声明执行标准', { exact: true });
    await expect(declared).toBeVisible();
    for (const name of names) await expect(declared).toContainText(name);
    await capture('standard-declaration-catalog-returned-to-same-input');
    const [afterCatalog, approvalAfter] = await Promise.all([
      api(`/api/workspaces/${referenceWorkspace.id}`), api(`/api/types/${referenceWorkspace.id}/standards-summary`),
    ]);
    check('真实声明保存后目录刷新与键鼠往返保留版本且不自动批准', report.writes.length === navigationWrites
      && afterCatalog.revision === saved.revision && JSON.stringify(afterCatalog.domain) === JSON.stringify(saved.domain)
      && JSON.stringify(afterCatalog.type_resource_bindings) === JSON.stringify(saved.type_resource_bindings)
      && JSON.stringify(approvalAfter) === JSON.stringify(approvalBefore),
    { workspace: referenceWorkspace.id, names, revision: afterCatalog.revision,
      declaration: savedDeclaration, approvalBefore, approvalAfter, writes: report.writes.slice(navigationWrites) });
    trace.catalog = { names, revision: afterCatalog.revision, approvedStandards: approvalAfter.standards, url: page.url() };
    return { ...selected, target: target.id, originals: trace.sources.map(item => item.source) };
  }

  async function deriveSourcedStandard(source, version) {
    await openGroup('standards');
    await searchResource('standards', source.name, source.version);
    await properties.getByRole('button', { name: '派生新版本', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '派生新版本', exact: true });
    await expect(dialog.getByRole('button', { name: '建立新版本草稿', exact: true })).toBeDisabled();
    await expect(dialog).toContainText('原版本及既有引用保持固定');
    await dialog.getByRole('textbox', { name: '新版本号', exact: true }).fill(version);
    await capture('standard-sourced-local-version-before-creation');
    await dialog.getByRole('button', { name: '建立新版本草稿', exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.waitForURL(url => !!url.searchParams.get('item') && url.searchParams.get('item') !== source.id);
    const derived = await inspectSelectedResource(source.name), original = await api(`/api/foundation/assets/${source.id}`);
    check('隔离本地标准版本完整保留出处且原版本未变化', derived.id !== source.id && derived.asset_id === source.asset_id
      && derived.version === version && derived.status === 'draft' && derived.revision === 1
      && JSON.stringify(derived.release) === JSON.stringify({ ...source.release, version })
      && original.status === source.status && original.revision === source.revision && original.content_sha256 === source.content_sha256,
    { original: source.id, derived: derived.id, version, sources: derived.release.sources });
    await capture('standard-sourced-local-version-draft');
    return derived;
  }

  async function lifecycle(group, imported, draft) {
    await openGroup(group);
    await searchResource(group, imported.name, imported.version);
    await properties.getByRole('button', { name: '编辑资源草稿', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '编辑资源草稿', exact: true });
    await expect(editor.getByRole('textbox', { name: '版本号', exact: true })).toBeDisabled();
    const name = imported.name + '-修改';
    await editor.getByRole('textbox', { name: '资源名称', exact: true }).fill(name);
    const value = Number((imported.release.parameters[0].quantity.value + 0.05).toFixed(4));
    await editor.getByRole('textbox', { name: '参数数值 1', exact: true }).fill(String(value));
    await capture(`${group}-edit-draft`);
    await editor.getByRole('textbox', { name: '资源名称', exact: true }).press('Enter');
    await expect(editor).toBeHidden();
    let current = await inspectSelectedResource(name);
    check('编辑草稿保存新修订且不更换资源身份', current.id === imported.id && current.version === imported.version && current.revision === imported.revision + 1 &&
      current.release.parameters[0].quantity.value === value && current.content_sha256 !== imported.content_sha256 &&
      JSON.stringify(current.release.sources) === JSON.stringify(imported.release.sources));
    current = await transition(group, current, 'review', '核对来源');
    current = await transition(group, current, 'return_to_draft', '退回草稿');
    current = await transition(group, current, 'review', '核对来源');
    current = await transition(group, current, 'publish', '发布');
    // A hand-entered temperature rule is a resource workflow fixture, not a
    // declaration of a GB standard. The sourced standard journey below is separate.
    if (current.kind === 'material') {
      await branch(`${groupTitles[group]}发布版本固定引用到型号`, () => bindPublishedResource(group, current, draft));
      await openGroup(group); await searchResource(group, current.name, current.version);
    }
    await properties.getByRole('button', { name: '派生新版本', exact: true }).click();
    const derive = page.getByRole('dialog', { name: '派生新版本', exact: true });
    await expect(derive.getByRole('button', { name: '建立新版本草稿', exact: true })).toBeDisabled();
    await derive.getByRole('textbox', { name: '新版本号', exact: true }).fill('2.0.0');
    await capture(`${group}-derive-confirmation`);
    await derive.getByRole('button', { name: '建立新版本草稿', exact: true }).click();
    await expect(derive).toBeHidden();
    const derived = await inspectSelectedResource(name), original = await api(`/api/foundation/assets/${current.id}`);
    check('派生建立新草稿并完整保留旧版本', derived.id !== current.id && derived.asset_id === current.asset_id && derived.version === '2.0.0' &&
      derived.status === 'draft' && derived.revision === 1 && JSON.stringify(derived.release.parameters) === JSON.stringify(current.release.parameters) &&
      original.status === 'published' && original.revision === current.revision && original.content_sha256 === current.content_sha256);
    await capture(`${group}-derived-draft`);
    current = await transition(group, current, 'deprecate', '停用');
    return { derived, original: current };
  }

  async function batch(group, typed, versions) {
    await openGroup(group);
    await main.getByRole('textbox', { name: '检索', exact: true }).fill(marker);
    const table = main.getByRole('table', { name: groupTitles[group], exact: true });
    for (const [index, asset] of [typed, versions.derived, versions.original].entries()) {
      const checkbox = table.getByRole('checkbox', { name: `选择资源 ${asset.name} ${asset.version}`, exact: true });
      if (index === 0) { await checkbox.focus(); await checkbox.press('Space'); } else await checkbox.check();
    }
    await expect(main).toContainText('已选 3 项');
    await choose('批量操作', '导出固定版本定义');
    await main.getByRole('button', { name: '预检批量操作', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: '批量导出定义', exact: true });
    await expect(dialog.locator('[data-resource-state="ready"]')).toHaveCount(3);
    await capture(`${group}-batch-export-preview`);
    const downloaded = page.waitForEvent('download');
    await dialog.getByRole('button', { name: '下载 3 项定义', exact: true }).click();
    const file = await downloaded, filename = path.join(out, `${group}-resource-definitions-${size.width}.json`);
    await file.saveAs(filename);
    const exported = JSON.parse(await fs.readFile(filename, 'utf8'));
    check('批量导出包含真实固定版本和来源', exported.schema_version === 'cablesim.resource-export/1' && exported.items.length === 3 &&
      [typed, versions.derived, versions.original].every(asset => exported.items.some(item => item.id === asset.id && item.content_sha256 === asset.content_sha256 &&
        item.definition.release.version === asset.version && JSON.stringify(item.definition.release.sources) === JSON.stringify(asset.release.sources))), { filename: path.basename(filename) });
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    for (const [action, label] of [['review', '核对来源'], ['publish', '发布']]) {
      await choose('批量操作', label);
      await main.getByRole('button', { name: '预检批量操作', exact: true }).click();
      dialog = page.getByRole('dialog', { name: `批量${label}`, exact: true });
      await expect(dialog.locator('[data-resource-state="ready"]')).toHaveCount(2);
      await expect(dialog.locator('[data-resource-state="blocked"]')).toHaveCount(1);
      await expect(dialog.locator('[data-resource-state="blocked"]')).toContainText('已停用');
      await dialog.getByRole('textbox', { name: '资源操作说明', exact: true }).fill(`隔离验收批量${label}：仅处理明确选择并满足资格的两份手工定义，停用项保持原状态。`);
      if (action === 'review') for (const asset of [typed, versions.derived]) {
        const item = dialog.locator(`[data-resource-item="${asset.id}"]`);
        await item.locator('summary').click();
        await expect(item).toContainText('隔离浏览器验收');
        await item.getByRole('checkbox', { name: `已核对资源 ${asset.name}`, exact: true }).check();
      }
      await capture(`${group}-batch-${action}-eligibility`);
      await dialog.getByRole('button', { name: `确认${label} 2 项`, exact: true }).click();
      await expect(dialog.locator('[data-resource-state="success"]')).toHaveCount(2);
      await expect(dialog.locator('[data-resource-state="blocked"]')).toHaveCount(1);
      const actual = await Promise.all([typed, versions.derived, versions.original].map(asset => api(`/api/foundation/assets/${asset.id}`)));
      check(`批量${label}逐项反馈且保留不合格版本`, actual[0].status === (action === 'review' ? 'reviewed' : 'published') &&
        actual[1].status === (action === 'review' ? 'reviewed' : 'published') && actual[2].status === 'deprecated' && actual[2].revision === versions.original.revision &&
        actual.every(asset => asset.release.sources.every(source => source.kind === 'project_input' && source.reviewed === false)), actual.map(asset => ({ id: asset.id, status: asset.status, revision: asset.revision })));
      await capture(`${group}-batch-${action}-results`);
      await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    }
    await main.getByRole('button', { name: '清除所选', exact: true }).click();
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
      const badges = properties.locator('.source-badge');
      check('固定型号名片有真实来源说明可核对', await badges.count() > 0);
      for (const badge of await badges.all()) {
        await badge.scrollIntoViewIfNeeded();
        await expect(badge).toBeInViewport({ ratio: 1 });
        const bounds = await badge.evaluate(node => {
          const rect = node.getBoundingClientRect(), panel = node.closest('.property-panel').getBoundingClientRect();
          const range = document.createRange(); range.selectNodeContents(node);
          const text = [...range.getClientRects()].filter(box => box.width && box.height);
          return { label: node.textContent, insidePanel: rect.left >= panel.left && rect.right <= panel.right,
            completeText: text.every(box => box.left >= rect.left - 1 && box.right <= rect.right + 1) };
        });
        check('固定型号来源徽标完整显示且不被名片边界裁切', bounds.insidePanel && bounds.completeText, bounds);
      }
      await capture('cable-version-source-badges-readable');
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

  if (after) {
    await branch('型号版本检索与空态恢复', async () => {
      await openCableVersions();
      const search = main.getByRole('textbox', { name: '检索型号版本', exact: true });
      await search.fill(`不存在的型号-${marker}`);
      await expect(main.getByText('没有匹配的型号版本', { exact: true })).toBeVisible();
      await capture('cable-search-empty');
      await main.getByRole('button', { name: '清除型号筛选', exact: true }).first().click();
      await expect(search).toHaveValue('');
      await expect(main.getByRole('table', { name: '电缆型号版本', exact: true })).toBeVisible();
    });
    const catalogue = await api('/api/domain-cable-models');
    const available = await api('/api/design/study-cable-models');
    const typeOptions = await api('/api/types/creation-options');
    const source = catalogue.find(model => model.payload?.cable_type && available.some(item => item.id === `candidate:${model.id}`) && typeOptions.library.some(item => item.id === model.id));
    check('种子提供可跨主线引用的完整固定型号', !!source, { available: available.length, catalogue: catalogue.length }, { fatal: false });
    if (source) {
      const studyVersion = available.find(item => item.id === `candidate:${source.id}`);
      async function selectSource() {
        await openCableVersions();
        await main.getByRole('textbox', { name: '检索型号版本', exact: true }).fill(source.payload.name);
        const row = main.getByRole('table', { name: '电缆型号版本', exact: true }).locator(`[id="row-电缆型号版本-${source.id}"]`);
        await expect(row).toBeVisible(); await row.focus(); await row.press('Enter');
        await expect(properties.getByRole('heading', { name: source.payload.name, exact: true })).toBeVisible();
      }
      await branch('从固定型号版本建立型号草稿', async () => {
        await selectSource();
        await properties.getByRole('button', { name: '建立型号草稿', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: '新建型号设计', exact: true });
        await expect(dialog.getByRole('combobox', { name: '型号版本', exact: true })).toBeDisabled();
        await expect(dialog.getByRole('combobox', { name: '型号版本', exact: true })).toContainText(source.payload.name);
        const name = `隔离验收固定型号-${marker}`;
        await dialog.getByRole('textbox', { name: '型号名称', exact: true }).fill(name);
        await capture('cable-fixed-version-type-create');
        await dialog.getByRole('button', { name: '建立草稿', exact: true }).click();
        await page.waitForURL(/\/types\/[^/?]+\/structure\/section/);
        await expect(page.locator('[data-type-page="structure"]')).toHaveAttribute('data-type-state', 'success');
        await expect(page.getByRole('heading', { level: 1 })).toContainText(name);
        const wid = new URL(page.url()).pathname.split('/')[2], saved = await api(`/api/workspaces/${wid}`);
        referenceWorkspace = { id: wid, name, url: page.url() };
        check('新型号草稿保留选中版本及摘要', saved.type_origin_reference?.id === source.id && saved.type_origin_reference?.version === source.payload.version &&
          saved.type_origin_reference?.content_sha256 === source.digest && saved.type_creation?.kind === 'library', { workspace: wid, origin: saved.type_origin_reference });
        check('从资源建立型号未改写原始版本', (await api('/api/domain-cable-models')).find(item => item.id === source.id)?.digest === source.digest);
        await capture('cable-fixed-version-type-created');
      });
      await branch('从固定型号版本新建工程研究', async () => {
        await selectSource();
        const originalWorkspaces = await api('/api/workspaces');
        await properties.getByRole('button', { name: '用于载流量研究', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: '新建研究', exact: true });
        await expect(dialog.getByRole('combobox', { name: '引用型号版本', exact: true })).toBeDisabled();
        await expect(dialog.getByRole('combobox', { name: '引用型号版本', exact: true })).toContainText(studyVersion.name);
        await expect(dialog.getByRole('combobox', { name: '所属工程', exact: true })).toHaveCount(0);
        const project = `隔离验收固定版本工程-${marker}`, title = `固定版本载流量-${marker}`;
        await dialog.getByRole('textbox', { name: '工程名称', exact: true }).fill(project);
        await dialog.getByRole('textbox', { name: '研究名称', exact: true }).fill(title);
        await choose('计算方法', /^IEC 60287/, dialog);
        await capture('cable-fixed-version-study-create');
        await dialog.getByRole('button', { name: '建立研究', exact: true }).click();
        await page.waitForURL(/\/studies\/[^/?]+\/ampacity\/results/);
        await expect(page.getByRole('button', { name: '预检并运行', exact: true })).toBeVisible();
        const url = new URL(page.url()), wid = url.searchParams.get('workspace'), sid = url.pathname.split('/')[2];
        const saved = await api(`/api/workspaces/${wid}`), study = await api(`/api/workspaces/${wid}/studies/${sid}`);
        check('资源引用新建工程并固定真实型号摘要', !originalWorkspaces.some(item => item.id === wid) && saved.domain.name === project &&
          saved.study_cable_reference?.id === studyVersion.id && saved.study_cable_reference?.content_sha256 === studyVersion.content_sha256 &&
          saved.study_cable_reference?.version === studyVersion.version, { workspace: wid, reference: saved.study_cable_reference?.id, version: saved.study_cable_reference?.version });
        check('从资源建立的研究有明确名称与真实方法', (study.title || study.definition?.title) === title && !!(study.definition?.method || study.method));
        const projectLabel = page.locator('.workbench-sidebar a.tree-object[aria-current="page"] .tree-label').filter({ hasText: project });
        await expect(projectLabel).toHaveText(project);
        await projectLabel.scrollIntoViewIfNeeded();
        const projectLayout = await projectLabel.evaluate(node => {
          const box = node.getBoundingClientRect(), range = document.createRange();
          range.selectNodeContents(node);
          const rects = [...range.getClientRects()].filter(rect => rect.width && rect.height);
          const count = node.parentElement.querySelector('.tree-count')?.getBoundingClientRect();
          return { text: node.textContent, font: parseFloat(getComputedStyle(node).fontSize),
            complete: rects.length > 0 && rects.every(rect => rect.left >= box.left - 1 && rect.right <= box.right + 1
              && rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1),
            inView: box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth,
            separateCount: !count || count.left >= box.right - 1,
            height: box.height, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight };
        });
        check('新建工程的完整长名称可在导航中阅读且不盖住研究数', projectLayout.complete && projectLayout.inView
          && projectLayout.separateCount && projectLayout.font >= 13 && projectLayout.scrollHeight <= projectLayout.clientHeight + 1, projectLayout);
        await capture('cable-fixed-version-study-created');
      });
    }
  }

  await branch('厂家结构表与 PDF 分流并实传 CSV', async () => {
    const startWrites = report.writes.length;
    await openCableVersions();
    await page.locator('.topbar-actions').getByRole('button', { name: '导入厂家结构表', exact: true }).click();
    await expect(page).toHaveURL(/\/resources\/cables\/structure-import(?:\?|$)/);
    await expect(page.getByRole('tab', { name: '导入结构表', exact: true })).toBeVisible();
    const uploadButton = page.getByRole('button', { name: '选择结构表文件', exact: true });
    await expect(uploadButton).toBeEnabled();
    const picker = page.getByLabel('结构表文件', { exact: true });
    const formats = await picker.getAttribute('accept');
    await check('厂家结构表可从资源库导入', /\.xlsx/.test(formats || '') && /\.xls/.test(formats || '') && /\.csv/.test(formats || ''),
      { acceptedFormats: formats, route: page.url(), owner: '现有 T3 结构表向导' });
    await capture('manufacturer-structure-entry');
    // Real published-source fixture; this is the actual browser multipart request
    // on a fresh isolated library, not a test-created API response or OCR output.
    const metadata = JSON.parse(await fs.readFile(new URL('../../tests/fixtures/jiangnan_yjv22.json', import.meta.url), 'utf8'));
    const bytes = await fs.readFile(new URL('../../tests/fixtures/jiangnan_yjv22.csv', import.meta.url));
    const originalTable = await fs.readFile(new URL('../../tests/fixtures/jiangnan_yjv22_source.html', import.meta.url));
    const originalTableDigest = createHash('sha256').update(originalTable).digest('hex');
    assert.equal(originalTableDigest, metadata.source.original_table_sha256, '原始网页数据表字节必须与来源摘要一致');
    const source = { ...metadata.source, transcription_method: metadata.transcription_method,
      confidence: metadata.confidence, reviewed: false, limitations: metadata.limitations,
      published_standards_text: metadata.published_standards_text };
    const originalRows = bytes.toString('utf8').trim().split(/\r?\n/).slice(1).map(row => row.split(',').map(Number));
    assert.equal(originalRows.length, 9);
    assert.deepEqual(originalRows[2], [95, 3, 10.5, 86.3, 11050], '公开原表异常不为走查改写');
    const mapping = { area: 0, insulation_thickness: 2, outer_diameter: 3, weight: 4 };
    const units = { area: ['mm²', 'm2', 1e-6], insulation_thickness: ['mm', 'm', .001], outer_diameter: ['mm', 'm', .001], weight: ['kg/km', 'kg/m', .001] };
    const declaration = metadata.declaration;
    assert.equal(declaration.origin, 'public');
    assert.equal(declaration.armour_material, 'steel_tape', '原件只明确钢带，不能猜具体钢材类别');
    assert.ok(originalRows.every(row => row[1] === declaration.cores));
    assert.equal(source.rows.length, originalRows.length);
    for (const [index, row] of source.rows.entries()) {
      assert.deepEqual([row.csv_row, row.area_mm2, row.cores], [index + 2, originalRows[index][0], originalRows[index][1]]);
    }
    const uploadName = 'T1-已公开结构表.csv';
    const expectedDigest = createHash('sha256').update(bytes).digest('hex');
    assert.equal(expectedDigest, metadata.source.csv_sha256, '实际上传 CSV 必须匹配公开资料转录件摘要');
    const [uploaded] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/api/type-library/imports/upload')
        && response.request().method() === 'POST', { timeout: 60000 }),
      picker.setInputFiles({ name: uploadName, mimeType: 'text/csv', buffer: bytes }),
    ]);
    const inspection = await uploaded.json();
    await check('实际 CSV 字节与来源摘要经后端验收', uploaded.status() === 201 &&
      inspection.sha256 === expectedDigest && inspection.sheets?.some(sheet => sheet.data_rows >= 1),
      { status: uploaded.status(), uploadedDigest: inspection.sha256, originalDigest: expectedDigest,
        sheets: inspection.sheets?.map(sheet => ({ name: sheet.name, rows: sheet.data_rows })) });
    await expect(page.getByRole('heading', { name: '选择工作表', exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: '工作表', exact: true })).toBeVisible();
    await capture('manufacturer-structure-upload');

    // Reuse the current wizard receipt. The 1366 journey operates its selects
    // with the keyboard; the 1920 journey uses their visible pointer controls.
    async function selectManufacturer(label, option) {
      if (size.width === 1920) return choose(label, option);
      const field = page.getByRole('combobox', { name: label, exact: true });
      await expect(field).toBeEnabled();
      await field.focus();
      await expect(field).toBeFocused();
      await field.press('Enter');
      const choices = page.getByRole('option');
      await expect(page.getByRole('option', { name: option, exact: true })).toBeVisible();
      const index = await choices.evaluateAll((items, label) => items.findIndex(item => item.textContent.replace(/✓/g, '').trim() === label), option);
      assert.ok(index >= 0, '键盘选择缺少选项：' + label + ' / ' + option);
      await page.keyboard.press('Home');
      await expect(choices.first()).toBeFocused();
      for (let i = 1; i <= index; i++) {
        await page.keyboard.press('ArrowDown');
        await expect(choices.nth(i)).toBeFocused();
      }
      await page.keyboard.press('Enter');
      await expect(field).toHaveText(option);
      await expect(field).toBeFocused();
    }
    async function activateManufacturer(control) {
      if (size.width === 1366) { await control.focus(); await expect(control).toBeFocused(); await control.press('Enter'); }
      else await control.click();
    }
    async function manufacturerAction(waiter, action) {
      const [result] = await Promise.all([waiter, Promise.resolve().then(action)]);
      return result;
    }
    async function recordManufacturerResponse(label, response, body) {
      const raw = await response.body();
      const filename = size.width + '-' + label;
      await fs.writeFile(path.join(out, filename + '-response.json'), raw);
      await fs.writeFile(path.join(out, filename + '-request.json'), JSON.stringify({
        method: response.request().method(), path: new URL(response.url()).pathname,
        request: response.request().postDataJSON(), status: response.status(),
        response_bytes: raw.length, response_sha256: createHash('sha256').update(raw).digest('hex'),
      }, null, 2));
      assert.deepEqual(JSON.parse(new TextDecoder().decode(raw)), body, '归档的响应原字节须与实际断言对象一致');
    }
    async function positionManufacturerSource(locator) {
      await page.waitForFunction(() => [...document.querySelectorAll('.dialog-stage')].every(stage => Number(getComputedStyle(stage).opacity) >= .999));
      const position = await locator.evaluate(element => {
        const container = element.closest('.library-import-dialog-body');
        if (!(container instanceof HTMLElement)) throw new Error('来源内容没有对应的对话框滚动区域');
        const inset = Number.parseFloat(getComputedStyle(container).getPropertyValue('--space-2'));
        if (!Number.isFinite(inset) || inset <= 0) throw new Error('缺少对话框内容的显示间距');
        const before = element.getBoundingClientRect();
        const bounds = container.getBoundingClientRect();
        // Move only the real scroll region. Keep the whole row inside its top
        // edge instead of asking every ancestor to align to a fractional pixel.
        container.scrollTo({ top: Math.floor(container.scrollTop + before.top - bounds.top - inset), behavior: 'instant' });
        const after = element.getBoundingClientRect();
        return { label: element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 120),
          before: { top: before.top, bottom: before.bottom, height: before.height },
          after: { top: after.top, bottom: after.bottom, height: after.height },
          container: { top: bounds.top, bottom: bounds.bottom, height: bounds.height }, inset };
      });
      (report.manufacturerDialogPositions ||= []).push({ viewport: size.width, ...position });
    }

    assert.equal(inspection.sha256, expectedDigest, '原 CSV 字节不得为走查改写');
    assert.equal(inspection.file, uploadName);
    assert.equal(inspection.declarations?.length || 0, 0, '自有 CSV 不应偷偷注入内置样本声明');
    const sheet = inspection.sheets.find(item => item.name === uploadName.replace(/\.[^.]+$/, ''));
    assert.ok(sheet);
    assert.deepEqual([sheet.first_data_row, sheet.data_rows, sheet.columns.length], [2, 9, 5]);
    assert.equal(sheet.columns[4].header, '电缆最大重量（kg/km）');
    await selectManufacturer('工作表', `${sheet.name} · 9 行`);
    await capture('江南真实CSV上传与原始五列');
    await activateManufacturer(page.getByRole('button', { name: '确认工作表，设置列映射', exact: true }));
    await expect(page.getByRole('heading', { name: '确认列映射', exact: true })).toBeVisible();
    for (const column of sheet.columns) {
      const key = Object.keys(mapping).find(key => mapping[key] === column.index);
      const field = inspection.fields.find(item => item.key === key);
      if (key) assert.equal(field.unit, units[key][0]);
      await selectManufacturer(`${column.letter} 列对应`, key ? `${field.label} / ${units[key][0]}` : '不导入此列');
    }
    await page.getByRole('combobox', { name: 'E 列对应', exact: true }).scrollIntoViewIfNeeded();
    await capture('江南最大重量原列映射');
    await activateManufacturer(page.getByRole('button', { name: '填写系列声明', exact: true }));
    const form = page.getByRole('form', { name: '系列声明', exact: true });
    const seriesName = `江南公开三芯35千伏-${marker}`;
    for (const [label, value] of [['系列名称', seriesName], ['制造商', metadata.manufacturer], ['型号', declaration.designation], ['额定相电压 kV', String(declaration.u0_v / 1000)], ['额定线电压 kV', String(declaration.u_v / 1000)]]) await form.getByLabel(label, { exact: true }).fill(value);
    const materialLabels = { copper: '铜', aluminium: '铝', XLPE: '交联聚乙烯', PVC: '聚氯乙烯', PE: '聚乙烯' };
    assert.equal(declaration.resistance_basis, 'stated');
    for (const [label, value] of [['芯数', declaration.cores + ' 芯'], ['数据身份', '公开厂家资料'], ['导体材料', materialLabels[declaration.conductor]], ['绝缘材料', materialLabels[declaration.insulation]], ['外护套材料', materialLabels[declaration.oversheath]], ['铠装材料类别', '未声明具体钢材'], ['原表缺少导体电阻时', '保留缺项，等待厂家提供']]) await selectManufacturer(label, value);
    await expect(form.getByLabel('最高系统电压 kV', { exact: true })).toHaveValue('');
    await expect(form.getByLabel('执行标准', { exact: true })).toHaveValue('');
    await form.getByText('补充原列口径与原件定位', { exact: true }).click();
    const sourceInput = form.getByLabel('来源说明 JSON 文件', { exact: true });
    await sourceInput.setInputFiles({ name: '损坏来源.json', mimeType: 'application/json', buffer: Buffer.from('{"url":') });
    const error = form.getByRole('alert');
    await expect(error).toHaveText('来源说明不是有效 JSON，请检查文件格式。');
    await error.scrollIntoViewIfNeeded();
    assert.equal(report.writes.slice(startWrites).some(item => item.path === '/api/type-library/imports/preview' || item.path === '/api/type-library/imports/commit'), false, '坏来源文件不得创建预览或入库');
    await capture('江南来源说明坏JSON明确拒绝');
    const sourceBytes = Buffer.from(JSON.stringify(source, null, 2));
    await fs.writeFile(path.join(out, `${size.width}-jiangnan-source-input.json`), sourceBytes);
    await sourceInput.setInputFiles({ name: '江南来源说明.json', mimeType: 'application/json', buffer: sourceBytes });
    await expect(error).toHaveCount(0);
    const loaded = form.getByRole('status').filter({ hasText: '已加载“江南来源说明.json”' });
    await expect(loaded).toBeVisible();
    await loaded.scrollIntoViewIfNeeded();
    await capture('江南加载完整原列口径与原件定位');
    const previewResponse = await manufacturerAction(page.waitForResponse(response => response.url().endsWith('/api/type-library/imports/preview') && response.request().method() === 'POST', { timeout: 180000 }),
      () => activateManufacturer(page.getByRole('button', { name: '逐行校验并预览', exact: true })));
    assert.equal(previewResponse.status(), 200, await previewResponse.text());
    const request = previewResponse.request().postDataJSON(), preview = await previewResponse.json();
    await recordManufacturerResponse('jiangnan-preview', previewResponse, preview);
    assert.deepEqual(request.mapping, mapping);
    assert.deepEqual(request.series.source, source, '来源附件必须经实际表单保存到预览请求');
    assert.deepEqual([request.series.u0_v, request.series.u_v, request.series.cores, request.series.origin, request.series.resistance_basis], [declaration.u0_v, declaration.u_v, declaration.cores, declaration.origin, declaration.resistance_basis]);
    assert.equal(preview.series.resistance_basis, 'stated', '预览必须保留选择的电阻缺项策略');
    assert.equal(request.series.um_v ?? null, null);
    assert.equal(request.series.armour_material ?? null, null, '原文只称钢带，不猜镀锌钢等具体类别');
    for (const key of ['common', 'common_basis', 'modelling']) assert.deepEqual(request.series[key], {}, '加载来源不得填充结构或工况');
    assert.deepEqual(request.series.standards, []);
    assert.deepEqual([preview.rows.length, preview.valid_count, preview.error_count, preview.incomplete_count], [9, 9, 0, 9]);
    assert.deepEqual(preview.execution_standards.items, []);
    for (const [index, row] of preview.rows.entries()) {
      assert.equal(row.status, 'incomplete');
      assert.equal(row.row_number, index + 2);
      assert.ok(row.missing.includes('20 °C 导体直流电阻'));
      assert.deepEqual(row.payload.materials, []);
      assert.equal(row.payload.cable_type, null);
      assert.deepEqual(row.values.map(value => value.key).sort(), Object.keys(mapping).sort());
      for (const fact of row.values) {
        const [displayUnit, siUnit, scale] = units[fact.key], original = originalRows[index][mapping[fact.key]];
        assert.equal(fact.display_value, original); assert.equal(fact.display_unit, displayUnit); assert.equal(fact.unit, siUnit);
        assert.ok(Math.abs(fact.value - original * scale) < 1e-12);
        assert.equal(fact.confidence, 'reference');
        assert.deepEqual(fact.method, { name: '厂家结构表导入', version: '1.1.0' });
        assert.deepEqual(fact.source.catalogue, source);
        assert.deepEqual([fact.source.file, fact.source.file_sha256, fact.source.sheet, fact.source.row, fact.source.column],
          [uploadName, expectedDigest, sheet.name, index + 2, String.fromCharCode(65 + mapping[fact.key])]);
      }
    }
    await expect(page.getByRole('heading', { name: '核对入库预览', exact: true })).toBeVisible();
    await capture('江南九规格真实原值与缺项预览');
    const commit = page.getByRole('button', { name: '确认入库 9 个规格', exact: true });
    await expect(commit).toBeDisabled();
    const confirmed = page.getByRole('checkbox', { name: '确认来源与系列声明', exact: true });
    if (size.width === 1366) { await confirmed.focus(); await expect(confirmed).toBeFocused(); await confirmed.press('Space'); }
    else await confirmed.check();
    await expect(confirmed).toBeChecked();
    const commitResponse = await manufacturerAction(page.waitForResponse(response => response.url().endsWith('/api/type-library/imports/commit') && response.request().method() === 'POST', { timeout: 180000 }), () => activateManufacturer(commit));
    assert.equal(commitResponse.status(), 201, await commitResponse.text());
    const receipt = await commitResponse.json();
    await recordManufacturerResponse('jiangnan-commit', commitResponse, receipt);
    assert.equal(receipt.created, 9);
    assert.equal(commitResponse.request().postDataJSON().human_confirmed, true);
    await expect(page.getByRole('heading', { name: '已保存 9 个规格草稿', exact: true })).toBeVisible();
    await capture('江南九规格人工确认保存草稿');
    await activateManufacturer(page.getByRole('button', { name: '打开系列，核对与计算', exact: true }));
    const series = await api('/api/type-library/series/' + receipt.series_id);
    assert.equal(series.specs.length, 9);
    const readbacks = await Promise.all(series.specs.map(spec => api('/api/type-library/specs/' + spec.id)));
    for (const detail of readbacks) {
      const expected = preview.rows.find(row => Math.abs(row.area_m2 - detail.spec.area_m2) < 1e-14);
      assert.ok(expected);
      assert.deepEqual(detail.values, expected.values, '入库逐值来源必须与人工确认的预览一致');
      assert.equal(detail.spec.state, 'draft');
    }
    await fs.writeFile(path.join(out, `${size.width}-jiangnan-imported-values.json`), JSON.stringify({
      fixture_csv: 'tests/fixtures/jiangnan_yjv22.csv', uploaded_name: uploadName, csv_sha256: expectedDigest,
      source_input_sha256: createHash('sha256').update(sourceBytes).digest('hex'), source, series, specifications: readbacks,
    }, null, 2));
    const specification = series.specs.find(spec => Math.abs(spec.area_m2 * 1e6 - 95) < 1e-9);
    assert.ok(specification);
    await page.getByRole('table', { name: '系列规格', exact: true }).getByRole('button', { name: specification.name, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: specification.name, exact: true });
    const values = dialog.getByRole('table', { name: '逐项来源', exact: true });
    await expect(values.getByRole('row')).toHaveCount(5);
    for (const [key, label] of [['weight', '江南最大重量口径与原件网址'], ['outer_diameter', '江南三乘95原刊86点3毫米外径']]) {
      const fact = specification.values.find(value => value.key === key), original = source.column_meanings[key];
      const row = values.getByRole('row', { name: fact.label, exact: true });
      await expect(row).toContainText('原列口径：' + original.quantity);
      await expect(row).toContainText('原列单位：' + original.unit);
      await expect(row.getByRole('cell').nth(1)).toHaveText(`${fact.display_value} ${fact.display_unit}`);
      await expect(row.getByRole('cell').nth(2)).toContainText(source.locator);
      const link = row.getByRole('link', { name: '查看来源原件', exact: true });
      await expect(link).toHaveAttribute('href', source.url);
      await expect(link).toHaveAttribute('title', source.url);
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      await positionManufacturerSource(row);
      await expect(row).toBeInViewport({ ratio: 1 });
      await expect(link).toBeInViewport({ ratio: 1 });
      await capture(label);
    }
    await dialog.getByText('原件声明与限制', { exact: true }).click();
    const anomaly = metadata.limitations.find(note => note.includes('86.3'));
    assert.equal(anomaly, '原表3×95 mm²近似外径为86.3 mm，小于相邻规格，按原值保留，须厂家复核。');
    const note = dialog.getByText(anomaly, { exact: true });
    await positionManufacturerSource(note);
    await expect(note).toBeInViewport({ ratio: 1 });
    await capture('江南86点3原值与来源复核说明');
    await page.keyboard.press('Escape'); await expect(dialog).toBeHidden();

    // Leave the receipt, locate the saved series through the real library list,
    // then reload its public address so no in-memory wizard preview can supply it.
    await activateManufacturer(page.getByRole('button', { name: '全部系列', exact: true }));
    const seriesSearch = page.getByRole('textbox', { name: '查找系列', exact: true });
    await seriesSearch.fill(seriesName);
    const seriesEntry = page.getByRole('table', { name: '型号系列', exact: true })
      .getByRole('button', { name: seriesName, exact: true });
    await expect(seriesEntry).toBeVisible();
    if (size.width === 1366) { await seriesEntry.focus(); await seriesEntry.press('Enter'); }
    else await seriesEntry.click();
    await expect.poll(() => new URL(page.url()).searchParams.get('item')).toBe(receipt.series_id);
    const savedTable = page.getByRole('table', { name: '系列规格', exact: true });
    await expect(savedTable.getByRole('row')).toHaveCount(10);
    await expect(savedTable).toContainText('20 °C 导体直流电阻');
    await capture('manufacturer-saved-series-reopened');
    const readPath = '/api/type-library/series/' + encodeURIComponent(receipt.series_id);
    const [coldResponse] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === readPath && response.request().method() === 'GET', { timeout: 90000 }),
      page.reload({ waitUntil: 'domcontentloaded' }),
    ]);
    assert.equal(coldResponse.status(), 200);
    const coldSeries = await coldResponse.json();
    assert.deepEqual(coldSeries, series, '冷刷新实际 GET 必须返回同一系列、九行缺项草稿与原来源');
    await expect(page.getByRole('tab', { name: '系列与规格', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('heading', { name: seriesName, exact: true })).toBeVisible();
    await expect(savedTable.getByRole('row')).toHaveCount(10);
    await capture('manufacturer-saved-series-cold-reload');
    const coldReadbacks = await Promise.all(series.specs.map(spec => api('/api/type-library/specs/' + encodeURIComponent(spec.id))));
    assert.deepEqual(coldReadbacks, readbacks, '冷刷新后九个规格原值、SI、单位、草稿版本与来源必须逐项一致');
    await savedTable.getByRole('button', { name: specification.name, exact: true }).click();
    const coldDialog = page.getByRole('dialog', { name: specification.name, exact: true });
    const coldValues = coldDialog.getByRole('table', { name: '逐项来源', exact: true });
    await expect(coldValues.getByRole('row')).toHaveCount(5);
    for (const key of Object.keys(mapping)) {
      const fact = specification.values.find(value => value.key === key);
      const original = source.column_meanings[key];
      const row = coldValues.getByRole('row', { name: fact.label, exact: true });
      await expect(row.getByRole('cell').nth(1)).toHaveText(fact.display_value + ' ' + fact.display_unit);
      await expect(row).toContainText('原列口径：' + original.quantity);
      await expect(row).toContainText('原列单位：' + original.unit);
      await expect(row.getByRole('cell').nth(2)).toContainText(source.locator);
      await expect(row.getByRole('cell').nth(2)).toContainText(uploadName);
      await expect(row.getByRole('cell').nth(2)).toContainText('第 4 行');
      const link = row.getByRole('link', { name: '查看来源原件', exact: true });
      await expect(link).toHaveAttribute('href', source.url);
      await expect(link).toHaveAttribute('title', source.url);
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      await positionManufacturerSource(row);
      await expect(row).toBeInViewport({ ratio: 1 });
      await expect(link).toBeInViewport({ ratio: 1 });
      await capture('manufacturer-cold-source-' + key);
    }
    await coldDialog.getByText('原件声明与限制', { exact: true }).click();
    const coldAnomaly = coldDialog.getByText(anomaly, { exact: true });
    await positionManufacturerSource(coldAnomaly);
    await expect(coldAnomaly).toBeInViewport({ ratio: 1 });
    await capture('manufacturer-cold-original-anomaly');
    await page.keyboard.press('Escape');
    await expect(coldDialog).toBeHidden();
    const importWrites = report.writes.slice(startWrites);
    assert.deepEqual(importWrites, [
      { method: 'POST', path: '/api/type-library/imports/upload' },
      { method: 'POST', path: '/api/type-library/imports/preview' },
      { method: 'POST', path: '/api/type-library/imports/commit' },
    ], '结构表五步只允许真实上传、预览和确认入库；重开与冷刷新不得计算、批准或另写版本');
    (report.manufacturerImports ||= []).push({
      width: size.width, upload: { name: uploadName, sha256: expectedDigest, originalTableSha256: originalTableDigest },
      source, uploadInspection: inspection, request, preview, receipt, series, readbacks, coldSeries, coldReadbacks, writes: importWrites,
    });
    await check('公开厂家 CSV 五步入库后从系列库重开及冷刷新逐值来源一致', true, {
      fileSha256: expectedDigest, originalTableSha256: originalTableDigest, locator: source.locator,
      rows: preview.rows.length, incomplete: preview.incomplete_count, errors: preview.error_count,
      seriesId: receipt.series_id, specificationIds: series.specs.map(spec => spec.id),
      original95mm2: originalRows[2], missingR20: true, states: readbacks.map(detail => detail.spec.state), writes: importWrites,
    });

    // Distinct PDF intake remains accessible; do not confuse it with CSV/XLS.
    await page.locator('.topbar-actions').getByRole('link', { name: '电缆型号版本', exact: true }).click();
    await expect(page.getByRole('heading', { name: '电缆型号版本', exact: true, level: 1 })).toBeVisible();
    await page.locator('.topbar-actions').getByRole('button', { name: '提取厂家 PDF', exact: true }).click();
    await expect(page).toHaveURL(/\/resources\/cables\/imports(?:\?|$)/);
    const pdfFormats = await page.getByLabel('上传 PDF 文件', { exact: true }).getAttribute('accept');
    await check('PDF 与 Excel/CSV 使用不同的真实入口', /\.pdf/.test(pdfFormats || '') && !/xlsx|csv/.test(pdfFormats || ''),
      { pdfFormats, workbookFormats: formats });
    await capture('manufacturer-pdf-entry');
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
        if (after) {
          const previous = await rows.evaluateAll(nodes => nodes.map(node => node.id));
          await next.click();
          await expect(main).toContainText('第 2 页');
          await expect(page.getByText('正在读取资源', { exact: true })).toHaveCount(0);
          check('资源翻页读取其他真实记录', JSON.stringify(await rows.evaluateAll(nodes => nodes.map(node => node.id))) !== JSON.stringify(previous));
          await capture(`${group}-second-page`);
          await main.getByRole('button', { name: '上一页资源', exact: true }).click();
        }
      }
    });

    if (after && group === 'materials') await branch('分用途材料参考物性与完整来源可读', async () => {
      const catalogue = await api('/api/foundation/assets?kind=material&status=published&q=PVC&limit=100&offset=0');
      const candidates = catalogue.items.filter(item => item.name.includes('分用途标准参考'));
      expect(candidates, '真实发布库中须有分用途 PVC 参考材料').toHaveLength(1);
      const asset = await searchResource('materials', candidates[0].name, candidates[0].version);
      const references = asset.release.sources.flatMap(source => {
        try {
          const value = JSON.parse(source.reference);
          return value.schema === 'cablesim.reference-data/1' && typeof value.property === 'string' && typeof value.value === 'number' ? [value] : [];
        } catch { return []; }
      });
      expect(references.length).toBeGreaterThanOrEqual(4);
      const section = properties.locator('section').filter({ has: page.getByRole('heading', { name: '参考物性', exact: true }) });
      const rows = section.locator('.property-row');
      await expect(rows).toHaveCount(references.length);
      await section.scrollIntoViewIfNeeded();
      await capture('material-long-property-labels-and-complete-source-badges');
      for (let index = 0; index < references.length; index++) {
        const row = rows.nth(index), reference = references[index];
        await row.scrollIntoViewIfNeeded();
        expect(await row.locator('dd').evaluate(node => node.firstChild.textContent.trim())).toBe(String(reference.value));
        const geometry = await row.evaluate(node => {
          const panel = node.closest('.property-panel'), box = panel.getBoundingClientRect();
          const left = box.left + panel.clientLeft, right = left + panel.clientWidth;
          const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT), clipped = [];
          while (walker.nextNode()) {
            if (!walker.currentNode.textContent.trim()) continue;
            const range = document.createRange(); range.selectNodeContents(walker.currentNode);
            for (const rect of range.getClientRects()) if (rect.width && (rect.left < left - 1 || rect.right > right + 1)) clipped.push(walker.currentNode.textContent.trim());
          }
          return { clipped, width: panel.clientWidth, scrollWidth: panel.scrollWidth };
        });
        check('材料物性名称数值单位和来源标记完整显示', geometry.clipped.length === 0 && geometry.scrollWidth <= geometry.width + 1,
          { resource: asset.id, property: reference.property, value: reference.value, ...geometry });
        const source = row.getByRole('button', { name: '来源：标准', exact: true });
        await expect(source).toBeInViewport({ ratio: 1 });
        await source.focus();
        const tooltip = page.getByRole('tooltip');
        await expect(tooltip).toContainText(reference.standard);
        if (reference.source_digest) await expect(tooltip).toContainText(reference.source_digest);
        if (index === 0) await capture('material-source-evidence-keyboard-focus');
        const tooltipGeometry = await tooltip.evaluate(node => {
          const box = node.getBoundingClientRect(), style = getComputedStyle(node);
          const bounds = { left: box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
            right: box.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight),
            top: box.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop),
            bottom: box.bottom - parseFloat(style.borderBottomWidth) - parseFloat(style.paddingBottom) };
          const inside = rect => rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1
            && rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1;
          const rectOf = rect => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
          const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT), lines = [], clipped = [];
          while (walker.nextNode()) {
            const text = walker.currentNode;
            if (!text.textContent.trim() || text.parentElement.closest('[aria-hidden="true"],svg')) continue;
            const range = document.createRange(); range.selectNodeContents(text);
            for (const rect of range.getClientRects()) if (rect.width && rect.height) {
              lines.push(rectOf(rect));
              if (!inside(rect)) clipped.push({ text: text.textContent.trim(), ...rectOf(rect) });
            }
          }
          const content = node.querySelector('.source-badge-detail'), contentBox = content?.getBoundingClientRect();
          return { bounds, box: rectOf(box), lines, clipped,
            contentInside: !!contentBox && inside(contentBox),
            inViewport: box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight };
        });
        check('材料来源浮层完整文字逐行位于浮层与视口内', tooltipGeometry.inViewport && tooltipGeometry.contentInside
          && tooltipGeometry.lines.length > 0 && tooltipGeometry.clipped.length === 0,
        { resource: asset.id, property: reference.property, ...tooltipGeometry });
        await page.keyboard.press('Escape');
        await expect(tooltip).toBeHidden();
        await source.hover();
        await expect(tooltip).toContainText(reference.standard);
        await page.mouse.move(0, 0, { steps: 5 });
        await page.mouse.move(1, 1);
        await expect(tooltip).toBeHidden();
      }
      check('材料每条标准来源可通过键盘焦点与鼠标悬停读取', true, { resource: asset.id, references: references.length });
    });

    let typed, imported, versions;
    if (after) typed = await branch(`${groupTitles[group]}表单新建与单位`, () => typedResource(group, kind, parameters[0]));
    await branch(`${groupTitles[group]}导入和草稿闭环`, async () => {
      await openGroup(group);
      imported = await importResource(group, kind, parameters);
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
    if (after && imported) versions = await branch(`${groupTitles[group]}编辑审核发布派生与停用`, () => lifecycle(group, imported, typed));
    if (after && typed && versions) await branch(`${groupTitles[group]}批量导出核对与发布`, () => batch(group, typed, versions));
    if (after && versions && kind === 'material') await branch(`${groupTitles[group]}历史固定引用与新版本资格`, () => verifyPinnedHistory(group, versions));
    if (after && group === 'templates') await branch('核对组织模板应用契约边界', async () => {
      await openGroup(group);
      const writesBefore = report.writes.length;
      const genericId = versions?.derived.id || typed?.id || imported?.id;
      check('普通组织模板边界使用本轮真实建立的版本', !!genericId);
      check('普通组织模板边界有真实隔离目标', !!referenceWorkspace,
        '型号创建步骤未完成，不能用空目标证明原工程不变。');
      const generic = await api('/api/foundation/assets/' + genericId);
      const targetBefore = await api('/api/workspaces/' + referenceWorkspace.id);
      const selected = await searchResource(group, generic.name, generic.version);
      check('普通模板负向检查选中准确版本', selected?.id === genericId &&
        ['installation', 'study_template'].includes(selected.kind) &&
        JSON.stringify(selected) === JSON.stringify(generic), { expected: genericId, selected: selected?.id });
      await main.locator('summary').filter({ hasText: '模板作用域' }).click();
      await expect(main).toContainText('这些定义不含从保存输入捕获的应用内容，不能直接应用到工程布置或研究参数');
      await expect(main.getByRole('link', { name: '从保存输入建立与应用资源', exact: true })).toBeVisible();
      const creation = await api('/api/types/creation-options');
      const bindings = await api('/api/types/' + referenceWorkspace.id + '/resources');
      const application = properties.getByRole('button', { name: /应用到工程|应用到研究|加入工程结构|引用到型号|绑定部件|绑定结构|采用.*模板/ });
      const shot = await capture('organization-template-application-contract-boundary');
      const current = await api('/api/foundation/assets/' + genericId);
      const targetAfter = await api('/api/workspaces/' + referenceWorkspace.id);
      const detail = { id: genericId, kind: generic.kind, screenshot: shot.screenshot,
        target: referenceWorkspace.id, visibleApplicationActions: await application.count(),
        inTypeCreation: creation.library.some(item => item.id === genericId),
        inTypeBindings: bindings.resources.some(item => item.id === genericId),
        targetUnchanged: JSON.stringify(targetAfter) === JSON.stringify(targetBefore),
        directApplicationSupported: false, writes: report.writes.slice(writesBefore),
        positiveApplicationJourney: '保存输入部件与研究模板真实应用闭环' };
      check('普通目录模板明确应用边界并提供保存输入应用入口',
        generic.release.application == null && detail.visibleApplicationActions === 0 &&
        detail.inTypeCreation === false && detail.inTypeBindings === false &&
        JSON.stringify(current) === JSON.stringify(generic) && detail.targetUnchanged &&
        report.writes.length === writesBefore, detail);
      report.contractBoundaries ||= [];
      report.contractBoundaries.push({ ...size, ...detail,
        detail: '普通目录定义没有应用内容；其发布不算工程引用。另行真实走查从保存输入捕获的固定资源。' });
    });
  }

  if (after) {
    for (const spec of [
      { table: 'huang-TableA1', record: 'huang-TableA1/r1/density', parameter: 'mass_density', dimension: 'mass_density',
        label: '密度', unit: 'kg/m3', sourceUnit: 'kg/m³', displayUnit: 'kg/m³', sourceKind: 'literature' },
      { table: 'iec60287-1-1-table1', record: 'iec60287-1-1-table1/r1/c1', parameter: 'resistivity_20_ohm_m', dimension: 'resistivity',
        label: '20 °C 电阻率', unit: 'ohm.m', sourceUnit: 'Ω·m', displayUnit: 'Ω·m', sourceKind: 'standard' },
      { table: 'nielsen-Table1', record: 'nielsen-Table1/r1/capacity', parameter: 'volumetric_heat_capacity', dimension: 'volumetric_heat_capacity',
        label: '体积热容', unit: 'J/(m3.K)', sourceUnit: 'J/(m³·K)', displayUnit: 'J/(m³·K)', sourceKind: 'literature' },
      { table: 'iec60287-1-1-table3', record: 'iec60287-1-1-table3/r1/relative_permittivity', parameter: 'relative_permittivity', dimension: 'dimensionless',
        label: '相对介电常数', unit: '1', sourceUnit: '1', displayUnit: '1（无量纲）', sourceKind: 'standard' },
    ]) await branch('资料物性 typed 录入与原文单位回读：' + spec.label, () => verifyMaterialQuantity(spec));

    const standard = await branch('由真实型号条件声明执行标准并核对原始来源', declareSourcedStandard);
    if (standard) {
      const versionBase = standard.source.version.split('-')[0];
      const versions = await branch('从真实标准建立隔离本地版本并明确核对发布', async () => {
        let original = await deriveSourcedStandard(standard.source, `${versionBase}-t1-${marker}-first`);
        original = await transition('standards', original, 'review', '核对来源', standard.declaration);
        original = await transition('standards', original, 'publish', '发布', standard.declaration);
        const derived = await deriveSourcedStandard(original, `${versionBase}-t1-${marker}-next`);
        return { original, derived };
      });
      if (versions) {
        await branch('真实标准固定引用到型号且下一草稿不能新选', () =>
          bindPublishedResource('standards', versions.original, versions.derived, standard.target));
        await branch('固定标准资源深链接冷打开刷新与键鼠页签往返', () => verifyStandardDeepLink(versions.original));
        const changed = await branch('仅停用隔离旧版本并发布保留出处的新版本', async () => {
          await openGroup('standards');
          const original = await transition('standards', versions.original, 'deprecate', '停用', standard.declaration);
          let derived = await transition('standards', versions.derived, 'review', '核对来源', standard.declaration);
          derived = await transition('standards', derived, 'publish', '发布', standard.declaration);
          return { original, derived };
        });
        if (changed) await branch('真实标准旧固定引用保留与新版本选择取消', () => verifyPinnedHistory('standards', changed));
      }
      await branch('标准引用走查未改写原始种子标准', async () => {
        for (const original of standard.originals) {
          const saved = await api(`/api/foundation/assets/${original.id}`);
          check('原始标准版本状态修订摘要和全部出处保持不变', saved.status === original.status && saved.revision === original.revision
            && saved.content_sha256 === original.content_sha256 && JSON.stringify(saved.release) === JSON.stringify(original.release)
            && JSON.stringify(saved.events) === JSON.stringify(original.events),
          { id: saved.id, name: saved.name, version: saved.version, revision: saved.revision, digest: saved.content_sha256 });
        }
      });
    }

    await branch('标准参考与修改后计算参数分别显示并导出单项', async () => {
      const catalogue = await api('/api/foundation/assets?kind=material&status=published&q=XLPE&limit=100&offset=0');
      let source;
      for (const candidate of catalogue.items) {
        const asset = await api(`/api/foundation/assets/${candidate.id}`);
        const parameter = asset.release.parameters.find(item => item.name === 'thermal_resistivity');
        const reference = asset.release.sources.some(item => {
          if (item.kind !== 'standard') return false;
          try {
            const value = JSON.parse(item.reference);
            return value.schema === 'cablesim.reference-data/1' && value.property === 'thermal_resistivity'
              && value.value === 3.5 && value.unit === 'K.m/W';
          } catch { return false; }
        });
        if (reference && parameter?.quantity.value === 3.5 && parameter.quantity.unit === 'K.m/W') { source = asset; break; }
      }
      expect(source, '真实发布库须提供同时保存 3.5 热阻率及其标准出处的 XLPE 参考材料').toBeTruthy();
      await openGroup('materials');
      await searchResource('materials', source.name, source.version);
      await properties.getByRole('button', { name: '派生新版本', exact: true }).click();
      const derive = page.getByRole('dialog', { name: '派生新版本', exact: true });
      const version = '2.0.0-' + marker;
      await derive.getByRole('textbox', { name: '新版本号', exact: true }).fill(version);
      await derive.getByRole('button', { name: '建立新版本草稿', exact: true }).click();
      await expect(derive).toBeHidden();
      const draft = await inspectSelectedResource(source.name);
      expect(draft.id).not.toBe(source.id);
      expect(draft.version).toBe(version);
      await properties.getByRole('button', { name: '编辑资源草稿', exact: true }).click();
      const editor = page.getByRole('dialog', { name: '编辑资源草稿', exact: true });
      const index = draft.release.parameters.findIndex(item => item.name === 'thermal_resistivity');
      await editor.getByRole('textbox', { name: `参数数值 ${index + 1}`, exact: true }).fill('3.6');
      await editor.getByRole('button', { name: '新增来源', exact: true }).click();
      await editor.getByRole('textbox', { name: `来源说明 ${draft.release.sources.length + 1}`, exact: true })
        .fill('隔离浏览器验收：3.6 是明确填写的测试计算值；原标准参考 3.5 及出处保持原文，不将测试值声明为标准或厂家数据。');
      await editor.getByRole('button', { name: '保存资源草稿', exact: true }).click();
      await expect(editor).toBeHidden();
      const saved = await inspectSelectedResource(source.name);
      expect(saved.release.parameters[index].quantity).toEqual({ ...source.release.parameters[index].quantity, value: 3.6 });
      expect(saved.release.sources.slice(0, source.release.sources.length)).toEqual(source.release.sources);
      expect(saved.release.sources.at(-1)).toMatchObject({ kind: 'project_input', reviewed: false });
      expect(saved.status).toBe('draft');
      const originalReference = properties.locator('section').filter({ has: page.getByRole('heading', { name: '参考物性', exact: true }) });
      const actualParameters = properties.locator('section').filter({ has: page.getByRole('heading', { name: '计算参数', exact: true }) });
      const propertyRow = section => section.locator('.property-row').filter({ has: page.getByText('热阻率', { exact: true }) });
      await expect(propertyRow(originalReference).locator('dd')).toContainText('3.5');
      await originalReference.scrollIntoViewIfNeeded();
      await capture('material-original-reference-preserved');
      await expect(propertyRow(actualParameters).locator('dd')).toContainText('3.6');
      await actualParameters.scrollIntoViewIfNeeded();
      await capture('material-edited-calculation-value-visible');
      check('计算参数3.6与原标准参考3.5分别显示且保留来源', true, { id: saved.id,
        calculation: saved.release.parameters[index], references: saved.release.sources, original: source.id });

      await properties.getByRole('button', { name: '导出资源定义', exact: true }).click();
      const exportDialog = page.getByRole('dialog', { name: '导出定义', exact: true });
      await expect(exportDialog.locator('[data-resource-state="ready"]')).toHaveCount(1);
      const downloaded = page.waitForEvent('download');
      await exportDialog.getByRole('button', { name: '下载 1 项定义', exact: true }).click();
      const file = await downloaded, filename = path.join(out, `material-single-definition-${size.width}.json`);
      await file.saveAs(filename);
      const exported = JSON.parse(await fs.readFile(filename, 'utf8'));
      expect(exported.schema_version).toBe('cablesim.resource-export/1');
      expect(exported.items).toHaveLength(1);
      for (const key of ['id', 'asset_id', 'version', 'revision', 'content_sha256', 'status']) expect(exported.items[0][key], '单项导出的 ' + key).toBe(saved[key]);
      expect(exported.items[0].definition).toEqual({ schema_version: 'csp-asset/0.1', release: saved.release });
      check('单项导出保留真实身份修订摘要状态及完整定义', true, { filename: path.basename(filename), id: saved.id, revision: saved.revision, digest: saved.content_sha256 });
      await exportDialog.getByRole('button', { name: '关闭', exact: true }).click();
      await page.locator('.topbar-actions').getByRole('button', { name: '导入资源草稿', exact: true }).click();
      const importDialog = page.getByRole('dialog', { name: '导入资源草稿', exact: true });
      await importDialog.locator('input[type=file]').setInputFiles(filename);
      await expect(importDialog.getByRole('textbox', { name: '定义内容', exact: true })).toHaveValue(await fs.readFile(filename, 'utf8'));
      await expect(importDialog.getByRole('button', { name: '校验并导入', exact: true })).toBeEnabled();
      await capture('single-export-readable-by-import');
      // The same immutable identity already exists in this host. Check that the
      // real file reader accepts the wrapper, then cancel instead of duplicating it.
      await importDialog.getByRole('button', { name: '关闭', exact: true }).click();
      const original = await api(`/api/foundation/assets/${source.id}`);
      check('材料草稿改值及单项导出没有覆盖原发布版本', original.revision === source.revision && original.content_sha256 === source.content_sha256
        && JSON.stringify(original.release) === JSON.stringify(source.release));
    });

    await branch('跨类别返回隔离迟到写入并恢复原请求', async () => {
      await openGroup('templates');
      const templateUrl = page.url();
      await openGroup('materials');
      await page.locator('.topbar-actions').getByRole('button', { name: '新建资源', exact: true }).click();
      const editor = page.getByRole('dialog', { name: '新建资源', exact: true });
      const name = '隔离验收延迟保存-' + marker;
      await editor.getByRole('textbox', { name: '资源名称', exact: true }).fill(name);
      await editor.getByRole('textbox', { name: '来源说明 1', exact: true }).fill('隔离浏览器验收：验证真实保存请求迟到时的类别隔离和收据恢复，仅为资源元数据测试。');
      let releaseRequest, finishRequest, held = false;
      const release = new Promise(resolve => { releaseRequest = resolve; });
      const finished = new Promise(resolve => { finishRequest = resolve; });
      const endpoint = url => url.pathname === '/api/foundation/assets/import';
      const holdRequest = async route => {
        if (route.request().method() !== 'POST' || held) return route.continue();
        held = true;
        try { await release; await route.continue(); }
        finally { finishRequest(); }
      };
      // Only delay the original UI request. The request body and the eventual
      // host response are untouched: no route.fetch, fulfill or synthetic result.
      await page.route(endpoint, holdRequest);
      try {
        await editor.getByRole('button', { name: '保存资源草稿', exact: true }).click();
        await expect.poll(() => held).toBe(true);
        await page.goBack();
        await expect(page).toHaveURL(templateUrl);
        await expect(editor).toBeHidden();
        await expect(main.getByRole('textbox', { name: '检索', exact: true })).toHaveValue('');
        await capture('resource-back-closes-previous-category-dialog');
        const response = page.waitForResponse(value => new URL(value.url()).pathname === '/api/foundation/assets/import' && value.request().method() === 'POST');
        releaseRequest();
        const received = await response;
        expect(received.ok(), '延迟后必须由真实宿主成功保存资源').toBeTruthy();
        const created = await received.json();
        await received.finished();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await expect(page).toHaveURL(templateUrl);
        await expect(main.getByRole('textbox', { name: '检索', exact: true })).toHaveValue('');
        const saved = await api(`/api/foundation/assets/${created.id}`);
        expect(saved).toMatchObject({ name, kind: 'material', status: 'draft', revision: 1 });
        await expect(main.getByRole('button', { name: '恢复未确认保存', exact: true })).toBeVisible();
        check('原类别迟到保存没有改写当前类别筛选或选中项', true, { from: 'materials', current: page.url(), saved: saved.id });
        await capture('resource-late-response-keeps-current-category');

        await main.getByRole('button', { name: '恢复未确认保存', exact: true }).click();
        const recovery = page.getByRole('dialog', { name: '新建资源', exact: true });
        await expect(recovery.getByRole('combobox', { name: '资源类别', exact: true })).toContainText('材料');
        await recovery.getByRole('button', { name: '核实保存结果', exact: true }).click();
        await expect(recovery).toBeHidden();
        await expect(page).toHaveURL(templateUrl);
        await expect(main.getByRole('textbox', { name: '检索', exact: true })).toHaveValue('');
        await expect(main.getByText(`材料“${name}” · 1.0.0 已保存，当前资源类别与选择保持不变。`, { exact: true })).toBeVisible();
        await capture('resource-cross-category-recovery-explicit-result');
        await main.getByRole('button', { name: '打开该资源', exact: true }).click();
        await expect(page).toHaveURL(/\/resources\/materials\?/);
        expect(new URL(page.url()).searchParams.get('item')).toBe(saved.id);
        const inspected = await inspectSelectedResource(name);
        const matches = await api(`/api/foundation/assets?kind=material&q=${encodeURIComponent(name)}&limit=50&offset=0`);
        check('跨类别核实保留原请求且仅显式打开材料结果', inspected.id === saved.id && inspected.revision === 1
          && matches.items.filter(item => item.name === name).length === 1, { id: saved.id, matches: matches.total });
      } finally {
        releaseRequest();
        if (held) await finished;
        await page.unroute(endpoint, holdRequest);
      }
    });

    await branch('导入关闭后的迟到成功保持当前类别并提供结果入口', async () => {
      await openGroup('templates');
      const templateUrl = page.url();
      await openGroup('materials');
      await page.locator('.topbar-actions').getByRole('button', { name: '导入资源草稿', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '导入资源草稿', exact: true });
      const name = '隔离验收延迟导入-' + marker;
      const definition = { schema_version: 'csp-asset/0.1', release: {
        asset_id: 'local.walkthrough.import-late.' + marker, version: '1.0.0', kind: 'material', name,
        parameters: [], dependencies: [], files: [], geometry_recipe: null,
        sources: [{ kind: 'project_input', reviewed: false,
          reference: '隔离浏览器验收：验证真实导入响应迟到时的结果通知，仅为资源元数据测试，不提供工程物性。' }],
      } };
      await dialog.locator('input[type=file]').setInputFiles({
        name: 'material-import.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(definition)),
      });
      await expect(dialog.getByRole('textbox', { name: '定义内容', exact: true })).toHaveValue(JSON.stringify(definition));
      let releaseRequest, finishRequest, held = false;
      const release = new Promise(resolve => { releaseRequest = resolve; });
      const finished = new Promise(resolve => { finishRequest = resolve; });
      const endpoint = url => url.pathname === '/api/foundation/assets/import';
      const holdRequest = async route => {
        if (route.request().method() !== 'POST' || held) return route.continue();
        held = true;
        try { await release; await route.continue(); }
        finally { finishRequest(); }
      };
      // Delay the actual UI import only; its body and host response stay intact.
      await page.route(endpoint, holdRequest);
      try {
        await dialog.getByRole('button', { name: '校验并导入', exact: true }).click();
        await expect.poll(() => held).toBe(true);
        await page.goBack();
        await expect(page).toHaveURL(templateUrl);
        await expect(dialog).toBeHidden();
        await expect(main.getByRole('textbox', { name: '检索', exact: true })).toHaveValue('');
        const response = page.waitForResponse(value => new URL(value.url()).pathname === '/api/foundation/assets/import' && value.request().method() === 'POST');
        releaseRequest();
        const received = await response;
        expect(received.ok(), '关闭导入后仍须由真实宿主返回保存结果').toBeTruthy();
        const created = await received.json();
        await received.finished();
        await expect(main.getByText(`材料“${name}” · 1.0.0 已保存，当前资源类别与选择保持不变。`, { exact: true })).toBeVisible();
        await expect(page).toHaveURL(templateUrl);
        await expect(main.getByRole('textbox', { name: '检索', exact: true })).toHaveValue('');
        await expect(main.getByRole('button', { name: '恢复未确认保存', exact: true })).toHaveCount(0);
        await capture('resource-import-late-success-visible-without-navigation');
        await main.getByRole('button', { name: '打开该资源', exact: true }).click();
        await expect(page).toHaveURL(/\/resources\/materials\?/);
        expect(new URL(page.url()).searchParams.get('item')).toBe(created.id);
        const saved = await inspectSelectedResource(name);
        const matches = await api(`/api/foundation/assets?kind=material&q=${encodeURIComponent(name)}&limit=50&offset=0`);
        check('关闭导入后的实际成功有明确通知且只在点击后打开原版本', saved.id === created.id && saved.status === 'draft'
          && saved.revision === 1 && matches.items.filter(item => item.name === name).length === 1,
        { id: saved.id, revision: saved.revision, current: page.url() });
        await capture('resource-import-late-success-explicit-open');
      } finally {
        releaseRequest();
        if (held) await finished;
        await page.unroute(endpoint, holdRequest);
      }
    });

    for (const kind of ['component', 'assembly']) await branch(`${knownKindLabels[kind]}发布后工程引用边界`, async () => {
      await openGroup('materials');
      // These are explicitly labelled metadata-only test definitions. They do
      // not claim a production geometry or a validated engineering property.
      let asset = await importResource('materials', kind, []);
      asset = await transition('materials', asset, 'review', '核对来源');
      asset = await transition('materials', asset, 'publish', '发布');
      check('普通部件或结构边界有真实隔离目标', !!referenceWorkspace,
        '型号创建步骤未完成，不能用空目标证明原工程不变。');
      const boundaryWrites = report.writes.length;
      const targetBefore = await api('/api/workspaces/' + referenceWorkspace.id);
      const selected = await searchResource('materials', asset.name, asset.version);
      check('普通部件或结构负向检查选中准确版本', selected?.id === asset.id &&
        JSON.stringify(selected) === JSON.stringify(asset), { expected: asset.id, selected: selected?.id });
      await expect(properties).toContainText('暂不能将普通部件或结构版本直接应用到工程');
      const creation = await api('/api/types/creation-options');
      const bindings = await api(`/api/types/${referenceWorkspace.id}/resources`);
      const application = properties.getByRole('button', { name: /应用到工程|加入工程结构|引用到型号|绑定部件|绑定结构/ });
      const shot = await capture(`${kind}-engineering-reference-unavailable`);
      const detail = { id: asset.id, kind, assetStatus: asset.status, version: asset.version, digest: asset.content_sha256,
        visibleApplicationActions: await application.count(), inTypeCreation: creation.library.some(item => item.id === asset.id),
        inTypeBindings: bindings.resources.some(item => item.id === asset.id),
        detail: '真实UI已建立并发布隔离定义；当前界面不能把此普通资源固定应用到工程结构，资源间依赖不算工程引用。', screenshot: shot.screenshot };
      const unchanged = await api('/api/foundation/assets/' + asset.id);
      const targetAfter = await api('/api/workspaces/' + referenceWorkspace.id);
      await expect(main.getByRole('link', { name: '从保存输入建立与应用资源', exact: true })).toBeVisible();
      check(`${knownKindLabels[kind]}普通目录版本不会伪装为可应用的工程结构`,
        asset.release.application == null && detail.visibleApplicationActions === 0 &&
        detail.inTypeCreation === false && detail.inTypeBindings === false &&
        JSON.stringify(unchanged) === JSON.stringify(asset) &&
        JSON.stringify(targetAfter) === JSON.stringify(targetBefore) && report.writes.length === boundaryWrites,
        { ...detail, target: referenceWorkspace.id, writes: report.writes.slice(boundaryWrites),
          targetUnchanged: JSON.stringify(targetAfter) === JSON.stringify(targetBefore) });
      report.contractBoundaries ||= [];
      report.contractBoundaries.push({ ...size, ...detail, directApplicationSupported: false,
        positiveApplicationJourney: '保存输入部件与研究模板真实应用闭环' });
    });

    await branch('型号管理的结构版本从原型号建立方案', async () => {
      const catalogue = await api('/api/types/library');
      const managed = catalogue.items.find(item => item.kind === 'assembly' && item.status === 'published' && item.workspace_id && item.source_design?.id === item.workspace_id);
      if (!managed) {
        await openGroup('materials');
        const shot = await capture('managed-type-origin-not-in-cloud-seed');
        report.handoffs ||= [];
        report.handoffs.push({ label: '受型号流程管理的结构改版恢复路径', status: '云端无法验证', owner: '维护者验收种子', screenshot: shot.screenshot,
          detail: '真实已发布型号目录没有受管结构版本；没有人为发布或伪造来源标记来制造此分支。' });
        check('受管结构改版恢复有真实可验证对象', false, { status: '云端无法验证', screenshot: shot.screenshot, publishedTypes: catalogue.items.length }, { fatal: false });
        return;
      }
      const asset = await api(`/api/foundation/assets/${managed.id}`);
      check('型号改版起点来自权威已发布目录的准确版本', ['id', 'asset_id', 'version', 'content_sha256'].every(key => asset[key] === managed[key]));
      await openGroup('materials');
      await main.getByRole('textbox', { name: '检索', exact: true }).fill(asset.name);
      const row = main.getByRole('table', { name: groupTitles.materials, exact: true }).locator(`[id="row-材料与部件-${asset.id}"]`);
      await row.focus(); await row.press('Enter');
      await expect(properties.getByRole('heading', { name: asset.name, exact: true })).toBeVisible();
      const deriveWrites = report.writes.filter(item => item.method === 'POST' && item.path === `/api/foundation/assets/${asset.id}/derive`).length;
      await properties.getByRole('button', { name: '派生新版本', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '派生新版本', exact: true });
      await expect(dialog.getByRole('region', { name: '型号改版路径', exact: true })).toBeVisible();
      const recovery = dialog.getByRole('button', { name: '打开型号并建立方案', exact: true });
      await expect(recovery).toBeEnabled();
      await expect(dialog.getByRole('button', { name: '建立新版本草稿', exact: true })).toHaveCount(0);
      await capture('managed-type-exact-origin-action');
      await recovery.click();
      await expect(page).toHaveURL(new RegExp(`/types/${managed.workspace_id}/comparison/matrix(?:\\?|$)`));
      const origin = await api(`/api/workspaces/${managed.workspace_id}`);
      const begin = page.getByRole('button', { name: '建立方案', exact: true });
      await expect(begin).toBeEnabled();
      check('型号管理结构改版没有发送必然拒绝的通用派生请求', report.writes.filter(item => item.method === 'POST' && item.path === `/api/foundation/assets/${asset.id}/derive`).length === deriveWrites);
      await begin.click();
      const plan = page.getByRole('dialog', { name: '建立独立型号方案', exact: true });
      const planName = `隔离验收资源改版-${marker}`;
      await plan.getByRole('textbox', { name: '方案名称', exact: true }).fill(planName);
      await capture('managed-type-plan-confirmation');
      await plan.getByRole('button', { name: '建立方案', exact: true }).click();
      await page.waitForURL(/\/types\/[^/?]+\/structure\/section/);
      const wid = new URL(page.url()).pathname.split('/')[2], created = await api(`/api/workspaces/${wid}`);
      check('从资源改版入口实际建立原型号的独立方案', wid !== managed.workspace_id && created.type_plan_source?.workspace === managed.workspace_id &&
        created.type_plan_source?.revision === origin.revision && created.type_lifecycle?.name === planName && created.type_lifecycle?.status === 'draft' &&
        created.type_origin_reference?.id === asset.asset_id && created.type_origin_reference?.version === asset.version &&
        created.type_origin_reference?.content_sha256 === asset.content_sha256 && JSON.stringify(created.domain) === JSON.stringify(origin.domain),
      { workspace: wid, source: created.type_plan_source, reference: created.type_origin_reference, lifecycle: created.type_lifecycle });
      check('资源改版没有自动批准发布或覆盖原版本', !(created.type_release) && (await api(`/api/foundation/assets/${asset.id}`)).content_sha256 === asset.content_sha256);
      await capture('managed-type-plan-created');
    });
  }

  if (after) await branch('保存输入部件与研究模板真实应用闭环', savedInputApplications);

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

  await branch('逐个放大阅读真实插件方法图与验证图', async () => {
    const writesBefore = report.writes.length;
    try {
      await sidebar.getByRole('link', { name: '插件', exact: true }).click();
      const pluginList = page.getByRole('navigation', { name: '已安装插件', exact: true });
      await expect(pluginList).toBeVisible();

      const installReason = '本版本暂不支持从文件安装插件；插件随软件发布，更新软件即可获得新版本';
      const installHelp = page.getByRole('note', { name: `从文件安装不可用：${installReason}`, exact: true });
      const installButton = installHelp.getByRole('button', { name: '从文件安装', exact: true });
      const installTooltip = page.getByRole('tooltip');
      await expect(installHelp).toBeVisible();
      await expect(installHelp).toHaveAttribute('tabindex', '0');
      await expect(installButton).toBeDisabled();
      await installHelp.hover();
      await expect(installTooltip).toHaveText(installReason);
      await capture('plugin-install-disabled-mouse');
      // Hoverable Radix content starts a grace area on pointerleave and
      // closes after subsequent pointermove events leave that area.
      await page.mouse.move(0, 0, { steps: 12 });
      await expect(installTooltip).toBeHidden();

      // Start at the real navigation entry and Tab to the explanation.
      // Do not focus the disabled button or the explanation directly.
      const pluginNavigation = sidebar.getByRole('link', { name: '插件', exact: true });
      await pluginNavigation.focus();
      await expect(pluginNavigation).toBeFocused();
      const installKeyboardPath = [];
      for (let attempt = 0; attempt < 32; attempt += 1) {
        await page.keyboard.press('Tab');
        const focused = await page.evaluate(() => {
          const node = document.activeElement;
          return { tag: node?.tagName, role: node?.getAttribute('role'),
            label: node?.getAttribute('aria-label'), text: node?.textContent?.trim().slice(0, 120) };
        });
        installKeyboardPath.push(focused);
        if (await installHelp.evaluate(node => node === document.activeElement)) break;
      }
      await expect(installHelp).toBeFocused();
      await expect(installTooltip).toHaveText(installReason);
      const installFocus = await installHelp.evaluate(node => {
        const style = getComputedStyle(node), rect = node.getBoundingClientRect();
        return { focused: node === document.activeElement, outlineStyle: style.outlineStyle,
          outlineWidth: parseFloat(style.outlineWidth), inViewport: rect.top >= 0 && rect.left >= 0
            && rect.bottom <= innerHeight && rect.right <= innerWidth };
      });
      await check('插件文件安装禁用原因可由鼠标悬停和Tab键读取',
        installFocus.focused && installFocus.inViewport && installFocus.outlineStyle !== 'none'
          && installFocus.outlineWidth >= 1 && (await installButton.isDisabled()),
        { reason: installReason, keyboardPath: installKeyboardPath, focus: installFocus,
          scope: '只读取现有安装限制，不安装插件、不产生写入。' });
      await capture('plugin-install-disabled-keyboard');
      await page.keyboard.press('Escape');
      await expect(installTooltip).toBeHidden();
      await expect(installHelp).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(installHelp).not.toBeFocused();
      // The host returns the sealed, digest-qualified URL actually used by the
      // page. Corroborate it; never substitute SVG bytes or a fabricated image.
      const installed = await api('/api/methods');
      const figures = installed.flatMap(plugin => (plugin.resources || [])
        .filter(resource => ['method', 'validation'].includes(resource.role))
        .map(resource => ({ plugin, resource })));
      check('插件阅读走查覆盖真实清单展示图', figures.length > 0, figures.map(({ plugin, resource }) => ({
        plugin: plugin.method.plugin_id, role: resource.role, url: resource.url, sha256: resource.sha256,
      })));

      async function loadedImage(image) {
        await expect(image).toBeVisible();
        await expect.poll(() => image.evaluate(node => node.complete && node.naturalWidth > 0 && node.naturalHeight > 0)).toBe(true);
        return image.evaluate(async node => {
          await node.decode();
          const bounds = node.getBoundingClientRect();
          return { complete: node.complete, decoded: true, src: node.getAttribute('src'), currentSrc: node.currentSrc,
            naturalWidth: node.naturalWidth, naturalHeight: node.naturalHeight, readWidth: bounds.width, readHeight: bounds.height };
        });
      }

      for (const { plugin, resource } of figures) {
        const label = `${plugin.method.plugin_id}-${resource.role}`;
        await pluginList.getByRole('link').filter({ hasText: plugin.name }).first().click();
        const detail = page.getByRole('article', { name: plugin.name, exact: true });
        await expect(detail).toBeVisible();
        await detail.getByRole('tab', { name: resource.role === 'method' ? '方法' : '验证', exact: true }).click();
        const figure = detail.locator('.plugin-figure');
        await expect(figure).toHaveCount(1);
        const thumbnail = await loadedImage(figure.locator(':scope > img'));
        const expectedUrl = new URL(resource.url, base).href;
        check('缩略图引用真实封签资源', thumbnail.currentSrc === expectedUrl, { label, sha256: resource.sha256, expectedUrl, thumbnail });
        const opener = figure.getByRole('button', { name: '放大阅读', exact: true });
        await expect(opener).toBeVisible();
        await capture(`${label}-thumbnail`);

        // Mouse opening and closing must retain the original reader entry.
        await opener.click();
        const dialog = page.getByRole('dialog', { name: resource.title, exact: true });
        const reading = dialog.locator('.plugin-figure-reading-image');
        const region = dialog.getByRole('region', { name: `${resource.title}大图`, exact: true });
        const zoom = dialog.getByRole('combobox', { name: '阅读大小', exact: true });
        const close = dialog.getByRole('button', { name: '关闭', exact: true });
        await expect(dialog).toBeVisible();
        await expect(reading).toHaveAttribute('data-state', 'ready');
        const standard = await loadedImage(reading);
        check('大图完成解码并以标准阅读宽度呈现同一资源', standard.currentSrc === expectedUrl
          && standard.src === thumbnail.src && Math.abs(standard.readWidth - 1152) < 1,
        { label, sha256: resource.sha256, expectedUrl, standard });
        await expect(zoom).toHaveText('标准大小');
        await capture(`${label}-reader-standard`);
        await close.click();
        await expect(dialog).toBeHidden();
        await expect(opener).toBeFocused();

        // Enter opens the same entry. Select's actual UI changes the reading
        // width; no DOM style/source edits or synthetic component events.
        await opener.press('Enter');
        await expect(dialog).toBeVisible();
        await expect(reading).toHaveAttribute('data-state', 'ready');
        await loadedImage(reading);
        const zooms = [];
        let selectedSize = '标准大小';
        for (const factor of [1.5, 2, 3]) {
          await zoom.press('Enter');
          const listbox = page.getByRole('listbox');
          await expect(listbox).toBeVisible();
          await expect(listbox.getByRole('option', { name: selectedSize, exact: true })).toBeFocused();
          await page.keyboard.press('ArrowDown');
          // Radix moves focus after the key event. Confirm the real target
          // before Enter; otherwise a fast sequence selects the previous item.
          selectedSize = `放大${factor}倍`;
          await expect(listbox.getByRole('option', { name: selectedSize, exact: true })).toBeFocused();
          await page.keyboard.press('Enter');
          await expect(listbox).toBeHidden();
          await expect(zoom).toBeFocused();
          await expect(zoom).toHaveText(selectedSize);
          await expect(region).toHaveAttribute('data-zoom', String(factor));
          const image = await loadedImage(reading);
          zooms.push({ factor, ...image });
          check('键盘选择阅读大小保留原图并增大实际绘制宽度', image.currentSrc === expectedUrl
            && Math.abs(image.readWidth - 1152 * factor) < 1, { label, factor, input: 'keyboard', image });
        }
        await zoom.press('Tab');
        await expect(region).toBeFocused();
        await region.press('Control+Home');
        await region.press('PageDown');
        await expect.poll(() => region.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
        await region.press('Control+End');
        await expect.poll(() => region.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThan(2);
        const keyboardEnd = await region.evaluate(node => ({ top: node.scrollTop, height: node.clientHeight, scrollHeight: node.scrollHeight }));
        await region.press('Control+Home');
        await expect.poll(() => region.evaluate(node => node.scrollTop)).toBe(0);
        await region.hover();
        await page.mouse.wheel(0, 100000);
        await expect.poll(() => region.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThan(2);
        await loadedImage(reading);
        await capture(`${label}-reader-bottom`);
        await page.mouse.wheel(100000, 0);
        await expect.poll(() => region.evaluate(node => node.scrollWidth - node.clientWidth - node.scrollLeft)).toBeLessThan(2);
        const mouseEnd = await region.evaluate(node => ({ left: node.scrollLeft, top: node.scrollTop,
          width: node.clientWidth, height: node.clientHeight, scrollWidth: node.scrollWidth, scrollHeight: node.scrollHeight }));
        const fixedControls = await dialog.evaluate(node => {
          const bounds = node.getBoundingClientRect();
          return [...node.querySelectorAll('.plugin-figure-header, .plugin-figure-toolbar')].map(control => {
            const box = control.getBoundingClientRect();
            return { text: control.textContent.trim(), visible: box.top >= bounds.top && box.bottom <= bounds.bottom
              && box.left >= bounds.left && box.right <= bounds.right && box.top >= 0 && box.bottom <= innerHeight };
          });
        });
        check('键盘和鼠标可读到图末尾且标题控件保持可见', keyboardEnd.top > 0 && mouseEnd.left > 0
          && mouseEnd.top > 0 && fixedControls.length === 2 && fixedControls.every(control => control.visible),
        { label, expectedUrl, sha256: resource.sha256, zooms, keyboardEnd, mouseEnd, fixedControls });
        await expect(close).toBeVisible();
        await loadedImage(reading);
        await capture(`${label}-reader-right-bottom`);
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(opener).toBeFocused();
        check('Escape关闭大图并回到放大阅读按钮', await opener.evaluate(node => node === document.activeElement), { label });
      }
    } finally {
      const writes = report.writes.slice(writesBefore);
      check('插件大图阅读全程没有API写入', writes.length === 0, { writes });
    }
  });
});
