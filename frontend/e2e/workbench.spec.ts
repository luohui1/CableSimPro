import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const runtimeErrors = new WeakMap<Page, string[]>();
const number = (text: string | null) => Number((text ?? '').replaceAll(',', ''));

async function recalculate(page: Page) {
  await page.getByRole('button', {name: '执行计算', exact: true}).click();
  await expect(page.getByTestId('result-status')).toContainText('已计算');
}

test.beforeEach(async ({page}) => {
  runtimeErrors.set(page, []);
  page.on('pageerror', error => runtimeErrors.get(page)?.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await expect(page.getByTestId('ampacity')).not.toHaveText('—');
});

test.afterEach(async ({page}) => {
  expect(runtimeErrors.get(page) ?? [], 'Uncaught browser exceptions').toEqual([]);
});

test('real calculation, rendered model and responsive layout', async ({page, request}, info) => {
  const presets = await (await request.get('/api/presets')).json();
  const scenario = presets.find((p: {id: string}) => p.id === 'copper-240').scenario;
  const reference = await (await request.post('/api/calculate', {data: scenario})).json();
  const shown = number(await page.getByTestId('ampacity').textContent());
  expect(Math.abs(shown - reference.summary.ampacity_a)).toBeLessThan(0.051);
  await expect(page.locator('.scene')).toHaveAttribute('data-webgl', /ready|unavailable/);
  if (info.project.name === 'chromium') {
    await expect(page.locator('.scene')).toHaveAttribute('data-webgl', 'ready');
    await expect(page.getByLabel('三维电缆模型')).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
  await page.screenshot({path: info.outputPath('workbench.png'), fullPage: true, animations: 'disabled'});
});

test('geometry edit invalidates old results and recalculation changes ampacity', async ({page}) => {
  const original = number(await page.getByTestId('ampacity').textContent());
  await page.getByLabel('导体截面积', {exact: true}).fill('400');
  await expect(page.getByTestId('ampacity')).toHaveText('—');
  await expect(page.getByTestId('result-status')).toContainText('重新计算');
  await expect(page.getByRole('button', {name: '导出计算书', exact: true})).toBeDisabled();
  await page.getByRole('button', {name: '二维截面', exact: true}).click();
  await expect(page.getByRole('img', {name: '电缆二维截面'})).toBeVisible();
  await recalculate(page);
  expect(number(await page.getByTestId('ampacity').textContent())).toBeGreaterThan(original);
  // Empty numeric fields must not silently reuse their last valid value.
  await page.getByLabel('导体截面积', {exact: true}).fill('');
  await page.getByRole('button', {name: '敷设', exact: true}).click();
  await page.getByRole('button', {name: '执行计算', exact: true}).click();
  await expect(page.getByRole('alert')).toContainText('area_mm2');
  await expect(page.getByTestId('ampacity')).toHaveText('—');
});

test('overlapping cable geometry is rejected rather than clamped', async ({page}) => {
  await page.getByRole('button', {name: '敷设', exact: true}).click();
  await page.getByLabel('相邻中心间距', {exact: true}).fill('0.02');
  await page.getByRole('button', {name: '执行计算', exact: true}).click();
  await expect(page.getByRole('alert')).toContainText('重叠');
  await expect(page.getByTestId('ampacity')).toHaveText('—');
});

test('zero current and unstable thermal feedback have honest output states', async ({page}) => {
  await page.getByRole('button', {name: '运行', exact: true}).click();
  await page.getByLabel('运行电流', {exact: true}).fill('0');
  await recalculate(page);
  expect(number(await page.getByTestId('temperature').textContent())).toBeGreaterThanOrEqual(25);
  expect(number(await page.getByTestId('temperature').textContent())).toBeLessThan(26);
  await page.getByLabel('运行电流', {exact: true}).fill('3000');
  await recalculate(page);
  await expect(page.getByRole('alert')).toContainText('无稳定解');
  await expect(page.getByTestId('temperature')).toHaveText('—');
  expect(number(await page.getByTestId('ampacity').textContent())).toBeGreaterThan(0);
  await expect(page.getByRole('button', {name: '导出运行 CSV'})).toBeDisabled();
});

test('project persists across reload, exports real files, and can be deleted', async ({page}, info) => {
  const name = `E2E-${info.project.name}-${Date.now()}`;
  await page.getByLabel('工程名称', {exact: true}).fill(name);
  await page.getByLabel('导体截面积', {exact: true}).fill('300');
  await page.getByRole('button', {name: '保存工程', exact: true}).click();
  await expect(page.getByRole('status')).toContainText('工程已保存');
  await page.reload();
  await expect(page.getByTestId('ampacity')).not.toHaveText('—');
  await page.getByRole('button', {name: /工程库/}).click();
  const row = page.getByRole('dialog').locator('.project-item').filter({hasText: name});
  await row.getByRole('button', {name: '打开', exact: true}).click();
  await expect(page.getByLabel('工程名称', {exact: true})).toHaveValue(name);
  await expect(page.getByLabel('导体截面积', {exact: true})).toHaveValue('300');
  await expect(page.getByTestId('ampacity')).toHaveText('—');
  await recalculate(page);
  const projectDownload = page.waitForEvent('download');
  await page.getByRole('button', {name: '导出工程', exact: true}).click();
  const project = await projectDownload;
  const payload = JSON.parse(await readFile((await project.path())!, 'utf8'));
  expect(payload.name).toBe(name);
  expect(payload.schema_version).toBe(1);
  expect(payload.cable.area_mm2).toBe(300);
  const reportDownload = page.waitForEvent('download');
  await page.getByRole('button', {name: '导出计算书', exact: true}).click();
  const report = await reportDownload;
  const html = await readFile((await report.path())!, 'utf8');
  expect(html).toContain(name);
  expect(html).toContain('SHA-256');
  expect(html).toContain('未通过正式标准算例');
  const csvDownload = page.waitForEvent('download');
  await page.getByRole('button', {name: '导出运行 CSV', exact: true}).click();
  const csv = await csvDownload;
  expect(await readFile((await csv.path())!, 'utf8')).toContain('input_sha256');
  await page.getByRole('button', {name: /工程库/}).click();
  await page.getByRole('button', {name: `删除工程 ${name}`, exact: true}).click();
  await expect(page.getByRole('dialog').locator('.project-item').filter({hasText: name})).toHaveCount(0);
});

test('import validates schema before replacing the active project', async ({page, request}) => {
  const initialName = await page.getByLabel('工程名称', {exact: true}).inputValue();
  await page.getByLabel('导入工程文件', {exact: true}).setInputFiles({
    name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"schema_version":999}'),
  });
  await expect(page.getByRole('alert')).toContainText('schema_version');
  await expect(page.getByLabel('工程名称', {exact: true})).toHaveValue(initialName);
  const presets = await (await request.get('/api/presets')).json();
  const scenario = {...presets[0].scenario, name: '导入校验示例'};
  await page.getByLabel('导入工程文件', {exact: true}).setInputFiles({
    name: 'valid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(scenario)),
  });
  await expect(page.getByLabel('工程名称', {exact: true})).toHaveValue('导入校验示例');
  await expect(page.getByTestId('ampacity')).toHaveText('—');
  await recalculate(page);
});

test('independent scenario snapshots and parameter scan', async ({page}, info) => {
  await page.getByRole('button', {name: '加入方案对比', exact: true}).click();
  await page.getByLabel('导体截面积', {exact: true}).fill('400');
  await recalculate(page);
  await page.getByRole('button', {name: '加入方案对比', exact: true}).click();
  await page.getByRole('button', {name: '方案对比', exact: true}).click();
  await expect(page.getByText(/快照 2 ·/)).toBeVisible();
  await page.getByRole('button', {name: '移除快照 1', exact: true}).click();
  await expect(page.getByText(/快照 2 ·/)).toHaveCount(0);
  await page.getByRole('button', {name: '建模工作台', exact: true}).click();
  await page.getByRole('button', {name: '运行扫描', exact: true}).click();
  await expect(page.getByRole('img', {name: '敏感性分析曲线'})).toBeVisible();
  await page.getByRole('img', {name: '敏感性分析曲线'}).screenshot({path: info.outputPath('sensitivity.png')});
  await page.getByLabel('导体截面积', {exact: true}).fill('240');
  await expect(page.getByRole('img', {name: '敏感性分析曲线'})).toHaveCount(0);
});

test('view controls, trefoil installation and calculation ledger', async ({page}, info) => {
  await page.getByRole('button', {name: '分层展开', exact: true}).click();
  await expect(page.getByRole('button', {name: '分层展开', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', {name: '重置视角', exact: true}).click();
  await page.getByRole('button', {name: '敷设', exact: true}).click();
  await page.getByLabel('三相排列方式', {exact: true}).selectOption('trefoil');
  await recalculate(page);
  await page.getByRole('button', {name: '敷设截面', exact: true}).click();
  await expect(page.getByRole('img', {name: '直埋敷设截面'})).toBeVisible();
  await page.getByRole('button', {name: '土壤温度', exact: true}).click();
  await expect(page.getByLabel('土壤解析温度分布', {exact: true})).toBeVisible();
  await page.locator('.model-card').screenshot({path: info.outputPath('soil-field.png')});
  await page.getByRole('button', {name: '计算明细', exact: true}).click();
  await expect(page.getByText('输入 SHA-256', {exact: true})).toBeVisible();
  await page.getByRole('button', {name: '极限载流', exact: true}).click();
  await expect(page.getByText(/平衡残差/)).toBeVisible();
  await page.getByRole('button', {name: '方法与边界', exact: true}).click();
  await expect(page.getByRole('heading', {name: '验证等级', exact: true})).toBeVisible();
});
