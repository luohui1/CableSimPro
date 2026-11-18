import test from 'node:test';
import assert from 'node:assert/strict';
import { savedTypeRunDestination } from '../src/lib/saved-run-destination.ts';

const identity = { workspaceId: 'saved-workspace', studyId: 'saved-study', runId: 'saved-run' };
const release = 'a'.repeat(64);
function saved(plugin = 'cablesim.standard-check', capability = 'dimensions') {
  return {
    id: identity.runId, workspace: identity.workspaceId, study: identity.studyId,
    status: 'succeeded', integrity: 'verified', freshness: 'historical',
    input_digest: 'b'.repeat(64), output_digest: 'c'.repeat(64),
    snapshot: {
      workspace_id: identity.workspaceId, study_id: identity.studyId, workspace_revision: 2, study_revision: 3,
      workspace_state: { type_origin_reference: { id: 'saved-origin' }, study_cable_reference: null, domain: { cable_types: [{ id: 'saved-cable' }] } },
      definition: { method: { plugin_id: plugin, capability, version: '1.2.3', release_digest: release }, driver: { kind: 'single', cases: [] }, input_source: 'domain' },
    },
  };
}
function resolve(run) { return savedTypeRunDestination(run, identity); }
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

test('保存型号方法按精确插件与能力进入五种只读结果，结构进入数量页', () => {
  const cases = [
    ['cablesim.standard-check', 'dimensions', 'standard-check', 'results'],
    ['cablesim.type-electrical', 'electrical', 'electrical', 'results'],
    ['cablesim.type-electrical', 'short-circuit', 'short-circuit', 'results'],
    ['cablesim.cable-geometry', 'concentric-model', 'structure', 'quantities'],
  ];
  for (const [plugin, capability, module, tab] of cases)
    assert.deepEqual(resolve(freeze(saved(plugin, capability))), { module, tab });
  const rating = saved('cablesim.iec60287', 'steady-rating');
  rating.snapshot.definition.driver = { kind: 'batch', cases: [{ metadata: { kind: 'type-rating-table' } }, { metadata: { kind: 'type-rating-table' } }] };
  assert.deepEqual(resolve(freeze(rating)), { module: 'rating-table', tab: 'results' });
});

test('同一插件的其他能力与未知方法不落到载流量或当前结果', () => {
  for (const [plugin, capability] of [
    ['cablesim.type-electrical', 'dimensions'], ['other-plugin', 'electrical'],
    ['cablesim.standard-check', 'electrical'], ['cablesim.cable-geometry', 'other-geometry'],
  ]) assert.throws(() => resolve(saved(plugin, capability)), /尚无对应的只读结果入口/);
});

test('精确运行、保存快照及两个修订均验证，跨工程或跨研究证据不能串接', () => {
  const changes = [
    run => { run.id = 'another-run'; }, run => { run.workspace = 'another-workspace'; },
    run => { run.study = 'another-study'; }, run => { run.integrity = 'mismatch'; },
    run => { run.snapshot.workspace_id = 'another-workspace'; },
    run => { run.snapshot.study_id = 'another-study'; },
    run => { run.snapshot.workspace = 'contradictory-workspace'; },
    run => { run.snapshot.study = 'contradictory-study'; },
    run => { run.snapshot.workspace_revision = 0; }, run => { run.snapshot.study_revision = 1.5; },
    run => { delete run.snapshot.study_revision; }, run => { delete run.snapshot; },
  ];
  for (const change of changes) { const run = saved(); change(run); assert.throws(() => resolve(run)); }
  assert.throws(() => savedTypeRunDestination(saved(), { ...identity, runId: '' }));
  const pending = saved(); pending.status = 'running'; pending.integrity = 'pending';
  assert.throws(() => resolve(pending), /尚未通过完整性校验/);
});

