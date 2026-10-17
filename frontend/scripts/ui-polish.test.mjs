import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
async function load(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }, reportDiagnostics: true });
  assert.equal(compiled.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  return import('data:text/javascript;base64,' + Buffer.from(compiled.outputText).toString('base64'));
}
const policy = await load('../src/lib/ui-interactions.ts');
const preferences = await load('../src/lib/preferences.ts');
const base = { key: 'Enter', defaultPrevented: false, composing: false, inputType: 'text', insideForm: false };
test('IME composition and legacy 229 keys are never treated as confirmation', () => {
  assert(policy.composing({ isComposing: true })); assert(policy.composing({ keyCode: 229 }));
  assert(!policy.composing({ keyCode: 13 })); assert(!policy.composing({}));
  assert(!policy.canConfirmDialog({ ...base, composing: true }));
});
test('confirmation respects field-owned Enter and native form submission', () => {
  assert(!policy.canConfirmDialog({ ...base, defaultPrevented: true }));
  assert(!policy.canConfirmDialog({ ...base, insideForm: true }));
  assert(!policy.canConfirmDialog({ ...base, key: 'Escape' }));
});
for (const inputType of ['checkbox', 'radio', 'file', 'range', 'color', 'hidden', 'date', 'button', 'submit', null]) {
  test(`Enter on ${inputType} does not implicitly click the primary dialog action`, () => assert(!policy.canConfirmDialog({ ...base, inputType })));
}
test('ordinary single-line editing preserves explicit Enter confirmation', () => {
  for (const inputType of ['text', 'number', 'search', 'email', 'url', 'tel', 'password']) assert(policy.canConfirmDialog({ ...base, inputType }));
});
test('row navigation is bounded and Home/End retain every original row', () => {
  assert.equal(policy.neighborIndex(0, 30, 'ArrowUp'), 0); assert.equal(policy.neighborIndex(29, 30, 'ArrowDown'), 29);
  assert.equal(policy.neighborIndex(10, 30, 'Home'), 0); assert.equal(policy.neighborIndex(10, 30, 'End'), 29);
  assert.equal(policy.neighborIndex(10, 30, 'ArrowDown'), 11); assert.equal(policy.neighborIndex(10, 30, 'ArrowUp'), 9);
});
test('unknown rows, empty tables and non-navigation keys remain unhandled', () => {
  for (const [index, length, key] of [[-1, 3, 'End'], [0, 0, 'Home'], [4, 3, 'ArrowUp'], [0, 3, 'Enter'], [0, Infinity, 'Home']]) assert.equal(policy.neighborIndex(index, length, key), null);
});
test('nested links, checkbox labels and editable content are excluded from row activation', () => {
  for (const token of ['a[href]', 'button', 'label', 'input', 'select', 'textarea', '[contenteditable]']) assert(policy.interactiveRowSelector.includes(token));
});
function stored(value, action) {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value });
  try { action(); } finally { if (before) Object.defineProperty(globalThis, 'localStorage', before); else delete globalThis.localStorage; }
}
test('explicit route theme wins over the saved preference', () => stored({ getItem: () => '{"theme":"dark"}' }, () => {
  assert.equal(preferences.preferredTheme('light'), 'light'); assert.equal(preferences.preferredTheme('dark'), 'dark');
}));
test('direct links without a theme honor saved preferences', () => stored({ getItem: () => '{"theme":"dark","reducedMotion":true}' }, () => {
  assert.equal(preferences.preferredTheme(undefined), 'dark'); assert.equal(preferences.preferredTheme('invalid'), 'dark');
  assert.equal(preferences.preferences().reducedMotion, true);
}));
test('malformed or inaccessible local storage does not break route rendering', () => {
  for (const getItem of [() => 'invalid', () => 'null', () => { throw Error('denied'); }]) stored({ getItem }, () => assert.deepEqual(preferences.preferences(), { theme: 'light', reducedMotion: false }));
});
test('a failed preference write is reported to the existing settings error handler', () => stored({ setItem: () => { throw Error('denied'); } }, () => {
  assert.throws(() => preferences.savePreferences({ theme: 'dark', reducedMotion: true }), /denied/);
}));
test('critical production route identities remain registered', async () => {
  const source = await readFile(new URL('../src/router.tsx', import.meta.url), 'utf8');
  for (const route of ['/library/documents', '/library/deliveries', '/library/reproductions', '/plugins/$pid', '/settings', '/studies/$sid', '$module/$tab']) assert(source.includes(route), route);
});
