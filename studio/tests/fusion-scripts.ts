// Scripted model responses for both the Node integration tests and the browser walk. The script chooses tools; every object,
// number, saved run and file comes from the real platform. A refusal terminates the script, never a fabricated success response.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { fauxAssistantMessage, fauxText, fauxToolCall, type TranscriptContext } from '@earendil-works/pi-ai';
import { scriptedModel, toolText } from './support.ts';

type Faux = Awaited<ReturnType<typeof scriptedModel>>['faux'];
type Reply = (context: TranscriptContext) => ReturnType<typeof fauxAssistantMessage>;
export interface FlowState {
  done: boolean;
  failure?: string;
  study?: string;
  run?: string;
  previousRun?: string;
  typeId?: string;
  file?: string;
  result?: Record<string, any>;
  comparison?: Record<string, any>;
  table?: Record<string, any>[];
  refused?: boolean;
}
const call = (name: string, arguments_: Record<string, any>) => fauxAssistantMessage([fauxToolCall(name, arguments_)], { stopReason: 'toolUse' });
const text = (value: string) => fauxAssistantMessage([fauxText(value)]);
const data = (context: TranscriptContext): Record<string, any> => {
  const last = context.messages.at(-1)!;
  assert.equal(last.role, 'toolResult');
  assert.equal((last as { isError?: boolean }).isError, false, toolText(context));
  return JSON.parse(toolText(context)).data ?? {};
};
const receipt = (context: TranscriptContext) => {
  const result = data(context).receipt;
  assert.ok(result && result.status !== 'failed' && !result.error, 'the next step needs a successful backend receipt');
  return result;
};

function advance(faux: Faux, state: FlowState, next: Reply, tool: string, args: Record<string, unknown>) {
  faux.setResponses([context => {
    try { return next(context); }
    catch (error) { state.failure = error instanceof Error ? error.message : String(error); return text('这一步未完成，不能继续；请查看步骤中的平台拒绝原因。'); }
  }]);
  return call(tool, args);
}

export function installStudyRead(faux: Faux, input: { workspace: string; study: string; run: string }): FlowState {
  const state: FlowState = { done: false, study: input.study, run: input.run };
  const finish: Reply = context => {
    state.result = data(context);
    const current = state.result.headlines?.find((row: any) => row.key === 'ampacity');
    const value = current?.display_value;
    assert.equal(typeof value, 'number', 'the saved run must provide the current');
    state.done = true;
    return text(`保存结果的允许电流为 ${value.toFixed(1)} A。\n限制对象、负荷与温度见结果卡；数据来源和方法适用范围仍须核对。`);
  };
  faux.setResponses([() => advance(faux, state, () => advance(faux, state,
    context => { data(context); return advance(faux, state, finish, 'run_read', { workspace_id: input.workspace, study_id: input.study, run_id: input.run }); },
    'study_read', { workspace_id: input.workspace, study_id: input.study }), 'read', { path: 'ampacity-rating' })]);
  return state;
}

export function installStudyWorkflow(faux: Faux, input: { workspace: string; study: string; title?: string }): FlowState {
  const state: FlowState = { done: false };
  const finish: Reply = context => {
    const result = receipt(context);
    assert.equal(result.kind, 'delivery');
    state.file = result.download_url;
    state.done = true;
    return text('研究已运行，计算书已从该次保存结果生成。\n输入、方法版本和限制随记录保留，接受操作不代表工程审核通过。');
  };
  const afterRead: Reply = context => {
    state.result = data(context);
    assert.equal(state.result.status, 'succeeded');
    return advance(faux, state, finish, 'propose_delivery', { workspace_id: input.workspace, run_ids: [state.run] });
  };
  const afterRun: Reply = context => {
    const result = receipt(context);
    assert.equal(result.status, 'succeeded');
    state.run = result.run_id;
    return advance(faux, state, afterRead, 'run_read', { workspace_id: input.workspace, study_id: state.study, run_id: state.run });
  };
  const afterCreate: Reply = context => {
    state.study = receipt(context).study_id;
    assert.ok(state.study);
    return advance(faux, state, afterRun, 'propose_study_run', { workspace_id: input.workspace, study_id: state.study });
  };
  faux.setResponses([() => advance(faux, state, () => advance(faux, state, context => {
    data(context);
    return advance(faux, state, afterCreate, 'propose_study', { workspace_id: input.workspace, source_study_id: input.study,
      title: input.title ?? 'Agent 验收 · 复制保存工况直埋校核' });
  }, 'study_read', { workspace_id: input.workspace, study_id: input.study }), 'read', { path: 'ampacity-rating' })]);
  return state;
}

