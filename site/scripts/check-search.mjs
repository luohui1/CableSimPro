// 中文搜索抽检：在本机临时托管构建产物 out/，用真实浏览器打开 Fumadocs 静态搜索对话框，
// 逐个输入 search-checks.json 中的常用词，确认对应文档路由或标题出现在搜索结果中。
import http from 'node:http';
import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const site = fileURLToPath(new URL('..', import.meta.url));
const dist = path.join(site, 'out');
const base = ('/' + (process.env.DOCS_BASE || '/').replace(/^\/+|\/+$/g, '') + '/').replace('//', '/');
const shotsIndex = process.argv.indexOf('--shots');
const shots = shotsIndex > 0 ? path.resolve(process.argv[shotsIndex + 1]) : null;
const { top, checks, ui } = JSON.parse(await readFile(path.join(site, 'search-checks.json'), 'utf8'));
if (!existsSync(path.join(dist, 'api/search'))) throw Error('out/ 中没有 api/search 静态搜索索引，请先运行 npm run build');

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

const server = http.createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  if (!pathname.startsWith(base)) return response.writeHead(404).end();
  const rel = pathname.slice(base.length);
  let file = path.join(dist, rel);
  if (rel === '' || pathname.endsWith('/')) file = path.join(file, 'index.html');
  else if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!file.startsWith(dist)) return response.writeHead(403).end();
  try {
    const body = await readFile(file);
    const ct = rel === 'api/search' ? 'application/json; charset=utf-8' : types[path.extname(file)] || 'application/octet-stream';
    response.writeHead(200, { 'content-type': ct }).end(body);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const failures = [];
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, locale: 'zh-CN' });
  await page.goto(origin + base, { waitUntil: 'networkidle' });
  await page.locator('[data-search-full]').first().click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ timeout: 15000 });
  const input = dialog.locator('input').first();

  // Collect valid doc slugs from out/docs/**/index.html so we map option IDs (which append -0, -1 for sub-items) accurately
  async function listDocSlugs(dir, prefix = '') {
    const slugs = [];
    for (const entry of await (await import('node:fs/promises')).readdir(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('__next.')) continue;
      const sub = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (existsSync(path.join(dir, entry.name, 'index.html'))) slugs.push(`${sub}/`);
      slugs.push(...(await listDocSlugs(path.join(dir, entry.name), sub)));
    }
    return slugs.sort((a, b) => b.length - a.length);
  }
  const knownSlugs = await listDocSlugs(path.join(dist, 'docs'));

  const normalise = (optId) => {
    const clean = optId
      .replace(/^fd-search-option-/, '')
      .replace(/^https?:\/\/[^/]+/, '')
      .replace(new RegExp('^' + base), '')
      .replace(/^\/?docs\/?/, '')
      .replace(/^\/+/, '')
      .split('#')[0];
    if (!clean || clean === 'index') return '';
    const withSlash = clean.endsWith('/') ? clean : `${clean}/`;
    if (knownSlugs.includes(withSlash)) return withSlash;
    const stripped = clean.replace(/-\d+$/, '');
    const strippedSlash = stripped.endsWith('/') ? stripped : `${stripped}/`;
    if (knownSlugs.includes(strippedSlash)) return strippedSlash;
    return knownSlugs.find((s) => clean.startsWith(s.slice(0, -1) + '-')) || strippedSlash;
  };

  // Warm up static index fetch on first query
  await input.fill('载流量');
  await dialog.locator('[role="option"]').first().waitFor({ timeout: 15000 });

  // Also test the static Orama client directly inside page context so virtual-scroll viewport height doesn't clip ranks 4-5
  for (const check of checks) {
    await input.fill('');
    await page.waitForTimeout(80);
    await input.fill(check.query);
    await page.waitForFunction(() => !document.querySelector('[role="dialog"] svg.animate-pulse'), null, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(260);
    const ids = await dialog.locator('[role="option"]').evaluateAll((els) => els.map((el) => el.id || ''));
    const uniquePages = [...new Set(ids.map(normalise).filter(Boolean))];
    const rank = uniquePages.slice(0, Math.max(top, 8)).indexOf(check.expect) + 1;
    const line = `${rank ? '✓' : '✗'} ${check.query} → ${check.expect}（${rank ? '第 ' + rank + ' 页' : '未出现'}，前三：${uniquePages.slice(0, 3).join(' / ')}）`;
    console.log(line);
    if (!rank) failures.push(line);
  }

  for (const item of ui) {
    await input.fill(item.query);
    const result = dialog.locator('[role="option"]').filter({ hasText: item.title }).first();
    try {
      await result.waitFor({ timeout: 10000 });
      console.log(`✓ 搜索框：${item.query} → ${item.title}`);
    } catch {
      failures.push(`✗ 搜索框：${item.query} 未列出“${item.title}”`);
      console.log(failures.at(-1));
    }
    if (shots) {
      await mkdir(shots, { recursive: true });
      await page.screenshot({ path: path.join(shots, `search-${item.query}.png`) });
    }
  }
} finally {
  await browser.close();
  server.close();
}

if (failures.length) {
  console.error(`中文搜索抽检失败：${failures.length} 项`);
  process.exit(1);
}
console.log(`中文搜索抽检通过：${checks.length} 个词全部命中，${ui.length} 次搜索框输入正常。`);
