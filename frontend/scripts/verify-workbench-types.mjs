import fs from 'node:fs/promises';
import path from 'node:path';
import { walkthrough } from './verify-workbench-support.mjs';

// Run with isolated-e2e.mjs and the engineering demo database. All writes below
// are mouse/keyboard actions; GETs only verify the state returned by this host.
// Deliberately incomplete engineering inputs remain visible in the evidence.
await walkthrough('types', async ({ page, expect, base, api, choose, capture, step, check, out, size, tag, report }) => {
  const name = origin => `T1 型号走查 · ${origin} · ${tag}`;
  const versionLabel = value => String(value || '').replace(/\+engineering$/, '（工程版）').replace(/\+[^\s]+$/, '（定制版）') || '未提供';
  const workspace = id => api(`/api/workspaces/${encodeURIComponent(id)}`);
  const visibleText = () => page.locator('body').innerText();
  const toolbar = () => page.getByRole('toolbar', { name: '型号命令', exact: true });
  const layers = () => page.getByRole('table', { name: '型号分层', exact: true });
  const dirty = async () => await toolbar().locator('.command-state').count() > 0
    && (await toolbar().locator('.command-state').innerText()).includes('未保存');

  async function dismissDialog() {
    for (let count = 0; count < 3 && await page.getByRole('dialog').count(); count++) {
      const current = page.getByRole('dialog').first();
      const leave = page.getByRole('dialog', { name: '型号有未保存修改', exact: true });
      if (await leave.isVisible()) await leave.getByRole('button', { name: '放弃修改并离开', exact: true }).click();
      else await page.keyboard.press('Escape');
      await expect(current).toBeHidden();
    }
  }
  async function attempt(label, action) {
    try { return await step(label, action); }
    catch (error) {
      check(label, false, { error: error.message, state: await visibleText() });
      await dismissDialog();
      return undefined;
    } finally { await recoverSavedDraft(label); }
  }
  async function recoverSavedDraft(label) {
    await dismissDialog();
    if (!await dirty()) return;
    const id = new URL(page.url()).pathname.split('/')[2];
    const saved = await workspace(id);
    // Structure's existing Undo discards all unsaved input; analysis Undo only
    // discards that method. Recovery must not carry a failed draft to a new step.
    await module('结构 ·');
    const undo = await command('撤销');
    let restored = false;
    if (undo && await undo.isEnabled()) {
      await undo.click();
      try { await expect.poll(dirty, { timeout: 10000 }).toBe(false); restored = true; }
      catch { /* Keep the failed UI recovery in the report before reloading. */ }
    }
    check(label + '之后可用撤销恢复已保存输入', restored, await visibleText());
    if (!restored) {
      const leave = dialog => dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss();
      page.on('dialog', leave);
      try { await page.reload(); } finally { page.off('dialog', leave); }
      await expect(layers()).toBeVisible();
      await expect.poll(dirty).toBe(false);
    }
    const current = await workspace(id);
    check(label + '恢复未改动保存版本', current.revision === saved.revision
      && JSON.stringify(current.domain) === JSON.stringify(saved.domain), { workspace: id, revision: current.revision });
    await capture(label + (restored ? '-撤销草稿恢复已保存输入' : '-明确重载恢复已保存输入'));
  }
  async function responseFor(method, endpoint, action, timeout = 90000) {
    const [response] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === endpoint && response.request().method() === method, { timeout }),
      action(),
    ]);
    expect(response.ok(), `${method} ${endpoint}: HTTP ${response.status()}${response.ok() ? '' : ' ' + await response.text()}`).toBeTruthy();
    return response.json();
  }
  async function field(label, value, scope = page) {
    const input = scope.getByLabel(label, { exact: true });
    await expect(input).toBeVisible();
    await input.fill(String(value));
    await input.press('Tab');
  }
  async function advanced(scope = page) {
    for (const section of await scope.locator('details.parameter-advanced').all()) {
      if (await section.getAttribute('open') === null) await section.locator(':scope > summary').click();
    }
  }
  async function openNew(origin, title) {
    await dismissDialog();
    await page.goto(base + '/types?theme=light');
    await expect(page.locator('[data-type-page="list"][data-type-state="success"], [data-type-page="list"][data-type-state="empty"]')).toBeVisible();
    await page.getByRole('button', { name: '新建型号', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '新建型号设计', exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('radio', { name: origin, exact: true }).check();
    await field('型号名称', title, dialog);
    return dialog;
  }
  async function create(dialog, origin) {
    const result = await responseFor('POST', '/api/types', () => dialog.getByRole('button', {
      name: origin === 'standard' ? '确认并建立草稿' : '建立草稿', exact: true,
    }).click());
    expect(typeof result.id).toBe('string');
    await expect(page).toHaveURL(new RegExp('/types/' + result.id + '/structure/section'));
    await expect(page.getByRole('navigation', { name: '型号浏览器', exact: true })).toBeVisible();
    check(`${origin} 起点保留真实来源且建立独立草稿`, result.type_creation?.kind === origin && result.type_lifecycle?.status === 'draft', {
      workspace: result.id, creation: result.type_creation, lifecycle: result.type_lifecycle,
    });
    return result;
  }
  async function module(label) {
    await dismissDialog();
    await page.getByRole('navigation', { name: '型号浏览器', exact: true }).getByRole('button', {
      name: new RegExp('^' + label),
    }).click();
    const result = {
      '结构 ·': 'structure', '标准核对': 'standard-check-results',
      '电气参数': 'electrical-results', '短路容量': 'short-circuit-results',
      '载流量表': 'rating-table-results', '方案对比': 'comparison-results',
      '规格书': 'specification-results',
    }[label];
    const content = page.locator(`[data-type-page="${result}"]`).last();
    await expect(content).toBeVisible();
    await expect(content).not.toHaveAttribute('data-type-state', 'loading');
  }
  async function save(id) {
    if (!await dirty()) return workspace(id);
    await page.keyboard.press('Control+s');
    await expect(toolbar().locator('.command-state')).not.toContainText('未保存');
    await expect(page.getByText('结构修改待保存。', { exact: true })).toHaveCount(0);
    return workspace(id);
  }
  async function command(label, required = false) {
    if (required) await expect.poll(async () => await toolbar().getByRole('button', { name: label, exact: true }).count()
      + await toolbar().getByRole('button', { name: '更多操作', exact: true }).count()).toBeGreaterThan(0);
    let button = toolbar().getByRole('button', { name: label, exact: true });
    if (await button.isVisible()) return button;
    const more = toolbar().getByRole('button', { name: '更多操作', exact: true });
    if (await more.isVisible()) {
      await more.click();
      const item = page.getByRole('menuitem', { name: new RegExp('^' + label) });
      if (await item.isVisible()) return item;
      await page.keyboard.press('Escape');
    }
    return null;
  }
  async function run(label, resultPage) {
    await expect(page.locator(`[data-type-page="${resultPage}"]`)).not.toHaveAttribute('data-type-state', 'loading');
    const button = await command(label, true);
    if (!check(label + '可从当前页面启动', button && await button.isEnabled(), await visibleText())) return false;
    const [response] = await Promise.all([
      page.waitForResponse(value => value.request().method() === 'GET'
        && /^\/api\/workspaces\/[^/]+\/studies\/[^/]+\/preflight$/.test(new URL(value.url()).pathname), { timeout: 90000 }),
      button.click(),
    ]);
    expect(response.ok()).toBeTruthy();
    const preflight = await response.json();
    (report.preflights ||= []).push({ label, ...size, path: new URL(response.url()).pathname, payload: preflight });
    const dialog = page.getByRole('dialog', { name: label + ' · 预检', exact: true });
    await expect(dialog).toBeVisible({ timeout: 90000 });
    if (!preflight.ready) {
      for (const trace of await dialog.locator('details').filter({ has: page.locator('summary').filter({ hasText: /^追溯$/ }) }).all()) {
        if (await trace.getAttribute('open') === null) await trace.locator(':scope > summary').click();
      }
    }
    await capture(label + '-真实预检');
    const ack = dialog.getByRole('checkbox', { name: '已核对输入来源与方法适用范围', exact: true });
    if (!check(label + '通过真实预检', preflight.ready && await ack.isVisible(), { visible: await dialog.innerText(), preflight })) {
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      return false;
    }
    await ack.check();
    await dialog.getByRole('button', { name: '确认并运行', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 180000 });
    await expect(page.locator(`[data-type-page="${resultPage}"]`)).toHaveAttribute('data-type-state', 'success', { timeout: 180000 });
    check(label + '取得当前保存结果', true);
    return true;
  }
  async function generateSpecification(id, label, suffix, expectedIncomplete = false) {
    await module('规格书');
    await choose('文档版本', '客户版');
    await page.getByRole('tab', { name: '内容', exact: true }).click();
    await expect(page.getByTitle('正式规格书预览')).toBeVisible();
    await capture(label + '-生成前缺项与章节');
    const generate = await command('生成规格书', true);
    if (!check(label + '有可启动的生成操作', generate && await generate.isEnabled(), await visibleText())) return;
    let download;
    const listener = item => { download = item; };
    page.on('download', listener);
    try {
      const response = await responseFor('POST', `/api/types/${id}/specification/generate`, () => generate.click(), 360000);
      await expect(page.locator('[data-type-page="specification-results"]')).not.toHaveAttribute('data-type-state', 'loading', { timeout: 180000 });
      if (expectedIncomplete) {
        const spec = await api(`/api/types/${id}/specification?audience=customer&view=detail`);
        const mass = spec.payload.checks.find(item => item.id === 'geometry/mass' && item.blocking);
        check(label + '因真实材料密度或构造缺项拒绝客户交付', response.status === 'blocked' && response.channel === 'geometry'
          && response.details === '结构外径或用料缺少完整输入。' && !download
          && mass?.quantities?.some(row => row.quantity_missing?.includes('材料密度')), { response, blocker: mass });
        await capture(label + '-保留真实用料缺项');
        const repair = page.getByRole('button', { name: '查看结构推导条件', exact: true });
        await expect(repair).toBeVisible();
        await repair.click();
        await expect(page).toHaveURL(/\/structure\/quantities/);
        await expect(page.getByRole('table', { name: '外径与用料', exact: true })).toBeVisible();
        check(label + '拒绝后可定位结构用料缺项', true);
        return;
      }
      if (!check(label + '生成通过全部真实方法', response.status === 'generated', response)) {
        await capture(label + '-生成受阻的真实原因');
        const repair = page.getByRole('button', { name: /^查看.+条件$/ }).first();
        check(label + '生成受阻时给出可跳转的条件入口', await repair.isVisible(), await visibleText());
        return;
      }
      await expect.poll(() => Boolean(download), { timeout: 60000 }).toBe(true);
      const filename = path.join(out, `types-${size.width}-${tag}-${suffix}-customer.pdf`);
      await download.saveAs(filename);
      const bytes = await fs.readFile(filename);
      const spec = await api(`/api/types/${id}/specification?audience=customer&view=detail`);
      check(label + '客户下载是有效PDF且引用五项当前结果', bytes.subarray(0, 5).toString() === '%PDF-'
        && spec.payload.sources.length === 5 && spec.payload.sources.every(source => source.freshness === 'current'), {
        file: path.basename(filename), bytes: bytes.length, sources: spec.payload.sources,
      });
    } finally { page.off('download', listener); }
  }
  async function reviewSpecification(id, label, expectedIncomplete = false) {
    await module('规格书');
    await choose('文档版本', '客户版');
    await page.getByRole('tab', { name: '审核与发布', exact: true }).click();
    let spec = await api(`/api/types/${id}/specification?audience=customer&view=detail`);
    const blockers = spec.payload.checks.filter(item => item.blocking === true);
    await capture(label + '-审核与发布清单');
    if (expectedIncomplete) {
      const mass = blockers.find(item => item.id === 'geometry/mass');
      const submit = page.getByRole('button', { name: '提交评审', exact: true });
      check(label + '保留真实用料缺项且禁止提交评审', !spec.ready && await submit.isDisabled()
        && mass?.message === '单位长度用料缺少完整材料密度或构造输入。'
        && mass?.quantities?.some(row => row.quantity_missing?.includes('材料密度')),
      { ready: spec.ready, blockers });
      for (const group of await page.locator('.type-review-groups > section > details').all()) {
        if (await group.getAttribute('open') === null) await group.locator(':scope > summary').click();
      }
      const item = page.locator('[data-check-id="geometry/mass"]');
      await item.getByRole('button', { name: /^填写/ }).click();
      await expect(page).toHaveURL(/\/structure\/table.*field=/);
      const target = new URL(page.url()).searchParams.get('field');
      check(label + '审核缺项可定位真实密度或构造字段', /\/(?:density|lay_factor|tape_width|tape_count|tape_application)$/.test(target || ''), { target });
      await capture(label + '-审核缺项定位到结构字段');
      return;
    }
    if (!check(label + '具备提交审核的完整输入与结果', spec.ready && blockers.length === 0, { ready: spec.ready, blockers })) {
      const submit = page.getByRole('button', { name: '提交评审', exact: true });
      check(label + '校核未闭合时禁止发布并显示实际原因', await submit.isDisabled() && blockers.length > 0, await visibleText());
      return;
    }
    for (const action of ['采纳为版本草稿', '提交评审', '人工批准', '发布型号版本']) {
      const button = page.locator('.type-result-summary').getByRole('button', { name: action, exact: true });
      await expect(button).toBeEnabled();
      await button.click();
      const dialog = page.getByRole('dialog', { name: action, exact: true });
      if (action === '提交评审') {
        await field('变更摘要', 'T1 隔离走查：核对固定来源、真实保存输入及计算结果；仅作为测试版本。', dialog);
        await field('编制人', 'T1 隔离走查', dialog);
      }
      await capture(label + '-' + action + '-确认前');
      await dialog.getByRole('checkbox', { name: '已核对当前版本与提交前校核清单', exact: true }).check();
      await dialog.getByRole('button', { name: action, exact: true }).click();
      await expect(dialog).toBeHidden({ timeout: 90000 });
    }
    spec = await api(`/api/types/${id}/specification?audience=customer&view=detail`);
    check(label + '人工审核发布闭环', spec.lifecycle.status === 'published', spec.lifecycle);
    await page.getByRole('tab', { name: '修订记录', exact: true }).click();
    await expect(page.getByRole('table', { name: '文档修订记录', exact: true })).toBeVisible();
  }

  const options = await api('/api/types/creation-options');
  await attempt('01-型号列表与批量操作入口', async () => {
    await page.goto(base + '/types?theme=light');
    await expect(page.locator('[data-type-page="list"]')).toHaveAttribute('data-type-state', 'success');
    await expect(page.getByRole('button', { name: '新建型号', exact: true })).toBeVisible();
    await expect(page.getByRole('searchbox', { name: '查找型号', exact: true })).toBeVisible();
    await field('查找型号', 'YJV22');
    await expect(page.getByRole('table', { name: '型号', exact: true })).toContainText('YJV22');
    await capture('型号列表-真实筛选');
    await field('查找型号', '');
    const table = page.getByRole('table', { name: '型号', exact: true });
    check('型号列表可选择多个型号批量操作', await table.getByRole('checkbox').count() > 1, await visibleText());
  });

  const library = await attempt('02-从真实型号库引用建立草稿', async () => {
    const dialog = await openNew('从型号库复制', name('库引用'));
    const source = options.library.find(item => /YJV22/.test(item.name) && /300/.test(item.name)) || options.library[0];
    if (!check('库引用起点可开始', Boolean(source), await dialog.innerText())) return null;
    await choose('型号版本', source.name + ' · ' + versionLabel(source.version), dialog);
    await capture('库引用-固定型号版本与来源');
    return create(dialog, 'library');
  });

  await attempt('03-从零建立型号并通过缺项定位填写截面', async () => {
    const dialog = await openNew('空白', name('从零'));
    await choose('结构类型', '单芯', dialog);
    const blank = await create(dialog, 'blank');
    await expect(page.getByRole('region', { name: '型号缺项', exact: true })).toBeVisible();
    await capture('从零-缺项与可开始的操作');
    await page.getByRole('button', { name: '芯 1 · 导体截面', exact: true }).click();
    const input = page.getByRole('textbox', { name: '标称截面', exact: true });
    await expect(input).toBeFocused();
    await field('标称截面', '70');
    const saved = await save(blank.id);
    check('缺项定位后可以键盘录入并保存真实截面', saved.domain.cable_types[0].cores[0].conductor.nominal_area === 70e-6, {
      workspace: blank.id, nominal_area: saved.domain.cable_types[0].cores[0].conductor.nominal_area,
    });
  });

  const standard = await attempt('04-按标准生成完整护层提案并确认', async () => {
    const dialog = await openNew('按标准生成', name('标准提案'));
    await choose('生成范围', '完整护层 · 核对附录依据', dialog);
    await choose('结构类型', '单芯', dialog);
    await choose('额定电压', '0.6/1 kV', dialog);
    await choose('导体材料', '铜', dialog);
    await field('导体截面', '70', dialog);
    await choose('导体几何', '等截面积实心圆 · 理想化', dialog);
    await choose('半导电屏蔽', '无半导电屏蔽层', dialog);
    await choose('护层构造', 'PVC 挤包内衬 + PVC 外护套', dialog);
    await dialog.getByRole('button', { name: '生成结构提案', exact: true }).click();
    await expect(dialog.getByRole('region', { name: '结构提案', exact: true })).toBeVisible({ timeout: 90000 });
    await dialog.getByText('提案范围与缺项', { exact: true }).click();
    await capture('标准提案-标准值推导条件和缺项');
    await expect(dialog.getByRole('button', { name: '确认并建立草稿', exact: true })).toBeDisabled();
    await dialog.getByRole('checkbox', { name: '已核对标准值、推导条件与缺项', exact: true }).check();
    return create(dialog, 'standard');
  });

  const main = library || standard;
  if (!check('至少一个真实起点进入后续型号设计', Boolean(main), '型号库引用与标准提案均未建立草稿')) return;
  await page.goto(base + `/types/${main.id}/structure/section?theme=light`);
  await expect(layers()).toBeVisible();

  await attempt('05-尺寸编辑撤销重做与前端校核', async () => {
    const before = await workspace(main.id);
    const inputs = layers().getByRole('textbox', { name: '绝缘厚度', exact: true });
    const input = inputs.first();
    await expect(input).toBeVisible();
    const original = await input.inputValue();
    const changed = (Number(original) + 0.1).toFixed(3);
    await input.fill(changed);
    await input.press('Tab');
    await expect(toolbar().locator('.command-state')).toContainText('未保存');
    check('编辑时不隐式写入保存版本', (await workspace(main.id)).revision === before.revision);
    await capture('结构编辑-未保存的尺寸');
    check('待保存区域给出修改数量', /(?:\d+\s*项.*(?:待保存|修改)|(?:修改|待保存).*\d+\s*项)/.test(await visibleText()), await visibleText());
    // Blur the editor: Ctrl+Z must undo a design command, not an input's text.
    await page.getByRole('navigation', { name: '型号浏览器', exact: true }).click({ position: { x: 12, y: 12 } });
    await page.keyboard.press('Control+z');
    await expect(input).toHaveValue(original);
    const redo = await command('重做');
    const hasRedo = check('结构修改有可操作的重做入口', redo && await redo.isEnabled(), await visibleText());
    if (hasRedo) {
      await redo.click();
      await expect.poll(async () => Number(await input.inputValue())).toBe(Number(changed));
      await capture('结构编辑-撤销后重做');
    }
    // The three-core reference has fixed source positions: increasing one
    // insulation thickness can overlap another core. Retain the real preview
    // error, but do not PUT an intentionally invalid document. The first before
    // artifact preserves the rejected save; following steps need clean input.
    if (await dirty()) {
      const undo = await command('撤销');
      await expect(undo).toBeEnabled();
      await undo.click();
    }
    await expect(input).toHaveValue(original);
    await expect.poll(dirty).toBe(false);
    check('撤销恢复原保存尺寸且未写入非法几何', (await workspace(main.id)).revision === before.revision);
    await capture('结构编辑-撤销恢复合法保存输入');
  });

  await attempt('05b-合法尺寸编辑保存并撤销保存版本', async () => {
    await module('结构 ·');
    const before = await workspace(main.id);
    const input = layers().getByRole('textbox', { name: '绝缘厚度', exact: true }).first();
    const original = await input.inputValue();
    // A small reduction leaves the source's fixed core centres unchanged and
    // avoids the overlap seen in the first walk. This is an isolated edit only.
    const changed = Math.max(Number(original) - 0.1, Number(original) * 0.9).toFixed(3);
    await input.fill(changed);
    await input.press('Tab');
    await save(main.id);
    await expect.poll(async () => (await workspace(main.id)).revision).toBeGreaterThan(before.revision);
    await capture('结构编辑-合法尺寸已保存');
    const undo = await command('撤销');
    await expect(undo).toBeEnabled();
    await undo.click();
    await expect(input).toHaveValue(original);
    await expect.poll(async () => (await workspace(main.id)).domain).toEqual(before.domain);
    check('尺寸可保存且撤销保留原工程输入与来源', true);
  });

  await attempt('06-添加结构层并查找删除入口', async () => {
    await module('结构 ·');
    const doc = (await workspace(main.id)).domain;
    const material = doc.materials.find(item => ['insulation', 'sheath', 'polymer'].includes(item.category))
      || doc.materials.find(item => /XLPE|PVC|聚乙烯|聚氯乙烯/.test(item.label));
    if (!check('新增层可选择本型号真实材料', Boolean(material), doc.materials.map(item => ({ name: item.label, category: item.category })))) return;
    await page.getByRole('button', { name: '添加结构层', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '添加结构层', exact: true });
    await choose('所属位置', '共同层', dialog);
    await choose('结构层', '隔离层', dialog);
    await choose('新层材料', material.label, dialog);
    await field('新层厚度', '0.2', dialog);
    await choose('新层构造', '挤包或连续层', dialog);
    await dialog.getByRole('button', { name: '添加到草稿', exact: true }).click();
    await expect(dialog).toBeHidden();
    const added = layers().getByRole('row').filter({ hasText: '隔离层' });
    await expect(added).toHaveCount(1);
    await added.click();
    await capture('结构编辑-新层与属性');
    const remove = page.getByRole('button', { name: /删除(?:所选)?结构层|删除(?:所选)?层|移除(?:所选)?层/ }).first();
    const canRemove = check('新加的结构层有删除入口', await remove.isVisible(), await visibleText());
    if (canRemove) {
      await remove.click();
      const confirm = page.getByRole('dialog').getByRole('button', { name: /确认删除|删除/, exact: false });
      if (await confirm.isVisible()) await confirm.click();
      await expect(added).toHaveCount(0);
    } else {
      const undo = await command('撤销');
      if (undo && await undo.isEnabled()) await undo.click();
    }
    await expect(added).toHaveCount(0);
    await save(main.id);
  });

  await attempt('07-标准核对与不满足项定位', async () => {
    await module('标准核对');
    if (!await run('执行标准核对', 'standard-check-results')) return;
    const table = page.getByRole('table', { name: '标准核对', exact: true });
    await expect(table).toBeVisible();
    const issues = table.getByRole('row').filter({ hasText: /不满足|待补|缺项|不适用|未覆盖/ });
    check('标准核对结果逐项可读', await table.getByRole('row').count() > 1, await table.innerText());
    await capture('标准核对-真实结果');
    if (await issues.count()) {
      await issues.first().click();
      const locate = page.getByRole('button', { name: '定位结构层', exact: true });
      const repair = issues.first().getByRole('button').first();
      if (await locate.isVisible()) {
        await locate.click();
        await expect(page).toHaveURL(/\/structure\/table.*layer=/);
        await expect(layers().getByRole('row', { selected: true })).toBeVisible();
        check('标准核对不满足项可定位到结构层', true);
      } else if (await repair.isVisible()) {
        const from = page.url();
        await repair.click();
        await expect.poll(() => page.url()).not.toBe(from);
        check('标准核对缺项有真实修正入口', true, await visibleText());
      } else check('标准核对不满足项可定位修正', false, await visibleText());
    } else check('本次标准结果没有需要定位的不满足项', true, '当前真实输入全部通过；没有伪造不满足结果。');
  });

  for (const analysis of [
    { module: '电气参数', result: 'electrical-results', inputs: [['工作温度', '90'], ['频率', '50']] },
    { module: '短路容量', result: 'short-circuit-results', inputs: [['持续时间', '1'], ['初始绝对温度', '90'], ['导体最终温度', '250']] },
  ]) {
    await attempt(`08-${analysis.module}-填写方法条件并运行`, async () => {
      await module(analysis.module);
      await page.getByRole('tab', { name: '方法参数', exact: true }).click();
      // Units come from the installed method contract: degrees C, Hz and seconds.
      // These are explicit isolated teaching conditions, not manufacturer evidence.
      for (const [label, value] of analysis.inputs) await field(label, value);
      if (analysis.module === '电气参数') {
        const cable = (await workspace(main.id)).domain.cable_types[0];
        if (cable.rating?.u0) await field('运行相电压', cable.rating.u0);
        await advanced(page.locator('.type-method-fields'));
        for (const label of ['集肤效应系数', '邻近效应系数', '成缆绞入系数']) await field(label, '1');
        await choose('R₂₀ 长度基准', '成品电缆长度');
        if (cable.cores.length === 3) await choose('相间排列', '品字排列');
        // The steel-armour reference cannot be declared non-magnetic. Leave
        // that branch and unsupported impedance explicitly unresolved.
      } else {
        await choose('金属容量校核口径', '绝热容量');
      }
      await capture(analysis.module + '-明示教学方法条件');
      await page.getByRole('button', { name: '保存方法条件', exact: true }).click();
      await expect(toolbar().locator('.command-state')).not.toContainText('未保存');
      await page.getByRole('tab', { name: '结果', exact: true }).click();
      if (!await run('计算' + analysis.module, analysis.result)) return;
      const table = page.getByRole('table', { name: analysis.module, exact: true });
      await expect(table).toBeVisible();
      check(analysis.module + '显示保存的计算项与缺项原因', await table.getByRole('row').count() > 1, await table.innerText());
      await table.getByRole('row').nth(1).click();
    });
  }

  await attempt('09-建立载流量工况表并运行', async () => {
    await module('载流量表');
    await page.getByRole('button', { name: '添加工况', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '添加工况', exact: true });
    const caseName = '25°C 直埋教学工况 ' + tag;
    await field('工况名称', caseName, dialog);
    const three = (await workspace(main.id)).domain.cable_types[0].cores.length === 3;
    await choose('工况排列', three ? '三芯直埋 · 单回' : '直埋 · 品字', dialog);
    await field('交流频率 / Hz', '50', dialog);
    await dialog.getByRole('button', { name: '添加到工况表', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 90000 });
    await page.getByText('所选工况条件 · ' + caseName, { exact: true }).click();
    for (const [label, value] of [['环境温度', '25'], ['中心埋深', '1'], ['土壤热阻率', '1'], ['中心距', '0.2']]) {
      await field(caseName + ' ' + label, value);
    }
    await field('条件来源', 'T1 隔离走查明示教学条件：25°C、埋深 1 m、土壤热阻率 1 K·m/W、中心距 0.2 m；不是工程现场实测或批准数据。');
    await choose('接地', '两端接地');
    await save(main.id);
    await capture('载流量表-工况与来源已保存');
    await page.getByRole('tab', { name: '方法参数', exact: true }).click();
    await expect(page.locator('.parameter-form .buzzform-contract')).toBeVisible();
    await advanced(page.locator('.parameter-form'));
    for (const [label, value] of [['集肤效应系数', '1'], ['邻近效应系数', '1'], ['初始护套温度', '70']]) await field(label, value);
    await choose('外部热阻形式', '精确形式');
    await choose('涡流损耗处理', '忽略');
    await field('来源', 'T1 隔离走查明示教学条件：ks=kp=1，精确外部热阻，忽略涡流，初始护套温度70°C；不是厂家默认值、现场测量或批准数据。');
    await save(main.id);
    const ratingStudy = (await api(`/api/workspaces/${main.id}/studies`))
      .filter(item => item.definition.driver.kind === 'batch').sort((a, b) => b.created.localeCompare(a.created))[0];
    check('载流量方法条件与明确教学来源已保存', ratingStudy?.definition.parameters.ks === 1
      && ratingStudy?.definition.parameters.kp === 1
      && /T1 隔离走查/.test(ratingStudy?.definition.input_sources?.['/parameters/ks']?.reference || ''), ratingStudy?.definition);
    await capture('载流量表-方法参数与来源已保存');
    await page.getByRole('tab', { name: '结果表', exact: true }).click();
    if (!await run('计算所选工况', 'rating-table-results')) return;
    const table = page.getByRole('table', { name: '载流量表', exact: true });
    const currentStudy = (await api(`/api/workspaces/${main.id}/studies`))
      .filter(item => item.definition.driver.kind === 'batch').sort((a, b) => b.created.localeCompare(a.created))[0];
    const current = (await api(`/api/workspaces/${main.id}/studies/${currentStudy.id}/runs`)).items
      .filter(item => item.freshness === 'current' && item.integrity === 'verified').sort((a, b) => b.created.localeCompare(a.created))[0];
    const results = current && await api(`/api/design/workspaces/${main.id}/rating-table-runs/${current.id}`);
    const value = results?.rows.find(row => row.name === caseName);
    check('载流量表显示当前工况的真实正电流', Boolean(value && value.value_a > 0)
      && (await table.innerText()).includes(caseName), { row: value, visible: await table.innerText() });
  });

  await attempt('10-缺项草稿拒绝客户交付并定位真实缺项', () => generateSpecification(main.id, '缺项草稿规格书', 'incomplete', true));

  await attempt('10b-预览章节并下载保留缺项的内部审核稿', async () => {
    await module('规格书');
    await choose('文档版本', '内部审核版');
    await expect(page.getByTitle('正式规格书预览')).toBeVisible();
    const before = await api(`/api/types/${main.id}/specification?audience=internal&view=detail`);
    const chapters = page.getByRole('navigation', { name: '规格书章节', exact: true });
    await chapters.getByRole('button', { name: '结构尺寸表', exact: true }).click();
    await expect(page.frameLocator('iframe[title="正式规格书预览"]').locator('[data-specification-section="structure"]')).toBeVisible();
    await capture('规格书-内部审核稿结构章节与缺项');
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 180000 }),
      page.getByRole('button', { name: '导出内部审核稿', exact: true }).click(),
    ]);
    const filename = path.join(out, `types-${size.width}-${tag}-internal.pdf`);
    await download.saveAs(filename);
    const bytes = await fs.readFile(filename);
    const after = await api(`/api/types/${main.id}/specification?audience=internal&view=detail`);
    check('内部审核稿下载是有效PDF且保留原校核与生命周期', bytes.subarray(0, 5).toString() === '%PDF-'
      && after.ready === before.ready && after.lifecycle.status === before.lifecycle.status
      && JSON.stringify(after.payload.checks) === JSON.stringify(before.payload.checks), {
      file: path.basename(filename), bytes: bytes.length, ready: after.ready,
      blockers: after.payload.checks.filter(item => item.blocking).map(item => item.id),
    });
  });

  await attempt('11-缺项草稿保留审核门禁并定位字段', () => reviewSpecification(main.id, '缺项草稿规格书', true));

  await attempt('12-建立独立改版方案并保留原型号', async () => {
    await module('方案对比');
    const original = await workspace(main.id);
    await page.getByRole('button', { name: '建立方案', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '建立独立型号方案', exact: true });
    await field('方案名称', name('改版'), dialog);
    const branch = await responseFor('POST', `/api/types/${main.id}/plans`, () => dialog.getByRole('button', { name: '建立方案', exact: true }).click());
    expect(branch.workspace_id).not.toBe(main.id);
    await expect(page).toHaveURL(new RegExp('/types/' + branch.workspace_id + '/structure/section'));
    await expect(layers()).toBeVisible();
    const branched = await workspace(branch.workspace_id);
    const source = await workspace(main.id);
    check('独立改版可编辑且不改变原保存型号', branched.type_lifecycle?.status === 'draft' && source.revision === original.revision, {
      source: main.id, originalRevision: original.revision, savedRevision: source.revision,
      branch: branch.workspace_id, lifecycle: branched.type_lifecycle,
    });
    check('独立改版的型号名可与原型号区分', branched.domain.name === name('改版'), {
      requested: name('改版'), saved: branched.domain.name, original: original.domain.name,
    });
    const input = layers().getByRole('textbox', { name: '绝缘厚度', exact: true }).first();
    const originalValue = Number(await input.inputValue());
    const revisedValue = Math.max(originalValue - 0.1, originalValue * 0.9).toFixed(3);
    await input.fill(revisedValue);
    await input.press('Tab');
    await save(branch.workspace_id);
    await expect.poll(async () => (await workspace(branch.workspace_id)).revision).toBeGreaterThan(branched.revision);
    const originalAfterEdit = await workspace(main.id);
    check('独立方案修改保存不回写原型号', originalAfterEdit.revision === original.revision
      && JSON.stringify(originalAfterEdit.domain) === JSON.stringify(original.domain));
    await capture('改版-独立修改已保存且原型号保留');
    await module('方案对比');
    await page.getByRole('tab', { name: '参数差异', exact: true }).click();
    const differences = page.getByRole('table', { name: '方案参数差异', exact: true });
    await expect(differences.getByRole('row').filter({ hasText: /芯 1.*绝缘.*厚度/ })).toBeVisible();
    check('改版比较显示真实保存的厚度差异', (await differences.innerText()).includes(revisedValue)
      && (await differences.innerText()).includes(originalValue.toFixed(3)), await differences.innerText());
    await capture('改版-原型号与独立方案参数对比');
  });

  // This is a separate design object. The manufacturer's library copy above
  // intentionally retains its missing densities and manufacturing facts.
  // Read the release demo's saved teaching conditions, then enter them through
  // real forms in an independent plan. No evidence or approval is fabricated.
  const delivery = await attempt('13-打开来源完整的教学型号并建立独立交付方案', async () => {
    const candidates = await api('/api/design/type-workspaces');
    const seed = candidates.find(item => item.name === 'YJV22-8.7/15 3×300');
    if (!check('发布种子提供独立的三芯教学型号', Boolean(seed), candidates.map(item => item.name))) return null;
    const original = await workspace(seed.id);
    const studies = await api(`/api/workspaces/${seed.id}/studies`);
    const conditions = parameters => parameters && Object.fromEntries(Object.entries(parameters)
      .filter(([key]) => !['basis_references', 'cable_type_id', 'circuit_id'].includes(key)));
    const electrical = conditions(studies.find(item => item.definition.parameters?.temperature_k
      && item.definition.parameters?.core_lay_factor && item.definition.parameters?.sources)?.definition.parameters);
    const short = conditions(studies.find(item => item.definition.parameters?.duration_s
      && item.definition.parameters?.metal_initial_temperature_k && item.definition.parameters?.sources)?.definition.parameters);
    const rating = studies.find(item => item.definition.driver.kind === 'batch'
      && /教学/.test(item.definition.parameters?.source || ''))?.definition;
    const cable = original.domain.cable_types[0];
    const used = new Set([...cable.cores.flatMap(core => [core.conductor.material, ...core.layers.map(layer => layer.material)]),
      ...cable.common_layers.map(layer => layer.material)]);
    const densities = original.domain.materials.filter(material => used.has(material.id)).map(material => ({ label: material.label, density: material.density }));
    if (!check('教学型号保存完整密度及可追溯的计算条件', densities.length > 0 && densities.every(material => material.density > 0)
      && electrical && short && rating && Object.values(electrical.sources).every(value => /教学/.test(value))
      && Object.values(short.sources).every(value => /教学/.test(value)), { source: seed, densities, electrical, short, rating: rating?.parameters })) return null;
    await page.goto(base + '/types?theme=light');
    await expect(page.locator('[data-type-page="list"]')).toHaveAttribute('data-type-state', 'success');
    await field('查找型号', seed.name);
    await page.getByRole('table', { name: '型号', exact: true }).getByRole('button', { name: seed.name, exact: true }).click();
    await expect(layers()).toBeVisible();
    await capture('教学交付-已保存的来源完整型号');
    await module('方案对比');
    await page.getByRole('button', { name: '建立方案', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '建立独立型号方案', exact: true });
    const title = name('教学交付副本');
    await field('方案名称', title, dialog);
    const branch = await responseFor('POST', `/api/types/${seed.id}/plans`, () => dialog.getByRole('button', { name: '建立方案', exact: true }).click());
    await expect(page).toHaveURL(new RegExp('/types/' + branch.workspace_id + '/structure/section'));
    await expect(layers()).toBeVisible();
    // Rename through the existing editor, independently of the plan-name defect
    // recorded in step 12; retain the source's proven geometry for calculation.
    await page.getByRole('button', { name: '修改型号名称', exact: true }).click();
    const rename = page.getByRole('dialog', { name: '修改型号名称', exact: true });
    await field('新的型号名称', title, rename);
    await rename.getByRole('button', { name: '确认', exact: true }).click();
    await expect(rename).toBeHidden();
    await save(branch.workspace_id);
    const copied = await workspace(branch.workspace_id), source = await workspace(seed.id);
    check('教学交付副本独立保存且保留源型号和来源', branch.workspace_id !== seed.id && copied.domain.name === title
      && JSON.stringify(copied.domain.cable_types) === JSON.stringify(original.domain.cable_types)
      && JSON.stringify(copied.domain.materials) === JSON.stringify(original.domain.materials)
      && source.revision === original.revision && JSON.stringify(source.domain) === JSON.stringify(original.domain), {
      source: seed.id, sourceRevision: original.revision, copy: branch.workspace_id, copyRevision: copied.revision,
    });
    (report.deliverySources ||= []).push({ ...size, source: seed.id, sourceRevision: original.revision,
      copy: branch.workspace_id, origin: original.type_origin_reference, densities, electrical, short, rating: rating.parameters });
    return { id: branch.workspace_id, source: seed.id, original, electrical, short, rating };
  });
  if (!delivery) return;

  await attempt('14-教学交付副本运行真实结构推导', async () => {
    await module('结构 ·');
    await page.getByRole('tab', { name: '外径与用料', exact: true }).click();
    if (!await run('更新结构推导', 'quantities')) return;
    await expect(page.getByRole('table', { name: '外径与用料', exact: true })).toBeVisible();
  });
  await attempt('15-教学交付副本运行真实标准核对', async () => {
    await module('标准核对');
    if (!await run('执行标准核对', 'standard-check-results')) return;
    await expect(page.getByRole('table', { name: '标准核对', exact: true })).toBeVisible();
  });
  const celsius = value => Number((value - 273.15).toPrecision(12));
  for (const analysis of [
    { label: '电气参数', result: 'electrical-results', parameters: delivery.electrical, fields: [
      ['temperature_k', '工作温度', celsius], ['frequency_hz', '频率'], ['phase_voltage_v', '运行相电压'],
      ['ks', '集肤效应系数'], ['kp', '邻近效应系数'], ['spacing_m', '导体中心距', value => value * 1000], ['core_lay_factor', '成缆绞入系数'],
    ], selections: [['r20_length_basis', 'R₂₀ 长度基准', { finished_cable: '成品电缆长度', straight_core: '直线线芯长度' }],
      ['arrangement', '相间排列', { trefoil: '品字排列', flat: '水平排列' }]] },
    { label: '短路容量', result: 'short-circuit-results', parameters: delivery.short, fields: [
      ['duration_s', '持续时间'], ['initial_temperature_k', '初始绝对温度', celsius], ['final_temperature_k', '导体最终温度', celsius],
      ['metal_initial_temperature_k', '金属组件初始温度', celsius], ['metal_final_temperature_k', '金属组件最终温度', celsius],
      ['contact_factor', '金属接触因数'], ['inner_thermal_resistivity', '内侧介质热阻率'], ['outer_thermal_resistivity', '外侧介质热阻率'],
      ['inner_volumetric_heat_capacity', '内侧介质体积热容'], ['outer_volumetric_heat_capacity', '外侧介质体积热容'],
    ], selections: [] },
  ]) {
    await attempt('16-教学交付副本录入已有来源并运行' + analysis.label, async () => {
      await module(analysis.label);
      await page.getByRole('tab', { name: '方法参数', exact: true }).click();
      await expect(page.locator('.type-method-fields .buzzform-contract')).toBeVisible();
      await advanced(page.locator('.type-method-fields'));
      for (const [key, label, convert = value => value] of analysis.fields) {
        expect(Number.isFinite(analysis.parameters[key]), key + '必须来自已保存的教学条件').toBeTruthy();
        await field(label, convert(analysis.parameters[key]));
      }
      for (const [key, label, labels] of analysis.selections) {
        expect(labels[analysis.parameters[key]], key + '必须来自已保存的教学条件').toBeTruthy();
        await choose(label, labels[analysis.parameters[key]]);
      }
      await page.getByRole('button', { name: '保存方法条件', exact: true }).click();
      await expect.poll(dirty).toBe(false);
      await capture('教学交付-' + analysis.label + '-已有来源条件已保存');
      await page.getByRole('tab', { name: '结果', exact: true }).click();
      if (!await run('计算' + analysis.label, analysis.result)) return;
      await expect(page.getByRole('table', { name: analysis.label, exact: true })).toBeVisible();
    });
  }
  await attempt('17-教学交付副本录入已有工况并运行载流量表', async () => {
    const condition = delivery.rating.driver.cases.map(item => item.metadata?.condition)
      .find(item => item?.layout === 'three_core_buried_single');
    expect(condition, '教学种子必须提供真实保存的三芯直埋单回条件').toBeTruthy();
    const parameters = delivery.rating.parameters, caseName = '已有来源的教学直埋工况 ' + tag;
    await module('载流量表');
    await page.getByRole('button', { name: '添加工况', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '添加工况', exact: true });
    await field('工况名称', caseName, dialog);
    await choose('工况排列', '三芯直埋 · 单回', dialog);
    await field('交流频率 / Hz', condition.frequency_hz, dialog);
    await dialog.getByRole('button', { name: '添加到工况表', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 90000 });
    await page.getByText('所选工况条件 · ' + caseName, { exact: true }).click();
    for (const [key, label] of [['ambient_temperature_c', '环境温度'], ['depth_m', '中心埋深'], ['soil_rho_k_m_w', '土壤热阻率']]) {
      await field(caseName + ' ' + label, condition[key]);
    }
    await field(caseName + ' 中心距', condition.spacing_m ?? '');
    expect(condition.bonding).toBe('both_ends');
    expect(condition.rating_basis).toBe('simultaneous');
    await choose('接地', '两端接地');
    await choose('载流量口径', '全回路等负荷');
    await field('条件来源', condition.source);
    await save(delivery.id);
    await page.getByRole('tab', { name: '方法参数', exact: true }).click();
    await expect(page.locator('.parameter-form .buzzform-contract')).toBeVisible();
    await advanced(page.locator('.parameter-form'));
    for (const [label, value] of [['集肤效应系数', parameters.ks], ['邻近效应系数', parameters.kp],
      ['初始护套温度', celsius(parameters.solver.initial_sheath_temperature_k)], ['最大迭代次数', parameters.solver.max_iterations],
      ['电流容差', parameters.solver.current_tolerance_a]]) await field(label, value);
    expect(parameters.t4_form).toBe('exact'); expect(parameters.eddy).toBe('ignored'); expect(parameters.reference_basis).toBe('iec2023');
    await choose('外部热阻形式', '精确形式'); await choose('涡流损耗处理', '忽略'); await choose('参考依据', 'IEC 2023 依据');
    await field('来源', parameters.source);
    await save(delivery.id);
    await capture('教学交付-载流量工况与已有来源已保存');
    await page.getByRole('tab', { name: '结果表', exact: true }).click();
    if (!await run('计算所选工况', 'rating-table-results')) return;
    const study = (await api(`/api/workspaces/${delivery.id}/studies`)).filter(item => item.definition.driver.kind === 'batch')
      .sort((a, b) => b.created.localeCompare(a.created))[0];
    const current = (await api(`/api/workspaces/${delivery.id}/studies/${study.id}/runs`)).items
      .filter(item => item.freshness === 'current' && item.integrity === 'verified').sort((a, b) => b.created.localeCompare(a.created))[0];
    const result = current && await api(`/api/design/workspaces/${delivery.id}/rating-table-runs/${current.id}`);
    check('教学交付载流量由当前真实运行取得正电流', result?.rows.some(row => row.name === caseName && row.value_a > 0), result);
  });
  await attempt('18-教学交付副本生成客户规格书并下载真实PDF', () => generateSpecification(delivery.id, '教学交付规格书', 'teaching'));
  await attempt('19-教学交付副本逐项审核并执行版本流程', () => reviewSpecification(delivery.id, '教学交付规格书'));
  const sourceAfterDelivery = await workspace(delivery.source);
  check('交付计算和文档流程没有改动原教学型号', sourceAfterDelivery.revision === delivery.original.revision
    && JSON.stringify(sourceAfterDelivery.domain) === JSON.stringify(delivery.original.domain));
});
