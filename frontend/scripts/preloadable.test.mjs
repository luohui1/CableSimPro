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

// Load the actual helper with the installed React runtime. Browser draft/DOM
// retention remains covered by the real workbench research walkthrough.
const require = createRequire(import.meta.url);
const directory = await mkdtemp(path.join(tmpdir(), 'cablesim-preloadable-'));
let preloadable;
try {
  const source = await readFile(new URL('../src/lib/preloadable.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
  } }).outputText.replace(/from (["'])(react)\1/g,
    (_, quote, name) => 'from ' + JSON.stringify(pathToFileURL(require.resolve(name)).href));
  const filename = path.join(directory, 'preloadable.mjs');
  await writeFile(filename, code);
  ({ preloadable } = await import(pathToFileURL(filename).href));
} finally { await rm(directory, { recursive: true, force: true }); }

const render = (Component, name = 'Saved inputs') => renderToString(createElement(Suspense,
  { fallback: createElement('span', null, 'WAIT') }, createElement(Component, { name })));
const renderWithoutBoundary = Component => renderToString(createElement(Component, { name: 'Saved inputs' }));
function Page({ name }) { return createElement('p', null, name); }

test('已预载重组件首次显示正文，后续渲染不重新等待或读取模块', async () => {
  let loads = 0;
  const view = preloadable(async () => { loads++; return { default: Page }; });
  const first = view.preload();
  assert.equal(view.preload(), first);
  await first;
  const initial = render(view.Component), next = render(view.Component, 'Updated inputs');
  assert.match(initial, /<p>Saved inputs<\/p>/);
  assert.match(next, /<p>Updated inputs<\/p>/);
  assert.doesNotMatch(initial + next, /<span>WAIT<\/span>/);
  assert.equal(loads, 1);
});

test('冷加载先显示真实等待，模块到达后显示正文', async () => {
  let resolve, loads = 0;
  const pending = new Promise(done => { resolve = done; });
  const view = preloadable(() => { loads++; return pending; });
  assert.match(render(view.Component), /<span>WAIT<\/span>/);
  const adopted = view.preload();
  resolve({ default: Page });
  await adopted;
  const html = render(view.Component);
  assert.match(html, /<p>Saved inputs<\/p>/);
  assert.doesNotMatch(html, /<span>WAIT<\/span>/);
  assert.equal(view.preload(), adopted);
  assert.equal(loads, 1);
});

test('未采用的空闲预载拒绝后，主动预载或首次打开均可重试', async () => {
  for (const recovery of ['preload', 'render']) {
    const failure = Error('idle import fault');
    let loads = 0;
    const view = preloadable(() => ++loads === 1 ? Promise.reject(failure) : Promise.resolve({ default: Page }));
    const failed = view.preload();
    await assert.rejects(failed, error => error === failure);
    if (recovery === 'render') assert.match(render(view.Component), /<span>WAIT<\/span>/);
    const retried = view.preload();
    assert.notEqual(retried, failed);
    await retried;
    const html = render(view.Component);
    assert.match(html, /<p>Saved inputs<\/p>/);
    assert.doesNotMatch(html, /<span>WAIT<\/span>/);
    assert.equal(loads, 2);
  }
});

test('已采用的拒绝原样抛出，重复渲染不重试，显式预载才能恢复', async () => {
  const failure = Error('visible import fault');
  let reject, loads = 0;
  const pending = new Promise((_, fail) => { reject = fail; });
  const view = preloadable(() => ++loads === 1 ? pending : Promise.resolve({ default: Page }));
  assert.match(render(view.Component), /<span>WAIT<\/span>/);
  const adopted = view.preload();
  reject(failure);
  await assert.rejects(adopted, error => error === failure);
  for (let count = 0; count < 3; count++) {
    assert.throws(() => renderWithoutBoundary(view.Component), error => error === failure);
  }
  assert.equal(loads, 1);
  const retried = view.preload();
  assert.notEqual(retried, adopted);
  assert.equal(view.preload(), retried);
  await retried;
  const html = render(view.Component);
  assert.match(html, /<p>Saved inputs<\/p>/);
  assert.doesNotMatch(html, /<span>WAIT<\/span>/);
  assert.equal(loads, 2);
});

test('同步加载异常成为真实拒绝，采用后不被吞掉或自动重试', async () => {
  const failure = Error('synchronous import fault');
  let loads = 0, pending;
  const view = preloadable(() => { loads++; throw failure; });
  assert.doesNotThrow(() => { pending = view.preload(); });
  assert.match(render(view.Component), /<span>WAIT<\/span>/);
  await assert.rejects(pending, error => error === failure);
  assert.throws(() => renderWithoutBoundary(view.Component), error => error === failure);
  assert.throws(() => renderWithoutBoundary(view.Component), error => error === failure);
  assert.equal(loads, 1);
});

// Exercise the actual type registry and dispatcher, with small leaf views in
// place of network-dependent engineering pages. The loading boundary and React
// promise handling remain production code, not a parallel test implementation.
async function typeModuleFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'cablesim-type-modules-'));
  const leaves = {
    requirements: 'TypeRequirements', 'standard-check': 'TypeStandardCheck',
    analysis: 'TypeAnalysis', 'rating-table': 'TypeRatingTable',
    comparison: 'TypeComparison', specification: 'TypeSpecification',
  };
  const imports = {
    react: pathToFileURL(require.resolve('react')).href,
    'react/jsx-runtime': pathToFileURL(require.resolve('react/jsx-runtime')).href,
    '@/lib/preloadable': './preloadable.mjs', '@/components/states': './states.mjs',
    './module-loader': './module-loader.mjs',
    ...Object.fromEntries(Object.keys(leaves).map(name => ['./' + name, './' + name + '.mjs'])),
  };
  try {
    for (const [source, target] of [
      ['../src/lib/preloadable.ts', 'preloadable.mjs'],
      ['../src/features/type/module-loader.ts', 'module-loader.mjs'],
      ['../src/features/type/module-page.tsx', 'module-page.mjs'],
    ]) {
      const code = ts.transpileModule(await readFile(new URL(source, import.meta.url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
      }).outputText.replace(/(['"])([^'"\n]+)\1/g, (whole, quote, name) => imports[name] ? JSON.stringify(imports[name]) : whole);
      await writeFile(path.join(directory, target), code);
    }
    await writeFile(path.join(directory, 'loaded.mjs'), 'export const loaded = [];');
    await writeFile(path.join(directory, 'states.mjs'), `import { createElement } from ${JSON.stringify(imports.react)};
      export function LoadingState({ title }) { return createElement('p', { role: 'status' }, title); }
      export function ErrorState({ title }) { return createElement('p', { role: 'alert' }, title); }`);
    for (const [name, exported] of Object.entries(leaves)) await writeFile(path.join(directory, name + '.mjs'),
      `import { createElement } from ${JSON.stringify(imports.react)};
       import { loaded } from './loaded.mjs'; loaded.push(${JSON.stringify(name)});
       export function ${exported}({ tab, module }) { return createElement('p', null, [${JSON.stringify(name)}, module, tab].filter(Boolean).join(':')); }`);
    const registry = await import(pathToFileURL(path.join(directory, 'module-loader.mjs')).href);
    const { TypeModulePage } = await import(pathToFileURL(path.join(directory, 'module-page.mjs')).href);
    const { loaded } = await import(pathToFileURL(path.join(directory, 'loaded.mjs')).href);
    return { ...registry, loaded, render: (module, tab) => renderToString(createElement(TypeModulePage, { module, tab })),
      close: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
}

test('型号路由预载后首次渲染直接显示所选模块，其他模块不被提前下载', async () => {
  const fixture = await typeModuleFixture();
  try {
    assert.deepEqual(fixture.loaded, [], '加载调度器不能下载所有业务视图');
    const promise = fixture.preloadTypeModule('specification');
    assert.equal(fixture.preloadTypeModule('specification'), promise);
    await promise;
    assert.deepEqual(fixture.loaded, ['specification']);
    assert.match(fixture.render('specification', 'content'), /specification:content/);
    assert.doesNotMatch(fixture.render('specification', 'review'), /正在加载视图/);
    assert.match(fixture.render('specification', 'review'), /specification:review/);
    assert.equal(fixture.typeModuleViews.specification.preload(), promise, '渲染与路由继续持有同一加载结果');
    assert.deepEqual(fixture.loaded, ['specification']);
    for (const module of ['requirements', 'standard-check', 'electrical', 'short-circuit', 'rating-table', 'comparison']) {
      await fixture.preloadTypeModule(module);
      const html = fixture.render(module, 'results');
      assert.match(html, module === 'standard-check' ? /standard-check/ : /results/);
      assert.doesNotMatch(html, /正在加载视图/);
    }
    assert.equal(fixture.loaded.filter(name => name === 'analysis').length, 1, '两类电气计算共享已载入视图');
    assert.equal(new Set(fixture.loaded).size, 6);
  } finally { await fixture.close(); }
});

test('未预载型号模块保留读取状态，加载结束后真实正文可用且未知模块明确失败', async () => {
  const fixture = await typeModuleFixture();
  try {
    assert.match(fixture.render('specification', 'content'), /正在加载视图/);
    await fixture.preloadTypeModule('specification');
    assert.match(fixture.render('specification', 'content'), /specification:content/);
    assert.doesNotMatch(fixture.render('specification', 'content'), /正在加载视图/);
    assert.equal(fixture.preloadTypeModule('missing'), undefined);
    assert.match(fixture.render('missing', 'content'), /此型号模块不可用/);
  } finally { await fixture.close(); }
});
