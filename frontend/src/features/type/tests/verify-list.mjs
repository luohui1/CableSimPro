import { expect as baseExpect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { typeFixture, output } from './fixture.mjs';

const expect = baseExpect.configure({ timeout: 20000 }), fixture = await typeFixture(), { page, context } = fixture;
const result = { workflows: [], states: [], layouts: [], screenshots: [], errors: fixture.errors };
async function shot(name) { await page.evaluate(() => document.fonts.ready); const file = path.join(output, 'screenshots', name + '.png'); await page.screenshot({ path: file }); result.screenshots.push(file); }
async function layout() { const value = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight, minimumFont: Math.min(...[...document.querySelectorAll('button,label,input,td,th,p,h1,h2,h3,dt,dd,span')].filter(node => node.textContent.trim() && node.getBoundingClientRect().height > 0).map(node => parseFloat(getComputedStyle(node).fontSize))) })); expect(value.overflow).toBe(false); expect(value.minimumFont).toBeGreaterThanOrEqual(13); result.layouts.push(value); }
try {
  const models = await fixture.api('/api/design/cable-models'), model = models.find(model => model.id === 'system.cu-xlpe-al-compacted-400');
  const created = await fixture.api('/api/design/type-workspaces', 'POST', { model_id: model.id, content_sha256: model.content_sha256 });
  for (const width of [1366, 1920]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: width === 1366 ? 768 : 1080 }); await page.goto(`${fixture.url}/types?theme=${theme}`);
    await expect(page.locator('[data-type-page=list]')).toHaveAttribute('data-type-state', 'success'); await expect(page.getByRole('table', { name: '型号', exact: true })).toBeVisible(); await layout(); result.states.push('success');
    await page.getByRole('button', { name: '新建型号', exact: true }).click(); await expect(page.getByRole('dialog', { name: '新建型号草稿', exact: true })).toBeVisible(); await layout(); await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await page.getByRole('searchbox', { name: '查找型号', exact: true }).fill('没有匹配的型号检索'); await expect(page.getByText('没有匹配的型号设计', { exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: '查找型号', exact: true }).fill(''); await page.getByRole('table', { name: '型号', exact: true }).locator('.object-link').first().focus(); await page.keyboard.press('Enter'); await expect(page.locator('[data-drawing-canvas=cable]')).toBeVisible();
  expect(new URL(page.url()).pathname).toContain('/types/' + created.id + '/structure'); result.workflows.push('真实型号、检索、键盘进入、两主题两尺寸、新建对话框与Esc');
  const released = await fixture.api('/api/types/library'); result.historicalSourceAvailable = released.items.length > 0;
  if (!result.historicalSourceAvailable) result.unverified = ['源数据库没有已发布型号；历史列表态未用伪造发布数据补验'];
  expect(fixture.errors).toEqual([]);
} catch (error) { result.failure = String(error.stack || error); console.error(result.failure); console.error((await page.locator('body').innerText()).slice(0, 1600)); await shot('list-failure').catch(() => {}); process.exitCode = 1; }
finally { result.states = [...new Set(result.states)]; await fs.writeFile(path.join(output, 'list-verification.json'), JSON.stringify(result, null, 2)); await fixture.close(); }
