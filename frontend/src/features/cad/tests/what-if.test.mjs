import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';
import { loadSources } from './load-source.mjs';
const source = await loadSources(['src/features/drawing/what-if.ts']);
after(() => source.close());
const { geometryChanges, replaceSection, PreviewQueue } = await source.import('src/features/drawing/what-if.ts');
const base = { sections: [{ id: 'section/A', placements: [{ cable: 'cable/A', x: .1, z: -.9 }], enclosures: [{ id: 'pipe/A', x: .1, z: -.9 }] }] };
const shifted = x => replaceSection(base, { ...base.sections[0], placements: [{ cable: 'cable/A', x, z: -.9 }] });
test('SI field proposal: 20 mm horizontal shift = 0.02 m, ID escapes and unchanged base', () => {
  const next = shifted(.12);
  assert.deepEqual(geometryChanges(base, next, 'section/A'), [{ path: '/sections/section~1A/placements/cable~1A/x', previousValue: .1, value: .12, unit: 'm' }]);
  assert.equal(base.sections[0].placements[0].x, .1);
  assert.throws(() => geometryChanges(base, shifted(Infinity), 'section/A'), /有限 SI/);
});
test('Serial debounce coalesces drags and rejects a stale result without duplicate requests', async () => {
  const calls = [], states = [], deferred = [];
  const queue = new PreviewQueue(doc => { calls.push(doc); return new Promise(resolve => deferred.push(resolve)); }, (_, doc) => doc.sections[0].placements[0].x, s => states.push(s), 5, 1000);
  try {
    queue.schedule(shifted(.11)); queue.schedule(shifted(.12)); queue.schedule(shifted(.12)); await pause(15);
    assert.equal(calls.length, 1); assert.equal(calls[0].sections[0].placements[0].x, .12);
    queue.schedule(shifted(.13)); queue.schedule(shifted(.14)); await pause(15); assert.equal(calls.length, 1);
    deferred[0]({}); await pause(15); assert.equal(calls.length, 2); assert.ok(!states.some(s => s.status === 'success'));
    deferred[1]({}); await pause(5); assert.equal(states.at(-1).result, .14);
  } finally { queue.dispose(); }
});
test('Network and unsupported-plugin failures keep the draft; explicit retry publishes once', async () => {
  let fail = true; const states = [];
  const queue = new PreviewQueue(async () => { if (fail) throw Error('PREVIEW_NOT_SUPPORTED：有限元不支持快速试算'); return {}; }, () => 'verified', s => states.push(s), 1, 100);
  try { queue.schedule(shifted(.12)); await pause(10); assert.match(states.at(-1).error, /PREVIEW_NOT_SUPPORTED/);
    fail = false; queue.retry(shifted(.12)); await pause(10); assert.equal(states.at(-1).result, 'verified');
  } finally { queue.dispose(); }
});
test('Timed-out and unmounted replies cannot publish results', async () => {
  const states = []; let finish;
  const queue = new PreviewQueue(() => new Promise(resolve => { finish = resolve; }), () => 'late', s => states.push(s), 1, 10);
  queue.schedule(shifted(.11)); await pause(30); assert.match(states.at(-1).error, /超时/);
  queue.dispose(); const count = states.length; finish({}); await pause(5); assert.equal(states.length, count);
});
test('Retrying a hung callback keeps an explicit timeout until the old request finishes', async () => {
  const states = [], finish = [];
  const queue = new PreviewQueue(() => new Promise(resolve => finish.push(resolve)), () => 'checked', s => states.push(s), 1, 10);
  try {
    queue.schedule(shifted(.11)); await pause(25); queue.retry(shifted(.12)); await pause(5);
    assert.equal(finish.length, 1); assert.match(states.at(-1).error, /上一试算超时/);
    finish[0]({}); await pause(5); assert.equal(finish.length, 2); assert.equal(states.at(-1).status, 'pending');
    finish[1]({}); await pause(3); assert.equal(states.at(-1).result, 'checked');
  } finally { queue.dispose(); }
});