export function installConditionWorkflow(faux: Faux, input: { workspace: string; study: string; run: string; path: string; value: number }): FlowState {
  const state: FlowState = { done: false, study: input.study, previousRun: input.run };
  const afterCompare: Reply = context => {
    state.comparison = data(context).comparison;
    const comparison = state.comparison?.differences?.[0];
    assert.ok(comparison && comparison.same_input === false && comparison.same_method === true, 'the comparison must identify changed inputs and the unchanged method');
    const current = comparison.quantities.find((row: any) => row.key === 'ampacity' && row.unit === 'A');
    assert.ok(current && [current.baseline, current.value, current.difference].every(value => typeof value === 'number'));
    state.done = true;
    return text(`允许电流由 ${current.baseline.toFixed(1)} A 变为 ${current.value.toFixed(1)} A，保存的比较差值为 ${current.difference.toFixed(1)} A。\n输入条件已改变、方法相同；差异来自后端比较结果，旧记录保持不变。`);
  };
  const afterRun: Reply = context => {
    const result = receipt(context); assert.equal(result.status, 'succeeded'); state.run = result.run_id; state.result = result.result;
    return advance(faux, state, afterCompare, 'study_compare', { workspace_id: input.workspace, run_ids: [input.run, state.run] });
  };
  const afterChange: Reply = context => { receipt(context); return advance(faux, state, afterRun, 'propose_study_run', { workspace_id: input.workspace, study_id: input.study }); };
  faux.setResponses([() => advance(faux, state, context => {
    const result = data(context);
    const field = result.fields?.find((item: any) => item.path === input.path);
    assert.ok(field, 'the exact saved field must be read before proposing it');
    assert.equal(typeof field.unit, 'string', 'use the display unit declared by the platform, not an assumed spelling');
    return advance(faux, state, afterChange, 'propose_domain_changes', { workspace_id: input.workspace, title: '调整明确给定的敷设条件',
      changes: [{ path: input.path, value: input.value, unit: field.unit }] });
  }, 'workspace_read', { workspace_id: input.workspace, paths: [input.path] })]);
  return state;
}

