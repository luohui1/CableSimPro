import { expect as baseExpect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { typeFixture, output } from './fixture.mjs';

const expect = baseExpect.configure({ timeout: 25000 }), fixture = await typeFixture(), { page, context } = fixture;
const result = { workflows: [], layouts: [], screenshots: [], errors: fixture.errors };
async function shot(name) { await page.evaluate(() => document.fonts.ready); const file = path.join(output, 'screenshots', name + '.png'); await page.screenshot({ path: file }); result.screenshots.push(file); }
async function layout() { const value = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight, minimumFont: Math.min(...[...document.querySelectorAll('button,label,input,td,th,p,h1,h2,h3,dt,dd,span')].filter(node => node.textContent.trim() && node.getBoundingClientRect().height > 0).map(node => parseFloat(getComputedStyle(node).fontSize))) })); expect(value.overflow).toBe(false); expect(value.minimumFont).toBeGreaterThanOrEqual(13); result.layouts.push(value); }
try {
  const catalog = await fixture.api('/api/design/cable-models'), model = catalog.find(model => model.id === 'system.cu-xlpe-al-compacted-400');
  if (!model) throw Error('正式宿主未提供紧压圆形验收型号');
  const created = await fixture.api('/api/design/type-workspaces', 'POST', { model_id: model.id, content_sha256: model.content_sha256 }), wid = created.id;
  await page.setViewportSize({ width: 1366, height: 768 }); await page.goto(`${fixture.url}/types/${wid}/standard-check/results`);
  await expect(page.locator('[data-type-page=standard-check-results]')).toHaveAttribute('data-type-state', 'empty'); await shot('standard-check-empty');
  await page.getByRole('button', { name: '执行标准核对', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: '执行标准核对 · 预检' })).toBeVisible();
  await page.getByRole('checkbox', { name: '已核对输入来源与方法适用范围', exact: true }).check();
  await page.getByRole('button', { name: '确认并运行', exact: true }).click();
  await expect(page.locator('[data-type-page=standard-check-results]')).toHaveAttribute('data-type-state', 'success', { timeout: 60000 });
  const studies = await fixture.api(`/api/workspaces/${wid}/studies`), study = studies.find(study => study.definition.method.capability === 'dimensions');
  const runs = (await fixture.api(`/api/workspaces/${wid}/studies/${study.id}/runs`)).items, run = runs.find(run => run.status === 'succeeded');
  const artifact = run.output.cases.find(item => item.status === 'succeeded').artifacts['x-cablesim.standard-check'];
  expect(run.integrity).toBe('verified'); expect(run.freshness).toBe('current');
  const row = artifact.rows.find(row => row.target.role === 'insulation') || artifact.rows[0];
  await page.getByRole('row', { name: row.title, exact: true }).click();
  await expect(page.getByRole('heading', { name: row.title, exact: true })).toBeVisible();
  expect(await page.getByText(row.clause, { exact: true }).count()).toBeGreaterThan(0);
  result.workflows.push({ name: '真实标准插件、精确发行、冻结运行、条款与属性联动', wid, study: study.id, run: run.id, counts: artifact.counts });
  for (const width of [1366, 1920]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: width === 1366 ? 768 : 1080 }); await page.goto(`${fixture.url}/types/${wid}/standard-check/results?theme=${theme}`);
    await expect(page.getByRole('table', { name: '标准核对', exact: true })).toBeVisible(); await page.getByRole('row', { name: row.title, exact: true }).click(); await layout(); await shot('standard-check-' + theme + '-' + width);
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.getByRole('button', { name: '要求与批准记录', exact: true }).click();
  await expect(page.getByRole('table', { name: '要求批准', exact: true })).toBeVisible();
  const ledger = await fixture.api(`/api/design/type-workspaces/${wid}/requirements?run_id=${run.id}`);
  expect(ledger.items.length).toBe(artifact.rows.length);
  const bound = ledger.items.find(item => item.bindable); if (!bound) throw Error('真实要求目录没有可核对的定义');
  const checkbox = page.getByRole('checkbox', { name: '选择' + bound.definition.title, exact: true }); await checkbox.check();
  await expect(page.getByRole('button', { name: '批准所选要求', exact: true })).toBeDisabled();
  // Test only the explicit human UI gate; no agent issues a real human approval.
  await page.getByRole('textbox', { name: '审批人', exact: true }).fill('隔离界面验收');
  await page.getByRole('checkbox', { name: '本人已核对所选要求的来源和判定绑定', exact: true }).check();
  await expect(page.getByRole('button', { name: '批准所选要求', exact: true })).toBeEnabled();
  const requests = [];
  await context.route('**/requirements/reviews', async route => { requests.push(route.request().postDataJSON()); await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ detail: '隔离验收拒绝代替人工批准' }) }); });
  await page.getByRole('button', { name: '批准所选要求', exact: true }).click(); await expect(page.getByRole('alert').filter({ hasText: '拒绝代替人工批准' })).toBeVisible();
  expect(requests).toHaveLength(1); expect(requests[0].human_confirmed).toBe(true); expect(requests[0].row_ids).toEqual([bound.row_id]);
  await context.unroute('**/requirements/reviews'); await page.keyboard.press('Escape');
  expect((await fixture.api(`/api/design/type-workspaces/${wid}/requirements?run_id=${run.id}`)).approved_count).toBe(0);
  result.workflows.push({ name: '人工门禁、准确要求身份、403保留选择；无实际批准写入' });
  await page.getByRole('button', { name: '定位结构层', exact: true }).click();
  await expect(page.getByRole('tab', { name: '分层表', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.locator('.type-property-fields').getByRole('textbox', { name: '绝缘厚度', exact: true }).fill('7.000'); await page.keyboard.press('Control+s'); await expect(page.getByText('已保存型号草稿', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '标准核对', exact: true }).click();
  await expect(page.locator('[data-type-page=standard-check-results]')).toHaveAttribute('data-type-state', 'historical'); await shot('standard-check-historical');
  await page.goto(`${fixture.url}/types/${wid}/standard-check/results?run=${run.id}&theme=light`);
  await expect(page.getByRole('button', { name: '执行标准核对', exact: true })).toBeDisabled();
  await expect(page.getByText('历史运行快照 · 只读', { exact: true })).toBeVisible(); result.workflows.push({ name: '结构变化立即标历史、固定运行输入只读' });
  for (const kind of ['loading', 'error']) {
    const pattern = `**/api/workspaces/${wid}/studies`;
    await context.route(pattern, async route => { if (kind === 'loading') { await new Promise(resolve => setTimeout(resolve, 1800)); await route.continue(); } else await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: '验证研究读取失败' }) }); });
    await page.goto(`${fixture.url}/types/${wid}/standard-check/results`); await expect(page.locator('[data-type-page=standard-check-results]')).toHaveAttribute('data-type-state', kind); await shot('standard-check-' + kind); await layout(); await context.unroute(pattern);
  }
  expect(fixture.errors).toEqual([]);
} catch (error) { result.failure = String(error.stack || error); result.failureUrl = page.url(); console.error(result.failure); console.error(page.url()); console.error((await page.locator('body').innerText()).slice(0, 2400)); await shot('standard-check-failure').catch(() => {}); process.exitCode = 1; }
finally { await fs.writeFile(path.join(output, 'standard-verification.json'), JSON.stringify(result, null, 2)); await fixture.close(); }
