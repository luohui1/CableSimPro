import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { walkthrough } from './verify-workbench-support.mjs';

// Operate the real isolated application. API reads only corroborate what was
// selected or imported in the UI; no seed repair, mocked responses or API writes.
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
    if (kind === 'material') {
      const limitation = dialog.getByText(/密度、电阻率及无量纲参数暂不能录入/);
      await limitation.scrollIntoViewIfNeeded();
      const shot = await capture('material-host-quantity-limit');
      report.handoffs ||= [];
      report.handoffs.push({ label: '材料密度、电阻率及无量纲参数的 typed 录入', status: '未通过', owner: 'T3 资源参数契约', screenshot: shot.screenshot,
        detail: '宿主 Quantity 契约没有这些量纲，T1 表单不改名伪装；已有来源摘录保留。' });
      check('完整材料物性可通过 typed 参数录入', false, { owner: 'T3', screenshot: shot.screenshot, actual: await limitation.innerText() }, { fatal: false });
    }
    await dialog.getByRole('button', { name: '保存资源草稿', exact: true }).click();
    await expect(dialog).toBeHidden();
    const saved = await inspectSelectedResource(name);
    check('表单真实保存名称、数量、单位和手工来源', saved.status === 'draft' && saved.revision === 1 && saved.kind === kind &&
      saved.release.parameters[0].name === parameter.name && saved.release.parameters[0].quantity.value === parameter.quantity.value &&
      saved.release.parameters[0].quantity.unit === parameter.quantity.unit && saved.release.sources[0].kind === 'project_input' && saved.release.sources[0].reviewed === false,
    { id: saved.id, status: saved.status, parameters: saved.release.parameters, sources: saved.release.sources });
    return saved;
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
    const bytes = await fs.readFile(new URL('../../tests/fixtures/jiangnan_yjv22.csv', import.meta.url));
    const expectedDigest = createHash('sha256').update(bytes).digest('hex');
    const [uploaded] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/api/type-library/imports/upload')
        && response.request().method() === 'POST', { timeout: 60000 }),
      picker.setInputFiles({ name: 'T1-已公开结构表.csv', mimeType: 'text/csv', buffer: bytes }),
    ]);
    const receipt = await uploaded.json();
    await check('实际 CSV 字节与来源摘要经后端验收', uploaded.status() === 201 &&
      receipt.sha256 === expectedDigest && receipt.sheets?.some(sheet => sheet.data_rows >= 1),
      { status: uploaded.status(), uploadedDigest: receipt.sha256, originalDigest: expectedDigest,
        sheets: receipt.sheets?.map(sheet => ({ name: sheet.name, rows: sheet.data_rows })) });
    await expect(page.getByRole('heading', { name: '选择工作表', exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: '工作表', exact: true })).toBeVisible();
    await capture('manufacturer-structure-upload');
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
      await main.locator('summary').filter({ hasText: '模板作用域' }).click();
      await expect(main).toContainText('当前版本暂不能将组织模板应用到工程布置或研究参数');
      const shot = await capture('organization-template-application-unavailable');
      report.handoffs ||= [];
      report.handoffs.push({ label: '组织资源模板真实应用到工程或研究', status: '未通过', owner: 'T3 模板应用契约', screenshot: shot.screenshot,
        detail: '页面可管理版本；研究内置布置预设是另一条路径，不计为本资源已应用。' });
      check('组织资源模板可实际应用到工程或研究', false, { owner: 'T3', screenshot: shot.screenshot }, { fatal: false });
    });
  }

  if (after) {
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
      await searchResource('materials', asset.name, asset.version);
      await expect(properties).toContainText('暂不能将普通部件或结构版本直接应用到工程');
      const creation = await api('/api/types/creation-options');
      const bindings = referenceWorkspace ? await api(`/api/types/${referenceWorkspace.id}/resources`) : null;
      const application = properties.getByRole('button', { name: /应用到工程|加入工程结构|引用到型号|绑定部件|绑定结构/ });
      const shot = await capture(`${kind}-engineering-reference-unavailable`);
      const detail = { id: asset.id, kind, assetStatus: asset.status, version: asset.version, digest: asset.content_sha256,
        visibleApplicationActions: await application.count(), inTypeCreation: creation.library.some(item => item.id === asset.id),
        inTypeBindings: bindings ? bindings.resources.some(item => item.id === asset.id) : null,
        detail: '真实UI已建立并发布隔离定义；当前界面不能把此普通资源固定应用到工程结构，资源间依赖不算工程引用。', screenshot: shot.screenshot };
      report.handoffs ||= [];
      report.handoffs.push({ label: `${knownKindLabels[kind]}发布版本固定引用到工程或型号`, status: '未通过', owner: 'T3 部件/结构应用契约', ...detail });
      check(`${knownKindLabels[kind]}发布版本可固定引用到工程或型号`, false, detail, { fatal: false });
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
