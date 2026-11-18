// Projection contracts use the platform's actual result shapes. The six-workflow integration separately supplies live results.
// No physical result is computed here: all values, differences, states and sources must survive from the given saved record.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Backend, type BackendTool, type ToolResult } from '../fusion/backend.ts';
import { describeResult } from '../fusion/cards.ts';
import { MODEL_RESULT_MAX_BYTES, MODEL_RESULT_MAX_CHARS, modelResult, projectHistory, resultText } from '../fusion/model-result.ts';
import { backendTools, ScopeBook } from '../fusion/tools.ts';
import { skillReader } from '../host/agent-tools.ts';

const id = (number: number) => `${number.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
const WORKSPACE = id(1);
const STUDY = id(2);
const PREVIEW = id(3);
const UPLOAD = id(4);
const SERIES = id(5);
const BATCH = id(6);
const SHA = 'a'.repeat(64);
const PREVIEW_DIGEST = 'b'.repeat(64);

const tool = (name: string, kind = 'read', scope: BackendTool['scope'] = 'workspace'): BackendTool => ({
  name, title: '测试保存记录', kind, scope, description: '按真实保存记录读取，不执行计算。',
  parameters: { type: 'object', properties: {}, additionalProperties: false } as BackendTool['parameters'],
});
const result = (data: Record<string, any>, overrides: Partial<ToolResult> = {}): ToolResult => ({
  status: 'ok', summary: '已读取保存记录；尚未人工批准。', data, diagnostics: [], next_actions: [], result_digest: SHA, ...overrides,
});

function frozen<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
}

function parsed(text: string): Record<string, any> {
  assert.ok(text.length <= MODEL_RESULT_MAX_CHARS, `${text.length} characters exceed the per-result limit`);
  assert.ok(Buffer.byteLength(text, 'utf8') <= MODEL_RESULT_MAX_BYTES, 'UTF-8 bytes, not JS character count, must also fit');
  return JSON.parse(text);
}

function observe(name: string, source: ToolResult, params: Record<string, unknown> = {}, kind = 'read') {
  const projected = modelResult(tool(name, kind), params, source);
  const text = resultText(projected);
  return { text, reply: parsed(text) };
}

function comparisonFixture(): ToolResult {
  // Same shape as backend.kernel.drivers.compare: full source snapshots plus already computed absolute quantity differences.
  const snapshot = (rho: number) => ({ definition: { title: '城南线路 · 直埋校核',
    method: { plugin_id: 'cablesim.iec60287', version: '1.2.0', capability: 'steady-rating', release_digest: SHA } },
  cases: [{ case_id: 'case-0', parameters: { eddy: 'ignored', rating_mode: 'both' }, input: {
    schema_version: 'cablesim.domain/1', materials: [{ id: 'material/soil', label: '土壤', thermal_resistivity: rho }],
    provenance: { source: 'complete-source-snapshot-only-'.repeat(16_000) },
  } }] });
  return result({ workspace_id: WORKSPACE, run_ids: [id(10), id(11)], comparison: {
    kind: 'method-comparison', interpretation: '绝对数值对照；不同输入、边界或方法不代表优化收益。',
    sources: [10, 11].map((number, index) => ({ run_id: id(number), sequence: index + 1, status: 'succeeded',
      created: '2026-11-17T00:00:00Z', snapshot: snapshot(index === 0 ? 1 : 1.2), headlines: [],
      limiting_objects: [{ entity: 'cable/c1-A', full_solver_evidence: 'full-limiting-evidence-only-'.repeat(200) }] })),
    differences: [{ run_id: id(11), baseline_run_id: id(10), same_input: false, same_parameters: true, same_method: true,
      quantities: [
        { case_id: 'case-0', condition: 'rating', key: 'ampacity', entity: 'circuit/c1', unit: 'A', baseline: 748.3, value: 701.4, difference: -46.9 },
        { case_id: 'case-0', condition: 'operating', key: 'conductor_temperature', entity: 'cable/c1-A', unit: 'K', baseline: 338.65, value: 344.65, difference: 6 },
        { case_id: 'case-0', condition: 'operating', key: 'dielectric_loss', entity: 'cable/c1-A', unit: 'W/m', baseline: 0.1, value: 0.1, difference: 0 },
      ], unmatched: [['case-0', 'operating', 'unmatched_quantity', 'cable/c1-A', 'W/m']] }],
  } });
}

test('comparison observations retain saved differences and named inputs, without either full snapshot or recomputed quantities', () => {
  const source = frozen(comparisonFixture());
  const original = JSON.stringify(source);
  assert.ok(original.length > 870_000, 'the pre-fix 870k-character regression must be exercised, not a tiny stand-in');
  const { text, reply } = observe('study_compare', source, { workspace_id: WORKSPACE, run_ids: source.data.run_ids });
  assert.equal(reply.status, 'ok');
  assert.equal(reply.data.comparison.sources[0].name, '城南线路 · 直埋校核 · 第 1 条记录');
  assert.equal(reply.data.comparison.sources[1].name, '城南线路 · 直埋校核 · 第 2 条记录');
  assert.equal(reply.data.comparison.interpretation, source.data.comparison.interpretation);
  const difference = reply.data.comparison.differences[0];
  for (const key of ['run_id', 'baseline_run_id', 'same_input', 'same_parameters', 'same_method'])
    assert.equal(difference[key], source.data.comparison.differences[0][key]);
  assert.equal(difference.quantity_count, 3);
  assert.equal(difference.unmatched_count, 1);
  assert.equal(difference.quantities.length, 2);
  for (let index = 0; index < 2; index += 1) {
    const originalQuantity = source.data.comparison.differences[0].quantities[index];
    for (const [key, value] of Object.entries(originalQuantity)) assert.deepEqual(difference.quantities[index][key], value);
  }
  assert.deepEqual(difference.input_changes, [{ label: '土壤热阻率', trace: { path: '/0/input/materials/0/thermal_resistivity' }, before: 1, after: 1.2, unit: 'K·m/W' }]);
  assert.equal(difference.input_change_count, 1);
  assert.doesNotMatch(text, /complete-source-snapshot-only|full-limiting-evidence-only|"snapshot"/);
  assert.deepEqual(reply.detail.read, { tool: 'study_compare', arguments: { workspace_id: WORKSPACE, run_ids: [id(10), id(11)], result_view: '', result_offset: 0, result_digest: SHA } });
  assert.equal(JSON.stringify(source), original);
});

function previewFixture(): ToolResult {
  const rows = Array.from({ length: 11 }, (_, index) => ({ row_number: index + 5, key: `size-${index}`, name: `厂家规格 ${index + 1}`,
    status: index > 8 ? 'error' : index === 8 ? 'incomplete' : 'ready',
    values: [{ key: 'insulation_thickness', label: '绝缘厚度', value: 0.0045, unit: 'm', display_value: 4.5, display_unit: 'mm',
      source: { kind: 'manufacturer', origin: 'table', file: '厂家结构.xlsx', sheet: '表2', row: index + 5, column: 'D', reviewed: false,
        reference: 'complete-row-evidence-only-'.repeat(650) } }],
    issues: index > 8 ? [{ field: 'outer_diameter', column: 'G', message: '原表外径不是可用数值。' }] : [],
    missing: index === 8 ? ['20 °C 直流电阻'] : [], warnings: [],
  }));
  return result({ proposal: { id: id(7), title: '保存厂家结构预览', status: 'approved', checks: ['来源待核对'], changes: [{ path: '/mapping', label: '保存列映射', after: { D: 'insulation_thickness' } }] },
    receipt: { kind: 'structure_preview', status: 'succeeded', executed: true,
      upload_id: UPLOAD, sha256: SHA, preview_id: PREVIEW, preview_digest: PREVIEW_DIGEST,
      row_count: 11, valid_count: 9, error_count: 2, incomplete_count: 1,
      preview: { file: '厂家结构.xlsx', sheet: '表2', first_data_row: 5, rows, skipped: [], series: { name: '厂家系列' }, mapping: { insulation_thickness: 3 } },
      next_read: { tool: 'structure_import_read', arguments: { kind: 'preview', id: PREVIEW } },
    } });
}

test('a large preview stays complete in its real card while the model gets problem rows, counts and the exact next reference', async () => {
  const source = frozen(previewFixture());
  const original = JSON.stringify(source);
  assert.ok(original.length > 180_000);
  const shown = await describeResult(new Backend('http://127.0.0.1:9', 'unused'), 'propose_structure_preview', {}, source, WORKSPACE);
  assert.equal(shown.card?.kind, 'structure_preview');
  if (shown.card?.kind !== 'structure_preview') return;
  assert.equal(shown.card.view.complete, true);
  assert.deepEqual(shown.card.view.rows, source.data.receipt.preview.rows, 'every saved field and its complete original reference belong to the card');
  const text = resultText(modelResult(tool('propose_structure_preview', 'propose'), { workspace_id: WORKSPACE }, source, shown));
  const reply = parsed(text);
  const receipt = reply.data.receipt;
  for (const key of ['kind', 'status', 'executed', 'upload_id', 'sha256', 'preview_id', 'preview_digest', 'row_count', 'valid_count', 'error_count', 'incomplete_count'])
    assert.equal(receipt[key], source.data.receipt[key]);
  assert.equal(receipt.preview_in_card, true);
  assert.equal(receipt.problem_row_count, 3);
  assert.deepEqual(receipt.problem_rows.map((row: any) => [row.row_number, row.status, row.issues, row.missing]),
    source.data.receipt.preview.rows.slice(8).map((row: any) => [row.row_number, row.status, row.issues, row.missing]));
  assert.equal(receipt.engineering_approval, false);
  assert.equal(receipt.preview, undefined);
  assert.doesNotMatch(text, /complete-row-evidence-only/);
  assert.deepEqual(reply.detail.read, { tool: 'structure_import_read', arguments: { kind: 'preview', id: PREVIEW, workspace_id: WORKSPACE } });
  assert.equal(JSON.stringify(source), original);
});

test('an omitted preview cannot claim zero problem rows or a complete card', () => {
  const source = previewFixture();
  delete source.data.receipt.preview;
  source.data.receipt.preview_omitted = true;
  source.data.receipt.message = '完整预览已保存，需要按需分页读取。';
  const { reply } = observe('propose_structure_preview', frozen(source), { workspace_id: WORKSPACE }, 'propose');
  assert.equal(reply.data.receipt.error_count, 2);
  assert.equal(reply.data.receipt.incomplete_count, 1);
  assert.equal(reply.data.receipt.preview_in_card, false);
  assert.notEqual(reply.data.receipt.problem_row_count, 0, 'unknown problem rows must not be summarized as an empty set');
  assert.equal(reply.detail.read.tool, 'structure_import_read');
});

function importedFixture(): ToolResult {
  return result({ proposal: { id: id(8), title: '保存厂家型号草稿', status: 'approved', checks: ['来源待核对'], assumptions: [],
    changes: Array.from({ length: 319 }, (_, index) => ({ path: `/rows/${index}`, label: `第 ${index + 1} 项保存字段`, before: null,
      after: { source: 'full-reviewed-change-only-'.repeat(24) } })) }, receipt: {
    kind: 'structure_import', status: 'succeeded', executed: true, series_id: SERIES, created: 11, state: 'draft',
    preview_id: PREVIEW, preview_digest: PREVIEW_DIGEST, skipped_rows: [],
    specs: Array.from({ length: 11 }, (_, index) => ({ id: id(100 + index), name: `厂家规格 ${index + 1}`, workspace_id: id(200 + index),
      model_id: id(300 + index), version: 1, content_sha256: SHA, state: 'draft' })),
    next_read: { tool: 'structure_import_read', arguments: { kind: 'series', id: SERIES } },
  } });
}

test('an import observation keeps every created specification reference needed for the separately approved batch check', () => {
  const source = frozen(importedFixture());
  const original = JSON.stringify(source);
  assert.ok(original.length > 180_000);
  const { text, reply } = observe('propose_structure_import', source, { workspace_id: WORKSPACE }, 'propose');
  assert.equal(reply.data.proposal.change_count, 319);
  assert.equal(reply.data.proposal.changes, undefined);
  assert.equal(reply.data.receipt.created, 11);
  assert.equal(reply.data.receipt.state, 'draft');
  assert.equal(reply.data.receipt.series_id, SERIES);
  assert.equal(reply.data.receipt.preview_digest, PREVIEW_DIGEST);
  assert.deepEqual(reply.data.receipt.specs, source.data.receipt.specs);
  assert.equal(reply.data.receipt.engineering_approval, false);
  assert.doesNotMatch(text, /full-reviewed-change-only/);
  assert.equal(JSON.stringify(source), original);
});

test('batch summaries distinguish execution success from missing or failed standards checks using the actual verdict contract', () => {
  const checks = [
    { title: '导体标称截面', verdict: 'passed', actual: 300, limit: 300, unit: 'mm²', reason: null },
    { title: '绝缘厚度', verdict: 'failed', actual: 4.1, limit: 4.5, unit: 'mm', reason: '保存厚度低于标准下限。' },
    { title: '绝缘最薄点', verdict: 'missing', actual: null, limit: 3.95, unit: 'mm', reason: '缺少实测最薄点。' },
    { title: '特殊构造', verdict: 'uncovered', actual: null, limit: null, unit: '1', reason: '当前方法不覆盖此构造。' },
  ];
  const source = frozen(result({ receipt: { kind: 'structure_check', status: 'succeeded', executed: true, id: BATCH, batch_id: BATCH,
    series_id: SERIES, complete: true, items: [{ spec_id: id(100), name: '厂家规格 1', status: 'succeeded', workspace_id: id(200),
      study_id: id(400), run_id: id(500), input_digest: SHA, output_digest: PREVIEW_DIGEST,
      message: '已保存真实运行；计算成功、标准符合与人工批准分别判断。', checks, errors: [] }],
    next_read: { tool: 'structure_import_read', arguments: { kind: 'check', id: BATCH } },
  } }));
  const { reply } = observe('propose_structure_check', source, { workspace_id: WORKSPACE }, 'propose');
  assert.equal(reply.data.receipt.status, 'succeeded');
  assert.equal(reply.data.receipt.engineering_approval, false);
  assert.deepEqual(reply.data.receipt.check_counts, { passed: 1, failed: 1, missing: 1, uncovered: 1 });
  const item = reply.data.receipt.items[0];
  for (const key of ['spec_id', 'name', 'status', 'workspace_id', 'study_id', 'run_id', 'input_digest', 'output_digest'])
    assert.equal(item[key], source.data.receipt.items[0][key]);
  for (const check of checks.slice(1)) {
    const shown = item.checks.find((value: any) => value.title === check.title);
    assert.ok(shown, `the ${check.verdict} check must be available to explain the result`);
    for (const key of ['verdict', 'reason', 'actual', 'limit', 'unit'] as const) assert.equal(shown[key], check[key]);
  }
});

function largeCheckFixture(count = 11): ToolResult {
  // _run preserves the plugin's complete artifact rows, including repeated basis/provenance for every specification.
  const check = (title: string, verdict: string, actual: number | null, limit: number | null, reason: string, index: number) => ({
    id: `cable_type.cores.0.layers.${index}.thickness:minimum`, title, path: `cable_type.cores.0.layers.${index}.thickness`,
    layer_path: `cable_type.cores.0.layers.${index}`, target: { core_id: 'core/1', role: 'insulation' }, standard: 'GB/T 12706.2',
    clause: '6.2', printed_page: 12, pdf_page: 15, source_digest: SHA, source_status: 'verified',
    limit, actual, actual_unrounded: actual, margin: null, unit: 'mm', comparison: 'minimum', verdict, reason,
    formula: null, formula_inputs: {}, basis: 'manufacturer', input_source: { kind: 'manufacturer', reviewed: false,
      reference: 'complete-standard-check-source-only-'.repeat(60) }, design_actual: null, measurement_id: null,
  });
  return result({ proposal: { id: id(9), title: '核对厂家系列的 11 个规格', status: 'approved', checks: [], assumptions: [], changes: [] }, receipt: {
    kind: 'structure_check', status: 'succeeded', executed: true, id: BATCH, batch_id: BATCH, series_id: SERIES, operation: 'check',
    items: Array.from({ length: count }, (_, position) => ({ spec_id: id(100 + position), name: `厂家规格 ${position + 1} · 8.7/15 kV`,
      status: 'succeeded', workspace_id: id(200 + position), study_id: id(400 + position), run_id: id(500 + position),
      input_digest: position.toString(16).padStart(64, '0'), output_digest: (position + 100).toString(16).padStart(64, '0'),
      method_name: '电缆结构标准核对', method_version: '1.0.0', confidence: 'reference',
      message: '已保存真实运行；计算成功、标准符合与人工批准分别判断。', errors: [], checks: [
        check('标称绝缘厚度', 'passed', 4.5, 4.5, '保存标称值满足下限。', 0),
        check('绝缘厚度', 'failed', 4.1 + position / 100, 4.5, '保存厚度低于标准下限，不代表已经批准。', 1),
        ...Array.from({ length: 10 }, (_, index) => check(`第 ${index + 1} 层最薄点`, 'missing', null, 3.95,
          '原厂家表未提供该项实测值；标称厚度不能替代实测最薄点，需补充可追溯的厂家记录。', index + 2)),
        ...Array.from({ length: 6 }, (_, index) => check(`第 ${index + 1} 项特殊构造`, 'uncovered', null, null,
          '当前方法的来源范围不覆盖此构造，不生成替代阈值；请人工核对适用标准和来源。', index + 12)),
      ] })), next_read: { tool: 'structure_import_read', arguments: { kind: 'check', id: BATCH } },
  } });
}

test('an eleven-item real-shaped check receipt keeps every saved-run identity while repeated issues use a separately bounded catalogue', async context => {
  const source = frozen(largeCheckFixture());
  const original = JSON.stringify(source);
  assert.ok(original.length > 180_000);
  const shown = await describeResult(new Backend('http://127.0.0.1:9', 'unused'), 'propose_structure_check', {}, source, WORKSPACE);
  assert.equal(shown.card?.kind, 'structure_check');
  if (shown.card?.kind !== 'structure_check') return;
  assert.equal(shown.card.view.complete, true);
  assert.deepEqual(shown.card.view.items, source.data.receipt.items, 'all raw artifact rows and provenance must remain on the saved card');
  const text = resultText(modelResult(tool('propose_structure_check', 'propose'), { workspace_id: WORKSPACE }, source, shown));
  const reply = parsed(text);
  const receipt = reply.data.receipt;
  assert.equal(reply.detail.truncated, undefined, 'semantic compaction must finish before generic truncation can discard run identities');
  assert.equal(receipt.items_complete, true);
  assert.equal(receipt.items.length, 11);
  assert.equal(receipt.item_count, 11);
  assert.deepEqual(receipt.check_counts, { passed: 11, failed: 11, missing: 110, uncovered: 66 });
  assert.deepEqual(receipt.statuses, { succeeded: 11 });
  assert.equal(receipt.engineering_approval, false);
  assert.ok(receipt.issue_catalog.length < 11 * 17, 'repeated findings must not be duplicated for every specification');
  for (const verdict of ['failed', 'missing', 'uncovered']) assert.ok(receipt.issue_catalog.some((entry: any) => entry.verdict === verdict));
  const catalog = new Map<number, any>(receipt.issue_catalog.map((entry: any) => [entry.id, entry]));
  for (let index = 0; index < 11; index += 1) {
    const item = receipt.items[index];
    const saved = source.data.receipt.items[index];
    for (const key of ['spec_id', 'name', 'workspace_id', 'study_id', 'run_id', 'status', 'input_digest', 'output_digest'])
      assert.equal(item[key], saved[key], `specification ${index + 1} retains its exact ${key}`);
    assert.deepEqual(item.check_counts, { passed: 1, failed: 1, missing: 10, uncovered: 6 });
    const issues = item.issue_refs.map((reference: number) => { assert.ok(catalog.has(reference)); return catalog.get(reference); });
    const failed = issues.find((entry: any) => entry.verdict === 'failed');
    assert.ok(failed, 'each failed comparison must keep its actual value, even when titles match another specification');
    for (const key of ['title', 'verdict', 'actual', 'limit', 'unit', 'reason', 'comparison']) assert.equal(failed[key], saved.checks[1][key]);
    for (const verdict of ['failed', 'missing', 'uncovered']) {
      const displayed = issues.filter((entry: any) => entry.verdict === verdict).length;
      assert.equal(displayed + (item.omitted_issue_counts[verdict] ?? 0), item.check_counts[verdict], 'omitted evidence stays explicitly counted');
    }
    assert.equal(item.checks_path, `/items/${index}/checks`);
  }
  assert.deepEqual(receipt.next_read.arguments, { kind: 'check', id: BATCH, workspace_id: WORKSPACE });
  assert.doesNotMatch(JSON.stringify(reply), /complete-standard-check-source-only/);
  assert.equal(JSON.stringify(source), original);
  context.diagnostic(`Full check receipt ${original.length} chars; model observation ${text.length} chars / ${Buffer.byteLength(text)} UTF-8 bytes; all ${receipt.items.length} saved-run identities retained.`);
});

test('a much larger check batch explicitly pages whole identities instead of silently clipping an item array', () => {
  const source = frozen(largeCheckFixture(100));
  const { reply } = observe('propose_structure_check', source, { workspace_id: WORKSPACE }, 'propose');
  const receipt = reply.data.receipt;
  assert.equal(reply.detail.truncated, undefined);
  assert.equal(receipt.item_count, 100);
  assert.equal(receipt.items_complete, false);
  assert.ok(receipt.items.length >= 11 && receipt.items.length < 100);
  for (let index = 0; index < receipt.items.length; index += 1) {
    assert.equal(receipt.items[index].run_id, source.data.receipt.items[index].run_id);
    assert.equal(receipt.items[index].output_digest, source.data.receipt.items[index].output_digest);
  }
  assert.deepEqual(receipt.next_read, { tool: 'structure_import_read', arguments: {
    kind: 'check', id: BATCH, view: '/items', offset: 0, limit: 10, workspace_id: WORKSPACE } },
  'start the read at zero to obtain its real response digest before following the backend continuation');
  assert.deepEqual(receipt.check_counts, { passed: 100, failed: 100, missing: 1000, uncovered: 600 });
});

for (const status of ['running', 'interrupted', 'partial', 'failed']) {
  test(`a ${status} batch keeps its failure state and saved identities without claiming approval`, () => {
    const source = frozen(result({ receipt: { kind: 'structure_check', status, executed: true, id: BATCH, batch_id: BATCH,
      series_id: SERIES, complete: false, may_have_written: true, message: '全批尚未完成；保存项保留，不自动重跑。',
      items: [{ spec_id: id(100), name: '厂家规格 1', status: 'succeeded', workspace_id: id(200), study_id: id(400), run_id: id(500) },
        { spec_id: id(101), name: '厂家规格 2', status: 'failed', errors: [{ code: 'INPUT_MISSING', message: '缺少直流电阻，不生成替代结果。' }] }],
      next_read: { tool: 'structure_import_read', arguments: { kind: 'check', id: BATCH } },
    } }, { status: ['running', 'interrupted'].includes(status) ? 'error' : 'ok' }));
    const { reply } = observe('propose_structure_check', source, { workspace_id: WORKSPACE }, 'propose');
    assert.equal(reply.status, source.status);
    assert.equal(reply.data.receipt.status, status);
    assert.equal(reply.data.receipt.complete, false);
    assert.equal(reply.data.receipt.may_have_written, true);
    assert.deepEqual(reply.data.receipt.statuses, { succeeded: 1, failed: 1 });
    assert.equal(reply.data.receipt.items[0].run_id, id(500));
    assert.deepEqual(reply.data.receipt.items[1].errors, source.data.receipt.items[1].errors);
    assert.equal(reply.data.receipt.engineering_approval, false);
    assert.equal(reply.detail.read.arguments.id, BATCH);
  });
}

test('large generic results and errors remain valid bounded JSON with an authorized read hint', () => {
  const samples = [
    { long_ascii: 'saved-source-value-'.repeat(20_000), final_value: 612.3456 },
    { long_utf8: '标准来源📎原始记录Ω'.repeat(12_000), final_value: 612.3456 },
    { items: Array.from({ length: 1000 }, (_, index) => ({ id: id(1000 + index), name: `规格 ${index} 📎`, value: index + 0.125, unit: 'mm',
      source: '完整来源字段'.repeat(15) })), item_count: 1000 },
    { ['字段/带斜线~与中文📎'.repeat(3000)]: '完整来源'.repeat(1000), final_value: 612.3456 },
  ];
  for (const data of samples) {
    const source = frozen(result(data));
    const original = JSON.stringify(source);
    const { reply } = observe('resource_read', source, { workspace_id: WORKSPACE, kind: 'document', id: id(900), view: '/content' });
    const value = reply.projection === 'bounded_summary' ? reply.value : reply;
    assert.equal(value.status, 'ok');
    assert.ok(value.detail?.read, 'a size limit must retain a usable read-only expansion, not a generic retry-write suggestion');
    assert.equal(value.detail.read.tool, 'resource_read');
    assert.equal(value.detail.read.arguments.workspace_id, WORKSPACE);
    assert.equal(value.detail.read.arguments.result_digest, SHA);
    assert.equal(JSON.stringify(source), original);
  }
  const error = parsed(resultText({ status: 'error', summary: '字段错误：厂家来源📎'.repeat(20_000),
    data: {}, diagnostics: [{ code: 'FIELD_INVALID', message: '外径不能作为已核对数值。' }] }));
  assert.equal((error.value ?? error).status, 'error');
  assert.match(JSON.stringify(error), /FIELD_INVALID/);
  assert.match(JSON.stringify(error), /原记录|保存记录/);
});

test('history projection repairs an old oversized comparison without rewriting stored content, cards, order or approval state', () => {
  const old = comparisonFixture();
  const oldText = JSON.stringify(old);
  const messages = frozen([
    { role: 'user', content: [{ type: 'text', text: '改条件重算并对比。' }] },
    { role: 'assistant', content: [{ type: 'toolCall', id: 'compare-call', name: 'study_compare', arguments: { workspace_id: WORKSPACE, run_ids: old.data.run_ids } }] },
    { role: 'toolResult', toolCallId: 'compare-call', toolName: 'study_compare', isError: false, content: [{ type: 'text', text: oldText }],
      details: { target: '研究「城南线路 · 直埋校核」', card: { kind: 'open', label: '查看保存运行', href: `cablesim:study/${STUDY}` },
        saved_evidence: old.data.comparison, proposal: { id: id(888), status: 'accepted' } } },
  ]);
  const original = JSON.stringify(messages);
  const projected = projectHistory(messages, [tool('study_compare')], []);
  assert.equal(projected.length, messages.length);
  assert.strictEqual(projected[0], messages[0]);
  assert.strictEqual(projected[1], messages[1]);
  assert.notStrictEqual(projected[2], messages[2]);
  assert.strictEqual(projected[2].details, messages[2].details);
  assert.equal(projected[2].isError, false);
  const projectedContent = projected[2].content[0];
  assert.ok('text' in projectedContent);
  const reply = parsed(projectedContent.text);
  assert.equal(reply.data.comparison.differences[0].same_input, false);
  assert.equal(reply.data.comparison.sources[0].snapshot, undefined);
  const storedContent = messages[2].content[0];
  assert.ok('text' in storedContent);
  assert.equal(storedContent.text, oldText);
  assert.equal(JSON.stringify(messages), original);
  assert.deepEqual(projectHistory(projected, [tool('study_compare')], []), projected, 'a second model request must not keep changing an already bounded observation');
});

test('display resistance and engineering wording accompany exact SI and source facts', () => {
  const source = frozen(result({ items: [{ section: 'structure', label: '20 °C 直流电阻', value: 0.0000601, unit: 'ohm/m',
    source: { kind: 'saved_type_input', type_id: id(200), revision: 1, digest: SHA, provenance: { kind: 'standard', reviewed: false,
      reference: { record: { semantic: 'standard_limit', criterion: 'maximum', citation: 'GB/T 3956 表 2', value: 0.0601, quantity: { unit: 'ohm/km' } } } } } }],
    parameters: { eddy: 'ignored' }, quantity: { key: 'ampacity', condition: 'rating', value: 701.4, unit: 'A' } }));
  const { reply } = observe('type_read', source, { type_id: id(200) });
  const field = reply.data.items[0];
  assert.equal(field.display_value, 0.0601);
  assert.equal(field.display_unit, 'Ω/km');
  assert.deepEqual(field.trace, { value_si: 0.0000601, unit_si: 'ohm/m' });
  assert.deepEqual(field.source.provenance, source.data.items[0].source.provenance);
  assert.match(reply.data.quantity.condition_name, /额定|回路|载流/);
  assert.deepEqual(reply.data.parameters, source.data.parameters, 'strict engineering parameters stay usable as exact next-tool inputs');
  assert.match(reply.data.parameter_notes[0], /未计.*涡流损耗/);
});

test('library cable payloads with a bare SI r20 also supply a human display value without changing source provenance', () => {
  const source = frozen(result({ model: { id: id(700), name: '厂家 300 mm² 型号版本', payload: {
    cable_type: { cores: [{ id: 'core/1', conductor: { r20: 0.0000601, nominal_area: 0.0003 } }] },
    provenance: { '/cable_type/cores/core~11/conductor/r20': { kind: 'standard', reviewed: false, reference: 'GB/T 3956 标准上限，非厂家实测。' } },
  } } }));
  const before = JSON.stringify(source);
  const { reply } = observe('cable_model_read', source, { model_id: id(700) });
  const conductor = reply.data.model.payload.cable_type.cores[0].conductor;
  assert.equal(conductor.r20, 0.0000601);
  assert.equal(conductor.r20_display.value, 0.0601);
  assert.equal(conductor.r20_display.unit, 'Ω/km');
  assert.equal(conductor.r20_display.trace.value_si, 0.0000601);
  assert.deepEqual(reply.data.model.payload.provenance, source.data.model.payload.provenance);
  assert.equal(JSON.stringify(source), before);
});

test('an explicit source page stays exact through the complete tool wrapper, including sealed identities and strict parameters', async () => {
  const value = { method: { plugin_id: 'cablesim.iec60287', version: '1.2.0', capability: 'steady-rating', release_digest: SHA },
    parameters: { eddy: 'ignored', rating_mode: 'both' }, input: { conductor: { r20: 0.0000601 } },
    quantity: { value: 0.0000601, unit: 'ohm/m', source: { reviewed: false } } };
  const source = frozen(result({ projection: 'result_page', source: { response_digest: SHA },
    page: { view: '/record', value, complete: true, total: 1, next_offset: null } }));
  class SavedPageBackend extends Backend {
    open = async () => ({ session: 'saved-session', turn: 'saved-turn', context: { kind: 'project' as const, id: WORKSPACE } });
    call = async () => source;
    read = async <T>() => [{ method: { plugin_id: 'cablesim.iec60287' }, name: 'IEC 60287 载流量' }] as T;
  }
  const backend = new SavedPageBackend('http://127.0.0.1:9', 'unused');
  const scopes = new ScopeBook(backend, '只读一个确切字段。');
  const action = backendTools(backend, [tool('resource_read')], () => scopes, [])[0];
  const response = await action.execute('source-page', { workspace_id: WORKSPACE, kind: 'rating_table', run_id: id(10),
    result_view: '/record', result_offset: 0, result_digest: SHA }, undefined, undefined, {} as never);
  const content = response.content[0];
  assert.equal(content.type, 'text');
  if (content.type !== 'text') return;
  const reply = parsed(content.text);
  assert.deepEqual(reply.data.page.value, value, 'a literal source page must be usable as a strict next-tool input without display-only additions or identity removal');
  assert.equal(reply.data.source.response_digest, SHA);
});

test('the skill reader pages long Unicode files with exact continuation offsets and retains its file allowlist', async () => {
  const source = 'a'.repeat(3999) + '📎' + '标准Ω/km与厂家来源📎'.repeat(1000) + '\n文件结束。';
  const read = skillReader([{ name: 'ampacity-rating', filePath: '/allowed/ampacity-rating/SKILL.md' }], path => {
    assert.equal(path, '/allowed/ampacity-rating/SKILL.md');
    return source;
  });
  let offset = 0;
  let reconstructed = '';
  for (let page = 0; page < 20; page += 1) {
    const response = await read.execute('read-call', { path: 'ampacity-rating', offset }, undefined, undefined, {} as never);
    assert.equal(response.content.length, 1);
    const part = response.content[0];
    assert.equal(part.type, 'text');
    if (part.type !== 'text') return;
    assert.ok(part.text.length <= MODEL_RESULT_MAX_CHARS);
    assert.ok(Buffer.byteLength(part.text) <= MODEL_RESULT_MAX_BYTES);
    const next = /\n\n【技能尚未读完；下一页 read\((\{.*\})\)。】$/.exec(part.text);
    const body = next ? part.text.slice(0, next.index) : part.text;
    assert.equal(body.isWellFormed(), true, 'a page boundary must not cut a surrogate pair');
    reconstructed += body;
    if (!next) break;
    const args = JSON.parse(next[1]);
    assert.equal(args.path, 'ampacity-rating');
    assert.ok(args.offset > offset);
    assert.equal(args.offset, reconstructed.length);
    offset = args.offset;
  }
  assert.equal(reconstructed, source, 'following only returned offsets must reconstruct every character once');
  await assert.rejects(read.execute('read-call', { path: '/repo/AGENTS.md' }, undefined, undefined, {} as never), /只能读取技能文件/);
  for (const invalid of [-1, 0.5, source.length + 1])
    await assert.rejects(read.execute('read-call', { path: 'ampacity-rating', offset: invalid }, undefined, undefined, {} as never), /续读位置无效/);
});
