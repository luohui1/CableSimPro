// 公开前的内部信息检查：内部主机名、内网地址、本机路径、个人信息、密钥和内部过程记录。
// 检查三处：站点内容与首页组件源码（content/、components/、app/）、生成数据（.generated/ 中的插件清单、
// 示例与接口描述）和构建产物 out/ 中的页面、预取数据与搜索索引。
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
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const rules = [
  // 主机名不加词边界：dg83-login01、dg83_cpu、login.dghpc.example 这类变体也要拦下
  { label: '内部主机名', re: new RegExp(config.hostnames.map(escape).join('|'), 'gi') },
  {
    label: '内网地址',
    re: /(?<![\d.])(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?![\d.])/g,
  },
  {
    label: '本机路径',
    re: /(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\s"'<>`|，。；、（）()[\]]*/g,
    allow: (match) => allowedPaths.some((re) => re.test(match.replace(/[.,:;]+$/, ''))),
  },
  { label: '共享目录', re: /(?<![\w\\])\\\\[A-Za-z0-9._$-]+\\[A-Za-z0-9._$-]+/g },
  // 用户名可以是中文等任意字符；/mnt/<盘符>/ 是 WSL 下的本机磁盘
  { label: '用户目录', re: /(?:\/home\/|\/Users\/|\/root\/|[A-Za-z]:[\\/]+Users[\\/]+)[^\s\\/"'<>`|，。；、（）()]+|\/mnt\/[a-z]\//gi },
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
  // 键名后允许引号，覆盖 JSON / YAML / TOML 里的 "api_key": "…" 写法
  {
    label: '疑似密钥赋值',
    re: /\b(?:api[_-]?key|access[_-]?key|secret[_-]?key|client[_-]?secret|secret|token|password|passwd)\b["']?\s*[:=]\s*["']?[A-Za-z0-9+/_.=-]{16,}/gi,
  },
  { label: '内部过程记录', re: new RegExp(config.processTerms.join('|'), 'gi') },
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

// 页面里的文字和属性值都可能是实体编码的（岛屿组件的属性就是转义后的 JSON），先还原再查
const named = { quot: '"', apos: "'", amp: '&', lt: '<', gt: '>', nbsp: ' ' };
const decode = (text) =>
  text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (entity, name) => named[name.toLowerCase()] ?? entity);

let scanned = 0;
async function scanFiles(files, prepare = (text, _file) => text) {
  for (const file of files) {
    const text = prepare(await readFile(file, 'utf8'), file);
    scanned++;
    scan(text, (index) => `${relative(file)}:${lineOf(text, index)}`);
  }
}

for (const folder of ['content', 'components', 'app', 'lib'])
  await scanFiles(await walk(path.join(site, folder), (f) => /\.(md|mdx|tsx?|json|css)$/.test(f)));
const generated = path.join(site, '.generated');
if (existsSync(generated)) await scanFiles(await walk(generated, (f) => f.endsWith('.json')));

const dist = path.join(site, 'out');
if (!process.argv.includes('--sources-only') && existsSync(dist)) {
  // _next/static/ 是打包后的脚本与第三方库；页面文字都在 HTML、预取数据（.txt）和搜索索引（api/search）里
  const skip = (f) => f.includes(`${path.sep}_next${path.sep}static${path.sep}`);
  const pages = await walk(dist, (f) => (/\.(html|xml|txt|json|svg|webmanifest)$/.test(f) || f.endsWith(`${path.sep}api${path.sep}search`)) && !skip(f));
  await scanFiles(pages, (text, file) => {
    const stripped = text.replace(/(<script\b[^>]*>)[\s\S]*?(<\/script>)/gi, '$1$2').replace(/<style\b[\s\S]*?<\/style>/gi, ' ');
    const unescaped =
      file.endsWith('.txt') || file.endsWith('.json') || file.endsWith(`${path.sep}api${path.sep}search`)
        ? stripped.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
        : stripped;
    return decode(unescaped);
  });
}

const unique = [...new Map(findings.map((f) => [`${f.where}|${f.label}|${f.text}`, f])).values()];
if (unique.length) {
  console.error(`内部信息检查失败：${unique.length} 处`);
  for (const f of unique.slice(0, 200)) console.error(`  ${f.where}  [${f.label}]  ${f.text}`);
  if (unique.length > 200) console.error(`  …… 另有 ${unique.length - 200} 处`);
  process.exit(1);
}
console.log(`内部信息检查通过：${scanned} 个文件。`);
