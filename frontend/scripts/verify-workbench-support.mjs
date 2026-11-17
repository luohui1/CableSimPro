import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect as playwrightExpect } from '@playwright/test';
import { openHeadlessBrowser, repositoryRoot } from './browser.mjs';
import { assertLayout } from './layout-assertions.mjs';

/** Shared evidence only. Every scenario changes engineering data through the UI. */
export async function walkthrough(name, scenario) {
  assert.equal(process.env.E2E_ISOLATED, '1', '工作台走查只能在隔离种子库中执行');
  const base = process.env.FRONTEND_URL;
  const phase = process.env.WORKBENCH_PHASE || 'after';
  assert.ok(['before', 'after'].includes(phase), '走查阶段必须是 before 或 after');
  const out = path.join(repositoryRoot, '.data', 'workbench-walk', phase, name);
  await fs.mkdir(out, { recursive: true });
  const report = {
    name, phase, started: new Date().toISOString(), complete: false,
    source: process.env.E2E_DATABASE_SOURCE, frontend: process.env.E2E_DEV === '1' ? 'Vite development server' : 'production build',
    steps: [], checks: [], screenshots: [], errors: [], network: [], writes: [], failures: [],
  };
  const save = () => fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  const session = await openHeadlessBrowser();
  const { page, context } = session;
  const expect = playwrightExpect.configure({ timeout: 30000 });
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => report.errors.push({ kind: 'pageerror', url: page.url(), message: error.message }));
  page.on('console', message => {
    if (message.type() === 'error') report.errors.push({ kind: 'console', url: page.url(), message: message.text() });
  });
  page.on('response', response => {
    if (response.status() >= 400) report.network.push({ status: response.status(), method: response.request().method(), path: new URL(response.url()).pathname });
  });
  page.on('requestfailed', request => {
    if (!request.failure()?.errorText?.includes('ERR_ABORTED')) report.network.push({ method: request.method(), path: new URL(request.url()).pathname, failure: request.failure()?.errorText });
  });
  page.on('request', request => {
    if (request.url().includes('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      report.writes.push({ method: request.method(), path: new URL(request.url()).pathname });
    }
  });
  let currentSize, sequence = 0;
  const safeName = value => value.replace(/[^a-zA-Z0-9\u4e00-\u9fff-]+/g, '-').slice(0, 90);
  async function capture(label) {
    await page.evaluate(() => document.fonts.ready).catch(() => {});
    const filename = `${String(++sequence).padStart(3, '0')}-${safeName(label)}-${currentSize.width}`;
    await page.screenshot({ path: path.join(out, filename + '.png'), animations: 'disabled' });
    const screen = await page.locator('body').innerText();
    await fs.writeFile(path.join(out, filename + '.txt'), await page.locator('body').ariaSnapshot());
    let layoutError;
    try { await assertLayout(page, label); } catch (error) { layoutError = error.message; }
    const entry = { label, ...currentSize, url: page.url(), screenshot: filename + '.png', screen, layoutError };
    report.screenshots.push(entry);
    await save();
    return entry;
  }
  function check(label, passed, details = '') {
    report.checks.push({ label, ...currentSize, passed: Boolean(passed), details, url: page.url() });
    if (!passed && phase === 'after') assert.fail(label + ': ' + (typeof details === 'string' ? details : JSON.stringify(details)));
    return Boolean(passed);
  }
  async function step(label, action) {
    const started = Date.now();
    try {
      const value = await action();
      const shot = await capture(label);
      report.steps.push({ label, ...currentSize, status: 'passed', seconds: (Date.now() - started) / 1000, screenshot: shot.screenshot });
      console.log(`${name} ${currentSize.width}: ${label} — passed`);
      return value;
    } catch (error) {
      const shot = await capture('blocked-' + label).catch(() => null);
      report.steps.push({ label, ...currentSize, status: 'blocked', seconds: (Date.now() - started) / 1000, error: error.message, screenshot: shot?.screenshot });
      throw error;
    } finally { await save(); }
  }
  async function api(endpoint) {
    assert.ok(endpoint.startsWith('/api/'), '证据读取必须来自本次隔离服务');
    const response = await fetch(base + endpoint, { signal: AbortSignal.timeout(90000) });
    assert.ok(response.ok, endpoint + ': HTTP ' + response.status + ' ' + await response.clone().text());
    return response.json();
  }
  async function choose(label, option, scope = page) {
    await scope.getByRole('combobox', { name: label, exact: true }).click();
    await page.getByRole('option', { name: option, exact: typeof option === 'string' }).click();
  }
  try {
    for (const size of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
      currentSize = size;
      await page.setViewportSize(size);
      const tag = `${size.width}-${randomUUID().slice(0, 8)}`;
      try {
        await scenario({ page, context, expect, base, api, choose, capture, step, check, out, size, tag, report });
      } catch (error) {
        report.failures.push({ ...size, message: error.stack || error.message });
        await capture('flow-blocked').catch(() => {});
        console.error(`${name} ${size.width}: ${error.message}`);
      }
      // A viewport is a fresh user journey; a blocked dialog must not contaminate the next.
      const leaveJourney = dialog => dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss();
      page.on('dialog', leaveJourney);
      try { await page.goto('about:blank'); }
      finally { page.off('dialog', leaveJourney); }
    }
    report.complete = true;
    report.summary = {
      steps: report.steps.length, checks: report.checks.length,
      blockers: report.checks.filter(row => !row.passed).length + report.failures.length,
      layoutFailures: report.screenshots.filter(row => row.layoutError).length,
      pageErrors: report.errors.filter(row => row.kind === 'pageerror').length,
      consoleErrors: report.errors.filter(row => row.kind === 'console').length,
      networkFailures: report.network.length,
    };
    await save();
    console.log(JSON.stringify({ name, phase, out, ...report.summary }));
    if (phase === 'after') {
      assert.equal(report.summary.blockers, 0, name + ': 仍有流程卡点');
      assert.equal(report.summary.layoutFailures, 0, name + ': 界面规则未通过');
      assert.equal(report.summary.pageErrors, 0, name + ': 页面抛出异常');
      assert.equal(report.summary.consoleErrors, 0, name + ': 控制台报错');
      assert.equal(report.summary.networkFailures, 0, name + ': 请求失败');
    }
  } finally {
    report.finished = new Date().toISOString();
    await save();
    await session.close();
  }
}
