import test from 'node:test';
import assert from 'node:assert/strict';
import { groupInbox } from '../src/lib/inbox-groups.ts';
import { formatObjectVersion } from '../src/lib/format.ts';
import { runOwnerName, runPresentation, scopedRunOrdinals } from '../src/lib/run-presentation.ts';
import { assetCoverage } from '../src/lib/asset-coverage.ts';

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
  const run = { sequence: 4, integrity: 'verified', status: 'succeeded', method: { plugin_id: 'cablesim.simulation', version: '0.4.0', capability: 'transient-temperature' }, headline: '最高导体温度 80 °C · 默认工况', headlines: [{ title: '最高温度', value: 353.15, unit: 'K', display_value: 80, display_unit: '°C' }] };
  assert.equal(runPresentation(run, 4).name, '第 4 次运行 · 暂态温升');
  assert.match(runPresentation(run).method, /0\.4\.0$/);
  assert.equal(runPresentation(run).conclusion, run.headline);
  assert.equal(runPresentation({ ...run, integrity: 'corrupt' }).conclusion, '保存记录校验失败，不能引用结论');
  assert.equal(runPresentation({ ...run, headline: undefined }).conclusion, '');
  assert.equal(runPresentation({ sequence: 1, integrity: 'verified', method: {} }, 1).name, '第 1 次运行 · 任务未记录');
  assert.equal(runPresentation({ ...run, headline: undefined, headlines: [{ title: '温度', value: 353.14, unit: 'K', display_value: 80 }] }).conclusion, '');
  assert.equal(runPresentation({ ...run, method: { ...run.method, capability: 'electrical' } }, 4).name, '第 4 次运行 · 电气参数');
  assert.equal(runPresentation({ ...run, headline: undefined, headlines: [{ title: '可用结论数', value: 0, unit: '1' }, { title: '待补数量', value: 24, unit: '1' }] }).conclusion, '');
});

test('各研究与型号分别编号，已保存任务身份优先，分页顺序不改变编号', () => {
  const rows = [{ id: 'a2', study: 'a', workspace: 'p', sequence: 90 }, { id: 'b', study: 'b', workspace: 'p', sequence: 41 }, { id: 'a1', study: 'a', workspace: 'p', sequence: 4 }, { id: 't2', study: 'short', workspace: 't', sequence: 70 }, { id: 't1', study: 'electrical', workspace: 't', sequence: 50 }];
  assert.deepEqual([...scopedRunOrdinals(rows, new Set(['t']))].sort(), [['a1', 1], ['a2', 2], ['b', 1], ['t1', 1], ['t2', 2]]);
  assert.deepEqual(scopedRunOrdinals(rows, new Set(['t'])), scopedRunOrdinals([...rows].reverse(), new Set(['t'])));
  assert.equal(runPresentation({ integrity: 'verified', task: 'operating', driver: { kind: 'single' }, method: { capability: 'steady-rating' } }, 2).name, '第 2 次运行 · 运行温度');
  assert.equal(runPresentation({ integrity: 'verified', snapshot: { task: 'rating', driver: { kind: 'selection' } }, method: { capability: 'steady-rating' } }, 1).name, '第 1 次运行 · 客户问询');
  assert.equal(runPresentation({ sequence: 93, method: { capability: 'electrical' } }).name, '运行 · 电气参数');
});
test('载流量表按封存工况身份命名，普通或混合批量仍是批量仿真', () => {
  const driver = { kind: 'batch', cases: [{ metadata: { kind: 'type-rating-table' } }, { metadata: { kind: 'type-rating-table' } }] };
  const run = { integrity: 'verified', task: 'rating', driver, method: { capability: 'steady-rating' } };
  assert.equal(runPresentation(run, 3).name, '第 3 次运行 · 载流量表');
  assert.equal(runPresentation({ integrity: 'verified', snapshot: { task: run.task, driver }, method: run.method }, 3).name, '第 3 次运行 · 载流量表');
  for (const cases of [[], [{ metadata: { kind: 'simulation' } }], [...driver.cases, {}]]) assert.equal(runPresentation({ ...run, driver: { ...driver, cases } }, 3).name, '第 3 次运行 · 批量仿真');
  assert.equal(runPresentation({ ...run, driver: { kind: 'single', cases: driver.cases } }, 3).name, '第 3 次运行 · 载流量');
});
test('型号归属已有型号名时不重复拼接，普通模块和其他型号保持身份', () => {
  const name = 'YJV22-8.7/15 3×300';
  assert.equal(runOwnerName(name, name + ' · 载流量表'), name + ' · 载流量表');
  assert.equal(runOwnerName(name, '载流量表'), name + ' · 载流量表');
  assert.equal(runOwnerName(name, '校核 · ' + name), '校核 · ' + name);
  assert.equal(runOwnerName(name, 'YJV22-8.7/15 3×240 · 载流量表'), name + ' · YJV22-8.7/15 3×240 · 载流量表');
  assert.equal(runOwnerName('', '研究 A'), '研究 A');
});
test('物性以登记项计数、去重，零值有效，冲突和未知不冒充完整', () => {
  const source = value => ({ reference: JSON.stringify({ schema: 'cablesim.reference-data/1', ...value }) });
  const release = { parameters: [{ name: 'thermal_resistivity', quantity: { value: 0, unit: 'K.m/W' } }], sources: [source({ property: 'thermal_resistivity', value: 0, unit: 'K.m/W' }), source({ missing: ['density', 'density'], reason: '缺密度' })] };
  assert.deepEqual(assetCoverage(release), { covered: 1, total: 2, missing: [{ property: 'density', reason: '缺密度' }] });
  assert.equal(assetCoverage({}).total, 0);
  assert.equal(assetCoverage({ ...release, sources: [...release.sources, source({ missing: ['thermal_resistivity'] })] }).covered, 0);
  assert.equal(assetCoverage({ parameters: [{ name: 'thickness', quantity: { value: 1, unit: 'm', dimension: 'length' } }] }).total, 0);
});
