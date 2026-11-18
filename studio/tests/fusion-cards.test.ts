// Card projection only: the saved contract is the oracle. These tests never compute an engineering result.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Backend, type ToolResult } from '../fusion/backend.ts';
import { describeResult } from '../fusion/cards.ts';

const WORKSPACE = 'workspace';
const STUDY = 'saved-study';
const RUN = 'saved-run';
const CASE = 'case-0';
const CIRCUIT = 'circuit/c1';
const CABLE = 'cable/c1-A';
const HREF = `cablesim:study/${STUDY}?workspace=${WORKSPACE}&run=${RUN}`;
const source = { run_id: RUN, case_id: CASE };
const basis = { kind: 'single_circuit', varied_circuits: [CIRCUIT], fixed_currents_a: {} };

function fixture() {
  // The seed's two saved ratings differ below display precision; both explicitly declare the same single-circuit basis.
  const current = 748.3219742774963;
  const temperature = 65.5219999639408;
  const result: ToolResult = { status: 'ok', summary: '已读取保存运行。', diagnostics: [], next_actions: [], data: {
    run_id: RUN, study_id: STUDY, status: 'succeeded',
    method: { plugin_id: 'cablesim.iec60287', capability: 'steady-rating', version: '1.2.3' },
    headlines: [
      { key: 'ampacity', case_id: CASE, condition: 'rating', entity: CIRCUIT, display_value: current, display_unit: 'A' },
      { key: 'conductor_temperature', case_id: CASE, condition: 'operating', entity: CABLE, display_value: temperature, display_unit: '°C' },
    ],
    cases: [{ case_id: CASE, status: 'succeeded', results: [
      { key: 'ampacity', entity: CIRCUIT, case: 'rating', unit: 'A', status: 'available', value: current, rating_basis: structuredClone(basis) },
      { key: 'ampacity', entity: CIRCUIT, case: 'rating-simultaneous', unit: 'A', status: 'available', value: 748.3219802379608, rating_basis: structuredClone(basis) },
    ], factors: [
      { key: 'limiting_cable', entity: CABLE, source },
      { key: 'temperature_margin', entity: CABLE, condition: 'operating', unit: 'K', value: 24.478000036059186, source },
      { key: 'current_margin', entity: CIRCUIT, condition: 'rating', unit: 'A', value: 148.32197427749634, source },
    ] }],
  } };
  const input = { run_id: RUN, case_id: CASE, integrity: 'verified', input: {
    cable_types: [{ id: 'type', rating: { max_conductor_temperature: { normal: 363.15 } } }],
    circuits: [{ id: CIRCUIT, cable_type: 'type', cables: [{ id: CABLE }] }],
    sections: [{ medium: { surface_temperature: 298.15 } }], load_cases: [{ currents: { [CIRCUIT]: 600 } as Record<string, number> }],
  } };
  const summary = { id: RUN, sequence: 2, freshness: 'historical', headline: '允许电流 748.3 A（全回路共同能力），受限于回路 1 · A 相' };
  class SavedBackend extends Backend {
    reads: string[] = [];
    read = async <T>(path: string): Promise<T> => {
      this.reads.push(path);
      if (path.includes('/runs?')) return { items: [summary], next_cursor: null } as T;
      if (path.endsWith('/input')) return input as T;
      if (path.startsWith('/api/index/objects')) return { items: [{ id: STUDY, name: '保存校核' }] } as T;
      if (path.startsWith('/api/methods')) return [{ method: { plugin_id: 'cablesim.iec60287', version: '9.0.0' }, name: 'IEC 60287 稳态载流量' }] as T;
      throw new Error(`Unexpected read: ${path}`);
    };
  }
  const backend = new SavedBackend('http://127.0.0.1:9', 'unused');
  const show = () => describeResult(backend, 'run_read', { study_id: STUDY, run_id: RUN }, result, WORKSPACE);
  return { result, input, summary, backend, show };
}

