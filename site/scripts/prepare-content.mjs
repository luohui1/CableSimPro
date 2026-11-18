// 构建前准备站点内容（输出均不入库，见 site/.gitignore）：
//   1. 按 publish.json 把仓库 docs/ 中允许公开的文件同步为站点页面，改写其中的相对链接；
//   2. 汇总 plugins/*/plugin.json 与 docs/plugins/examples/，供“方法清单”“插件示例”页面读取；
//   3. 调用 scripts/export-openapi.py 从后端导出 OpenAPI 描述，供“接口参考”生成静态页；
//   4. 由 design/brand/mark.svg 与 design/tokens.css 生成明暗两种品牌标记和网站图标。
// 用法：node scripts/prepare-content.mjs [--skip-openapi]（跳过时沿用上次导出的接口描述）
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { mathFromMarkdown } from 'mdast-util-math';
import { gfm } from 'micromark-extension-gfm';
import { math } from 'micromark-extension-math';
import { SKIP, visit } from 'unist-util-visit';

const site = fileURLToPath(new URL('..', import.meta.url));
const repo = path.resolve(site, '..');
const synced = path.join(site, 'src/content/docs/_synced');
const generated = path.join(site, '.generated');
const brandOut = path.join(site, 'src/assets/generated');
const skipOpenapi = process.argv.includes('--skip-openapi');

const publish = JSON.parse(await readFile(path.join(site, 'publish.json'), 'utf8'));
const repoUrl = publish.repository.replace(/\/$/, '');

function sourceRef() {
  if (process.env.DOCS_SOURCE_REF) return process.env.DOCS_SOURCE_REF;
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' });
  return git.status === 0 ? git.stdout.trim() : 'main';
}
const ref = sourceRef();

async function listFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(full)));
    else out.push(full);
  }
  return out;
}
const toRepoPath = (full) => path.relative(repo, full).split(path.sep).join('/');

