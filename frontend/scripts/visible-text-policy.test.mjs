import test from 'node:test';
import assert from 'node:assert/strict';
import { identifyText, exceptionFor, readOnlyPost } from './visible-text-policy.mjs';
import { inspectVisibleNames } from './visible-names.mjs';

test('文字巡检按类别捕获内部标识，长摘要不吞 UUID、路径不重复报键名', () => {
  const text = '11111111-1111-4111-8111-111111111111 · aabbccddeeff00112233 · /parameters/values/conductor_form · input_schema · not_covered · verified · slurm · steady-rating · 2024.0.0';
  assert.deepEqual(identifyText(text).map(item => item.category), ['uuid', 'hash', 'pointer', 'snake', 'enum', 'enum', 'enum', 'enum', 'edition']);
  assert.equal(identifyText('IEC 60287 · GB/T 3956 · 2024 版 · 插件 1.2.3 · 0.2 K·m/W · 300 mm²').length, 0);
  assert.equal(identifyText('1.119 A/km · 38.930 W/km').length, 0);
  assert.equal(identifyText('0.12345678901234567 Ω/m').length, 0);
  assert.deepEqual(identifyText('2024.1.0').map(item => item.category), ['edition']);
});

test('只放行已核对的标准查询与几何显示预览，不放行求解、保存、模型或批准', () => {
  assert.ok(readOnlyPost('/api/plugin-queries/cablesim.standards-basis/lookup'));
  assert.ok(readOnlyPost('/api/workspaces/11111111-1111-4111-8111-111111111111/geometry-preview'));
  for (const path of ['/api/plugin-queries/cablesim.simulation/run', '/api/workspaces/11111111-1111-4111-8111-111111111111/studies/s/preview', '/api/agent/tasks', '/api/agent/approvals', '/api/workspaces/11111111-1111-4111-8111-111111111111/domain']) assert.equal(readOnlyPost(path), null);
});
test('白名单有明确层级理由，首层 UUID 不因原件文件名被豁免', () => {
  assert.equal(exceptionFor({ layer: 'ordinary', category: 'uuid', text: '11111111-1111-4111-8111-111111111111.pdf' }), null);
  assert.equal(exceptionFor({ layer: 'ordinary', category: 'snake', text: 'manufacturer_sample.pdf' }).id, 'original-filename');
  assert.ok(exceptionFor({ layer: 'hover', category: 'uuid', text: '标识' }).reason);
  assert.equal(exceptionFor({ layer: 'ordinary', category: 'enum', text: 'slurm' }), null);
  assert.equal(exceptionFor({ layer: 'ordinary', category: 'internal', token: 'I2/I1' }).id, 'mathematical-notation');
  assert.equal(exceptionFor({ layer: 'ordinary', category: 'internal', token: 'modules/values' }), null);
  assert.equal(exceptionFor({ layer: 'ordinary', category: 'enum', token: 'current', text: 'R1=R2=1mm,d=2.5mm,sigma=55MS/m,f=40kHz. Unit RMS current normalization.' }).id, 'source-terminology');
  assert.equal(exceptionFor({ layer: 'ordinary', category: 'enum', token: 'current', text: 'current' }), null);
});

test('布局与文字巡检保留真实附录和算例引用且记录豁免理由', async () => {
  const citations = [
    ['GB/T 12706.2—2020 · 14.3：依据已核验；此公式尚未绑定完整附录 A/B 计算链，本项保留未覆盖。', 'standard-annex'],
    ['未覆盖\n依据已核验；此公式尚未绑定完整附录 A/B 计算链，本项保留未覆盖。', 'standard-annex'],
    ['成缆节距2.152m与钢带相对磁导率300分别参考TB880 Case2/10，非本型号实测。', 'tb880-examples'],
    ['TB 880 Case2/10；TB880 Case2/10。', 'tb880-examples'],
  ];
  for (const [text, id] of citations) {
    const matches = identifyText(text);
    assert.equal(matches.length, 1, '保留匹配以写入文字巡检允许项');
    assert.equal(exceptionFor({ ...matches[0], text, layer: 'ordinary' })?.id, id);
  }
  const frame = { evaluate: async () => citations.map(([text]) => text) };
  assert.deepEqual(await inspectVisibleNames({ frames: () => [frame], mainFrame: () => frame }), []);
});

test('文献引用豁免不放行裸编号、混合露出或扩展路径', async () => {
  const texts = ['A/B', 'Case2/10', '附录 A/B；内部 A/B', 'TB880 Case2/10；内部 Case2/10',
    '附录 A/B/parameters', 'TB880 Case2/10/parameters', 'TB881 Case2/10',
    '附录 A/B\\parameters', 'TB880 Case2/10\\parameters',
    '附录 A/B；/parameters/duration_s', 'TB880 Case2/10；cablesim.type-electrical'];
  for (const text of texts) {
    assert.ok(identifyText(text).some(match => !exceptionFor({ ...match, text, layer: 'ordinary' })), text);
  }
  const frame = { evaluate: async () => texts };
  const violations = await inspectVisibleNames({ frames: () => [frame], mainFrame: () => frame });
  for (const text of texts) assert.ok(violations.some(item => item.text === text), text);
});

test('厂家系列只在真实型号目录分组标题豁免，普通节点与内部标识仍报告', async () => {
  const text = 'CU/XLPE/LC/PVC';
  const matches = identifyText(text);
  assert.deepEqual(matches.map(item => item.token), [text], '全局识别仍保留此路径形记号');
  const context = { page: '/resources/cables?item=fixed-version', text, layer: 'ordinary', cableSeriesLabel: true };
  assert.equal(exceptionFor({ ...context, ...matches[0] })?.id, 'cable-series-label');
  for (const changes of [
    { cableSeriesLabel: false }, { cableSeriesLabel: undefined },
    { page: '/resources/cables/structure-import' }, { page: '/resources/materials' },
    { page: '/types' }, { text: text + '；内部值' },
  ]) assert.equal(exceptionFor({ ...context, ...matches[0], ...changes }), null);
  for (const token of ['CU/XLPE/LC/PVC/parameters', 'cablesim.type-electrical', 'input_schema', 'steady-rating']) {
    assert.ok(identifyText(token).some(match => !exceptionFor({ ...context, text: token, ...match })), token);
  }
  const frame = { evaluate: async () => [
    context,
    { ...context, cableSeriesLabel: false },
    { ...context, page: '/resources/cables/structure-import' },
    { ...context, text: 'cablesim.type-electrical' },
    { ...context, text: 'CU/XLPE/LC/PVC/parameters' },
  ] };
  const violations = await inspectVisibleNames({ frames: () => [frame], mainFrame: () => frame });
  assert.deepEqual(violations.map(item => item.token), [text, text, 'cablesim.type-electrical', 'CU/XLPE/LC/PVC/parameters']);
});
