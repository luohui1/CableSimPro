// Projection contracts use the platform's actual result shapes. The six-workflow integration separately supplies live results.
// No physical result is computed here: all values, differences, states and sources must survive from the given saved record.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AssistantMessage, Message } from '@earendil-works/pi-ai';
import { estimateContextTokens } from '@earendil-works/pi-ai/utils/estimate';
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

test('the final comparison boundary retains ampacity and temperature after fifty component quantities', () => {
  const source = comparisonFixture();
  const difference = source.data.comparison.differences[0];
  const critical = difference.quantities.slice(0, 2);
  const margin = { case_id: 'case-0', condition: 'operating', key: 'temperature_margin', entity: 'cable/c1-A',
    unit: 'K', baseline: 24.5, value: 18.5, difference: -6 };
  difference.quantities = [...Array.from({ length: 50 }, (_, index) => ({ case_id: 'case-0', condition: 'operating',
    key: 'ac_resistance', entity: `cable/component-${index}`, unit: 'ohm/m', baseline: 0.0000723456789, value: 0.000073456789, difference: 0.0000011111101 })),
  ...critical, margin];
  const original = JSON.stringify(frozen(source));
  const { reply } = observe('study_compare', source, { workspace_id: WORKSPACE, run_ids: source.data.run_ids });
  const saved = reply.data.comparison.differences[0];
  assert.equal(saved.quantity_count, 53);
  for (const expected of [...critical, margin]) {
    const actual = saved.quantities.find((item: any) => item.key === expected.key);
    assert.ok(actual, `the final bounded result must retain ${expected.key}`);
    for (const [key, value] of Object.entries(expected)) assert.deepEqual(actual[key], value);
  }
  assert.equal(reply.detail.read.arguments.result_digest, SHA);
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

test('import success retains incomplete draft fields, including a missing field in the last created specification', () => {
  const source = importedFixture();
  source.data.receipt.specs[10].missing = ['20 °C 导体直流电阻', '绝缘最薄点实测'];
  const original = JSON.stringify(frozen(source));
  const { reply } = observe('propose_structure_import', source, { workspace_id: WORKSPACE }, 'propose');
  assert.equal(reply.data.receipt.status, 'succeeded');
  assert.equal(reply.data.receipt.state, 'draft');
  assert.equal(reply.data.receipt.engineering_approval, false);
  assert.equal(reply.data.receipt.missing_spec_count, 1);
  assert.deepEqual(reply.data.receipt.missing_fields, source.data.receipt.specs[10].missing);
  assert.deepEqual(reply.data.receipt.specs[10].missing, source.data.receipt.specs[10].missing);
  assert.equal(reply.data.receipt.specs[10].workspace_id, source.data.receipt.specs[10].workspace_id);
  assert.equal(JSON.stringify(source), original);
});

test('type check pages preserve exact saved failures, missing quantities and page-local source references', () => {
  const data = { type_id: id(200), type_revision: 3, view: 'runs', total: 65, next_page: { after: 3, limit: 20, expected_revision: 3 },
    object: { id: id(200), name: '厂家规格', kind: 'type', revision: 3, status: { code: 'draft', reason: null },
      updated: '2026-11-18T00:00:00Z', parent: null, source: { kind: 'manufacturer', reviewed: false }, subtype: null,
      validation: { status: 'missing', missing: ['minimum_thickness'] }, version: null },
    check_details: 'source.index 指向当前页 data.sources，archive_url 指向完整保存来源。',
    sources: [{ kind: 'saved_run', channel: 'standards', run_id: id(500), study_id: id(400), workspace_id: WORKSPACE,
      case_id: 'case-0', workspace_revision: 3, study_revision: 2, status: 'succeeded', freshness: 'current', engineering_approval: false,
      method: { plugin_id: 'cablesim.standard-check', version: '1.2.0', capability: 'dimensions', release_digest: SHA },
      input_digest: SHA, output_digest: PREVIEW_DIGEST, archive_url: `/api/workspaces/${WORKSPACE}/studies/${id(400)}/runs/${id(500)}?view=full` }],
    items: [{ section: 'checks', id: 'standards/thickness', channel: 'standards', blocking: true, excluded: false,
      message: '绝缘最薄点：缺少实测最薄点。', result: { actual: null, actual_unrounded: null, design_actual: 4.5, limit: 3.95,
        unit: 'mm', margin: null, satisfied: false, comparison: 'minimum', verdict: 'missing', source_status: 'verified',
        missing_parameters: ['measurement'], basis_missing_fields: [{ field: 'measurement', label: '实测最薄点', required: true, unit: 'mm' }] }, source: { index: 0 } },
    { section: 'checks', id: 'geometry/mass', channel: 'geometry', blocking: true, excluded: false, message: '缺少材料密度，不能给出质量。',
      result: { status: 'missing', actual: null, limit: 0, unit: 'kg/km', missing: ['material_density'] },
      quantities: [{ entity: 'layer/1', mass_kg_per_km: null, quantity_missing: ['材料密度'] }], source: { index: 0 } },
    { section: 'runs', run_id: id(500), study_id: id(400), channel: 'standards', source: { run_id: id(500), study_id: id(400), channel: 'standards',
      status: 'succeeded', workspace_revision: 3, study_revision: 2, engineering_approval: false,
      method: { plugin_id: 'cablesim.standard-check', version: '1.2.0', capability: 'dimensions', release_digest: SHA },
      input_digest: SHA, output_digest: PREVIEW_DIGEST, archive_url: `/api/workspaces/${WORKSPACE}/studies/${id(400)}/runs/${id(500)}?view=full` } }],
  };
  const source = frozen(result(data));
  const original = JSON.stringify(source);
  const { reply } = observe('type_read', source, { type_id: id(200), view: 'runs', after: 0, limit: 20 });
  for (let index = 0; index < 2; index += 1) {
    assert.deepEqual(reply.data.items[index].result, data.items[index].result);
    assert.deepEqual(reply.data.items[index].source, { index: 0 });
    assert.equal(reply.data.items[index].blocking, true);
    assert.equal(reply.data.items[index].excluded, false);
  }
  assert.deepEqual(reply.data.items[1].quantities, data.items[1].quantities);
  const { input_digest: _input, output_digest: _output, archive_url: _archive, ...identity } = data.sources[0];
  assert.deepEqual(reply.data.sources, [identity]);
  assert.deepEqual(reply.data.sources[0].method, data.sources[0].method);
  assert.equal(reply.detail.read.arguments.result_digest, SHA);
  assert.equal(reply.data.items[2].run_id, id(500));
  assert.equal(reply.data.items[2].study_id, id(400));
  assert.equal(reply.data.items[2].channel, 'standards');
  const { input_digest: _runInput, output_digest: _runOutput, archive_url: _runArchive, run_id: _run, study_id: _study,
    channel: _channel, ...runIdentity } = data.items[2].source;
  assert.deepEqual(reply.data.items[2].source, runIdentity);
  assert.doesNotMatch(reply.data.check_details, /archive_url/);
  const { updated: _updated, parent: _parent, subtype: _subtype, version: _version, ...object } = data.object;
  assert.deepEqual(reply.data.object, object);
  assert.deepEqual(reply.data.next_page, data.next_page);
  const withoutDigest = observe('type_read', result(data, { result_digest: undefined }), { type_id: id(200), view: 'runs' });
  assert.deepEqual(withoutDigest.reply.data.sources, data.sources, 'source traces remain when no immutable response digest is available');
  assert.deepEqual(withoutDigest.reply.data.items[2].source, data.items[2].source);
  assert.equal(JSON.stringify(source), original);
});

test('workspace observations remove exact duplicate projection copies without changing explicit fields or conflicting metadata', () => {
  const fields = [{ path: '/materials/material~1soil/thermal_resistivity', label: '土壤热阻率', value: 1.234567890123456, unit: 'K·m/W' },
    { path: '/cable_types/cable_type~1ct1/cores/core~11/conductor/r20', label: '20 °C 电阻', value: 0.0000601, unit: 'ohm/m' }];
  const objects = { materials: [{ id: 'material/soil', label: '土壤', path: '/materials/material~1soil', fields: [fields[0]] }] };
  for (const facts of [{ fields }, { objects }]) {
    const data = { workspace_id: WORKSPACE, workspace_revision: 4, name: '直埋线路', view: 'requested-outline',
      coverage: { complete: false, omitted_parts: 1 }, ...facts,
      agent_projection: { workspace_id: WORKSPACE, workspace_revision: 4, name: '直埋线路', ...facts, view: 'outline',
        coverage: { complete: true, omitted_parts: 0 }, lock_summary: { total: 0 }, offset: 0, total_parts: 2, next_page: null } };
    const source = frozen(result(data));
    const original = JSON.stringify(source);
    const { reply } = observe('workspace_read', source, { workspace_id: WORKSPACE });
    assert.deepEqual(reply.data.agent_projection, { view: 'outline', coverage: data.agent_projection.coverage }, 'conflicting metadata must not overwrite either source value');
    assert.equal(reply.data.view, 'requested-outline');
    assert.deepEqual(reply.data.coverage, data.coverage);
    assert.deepEqual(reply.data.lock_summary, { total: 0 });
    assert.equal(reply.data.offset, 0);
    assert.equal(reply.data.total_parts, 2);
    assert.equal(reply.data.next_page, null);
    assert.equal(reply.detail.read.arguments.result_digest, SHA);
    if ('fields' in facts) {
      assert.deepEqual(reply.data.fields[0], fields[0]);
      assert.equal(reply.data.fields[1].value, fields[1].value);
      assert.equal(reply.data.fields[1].unit, fields[1].unit);
      assert.equal(reply.data.fields[1].display_value, 0.0601);
      assert.equal(reply.data.fields[1].display_unit, 'Ω/km');
    } else assert.deepEqual(reply.data.objects, objects);
    assert.equal(JSON.stringify(source), original);
  }
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

test('the generic hard boundary preserves uncertain or failed business execution even when the read itself succeeded', () => {
  for (const status of ['failed', 'uncertain', 'interrupted']) {
    const source = frozen(result({ verbose: 'unexpected full result branch'.repeat(20_000), receipt: {
      status, executed: true, complete: false, may_have_written: true, engineering_approval: false,
      error: { code: 'SAVED_ACTION_INCOMPLETE', message: '完整诊断'.repeat(12_000) }, missing: ['manufacturer_measurement'],
      result: { status: 'failed', checks: { integrity: 'verified', engineering_approval: false } },
    } }));
    for (const text of [observe('resource_read', source, { workspace_id: WORKSPACE }).text, resultText(source)]) {
      const reply = parsed(text);
      const receipt = (reply.value ?? reply).data.receipt;
      assert.equal((reply.value ?? reply).status, 'ok');
      for (const key of ['status', 'executed', 'complete', 'may_have_written', 'engineering_approval'])
        assert.equal(receipt[key], source.data.receipt[key]);
      assert.equal(receipt.error.code, 'SAVED_ACTION_INCOMPLETE');
      assert.equal(receipt.missing_count, 1);
      assert.equal(receipt.result.status, 'failed');
      assert.equal(receipt.result.checks.engineering_approval, false);
    }
  }
});

test('result JSON Pointers remain copyable while actual local paths in diagnostics are scrubbed', () => {
  const data = { projection: 'result_page', source: { response_digest: SHA },
    page: { view: '/data', items: [{ path: '/data/manufacturer~1source', value: 0.0000601 },
      { path: '/data/receipt', omitted: true, children: ['/data/receipt/items', '/data/receipt/next_read'], total_children: 2 }], total: 3, complete: false, next_offset: 2 },
    next_read: { tool: 'resource_read', arguments: { result_view: '/data', result_offset: 1, result_digest: SHA } },
  };
  const projected = modelResult(tool('resource_read'), { workspace_id: WORKSPACE, result_view: '/data', result_digest: SHA },
    frozen(result(data, { diagnostics: [{ code: 'SOURCE_NOTE', message: 'Local failure /data/private-run/secret.json', path: '/tmp/source.json' }] })));
  const reply = parsed(resultText(projected, ['/data/private-run']));
  assert.equal(reply.data.page.view, '/data');
  assert.equal(reply.data.page.items[0].path, '/data/manufacturer~1source');
  assert.deepEqual(reply.data.page.items[1].children, ['/data/receipt/items', '/data/receipt/next_read']);
  assert.equal(reply.data.next_read.arguments.result_view, '/data');
  assert.equal(reply.detail.read.arguments.result_view, '');
  assert.doesNotMatch(JSON.stringify(reply.diagnostics), /private-run|source\.json/);
  assert.match(JSON.stringify(reply.diagnostics), /本机路径/);
  const arbitrary = parsed(resultText({ data: {
    ordinary: { tool: 'untrusted', arguments: { view: '/data/private-run/secret.json', result_view: '/tmp/secret.json' } },
    namedLikeRead: { tool: 'resource_read', arguments: { view: '/data/private-run/secret.json' } },
    next_read: { tool: 'untrusted', arguments: { view: '/data/private-run/secret.json' } },
    ordinaryDirectory: { children: ['/data/private-run/secret.json'] },
    ordinaryMetadata: { checks_path: '/data/private-run/secret.json', omitted_paths: ['/tmp/secret.json'] },
  } }, ['/data/private-run']));
  assert.doesNotMatch(JSON.stringify(arbitrary), /private-run|secret\.json/,
    'a tool-shaped ordinary value cannot exempt local paths from scrubbing');
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

test('ended type pages keep counts, explicit missing labels and exact read references while the current turn stays complete', () => {
  const source = result({ type_id: id(200), type_revision: 4, view: 'runs', total: 65,
    next_page: { after: 6, limit: 20, expected_revision: 4 },
    sources: [{ run_id: id(500), study_id: id(400), channel: 'standards', status: 'succeeded', input_digest: SHA, output_digest: PREVIEW_DIGEST }],
    items: Array.from({ length: 6 }, (_, index) => ({ section: 'checks', id: `standards/check-${index}`, channel: 'standards',
      blocking: true, excluded: false, message: `第 ${index + 1} 层最薄点：` + '保存标称值不能代替可追溯的厂家实测，需先补齐来源。'.repeat(8),
      result: { actual: null, limit: 3.95, unit: 'mm', verdict: 'missing', missing_parameters: ['minimum_thickness'],
        basis_missing_fields: [{ field: 'measurement', label: '厂家实测最薄点', required: true }] }, source: { index: 0 } })),
  });
  const old = observe('type_read', source, { type_id: id(200), view: 'runs', after: 0, limit: 20 });
  const input = observe('workspace_read', result({ workspace_id: WORKSPACE, fields: [{ path: '/materials/material~1soil/thermal_resistivity',
    label: '土壤热阻率', value: 1.234567890123456, unit: 'K·m/W' }] }), { workspace_id: WORKSPACE });
  const toolMessage = (name: string, text: string) => ({ role: 'toolResult', toolName: name, isError: false,
    content: [{ type: 'text', text }], details: { original: 'persistent card remains exact' } });
  const messages = frozen([
    { role: 'user', content: [{ type: 'text', text: '逐项核对型号。' }] },
    toolMessage('type_read', old.text), toolMessage('workspace_read', input.text),
    { role: 'user', content: [{ type: 'text', text: '继续改条件。' }] }, toolMessage('type_read', old.text),
  ]);
  const original = JSON.stringify(messages);
  const projected = projectHistory(messages, [tool('type_read'), tool('workspace_read')], []);
  const history = parsed(projected[1].content[0].text);
  assert.ok(projected[1].content[0].text.length < old.text.length);
  assert.equal(history.data.total, 65);
  assert.equal(history.data.page_item_count, 6);
  assert.equal(history.data.check_summary.count, 6);
  assert.equal(history.data.check_summary.blocking_count, 6);
  assert.equal(history.data.check_summary.missing_check_count, 6);
  assert.deepEqual(history.data.check_summary.verdict_counts, { missing: 6 });
  assert.deepEqual(history.data.check_summary.explicit_missing_labels, ['minimum_thickness', '厂家实测最薄点']);
  assert.deepEqual(history.data.items, []);
  assert.equal(history.data.sources[0].run_id, id(500));
  assert.deepEqual(history.detail.read, old.reply.detail.read);
  assert.equal(history.detail.original_characters, old.reply.detail.original_characters);
  assert.equal(history.detail.history_summary, true);
  assert.ok('details' in projected[1] && 'details' in messages[1]);
  assert.strictEqual(projected[1].details, messages[1].details);
  assert.strictEqual(projected[2], messages[2], 'explicit workspace fields remain available for the next exact edit');
  assert.strictEqual(projected[4], messages[4], 'all current-turn checks, values and reasons stay byte-for-byte complete');
  assert.equal(JSON.stringify(messages), original);
  assert.deepEqual(projectHistory(projected, [tool('type_read'), tool('workspace_read')], []), projected);
});

test('ended saved runs shrink even above the history target without losing exact quantities, qualifications or long limitations', () => {
  const soil = { path: '/materials/material~1soil/thermal_resistivity', label: '土壤热阻率', value: 1.234567890123456, unit: 'K·m/W' };
  const run = { workspace_id: WORKSPACE, study_id: STUDY, run_id: id(500), status: 'succeeded', freshness: 'current',
    input_digest: SHA, output_digest: PREVIEW_DIGEST, case_input_digest: SHA, input_fields: [soil],
    headlines: [{ key: 'ampacity', title: '回路允许电流', entity: 'circuit/1', condition: 'rating', value: 701.4123456789, unit: 'A' },
      { key: 'conductor_temperature', title: '导体温度', entity: 'cable/1', condition: 'operating', value: 344.6543210987, unit: 'K' }],
    limitations: ['Limited applicability; no engineering approval. '.repeat(20)],
    checks: { integrity: 'verified', engineering_approval: false, numerical: { status: 'passed', tolerance_k: 0.01 },
      artifact_status: { 'case-0': { 'temperature-field': { status: 'unverified', reason: '当前工件仅供参考。' } } } },
    assessment: [{ case_id: 'case-0', status: 'missing', meets_target: false, missing: ['target_current'], reason: '缺少目标电流，不能给出满足性结论。' }],
    cases: Array.from({ length: 3 }, (_, index) => ({ case_id: `case-${index}`, status: index === 2 ? 'failed' : 'succeeded',
      ...(index === 2 ? { error: { code: 'INPUT_MISSING', message: '另一个工况缺少输入。' } } : {}),
      limitations: ['仅用于声明的边界。'],
      results: [{ key: 'ampacity', entity: 'circuit/1', condition: 'rating', value: 701.4123456789, unit: 'A' }],
      factors: Array.from({ length: 7 }, (_, position) => ({ key: position === 0 ? 'limiting_cable' : `loss-component-${position}`,
        entity: 'cable/1', condition: 'rating', value: position === 0 ? 'cable/1' : position + 0.123456789, unit: position === 0 ? '1' : 'W/m',
        statement: 'Source detail for separate component. '.repeat(2) })),
    })),
  };
  const assumptions = ['Keep every declared operating limitation and source qualification. '.repeat(55)];
  const receipt = observe('propose_study_run', result({ proposal: { id: id(7), title: '重算直埋线路', status: 'approved',
    changes: [], checks: [], assumptions }, receipt: { kind: 'run', status: 'succeeded', executed: true,
    run_id: run.run_id, study_id: STUDY, result: run } }), { workspace_id: WORKSPACE, study_id: STUDY }, 'propose');
  const reading = observe('run_read', result(run), { workspace_id: WORKSPACE, study_id: STUDY, run_id: run.run_id });
  const study = observe('study_read', result({ workspace_id: WORKSPACE, study_id: STUDY, driver: { kind: 'single' },
    definition: { title: '直埋线路', method: { plugin_id: 'cablesim.iec60287', version: '1.2.0' }, parameters: { notes: 'Repeated parameter details. '.repeat(80) } },
    input_fields: [soil], parameter_fields: [{ path: '/parameters/rating_mode', label: '额定口径', value: 'both' }],
    cases: [{ case_id: 'case-0', label: '直埋', parameters: { notes: 'Repeated parameter details. '.repeat(30) } }] }),
  { workspace_id: WORKSPACE, study_id: STUDY });
  const message = (name: string, text: string) => ({ role: 'toolResult', toolName: name, content: [{ type: 'text', text }], details: { fullRun: run } });
  const messages = frozen([
    { role: 'user', content: [{ type: 'text', text: '读取并重算。' }] }, message('propose_study_run', receipt.text),
    message('run_read', reading.text), message('study_read', study.text),
    { role: 'user', content: [{ type: 'text', text: '将土壤热阻率改为 1.2 再比较。' }] }, message('run_read', reading.text),
  ]);
  const original = JSON.stringify(messages);
  const projected = projectHistory(messages, [tool('propose_study_run', 'propose'), tool('run_read'), tool('study_read')], []);
  assert.ok(receipt.text.length > 9000, `exercise the large real-shaped receipt, got ${receipt.text.length}`);
  const prior = parsed(projected[1].content[0].text);
  assert.ok(projected[1].content[0].text.length > 4000, 'all declared assumptions take precedence over the optional history target');
  assert.ok(projected[1].content[0].text.length < receipt.text.length);
  assert.equal(prior.detail.history_target_characters, 4000);
  assert.equal(prior.detail.character_limit, 12000);
  assert.equal(prior.detail.byte_limit, 18000);
  assert.deepEqual(prior.detail.read, receipt.reply.detail.read);
  assert.equal(prior.detail.original_characters, receipt.reply.detail.original_characters);
  assert.deepEqual(prior.data.proposal.assumptions, assumptions);
  for (const retained of [prior.data.receipt.result, parsed(projected[2].content[0].text).data]) {
    assert.equal(retained.run_id, run.run_id);
    assert.equal(retained.study_id, STUDY);
    assert.equal(retained.checks.engineering_approval, false);
    assert.deepEqual(retained.checks.artifact_status, run.checks.artifact_status);
    assert.deepEqual(retained.assessment, run.assessment);
    assert.deepEqual(retained.limitations, run.limitations);
    assert.deepEqual(retained.input_fields, [soil]);
    for (let index = 0; index < run.headlines.length; index += 1)
      for (const [key, value] of Object.entries(run.headlines[index])) assert.deepEqual(retained.headlines[index][key], value);
    assert.equal(retained.cases[2].status, 'failed');
    assert.equal(retained.cases[2].error.code, 'INPUT_MISSING');
    assert.equal(retained.cases[0].factors[0].value, 'cable/1');
    assert.equal(retained.cases[0].results, undefined);
  }
  const priorStudy = parsed(projected[3].content[0].text);
  assert.deepEqual(priorStudy.data.input_fields, [soil]);
  assert.deepEqual(priorStudy.data.parameter_fields, study.reply.data.parameter_fields);
  assert.equal(priorStudy.data.definition.parameters, undefined);
  assert.deepEqual(priorStudy.detail.read, study.reply.detail.read);
  assert.strictEqual(projected[5], messages[5]);
  assert.ok('details' in projected[1] && 'details' in messages[1]);
  assert.strictEqual(projected[1].details, messages[1].details);
  assert.equal(JSON.stringify(messages), original);
});

test('history keeps short plain text and images untouched, bounds all text parts together, and labels long SDK diagnostics as errors', () => {
  const short = { role: 'toolResult', toolName: 'read', content: [{ type: 'text', text: '技能正文。' }, { type: 'image', data: 'unchanged', mimeType: 'image/png' }] };
  const sdk = { role: 'toolResult', toolName: 'read', isError: true,
    content: [{ type: 'text', text: JSON.stringify({ code: 'SDK_VALIDATION_FAILED', message: '错误诊断📎'.repeat(15_000) }) }] };
  const multi = { role: 'toolResult', toolName: 'read', isError: false, content: [
    { type: 'text', text: 'A'.repeat(8_000) }, { type: 'image', data: 'unchanged', mimeType: 'image/png' },
    { type: 'text', text: 'B'.repeat(8_000) },
  ] };
  const messages = frozen([{ role: 'user', content: [{ type: 'text', text: '先读取。' }] }, short, sdk, multi,
    { role: 'user', content: [{ type: 'text', text: '继续。' }] }]);
  const original = JSON.stringify(messages);
  const projected = projectHistory(messages, [], []);
  assert.strictEqual(projected[1], short);
  const error = parsed(projected[2].content[0].text!);
  assert.equal((error.value ?? error).status, 'error');
  assert.equal((error.value ?? error).code, 'SDK_VALIDATION_FAILED');
  assert.ok('isError' in projected[2]);
  assert.equal(projected[2].isError, true);
  const combined = projected[3].content.filter(part => part.type === 'text').map(part => part.text).join('\n');
  parsed(combined);
  assert.strictEqual(projected[3].content[1], multi.content[1]);
  assert.equal(JSON.stringify(messages), original);
});

test('a changed old tool prefix invalidates stale SDK usage and accepts the next real response without changing stored accounting', () => {
  const body = observe('type_read', result({ type_id: id(200), type_revision: 3, view: 'runs', total: 65,
    items: Array.from({ length: 6 }, (_, index) => ({ section: 'checks', id: `check-${index}`, blocking: true,
      message: '完整逐项依据已在该用户回合读取。'.repeat(20), result: { status: 'missing', actual: null, unit: 'mm', missing: ['实测最薄点'] } })) }),
  { type_id: id(200), view: 'runs' });
  const assistant = (timestamp: number, input: number): AssistantMessage => ({ role: 'assistant', timestamp,
    api: 'openai-completions', provider: 'test', model: 'sdk-accounting-regression', stopReason: 'stop',
    content: [{ type: 'text', text: '已读取保存事实，缺项未当作通过。' }],
    usage: { input, output: 10, cacheRead: 7, cacheWrite: 3, totalTokens: input + 20,
      cost: { input: 0.1, output: 0.001, cacheRead: 0.0001, cacheWrite: 0.0002, total: 0.1013 } } });
  for (const currentTime of [2000, 1200]) {
    const stored: Message[] = frozen([
      { role: 'user', timestamp: 1000, content: '逐项读取型号。' }, assistant(1100, 2000),
      { role: 'toolResult', timestamp: 1150, toolCallId: 'saved-page', toolName: 'type_read', isError: false,
        content: [{ type: 'text', text: body.text }], details: { card: 'persistent complete card' } },
      { role: 'toolResult', timestamp: 1160, toolCallId: 'short-skill', toolName: 'read', isError: false,
        content: [{ type: 'text', text: '短技能正文保持原样。' }] },
      assistant(1200, 50_000), { role: 'user', timestamp: currentTime, content: '继续下一项工作。' },
    ]);
    const original = JSON.stringify(stored);
    const before = estimateContextTokens(stored);
    assert.equal(before.lastUsageIndex, 4);
    assert.equal(before.usageTokens, 50_020);
    const projected = projectHistory(stored, [tool('type_read')], []);
    const barrier = currentTime === 1200 ? 1201 : currentTime;
    assert.equal(projected[2].timestamp, barrier, 'equal-millisecond old responses must be strictly older than the edited prefix');
    assert.ok('details' in projected[2] && 'details' in stored[2]);
    assert.strictEqual(projected[2].details, stored[2].details);
    assert.strictEqual(projected[3], stored[3], 'an unchanged old result keeps its real original timestamp');
    assert.strictEqual(projected[4], stored[4], 'usage values and billing records are never zeroed, removed or rewritten');
    const after = estimateContextTokens(projected);
    assert.equal(after.lastUsageIndex, 1, 'only the older response before the changed tool remains an applicable usage anchor');
    assert.equal(after.usageTokens, 2020);
    assert.ok(after.tokens < before.tokens);
    const fresh = assistant(barrier, 12_000);
    const currentTool: Message = { role: 'toolResult', timestamp: barrier + 1, toolCallId: 'current-page', toolName: 'type_read', isError: false,
      content: [{ type: 'text', text: body.text }], details: { card: 'current complete card' } };
    const resumed = projectHistory(frozen([...stored, fresh, currentTool]), [tool('type_read')], []);
    const accounted = estimateContextTokens(resumed);
    assert.equal(accounted.lastUsageIndex, 6, 'a new actual assistant response at or after the barrier resumes normal accounting');
    assert.equal(accounted.usageTokens, fresh.usage.totalTokens);
    assert.strictEqual(resumed[6], fresh);
    assert.strictEqual(resumed[7], currentTool, 'current-turn facts and timestamps remain unmodified');
    assert.equal(JSON.stringify(stored), original);
    assert.deepEqual(projectHistory(projected, [tool('type_read')], []), projected);
  }
  const untimed = frozen([{ role: 'user', content: [{ type: 'text', text: '第一问。' }] },
    { role: 'toolResult', toolName: 'type_read', timestamp: 1150, content: [{ type: 'text', text: body.text }] },
    { role: 'user', content: [{ type: 'text', text: '没有保存真实时间。' }] }]);
  const projected = projectHistory(untimed, [tool('type_read')], []);
  assert.equal(projected[1].timestamp, 1150, 'missing real user timestamps must not be replaced with a fabricated clock value');
});

test('identical old reads and complete skills reference a still-visible original, preserving each read digest and current-turn evidence', () => {
  const source = result({ study_id: STUDY, revision: 3, input_fields: [{ path: '/materials/material~1soil/thermal_resistivity',
    value: 1.234567890123456, unit: 'K·m/W' }], definition: { title: '直埋线路', parameters: { notes: '完整参数依据。'.repeat(120) } } });
  const observed = observe('study_read', source, { workspace_id: WORKSPACE, study_id: STUDY });
  const differentDigest = structuredClone(observed.reply);
  differentDigest.detail.read.arguments.result_digest = PREVIEW_DIGEST;
  const differentData = structuredClone(observed.reply);
  differentData.data.input_fields[0].value = 1.5;
  const skill = '---\nname: ampacity-rating\n---\n必须保留来源、缺项与人工审阅。\n'.repeat(20);
  const message = (id: string, name: string, text: string) => ({ role: 'toolResult', toolCallId: id, toolName: name,
    timestamp: 1100, isError: false, content: [{ type: 'text', text }], details: { card: 'full persistent evidence' } });
  const messages = frozen([{ role: 'user', timestamp: 1000, content: [{ type: 'text', text: '读取研究。' }] },
    message('study-first', 'study_read', observed.text), message('skill-first', 'read', skill),
    { role: 'user', timestamp: 2000, content: [{ type: 'text', text: '再次核对相同研究。' }] },
    message('study-repeat', 'study_read', observed.text), message('skill-repeat', 'read', skill),
    message('different-digest', 'study_read', JSON.stringify(differentDigest)), message('different-data', 'study_read', JSON.stringify(differentData)),
    { role: 'user', timestamp: 3000, content: [{ type: 'text', text: '现在继续。' }] },
    message('study-current', 'study_read', observed.text), message('skill-current', 'read', skill)]);
  const before = JSON.stringify(messages);
  const projected = projectHistory(messages, [tool('study_read')], []);
  const repeated = parsed(projected[4].content[0].text);
  assert.deepEqual(repeated.data_ref, { tool_call_id: 'study-first', path: '/data' });
  assert.equal(repeated.status, 'ok');
  assert.deepEqual(repeated.detail.read, observed.reply.detail.read);
  assert.equal(repeated.detail.original_characters, observed.reply.detail.original_characters);
  assert.equal(parsed(projected[1].content[0].text).data.input_fields[0].value, 1.234567890123456);
  assert.deepEqual(parsed(projected[5].content[0].text).history_ref, { tool_call_id: 'skill-first' });
  assert.strictEqual(projected[2], messages[2], 'the one complete copy of the skill rules remains in this provider prefix');
  assert.equal(parsed(projected[6].content[0].text).data_ref, undefined, 'different source digests cannot be folded together');
  assert.equal(parsed(projected[7].content[0].text).data_ref, undefined, 'different exact quantities cannot be folded together');
  assert.strictEqual(projected[9], messages[9]);
  assert.strictEqual(projected[10], messages[10]);
  assert.ok('details' in projected[4] && 'details' in messages[4]);
  assert.strictEqual(projected[4].details, messages[4].details);
  assert.equal(JSON.stringify(messages), before);
  assert.deepEqual(projectHistory(projected, [tool('study_read')], []), projected);
  const withoutFirst = messages.filter((_, index) => index !== 1 && index !== 2);
  const retained = projectHistory(withoutFirst, [tool('study_read')], []);
  const read = retained.find(message => 'toolCallId' in message && message.toolCallId === 'study-repeat')!;
  const rules = retained.find(message => 'toolCallId' in message && message.toolCallId === 'skill-repeat')!;
  assert.equal(parsed(read.content[0].text).data_ref, undefined, 'a removed prefix is not a usable data reference');
  assert.equal(rules.content[0].text, skill, 'a removed first skill is replaced by the remaining full original, never a dangling reference');
});

function typeHistoryFixture(large = false) {
  const channels = ['standards', 'electrical', 'short_circuit', 'geometry', 'cad'];
  const origins = channels.map((channel, index) => ({ channel, run_id: id(500 + index), study_id: id(400 + index),
    workspace_revision: 3, study_revision: 1, case_id: 'case-0', status: 'succeeded', freshness: 'current', engineering_approval: false,
    method: { plugin_id: `cablesim.${channel}`, version: '1.2.0', capability: 'saved-check', release_digest: SHA,
      ...(large ? { qualification: 'Complete saved method qualification. '.repeat(30) } : {}) } }));
  const overview = { section: 'overview', construction: 'three_core',
    base_reference: { name: '保存型号', source: large ? 'Full original engineering applicability statement. '.repeat(140)
      : '仅为保存标称模型；标准上限不能当作厂家实测，缺项不能判为通过。'.repeat(30) },
    source: { kind: 'saved_type_input', type_id: id(200), revision: 3, digest: SHA } };
  const check = (index: number) => ({ section: 'checks', id: `standards/check-${index}`, channel: 'standards',
    blocking: index !== 1, excluded: index === 1, ...(index === 2 ? { status: 'failed' } : {}),
    message: `第 ${index + 1} 项保存核对：` + '原始标准依据与缺项说明不得推断为通过。'.repeat(6),
    result: index === 0 ? { status: 'missing', actual: null, limit: 3.95, unit: 'mm', missing_parameters: ['minimum_thickness'] }
      : index === 1 ? { verdict: 'uncovered', actual: 0, limit: 0, unit: 'mm', satisfied: false,
        basis_missing_fields: [{ field: 'fault_return_path', label: '故障回流模型', required: true }] }
      : { verdict: 'failed', actual: 4.1, limit: 4.5, margin: -0.4, unit: 'mm' }, source: { index: 0 } });
  const chunks = [[overview, check(0)], [check(1), check(2)], origins.map(origin => ({ section: 'runs',
    run_id: origin.run_id, study_id: origin.study_id, channel: origin.channel, source: origin }))];
  const offsets = [0, 2, 4];
  const pages = chunks.map((items, index) => observe('type_read', result({ object: { id: id(200), name: '保存型号', kind: 'type', revision: 3, status: { code: 'draft' } },
    type_id: id(200), type_revision: 3, view: 'runs', total: 9, items, sources: index < 2 ? [origins[0]] : [],
    next_page: index === 2 ? null : { type_id: id(200), view: 'runs', after: offsets[index + 1], limit: 20, expected_revision: 3 },
  }, { result_digest: String(index + 1).repeat(64) }), { type_id: id(200), view: 'runs', limit: 20,
    ...(index ? { after: offsets[index], expected_revision: 3 } : {}) }));
  const messages = [{ role: 'user', timestamp: 1000, content: [{ type: 'text', text: '读全型号核对。' }] },
    ...pages.map((page, index) => ({ role: 'toolResult', toolCallId: `page-${index}`, toolName: 'type_read', timestamp: 1100 + index,
      isError: false, content: [{ type: 'text', text: page.text }], details: { original: page.reply.data } })),
    { role: 'user', timestamp: 2000, content: [{ type: 'text', text: '下一项工作。' }] },
    { role: 'toolResult', toolCallId: 'current-page', toolName: 'type_read', timestamp: 2100, isError: false,
      content: [{ type: 'text', text: pages[0].text }], details: { original: pages[0].reply.data } }];
  return { pages, messages };
}

test('one completed type pagination chain becomes an explicit historical read summary with all states, limitations, run identities and original readers', () => {
  const { pages, messages } = typeHistoryFixture();
  frozen(messages);
  const original = JSON.stringify(messages);
  const projected = projectHistory(messages, [tool('type_read')], []);
  const first = parsed(projected[1].content[0].text);
  assert.equal(first.data.history_aggregate, 'completed_type_pages');
  assert.equal(first.data.read_complete, true);
  assert.equal(first.data.read_page_count, 3);
  assert.equal(first.data.read_item_count, 9);
  assert.equal(first.data.total, 9);
  assert.equal(first.data.check_summary.count, 3);
  assert.equal(first.data.check_summary.blocking_count, 2);
  assert.equal(first.data.check_summary.blocking_unknown_count, 0);
  assert.equal(first.data.check_summary.excluded_count, 1);
  assert.equal(first.data.check_summary.missing_check_count, 2);
  assert.deepEqual(first.data.check_summary.check_status_counts, { failed: 1 });
  assert.deepEqual(first.data.check_summary.result_status_counts, { missing: 1 });
  assert.deepEqual(first.data.check_summary.verdict_counts, { uncovered: 1, failed: 1 });
  assert.deepEqual(first.data.check_summary.explicit_missing_labels, ['minimum_thickness', '故障回流模型']);
  assert.deepEqual(first.data.items[0], pages[0].reply.data.items[0], 'the full original applicability statement stays visible');
  assert.deepEqual(first.data.items.slice(1), pages[2].reply.data.items, 'all five saved runs retain exact sealed methods, qualifications and revisions');
  assert.equal(first.data.object.status.code, 'draft');
  assert.match(first.summary, /已读完不表示工程通过/);
  for (let index = 0; index < pages.length; index += 1) {
    const value = parsed(projected[index + 1].content[0].text);
    assert.deepEqual(value.detail.read, pages[index].reply.detail.read);
    assert.equal(value.detail.original_characters, pages[index].reply.detail.original_characters);
    if (index) assert.deepEqual(value.data_ref, { tool_call_id: 'page-0', path: '/data' });
    const projectedMessage = projected[index + 1];
    const originalMessage = messages[index + 1];
    assert.ok('details' in projectedMessage && 'details' in originalMessage);
    assert.strictEqual(projectedMessage.details, originalMessage.details);
  }
  assert.strictEqual(projected[5], messages[5], 'the current user turn is never aggregated');
  assert.equal(JSON.stringify(messages), original);
  assert.deepEqual(projectHistory(projected, [tool('type_read')], []), projected);
});

test('incomplete, reordered, changed-source, cross-turn, failed or oversized type histories are not aggregated', () => {
  const change = (messages: ReturnType<typeof typeHistoryFixture>['messages'], index: number, edit: (value: any) => void) => {
    const value = JSON.parse(messages[index].content[0].text);
    edit(value);
    messages[index].content[0].text = JSON.stringify(value);
  };
  const variants: [string, (messages: ReturnType<typeof typeHistoryFixture>['messages']) => void][] = [
    ['missing page', messages => { messages.splice(2, 1); }],
    ['reordered pages', messages => { [messages[1], messages[2]] = [messages[2], messages[1]]; }],
    ['different revision', messages => change(messages, 2, value => { value.data.type_revision = 4; })],
    ['invalid digest', messages => change(messages, 2, value => { value.detail.read.arguments.result_digest = 'invalid'; })],
    ['cursor gap', messages => change(messages, 2, value => { value.detail.read.arguments.after = 3; })],
    ['nonterminal page', messages => change(messages, 3, value => { value.data.next_page = { after: 9 }; })],
    ['tool error', messages => change(messages, 2, value => { value.status = 'error'; })],
    ['truncated evidence', messages => change(messages, 2, value => { value.detail.truncated = true; })],
    ['different run', messages => change(messages, 2, value => { value.data.sources[0].run_id = id(999); })],
    ['different sealed method', messages => change(messages, 2, value => { value.data.sources[0].method.release_digest = PREVIEW_DIGEST; })],
    ['different freshness', messages => change(messages, 2, value => { value.data.sources[0].freshness = 'stale'; })],
    ['separate user turns', messages => { messages.splice(2, 0, { role: 'user', timestamp: 1500, content: [{ type: 'text', text: '另一个回合。' }] }); }],
  ];
  for (const [label, mutate] of variants) {
    const { messages } = typeHistoryFixture();
    mutate(messages);
    frozen(messages);
    const before = JSON.stringify(messages);
    const projected = projectHistory(messages, [tool('type_read')], []);
    for (const message of projected.filter(message => message.role === 'toolResult'))
      assert.equal(parsed(message.content[0].text).data?.history_aggregate, undefined, label);
    assert.equal(JSON.stringify(messages), before, label);
  }
  const { messages } = typeHistoryFixture(true);
  const projected = projectHistory(frozen(messages), [tool('type_read')], []);
  for (const message of projected.filter(message => message.role === 'toolResult'))
    assert.equal(parsed(message.content[0].text).data?.history_aggregate, undefined, 'a long aggregate must retain individual pages rather than truncate source limitations');
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