// ---- 1. 校验清单 ----
// 链接与发布来源只认已入库的文件：未入库的本地文件在公开仓库里不存在，链过去就是死链
const lsFiles = spawnSync('git', ['ls-files', '-z'], { cwd: repo, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
if (lsFiles.status !== 0) throw Error('读取 git ls-files 失败：站点需要在 Git 检出中构建');
const tracked = new Set(lsFiles.stdout.split('\0').filter(Boolean));
const trackedDirs = new Set(
  [...tracked].flatMap((file) => {
    const parts = file.split('/');
    return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
  }),
);
const isUnpublished = (repoPath) =>
  publish.unpublished.some((item) => repoPath === item.source || (item.source.endsWith('/') && repoPath.startsWith(item.source)));

const pages = publish.pages;
const bySource = new Map();
const slugs = new Set();
for (const page of pages) {
  if (!/^[a-z0-9]+(?:[/-][a-z0-9]+)*$/.test(page.slug)) throw Error(`publish.json：网址不合规 ${page.slug}`);
  if (slugs.has(page.slug)) throw Error(`publish.json：网址重复 ${page.slug}`);
  if (bySource.has(page.source)) throw Error(`publish.json：重复发布 ${page.source}`);
  if (path.posix.normalize(page.source) !== page.source || page.source.split('/').includes('..'))
    throw Error(`publish.json：来源路径不规范 ${page.source}`);
  // 来源只能是 docs/ 下的文档或插件自带的 README，且已入库
  const allowed = page.source.startsWith('docs/') || /^plugins\/[^/]+\/README\.md$/.test(page.source);
  if (!allowed || !tracked.has(page.source))
    throw Error(`publish.json：来源不在 docs/ 或插件 README，或不是已入库文件：${page.source}`);
  if (isUnpublished(page.source)) throw Error(`publish.json：${page.source} 同时列在 unpublished`);
  slugs.add(page.slug);
  bySource.set(page.source, page);
}
// 同步页面的网址不能占用手写页面的网址
const contentRoot = path.join(site, 'src/content/docs');
for (const file of await listFiles(contentRoot)) {
  if (!/\.(md|mdx)$/.test(file) || file.startsWith(synced + path.sep)) continue;
  const slug = path
    .relative(contentRoot, file)
    .split(path.sep)
    .join('/')
    .replace(/\.(md|mdx)$/, '')
    .replace(/(^|\/)index$/, '');
  if (slugs.has(slug)) throw Error(`publish.json：网址 ${slug} 与手写页面 ${toRepoPath(file)} 重名`);
}
const unclassified = [...tracked]
  .filter((f) => f.startsWith('docs/') && f.endsWith('.md') && !bySource.has(f) && !isUnpublished(f))
  .sort();
if (unclassified.length)
  console.warn(`提示：以下 docs/ 文件未在 publish.json 中分类，默认不发布：\n  ${unclassified.join('\n  ')}`);

// ---- 2. 同步页面 ----
// 用 Markdown 语法树找链接：代码块、行内代码、脚注和公式里的方括号都不会被误认成链接；
// 只替换链接地址本身，其余原文逐字保留。
const brokenLinks = [];
const imageAssets = new Map();
const relativeUrl = (fromSlug, toSlug) => '../'.repeat(fromSlug.split('/').length) + toSlug + '/';
const syncedPath = (source) => source.replace(/^docs\//, '');

function resolveTarget(url, page, image) {
  if (!url || /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('#') || url.startsWith('//')) return { keep: true };
  const [target, ...hash] = url.split('#');
  const anchor = hash.length ? '#' + hash.join('#') : '';
  let decoded = target;
  try {
    decoded = decodeURI(target);
  } catch {}
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(page.source), decoded)).replace(/\/$/, '');
  if (resolved.startsWith('..')) return { broken: true };
  if (image) {
    // 图片随页面一起复制进站点，内网离线时也能显示
    if (!tracked.has(resolved) || isUnpublished(resolved)) return { broken: true };
    const asset = path.posix.join('_assets', resolved);
    imageAssets.set(resolved, asset);
    return { url: path.posix.relative(path.posix.dirname(syncedPath(page.source)), asset) };
  }
  if (bySource.has(resolved)) return { url: relativeUrl(page.slug, bySource.get(resolved).slug) + anchor };
  // 明确不发布的文档不给链接（也不链到代码仓库），只保留链接文字
  if (isUnpublished(resolved)) return { unlink: true };
  if (tracked.has(resolved)) return { url: `${repoUrl}/blob/${ref}/${encodeURI(resolved)}${anchor}` };
  if (trackedDirs.has(resolved)) return { url: `${repoUrl}/tree/${ref}/${encodeURI(resolved)}${anchor}` };
  return { broken: true };
}

// 行内链接的地址在最后一个 "](" 之后（链接文字里也可能出现 "]("），从后往前找第一个能完整匹配的位置
const destinationTail =
  /^\]\(\s*(<[^>\n]*>|[^\s<>]*)(?:\s+(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\((?:[^)\\]|\\.)*\)))?\s*\)$/s;
function locateDestination(text) {
  for (let i = text.lastIndexOf(']('); i > 0; i = text.lastIndexOf('](', i - 1)) {
    const match = text.slice(i).match(destinationTail);
    if (match) return { offset: i + text.slice(i).indexOf(match[1], 2), raw: match[1] };
  }
  return null;
}

