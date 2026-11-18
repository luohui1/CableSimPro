import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { cloneElement, createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { Backend, type ToolResult } from '../fusion/backend.ts';
import { describeResult } from '../fusion/cards.ts';
import { displayNumber, displayQuantity, engineeringText, isTraceChange, proposalValueText } from '../shared/fusion-presentation.ts';
import type { Proposal } from '../shared/types.ts';

test('resistance display uses Ω/km without modifying the saved SI value or confusing resistivity', async () => {
  const data = { object: { name: '110 kV 单芯电缆' }, items: [{ section: 'structure', label: '20 °C 直流电阻', value: 0.0000601, unit: 'ohm/m',
    source: { provenance: { kind: 'standard', reviewed: false } } }], next_page: null };
  const result: ToolResult = { status: 'ok', summary: '已读取保存结构。', data, diagnostics: [], next_actions: [] };
  const original = JSON.stringify(result);
  const shown = await describeResult(new Backend('http://127.0.0.1:9', 'unused'), 'type_read', { type_id: 'saved-type' }, result, 'saved-type');
  assert.equal(shown.card?.kind, 'saved_type');
  if (shown.card?.kind !== 'saved_type') return;
  assert.deepEqual(shown.card.view.fields[0], {
    label: '20 °C 直流电阻', value: '0.0601', unit: 'Ω/km', source: '保存的设计输入，来源待核对',
  });
  assert.equal(proposalValueText(data.items[0].value, data.items[0].unit), '0.0601 Ω/km');
  assert.deepEqual(displayQuantity(data.items[0].value, data.items[0].unit), { value: 0.0601, unit: 'Ω/km' },
    'the model display annotation must not expose a binary multiplication tail');
  assert.equal(JSON.stringify(result), original, 'card and review projection must not rewrite saved facts');
  assert.deepEqual(displayQuantity(1.724e-8, 'Ω·m'), { value: 1.724e-8, unit: 'Ω·m' }, 'material resistivity is a different quantity');
  assert.deepEqual(displayQuantity(0.0601, 'ohm/km'), { value: 0.0601, unit: 'Ω/km' }, 'already scaled values must not be multiplied again');
  assert.equal(proposalValueText(null, 'ohm/m'), '—', 'missing resistance must stay missing');
  assert.equal(displayNumber(0.0045000000000000005), '0.0045');
  assert.equal(displayNumber(1.234567890123456), '1.234567890123456', 'meaningful precision remains');
});

test('known run terms have explicit engineering meanings while unknown terms remain unchanged', () => {
  assert.equal(engineeringText('rating 口径；rating-simultaneous；operating；eddy=ignored'),
    '单回路能力 口径；全回路共同能力；给定负荷运行点；护套涡流损耗按方法声明忽略');
  assert.equal(engineeringText('未支持的 future_rating，缺少 R20'), '未支持的 future_rating，缺少 R20');
  assert.equal(engineeringText('steady-rating / rating-table / plugin.rating / future-operating'),
    'steady-rating / rating-table / plugin.rating / future-operating', 'do not partially translate unknown identifiers');
});

test('review identities remain complete in the collapsed trace, separate from engineering changes', async t => {
  const server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    configFile: fileURLToPath(new URL('../vite.fusion.config.ts', import.meta.url)),
    server: { middlewareMode: true, watch: null, hmr: false, ws: false }, logLevel: 'error',
  });
  t.after(() => server.close());
  const { ProposalTrace } = await server.ssrLoadModule('/ui/fusion/proposal.tsx');
  const changes: Proposal['changes'] = [
    { part: '平台改动', field: '/preview_id', label: '保存预览标识', before: '—', after: 'f74d3350-0346-4c52-97cf-b1e136d24b22' },
    { part: '平台改动', field: '/sha256', label: '原件 SHA256', before: '—', after: 'a'.repeat(64) },
    { part: '平台改动', field: '/materials/material~1soil/thermal_resistivity', label: '土壤热阻率', before: '1 K·m/W', after: '1.2 K·m/W' },
  ];
  const original = JSON.stringify(changes);
  const trace = changes.filter(isTraceChange);
  assert.equal(trace.length, 2);
  assert.deepEqual(changes.filter(change => !isTraceChange(change)), [changes[2]]);
  let tree: ReactElement<{ defaultOpen?: boolean }>;
  function Capture() { tree = ProposalTrace({ changes: trace }); return tree; }
  const folded = renderToStaticMarkup(createElement(Capture));
  assert.match(folded, /追溯信息/);
  assert.match(folded, /aria-expanded="false"/);
  for (const change of trace) assert.ok(!folded.includes(change.after), 'identities should not occupy the main review');
  const expanded = renderToStaticMarkup(cloneElement(tree!, { defaultOpen: true }));
  for (const change of trace) assert.ok(expanded.includes(change.after), 'every exact identity stays reviewable');
  assert.equal(JSON.stringify(changes), original);
  assert.equal(isTraceChange({ field: '', label: 'YJV 3×25 · 固定版本与保存修订' }), true,
    'batch identity rows contain workspace IDs and digests and belong in trace details');
});
