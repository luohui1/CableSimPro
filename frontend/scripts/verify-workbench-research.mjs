import fs from 'node:fs/promises';
import path from 'node:path';
import { walkthrough } from './verify-workbench-support.mjs';

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
  });
  const url = new URL(page.url());
  const sid = url.pathname.split('/')[2], wid = url.searchParams.get('workspace');
  expect(wid).toBeTruthy();
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
    check('草稿显示改了几项', /改了\s*\d+\s*项|\d+\s*项修改/.test(await command().innerText()));
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
    await expect(page.locator('.conclusion')).toBeVisible();
    await expect(page.locator('.conclusion')).toContainText(/允许|载流量/);
    await expect(page.locator('.conclusion')).toContainText(/最热|温限/);
  });
  await independent('05-temperature-and-loss-details', async () => {
    for (const [label, shot] of [['温度与电流', '05-layer-temperatures'], ['损耗', '05-losses']]) {
      const detail = page.locator('details.study-detail-group').filter({ has: page.locator('summary', { hasText: label }) });
      check('结果可展开' + label, await detail.count() > 0);
      if (await detail.count()) {
        if (await detail.getAttribute('open') === null) await detail.locator('summary').click();
        await expect(detail.getByRole('table')).toBeVisible();
        await capture(shot);
        await detail.locator('summary').click();
      }
    }
  });
  await step('06-change-one-condition-and-rerun', async () => {
    await fill('介质热阻率', '1.1');
    await page.keyboard.press('Control+s');
    await expect(command().getByRole('button', { name: '已保存', exact: true })).toBeVisible();
    await expect(page.locator('.study-history-line')).toBeVisible();
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
    await expect(choices).toHaveCount(2);
    await choices.nth(0).check(); await choices.nth(1).check();
    await page.getByRole('button', { name: '比较所选运行', exact: true }).click();
    await page.getByRole('tab', { name: '输入差异', exact: true }).click();
    const difference = page.getByRole('table', { name: '对比输入差异', exact: true });
    await expect(difference).toBeVisible();
    check('对比指出改动的具体条件及前后值', /热阻率/.test(await difference.innerText()), await difference.innerText());
    await capture('07-input-differences');
    await page.getByRole('tab', { name: '结果', exact: true }).click();
    await expect(page.getByRole('table', { name: '方法结果差异', exact: true })).toBeVisible();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出对比 CSV', exact: true }).click();
    const file = await pending;
    await file.saveAs(path.join(out, 'comparison-' + tag + '.csv'));
    expect(await fs.readFile(path.join(out, 'comparison-' + tag + '.csv'), 'utf8')).toMatch(/单位/);
  });
  await independent('08-calculation-book-download', async () => {
    await page.goto(resultUrl);
    await clickCommand('生成计算书');
    await expect(page.getByRole('button', { name: '下载 PDF', exact: true })).toBeEnabled({ timeout: 90000 });
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载 PDF', exact: true }).click();
    const file = await pending, target = path.join(out, 'calculation-book-' + tag + '.pdf');
    await file.saveAs(target);
    expect((await fs.readFile(target)).subarray(0, 5).toString()).toBe('%PDF-');
    const deliveryId = new URL(page.url()).searchParams.get('delivery');
    expect(deliveryId).toBeTruthy();
    const delivery = await api(`/api/workspaces/${wid}/deliveries/${deliveryId}`);
    check('计算书引用本次保存运行', JSON.stringify(delivery).includes(second.id), { run: second.id, delivery: deliveryId });
  });
});