export function installTypeWorkflow(faux: Faux, input: { workspace: string; typeId?: string; source?: { id: string; content_sha256: string }; thicknessMm: number }): FlowState {
  const state: FlowState = { done: false, typeId: input.typeId };
  const fields: any[] = [];
  let cable = '';
  let basis = '';
  const finish: Reply = context => {
    const result = receipt(context); assert.equal(result.kind, 'specification'); state.file = result.download_url; state.done = true;
    return text('型号结构已保存，标准核对已运行，内部规格书已生成。\n未覆盖、缺实测与待审核项均保留，未把草稿发布为产品保证。');
  };
  const afterRun: Reply = context => {
    const result = receipt(context); assert.equal(result.status, 'succeeded'); state.run = result.run_id; state.result = result.result;
    return advance(faux, state, finish, 'propose_type_specification', { type_id: state.typeId, audience: 'internal' });
  };
  const afterStudy: Reply = context => {
    state.study = receipt(context).study_id;
    return advance(faux, state, afterRun, 'propose_study_run', { workspace_id: state.typeId, study_id: state.study });
  };
  const afterMethods: Reply = context => {
    const methods = data(context).methods as any[];
    const entry = methods.find(method => method.method.plugin_id === 'cablesim.standard-check');
    assert.ok(entry, 'the installed standard checking method must exist');
    const capability = entry.capabilities.find((row: any) => row.id === 'dimensions');
    assert.ok(capability, 'the standard checking capability must be declared');
    return advance(faux, state, afterStudy, 'propose_study', { workspace_id: state.typeId, title: 'Agent 验收 · 修改后的标准核对',
      method: { ...entry.method, capability: capability.id }, parameters: { cable_type_id: cable }, basis_request_id: basis });
  };
  const afterBasis: Reply = context => { basis = receipt(context).basis_request_id; assert.ok(basis); return advance(faux, state, afterMethods, 'method_list', {}); };
  const afterChange: Reply = context => {
    const accepted = receipt(context);
    assert.equal(accepted.type_id, state.typeId);
    return advance(faux, state, context => {
      const saved = data(context);
      assert.equal(saved.workspace_revision, accepted.workspace_revision);
      assert.equal(saved.freshness, 'current');
      for (const field of fields) {
        const value = saved.fields.find((item: any) => item.path === field.path);
        assert.ok(value && ['m', 'mm'].includes(value.unit), 'the accepted thickness must be read back with its declared length unit');
        const expected = value.unit === 'm' ? input.thicknessMm / 1000 : input.thicknessMm;
        assert.ok(Math.abs(value.value - expected) < 1e-12, 'the saved thickness must match the accepted proposal');
      }
      return advance(faux, state, afterBasis, 'propose_type_basis', { type_id: state.typeId });
    }, 'workspace_read', { workspace_id: state.typeId, paths: fields.map(field => field.path) });
  };
  const collect: Reply = context => {
    const result = data(context);
    assert.equal(result.view, 'input', 'editing reads saved input pages, not unrelated calculation or standard evidence');
    fields.push(...result.items.filter((item: any) => item.section === 'structure' && /\/layers\/insulation\/thickness$/.test(item.path)));
    if (result.next_page) return advance(faux, state, collect, 'type_read', result.next_page);
    assert.ok(fields.length, 'the type must expose insulation thickness with stable field paths');
    assert.ok(fields.every(field => field.unit === 'mm'), 'the model uses exactly the tool display unit');
    cable = fields[0].path.split('/')[2].replace(/~1/g, '/').replace(/~0/g, '~');
    return advance(faux, state, afterChange, 'propose_type_changes', { type_id: state.typeId, reason: '按本轮明确要求调整绝缘厚度',
      changes: fields.map(field => ({ path: field.path, value: input.thicknessMm, unit: 'mm' })) });
  };
  const readType = () => advance(faux, state, collect, 'type_read', { type_id: state.typeId, view: 'input', limit: 20 });
  const afterCreate: Reply = context => { state.typeId = receipt(context).type_id; assert.ok(state.typeId); return readType(); };
  faux.setResponses([() => advance(faux, state, () => {
    if (state.typeId) return readType();
    assert.ok(input.source, 'new type workflow needs an actual saved library version');
    return advance(faux, state, afterCreate, 'propose_type_create', { workspace_id: input.workspace, name: 'Agent 验收 · 型号结构调整', origin: 'library',
      resource_id: input.source.id, content_sha256: input.source.content_sha256 });
  }, 'read', { path: 'cable-revision' })]);
  return state;
}

export const ratingConditions = () => [25, 30].map(ambient => ({
  case_id: `soil-${ambient}`, name: `三芯直埋单回 · ${ambient} °C`, layout: 'three_core_buried_single',
  depth_m: 0.8, soil_rho_k_m_w: 1.2, ambient_temperature_c: ambient, frequency_hz: 50,
  bonding: 'both_ends', rating_basis: 'simultaneous',
  source: '验收工程师明示的参考工况：单回、中心埋深0.8 m、土壤1.2 K·m/W、50 Hz、两端接地；不是现场测量。',
}));

