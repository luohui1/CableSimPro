import { expect as baseExpect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { typeFixture, output, root } from './fixture.mjs';
import { checkLayout } from './ui-checks.mjs';

process.env.E2E_DATABASE_SOURCE ||= path.join(root, '.data/standard-check/validation.sqlite');
const expect = baseExpect.configure({ timeout: 25000 }), fixture = await typeFixture(), { page, context } = fixture;
const result = { workflows: [], layouts: [], screenshots: [], errors: fixture.errors };
async function shot(name) { if (!name.endsWith('-light-1366') && !name.endsWith('-parameters') && !name.includes('failure')) return; await page.evaluate(() => document.fonts.ready); const file = path.join(output, 'screenshots', name + '.png'); await page.screenshot({ path: file }); result.screenshots.push(file); }
async function layout() { result.layouts.push(await checkLayout(page)); }
try {
  const types = await fixture.api('/api/design/type-workspaces'), selected = {};
  for (const type of types) {
    const studies = await fixture.api(`/api/workspaces/${type.id}/studies`);
    for (const study of studies) {
      const capability = study.definition.method.capability;
      if (!['electrical', 'short-circuit'].includes(capability) || selected[capability]) continue;
      const runs = (await fixture.api(`/api/workspaces/${type.id}/studies/${study.id}/runs`)).items;
      if (runs.some(run => run.integrity === 'verified' && run.output?.cases.some(item => item.artifacts?.['x-cablesim.type-' + capability]))) selected[capability] = type.id;
    }
    if (selected.electrical && selected['short-circuit']) break;
  }
  const models = await fixture.api('/api/design/cable-models'), model = models.find(model => model.id === 'system.cu-xlpe-al-compacted-400');
  const empty = await fixture.api('/api/design/type-workspaces', 'POST', { model_id: model.id, content_sha256: model.content_sha256 });
  for (const module of ['electrical', 'short-circuit']) {
    const wid = selected[module], name = module === 'electrical' ? '电气参数' : '短路容量'; if (!wid) throw Error('真实验收源没有' + name + '运行');
    await page.setViewportSize({ width: 1366, height: 768 }); await page.goto(`${fixture.url}/types/${empty.id}/${module}/results`);
    await expect(page.locator(`[data-type-page=${module}-results]`)).toHaveAttribute('data-type-state', 'empty'); await shot(module + '-empty');
    await page.goto(`${fixture.url}/types/${wid}/${module}/results`);
    await expect(page.getByRole('table', { name, exact: true })).toBeVisible(); await shot(module + '-saved-history');
    await page.getByRole('button', { name: '按保存条件重算' + name, exact: true }).focus(); await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: '按保存条件重算' + name + ' · 预检', exact: true })).toBeVisible();
    await page.getByRole('checkbox', { name: '已核对输入来源与方法适用范围', exact: true }).check();
    await page.getByRole('button', { name: '确认并运行', exact: true }).click();
    await expect(page.locator(`[data-type-page=${module}-results]`)).toHaveAttribute('data-type-state', 'success', { timeout: 60000 });
    const studies = (await fixture.api(`/api/workspaces/${wid}/studies`)).filter(study => study.definition.method.capability === module), runs = [];
    for (const study of studies) runs.push(...(await fixture.api(`/api/workspaces/${wid}/studies/${study.id}/runs`)).items);
    const run = runs.filter(run => run.freshness === 'current' && run.integrity === 'verified').sort((a, b) => b.created.localeCompare(a.created))[0]; if (!run) throw Error('重算没有当前完整性通过的运行');
    const artifact = run.output.cases.find(item => item.status === 'succeeded').artifacts['x-cablesim.type-' + module], row = artifact.rows.find(row => row.status === 'available'); if (!row) throw Error('真实重算没有可用的结果行');
    await page.getByRole('row', { name: row.title, exact: true }).focus(); await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: row.title, exact: true })).toBeVisible();
    await expect(page.locator('.property-row').filter({ has: page.getByText('原始 SI 数值', { exact: true }) }).locator('dd')).toContainText(String(row.value));
    expect(await page.getByText(row.clause, { exact: true }).count()).toBeGreaterThan(0);
    expect(artifact.rows.length).toBe(await page.getByRole('table', { name, exact: true }).locator('tbody tr').count());
    result.workflows.push({ name: '真实保存条件、精确发行预检、插件运行、原始数值与条款', module, wid, run: run.id, rows: artifact.rows.length, method: run.snapshot.definition.method });
    if (module === 'short-circuit') {
      expect(artifact.curve.schema).toBe('cablesim.short-circuit-curve/1');
      await expect(page.getByRole('img', { name: '短路电流随持续时间变化；横轴对数时间，纵轴 kA', exact: true })).toBeVisible();
      const control = page.getByRole('combobox', { name: '采样时间', exact: true }); await control.click(); await page.keyboard.press('End'); await page.keyboard.press('Enter');
      const index = artifact.curve.times_s.length - 1, series = artifact.curve.series.find(series => series.values_a[index] !== null);
      expect(await page.locator('.type-curve-readout').innerText()).toContain(String(series.values_a[index] * .001));
      result.workflows.push({ name: '曲线完全来自已保存工件、键盘采样与完整精度', points: artifact.curve.times_s.length });
    }
    for (const width of [1366, 1920]) for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: width === 1366 ? 768 : 1080 }); await page.goto(`${fixture.url}/types/${wid}/${module}/results?theme=${theme}`);
      await expect(page.getByRole('table', { name, exact: true })).toBeVisible(); await page.getByRole('row', { name: row.title, exact: true }).click(); await layout(); await shot(module + '-' + theme + '-' + width);
    }
    await page.goto(`${fixture.url}/types/${wid}/${module}/parameters`);
    await expect(page.locator('.parameter-form')).toBeVisible({ timeout: 60000 });
    const label = module === 'electrical' ? '频率' : '持续时间', parameter = page.getByRole('textbox', { name: label, exact: true });
    await expect(parameter).toBeVisible(); const original = await parameter.inputValue();
    await parameter.fill('-'); await page.keyboard.press('Control+s'); await expect(page.locator('[role=alert]')).toBeVisible(); await expect(parameter).toHaveValue('-');
    await page.getByRole('button', { name: '标准核对', exact: true }).click(); await page.getByRole('button', { name, exact: true }).click(); await page.getByRole('tab', { name: '方法参数', exact: true }).click(); await expect(parameter).toHaveValue('-');
    await parameter.press('Escape'); await expect(parameter).toHaveValue(original);
    const edited = module === 'electrical' ? '50.125' : '1.125', unit=module==='electrical'?'Hz':'s'; await parameter.fill(edited); await page.locator('.type-result-toolbar').first().click(); await page.getByRole('button', { name: '标准核对', exact: true }).click(); await page.getByRole('button', { name, exact: true }).click(); await page.getByRole('tab', { name: '方法参数', exact: true }).click(); await expect(parameter).toHaveAttribute('title',edited+' '+unit); await page.keyboard.press('Control+s'); await expect(page.getByText('已保存型号与方法条件', { exact: true })).toBeVisible();
    const changedStudy = (await fixture.api(`/api/workspaces/${wid}/studies`)).filter(item => item.definition.method.capability === module).sort((a,b) => b.created.localeCompare(a.created))[0];
    expect(changedStudy.definition.parameters[module === 'electrical' ? 'frequency_hz' : 'duration_s']).toBe(Number(edited)); expect(changedStudy.definition.method.version).toBe('0.3.0');
    await parameter.fill('1.25'); await page.locator('.type-result-toolbar').first().click(); await page.keyboard.press('Control+z'); await expect(page.getByText('已撤销未保存方法条件',{exact:true})).toBeVisible(); await expect(parameter).toHaveAttribute('title',edited+' '+unit);
    for(const width of [1366,1920])for(const theme of ['light','dark']){await page.setViewportSize({width,height:width===1366?768:1080});await page.goto(`${fixture.url}/types/${wid}/${module}/parameters?theme=${theme}`);await expect(page.locator('.parameter-form')).toBeVisible();await layout();if(width===1366&&theme==='light')await shot(module+'-parameters');}
    result.workflows.push({ name: '正式契约编辑、无效CtrlS保留、跨模块文本、Esc恢复、CtrlZ方法撤销与真实保存', module, parameter: edited });
    await page.goto(`${fixture.url}/types/${wid}/structure/table`); await expect(page.locator('#type-name')).toBeVisible(); const originalName = await page.locator('#type-name').inputValue(); await page.locator('#type-name').fill(originalName + ' · 隔离结构修改'); await page.keyboard.press('Control+s'); await expect(page.getByText('已保存型号草稿', { exact: true })).toBeVisible();
    await page.goto(`${fixture.url}/types/${wid}/${module}/results`); await expect(page.locator(`[data-type-page=${module}-results]`)).toHaveAttribute('data-type-state', 'historical'); await shot(module + '-historical');
    await page.goto(`${fixture.url}/types/${wid}/${module}/results?run=${run.id}`); await expect(page.getByRole('button', { name: '按保存条件重算' + name, exact: true })).toBeDisabled(); await expect(page.getByText('历史运行快照 · 只读', { exact: true })).toBeVisible();
    for (const kind of ['loading', 'error']) {
      const pattern = `**/api/workspaces/${wid}/studies`;
      await context.route(pattern, async route => { if (kind === 'loading') { await new Promise(resolve => setTimeout(resolve, 2000)); await route.continue(); } else await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: '验证研究读取失败' }) }); });
      await page.goto(`${fixture.url}/types/${wid}/${module}/results`); await expect(page.locator(`[data-type-page=${module}-results]`)).toHaveAttribute('data-type-state', kind); await layout(); await shot(module + '-' + kind); await context.unroute(pattern);
    }
  }
  expect(fixture.errors).toEqual([]);
} catch (error) { result.failure = String(error.stack || error); result.failureUrl = page.url(); result.backendLog = fixture.log(); console.error(result.failure); console.error(page.url()); console.error((await page.locator('body').innerText()).slice(0, 2400)); console.error(fixture.log().slice(-2500)); await shot('analysis-failure').catch(() => {}); process.exitCode = 1; }
finally { await fs.writeFile(path.join(output, 'analysis-verification.json'), JSON.stringify(result, null, 2)); await fixture.close(); }