function rewriteLinks(markdown, page) {
  const tree = fromMarkdown(markdown, {
    extensions: [gfm(), math()],
    mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
  });
  const edits = [];
  const span = (node) => [node.position.start.offset, node.position.end.offset];
  const innerText = (node) =>
    node.children.length
      ? markdown.slice(node.children[0].position.start.offset, node.children.at(-1).position.end.offset)
      : '';
  const replaceDestination = (start, raw, url) =>
    edits.push({ start, end: start + raw.length, text: raw.startsWith('<') ? `<${url}>` : url });

  const unlinked = new Set();
  visit(tree, 'definition', (node) => {
    const [start, end] = span(node);
    const decision = resolveTarget(node.url, page, false);
    if (decision.broken) brokenLinks.push(`${page.source}: ${node.url}`);
    else if (decision.unlink) {
      unlinked.add(node.identifier);
      edits.push({ start, end, text: '' });
    } else if (decision.url) {
      const match = markdown.slice(start, end).match(/^(\s*\[(?:[^\]\\]|\\.)*\]:\s*)(<[^>\n]*>|\S+)/);
      if (!match) throw Error(`${page.source}：无法定位链接定义 ${node.url}`);
      replaceDestination(start + match[1].length, match[2], decision.url);
    }
  });
  visit(tree, (node) => {
    if (node.type === 'linkReference' && unlinked.has(node.identifier)) {
      const [start, end] = span(node);
      edits.push({ start, end, text: innerText(node) });
      return SKIP;
    }
    if (node.type !== 'link' && node.type !== 'image') return;
    const [start, end] = span(node);
    const text = markdown.slice(start, end);
    if (!text.startsWith('[') && !text.startsWith('![')) return; // 自动链接与裸网址
    const decision = resolveTarget(node.url, page, node.type === 'image');
    if (decision.keep) return;
    if (decision.broken) {
      brokenLinks.push(`${page.source}: ${node.url}`);
      return SKIP;
    }
    if (decision.unlink) {
      edits.push({ start, end, text: innerText(node) });
      return SKIP;
    }
    const destination = locateDestination(text);
    if (!destination) throw Error(`${page.source}：无法定位链接地址 ${node.url}`);
    replaceDestination(start + destination.offset, destination.raw, decision.url);
  });

  let output = markdown;
  let limit = Infinity;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    if (edit.end > limit) throw Error(`${page.source}：链接改写位置重叠`);
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
    limit = edit.start;
  }
  return output;
}

const yaml = (value) => JSON.stringify(value);
await rm(synced, { recursive: true, force: true });
// Astro 不清空输出目录；先删掉上次的产物，避免改名或删除的页面残留在 dist/ 里
await rm(path.join(site, 'dist'), { recursive: true, force: true });
for (const page of pages) {
  const text = (await readFile(path.join(repo, page.source), 'utf8')).replace(/\r\n/g, '\n');
  const heading = text.match(/^# (.+)\n/m);
  const title = page.title || heading?.[1].trim();
  if (!title) throw Error(`${page.source} 没有一级标题，请在 publish.json 中提供 title`);
  const body = heading ? text.replace(heading[0], '') : text;
  const frontmatter = [
    '---',
    `title: ${yaml(title)}`,
    `slug: ${page.slug}`,
    'sidebar:',
    `  label: ${yaml(page.label || title)}`,
    `  order: ${Number(page.order ?? 100)}`,
    '---',
  ].join('\n');
  const origin = `\n\n---\n\n本页由仓库文件 [${page.source}](${repoUrl}/blob/${ref}/${encodeURI(page.source)}) 生成，修改请编辑该文件。\n`;
  const output = path.join(synced, syncedPath(page.source));
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, frontmatter + '\n' + rewriteLinks(body.trim(), page) + origin);
}
if (brokenLinks.length) throw Error(`docs/ 中有指向不存在、未入库或不发布文件的链接：\n  ${brokenLinks.join('\n  ')}`);
for (const [source, asset] of imageAssets) {
  await mkdir(path.dirname(path.join(synced, asset)), { recursive: true });
  await copyFile(path.join(repo, source), path.join(synced, asset));
}

// ---- 3. 插件清单与示例 ----
await mkdir(generated, { recursive: true });
const pluginDirs = (await readdir(path.join(repo, 'plugins'), { withFileTypes: true }))
  .filter((d) => d.isDirectory() && existsSync(path.join(repo, 'plugins', d.name, 'plugin.json')))
  .map((d) => d.name)
  .sort();
