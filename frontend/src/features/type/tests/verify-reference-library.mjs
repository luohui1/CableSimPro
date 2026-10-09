import assert from 'node:assert/strict';
import { expect as baseExpect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { typeFixture, root } from './fixture.mjs';
import { checkLayout } from './ui-checks.mjs';

// Keep the existing binding/undo/error regression in verify-resources.mjs.
const output = path.join(root, '.data/material-library');
await fs.mkdir(output, { recursive: true });
process.env.E2E_DATABASE_SOURCE ||= path.join(root, '.data/release/engineering.sqlite');
const expect = baseExpect.configure({ timeout: 30000 });
const fixture = await typeFixture({ main: true, build: path.join(output, 'frontend'), setup: async database => {
  const script = path.join(path.dirname(database), 'resources.py');
  await fs.writeFile(script, `import json,os,sys\nfrom pathlib import Path\nfrom fastapi.testclient import TestClient\nfrom backend.main import create_app\nfrom frontend.scripts.engineering_resources import publish_resources,bind_demo_resources\nos.environ['CABLESIM_DATASETS_DIR']=str(Path(sys.argv[1]).parent/'datasets')\nwith TestClient(create_app(Path(sys.argv[1]))) as c:\n def api(p,m='GET',b=None):\n  r=c.request(m,p,json=b)\n  if r.status_code>=400:raise RuntimeError(r.text)\n  return r.json()\n resources=publish_resources(api)\n bindings={}\n for item in api('/api/design/type-workspaces'):\n  origin='hv' if item['name'].startswith('起帆') else 'mv' if item['name'].startswith('YJV22') else None\n  if origin:bindings[item['id']]=bind_demo_resources(api,item['id'],origin)\n Path(sys.argv[2]).write_text(json.dumps({'resources':resources,'bindings':bindings},ensure_ascii=False,indent=2),encoding='utf-8')\n`, 'utf8');
  await promisify(execFile)(process.env.PYTHON || path.join(root, '.venv/Scripts/python.exe'), [script, database, path.join(output, 'seed-verification.json')], { cwd: root, env: { ...process.env, PYTHONPATH: root }, windowsHide: true, timeout: 120000 });
} });
const { page } = fixture;
const result = { runtime: fixture.runtime, layouts: [], errors: fixture.errors, types: [], indexProjectionGaps: [] };
async function visit(url) { await page.goto(fixture.url + url); await page.waitForLoadState('networkidle'); }
try {
  const materials = await fixture.api('/api/foundation/assets?kind=material&status=published&limit=100');
  const standards = await fixture.api('/api/foundation/assets?kind=rule&status=published&limit=100');
  assert.ok(materials.total >= 21 && standards.total >= 7);
  const rows = (await fixture.api('/api/design/type-workspaces')).filter(t => t.name.startsWith('起帆') || t.name.startsWith('YJV22'));
  for (const width of [1366, 1920]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: width === 1366 ? 768 : 1080 });
    for (const group of ['materials', 'standards']) {
      await visit(`/resources/${group}?theme=${theme}`);
      await expect(page.locator('[data-page=library]')).toHaveAttribute('data-state', 'success');
      await expect(page.getByRole('table', { name: group === 'materials' ? '材料与部件' : '标准与规则', exact: true })).toBeVisible();
      result.layouts.push({ group, theme, ...await checkLayout(page) });
      if (width === 1366 && theme === 'light') await page.screenshot({ path: path.join(output, group + '.png') });
    }
    for (const item of rows) {
      await visit(`/types/${item.id}/structure/table?theme=${theme}`);
      await expect(page.locator('.type-resource-cell[data-resource-state=current]').first()).toBeVisible();
      const before = await fixture.api(`/api/types/${item.id}/resources`);
      const matching = before.targets.filter(t => t.unique_match && t.state === 'unbound');
      assert.equal(matching.length, 0);
      await page.getByRole('button', { name: '核对唯一匹配', exact: true }).click();
      await expect(page.getByRole('status').filter({ hasText: '没有新增的唯一匹配' })).toBeVisible();
      assert.equal((await fixture.api(`/api/types/${item.id}/resources`)).revision, before.revision);
      result.layouts.push({ type: item.name, tab: 'structure', theme, ...await checkLayout(page) });
      const relations = await fixture.api(`/api/index/objects/type/${item.id}/relations`);
      assert.ok(relations.uses.some(e => e.role === 'material' && e.freshness === 'current'));
      // The index owner projects only materials/structure today. Verify the
      // saved version links, and explicitly report its omitted declaration.
      for (const target of before.targets.filter(t => t.role === 'standard' && t.state === 'current')) {
        const edge = relations.uses.find(e => e.role === 'standard' && e.target.id === target.binding.resource_id);
        assert.ok(edge); assert.equal(edge.pinned.version, target.binding.version); assert.equal(edge.pinned.digest, target.binding.content_sha256);
        if (edge.freshness !== 'current' && width === 1366 && theme === 'light') result.indexProjectionGaps.push({ type: item.name, target: target.name, freshness: edge.freshness, reason: edge.reason, requiredInput: 'domain.provenance./execution_standards' });
      }
      await visit(`/types/${item.id}/requirements/standards?theme=${theme}`);
      await expect(page.getByLabel('已声明执行标准', { exact: true })).toBeVisible();
      await expect(page.getByText('执行版本已声明', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '绑定标准版本', exact: true })).toBeEnabled();
      result.layouts.push({ type: item.name, tab: 'standards', theme, ...await checkLayout(page) });
      if (width === 1366 && theme === 'light' && item.name.startsWith('起帆')) await page.screenshot({ path: path.join(output, 'standard-bindings.png') });
      if (width === 1366 && theme === 'light') result.types.push({ name: item.name, targets: before.targets, relations });
    }
  }
  let mode = 'success', unblock;
  const selected = rows[0], saved = await fixture.api(`/api/workspaces/${selected.id}`), data = await fixture.api(`/api/types/${selected.id}/resources`);
  const pattern = `**/api/types/${selected.id}/resources`;
  await fixture.context.route(pattern, async route => {
    if (mode === 'loading') await new Promise(resolve => { unblock = resolve; });
    if (mode === 'error') return route.fulfill({ status: 503, json: { detail: '验收故障注入：资源目录暂不可用' } });
    const value = structuredClone(data);
    if (mode === 'empty') { value.targets = []; value.resources = []; }
    return route.fulfill({ json: value });
  });
  try {
    for (const width of [1366, 1920]) for (const theme of ['light', 'dark']) for (const state of ['empty', 'loading', 'error', 'success', 'historical']) {
      unblock?.(); mode = state === 'historical' ? 'success' : state;
      await page.setViewportSize({ width, height: width === 1366 ? 768 : 1080 });
      await page.goto(`${fixture.url}/types/${selected.id}/requirements/standards?theme=${theme}${state === 'historical' ? '&revision='+saved.revision : ''}`, { waitUntil: 'domcontentloaded' });
      if (state === 'loading') await expect(page.getByText('正在读取资源绑定', { exact: true })).toBeVisible();
      if (state === 'error') await expect(page.getByText('验收故障注入：资源目录暂不可用', { exact: false })).toBeVisible();
      if (state === 'empty') { await expect(page.getByRole('button', { name: '绑定标准版本', exact: true })).toBeEnabled(); await page.getByRole('button', { name: '绑定标准版本', exact: true }).click(); await expect(page.getByText('尚无已核对的执行版本或已批准要求；在要求清单里核对来源。', { exact: true })).toBeVisible(); }
      if (state === 'success') await expect(page.getByText('执行版本已声明', { exact: true })).toBeVisible();
      if (state === 'historical') { await expect(page.getByText('历史执行版本', { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: '绑定标准版本', exact: true })).toHaveCount(0); }
      result.layouts.push({ state, theme, ...await checkLayout(page) });
      if (state === 'empty') await page.keyboard.press('Escape');
      unblock?.();
    }
  } finally { unblock?.(); await fixture.context.unroute(pattern); }
  assert.deepEqual(fixture.errors, []);
} catch (error) { result.failure = String(error.stack || error); result.backendLog = fixture.log(); process.exitCode = 1; console.error(result.failure); }
finally { await fs.writeFile(path.join(output, 'browser-verification.json'), JSON.stringify(result, null, 2)); await fixture.close(); }