export function installRatingTableWorkflow(faux: Faux, input: { workspace: string; sourceStudy: string; title?: string; missingSoil?: boolean }): FlowState {
  const state: FlowState = { done: false, typeId: input.workspace, table: [] };
  let digest: string | undefined;
  const collect: Reply = context => {
    const result = data(context);
    assert.equal(result.resource.kind, 'rating_table');
    assert.equal(result.resource.run_id, state.run);
    assert.equal(result.resource.study_id, state.study);
    assert.equal(result.resource.integrity, 'verified');
    if (digest) assert.equal(result.source.response_digest, digest, 'continuation pages must name the same immutable response');
    digest = result.source.response_digest;
    assert.match(digest!, /^[0-9a-f]{64}$/);
    const page = result.page;
    assert.equal(page.view, '/rows');
    if (Array.isArray(page.value)) state.table!.push(...page.value);
    else {
      assert.ok(Array.isArray(page.items), 'the table tool must expose its actual bounded rows');
      for (const item of page.items) { assert.ok(!item.omitted && item.value, 'an omitted row is not a read result'); state.table!.push(item.value); }
    }
    if (result.next_read) return advance(faux, state, collect, result.next_read.tool, result.next_read.arguments);
    assert.equal(state.table!.length, ratingConditions().length);
    assert.ok(state.table!.every(row => row.status === '已计算' && typeof row.value_a === 'number' && row.value_a > 0));
    state.done = true;
    return text('载流量表已按逐项接受的条件保存并运行。\n表中每一行来自同一次保存运行；来源、工况和方法版本可在工作台核对，不把参考工况当成厂家保证。');
  };
  const afterRun: Reply = context => {
    const result = receipt(context); assert.equal(result.status, 'succeeded'); state.run = result.run_id;
    return advance(faux, state, collect, 'resource_read', { workspace_id: input.workspace, kind: 'rating_table', run_id: state.run, view: '/rows', limit: 1 });
  };
  const afterCreate: Reply = context => {
    if (input.missingSoil) {
      assert.equal((context.messages.at(-1) as { isError?: boolean }).isError, true);
      assert.match(toolText(context), /soil_rho|土壤|明确填写|参数|schema|required/i);
      state.done = state.refused = true;
      return text('缺少明确的土壤热阻率，载流量表未保存也未运行。请补齐该工况及其来源后重新提出。');
    }
    state.study = receipt(context).study_id;
    return advance(faux, state, afterRun, 'propose_study_run', { workspace_id: input.workspace, study_id: state.study });
  };
  const afterRead: Reply = context => {
    const saved = data(context);
    assert.equal(saved.definition.method.plugin_id, 'cablesim.iec60287');
    assert.equal(saved.definition.method.capability, 'steady-rating');
    assert.ok(saved.definition.parameters.source, 'reuse the released example’s declared parameter sources, never fill missing coefficients');
    const rows: Record<string, unknown>[] = ratingConditions();
    if (input.missingSoil) delete rows[0].soil_rho_k_m_w;
    return advance(faux, state, afterCreate, 'propose_rating_table', { type_id: input.workspace,
      title: input.title ?? 'Agent 验收 · 明示环境温度载流量表', rows, parameters: saved.definition.parameters });
  };
  faux.setResponses([() => advance(faux, state, () => advance(faux, state, afterRead, 'study_read', {
    workspace_id: input.workspace, study_id: input.sourceStudy,
  }), 'read', { path: 'rating-table' })]);
  return state;
}

export interface GbFixture {
  workspace: string;
  baselineStudy: string;
  baselineRun: string;
  baselineCurrent: number;
  baselineSource: string;
  baselineDigest: string;
  baselinePage: number;
  baselineDelivery: string;
}
export type PlatformRequest = (path: string, body?: unknown, method?: 'POST' | 'PUT') => Promise<any>;

