// Scripted model responses for both the Node integration tests and the browser walk. The script chooses tools; every object,
// number, saved run and file comes from the real platform. A refusal terminates the script, never a fabricated success response.
import assert from 'node:assert/strict';
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

export function installConditionWorkflow(faux: Faux, input: { workspace: string; study: string; run: string; path: string; value: number; unit: string }): FlowState {
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
    const result = data(context); assert.ok(result.fields?.length, 'the saved field must be read before proposing it');
    return advance(faux, state, afterChange, 'propose_domain_changes', { workspace_id: input.workspace, title: '调整明确给定的敷设条件',
      changes: [{ path: input.path, value: input.value, unit: input.unit }] });
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
  const afterChange: Reply = context => { receipt(context); return advance(faux, state, afterBasis, 'propose_type_basis', { type_id: state.typeId }); };
  const collect: Reply = context => {
    const result = data(context);
    fields.push(...result.items.filter((item: any) => item.section === 'structure' && /\/layers\/insulation\/thickness$/.test(item.path)));
    if (result.next_page) return advance(faux, state, collect, 'type_read', result.next_page);
    assert.ok(fields.length, 'the type must expose insulation thickness with stable field paths');
    assert.ok(fields.every(field => field.unit === 'mm'), 'the model uses exactly the tool display unit');
    cable = fields[0].path.split('/')[2].replace(/~1/g, '/').replace(/~0/g, '~');
    return advance(faux, state, afterChange, 'propose_type_changes', { type_id: state.typeId, reason: '按本轮明确要求调整绝缘厚度',
      changes: fields.map(field => ({ path: field.path, value: input.thicknessMm, unit: 'mm' })) });
  };
  const readType = () => advance(faux, state, collect, 'type_read', { type_id: state.typeId, view: 'structure', limit: 20 });
  const afterCreate: Reply = context => { state.typeId = receipt(context).type_id; assert.ok(state.typeId); return readType(); };
  faux.setResponses([() => advance(faux, state, () => {
    if (state.typeId) return readType();
    assert.ok(input.source, 'new type workflow needs an actual saved library version');
    return advance(faux, state, afterCreate, 'propose_type_create', { workspace_id: input.workspace, name: 'Agent 验收 · 型号结构调整', origin: 'library',
      resource_id: input.source.id, content_sha256: input.source.content_sha256 });
  }, 'read', { path: 'cable-revision' })]);
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
