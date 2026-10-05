import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const directory = mkdtempSync(path.join(tmpdir(), 'cablesim-workbench-'));
after(() => rmSync(directory, { recursive: true, force: true }));
const source = readFileSync(new URL('../src/lib/workbench-navigation.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
});
assert.equal(output.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error).length, 0);
const compiled = path.join(directory, 'navigation.mjs');
writeFileSync(compiled, output.outputText);
const { WORKBENCH_NAVIGATION: entries, filterNavigation, isNavigationShortcut,
  nextNavigationIndex, readSidebarPreference, saveSidebarPreference,
  SIDEBAR_PREFERENCE_KEY } = await import(pathToFileURL(compiled).href);

const ids = (query) => filterNavigation(query).map((item) => item.id);
test('navigation contains exactly the six existing read/navigation destinations', () => {
  assert.deepEqual(entries.map((item) => [item.label, item.to]), [
    ['首页', '/'], ['型号', '/types'], ['研究', '/studies'],
    ['库', '/library'], ['插件', '/plugins'], ['设置', '/settings'],
  ]);
  assert.equal(new Set(entries.map((item) => item.id)).size, 6);
});
test('empty query preserves the global navigation order', () => {
  assert.deepEqual(ids(' \n\t'), entries.map((item) => item.id));
});
test('exact Chinese label ranks before a description mention', () => {
  assert.equal(ids('型号')[0], 'types');
  assert.equal(ids('研究')[0], 'studies');
  assert.equal(ids('库')[0], 'library');
});
test('English matching is case insensitive', () => assert.deepEqual(ids('MODEL'), ['types']));
test('full-width Latin text is normalized', () => assert.deepEqual(ids('ｍｏｄｅｌ'), ['types']));
test('all search terms must match', () => {
  assert.deepEqual(ids('model 结构'), ['types']);
  assert.deepEqual(ids('model settings'), []);
});
test('unmatched queries do not manufacture actions', () => assert.deepEqual(ids('删除全部工程'), []));
test('filtering never reorders the global navigation registry', () => {
  const before = entries.map((item) => item.id);
  filterNavigation('研究');
  assert.deepEqual(entries.map((item) => item.id), before);
});
test('Ctrl+K and Meta+K open navigation', () => {
  assert.equal(isNavigationShortcut({ key: 'k', ctrlKey: true }), true);
  assert.equal(isNavigationShortcut({ key: 'K', metaKey: true }), true);
});
test('ordinary typing is not intercepted', () => {
  assert.equal(isNavigationShortcut({ key: 'k' }), false);
  assert.equal(isNavigationShortcut({ key: 's', ctrlKey: true }), false);
});
test('IME composition and legacy IME key code are respected', () => {
  assert.equal(isNavigationShortcut({ key: 'k', ctrlKey: true, isComposing: true }), false);
  assert.equal(isNavigationShortcut({ key: 'k', ctrlKey: true, keyCode: 229 }), false);
});
test('modified, repeated, and already-handled shortcuts are ignored', () => {
  for (const key of ['altKey', 'shiftKey', 'repeat', 'defaultPrevented']) {
    assert.equal(isNavigationShortcut({ key: 'k', ctrlKey: true, [key]: true }), false);
  }
});
test('arrow navigation wraps at each end', () => {
  assert.equal(nextNavigationIndex(5, 1, 6), 0);
  assert.equal(nextNavigationIndex(0, -1, 6), 5);
  assert.equal(nextNavigationIndex(2, 1, 6), 3);
});
test('search input enters first or last available result', () => {
  assert.equal(nextNavigationIndex(-1, 1, 6), 0);
  assert.equal(nextNavigationIndex(-1, -1, 6), 5);
  assert.equal(nextNavigationIndex(8, 1, 6), 0);
});
test('empty results have no focus target', () => assert.equal(nextNavigationIndex(-1, 1, 0), -1));
test('sidebar preference is false for missing or malformed storage', () => {
  assert.equal(readSidebarPreference(), false);
  for (const value of [null, 'false', 'broken', '1']) {
    assert.equal(readSidebarPreference({ getItem: () => value }), false);
  }
  assert.equal(readSidebarPreference({ getItem: () => 'true' }), true);
});
test('denied storage cannot break the workbench', () => {
  const storage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(readSidebarPreference(storage), false);
  assert.equal(saveSidebarPreference(storage, true), false);
  assert.equal(saveSidebarPreference(undefined, true), false);
});
test('only a UI preference key is persisted, never engineering data', () => {
  const writes = [];
  assert.equal(saveSidebarPreference({ setItem: (...args) => writes.push(args) }, true), true);
  assert.deepEqual(writes, [[SIDEBAR_PREFERENCE_KEY, 'true']]);
});
