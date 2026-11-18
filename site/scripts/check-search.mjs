// 中文搜索抽检：在本机临时托管构建产物 dist/，用真实浏览器调用站点自带的 Pagefind 索引，
// 逐个查询 search-checks.json 中的常用词，要求期望页面出现在前 top 条结果中；再在搜索框里实际输入一次，确认界面能列出结果。
// 用法：node scripts/check-search.mjs [--shots <目录>]（--shots 时把界面搜索结果截图存到该目录，供人工查看）
import http from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const site = fileURLToPath(new URL('..', import.meta.url));
const dist = path.join(site, 'dist');
const base = ('/' + (process.env.DOCS_BASE || '/').replace(/^\/+|\/+$/g, '') + '/').replace('//', '/');
const shotsIndex = process.argv.indexOf('--shots');
const shots = shotsIndex > 0 ? path.resolve(process.argv[shotsIndex + 1]) : null;
const { top, checks, ui } = JSON.parse(await readFile(path.join(site, 'search-checks.json'), 'utf8'));
if (!existsSync(path.join(dist, 'pagefind/pagefind.js'))) throw Error('dist/ 中没有 Pagefind 索引，请先运行 npm run build');

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};
const server = http.createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  if (!pathname.startsWith(base)) return response.writeHead(404).end();
  let file = path.join(dist, pathname.slice(base.length));
  if (pathname.endsWith('/')) file = path.join(file, 'index.html');
  if (!file.startsWith(dist)) return response.writeHead(403).end();
  try {
    const body = await readFile(file);
    response.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }).end(body);
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
  await page.goto(origin + base);
  const normalise = (url) => url.replace(/^https?:\/\/[^/]+/, '').replace(new RegExp('^' + base), '').replace(/^\//, '');
  for (const check of checks) {
    const found = await page.evaluate(
      async ({ query, base, top }) => {
        const pagefind = await import(base + 'pagefind/pagefind.js');
        const search = await pagefind.search(query);
        const data = await Promise.all(search.results.slice(0, top).map((result) => result.data()));
        return { total: search.results.length, hits: data.map((d) => ({ url: d.url, title: d.meta?.title ?? '' })) };
      },
      { query: check.query, base, top },
    );
    const urls = found.hits.map((hit) => normalise(hit.url));
    const rank = urls.indexOf(check.expect) + 1;
    const line = `${rank ? '✓' : '✗'} ${check.query} → ${check.expect}（${rank ? '第 ' + rank + ' 条' : '前 ' + top + ' 条未出现'}，共 ${found.total} 条；前三：${found.hits
      .slice(0, 3)
      .map((hit) => hit.title)
      .join(' / ')}）`;
    console.log(line);
    if (!rank) failures.push(line);
  }

  // 搜索框实际输入：按快捷键打开搜索，输入中文词，结果列表里要有期望页面的标题
  for (const item of ui) {
    await page.goto(origin + base);
    // Starlight 的搜索按钮打开对话框，Pagefind 界面在对话框里按需加载
    await page.locator('site-search button[data-open-modal]').first().click();
    const input = page.locator('dialog[open] .pagefind-ui__search-input');
    await input.fill(item.query);
    const result = page.locator('dialog[open] .pagefind-ui__result-link').filter({ hasText: item.title }).first();
    try {
      await result.waitFor({ timeout: 15000 });
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
