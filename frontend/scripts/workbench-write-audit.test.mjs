import test from 'node:test';
import assert from 'node:assert/strict';
import { isReadOnlyStandardsLookup } from './verify-workbench-support.mjs';

test('只读标准依据 POST 记录为查询，不会伪造工程写入', () => {
  assert.equal(isReadOnlyStandardsLookup('POST', '/api/plugin-queries/cablesim.standards-basis/lookup'), true);
});
test('其他所有 POST、PUT、DELETE 和不同方法仍视为写入', () => {
  for (const [method, path] of [
    ['POST', '/api/plugin-queries/cablesim.iec60287/lookup'],
    ['POST', '/api/plugin-queries/cablesim.standards-basis/save'],
    ['POST', '/api/workspaces/wid/studies/sid/runs'],
    ['PUT', '/api/workspaces/wid/domain'],
    ['DELETE', '/api/workspaces/wid'],
    ['PUT', '/api/plugin-queries/cablesim.standards-basis/lookup'],
  ]) assert.equal(isReadOnlyStandardsLookup(method, path), false, method + ' ' + path);
});
