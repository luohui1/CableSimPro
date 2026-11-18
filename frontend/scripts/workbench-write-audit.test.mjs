import test from 'node:test';
import assert from 'node:assert/strict';
import { isReadOnlyStandardsLookup, isReadOnlyFormalDelivery } from './verify-workbench-support.mjs';

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

test('正式交付仅两个明确的只读 POST 路由归为文件读取，其他写入仍保留', () => {
  for (const path of ['/api/formal-deliveries/preview', '/api/formal-deliveries/export'])
    assert.equal(isReadOnlyFormalDelivery('POST', path), true, path);
  for (const [method, path] of [
    ['DELETE', '/api/formal-deliveries/export'],
    ['POST', '/api/formal-deliveries/save'],
    ['POST', '/api/formal-deliveries/batch/export'],
    ['POST', '/api/workspaces/wid/delivery-jobs'],
    ['POST', '/api/workspaces/wid/studies/sid/runs'],
  ]) assert.equal(isReadOnlyFormalDelivery(method, path), false, method + ' ' + path);
});
