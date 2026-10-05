import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect as baseExpect } from '@playwright/test';
import { openHeadlessBrowser, settle, outputRoot } from './browser.mjs';
import { request } from './research-fixtures.mjs';
if (process.env.E2E_ISOLATED !== '1') throw Error('Requires isolated database');
const base = process.env.FRONTEND_URL, expect = baseExpect.configure({ timeout: 25000 });
const session = await openHeadlessBrowser(), { page, context } = session;
const report = { checks: [], errors: [], scope: 'All-candidate rejection response only; no numeric result or stored run changed' };
page.on('pageerror', e => report.errors.push(e.message));
try {
  let selected;
  for (const w of await request(base, '/api/workspaces')) {
    for (const s of await request(base, `/api/workspaces/${w.id}/studies`)) {
      if (s.definition.driver.kind !== 'selection') continue;
      const runs = (await request(base, `/api/workspaces/${w.id}/studies/${s.id}/runs`)).items;
      const r = runs.find(r => r.integrity === 'verified' && r.snapshot?.candidate_snapshots?.length >= 2 && r.output?.assessment?.length >= 2);
      if (r) { selected = { w, s, r, runs }; break; }
    }
    if (selected) break;
  }
  assert.ok(selected, 'Requires saved candidate snapshots');
  const { w, s, r, runs } = selected, refused = structuredClone(r), prefix = `/api/workspaces/${w.id}/studies/${s.id}/runs`;
  refused.output.assessment = r.output.assessment.map(a => ({ ...a, status: 'not_applicable', meets_target: null, value: null, margin: null, reason: { code: 'NOT_APPLICABLE', message: '隔离全拒算场景：厂家资料缺少所需计算参数' } }));
  await context.route('**' + prefix + '*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(route.request().url().split('?')[0].endsWith('/runs') ? { items: [refused] } : refused) }));
  await page.goto(base + `/studies/${s.id}/selection/results?workspace=${w.id}&run=${r.id}`); await settle(page);
  await expect(page.getByText('当前条件下没有合格型号', { exact: true })).toBeVisible();
  await expect(page.locator('.conclusion')).toHaveCount(0);
  const group = page.getByRole('button', { name: '展开不适用', exact: true }); await expect(group).toHaveAttribute('aria-expanded', 'false');
  await group.click();
  const table = page.getByRole('table', { name: '真实选型候选', exact: true });
  await expect(table.locator('tbody tr.data-row')).toHaveCount(refused.output.assessment.length);
  for (const row of await table.locator('tbody tr.data-row').all()) { await expect(row).toContainText('厂家资料缺少'); await expect(row.locator('td').nth(2)).toContainText('—'); }
  await page.getByRole('combobox', { name: '显示', exact: true }).click(); await page.getByRole('option', { name: '不适用', exact: true }).click();
  await expect(table).toContainText('厂家资料缺少');
  assert.deepEqual((await request(base, prefix)).items, runs);
  report.checks.push(`全部 ${refused.output.assessment.length} 个真实候选快照注入拒算后，无推荐、无允许电流、默认折叠、可展开及筛选，原运行不变`);
  assert.deepEqual(report.errors, []);
} catch (error) { report.failure = String(error.stack || error); console.error(report.failure); console.error((await page.locator('body').innerText()).slice(0, 2200)); process.exitCode = 1; }
finally { const out = path.join(outputRoot, 'selection-refusal'); await fs.mkdir(out, { recursive: true }); await fs.writeFile(path.join(out, 'verification.json'), JSON.stringify(report, null, 2)); await session.close(); }
console.log(JSON.stringify(report));