/** Human fixture setup through existing public APIs: a saved real IEC baseline and its real PDF page, never a planted result. */
export async function prepareGbFixture(api: PlatformRequest, typeWorkspace: string): Promise<GbFixture> {
  const studies = await api(`/api/workspaces/${typeWorkspace}/studies`);
  const table = studies.find((item: any) => item.definition.method.plugin_id === 'cablesim.iec60287'
    && item.definition.driver.kind === 'batch' && item.definition.driver.cases?.every((row: any) => row.metadata?.kind === 'type-rating-table') && item.latest_run);
  assert.ok(table, 'the release type must supply a genuinely saved rating table');
  const saved = await api(`/api/design/workspaces/${typeWorkspace}/rating-table-runs/${table.latest_run.id}`);
  assert.equal(saved.run.integrity, 'verified');
  const first = saved.run.snapshot.cases.find((item: any) => item.input.circuits.length === 1 && item.input.circuits[0].cables.length === 1);
  assert.ok(first, 'use an actual saved single three-core cable input');
  // The table's condition adapter removes an old criterion from its frozen case input while retaining its historical source.
  // Start the new, editable fixture from the valid saved type instead; never prune or rewrite provenance in a historical run.
  const document = structuredClone((await api(`/api/workspaces/${typeWorkspace}`)).domain), circuit = document.circuits[0], section = document.sections[0];
  assert.equal(document.cable_types[0].construction, 'three_core');
  assert.equal(document.cable_types[0].rating.max_conductor_temperature.normal, 363.15);
  assert.ok(document.criteria.max_conductor_temperature === undefined || document.criteria.max_conductor_temperature === 363.15,
    'the saved type must already agree with its 90 °C normal limit');
  assert.equal(document.circuits.length, 1);
  assert.equal(circuit.cables.length, 1);
  assert.equal(circuit.cables[0].phase, 'L1L2L3');
  assert.equal(section.placements.length, 1);
  assert.ok(!section.enclosures?.length && !section.backfill && !section.soil_layers?.length);
  const reference = '验收工程师明示的GB校正参考条件：实际系统线电压10 kV、50 Hz、三芯单回、中心埋深0.8 m、土壤1.2 K·m/W；基准25 °C、目标30 °C，非现场测量或厂家额定值。';
  const escape = (value: string) => value.replaceAll('~', '~0').replaceAll('/', '~1');
  const source = { kind: 'user', reference, reviewed: false };
  document.name = 'Agent 验收 · 已保存 IEC 基准与 GB 温度校正';
  circuit.system.kind = 'ac_three_phase';
  circuit.system.voltage = 10000;
  circuit.system.frequency = 50;
  section.kind = 'ground';
  section.label = '三芯单回直埋 · 明示参考工况';
  section.layout_template = {};
  section.medium.surface_temperature = 298.15;
  section.placements[0].z = -0.8;
  const soil = document.materials.find((item: any) => item.id === section.medium.material);
  assert.ok(soil);
  soil.thermal_resistivity = 1.2;
  document.provenance ??= {};
  for (const path of ['/name', `/circuits/${escape(circuit.id)}/system`, `/sections/${escape(section.id)}/kind`,
    `/sections/${escape(section.id)}/label`, `/sections/${escape(section.id)}/layout_template`, `/sections/${escape(section.id)}/medium/surface_temperature`,
    `/sections/${escape(section.id)}/placements/${escape(section.placements[0].cable)}/z`, `/materials/${escape(soil.id)}/thermal_resistivity`]) document.provenance[path] = source;
  // Rated voltage and every cable/material fact remain those of the saved type. The 10 kV system is an explicit fixture input.
  const created = await api('/api/workspaces', {});
  const converted = await api(`/api/workspaces/${created.id}/domain/conversion`, { expected_revision: created.revision });
  await api(`/api/workspaces/${created.id}/domain`, { expected_revision: converted.revision, document }, 'PUT');
  let workspace = await api(`/api/workspaces/${created.id}`);
  const parameters = { ...saved.run.snapshot.definition.parameters, ...first.parameters, rating_mode: 'both' };
  const baselineStudy = await api(`/api/workspaces/${created.id}/studies`, { title: 'GB 校正基准 · 单根 25 °C', task: 'rating',
    input_source: 'domain', method: saved.run.snapshot.definition.method, parameters, driver: { kind: 'single' }, expected_revision: workspace.revision });
  const prefix = `/api/workspaces/${created.id}/studies/${baselineStudy.id}`;
  const preflight = await api(`${prefix}/preflight?expected_revision=${workspace.revision}&expected_study_revision=${baselineStudy.revision}`);
  assert.ok(preflight.ready, JSON.stringify(preflight.cases));
  let run = await api(prefix + '/runs', { request_id: randomUUID(), expected_revision: workspace.revision,
    expected_study_revision: baselineStudy.revision, lock_digest: preflight.lock_digest, scope_acknowledged: true });
  const deadline = Date.now() + 60_000;
  while (['accepted', 'running', 'validating'].includes(run.status) && Date.now() < deadline) {
    await new Promise(done => setTimeout(done, 100)); run = await api(prefix + '/runs/' + run.id);
  }
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  const baseline = await api(prefix + '/runs/' + run.id + '?view=full');
  assert.equal(baseline.integrity, 'verified');
  const current = baseline.output.cases[0].results.find((row: any) => row.key === 'ampacity' && row.case === 'rating' && row.unit === 'A' && row.status === 'available')?.value;
  assert.ok(typeof current === 'number' && current > 0);
  const delivery = await api(`/api/workspaces/${created.id}/deliveries/current`, { run_ids: [run.id], request_id: randomUUID() });
  const encoded = delivery.html.match(/data-report-pdf="customer"[^>]+href="data:application\/pdf;base64,([^"]+)"/)?.[1];
  assert.ok(encoded, 'the actual saved baseline calculation book must contain its customer PDF');
  const pdf = Buffer.from(encoded, 'base64');
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  const environment: NodeJS.ProcessEnv = { ...process.env, PYTHONIOENCODING: 'utf-8' };
  for (const key of Object.keys(environment)) if (/^(CABLESIM_LLM_|CABLE_STUDIO_MODEL_|CABLESIM_AGENT_SIDECAR_TOKEN$|DEEPSEEK_API_KEY)/.test(key)) delete environment[key as keyof typeof environment];
  const pages: string[] = JSON.parse(execFileSync(process.env.CABLE_STUDIO_PYTHON ?? 'python', ['-c',
    'import fitz,json,sys; document=fitz.open(stream=sys.stdin.buffer.read(),filetype="pdf"); print(json.dumps([page.get_text() for page in document],ensure_ascii=False))'],
  { input: pdf, encoding: 'utf8', env: environment, timeout: 15_000 }));
  const page = pages.findIndex(value => value.replaceAll(/\s/g, '').includes(current.toFixed(1)) && /允许电流|载流量/.test(value));
  assert.ok(page >= 0, 'locate the saved baseline value in the real PDF; do not invent a reference page');
  workspace = await api(`/api/workspaces/${created.id}`);
  const target = structuredClone(workspace.domain);
  target.sections[0].medium.surface_temperature = 303.15;
  await api(`/api/workspaces/${created.id}/domain`, { expected_revision: workspace.revision, document: target }, 'PUT');
  return { workspace: created.id, baselineStudy: baselineStudy.id, baselineRun: run.id, baselineCurrent: current,
    baselineDigest: createHash('sha256').update(pdf).digest('hex'), baselinePage: page + 1, baselineDelivery: delivery.id,
    baselineSource: `已保存IEC基准计算书 ${delivery.id} 第${page + 1}页，运行 ${run.id}；同一保存型号、单根、正常温限90 °C、25 °C、土壤1.2 K·m/W、中心埋深0.8 m；非厂家额定值。` };
}

