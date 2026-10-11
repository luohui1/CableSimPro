import test from 'node:test';
import assert from 'node:assert/strict';
import { identifyText, exceptionFor, readOnlyPost } from './visible-text-policy.mjs';

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
