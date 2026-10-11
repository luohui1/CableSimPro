import test from 'node:test';
import assert from 'node:assert/strict';
import { solverLocation, savedSolverLocation } from '../src/lib/solver-location.ts';
import { taskName, readableRunName, statusLabel } from '../src/lib/status-vocabulary.ts';
import { formatDateTime } from '../src/lib/format.ts';
import { internalTokens } from './visible-names.mjs';

const profile = { configured: true, status: 'configured', remote_plugins: [], remote_capabilities: {} };
test('能力声明与路由的完整判定表，缺字段兼容旧插件', () => {
  for (const solver of [undefined, 'local', 'slurm', 'either']) for (const selected of [false, true]) for (const configured of [false, true]) {
    const result = solverLocation('p', { id: 'c', solver }, { ...profile, configured, remote_capabilities: selected ? { p: ['c'] } : {} });
    const remote = solver === 'slurm' || solver === 'either' && selected;
    assert.equal(result.location, remote ? 'slurm' : 'local');
    assert.equal(result.configured, !remote || configured && selected);
    assert.equal(result.conflict, (solver === undefined || solver === 'local') && selected);
  }
  assert.equal(solverLocation('p', { id: 'c', solver: 'either' }, { ...profile, remote_plugins: ['p'] }).location, 'slurm');
});
test('保存运行从真实环境读取，缺证据不能猜成本机', () => {
  assert.equal(savedSolverLocation({ output: { environment: { remote_execution: { backend: 'slurm' } } } }), 'slurm');
  assert.equal(savedSolverLocation({ output: { environment: { python: '3.11', platform: 'Windows' } } }), 'local');
  assert.equal(savedSolverLocation({ method: { plugin_id: 'cablesim.simulation' } }), 'unknown');
  assert.equal(savedSolverLocation({ output: { environment: {} } }), 'unknown');
});
test('任务短名、状态词和运行名称兼容旧保存名称', () => {
  assert.equal(taskName({ task: 'target', driver: { kind: 'selection' } }), '客户问询');
  assert.equal(taskName({ task: 'operating', driver: { kind: 'single' } }), '运行温度');
  assert.equal(taskName({ method: { capability: 'electrothermal-steady' } }), '电热耦合');
  assert.equal(readableRunName('保存研究 · 运行 4', '城北供电'), '城北供电 · 第 4 次运行');
  assert.equal(statusLabel('outdated', '结果已过期'), '已过期');
  assert.equal(statusLabel('unknown-extension', '扩展状态'), '扩展状态');
});
test('统一日期含年份与分钟，缺项与非法日期保持缺项', () => {
  const local = new Date(2026, 9, 10, 8, 5);
  assert.equal(formatDateTime(local.toISOString()), '2026-10-10 08:05');
  for (const value of [undefined, null, '', 'broken']) assert.equal(formatDateTime(value), '—');
});
test('型号代号保留多段合法前缀，内部标识仍会被拦截', () => {
  assert.deepEqual(internalTokens('ZC-YJLW03-Z-64/110'), []);
  assert.deepEqual(internalTokens('YJV-0.6/1'), []);
  assert.deepEqual(internalTokens('cablesim.simulation'), ['cablesim.simulation']);
  assert.deepEqual(internalTokens('thermal_field'), ['thermal_field']);
});
