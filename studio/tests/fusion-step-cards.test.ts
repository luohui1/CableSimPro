import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SavedRunView } from '../shared/fusion-types.ts';
import { repeatedOpens } from '../ui/fusion/repeated-opens.ts';

// Navigation needs only a completed step and link; saved-run deduplication compares the complete snapshot below.
const part = (id: string, kind: string, href: string, download_url?: string) => ({
  result: { type: 'step', id, status: 'done', card: { kind, href, ...(download_url ? { download_url } : {}) } },
});
const type = 'cablesim:type/type-workspace';
const study = 'cablesim:study/saved-study?workspace=workspace';
const runView: SavedRunView = {
  title: '直埋校核 · 第 19 条记录', tier: 'reference', tier_note: '保存记录未声明工程可信分档，按参考结果展示。',
  method: 'IEC 60287 载流量 1.2.0', current: '723.7', basis: '全回路共同能力', freshness: 'current',
  limiting: { name: '回路 1 · A 相', conductor: 68.5, limit: 90, ambient: 25, load: '600 A', margin: '123.7 A' },
};
const run = (id: string, view: Partial<SavedRunView> = {}, runId = 'run-1') => ({
  result: { type: 'step', id, status: 'done', card: { kind: 'saved_run', href: `${study}&run=${runId}`, view: { ...runView, ...view } } },
});

test('a type read cannot hide the specification that was subsequently generated for the same type', () => {
  const repeated = repeatedOpens([
    part('read-type', 'saved_type', type),
    part('specification', 'saved_file', type, '/api/agent/files/specification-1'),
  ]);
  assert.deepEqual([...repeated], []);
});

test('two saved files for one type retain their distinct download identities and both cards', () => {
  const repeated = repeatedOpens([
    part('first-specification', 'saved_file', type, '/api/agent/files/specification-1'),
    part('second-specification', 'saved_file', type, '/api/agent/files/specification-2'),
  ]);
  assert.deepEqual([...repeated], []);
});

test('saved type, table and file cards remain independent even when their snapshots and workbench links match', () => {
  const repeated = repeatedOpens([
    part('first-type-read', 'saved_type', type),
    part('next-type-read', 'saved_type', type),
    part('first-table-read', 'saved_rating_table', study + '&run=table-1'),
    part('next-table-read', 'saved_rating_table', study + '&run=table-1'),
    part('first-file', 'saved_file', type, '/api/agent/files/specification-1'),
    part('same-file', 'saved_file', type, '/api/agent/files/specification-1'),
  ]);
  assert.deepEqual([...repeated], []);
});

test('an approval receipt and identical result read hide only the later card, retaining both steps and the proposal', () => {
  const approval = run('approved-run');
  const parts = [
    { result: { ...approval.result, proposal: { id: 'proposal-1', status: 'accepted' } } },
    run('read-run'),
    part('html-report', 'saved_file', study + '&run=run-1', '/api/agent/files/report.html'),
    part('pdf-report', 'saved_file', study + '&run=run-1', '/api/agent/files/report.pdf'),
  ];
  const original = structuredClone(parts);
  assert.deepEqual([...repeatedOpens(parts)], ['read-run']);
  assert.deepEqual(parts, original, 'projection must leave the full original steps, cards and accepted proposal intact');
});

test('different saved runs remain distinct even when every displayed value is the same', () => {
  assert.deepEqual([...repeatedOpens([run('first', {}, 'run-1'), run('second', {}, 'run-2')])], []);
});

test('changed freshness or any saved-run display fact keeps the later snapshot visible', () => {
  const changes: Partial<SavedRunView>[] = [
    { freshness: 'historical' }, { freshness: 'unknown' },
    { current: '701.4' }, { method: 'IEC 60287 载流量 1.3.0' },
    { basis: '单回路能力' }, { tier_note: '该记录的适用限制已有补充说明。' },
    { limiting: { ...runView.limiting, margin: '101.4 A' } },
  ];
  for (const change of changes) {
    assert.deepEqual([...repeatedOpens([run('first'), run('updated', change)])], [], JSON.stringify(change));
  }
});

test('identical snapshots in separate assistant messages remain visible in each message', () => {
  assert.deepEqual([...repeatedOpens([run('message-1-run')])], []);
  assert.deepEqual([...repeatedOpens([run('message-2-run')])], []);
});

test('repeated navigation links still collapse after the same address has been offered', () => {
  const repeated = repeatedOpens([
    part('first-open', 'open', type), part('repeat-open', 'open', type),
    part('run-card', 'saved_run', study + '&run=run-1'), part('same-run-open', 'open', study + '&run=run-1'),
  ]);
  assert.deepEqual([...repeated], ['repeat-open', 'same-run-open']);
});

test('a saved run card replaces a generic study link but preserves a link to a different saved run', () => {
  const repeated = repeatedOpens([
    part('generic-study-open', 'open', study),
    part('complex-run-open', 'open', study + '&run=older-complex-run'),
    part('simple-run-card', 'saved_run', study + '&run=current-simple-run'),
  ]);
  assert.deepEqual([...repeated], ['generic-study-open']);
});
