import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createElement, Suspense } from 'react';
import { renderToString } from 'react-dom/server';
import ts from 'typescript';

// Exercise the real route loader with React, independently of the application's
// icon/style imports. These two presentation stubs do not replace the loader,
// Promise, Suspense or error classification being tested. Draft retention is
// separately exercised by the real workbench research walkthrough.
const require = createRequire(import.meta.url);
const directory = await mkdtemp(path.join(tmpdir(), 'cablesim-route-'));
let lazyWorkbenchRoute;
try {
  const source = await readFile(new URL('../src/lib/lazy-workbench-route.tsx', import.meta.url), 'utf8');
  let code = ts.transpileModule(source, { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  code = code.replace(/from (["'])(react(?:\/jsx-runtime)?)\1/g,
    (_, quote, name) => 'from ' + JSON.stringify(pathToFileURL(require.resolve(name)).href))
    .replace(/import \{ ErrorState \} from ["']@\/components\/states["'];/,
      'const ErrorState=({title})=>createElement("strong",null,title);')
    .replace(/import \{ Button \} from ["']@\/components\/ui\/button["'];/,
      'const Button=()=>null;');
  const filename = path.join(directory, 'route.mjs');
  await writeFile(filename, code);
  ({ lazyWorkbenchRoute } = await import(pathToFileURL(filename).href));
} finally { await rm(directory, { recursive: true, force: true }); }

const render = (Route, name = 'Saved inputs') => renderToString(createElement(Suspense,
  { fallback: createElement('span', null, 'WAIT') }, createElement(Route, { name })));
function Page({ name }) { return createElement('p', null, name); }

test('已预载页面首次渲染即显示正文，重复预载只读取一次模块', async () => {
  let loads = 0;
  const Route = lazyWorkbenchRoute(async () => { loads++; return { Page }; }, 'Page');
  const first = Route.preload();
  assert.equal(Route.preload(), first);
  await first;
  const html = render(Route), next = render(Route, 'Same page');
  assert.match(html, /<p>Saved inputs<\/p>/);
  assert.doesNotMatch(html, /<span>WAIT<\/span>/);
  assert.match(next, /<p>Same page<\/p>/);
  assert.doesNotMatch(next, /<span>WAIT<\/span>/);
  assert.equal(loads, 1);
});

test('未加载页面保留Suspense等待，模块到达后显示真实正文', async () => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const Route = lazyWorkbenchRoute(() => pending, 'Page');
  assert.match(render(Route), /<span>WAIT<\/span>/);
  resolve({ Page });
  await Route.preload();
  assert.match(render(Route), /<p>Saved inputs<\/p>/);
});

test('模块读取失败与无效导出保留明确的页面恢复状态', async () => {
  let loads = 0;
  const Failed = lazyWorkbenchRoute(() => { loads++; throw Error('import fault'); }, 'Page');
  await Failed.preload();
  assert.match(render(Failed), /页面暂时无法打开/);
  assert.match(render(Failed), /页面暂时无法打开/);
  assert.equal(loads, 1);
  const Invalid = lazyWorkbenchRoute(async () => ({ Page: 42 }), 'Page');
  await Invalid.preload();
  assert.match(render(Invalid), /页面暂时无法打开/);
});

test('页面正文渲染错误不会被伪装成模块下载错误', async () => {
  const Route = lazyWorkbenchRoute(async () => ({ Page() { throw Error('render fault'); } }), 'Page');
  await Route.preload();
  const html = render(Route);
  assert.match(html, /render fault/);
  assert.doesNotMatch(html, /页面暂时无法打开/);
});