const plugins = [];
for (const dir of pluginDirs) {
  const manifest = JSON.parse(await readFile(path.join(repo, 'plugins', dir, 'plugin.json'), 'utf8'));
  plugins.push({
    id: manifest.id,
    version: manifest.version,
    name: manifest.name,
    description: manifest.description,
    manifest: `plugins/${dir}/plugin.json`,
    resources: manifest.resources,
    capabilities: (manifest.capabilities || []).map((c) => ({
      id: c.id,
      kind: c.kind,
      title: c.title,
      description: c.description,
      method_version: c.method_version,
      analysis: c.analysis,
      solver: c.solver || 'local',
      validation: {
        level: c.validation?.level ?? 'unverified',
        // 用例既可能是测试文件路径，也可能是文字描述；只给真实存在的文件加链接
        cases: (c.validation?.cases || []).map((text) => {
          const local = `plugins/${dir}/${text}`;
          const file = existsSync(path.join(repo, local)) ? local : existsSync(path.join(repo, text)) ? text : null;
          return { text, path: file };
        }),
      },
      limitations: c.limitations || [],
      outputs: c.outputs || [],
      parameters: Object.entries(c.parameter_schema?.properties || {}).map(([key, p]) => ({
        key,
        title: p.title,
        description: p.description,
        type: p.type,
        unit: p['x-unit'],
        minimum: p.minimum ?? p.exclusiveMinimum,
        maximum: p.maximum ?? p.exclusiveMaximum,
        required: (c.parameter_schema?.required || []).includes(key),
      })),
    })),
  });
}
await writeFile(path.join(generated, 'plugins.json'), JSON.stringify({ ref, repository: repoUrl, plugins }, null, 2));

const exampleRoot = path.join(repo, 'docs/plugins/examples');
const examples = [];
for (const file of (await listFiles(exampleRoot)).sort()) {
  if (!/\.(json|html|svg)$/.test(file)) continue;
  examples.push({ path: toRepoPath(file), content: (await readFile(file, 'utf8')).replace(/\r\n/g, '\n') });
}
await writeFile(path.join(generated, 'examples.json'), JSON.stringify(examples, null, 2));

const schema = JSON.parse(await readFile(path.join(repo, 'plugin-spec/manifest.schema.json'), 'utf8'));
await writeFile(path.join(generated, 'manifest-schema.json'), JSON.stringify(schema, null, 2));

// ---- 4. 接口描述 ----
const openapi = path.join(generated, 'openapi.json');
if (!skipOpenapi || !existsSync(openapi)) {
  const candidates = [
    process.env.PYTHON,
    path.join(repo, '.venv/Scripts/python.exe'),
    path.join(repo, '.venv/bin/python'),
    process.platform === 'win32' ? 'python' : 'python3',
  ].filter(Boolean);
  const python = candidates.find((c) => !c.includes(path.sep) || existsSync(c));
  const run = spawnSync(python, [path.join(site, 'scripts/export-openapi.py'), openapi], {
    cwd: repo,
    stdio: 'inherit',
    env: { ...process.env, PYTHONUTF8: '1' },
  });
  if (run.status !== 0) throw Error(`OpenAPI 导出失败（${python}）。请先安装 backend/requirements.txt，或用 PYTHON 指定解释器。`);
}

// ---- 5. 品牌标记 ----
const tokens = await readFile(path.join(repo, 'design/tokens.css'), 'utf8');
const [lightBlock, darkBlock = ''] = tokens.split('[data-theme="dark"]');
const palette = (block) => Object.fromEntries([...block.matchAll(/--([a-z-]+):\s*(#[0-9A-Fa-f]{6});/g)].map((m) => [m[1], m[2]]));
const light = palette(lightBlock);
const dark = { ...light, ...palette(darkBlock) };
const mark = await readFile(path.join(repo, 'design/brand/mark.svg'), 'utf8');
const paint = (colors) =>
  mark
    .replace(/var\(--([a-z-]+), currentColor\)/g, (_, name) => colors[name] || colors.text)
    .replace(/currentColor/g, colors.text);
await mkdir(brandOut, { recursive: true });
await writeFile(path.join(brandOut, 'mark-light.svg'), paint(light));
await writeFile(path.join(brandOut, 'mark-dark.svg'), paint(dark));
await mkdir(path.join(site, 'public'), { recursive: true });
await writeFile(path.join(site, 'public/favicon.svg'), paint(light));

console.log(`内容已准备：${pages.length} 篇同步页面，${plugins.length} 个插件清单，${examples.length} 个示例文件（来源提交 ${ref.slice(0, 12)}）。`);
