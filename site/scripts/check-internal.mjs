// 公开前的内部信息检查：内部主机名、内网地址、本机路径、个人信息、密钥和内部过程记录。
// 检查两处：站点内容源（src/content/docs，含从 docs/ 同步的页面）和构建产物 dist/ 中的页面文字与属性。
// 规则见 internal-check.json。发现任何一项即以退出码 1 结束，使构建失败。
// 用法：node scripts/check-internal.mjs [--sources-only]
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const site = fileURLToPath(new URL('..', import.meta.url));
const config = JSON.parse(await readFile(path.join(site, 'internal-check.json'), 'utf8'));
const allowedPaths = config.allowedPaths.map((p) => new RegExp(p));
const allowedEmails = config.allowedEmails.map((d) => d.toLowerCase());

const rules = [
  { label: '内部主机名', re: new RegExp(`(?<![\\w.-])(?:${config.hostnames.join('|')})(?![\\w-])`, 'gi') },
  {
    label: '内网地址',
    re: /(?<![\d.])(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?![\d.])/g,
  },
  {
    label: '本机路径',
    re: /(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\s"'<>`|，。；、（）()[\]]*/g,
    allow: (match) => allowedPaths.some((re) => re.test(match.replace(/[.,:;]+$/, ''))),
  },
  { label: '用户目录', re: /(?:\/home\/|\/Users\/|[A-Za-z]:[\\/]+Users[\\/]+)[A-Za-z0-9._-]+/gi },
  {
    label: '邮箱',
    re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
    allow: (match) => allowedEmails.some((domain) => match.toLowerCase().endsWith('@' + domain)),
  },
  { label: '手机号', re: /(?<![\dA-Za-z])1[3-9]\d{9}(?![\dA-Za-z])/g },
  {
    label: '身份证号',
    re: /(?<![\dA-Za-z])[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?![\dA-Za-z])/g,
  },
  {
    label: '密钥',
    re: /\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|xox[abprs]-[A-Za-z0-9-]{10,})|-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  },
  { label: '疑似密钥赋值', re: /\b(?:api[_-]?key|secret|token|password|passwd)\b\s*[:=]\s*["']?[A-Za-z0-9+/_-]{16,}/gi },
  { label: '内部过程记录', re: new RegExp(config.processTerms.join('|'), 'g') },
];

async function walk(dir, keep) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, keep)));
    else if (keep(full)) out.push(full);
  }
  return out;
}

const findings = [];
function scan(text, where) {
  for (const rule of rules) {
    for (const match of text.matchAll(rule.re)) {
      if (rule.allow?.(match[0])) continue;
      findings.push({ where: where(match.index), label: rule.label, text: match[0] });
    }
  }
}
const lineOf = (text, index) => text.slice(0, index).split('\n').length;
const relative = (file) => path.relative(site, file).split(path.sep).join('/');

const contentRoot = path.join(site, 'src/content/docs');
const sources = await walk(contentRoot, (f) => /\.(md|mdx)$/.test(f));
for (const file of sources) {
  const text = await readFile(file, 'utf8');
  scan(text, (index) => `${relative(file)}:${lineOf(text, index)}`);
}

const dist = path.join(site, 'dist');
let pages = 0;
if (!process.argv.includes('--sources-only') && existsSync(dist)) {
  const html = await walk(dist, (f) => f.endsWith('.html') && !f.includes(`${path.sep}_astro${path.sep}`));
  for (const file of html) {
    pages++;
    // 只看读者可见的文字与属性；脚本和样式里的第三方库代码不是页面内容
    const text = (await readFile(file, 'utf8'))
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/&#x2F;|&#47;/g, '/')
      .replace(/&#x5C;|&#92;/g, '\\')
      .replace(/&amp;/g, '&');
    scan(text, () => relative(file));
  }
}

const unique = [...new Map(findings.map((f) => [`${f.where}|${f.label}|${f.text}`, f])).values()];
if (unique.length) {
  console.error(`内部信息检查失败：${unique.length} 处`);
  for (const f of unique.slice(0, 200)) console.error(`  ${f.where}  [${f.label}]  ${f.text}`);
  if (unique.length > 200) console.error(`  …… 另有 ${unique.length - 200} 处`);
  process.exit(1);
}
console.log(`内部信息检查通过：${sources.length} 个内容源，${pages} 个构建页面。`);