test('a verified single circuit retains the seed common-capacity card and its saved limits and method version', async () => {
  const { show } = fixture();
  const shown = await show();
  assert.equal(shown.card?.kind, 'saved_run');
  if (shown.card?.kind !== 'saved_run') return;
  assert.equal(shown.card.href, HREF);
  assert.equal(shown.card.view.current, '748.3');
  assert.equal(shown.card.view.basis, '全回路共同能力');
  assert.equal(shown.card.view.limiting.limit, 90);
  assert.equal(shown.card.view.limiting.load, '600 A');
  assert.equal(shown.card.view.limiting.margin, '148.3 A');
  assert.equal(shown.card.view.method, 'IEC 60287 稳态载流量 1.2.3');
  assert.equal(shown.card.view.freshness, 'historical');
});

test('a single individual rating remains a card without inventing a simultaneous result', async () => {
  const f = fixture();
  f.result.data.cases[0].results.pop();
  f.summary.headline = '允许电流 748.3 A（单回路能力），受限于回路 1 · A 相';
  const shown = await f.show();
  assert.equal(shown.card?.kind, 'saved_run');
  if (shown.card?.kind === 'saved_run') assert.equal(shown.card.view.basis, '单回路能力');
});

test('reading a non-recommended selection case cannot borrow the recommended headline or its numbers', async () => {
  const f = fixture();
  f.result.data.cases[0].case_id = 'requested-other-case';
  const shown = await f.show();
  assert.deepEqual(shown.card, { kind: 'open', label: '查看已保存运行', href: HREF });
  assert.match(shown.notes!.join(''), /工况.*无法唯一对应/);
  assert.deepEqual(f.backend.reads, [], 'the mismatched headline must not be combined with another case input');
});

test('a multi-case record opens the exact saved run instead of choosing its first case', async () => {
  const f = fixture();
  f.result.data.cases.push({ ...structuredClone(f.result.data.cases[0]), case_id: 'case-1' });
  const shown = await f.show();
  assert.equal(shown.card?.kind, 'open');
  assert.equal(shown.card?.href, HREF);
  assert.deepEqual(f.backend.reads, []);
});

test('a two-circuit minimum cannot be combined with the first circuit margin', async () => {
  const f = fixture();
  const second = 'circuit/c2';
  f.input.input.circuits.push({ id: second, cable_type: 'type', cables: [{ id: 'cable/c2' }] });
  f.input.input.load_cases[0].currents[second] = 400;
  f.result.data.headlines[0].entity = second;
  f.result.data.cases[0].results[0].entity = second;
  f.result.data.cases[0].factors.push({ key: 'current_margin', entity: second, condition: 'rating', unit: 'A', value: 348.3219742774963, source });
  const shown = await f.show();
  assert.equal(shown.card?.kind, 'open');
  assert.equal(shown.card?.href, HREF);
  assert.match(shown.notes!.join(''), /回路.*无法唯一对应/);
});

for (const problem of ['different_values', 'different_basis', 'missing_basis'] as const) {
  test(`rating_mode=both falls back when its saved conditions are ambiguous: ${problem}`, async () => {
    const f = fixture();
    const common = f.result.data.cases[0].results[1];
    if (problem === 'different_values') common.value = 700;
    if (problem === 'different_basis') common.rating_basis.kind = 'simultaneous_balanced';
    if (problem === 'missing_basis') delete common.rating_basis;
    const shown = await f.show();
    assert.equal(shown.card?.kind, 'open');
    assert.equal(shown.card?.href, HREF);
    assert.match(shown.notes!.join(''), /多个.*额定口径/);
  });
}

for (const problem of ['wrong_margin_entity', 'wrong_margin_condition', 'wrong_margin_case', 'different_target', 'different_temperature_limit'] as const) {
  test(`a margin or limit must belong to the same saved condition: ${problem}`, async () => {
    const f = fixture();
    const margin = f.result.data.cases[0].factors[2];
    if (problem === 'wrong_margin_entity') margin.entity = 'circuit/other';
    if (problem === 'wrong_margin_condition') margin.condition = 'rating-simultaneous';
    if (problem === 'wrong_margin_case') margin.source = { ...source, case_id: 'case-other' };
    if (problem === 'different_target') margin.value = 248.32197427749634;
    if (problem === 'different_temperature_limit') f.input.input.cable_types[0].rating.max_conductor_temperature.normal = 353.15;
    const shown = await f.show();
    assert.equal(shown.card?.kind, 'open');
    assert.equal(shown.card?.href, HREF);
    assert.match(shown.notes!.join(''), /限制对象、温限或余量/);
  });
}

