// 死链检查：逐页读取构建产物 dist/ 中的 HTML，核对站内链接与资源都指向真实存在的文件，
// 带锚点的链接还要在目标页面找到对应的 id。外部网址不访问（构建与检查全程离线）。
// 用法：node scripts/check-links.mjs（构建时设置了 DOCS_BASE，检查时用同一个值）
import { existsSync, statSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const site = fileURLToPath(new URL('..', import.meta.url));
const dist = path.join(site, 'dist');
const base = ('/' + (process.env.DOCS_BASE || '/').replace(/^\/+|\/+$/g, '') + '/').replace('//', '/');
if (!existsSync(dist)) throw Error('没有 dist/，请先运行 npm run build');

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

const pages = await walk(dist);
const html = new Map();
for (const file of pages) html.set(file, await readFile(file, 'utf8'));
const idsCache = new Map();
function ids(file) {
  if (!idsCache.has(file)) {
    const text = html.get(file) ?? '';
    idsCache.set(file, new Set([...text.matchAll(/\s(?:id|name)="([^"]+)"/g)].map((m) => m[1])));
  }
  return idsCache.get(file);
}

function pageUrl(file) {
  const rel = path.relative(dist, file).split(path.sep).join('/');
  return base + rel.replace(/(^|\/)index\.html$/, '$1');
}

function target(pathname) {
  if (!pathname.startsWith(base)) return null;
  const rel = decodeURIComponent(pathname.slice(base.length));
  const direct = path.join(dist, rel);
  if (rel === '' || rel.endsWith('/')) return existsSync(path.join(direct, 'index.html')) ? path.join(direct, 'index.html') : null;
  if (existsSync(direct) && statSync(direct).isFile()) return direct;
  if (existsSync(path.join(direct, 'index.html'))) return path.join(direct, 'index.html');
  return null;
}

const broken = [];
let checked = 0;
for (const file of pages) {
  const from = pageUrl(file);
  const text = html.get(file).replace(/<script\b[\s\S]*?<\/script>/gi, '');
  const refs = [];
  for (const m of text.matchAll(/<(?:a|link|img|source|iframe|script|use)\b[^>]*?\s(href|src|srcset|xlink:href)="([^"]*)"/gi)) {
    if (m[1].toLowerCase() === 'srcset') refs.push(...m[2].split(',').map((part) => part.trim().split(/\s+/)[0]));
    else refs.push(m[2]);
  }
  for (const raw of refs) {
    const ref = raw.replace(/&amp;/g, '&');
    if (!ref || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref)) continue;
    checked++;
    const url = new URL(ref, 'http://site.local' + from);
    const destination = url.pathname === new URL(from, 'http://site.local').pathname && ref.startsWith('#') ? file : target(url.pathname);
    if (!destination) {
      broken.push(`${from} → ${ref}`);
      continue;
    }
    const hash = decodeURIComponent(url.hash.slice(1));
    if (hash && destination.endsWith('.html') && !ids(destination).has(hash)) broken.push(`${from} → ${ref}（锚点不存在）`);
  }
}

if (broken.length) {
  console.error(`死链检查失败：${broken.length} 处`);
  for (const line of [...new Set(broken)].slice(0, 200)) console.error('  ' + line);
  process.exit(1);
}
console.log(`死链检查通过：${pages.length} 个页面，${checked} 个站内链接与资源。`);
