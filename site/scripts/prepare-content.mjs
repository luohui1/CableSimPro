// 构建前准备站点内容（输出均不入库，见 site/.gitignore）：
//   1. 按 publish.json 把仓库 docs/ 中允许公开的文件同步为站点页面，改写其中的相对链接；
//   2. 汇总 plugins/*/plugin.json 与 docs/plugins/examples/，供“方法清单”“插件示例”页面读取；
//   3. 调用 scripts/export-openapi.py 从后端导出 OpenAPI 描述，供“接口参考”生成静态页；
//   4. 由 design/brand/mark.svg 与 design/tokens.css 生成明暗两种品牌标记和网站图标。
// 用法：node scripts/prepare-content.mjs [--skip-openapi]（跳过时沿用上次导出的接口描述）
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
const pages = publish.pages;
const bySource = new Map();
const slugs = new Set();
for (const page of pages) {
  if (!/^[a-z0-9]+(?:[/-][a-z0-9]+)*$/.test(page.slug)) throw Error(`publish.json：网址不合规 ${page.slug}`);
  if (slugs.has(page.slug)) throw Error(`publish.json：网址重复 ${page.slug}`);
  if (bySource.has(page.source)) throw Error(`publish.json：重复发布 ${page.source}`);
  // 来源只能是 docs/ 下的文档或插件自带的 README
  const allowed = page.source.startsWith('docs/') || /^plugins\/[^/]+\/README\.md$/.test(page.source);
  if (!allowed || !existsSync(path.join(repo, page.source)))
    throw Error(`publish.json：来源不在 docs/ 或插件 README，或文件不存在：${page.source}`);
  const excluded = publish.unpublished.find((item) => page.source.startsWith(item.source));
  if (excluded) throw Error(`publish.json：${page.source} 同时列在 unpublished（${excluded.source}）`);
  slugs.add(page.slug);
  bySource.set(page.source, page);
}
const docFiles = (await listFiles(path.join(repo, 'docs'))).map(toRepoPath).filter((f) => f.endsWith('.md'));
const unclassified = docFiles.filter(
  (f) => !bySource.has(f) && !publish.unpublished.some((item) => f.startsWith(item.source)),
);
if (unclassified.length)
  console.warn(`提示：以下 docs/ 文件未在 publish.json 中分类，默认不发布：\n  ${unclassified.join('\n  ')}`);

// ---- 2. 同步页面 ----
const brokenLinks = [];
const relativeUrl = (fromSlug, toSlug) => '../'.repeat(fromSlug.split('/').length) + toSlug + '/';

function rewriteUrl(raw, page) {
  const bracketed = raw.startsWith('<') && raw.endsWith('>');
  const url = bracketed ? raw.slice(1, -1) : raw;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('#') || url.startsWith('//')) return raw;
  const [target, hash] = url.split('#');
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(page.source), decodeURI(target)));
  const anchor = hash ? '#' + hash : '';
  let result;
  if (bySource.has(resolved)) result = relativeUrl(page.slug, bySource.get(resolved).slug) + anchor;
  else if (!resolved.startsWith('..') && existsSync(path.join(repo, resolved))) {
    const kind = statSync(path.join(repo, resolved)).isDirectory() ? 'tree' : 'blob';
    result = `${repoUrl}/${kind}/${ref}/${encodeURI(resolved)}${anchor}`;
  } else {
    brokenLinks.push(`${page.source}: ${url}`);
    return raw;
  }
  return bracketed ? `<${result}>` : result;
}

function rewriteLinks(markdown, page) {
  let fence = null;
  return markdown
    .split('\n')
    .map((line) => {
      const marker = line.match(/^\s*(`{3,}|~{3,})/);
      if (fence) {
        if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
        return line;
      }
      if (marker) {
        fence = marker[1];
        return line;
      }
      const definition = line.match(/^(\s{0,3}\[[^\]]+\]:\s*)(<[^>]*>|\S+)(.*)$/);
      if (definition) return definition[1] + rewriteUrl(definition[2], page) + definition[3];
      // 行内代码中的内容不是链接，原样保留
      return line
        .split(/(`+[^`]*`+)/)
        .map((part, index) =>
          index % 2
            ? part
            : part.replace(
                /(!?\[(?:[^[\]]|\[[^\]]*\])*\]\()(<[^>]*>|[^\s)]+)((?:\s+"[^"]*")?\))/g,
                (_, before, url, after) => before + rewriteUrl(url, page) + after,
              ),
        )
        .join('');
    })
    .join('\n');
}

const yaml = (value) => JSON.stringify(value);
await rm(synced, { recursive: true, force: true });
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
  const output = path.join(synced, page.source.replace(/^docs\//, ''));
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, frontmatter + '\n' + rewriteLinks(body.trim(), page) + origin);
}
if (brokenLinks.length) throw Error(`docs/ 中有指向不存在文件的链接：\n  ${brokenLinks.join('\n  ')}`);

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