export function gbRequest(input: GbFixture, reviewed: boolean): string {
  return `${reviewed ? '我已核对并确认' : '我尚未确认'}采用该运行完整保存的基准值（页面显示${input.baselineCurrent.toFixed(1)} A）：${input.baselineSource}；PDF SHA256 ${input.baselineDigest}。`
    + '实际系统线电压为10 kV，电缆额定电压保持原值；按已保存30 °C同埋深单回工况做GB 50217校正并导出计算书，每步先让我接受。';
}

export function installGbWorkflow(faux: Faux, input: GbFixture & { baselineReviewed: boolean }): FlowState {
  const state: FlowState = { done: false };
  let method: Record<string, any>;
  const finish: Reply = context => { const saved = receipt(context); assert.equal(saved.kind, 'delivery'); state.file = saved.download_url; state.done = true;
    const current = state.result!.headlines.find((row: any) => row.key === 'ampacity').display_value;
    return text(`GB 50217 校正后允许电流为 ${current.toFixed(1)} A，计算书来自该次保存运行。\n基准是工程师明确核对的已保存IEC参考结果，不是厂家保证值；适用条件、校正系数与标准出处请在工作台核对。`); };
  const afterRead: Reply = context => { state.result = data(context); assert.equal(state.result.run_id, state.run);
    return advance(faux, state, finish, 'propose_delivery', { workspace_id: input.workspace, run_ids: [state.run] }); };
  const afterRun: Reply = context => {
    if (!input.baselineReviewed) {
      assert.equal((context.messages.at(-1) as { isError?: boolean }).isError, true);
      assert.match(toolText(context), /基准|baseline_reviewed/);
      state.done = state.refused = true;
      return text('基准条件尚未由人确认，GB 50217 预检拒绝了运行；未生成校正值。请先核对同型号、单根条件、正常温限和原文出处。');
    }
    const saved = receipt(context); assert.equal(saved.status, 'succeeded'); state.run = saved.run_id;
    return advance(faux, state, afterRead, 'run_read', { workspace_id: input.workspace, study_id: state.study, run_id: state.run });
  };
  const afterCreate: Reply = context => { state.study = receipt(context).study_id;
    return advance(faux, state, afterRun, 'propose_study_run', { workspace_id: input.workspace, study_id: state.study }); };
  const afterContract: Reply = context => {
    const contract = data(context).contracts?.find((item: any) => item.method.plugin_id === method.plugin_id && item.method.capability === method.capability);
    assert.ok(contract, 'read the actual installed GB parameter contract');
    const basis = contract.parameter_schema.properties.basis_release_digest.default;
    assert.match(basis, /^[0-9a-f]{64}$/);
    return advance(faux, state, afterCreate, 'propose_study', { workspace_id: input.workspace, title: 'Agent 验收 · GB 50217 明示基准温度校正', method,
      parameters: { baseline_current_a: input.baselineCurrent, baseline_ambient_k: 298.15, baseline_soil_rho: 1.2,
        // The sealed GB contract's manufacturer enum also covers saved results.
        // This fixture cites its real IEC run/PDF, not a manufacturer guarantee.
        baseline_kind: 'manufacturer', baseline_source: input.baselineSource, baseline_sha256: input.baselineDigest,
        baseline_page: input.baselinePage, baseline_depth_m: 0.8, baseline_reviewed: input.baselineReviewed, basis_release_digest: basis } });
  };
  const afterMethods: Reply = context => {
    const entry = data(context).methods.find((row: any) => row.method.plugin_id === 'cablesim.gb50217-correction');
    assert.ok(entry?.capabilities.some((row: any) => row.id === 'steady-rating'));
    method = { ...entry.method, capability: 'steady-rating' };
    return advance(faux, state, afterContract, 'plugin_inspect', { workspace_id: input.workspace, plugin_id: method.plugin_id, capability: method.capability });
  };
  const afterBaseline: Reply = context => {
    const saved = data(context);
    assert.equal(saved.run_id, input.baselineRun);
    assert.ok(saved.cases.some((item: any) => item.results.some((row: any) => row.key === 'ampacity' && row.case === 'rating'
      && row.unit === 'A' && row.value === input.baselineCurrent)), 'the human-supplied baseline must equal its actual saved run');
    return advance(faux, state, afterMethods, 'method_list', {});
  };
  faux.setResponses([() => advance(faux, state, () => advance(faux, state, afterBaseline, 'run_read', {
    workspace_id: input.workspace, study_id: input.baselineStudy, run_id: input.baselineRun,
  }), 'read', { path: 'gb50217-correction' })]);
  return state;
}

