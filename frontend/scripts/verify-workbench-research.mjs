import fs from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { walkthrough } from './verify-workbench-support.mjs';

// Read the real download, including escaped quotes and multiline source cells.
function csvRows(text) {
  const rows = [], input = text.replace(/^\uFEFF/, '');
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"') {
      if (quoted && input[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && char === ',') { row.push(cell); cell = ''; }
    else if (!quoted && (char === '\r' || char === '\n')) {
      if (char === '\r' && input[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += char;
  }
  if (quoted) throw Error('CSV 下载含未闭合的引号');
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// Engineering changes go through the real interface. GETs verify saved identities.
await walkthrough('research', async ({ page, expect, base, api, choose, step, check, capture, out, tag, report }) => {
  const command = () => page.getByRole('toolbar', { name: '工程命令', exact: true });
  const field = label => page.getByLabel(label, { exact: true });
  async function clickCommand(label) {
    const button = command().getByRole('button', { name: label, exact: true });
    if (await button.isVisible()) return button.click();
    await command().getByRole('button', { name: '更多操作', exact: true }).click();
    await page.getByRole('menuitem', { name: label, exact: true }).click();
  }
  async function fill(label, value) {
    await field(label).fill(value);
    await field(label).press('Enter');
  }
  async function independent(label, action) {
    try { return await step(label, action); }
    catch (error) {
      if (report.phase !== 'before') throw error;
      check(label + '可完成', false, error.message);
    }
  }
  await step('01-create-project-and-research', async () => {
    await page.goto(base + '/?theme=light');
    await page.getByRole('button', { name: '新建研究', exact: true }).first().click();
    await choose('所属工程', '新建工程');
    await choose('研究任务', '额定载流量');
    await field('研究名称').fill('直埋载流量 · ' + tag);
    await choose('引用型号版本', /^YJL02-12\/20 kV 1×400（结构演示）/);
    await choose('计算方法', /^IEC 60287/);
    await capture('01-new-project-form');
    const projectName = page.getByRole('textbox', { name: '工程名称', exact: true });
    check('新建工程可以填写明确工程名', await projectName.count() > 0);
    if (await projectName.count()) await projectName.fill('直埋线路 · ' + tag);
    check('研究可从选择电缆进入新建型号', await page.getByRole('button', { name: /新建型号|新建电缆/ }).count() > 0);
    await page.getByRole('button', { name: '建立研究', exact: true }).first().click();
    await page.waitForURL(/\/studies\/[^/?]+\/ampacity\/results/);
    await expect(page.getByRole('button', { name: '预检并运行', exact: true })).toBeVisible();
    const treeName = page.locator('.project-explorer .explorer-study-name b').filter({ hasText: tag });
    await expect(treeName).toBeVisible();
    check('工程树显示完整研究名称', await treeName.evaluate(node => node.scrollWidth <= node.clientWidth + 1
      && node.scrollHeight <= node.clientHeight + 1), { title: await treeName.innerText() });
    if (report.phase === 'after') {
      const createdUrl = new URL(page.url()), createdSid = createdUrl.pathname.split('/')[2], createdWid = createdUrl.searchParams.get('workspace');
      expect(createdWid).toBeTruthy();
      const [workspaceIndex, typeIndex, projectStudies] = await Promise.all([
        api('/api/workspaces'), api('/api/design/type-workspaces'), api(`/api/workspaces/${createdWid}/studies`),
      ]);
      const typeIds = new Set(typeIndex.map(item => item.id));
      const projectIds = new Set(workspaceIndex.filter(item => !typeIds.has(item.id)).map(item => item.id));
      const savedProject = workspaceIndex.find(item => item.id === createdWid);
      expect(savedProject?.name).toBe('直埋线路 · ' + tag);
      expect(projectStudies.some(item => item.id === createdSid && item.workspace === createdWid)).toBe(true);
      const sidebar = page.locator('.workbench-sidebar');
      const currentProject = sidebar.locator('a.tree-object').filter({ hasText: savedProject.name });
      await expect(currentProject).toHaveCount(1);
      await expect(currentProject).toHaveAttribute('aria-current', 'page');
      await expect(currentProject.locator('.tree-label')).toHaveText(savedProject.name);
      await expect(currentProject.locator('.tree-count')).toHaveText(String(projectStudies.length));
      await expect(currentProject).toBeInViewport({ ratio: 1 });
      if (projectIds.size > 3) await expect(sidebar.getByRole('link', { name: `全部 ${projectIds.size} 个工程`, exact: true })).toBeVisible();
      const objects = await sidebar.locator('a.tree-object').evaluateAll(links => links.map(link => {
        const url = new URL(link.href);
        return { name: link.textContent.trim(), path: url.pathname, workspace: url.searchParams.get('workspace'), current: link.getAttribute('aria-current') };
      }));
      const projectLinks = objects.filter(item => item.path === '/studies');
      check('新建后工程目录立即显示当前工程、真实研究数及正确分组', projectIds.has(createdWid)
        && projectLinks.some(item => item.workspace === createdWid && item.current === 'page')
        && projectLinks.every(item => projectIds.has(item.workspace))
        && objects.filter(item => item.path.startsWith('/types/')).every(item => typeIds.has(item.path.split('/')[2]))
        && (projectIds.size > 3 || projectLinks.length === projectIds.size),
      { workspace: createdWid, study: createdSid, studyCount: projectStudies.length, projectCount: projectIds.size, visibleObjects: objects });
      await capture('01-created-project-navigation');

      // Use the new directory entry immediately, without reloading the app or
      // waiting for the index's stale time to hide a missing invalidation.
      await currentProject.focus();
      await page.keyboard.press('Enter');
      await page.waitForURL(next => next.pathname === '/studies' && next.searchParams.get('workspace') === createdWid);
      const projectTable = page.getByRole('table', { name: '本工程研究', exact: true });
      const studyLink = projectTable.getByRole('link', { name: '直埋载流量 · ' + tag, exact: true });
      await expect(studyLink).toBeVisible();
      await expect(projectTable.locator('tbody tr')).toHaveCount(projectStudies.length);
      await capture('01-project-directory-keyboard-navigation');
      await studyLink.click();
      await page.waitForURL(next => next.pathname === `/studies/${createdSid}/ampacity/results` && next.searchParams.get('workspace') === createdWid);
      await expect(page.getByRole('button', { name: '预检并运行', exact: true })).toBeVisible();
      check('新工程目录可用键盘进入并用鼠标返回同一研究', new URL(page.url()).searchParams.get('workspace') === createdWid);
    }
  });
  const url = new URL(page.url());
  const sid = url.pathname.split('/')[2], wid = url.searchParams.get('workspace');
  expect(wid).toBeTruthy();
  if (report.phase === 'after') {
    expect((await api(`/api/workspaces/${wid}`)).domain.name).toBe('直埋线路 · ' + tag);
  }
  const prefix = `/api/workspaces/${wid}/studies/${sid}`;
  await step('02-installation-load-and-environment', async () => {
    await page.getByRole('button', { name: '更多绘图工具', exact: true }).click();
    await page.getByRole('button', { name: '敷设模板', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '敷设模板', exact: true });
    await choose('模板', '单回品字', dialog);
    await dialog.getByLabel('中心埋深', { exact: true }).fill('0.9');
    await dialog.getByRole('button', { name: '应用模板', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    if (await page.locator('.drawing-secondary-tools').isVisible()) await page.keyboard.press('Escape');
    await fill('介质热阻率', '0.8');
    await fill('回路 1 · 电流', '500');
    check('草稿显示改了几项', /改了\s*\d+\s*项|\d+\s*(?:项修改|处未保存)/.test(await command().innerText()));
    await command().getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(command().getByRole('button', { name: '已保存', exact: true })).toBeVisible();
  });
  const savedInputUrl = page.url();
  await independent('03a-drag-placement-and-undo', async () => {
    const before = await api(`/api/workspaces/${wid}`);
    const cable = page.getByRole('button', { name: /^选择电缆 .*A$/ });
    await expect(cable).toBeVisible();
    const point = await cable.locator('.drawing-hit-area').boundingBox();
    expect(point).toBeTruthy();
    const x = point.x + point.width / 2, y = point.y + point.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + 20, y - 12, { steps: 8 }); await page.mouse.up();
    await expect(command().getByRole('button', { name: '保存修改', exact: true })).toBeEnabled();
    await capture('03a-placement-drag-is-unsaved');
    check('图上拖动先暂存，不改保存工程', JSON.stringify((await api(`/api/workspaces/${wid}`)).domain) === JSON.stringify(before.domain));
    await clickCommand('撤销');
    await expect(command().getByRole('button', { name: '已保存', exact: true })).toBeVisible();
    check('图上拖动可撤销，保存工程保持原值', JSON.stringify((await api(`/api/workspaces/${wid}`)).domain) === JSON.stringify(before.domain));
  });
  if (report.phase === 'before' && await command().getByRole('button', { name: '保存修改', exact: true }).isVisible()) {
    await clickCommand('撤销');
    await expect(command().getByRole('button', { name: '已保存', exact: true })).toBeVisible();
  }
  await independent('03-keyboard-undo-and-redo', async () => {
    await fill('介质热阻率', '1.1');
    await page.getByRole('button', { name: '更多绘图工具', exact: true }).focus();
    await page.keyboard.press('Control+z');
    await expect.poll(async () => Number(await field('介质热阻率').inputValue())).toBe(0.8);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(async () => Number(await field('介质热阻率').inputValue())).toBe(1.1);
    await page.keyboard.press('Control+z');
    await expect.poll(async () => Number(await field('介质热阻率').inputValue())).toBe(0.8);
  });
  if (report.phase === 'before' && Number(await field('介质热阻率').inputValue()) !== 0.8) {
    // Return through the interface to the saved input before continuing independent results checks.
    const leaveDraft = dialog => dialog.accept();
    page.on('dialog', leaveDraft);
    try { await page.goto(savedInputUrl); }
    finally { page.off('dialog', leaveDraft); }
    await expect.poll(async () => Number(await field('介质热阻率').inputValue())).toBe(0.8);
  }
  async function run(previous) {
    await page.getByRole('button', { name: '预检并运行', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '运行前预检' });
    await expect(dialog).toContainText('你的工况在适用范围内', { timeout: 90000 });
    if (await dialog.getByRole('checkbox').count()) await dialog.getByRole('checkbox').check();
    await capture('run-preflight');
    await dialog.getByRole('button', { name: '确认并运行', exact: true }).click();
    await expect(dialog).toHaveCount(0, { timeout: 90000 });
    await page.waitForURL(next => !!next.searchParams.get('run') && next.searchParams.get('run') !== previous, { timeout: 120000 });
    const id = new URL(page.url()).searchParams.get('run');
    const saved = await api(prefix + '/runs/' + id);
    expect(saved.integrity).toBe('verified');
    expect(saved.status).toBe('succeeded');
    return saved;
  }
  let first, second;
  await step('04-run-and-read-conclusion', async () => {
    first = await run();
    const conclusion = page.getByRole('region', { name: '载流量结论', exact: true });
    await expect(conclusion).toBeVisible();
    await expect(conclusion).toContainText(/允许|载流量/);
    await expect(conclusion).toContainText(/最热|温限/);
  });
  await independent('05-temperature-and-loss-details', async () => {
    for (const [label, shot] of [['温度与电流', '05-layer-temperatures'], ['损耗', '05-losses']]) {
      const detail = page.locator('details.study-detail-group').filter({ has: page.locator('summary', { hasText: label }) });
      check('结果可展开' + label, await detail.count() > 0);
      if (await detail.count()) {
        if (await detail.getAttribute('open') === null) await detail.locator('summary').click();
        const table = detail.getByRole('table');
        await expect(table).toBeVisible();
        // Reading the table means bringing its data into the clipped result
        // panel, not merely finding an offscreen DOM node after expansion.
        const rows = table.getByRole('row');
        await rows.nth(1).scrollIntoViewIfNeeded();
        await expect(rows.nth(1)).toBeInViewport();
        if (report.phase === 'after') for (const phase of ['A','B','C'])
          await expect(table).toContainText(new RegExp(phase + '\\s*相'));
        await capture(shot);
        await rows.last().scrollIntoViewIfNeeded();
        await expect(rows.last()).toBeInViewport();
        await capture(shot + '-last-rows');
        await detail.locator('summary').click();
      }
    }
  });
  await step('06-change-one-condition-and-rerun', async () => {
    await fill('介质热阻率', '1.1');
    await page.keyboard.press('Control+s');
    await expect(command().getByRole('button', { name: '已保存', exact: true })).toBeVisible();
    await expect(page.locator('.study-history-line')).toBeVisible();
    const oldRun = await api(prefix + '/runs/' + first.id);
    check('输入保存后旧运行保持历史且不能当作当前结果交付', oldRun.freshness === 'historical', oldRun.freshness);
    const reportButton = command().getByRole('button', { name: '生成计算书', exact: true });
    if (await reportButton.isVisible()) await expect(reportButton).toBeDisabled();
    else {
      await command().getByRole('button', { name: '更多操作', exact: true }).click();
      await expect(page.getByRole('menuitem', { name: '生成计算书', exact: true })).toBeDisabled();
      await page.keyboard.press('Escape');
    }
    await capture('06-previous-result-is-historical');
    second = await run(first.id);
    const preserved = await api(prefix + '/runs/' + first.id);
    expect(preserved.input_digest).toBe(first.input_digest);
    expect(second.input_digest).not.toBe(first.input_digest);
  });
  const resultUrl = page.url();
  await independent('07-compare-saved-runs', async () => {
    await choose('分析', '方法对比');
    const table = page.getByRole('table', { name: '可比较运行', exact: true });
    await expect(table).toBeVisible();
    const choices = table.getByRole('checkbox');
    const saved = await api(prefix + '/runs?view=summary&limit=100');
    expect(saved.items.filter(item => item.integrity === 'verified' && item.status === 'succeeded')).toHaveLength(2);
    await expect(choices.first()).toBeVisible();
    await capture('07-saved-runs-available-for-selection');
    if (!check('两次真实保存运行均可在界面勾选比较', await choices.count() === 2,
      { saved: saved.items.map(item => item.id), visibleChoices: await choices.count(), screen: await table.innerText() })) return;
    await choices.nth(0).check(); await choices.nth(1).check();
    await page.getByRole('button', { name: '比较所选运行', exact: true }).click();
    await page.getByRole('tab', { name: '输入差异', exact: true }).click();
    const difference = page.getByRole('table', { name: '对比输入差异', exact: true });
    await expect(difference).toBeVisible();
    const soil = difference.getByRole('row').filter({hasText:'热阻率'});
    await expect(soil.first()).toBeVisible();
    await soil.first().evaluate(row => row.scrollIntoView({ block: 'center', inline: 'nearest' }));
    const soilText = await soil.first().innerText();
    await capture('07-input-differences');
    check('对比指出改动的具体条件及前后值', /0[.]8/.test(soilText) && /1[.]1/.test(soilText), soilText);
    check('保存输入的土壤材料名称以中文显示', /土壤/.test(soilText) && !/v0 soil/.test(soilText), soilText);
    await page.getByRole('tab', { name: '结果', exact: true }).click();
    const results = page.getByRole('table', { name: '方法结果差异', exact: true });
    await expect(results).toBeVisible();
    async function checkResultWidth(position) {
      const geometry = await results.evaluate(table => {
        let left = 0, right = innerWidth;
        const containers = [];
        for (let node = table.parentElement; node; node = node.parentElement) {
          if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(node).overflowX)) {
            const box = node.getBoundingClientRect();
            left = Math.max(left, box.left); right = Math.min(right, box.right);
            containers.push({ width: node.clientWidth, content: node.scrollWidth });
          }
        }
        const box = table.getBoundingClientRect();
        const clipped = [...table.querySelectorAll('tr > :last-child')].flatMap(cell => {
          const bounds = cell.getBoundingClientRect();
          return bounds.left < left - 1 || bounds.right > right + 1 || cell.scrollWidth > cell.clientWidth + 1
            ? [{ text: cell.textContent, left: bounds.left, right: bounds.right, width: cell.clientWidth, content: cell.scrollWidth }] : [];
        });
        return { left, right, tableLeft: box.left, tableRight: box.right, width: table.clientWidth, content: table.scrollWidth, containers, clipped };
      });
      check(`比较结果${position}五列无需横向滚动且差值完整显示`, geometry.tableLeft >= geometry.left - 1
        && geometry.tableRight <= geometry.right + 1 && geometry.content <= geometry.width + 1
        && geometry.containers.every(item => item.content <= item.width + 1) && geometry.clipped.length === 0, geometry);
    }
    await results.locator('thead').evaluate(header => header.scrollIntoView({ block: 'start', inline: 'nearest' }));
    await capture('07-result-differences-start');
    await checkResultWidth('首部');
    await results.locator('tbody tr').last().evaluate(row => row.scrollIntoView({ block: 'end', inline: 'nearest' }));
    await capture('07-result-differences-end');
    await checkResultWidth('尾部');
    const csvButton = page.getByRole('button', { name: '导出对比 CSV', exact: true });
    const pending = page.waitForEvent('download', { timeout: 90000 });
    await csvButton.click();
    const file = await pending;
    const csvPath = path.join(out, 'comparison-' + tag + '.csv');
    await file.saveAs(csvPath);
    const csv = await fs.readFile(csvPath, 'utf8'), [headers, ...exported] = csvRows(csv);
    expect(headers).toEqual(['物理量', '对象', '输出条件', '基准 / SI', '对照 / SI', '差值 / SI', '单位', '来源']);
    expect(exported.length).toBeGreaterThan(0);
    expect(exported.every(row => row.length === headers.length)).toBe(true);

    const evidencePending = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载未配对量与固定记录', exact: true }).click();
    const evidenceFile = await evidencePending, evidencePath = path.join(out, 'comparison-evidence-' + tag + '.json');
    await evidenceFile.saveAs(evidencePath);
    const evidence = JSON.parse(await fs.readFile(evidencePath, 'utf8'));
    await capture('07-fixed-comparison-evidence-download');
    const fullRuns = await Promise.all([first, second].map(saved => api(prefix + '/runs/' + saved.id + '?view=full')));
    const byRun = new Map(fullRuns.map(saved => [saved.id, saved]));
    expect(evidence.sources.map(source => source.run_id).sort()).toEqual([...byRun.keys()].sort());
    check('独立 JSON 下载保留两次运行的完整固定输入与方法清单', evidence.sources.every(source => {
      const saved = byRun.get(source.run_id);
      return saved.integrity === 'verified' && source.sequence === saved.sequence
        && isDeepStrictEqual(source.snapshot, saved.snapshot);
    }), { runs: [...byRun.keys()], bytes: (await fs.stat(evidencePath)).size });

    // Excel documents a 32,767-character cell limit. The compact source should
    // remain substantially below it, without truncating any saved identity.
    // https://support.microsoft.com/en-us/excel/excel-specifications-and-limits
    const maxCellChars = Math.max(...exported.flatMap(row => row.map(cell => cell.length)));
    const maxSourceChars = Math.max(...exported.map(row => row[7].length));
    check('CSV 单元格可由表格软件完整保存且来源不重复整份快照', maxCellChars <= 32767 && maxSourceChars <= 4096,
      { rows: exported.length, bytes: Buffer.byteLength(csv, 'utf8'), maxCellChars, maxSourceChars });
    const expected = evidence.differences.flatMap(difference => difference.quantities.map(quantity => ({ difference, quantity })));
    expect(exported).toHaveLength(expected.length);
    const matched = new Set();
    for (const row of exported) {
      const source = JSON.parse(row[7]);
      expect(Object.keys(source).sort()).toEqual(['baseline', 'comparison', 'quantity']);
      expect(Object.keys(source.quantity).sort()).toEqual(['case_id', 'condition', 'entity', 'key', 'unit']);
      const index = expected.findIndex(({ difference, quantity }) => difference.baseline_run_id === source.baseline.run_id
        && difference.run_id === source.comparison.run_id && ['case_id', 'condition', 'entity', 'key', 'unit'].every(key => quantity[key] === source.quantity[key]));
      expect(index, 'CSV 每行必须对应真实比较中的唯一物理量与运行对').toBeGreaterThanOrEqual(0);
      expect(matched.has(index), 'CSV 不能以重复行替代遗漏结果').toBe(false); matched.add(index);
      const { quantity } = expected[index];
      expect(row[3]).not.toBe(''); expect(row[4]).not.toBe(''); expect(row[5]).not.toBe('');
      expect([Number(row[3]), Number(row[4]), Number(row[5]), row[6]])
        .toEqual([quantity.baseline, quantity.value, quantity.difference, quantity.unit ?? '']);
      for (const role of ['baseline', 'comparison']) {
        const trace = source[role], saved = byRun.get(trace.run_id);
        expect(saved, '来源必须指向本次勾选的真实保存运行').toBeTruthy();
        const outputCase = saved.output.cases.find(item => item.case_id === source.quantity.case_id);
        expect(outputCase, 'CSV 的物理量工况必须存在于对应保存运行').toBeTruthy();
        const method = outputCase.method || saved.snapshot.definition.method;
        expect(trace).toEqual({
          workspace_id: saved.workspace, study_id: saved.study, run_id: saved.id, sequence: saved.sequence,
          input_digest: saved.input_digest, output_digest: saved.output_digest,
          method: { plugin_id: method.plugin_id, capability: method.capability, version: method.version, release_digest: method.release_digest },
        });
      }
    }
    check('CSV 每行基准与对照的运行、摘要、方法版本及 SI 数值均与固定记录一致', matched.size === expected.length,
      { rows: matched.size, runs: fullRuns.map(saved => ({ id: saved.id, sequence: saved.sequence, input_digest: saved.input_digest, output_digest: saved.output_digest })) });
    await csvButton.scrollIntoViewIfNeeded();
  });
  await independent('08-calculation-book-download', async () => {
    await page.goto(resultUrl);
    await expect(page.getByRole('region', { name: '载流量结论', exact: true })).toBeVisible();
    await expect(command()).toBeVisible();
    await clickCommand('生成计算书');
    await expect(page.getByRole('button', { name: '下载 PDF', exact: true })).toBeEnabled({ timeout: 90000 });
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载 PDF', exact: true }).click();
    const file = await pending, target = path.join(out, 'calculation-book-' + tag + '.pdf');
    await file.saveAs(target);
    expect((await fs.readFile(target)).subarray(0, 5).toString()).toBe('%PDF-');
    await page.waitForURL(next => !!next.searchParams.get('delivery'));
    const deliveryId = new URL(page.url()).searchParams.get('delivery');
    expect(deliveryId).toBeTruthy();
    const delivery = await api(`/api/workspaces/${wid}/deliveries/${deliveryId}?view=summary`);
    const source = delivery.sources?.find(item => item.run_id === second.id);
    check('计算书引用本次保存运行及准确输入输出摘要', !!source
      && source.input_digest === second.input_digest && source.output_digest === second.output_digest,
      { run: second.id, delivery: deliveryId, source });
  });
  await independent('09-create-type-from-research', async () => {
    const sidebar = page.locator('.workbench-sidebar');
    const visibleObjects = () => sidebar.locator('a.tree-object').evaluateAll(links => links.map(link => {
      const url = new URL(link.href);
      return { name: link.textContent.trim(), path: url.pathname, workspace: url.searchParams.get('workspace'), current: link.getAttribute('aria-current') };
    }));
    if (report.phase === 'after') {
      let releaseRequest, finishRequest, held = false;
      const release = new Promise(resolve => { releaseRequest = resolve; });
      const finished = new Promise(resolve => { finishRequest = resolve; });
      const endpoint = url => url.pathname === '/api/design/type-workspaces';
      const holdIndex = async route => {
        if (route.request().method() !== 'GET' || held) return route.continue();
        held = true;
        try { await release; await route.continue(); }
        finally { finishRequest(); }
      };
      // Exercise the observed index race with a genuine delayed GET. No input,
      // status, response or index membership is replaced by the walkthrough.
      await page.route(endpoint, holdIndex);
      try {
        const spacesRead = page.waitForResponse(response => new URL(response.url()).pathname === '/api/workspaces' && response.request().method() === 'GET');
        const typesRequested = page.waitForRequest(request => new URL(request.url()).pathname === '/api/design/type-workspaces' && request.method() === 'GET');
        await page.goto(base + '/?theme=light');
        const response = await spacesRead;
        expect(response.ok(), '分类必须先取得真实工作区索引').toBe(true);
        await response.finished(); await typesRequested;
        await expect(sidebar.getByText('正在读取工程与型号', { exact: true })).toBeVisible();
        const waiting = await visibleObjects();
        check('型号索引未返回时不把工作区猜成工程', held && waiting.length === 0, { held, visibleObjects: waiting });
        await capture('09-sidebar-waits-for-real-type-index');
      } finally {
        releaseRequest();
        if (held) await finished;
        await page.unroute(endpoint, holdIndex);
      }
      await expect(sidebar.getByText('正在读取工程与型号', { exact: true })).toHaveCount(0);
    } else await page.goto(base + '/?theme=light');
    await page.getByRole('button', { name: '新建研究', exact: true }).first().click();
    const create = page.getByRole('dialog', {name:'新建研究',exact:true});
    await expect(create.getByRole('combobox', {name:'研究任务',exact:true})).toBeVisible();
    const entry = create.getByRole('button', {name:'新建型号',exact:true});
    await expect(entry).toBeEnabled();
    check('研究中的新建型号入口可操作', await entry.isVisible() && await entry.isEnabled());
    await capture('09-create-type-entry');
    await entry.click();
    await page.waitForURL(url => url.pathname === '/types' && url.searchParams.get('create') === 'true');
    const typeCreate = page.getByRole('dialog', {name:'新建型号设计',exact:true});
    const typeName = typeCreate.getByRole('textbox', {name:'型号名称',exact:true});
    await expect(typeName).toBeEditable();
    await expect(typeCreate.getByRole('radiogroup', {name:'起点',exact:true})).toBeVisible();
    await typeName.fill('研究转型号 · ' + tag);
    await expect(typeName).toHaveValue('研究转型号 · ' + tag);
    check('研究入口实际打开可编辑的型号创建表单', await typeCreate.isVisible() && await typeName.isEditable());
    if (report.phase === 'after') {
      const submit = typeCreate.getByRole('button', {name:'建立草稿',exact:true});
      await expect(typeCreate.getByRole('combobox', {name:'型号版本',exact:true})).toBeVisible();
      await expect(submit).toBeDisabled();
      const reason = typeCreate.getByRole('status').filter({hasText:'请选择一个可复制的型号版本'});
      await expect(reason).toBeVisible();
      check('型号创建禁用时就地说明缺少固定版本', await submit.getAttribute('aria-describedby') === await reason.getAttribute('id'));
      await capture('09-create-type-disabled-reason');
      const options = await api('/api/types/creation-options');
      const selected = options.library.find(item => /结构演示/.test(item.name)) || options.library[0];
      expect(selected, '必须选择真实型号起点，不伪造候选').toBeTruthy();
      const version = selected.version.replace(/\+engineering$/, '（工程版）').replace(/\+[^\s]+$/, '（定制版）');
      await choose('型号版本', selected.name + ' · ' + version, typeCreate);
      await expect(submit).toBeEnabled();
      await capture('09-create-type-selected-version');
      const [response] = await Promise.all([
        page.waitForResponse(response => new URL(response.url()).pathname === '/api/types' && response.request().method() === 'POST'),
        submit.click(),
      ]);
      expect(response.ok()).toBe(true);
      const created = await response.json();
      await page.waitForURL(next => next.pathname === `/types/${created.id}/structure/section`);
      await expect(page.getByRole('navigation', {name:'型号浏览器',exact:true})).toBeVisible();
      const saved = await api(`/api/types/${created.id}/workspace`), pin = saved.type_origin_reference;
      check('从研究入口建立真实独立草稿并保留固定版本来源', saved.id !== wid && saved.domain.name === '研究转型号 · ' + tag
        && saved.type_creation?.kind === 'library' && saved.type_lifecycle?.status === 'draft'
        && pin?.id === selected.id && pin?.version === selected.version && pin?.content_sha256 === selected.content_sha256,
      {workspace:saved.id, source:pin, lifecycle:saved.type_lifecycle});
      const [typeIndex, workspaceIndex] = await Promise.all([api('/api/design/type-workspaces'), api('/api/workspaces')]);
      expect(typeIndex.some(item => item.id === saved.id), '新型号必须真实出现在宿主型号索引').toBe(true);
      const currentType = sidebar.locator('a.tree-object[aria-current="page"]').filter({ hasText: saved.domain.name });
      await expect(currentType).toHaveCount(1);
      await expect(currentType).toHaveAttribute('href', new RegExp(`/types/${saved.id}/structure/table(?:\\?|$)`));
      await expect(currentType).toBeInViewport({ ratio: 1 });
      if (typeIndex.length > 3) await expect(sidebar.getByRole('link', { name: `全部 ${typeIndex.length} 个型号设计`, exact: true })).toBeVisible();
      const typeIds = new Set(typeIndex.map(item => item.id));
      const projectIds = new Set(workspaceIndex.filter(item => !typeIds.has(item.id)).map(item => item.id));
      const objects = await visibleObjects();
      const typeLinks = objects.filter(item => item.path.startsWith('/types/'));
      check('创建后侧栏当前型号与总数刷新且工程分组不混入型号', objects.filter(item => item.path === '/studies').every(item => projectIds.has(item.workspace))
        && typeLinks.every(item => typeIds.has(item.path.split('/')[2]))
        && (typeIndex.length > 3 || typeLinks.length === typeIndex.length),
      { created: saved.id, typeCount: typeIndex.length, projectCount: projectIds.size, visibleObjects: objects });
    }
  });
  if (report.phase === 'after') await step('10-saved-sweep-canvas-draft-survives-maximize', async () => {
    const projects = await api('/api/workspaces');
    const studies = (await Promise.all(projects.map(project => api(`/api/workspaces/${project.id}/studies`)))).flat();
    const scan = studies.find(row => row.definition.driver?.kind === 'sweep'
      && row.definition.input_source === 'domain' && row.latest_run?.status === 'succeeded'
      && row.definition.method.plugin_id === 'cablesim.iec60287');
    expect(scan, '发布库必须有真实保存的扫描研究；本回归不新建结果或启动计算').toBeTruthy();
    const scanPrefix = `/api/workspaces/${scan.workspace}/studies/${scan.id}`;
    async function savedInputs() {
      const [workspace, study, runs, run] = await Promise.all([
        api(`/api/workspaces/${scan.workspace}`), api(scanPrefix),
        api(scanPrefix + '/runs?view=summary&limit=100'), api(scanPrefix + '/runs/' + scan.latest_run.id + '?view=full'),
      ]);
      return { workspace: { id: workspace.id, revision: workspace.revision, domain: workspace.domain },
        study: { id: study.id, revision: study.revision, definition: study.definition },
        runs: runs.items.map(item => ({ id: item.id, sequence: item.sequence, status: item.status })),
        run: { id: run.id, integrity: run.integrity, status: run.status, input_digest: run.input_digest,
          output_digest: run.output_digest, snapshot: run.snapshot, output: run.output } };
    }
    const baseline = await savedInputs(), writesStart = report.writes.length;
    expect(baseline.run.integrity).toBe('verified');
    expect(baseline.run.status).toBe('succeeded');
    expect(baseline.run.snapshot.definition.driver.kind).toBe('sweep');
    const source = { workspace: scan.workspace, workspaceRevision: baseline.workspace.revision,
      study: scan.id, studyRevision: baseline.study.revision, run: baseline.run.id,
      inputDigest: baseline.run.input_digest, outputDigest: baseline.run.output_digest };
    await page.goto(`${base}/studies/${scan.id}/sweep/curve?workspace=${scan.workspace}&theme=light&view=section&inspector=input`);
    const workbench = page.locator('.study-workbench[data-analysis="sweep"]');
    const canvas = workbench.locator('.workbench-canvas');
    await expect(page.locator('.study-sweep-results .series-chart')).toBeVisible();
    await expect(workbench).toHaveAttribute('data-dock', 'max');
    await expect(canvas).toHaveCount(0);
    check('保存扫描先显示真实曲线，未打开的隐藏画布尚未挂载', true, source);
    await capture('10-saved-sweep-before-opening-canvas');

    await page.getByRole('button', { name: '还原结果面板', exact: true }).click();
    await expect(canvas.locator('[data-drawing-canvas="laying"]')).toBeVisible();
    const cable = canvas.locator('[data-section-object^="cable/"]').first();
    await expect(cable).toBeVisible();
    const identity = await cable.getAttribute('data-section-object');
    const placement = baseline.workspace.domain.sections.flatMap(section => section.placements)
      .find(item => 'cable/' + item.cable === identity);
    expect(placement, '图中电缆必须来自保存工程的真实敷设').toBeTruthy();
    await cable.click();
    const xField = field('水平位置 x'), zField = field('高程 z');
    await expect(xField).toBeEditable();
    await expect(zField).toBeEditable();
    const coordinates = async () => ({ x: Number(await xField.inputValue()), z: Number(await zField.inputValue()) });
    const original = await coordinates();
    expect(original.x).toBeCloseTo(placement.x, 3);
    expect(original.z).toBeCloseTo(placement.z, 3);
    const edited = { ...original, x: Number((original.x + 0.025).toFixed(3)) };
    await fill('水平位置 x', String(edited.x));
    await expect.poll(coordinates).toEqual(edited);
    await expect(command().getByRole('button', { name: '保存修改', exact: true })).toBeEnabled();
    await capture('10-sweep-canvas-coordinate-edit-is-unsaved');

    const point = await cable.locator('.drawing-hit-area').boundingBox();
    expect(point).toBeTruthy();
    const x = point.x + point.width / 2, y = point.y + point.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + 20, y - 12, { steps: 8 }); await page.mouse.up();
    await expect.poll(coordinates).not.toEqual(edited);
    const dragged = await coordinates();
    await expect(cable).toHaveAttribute('aria-pressed', 'true');
    await capture('10-sweep-canvas-drag-is-unsaved');

    await page.getByRole('button', { name: '放大结果面板', exact: true }).click();
    await expect(workbench).toHaveAttribute('data-dock', 'max');
    await expect(canvas).toHaveCount(1);
    await expect(canvas).not.toBeVisible();
    await expect.poll(coordinates).toEqual(dragged);
    await capture('10-sweep-maximized-with-unsaved-coordinates');
    await page.getByRole('button', { name: '还原结果面板', exact: true }).click();
    await expect(canvas.locator('[data-drawing-canvas="laying"]')).toBeVisible();
    await expect(cable).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(coordinates).toEqual(dragged);
    await expect(command().getByRole('button', { name: '保存修改', exact: true })).toBeEnabled();
    check('扫描画布放大再还原后保留所选电缆、手填与拖动后的未保存坐标', true,
      { ...source, cable: identity, original, edited, dragged });
    check('扫描画布切换与未保存编辑不改工程、研究或保存运行', isDeepStrictEqual(await savedInputs(), baseline), source);
    await capture('10-sweep-restored-with-selection-and-draft');

    await clickCommand('撤销');
    await expect.poll(coordinates).toEqual(edited);
    await expect(command().getByRole('button', { name: '保存修改', exact: true })).toBeEnabled();
    await capture('10-sweep-undo-drag-keeps-coordinate-edit');
    await clickCommand('撤销');
    await expect.poll(coordinates).toEqual(original);
    await expect(command().getByRole('button', { name: '已保存', exact: true })).toBeVisible();
    await expect(cable).toHaveAttribute('aria-pressed', 'true');
    check('扫描画布可逐次撤销拖动和坐标编辑，恢复保存输入且保留选择', true,
      { cable: identity, original, edited, dragged, restored: await coordinates() });
    check('画布恢复回归全过程不写保存库，也不启动试算或新运行',
      isDeepStrictEqual(await savedInputs(), baseline) && report.writes.length === writesStart,
      { ...source, writes: report.writes.slice(writesStart) });
  });
});
