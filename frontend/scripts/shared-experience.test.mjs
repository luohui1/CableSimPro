import test from 'node:test';
import assert from 'node:assert/strict';
import { groupInbox } from '../src/lib/inbox-groups.ts';
import { formatObjectVersion } from '../src/lib/format.ts';
import { runPresentation, indexedRunName } from '../src/lib/run-presentation.ts';

const item = (id, patch = {}) => ({ category: 'stale', origin: 'study', title: '研究 ' + id, reason: '方法 1.1.1 → 1.1.2', object: { kind: 'study', id, name: '研究 ' + id, status: { code: 'outdated', label: '已过期' } }, ...patch });
test('六条同源方法更新合为一组，异源、异原因和未知原因不误合并', () => {
  const original = Array.from({ length: 6 }, (_, i) => item(String(i)));
  const groups = groupInbox(original);
  assert.equal(groups.length, 1); assert.equal(groups[0].title, '方法更新 · 6 项结果需重算');
  assert.deepEqual(groups[0].items, original);
  assert.equal(groupInbox([...original, item('7', { reason: '输入改变' }), item('8', { origin: 'asset' })]).length, 3);
  assert.equal(groupInbox([item('a', { reason: '' }), item('b', { reason: '' })]).length, 2);
  assert.equal(groupInbox([item('a', { object: { ...item('a').object, source: { kind: 'document', label: '厂家 A' } } }), item('b', { object: { ...item('b').object, source: { kind: 'document', label: '厂家 B' } } })]).length, 2);
});
test('标准年度版本与插件版本分别呈现，真实修订号保留', () => {
  assert.equal(formatObjectVersion('2024.0.0', true), '2024 版');
  assert.equal(formatObjectVersion('2024', true), '2024 版');
  assert.equal(formatObjectVersion('2024.1.0', true), '2024.1.0');
  assert.equal(formatObjectVersion('2024.0.0'), '2024.0.0');
});
test('运行摘要来自保存方法与已验证量值，不用当前方法、不编造结论', () => {
  const run = { sequence: 4, integrity: 'verified', status: 'succeeded', method: { plugin_id: 'cablesim.simulation', version: '0.4.0', capability: 'transient-temperature' }, headlines: [{ title: '最高温度', value: 353.15, unit: 'K', display_value: 80, display_unit: '°C' }] };
  assert.equal(runPresentation(run).name, '第 4 次运行 · 暂态温升');
  assert.match(runPresentation(run).method, /0\.4\.0$/);
  assert.equal(runPresentation(run).conclusion, '最高温度 80.00 °C');
  assert.equal(runPresentation({ ...run, integrity: 'corrupt' }).conclusion, '保存记录校验失败，不能引用结论');
  assert.equal(runPresentation({ ...run, headlines: [] }).conclusion, '摘要未提供 · 查看保存运行');
  assert.equal(runPresentation({ sequence: 1, integrity: 'verified', method: {} }).name, '第 1 次运行 · 任务未记录');
  assert.equal(runPresentation({ ...run, headlines: [{ title: '温度', value: 353.14, unit: 'K', display_value: 80 }] }).conclusion, '温度 353.1 K');
  assert.equal(runPresentation({ ...run, method: { ...run.method, capability: 'electrical' } }).name, '第 4 次运行 · 电气参数');
  assert.equal(runPresentation({ ...run, headlines: [{ title: '可用结论数', value: 0, unit: '1' }, { title: '待补数量', value: 24, unit: '1' }] }).conclusion, '可用结论数 0；待补数量 24');
  assert.equal(indexedRunName('电气参数 · 11'), '第 11 次运行');
  assert.equal(indexedRunName('批量结果'), '保存运行');
});