test('an accepted run receipt uses the same honest fallback and keeps its saved-run link', async () => {
  const f = fixture();
  f.result.data.cases.push({ ...structuredClone(f.result.data.cases[0]), case_id: 'case-1' });
  const shown = await describeResult(f.backend, 'propose_study_run', {}, { ...f.result,
    data: { receipt: { kind: 'run', status: 'succeeded', result: f.result.data } } }, WORKSPACE);
  assert.equal(shown.card?.kind, 'open');
  assert.equal(shown.card?.href, HREF);
});

test('saved type cards display resistance in Ω/km while leaving the exact saved input and identity intact', async () => {
  const backend = new Backend('http://127.0.0.1:9', 'unused');
  for (const unit of ['ohm/m', 'Ω/m']) {
    const result: ToolResult = { status: 'ok', summary: '已读取型号保存输入。', diagnostics: [], next_actions: [], data: {
      object: { id: 'type-identity', name: '厂家型号 · 300 mm²' }, next_page: null,
      items: [{ section: 'structure', path: '/cable_types/cable~1type/cores/core~11/conductor/r20',
        label: '20 °C 直流电阻', value: 0.0000601, unit, source: { provenance: { reviewed: false } } }],
    } };
    const original = structuredClone(result);
    const shown = await describeResult(backend, 'type_read', { type_id: 'type-identity' }, result, 'type-identity');
    assert.equal(shown.card?.kind, 'saved_type');
    if (shown.card?.kind !== 'saved_type') return;
    assert.equal(shown.card.view.title, '厂家型号 · 300 mm²');
    assert.deepEqual(shown.card.view.fields, [{ label: '20 °C 直流电阻', value: '0.0601', unit: 'Ω/km',
      source: '保存的设计输入，来源待核对' }]);
    assert.equal(shown.card.href, 'cablesim:type/type-identity');
    assert.deepEqual(result, original, 'display conversion must not rewrite the saved SI value, its source or stable path');
  }
});

test('a saved comparison opens the exact two runs in the existing workbench comparison', async () => {
  const backend = new Backend('http://127.0.0.1:9', 'unused');
  const runIds = ['baseline-run', 'changed-run'];
  const result: ToolResult = { status: 'ok', summary: '已比较保存运行。', diagnostics: [], next_actions: [], data: {
    comparison: { sources: runIds.map(run_id => ({ run_id, snapshot: { workspace_id: WORKSPACE, study_id: STUDY,
      definition: { title: '保存的直埋校核' } } })) },
  } };
  const original = JSON.stringify(result);
  const shown = await describeResult(backend, 'study_compare', { run_ids: runIds }, result, WORKSPACE);
  assert.deepEqual(shown.card, { kind: 'open', label: '两次保存运行对比 · 保存的直埋校核',
    href: `cablesim:study_comparison/${STUDY}?workspace=${WORKSPACE}&compare=baseline-run%2Cchanged-run` });
  assert.equal(JSON.stringify(result), original);
  result.data.comparison.sources[1].snapshot.workspace_id = 'another-workspace';
  assert.equal((await describeResult(backend, 'study_compare', { run_ids: runIds }, result, WORKSPACE)).card, undefined,
    'mismatched saved ownership cannot become a comparison link');
  result.data.comparison.sources[1].snapshot.workspace_id = WORKSPACE;
  assert.equal((await describeResult(backend, 'study_compare', { run_ids: [...runIds].reverse() }, result, WORKSPACE)).card, undefined,
    'the comparison must preserve baseline and comparison order');
});
