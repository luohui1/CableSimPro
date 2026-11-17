import assert from 'node:assert/strict';
import { test } from 'node:test';
import { repeatedOpens } from '../ui/fusion/repeated-opens.ts';

// The projection only needs the completed step identity, card kind and workbench link. Artifact URLs remain separate.
const part = (id: string, kind: string, href: string, download_url?: string) => ({
  result: { type: 'step', id, status: 'done', card: { kind, href, ...(download_url ? { download_url } : {}) } },
});
const type = 'cablesim:type/type-workspace';
const study = 'cablesim:study/saved-study?workspace=workspace';

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

test('saved type facts and saved run results remain visible even when a prior card opened the same object', () => {
  const repeated = repeatedOpens([
    part('first-type-read', 'saved_type', type),
    part('next-type-read', 'saved_type', type),
    part('first-run-read', 'saved_run', study + '&run=run-1'),
    part('next-run-read', 'saved_run', study + '&run=run-1'),
  ]);
  assert.deepEqual([...repeated], []);
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
