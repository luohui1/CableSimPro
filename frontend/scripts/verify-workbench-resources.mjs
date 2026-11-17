import fs from 'node:fs/promises';
import path from 'node:path';
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
    const row = (version ? matching.filter({ has: page.getByRole('cell', { name: version, exact: true }) }) : matching).first();
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

  async function transition(group, saved, action, label) {
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
    await expect(dialog).toContainText('隔离浏览器验收');
    await dialog.getByRole('textbox', { name: '资源操作说明', exact: true }).fill(`隔离验收${label}：已查看本条定义、单位与手工出处，仅验证版本流程，不作为工程物性依据。`);
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
    await expect(dialog.getByRole('combobox', { name: role === 'material' ? '设计材料' : '执行标准', exact: true })).toContainText(target.name);
    return { dialog, target, view };
  }

  async function bindPublishedResource(group, published, draft) {
    const role = published.kind === 'material' ? 'material' : 'standard';
    const context = await openTypeBinding(role);
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
    await link.focus(); await link.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/resources/${group}\\?`));
    check(`${knownKindLabels[published.kind]}固定引用可返回确切资源版本`, new URL(page.url()).searchParams.get('item') === current.id);
    if (group === 'standards') await page.getByRole('tab', { name: '资源版本', exact: true }).click();
    await expect(properties.getByRole('heading', { name: current.name, exact: true })).toBeVisible();
    await capture(`${group}-fixed-reference-reopened`);
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
    await context.dialog.getByRole('combobox', { name: '资源版本', exact: true }).click();
    await expect(page.getByRole('listbox')).toBeVisible();
    check(`${groupTitles[group]}已停用版本不能新选且新发布版本可明确选择`,
      !context.view.resources.some(item => item.id === old.id) && context.view.resources.some(item => item.id === newer.id) &&
      await page.getByRole('option', { name: `${old.name} · ${old.version}`, exact: true }).count() === 0 &&
      await page.getByRole('option', { name: `${newer.name} · ${newer.version}`, exact: true }).isVisible(), { oldVersion: old.version, newVersion: newer.version });
    await capture(`${group}-old-pin-and-new-version-eligibility`);
    await page.keyboard.press('Escape');
    await context.dialog.getByRole('button', { name: '关闭', exact: true }).click();
    const reread = await api(`/api/workspaces/${referenceWorkspace.id}`);
    check(`${groupTitles[group]}查看新版本并取消没有写入或升级引用`, reread.revision === saved.revision && JSON.stringify(reread.type_resource_bindings?.[role]?.[savedBinding.target]) === JSON.stringify(savedBinding.pin));
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
    if (['material', 'rule'].includes(current.kind)) {
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
        await capture('cable-fixed-version-study-created');
      });
    }
  }

  await branch('核对厂家资料导入入口', async () => {
    await openCableVersions();
    await page.locator('.topbar-actions').getByRole('button', { name: '从厂家资料导入', exact: true }).click();
    await expect(page).toHaveURL(/\/resources\/cables\/imports(?:\?|$)/);
    await expect(page.getByRole('button', { name: '上传 PDF', exact: true })).toBeVisible();
    const shot = await capture('manufacturer-import');
    // Workbook import belongs to T3; record what the real UI accepts without
    // uploading fabricated manufacturer documents or invoking an OCR service.
    const formats = await page.getByLabel('上传 PDF 文件', { exact: true }).getAttribute('accept');
    await check('厂家结构表可从资源库导入', /xlsx|xls|csv/.test(formats || ''), { acceptedFormats: formats, owner: 'T3 数据导入接口与 T1 前端接线' }, { fatal: false });
    if (!/xlsx|xls|csv/.test(formats || '')) {
      report.handoffs ||= [];
      report.handoffs.push({ label: 'L11 厂家 XLS/CSV 结构表导入', status: '未通过', owner: 'T3 数据导入契约', screenshot: shot.screenshot, acceptedFormats: formats });
    }
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
    if (after && versions && ['material', 'rule'].includes(kind)) await branch(`${groupTitles[group]}历史固定引用与新版本资格`, () => verifyPinnedHistory(group, versions));
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
});
