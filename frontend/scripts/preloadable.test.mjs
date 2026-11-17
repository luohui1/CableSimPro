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

test('渲染已采用的拒绝原样抛给边界，重复渲染不循环加载', async () => {
  const failure = Error('visible import fault');
  let reject, loads = 0;
  const pending = new Promise((_, fail) => { reject = fail; });
  const view = preloadable(() => { loads++; return pending; });
  assert.match(render(view.Component), /<span>WAIT<\/span>/);
  const adopted = view.preload();
  reject(failure);
  await assert.rejects(adopted, error => error === failure);
  for (let count = 0; count < 3; count++) {
    assert.equal(view.preload(), adopted);
    assert.throws(() => renderWithoutBoundary(view.Component), error => error === failure);
  }
  assert.equal(loads, 1);
});

test('同步加载异常成为真实拒绝，采用后不被吞掉或自动重试', async () => {
  const failure = Error('synchronous import fault');
  let loads = 0, pending;
  const view = preloadable(() => { loads++; throw failure; });
  assert.doesNotThrow(() => { pending = view.preload(); });
  assert.match(render(view.Component), /<span>WAIT<\/span>/);
  await assert.rejects(pending, error => error === failure);
  assert.throws(() => renderWithoutBoundary(view.Component), error => error === failure);
  assert.equal(view.preload(), pending);
  assert.equal(loads, 1);
});