test('原快照支配历史路由，不读取当前定义、当前方法或当前工程状态', () => {
  const run = saved('cablesim.type-electrical', 'short-circuit');
  run.definition = { method: { plugin_id: 'cablesim.iec60287', capability: 'steady-rating' } };
  run.method = run.definition.method;
  run.workspace_state = { study_cable_reference: { id: 'current-research' } };
  run.snapshot.workspace_state = { type_creation: { id: 'created-type' }, domain: { cable_types: [{ id: 'saved-type' }] } };
  assert.deepEqual(resolve(freeze(run)), { module: 'short-circuit', tab: 'results' });
  const failed = saved('cablesim.type-electrical', 'short-circuit');
  failed.status = 'failed'; failed.output = null;
  assert.deepEqual(resolve(freeze(failed)), { module: 'short-circuit', tab: 'results' });
  for (const key of ['plugin_id', 'capability', 'version', 'release_digest']) {
    const missing = saved(); delete missing.snapshot.definition.method[key];
    assert.throws(() => resolve(missing), /精确的方法发行或能力/);
  }
});

test('普通研究与批量研究保留研究入口，空或混合工况不能冒充型号载流量表', () => {
  const research = saved('cablesim.iec60287', 'steady-rating');
  research.snapshot.workspace_state = { study_cable_reference: { id: 'real-model' }, domain: { cable_types: [{ id: 'model' }] } };
  research.snapshot.definition.driver = { kind: 'batch', cases: [{ case_id: 'ordinary' }] };
  assert.equal(resolve(freeze(research)), null);
  for (const cases of [[], [{ case_id: 'ordinary' }], [{ metadata: { kind: 'type-rating-table' } }, { metadata: { kind: 'ordinary' } }]]) {
    const run = saved('cablesim.iec60287', 'steady-rating');
    run.snapshot.definition.driver = { kind: 'batch', cases };
    assert.throws(() => resolve(run), /尚无对应的只读结果入口/);
  }
  const wrongPin = saved('cablesim.type-electrical', 'electrical');
  wrongPin.snapshot.definition.driver = { kind: 'batch', cases: [{ metadata: { kind: 'type-rating-table' } }] };
  assert.throws(() => resolve(wrongPin), /尚无对应的只读结果入口/);
});

test('保存型号来源、研究引用与单型号文档的矛盾被明确拒绝', () => {
  for (const change of [
    state => { state.study_cable_reference = { id: 'research' }; },
    state => { state.domain.cable_types = []; },
    state => { state.domain.cable_types.push({ id: 'another' }); },
    state => { state.type_origin_reference = 'broken'; },
    state => { state.type_creation = 'broken'; },
  ]) { const run = saved(); change(run.snapshot.workspace_state); assert.throws(() => resolve(run)); }
  const projected = saved(); delete projected.snapshot.workspace_state;
  projected.snapshot.workspace_state_ref = { url: '/saved-state' };
  assert.throws(() => resolve(projected), /缺少原工程状态/);
});

test('省略工程状态仅接受绑定同一保存运行与摘要的独立研究场投影', () => {
  const field = saved('cablesim.simulation', 'iec-thermal-field');
  delete field.snapshot.workspace_state;
  field.snapshot_view = 'field-display';
  field.snapshot.definition.input_source = 'study';
  field.evidence_ref = {
    url: `/api/workspaces/${identity.workspaceId}/studies/${identity.studyId}/runs/${identity.runId}?view=full`,
    input_sha256: field.input_digest, output_sha256: field.output_digest,
  };
  assert.equal(resolve(freeze(structuredClone(field))), null);
  const changes = [
    run => { run.snapshot_view = 'inputs-on-demand'; },
    run => { run.snapshot.definition.input_source = 'domain'; },
    run => { run.evidence_ref.url = '/another-run?view=full'; },
    run => { run.evidence_ref.input_sha256 = 'd'.repeat(64); },
    run => { run.evidence_ref.output_sha256 = 'd'.repeat(64); },
    run => { delete run.input_digest; }, run => { delete run.output_digest; },
    run => { run.snapshot.workspace_state_ref = {}; },
    run => { run.snapshot.definition.method.plugin_id = 'cablesim.cable-geometry'; },
    run => { run.snapshot.definition.driver.cases = [{ metadata: { kind: 'type-rating-table' } }]; },
  ];
  for (const change of changes) { const run = structuredClone(field); change(run); assert.throws(() => resolve(run), /缺少原工程状态/); }
});
