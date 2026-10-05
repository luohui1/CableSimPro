import { expect as baseExpect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { typeFixture, output } from './fixture.mjs';

const expect = baseExpect.configure({ timeout: 20000 });
const fixture = await typeFixture(), { page, context } = fixture;
const result = { workflows: [], layouts: [], screenshots: [], errors: fixture.errors, writes: fixture.writes };
async function settle() { await page.evaluate(() => document.fonts.ready); }
async function shot(name) { await settle(); const file = path.join(output, 'screenshots', name + '.png'); await page.screenshot({ path: file }); result.screenshots.push(file); }
async function layout(name) {
  const value = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
    minimumFont: Math.min(...[...document.querySelectorAll('button,label,input,td,th,p,h1,h2,h3,dt,dd,span,text')].filter(node => node.textContent.trim() && node.getBoundingClientRect().height > 0).map(node => parseFloat(getComputedStyle(node).fontSize))) }));
  expect(value.overflow).toBe(false); expect(value.minimumFont).toBeGreaterThanOrEqual(13); result.layouts.push({ name, ...value });
}
try {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(fixture.url + '/types'); await expect(page.locator('[data-type-page=list]')).toHaveAttribute('data-type-state', /success|historical|empty/);
  await shot('types-light-1366'); await layout('list');
  const models = await fixture.api('/api/design/cable-models');
  const model = models.find(model => model.payload?.cable_type?.construction === 'single_core' && model.payload.cable_type.cores[0].conductor.form === 'stranded_round_compacted' && model.name.includes('400'));
  if (!model) throw Error('正式宿主未提供可用单芯型号');
  await page.getByRole('button', { name: '新建型号', exact: true }).click();
  await page.getByRole('combobox', { name: '基准型号版本', exact: true }).click();
  await page.getByRole('option', { name: model.name.replace(/（[^）]*演示[^）]*）|\([^)]*演示[^)]*\)/g, '').trim() + ' · ' + model.version + ' · 系统型号', exact: true }).click();
  await page.getByRole('button', { name: '建立型号草稿', exact: true }).click();
  await expect(page.locator('[data-drawing-canvas=cable]')).toBeVisible();
  const wid = new URL(page.url()).pathname.split('/')[2], initial = await fixture.api('/api/workspaces/' + wid);
  expect(initial.study_cable_reference).toBeUndefined(); expect(initial.type_origin_reference.content_sha256).toBe(model.content_sha256);
  await page.getByRole('row', { name: /绝缘$/, exact: false }).first().click();
  const field = page.locator('.type-property-fields').getByRole('textbox', { name: '绝缘厚度', exact: true });
  await expect(field).toBeVisible(); const original = await field.inputValue();
  const row = initial.domain.cable_types[0].common_layers.find(layer => layer.role === 'insulation');
  if (!row) throw Error('验收型号未提供绝缘层');
  await field.fill('7.250'); await field.press('Enter');
  await page.getByRole('tab', { name: '分层表', exact: true }).click();
  await expect(page.locator('.type-property-fields').getByRole('textbox', { name: '绝缘厚度', exact: true })).toHaveValue('7.250');
  await page.keyboard.press('Control+s'); await expect(page.getByText('已保存型号草稿', { exact: true })).toBeVisible();
  const saved = await fixture.api('/api/workspaces/' + wid); expect(saved.revision).toBeGreaterThan(initial.revision); expect(saved.domain.cable_types[0].common_layers.find(layer => layer.role === 'insulation').thickness).toBe(.00725);
  const listPage = await context.newPage(); await listPage.goto(fixture.url + '/types'); await listPage.getByRole('table', { name: '型号', exact: true }).waitFor(); await listPage.evaluate(() => document.fonts.ready); await listPage.screenshot({ path: path.join(output, 'screenshots/types-success.png') }); await listPage.close();
  await page.getByRole('tab', { name: '截面', exact: true }).click();
  await shot('structure-light-1366'); await layout('structure');
  expect((await page.locator('body').innerText()).match(/演示/g)?.length).toBe(1);
  const dimensions = await page.locator('[data-cable-dimensions] text').evaluateAll(nodes => nodes.map(node => ({ text: node.textContent, box: node.getBoundingClientRect().toJSON() })));
  const rings = await page.locator('.drawing-ring').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().toJSON()));
  const bottom = Math.max(...rings.map(box => box.bottom)), outer = dimensions.find(dimension => dimension.text.startsWith('本层外径'));
  expect(outer.box.top).toBeGreaterThan(bottom); result.workflows.push({ name: '外置直径', ringBottom: bottom, labelTop: outer.box.top });
  for (const width of [1366, 1920]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: width === 1366 ? 768 : 1080 });
    await page.goto(`${fixture.url}/types/${wid}/structure/section?theme=${theme}`); await expect(page.locator('[data-drawing-canvas=cable]')).toBeVisible();
    await page.getByRole('row', { name: /绝缘$/, exact: false }).first().click(); await layout('structure-' + theme + '-' + width); await shot('structure-' + theme + '-' + width);
    await page.getByRole('tab', { name: '分层表', exact: true }).click(); await layout('layers-' + theme + '-' + width); await shot('layers-' + theme + '-' + width);
  }
  await page.getByRole('tab', { name: '三维剥切', exact: true }).click();
  await expect(page.locator('.cad-viewport')).toHaveAttribute('aria-busy', 'false', { timeout: 90000 });
  await expect(page.locator('.cad-viewport')).toHaveAttribute('data-cad-state', 'success');
  await expect(page.locator('.cad-canvas-host canvas')).toBeVisible();
  await page.getByRole('button', { name: '端面', exact: true }).click();
  await expect(page.locator('[data-cad-layer-dimensions]')).toBeVisible();
  await layout('three-dark-1920'); await shot('three-dark-1920'); result.workflows.push({ name: '真实CAD预览、原生画布与二维选层联动' });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.getByRole('tab', { name: '截面', exact: true }).click();
  const invalid = page.locator('.type-property-fields').getByRole('textbox', { name: '绝缘厚度', exact: true });
  await invalid.fill('-'); await page.getByRole('tab', { name: '分层表', exact: true }).click();
  await expect(page.locator('.type-property-fields').getByRole('textbox', { name: '绝缘厚度', exact: true })).toHaveValue('-');
  await page.keyboard.press('Control+s'); await expect(page.getByRole('alert').filter({ hasText: '有效数值' })).toBeVisible();
  expect((await fixture.api('/api/workspaces/' + wid)).revision).toBe(saved.revision);
  await page.locator('.type-property-fields').getByRole('textbox', { name: '绝缘厚度', exact: true }).press('Escape');
  await expect(page.locator('.type-property-fields').getByRole('textbox', { name: '绝缘厚度', exact: true })).toHaveValue('7.250');
  await page.locator('.type-property-fields').getByRole('textbox', { name: '绝缘厚度', exact: true }).fill('8.000');
  await page.locator('.type-property-fields').getByRole('textbox', { name: '绝缘厚度', exact: true }).press('Enter');
  await page.getByRole('button', { name: '撤销', exact: true }).focus(); await page.keyboard.press('Control+z');
  await expect(page.getByText('已撤销未保存修改', { exact: true })).toBeVisible();
  await page.keyboard.press('Control+z'); await expect(page.getByText('已恢复上一份型号输入', { exact: true })).toBeVisible();
  expect((await fixture.api('/api/workspaces/' + wid)).domain.cable_types[0].common_layers.find(layer => layer.role === 'insulation').thickness).toBe(row.thickness);
  result.workflows.push({ name: '新建、层联动、保存、跨页签非法草稿保留、Esc、已保存撤销', wid, original });
  const baseline = await fixture.api('/api/workspaces/' + wid);
  const editField = page.locator('.type-property-fields').getByRole('textbox', { name: '绝缘厚度', exact: true });
  await editField.fill('7.500'); await editField.press('Enter');
  const remote = structuredClone(baseline.domain); remote.name += ' · 同时修改';
  await fixture.api('/api/workspaces/' + wid + '/domain', 'PUT', { expected_revision: baseline.revision, document: remote });
  await page.keyboard.press('Control+s'); await expect(page.getByRole('alert').filter({ hasText: '版本已变化' })).toBeVisible();
  await expect(editField).toHaveValue('7.500'); expect((await fixture.api('/api/workspaces/' + wid)).domain.cable_types[0].common_layers.find(layer => layer.role === 'insulation').thickness).toBe(row.thickness);
  await shot('structure-conflict'); result.workflows.push({ name: '真实409冲突保留草稿并拒绝覆盖' });
  await page.getByRole('button', { name: '撤销', exact: true }).focus(); await page.keyboard.press('Control+z');
  await page.goto(`${fixture.url}/types/${wid}/structure/section?revision=${saved.revision}&theme=light`);
  await expect(page.locator('[data-type-page=structure]')).toHaveAttribute('data-type-state', 'historical');
  await page.getByRole('row', { name: /绝缘$/, exact: false }).first().click();
  await expect(page.locator('.type-property-fields').getByRole('textbox', { name: '绝缘厚度', exact: true })).toHaveValue('7.250');
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled(); await shot('structure-historical');
  result.workflows.push({ name: '真实历史档案输入只读，未用当前输入替代' });
  expect(await page.getByRole('combobox', { name: '组件状态' }).count()).toBe(0);
  for (const state of ['empty', 'loading', 'error']) {
    const mask = '**/api/workspaces/' + wid;
    await context.route(mask, async route => {
      if (state === 'loading') { await new Promise(resolve => setTimeout(resolve, 1800)); await route.continue(); }
      else if (state === 'error') await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: '测试读取失败' }) });
      else { const data = await (await route.fetch()).json(); data.domain.cable_types = []; data.domain.circuits = []; await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) }); }
    });
    await page.goto(`${fixture.url}/types/${wid}/structure/section?theme=light`);
    await expect(page.locator('[data-type-page=structure]')).toHaveAttribute('data-type-state', state); await shot('structure-' + state); await layout('structure-' + state); await context.unroute(mask);
  }
  for (const state of ['empty', 'loading', 'error']) {
    const mask = '**/api/design/type-workspaces';
    await context.route(mask, async route => state === 'loading' ? await new Promise(resolve => setTimeout(resolve, 1800)).then(() => route.continue()) : route.fulfill({ status: state === 'error' ? 503 : 200, contentType: 'application/json', body: state === 'error' ? JSON.stringify({ detail: '测试读取失败' }) : '[]' }));
    if (state === 'empty') await context.route('**/api/types/library', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' }));
    await page.goto(fixture.url + '/types'); await expect(page.locator('[data-type-page=list]')).toHaveAttribute('data-type-state', state); await shot('types-' + state); await layout('list-' + state);
    await context.unroute(mask); if (state === 'empty') await context.unroute('**/api/types/library');
  }
  expect(fixture.errors).toEqual([]);
} catch (error) { result.failure = String(error.stack || error); console.error(result.failure); if (await page.getByRole('button', { name: 'Show Error', exact: true }).isVisible().catch(() => false)) await page.getByRole('button', { name: 'Show Error', exact: true }).click(); console.error((await page.locator('body').innerText()).slice(0, 3000)); console.error(fixture.errors); await shot('structure-failure').catch(() => {}); process.exitCode = 1; }
finally { await fs.writeFile(path.join(output, 'structure-verification.json'), JSON.stringify(result, null, 2)); await fixture.close(); }