export function installImportRefusal(faux: Faux): FlowState {
  const state: FlowState = { done: false };
  faux.setResponses([() => advance(faux, state, () => advance(faux, state, context => {
    assert.equal((context.messages.at(-1) as { isError?: boolean }).isError, true);
    assert.match(toolText(context), /尚未接入|未接入|缺少.*接口/);
    state.done = true;
    return text('厂家 Excel/CSV 结构表导入接口尚未接入，文件没有写入型号库。\n请在资源库查看已有资料导入入口；结构表预览、列映射和批量草稿提交需要数据接口接入后继续。');
  }, 'structure_import_inspect', { filename: '厂家结构表.xlsx' }), 'read', { path: 'cable-import-check' })]);
  return state;
}

export function installMissingData(faux: Faux, input: { workspace: string; study?: string }): FlowState {
  const state: FlowState = { done: false };
  faux.setResponses([() => advance(faux, state, context => {
    assert.equal((context.messages.at(-1) as { isError?: boolean }).isError, true);
    assert.match(toolText(context), /准确方法|明确参数|缺少|缺项|输入|预检|电阻/);
    state.done = true;
    return input.study ? text('研究预检被拒绝：必要工程数据不完整。\n没有生成替代计算结果；请在工作台按步骤中的诊断补齐输入和来源后重试。')
      : text('缺少准确方法和明确参数，也没有指定可复制的保存研究。\n尚未创建研究或计算结果；请在载流量工作台补齐工况，或明确选择一项已有研究。');
  }, input.study ? 'propose_study_run' : 'propose_study', input.study ? { workspace_id: input.workspace, study_id: input.study } : { workspace_id: input.workspace, title: '缺少明确工况的任务' })]);
  return state;
}
