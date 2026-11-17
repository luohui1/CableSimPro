import fs from 'node:fs/promises';
import path from 'node:path';
import { walkthrough } from './verify-workbench-support.mjs';

// Run with isolated-e2e.mjs and the engineering demo database. All writes below
// are mouse/keyboard actions; GETs only verify the state returned by this host.
// Deliberately incomplete engineering inputs remain visible in the evidence.
await walkthrough('types', async ({ page, expect, base, api, choose, capture, step, check, out, size, tag }) => {
  const name = origin => `T1 型号走查 · ${origin} · ${tag}`;
  const versionLabel = value => String(value || '').replace(/\+engineering$/, '（工程版）').replace(/\+[^\s]+$/, '（定制版）') || '未提供';
  const workspace = id => api(`/api/workspaces/${encodeURIComponent(id)}`);
  const visibleText = () => page.locator('body').innerText();
  const toolbar = () => page.getByRole('toolbar', { name: '型号命令', exact: true });
  const layers = () => page.getByRole('table', { name: '型号分层', exact: true });

  async function dismissDialog() {
    for (let count = 0; count < 3 && await page.getByRole('dialog').count(); count++) {
      const leave = page.getByRole('dialog', { name: '型号有未保存修改', exact: true });
      if (await leave.isVisible()) await leave.getByRole('button', { name: '放弃修改并离开', exact: true }).click();
      else await page.keyboard.press('Escape');
    }
  }
  async function attempt(label, action) {
    try { return await step(label, action); }
    catch (error) {
      check(label, false, { error: error.message, state: await visibleText() });
      await dismissDialog();
      return undefined;
    }
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
  }
  async function save(id) {
    await page.keyboard.press('Control+s');
    await expect(toolbar().locator('.command-state')).not.toContainText('未保存');
    await expect(page.getByText('结构修改待保存。', { exact: true })).toHaveCount(0);
    return workspace(id);
  }
  async function command(label) {
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
    const button = await command(label);
    if (!check(label + '可从当前页面启动', button && await button.isEnabled(), await visibleText())) return false;
    await button.click();
    const dialog = page.getByRole('dialog', { name: label + ' · 预检', exact: true });
    await expect(dialog).toBeVisible({ timeout: 90000 });
    await capture(label + '-真实预检');
    const ack = dialog.getByRole('checkbox', { name: '已核对输入来源与方法适用范围', exact: true });
    if (!check(label + '通过真实预检', await ack.isVisible(), await dialog.innerText())) {
      await page.keyboard.press('Escape');
      return false;
    }
    await ack.check();
    await dialog.getByRole('button', { name: '确认并运行', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 180000 });
    await expect(page.locator(`[data-type-page="${resultPage}"]`)).toHaveAttribute('data-type-state', 'success', { timeout: 180000 });
    check(label + '取得当前保存结果', true);
    return true;
  }

  const options = await api('/api/types/creation-options');
  await attempt('01-型号列表与批量操作入口', async () => {
    await page.goto(base + '/types?theme=light');
    await expect(page.getByRole('button', { name: '新建型号', exact: true })).toBeVisible();
    await expect(page.getByRole('searchbox', { name: '查找型号', exact: true })).toBeVisible();
    await field('查找型号', 'YJV22');
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

  await attempt('05-尺寸编辑撤销重做与保存', async () => {
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
    } else {
      // Continue the baseline through the same visible editor; do not forge history.
      await input.fill(changed);
      await input.press('Tab');
    }
    await save(main.id);
    await expect.poll(async () => (await workspace(main.id)).revision).toBeGreaterThan(before.revision);
    await input.fill(original);
    await input.press('Tab');
    await save(main.id);
    check('尺寸可保存且还原原工程输入', true);
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
    { module: '短路容量', result: 'short-circuit-results', inputs: [['持续时间', '1'], ['导体初始温度', '90'], ['导体最终温度', '250']] },
  ]) {
    await attempt(`08-${analysis.module}-填写方法条件并运行`, async () => {
      await module(analysis.module);
      await page.getByRole('tab', { name: '方法参数', exact: true }).click();
      // Units come from the installed method contract: degrees C, Hz and seconds.
      // These are explicit isolated teaching conditions, not manufacturer evidence.
      for (const [label, value] of analysis.inputs) await field(label, value);
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
    if (!await run('计算所选工况', 'rating-table-results')) return;
    const table = page.getByRole('table', { name: '载流量表', exact: true });
    check('载流量表显示当前工况的真实结果', (await table.innerText()).includes(caseName), await table.innerText());
  });

  await attempt('10-生成规格书并核验真实下载', async () => {
    await module('规格书');
    await expect(page.locator('[data-type-page="specification-results"]')).not.toHaveAttribute('data-type-state', 'loading');
    await expect(page.getByTitle('正式规格书预览')).toBeVisible();
    await capture('规格书-生成前缺项与章节');
    const generate = await command('生成规格书');
    if (!check('规格书有可启动的生成操作', generate && await generate.isEnabled(), await visibleText())) return;
    let download;
    const listener = item => { download = item; };
    page.on('download', listener);
    try {
      const response = await responseFor('POST', `/api/types/${main.id}/specification/generate`, () => generate.click(), 360000);
      await expect(page.locator('[data-type-page="specification-results"]')).not.toHaveAttribute('data-type-state', 'loading', { timeout: 180000 });
      if (!check('完整规格书生成通过全部真实方法', response.status === 'generated', response)) {
        await capture('规格书-生成受阻的真实原因');
        const repair = page.getByRole('button', { name: /^查看.+条件$/ }).first();
        check('规格书生成受阻时给出可跳转的条件入口', await repair.isVisible(), await visibleText());
        return;
      }
      await expect.poll(() => Boolean(download), { timeout: 60000 }).toBe(true);
      const filename = path.join(out, `types-${size.width}-${tag}-customer.pdf`);
      await download.saveAs(filename);
      const bytes = await fs.readFile(filename);
      check('客户规格书下载是有效 PDF', bytes.subarray(0, 5).toString() === '%PDF-', { file: path.basename(filename), bytes: bytes.length });
    } finally { page.off('download', listener); }
  });

  await attempt('11-规格书审核发布或真实校核阻塞', async () => {
    await module('规格书');
    await page.getByRole('tab', { name: '审核与发布', exact: true }).click();
    let spec = await api(`/api/types/${main.id}/specification?audience=customer&view=detail`);
    const blockers = spec.payload.checks.filter(item => item.blocking === true);
    await capture('规格书-审核与发布清单');
    if (!check('本次设计具备提交审核的完整输入与结果', spec.ready && blockers.length === 0, { ready: spec.ready, blockers })) {
      const submit = page.getByRole('button', { name: '提交评审', exact: true });
      check('校核未闭合时禁止发布并显示实际原因', await submit.isDisabled() && blockers.length > 0, await visibleText());
      return;
    }
    for (const action of ['采纳为版本草稿', '提交评审', '人工批准', '发布型号版本']) {
      const button = page.locator('.type-result-summary').getByRole('button', { name: action, exact: true });
      await expect(button).toBeEnabled();
      await button.click();
      const dialog = page.getByRole('dialog', { name: action, exact: true });
      if (action === '提交评审') {
        await field('变更摘要', 'T1 隔离走查：从固定库引用核对结构与保存的真实计算结果；仅作为测试版本。', dialog);
        await field('编制人', 'T1 隔离走查', dialog);
      }
      await capture('规格书-' + action + '-确认前');
      await dialog.getByRole('checkbox', { name: '已核对当前版本与提交前校核清单', exact: true }).check();
      await dialog.getByRole('button', { name: action, exact: true }).click();
      await expect(dialog).toBeHidden({ timeout: 90000 });
    }
    spec = await api(`/api/types/${main.id}/specification?audience=customer&view=detail`);
    check('型号人工审核发布闭环', spec.lifecycle.status === 'published', spec.lifecycle);
    await page.getByRole('tab', { name: '修订记录', exact: true }).click();
    await expect(page.getByRole('table', { name: '文档修订记录', exact: true })).toBeVisible();
  });

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
    await module('方案对比');
    await page.getByRole('tab', { name: '参数差异', exact: true }).click();
    await capture('改版-原型号与独立方案参数对比');
  });
});
