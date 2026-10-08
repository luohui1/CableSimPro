import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openHeadlessBrowser } from '../../../../scripts/browser.mjs';
import { chromium } from 'playwright-core';

export const repositoryRoot = fileURLToPath(new URL('../../../../../', import.meta.url));
export const outputRoot = path.join(repositoryRoot, '.data/frontend-canvas');
export async function createBrowserFixture({ software = false } = {}) {
  const build = path.join(outputRoot, 'build');
  const entry = path.join(build, 'src/features/cad/gallery.html');
  await fs.access(entry);
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
    '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.woff': 'font/woff' };
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      const file = url.pathname.startsWith('/assets/') ? path.resolve(build, `.${decodeURIComponent(url.pathname)}`) : entry;
      if (!file.startsWith(build + path.sep)) { response.writeHead(403).end(); return; }
      const body = await fs.readFile(file);
      response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': file === entry ? 'no-store' : 'public,max-age=31536000,immutable' }).end(body);
    } catch { response.writeHead(404).end('Not found'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  let owned;
  try {
    if (software) {
      const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle'] });
      const page = await browser.newPage(), context = page.context();
      owned = { browser, context, page, close: async () => { try { for (const c of browser.contexts()) for (const p of c.pages()) await p.close(); if (browser.contexts().flatMap(c => c.pages()).length) throw Error('任务页面未清空。'); console.log('任务浏览器页面已清空：0'); } finally { await browser.close(); } } };
    } else owned = await openHeadlessBrowser();
  }
  catch (error) { await new Promise(resolve => server.close(resolve)); throw error; }
  const errors = [], external = [], requests = [];
  owned.page.on('pageerror', error => errors.push(error.message));
  owned.page.on('request', request => {
    requests.push(request.url());
    if (new URL(request.url()).origin !== url) external.push(request.url());
  });
  await owned.page.setViewportSize({ width: 1366, height: 768 });
  return { ...owned, url, errors, external, requests, close: async () => {
    try { await owned.close(); }
    finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  } };
}
export async function navigate(fixture, entry, options = {}) {
  const parameters = new URLSearchParams({ entry, theme: options.theme || 'light', state: options.state || 'success' });
  if (options.kind) parameters.set('kind', options.kind);
  await fixture.page.goto(`${fixture.url}/gallery?${parameters}`, { waitUntil: 'domcontentloaded' });
  await fixture.page.evaluate(() => document.fonts.ready);
  await fixture.page.locator(`[data-gallery-entry="${entry}"]`).waitFor();
}
export async function selectOption(page, label, value) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: value, exact: true }).click();
}
export async function snapshot(page, component) {
  return page.evaluate(name => window.canvasGallery[name].snapshot(), component);
}
export async function editNumber(page, trigger, value) {
  await trigger.focus(); await page.keyboard.press('Enter');
  const input = page.locator('.drawing-dimension-editor input');
  await input.waitFor(); await input.fill(String(value)); await input.press('Enter');
}
export async function drag(page, locator, dx, dy) {
  const bounds = await locator.boundingBox();
  if (!bounds) throw new Error('拖动目标不可见。');
  const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 6 }); await page.mouse.up();
}
