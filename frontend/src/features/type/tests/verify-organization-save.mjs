import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';
import { typeFixture, root } from './fixture.mjs';

// Real save requests use a disposable database. No solver or shared demo writes.
const fixture = await typeFixture({ main: true, build: path.join(root, 'frontend/dist') }), { page } = fixture;
const result = { checks: [], errors: fixture.errors };
try {
  const models = await fixture.api('/api/design/cable-models'), model = models.find(item => item.payload?.cable_type?.construction === 'single_core');
  assert.ok(model);
  await page.goto(fixture.url + '/types?theme=light');
  await page.getByRole('button', { name: '新建型号', exact: true }).click();
  await page.getByRole('combobox', { name: '基准型号版本', exact: true }).click();
  await page.getByRole('option').filter({ hasText: model.name.replace(/（[^）]*演示[^）]*）|\([^)]*演示[^)]*\)/g, '').trim() }).click();
  await page.getByRole('button', { name: '建立型号草稿', exact: true }).click();
  await expect(page.locator('[data-type-card]')).toBeVisible({ timeout: 20000 });
  const wid = new URL(page.url()).pathname.split('/')[2], initial = await fixture.api('/api/workspaces/' + wid);
  const input = page.locator('.type-name-input');
  await input.fill(initial.domain.name + ' · 目录保存验收'); await input.press('Control+s');
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  const saved = await fixture.api('/api/workspaces/' + wid);
  assert.equal(saved.domain.name, initial.domain.name + ' · 目录保存验收'); assert.equal(saved.revision, initial.revision + 1);
  const saveRequests = () => fixture.writes.filter(request => request.method === 'PUT' && request.url.endsWith('/domain'));
  assert.equal(saveRequests().length, 1);
  await input.fill(saved.domain.name + ' · 再次编辑');
  await page.getByRole('button', { name: '保存', exact: true }).click(); await input.press('Control+s');
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  assert.equal((await fixture.api('/api/workspaces/' + wid)).revision, saved.revision + 1); assert.equal(saveRequests().length, 2);
  assert.deepEqual(fixture.errors, []);
  result.checks = ['新建型号 UI', 'Ctrl+S 保存与真实修订', '顶栏保存', '重复点击/快捷键只发一个保存请求'];
} catch (error) { result.failure = String(error.stack || error); console.error(result.failure); console.error(fixture.log().slice(-1500)); process.exitCode = 1; }
finally { await fixture.close(); await fs.mkdir(path.join(root,'.data/type-organization'),{recursive:true}); await fs.writeFile(path.join(root,'.data/type-organization/save-verification.json'),JSON.stringify(result,null,2)); }
console.log(JSON.stringify(result));
