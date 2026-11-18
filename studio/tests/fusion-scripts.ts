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
  channelRuns?: Record<string, string>;
}
export const FORMAL_DOCUMENT = { organization: 'CableSimPro 隔离验收', number: 'AGENT-TEST-01', revision: 'A' };
export const FORMAL_DOCUMENT_PROMPT = `正式文件单位为“${FORMAL_DOCUMENT.organization}”，文件编号为“${FORMAL_DOCUMENT.number}”，版次为“${FORMAL_DOCUMENT.revision}”；导出带签栏与追溯页的 PDF，保留真实草稿和签核状态。`;

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

export function installStudyRead(faux: Faux, input: { workspace: string; study: string; run: string;
  discoverRun?: boolean; inspectSavedDetail?: boolean }): FlowState {
  const state: FlowState = { done: false, study: input.study, run: input.run };
  const finish: Reply = context => {
    state.result = data(context);
    const current = state.result.headlines?.find((row: any) => row.key === 'ampacity');
    const value = current?.display_value;
    assert.equal(typeof value, 'number', 'the saved run must provide the current');
    const complete = () => {
      state.done = true;
      return text(`保存结果的允许电流为 ${value.toFixed(1)} A。\n限制对象、负荷与温度见结果卡；数据来源和方法适用范围仍须核对。`);
    };
    if (input.inspectSavedDetail) {
      const read = JSON.parse(toolText(context)).detail?.read;
      assert.equal(read?.tool, 'run_read', 'the production summary advertises its original authorized read tool');
      assert.match(read.arguments.result_digest, /^[0-9a-f]{64}$/);
      const index = state.result.headlines.indexOf(current);
      const view = `/headlines/${index}/value`;
      return advance(faux, state, context => {
        const saved = data(context);
        assert.equal(saved.projection, 'result_page');
        assert.equal(saved.source.response_digest, read.arguments.result_digest, 'the exact saved response digest binds this detail read');
        assert.equal(saved.page.view, view);
        assert.equal(saved.page.complete, true);
        assert.equal(saved.page.value, current.value, 'a real result_view resolves the original saved SI quantity exactly');
        return complete();
      }, read.tool, { ...read.arguments, result_view: view, result_offset: 0 });
    }
    return complete();
  };
  const afterStudy: Reply = context => {
    data(context);
    if (input.discoverRun) return advance(faux, state, context => {
      const runs = data(context).items;
      assert.ok(Array.isArray(runs), 'the actual run list must expose its saved records');
      const current = runs.filter((item: any) => item.status === 'succeeded' && item.freshness === 'current');
      assert.ok(current.every((item: any) => Number.isSafeInteger(item.sequence)), 'use the actual saved sequence to order current runs');
      const saved = current.sort((left: any, right: any) => right.sequence - left.sequence)[0];
      assert.ok(saved?.id, 'discover the latest current successful run through the actual tool');
      assert.equal(saved.id, input.run, 'the fixture run is only an oracle for the discovered result');
      state.run = saved.id;
      return advance(faux, state, finish, 'run_read', { workspace_id: input.workspace, study_id: input.study, run_id: saved.id });
    }, 'run_list', { workspace_id: input.workspace, study_id: input.study, limit: 5 });
    return advance(faux, state, finish, 'run_read', { workspace_id: input.workspace, study_id: input.study, run_id: input.run });
  };
  faux.setResponses([() => advance(faux, state, () => advance(faux, state,
    afterStudy,
    'study_read', { workspace_id: input.workspace, study_id: input.study }), 'read', { path: 'ampacity-rating' })]);
  return state;
}

export function installStudyWorkflow(faux: Faux, input: { workspace: string; study: string; title?: string; exportBook?: boolean }): FlowState {
  const state: FlowState = { done: false };
  const finish: Reply = context => {
    const result = receipt(context);
    assert.equal(result.kind, 'delivery');
    assert.equal(result.media_type, 'application/pdf');
    state.file = result.download_url;
    state.done = true;
    return text('研究已运行，计算书已从该次保存结果生成。\n输入、方法版本和限制随记录保留，接受操作不代表工程审核通过。');
  };
  const afterRead: Reply = context => {
    state.result = data(context);
    assert.equal(state.result.status, 'succeeded');
    if (input.exportBook === false) {
      state.done = true;
      return text('直埋校核研究和本次运行均已保存；结论、输入与限制见对应结果卡。');
    }
    return advance(faux, state, finish, 'propose_delivery', { workspace_id: input.workspace, run_ids: [state.run], document: FORMAL_DOCUMENT });
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

export function installDeliveryWorkflow(faux: Faux, input: { workspace: string; run: string }): FlowState {
  const state: FlowState = { done: false, run: input.run };
  faux.setResponses([() => advance(faux, state, () => advance(faux, state, context => {
    const saved = receipt(context);
    assert.equal(saved.kind, 'delivery');
    assert.equal(saved.media_type, 'application/pdf');
    assert.ok(saved.download_url, 'the answer needs the actual saved calculation book');
    state.file = saved.download_url;
    state.done = true;
    return text('已从指定的保存运行生成计算书，可从文件卡预览和下载。');
  }, 'propose_delivery', { workspace_id: input.workspace, run_ids: [input.run], document: FORMAL_DOCUMENT }), 'read', { path: 'spec-and-report' })]);
  return state;
}

/** Read the actual type input pages; the scripted answer does not invent geometry or claim unread standard evidence. */
export function installTypeRead(faux: Faux, typeId: string): FlowState {
  const state: FlowState = { done: false, typeId };
  const entries: Record<string, any>[] = [];
  const collect: Reply = context => {
    const result = data(context);
    assert.equal(result.view, 'input');
    assert.equal(result.type_id, typeId);
    entries.push(...result.items);
    if (result.next_page) return advance(faux, state, collect, 'type_read', result.next_page);
    assert.equal(entries.length, result.total, 'read every declared input page, including missing fields');
    assert.ok(entries.some(entry => entry.section === 'structure' && /\/layers\/insulation\/thickness$/.test(entry.path)),
      'the read answer includes the actual insulation thickness');
    state.result = { ...result, items: entries };
    state.done = true;
    return text('已读取型号保存结构与主要参数；声明来源和草稿缺项以保存记录为准，输入完整不代表工程核对通过。');
  };
  faux.setResponses([() => advance(faux, state, () => advance(faux, state, collect, 'type_read',
    { type_id: typeId, view: 'input', limit: 20 }), 'read', { path: 'cable-revision' })]);
  return state;
}

export function installConditionWorkflow(faux: Faux, input: { workspace: string; study: string; run: string; path: string;
  value: number; requireVisibleReferences?: boolean }): FlowState {
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
  faux.setResponses([context => {
    if (input.requireVisibleReferences) {
      const visible = context.messages.map(message => typeof message.content === 'string' ? message.content
        : message.content.filter(part => part.type === 'text').map(part => part.text).join('\n')).join('\n');
      for (const reference of [input.path, input.study, input.run])
        assert.ok(visible.includes(reference), 'a follow-up must retain the actual prior field/study/run identity: ' + reference);
    }
    return advance(faux, state, context => {
      const result = data(context);
      const field = result.fields?.find((item: any) => item.path === input.path);
      assert.ok(field, 'the exact saved field must be read before proposing it');
      assert.equal(typeof field.unit, 'string', 'use the display unit declared by the platform, not an assumed spelling');
      return advance(faux, state, afterChange, 'propose_domain_changes', { workspace_id: input.workspace, title: '调整明确给定的敷设条件',
        changes: [{ path: input.path, value: input.value, unit: field.unit }] });
    }, 'workspace_read', { workspace_id: input.workspace, paths: [input.path] });
  }]);
  return state;
}

export function installTypeWorkflow(faux: Faux, input: { workspace: string; typeId?: string; source?: { id: string; content_sha256: string }; thicknessMm: number }): FlowState {
  const state: FlowState = { done: false, typeId: input.typeId, channelRuns: {} };
  const fields: any[] = [];
  let cable = '';
  let basis = '';
  const savedStudies = new Map<string, Record<string, any>>();
  const definitions = new Map<string, Record<string, any>>();
  const spacedLayouts = new Set(['flat', 'air', 'ducts', 'three_core_buried_horizontal', 'three_core_ducts_horizontal']);
  const savedRatingRows: Record<string, any>[] = [];
  let ratingRows: Record<string, any>[] | undefined;
  let ratingDigest: string | undefined;
  const channel = (study: Record<string, any>): string | undefined => {
    const method = study.method;
    if (method?.plugin_id === 'cablesim.cable-geometry') return 'geometry';
    if (method?.plugin_id === 'cablesim.type-electrical' && method.capability === 'electrical') return 'electrical';
    if (method?.plugin_id === 'cablesim.type-electrical' && method.capability === 'short-circuit') return 'short_circuit';
    if (method?.plugin_id === 'cablesim.standard-check' && method.capability === 'dimensions') return 'standards';
    if (method?.plugin_id === 'cablesim.iec60287' && method.capability === 'steady-rating' && study.driver === 'batch') return 'rating';
    return undefined;
  };
  const finish: Reply = context => {
    if ((context.messages.at(-1) as { isError?: boolean }).isError) {
      // The bridge exposes a rejected HTTP call as its actual human-readable
      // tool error, not a successful JSON observation. Match that exact refusal.
      const refused = toolText(context);
      assert.match(refused, /正式规格书缺少完整保存的核对通道：/);
      for (const label of ['结构推导', '电气参数', '载流量表', '短路容量']) assert.ok(refused.includes(label));
      assert.ok(['geometry', 'electrical', 'rating', 'short_circuit'].some(key => !definitions.has(key)),
        'a complete existing type must finish its actual PDF instead of accepting a new refusal');
      assert.match(toolText(context), /正式规格书缺少完整保存的核对通道/);
      state.done = state.refused = true;
      return text('型号结构和标准核对已保存；正式规格书缺少其余完整保存的计算通道，尚未导出 PDF。请先明确并保存所缺方法条件，再逐项提出运行并由人接受；没有补猜工程数据。');
    }
    const result = receipt(context);
    assert.equal(result.kind, 'specification');
    assert.equal(result.media_type, 'application/pdf');
    for (const key of ['geometry', 'electrical', 'rating', 'short_circuit', 'standards'])
      assert.ok(state.channelRuns?.[key], 'the formal specification must use a new accepted run for ' + key);
    state.file = result.download_url;
    state.done = true;
    return text('型号结构已保存，五个通道已按当前修订逐项核对，正式 PDF 规格书已生成，含签栏与追溯页。\n未覆盖、缺实测与待审核项均保留，未把草稿发布为产品保证。');
  };
  const exportSpecification = () => advance(faux, state, finish, 'propose_type_specification',
    { type_id: state.typeId, audience: 'internal', document: FORMAL_DOCUMENT });
  const afterRatingRun: Reply = context => {
    const result = receipt(context);
    assert.equal(result.status, 'succeeded');
    assert.ok(result.run_id);
    state.channelRuns!.rating = result.run_id;
    return exportSpecification();
  };
  const recompileRating = () => {
    const saved = definitions.get('rating')!;
    const rows = ratingRows ?? saved.rating_table?.rows;
    assert.ok(Array.isArray(rows) && rows.length > 0, 'read the actual saved rating rows through study_read; never recreate them from test fixtures');
    assert.deepEqual(rows.map((row: any) => row.case_id), saved.cases.map((item: any) => item.case_id),
      'every recompiled row retains the exact saved case identity');
    assert.ok(rows.every((row: any) => typeof row.source === 'string' && row.source.length > 0 && row.rating_basis),
      'retain each actual declared source and rating basis; no schema defaults supply engineering facts');
    assert.ok(saved.definition.parameters && typeof saved.definition.parameters.source === 'string',
      'reuse only method parameters and sources visible in the actual saved definition');
    return advance(faux, state, context => {
      const result = receipt(context);
      assert.ok(result.study_id);
      return advance(faux, state, afterRatingRun, 'propose_study_run', { workspace_id: state.typeId, study_id: result.study_id });
    }, 'propose_rating_table', { type_id: state.typeId, title: 'Agent 验收 · 修改后按原明示工况重编译载流量表',
      rows, parameters: saved.definition.parameters,
      ...(saved.rating_table.selected_case_ids !== undefined ? { selected_case_ids: saved.rating_table.selected_case_ids } : {}) });
  };
  const replayChannels = ['geometry', 'electrical', 'short_circuit'];
  let replayIndex = 0;
  const runSavedChannel = (): ReturnType<typeof fauxAssistantMessage> => {
    const name = replayChannels[replayIndex++];
    if (!name) return recompileRating();
    const saved = definitions.get(name)!;
    assert.equal(saved.definition.input_source, 'domain', 'the existing calculation must read the current saved type input');
    return advance(faux, state, context => {
      const result = receipt(context);
      assert.equal(result.status, 'succeeded', 'the reused ' + name + ' method must complete on the revised type');
      assert.ok(result.run_id);
      state.channelRuns![name] = result.run_id;
      return runSavedChannel();
    }, 'propose_study_run', { workspace_id: state.typeId, study_id: saved.study_id });
  };
  const afterRun: Reply = context => {
    const result = receipt(context); assert.equal(result.status, 'succeeded'); state.run = result.run_id; state.result = result.result;
    assert.ok(state.run);
    state.channelRuns!.standards = state.run;
    // A library-created draft has no complete old calculation definitions. Ask
    // the formal service to identify its real missing evidence; never invent
    // conditions just to make this isolated fixture export successfully.
    if (['geometry', 'electrical', 'rating', 'short_circuit'].some(key => !definitions.has(key))) {
      assert.ok(!input.typeId, 'the existing released type must expose all four reusable saved method definitions; found ' + JSON.stringify([...savedStudies]));
      return exportSpecification();
    }
    return runSavedChannel();
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
  const proposeChange = () => advance(faux, state, afterChange, 'propose_type_changes', { type_id: state.typeId,
    reason: '按本轮明确要求调整绝缘厚度', changes: fields.map(field => ({ path: field.path, value: input.thicknessMm, unit: 'mm' })) });
  const collectRatingInputs: Reply = context => {
    const result = data(context);
    const study = savedStudies.get('rating')!;
    assert.equal(result.resource.kind, 'rating_table');
    assert.equal(result.resource.run_id, study.latest_run_id);
    assert.equal(result.resource.study_id, study.id);
    assert.equal(result.resource.integrity, 'verified');
    assert.equal(result.resource.status, 'succeeded');
    assert.equal(result.resource.freshness, 'current', 'read the original physical conditions before changing the saved type');
    if (ratingDigest) assert.equal(result.source.response_digest, ratingDigest, 'all original rating rows must come from the same immutable response');
    ratingDigest = result.source.response_digest;
    assert.match(ratingDigest!, /^[0-9a-f]{64}$/);
    assert.equal(result.page.view, '/rows');
    if (Array.isArray(result.page.value)) savedRatingRows.push(...result.page.value);
    else {
      assert.ok(Array.isArray(result.page.items), 'the saved table exposes real bounded rows');
      for (const item of result.page.items) {
        assert.ok(!item.omitted && item.value, 'an omitted row cannot supply engineering inputs');
        savedRatingRows.push(item.value);
      }
    }
    if (result.next_read) return advance(faux, state, collectRatingInputs, result.next_read.tool, result.next_read.arguments);
    const original = definitions.get('rating')!.rating_table.rows as Record<string, any>[];
    assert.deepEqual(savedRatingRows.map(row => row.case_id).sort(), original.map(row => row.case_id).sort(),
      'the physical inputs and saved definition must name exactly the same cases');
    ratingRows = original.map(row => {
      const saved = savedRatingRows.find(item => item.case_id === row.case_id)!;
      assert.equal(saved.status, '已计算');
      assert.equal(saved.name, row.name);
      for (const [key, value] of Object.entries(row)) {
        const actual = saved.condition[key];
        if (typeof value === 'number') assert.ok(typeof actual === 'number' && Math.abs(actual - value) < 1e-10,
          'the actual saved physical condition must agree with the declared ' + key + ' in case ' + row.case_id);
        else assert.deepEqual(actual, value, 'preserve the original declared ' + key + ' in case ' + row.case_id);
      }
      if (!spacedLayouts.has(row.layout) || row.spacing_m != null) return { ...row };
      const spacing = saved.condition.actual_spacing_m;
      assert.ok(typeof spacing === 'number' && Number.isFinite(spacing) && spacing > 0,
        'an absent declared spacing needs an actual saved physical spacing; never infer a template default');
      const source = `${row.source}\n本次排列间距读取自保存运行 ${study.latest_run_id} 的工况 ${row.case_id} 实际输入 condition.actual_spacing_m=${spacing} m；资源摘要 ${ratingDigest}。`;
      assert.ok(source.length <= 1000, 'retain both the original declared source and the exact archived spacing reference in the review');
      return { ...row, spacing_m: spacing, source };
    });
    return proposeChange();
  };
  const readDefinitions = (): ReturnType<typeof fauxAssistantMessage> => {
    const next = [...savedStudies.entries()].find(([key]) => !definitions.has(key));
    if (!next) {
      const saved = definitions.get('rating');
      if (saved) {
        assert.ok(Array.isArray(saved.rating_table?.rows), 'read the actual rating conditions through the saved study definition');
        if (saved.rating_table.rows.some((row: any) => spacedLayouts.has(row.layout) && row.spacing_m == null)) {
          const study = savedStudies.get('rating')!;
          assert.ok(study.latest_run_id, 'the original rating study must identify its saved physical result');
          return advance(faux, state, collectRatingInputs, 'resource_read', {
            workspace_id: state.typeId, kind: 'rating_table', run_id: study.latest_run_id, view: '/rows', limit: 1,
          });
        }
      }
      return proposeChange();
    }
    const [name, study] = next;
    return advance(faux, state, context => {
      const saved = data(context);
      assert.equal(saved.study_id, study.id);
      assert.equal(saved.definition.method.plugin_id, study.method.plugin_id);
      assert.equal(saved.definition.method.capability, study.method.capability);
      definitions.set(name, saved);
      return readDefinitions();
    }, 'study_read', { workspace_id: state.typeId, study_id: study.id });
  };
  const afterStudyList: Reply = context => {
    const studies = data(context).studies;
    assert.ok(Array.isArray(studies), 'discover the actual saved methods through the scoped study list');
    for (const study of studies) {
      const name = channel(study);
      // The new standard study uses a freshly accepted basis query below;
      // only these four existing definitions supply facts we actually reuse.
      if (name && name !== 'standards') savedStudies.set(name, study);
    }
    return readDefinitions();
  };
  const collect: Reply = context => {
    const result = data(context);
    assert.equal(result.view, 'input', 'editing reads saved input pages, not unrelated calculation or standard evidence');
    fields.push(...result.items.filter((item: any) => item.section === 'structure' && /\/layers\/insulation\/thickness$/.test(item.path)));
    if (result.next_page) return advance(faux, state, collect, 'type_read', result.next_page);
    assert.ok(fields.length, 'the type must expose insulation thickness with stable field paths');
    assert.ok(fields.every(field => field.unit === 'mm'), 'the model uses exactly the tool display unit');
    cable = fields[0].path.split('/')[2].replace(/~1/g, '/').replace(/~0/g, '~');
    return advance(faux, state, afterStudyList, 'study_list', { workspace_id: state.typeId });
  };
  const inspectExisting: Reply = context => {
    const outline = data(context);
    assert.equal(outline.objects.cable_types.length, 1, 'the named type exposes one actual cable structure');
    const object = outline.objects.cable_types[0];
    const paths: string[] = object.fields.filter((field: any) => /\/conductor\/nominal_area$/.test(field.path))
      .map((field: any) => field.path.replace('/conductor/nominal_area', '/layers/insulation/thickness'));
    assert.ok(paths.length > 0 && paths.length <= 8, 'discover each saved core identity before requesting its insulation field');
    return advance(faux, state, context => {
      const saved = data(context);
      assert.equal(saved.workspace_revision, outline.workspace_revision, 'all requested fields belong to the inspected saved revision');
      assert.equal(saved.freshness, 'current');
      assert.equal(saved.fields.length, paths.length);
      for (const path of paths) {
        const field = saved.fields.find((item: any) => item.path === path);
        assert.ok(field && typeof field.value === 'number' && ['m', 'mm'].includes(field.unit),
          'each proposed change starts from its actual saved value and declared unit');
        fields.push(field);
      }
      cable = paths[0].split('/')[2].replace(/~1/g, '/').replace(/~0/g, '~');
      return advance(faux, state, afterStudyList, 'study_list', { workspace_id: state.typeId });
    }, 'workspace_read', { workspace_id: state.typeId, paths });
  };
  const readType = () => input.typeId
    ? advance(faux, state, inspectExisting, 'workspace_read', { workspace_id: state.typeId })
    : advance(faux, state, collect, 'type_read', { type_id: state.typeId, view: 'input', limit: 20 });
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
    + '实际系统线电压为10 kV，电缆额定电压保持原值；按已保存30 °C同埋深单回工况做GB 50217校正并导出计算书，每步先让我接受。' + FORMAL_DOCUMENT_PROMPT;
}

export function installGbWorkflow(faux: Faux, input: GbFixture & { baselineReviewed: boolean }): FlowState {
  const state: FlowState = { done: false };
  let method: Record<string, any>;
  let contractDigest: string;
  const finish: Reply = context => { const saved = receipt(context); assert.equal(saved.kind, 'delivery'); state.file = saved.download_url; state.done = true;
    const current = state.result!.headlines.find((row: any) => row.key === 'ampacity').display_value;
    return text(`GB 50217 校正后允许电流为 ${current.toFixed(1)} A，计算书来自该次保存运行。\n基准是工程师明确核对的已保存IEC参考结果，不是厂家保证值；适用条件、校正系数与标准出处请在工作台核对。`); };
  const afterRead: Reply = context => { state.result = data(context); assert.equal(state.result.run_id, state.run);
    return advance(faux, state, finish, 'propose_delivery', { workspace_id: input.workspace, run_ids: [state.run], document: FORMAL_DOCUMENT }); };
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
  const proposeCorrection = (basis: unknown) => {
    assert.ok(typeof basis === 'string', 'the fixed standard basis must come from the sealed parameter contract');
    assert.match(basis, /^[0-9a-f]{64}$/);
    return advance(faux, state, afterCreate, 'propose_study', { workspace_id: input.workspace, title: 'Agent 验收 · GB 50217 明示基准温度校正', method,
      parameters: { baseline_current_a: input.baselineCurrent, baseline_ambient_k: 298.15, baseline_soil_rho: 1.2,
        // The sealed GB contract's manufacturer enum also covers saved results.
        // This fixture cites its real IEC run/PDF, not a manufacturer guarantee.
        baseline_kind: 'manufacturer', baseline_source: input.baselineSource, baseline_sha256: input.baselineDigest,
        baseline_page: input.baselinePage, baseline_depth_m: 0.8, baseline_reviewed: input.baselineReviewed, basis_release_digest: basis } });
  };
  const afterBasisContract: Reply = context => {
    const saved = data(context);
    assert.equal(saved.projection, 'result_page');
    assert.equal(saved.source.response_digest, contractDigest, 'the extra field must belong to the same inspected contract');
    return proposeCorrection(saved.page.value?.default);
  };
  const afterContract: Reply = context => {
    const contracts = data(context).contracts as Record<string, any>[] | undefined;
    const index = contracts?.findIndex(item => item.method.plugin_id === method.plugin_id && item.method.capability === method.capability) ?? -1;
    assert.ok(contracts && index >= 0, 'read the actual installed GB parameter contract');
    const basis = contracts[index].parameter_schema?.properties?.basis_release_digest?.default;
    if (typeof basis === 'string') return proposeCorrection(basis);
    // A plugin's full domain/schema tree can exceed the result budget. Follow the authenticated read reference for the one
    // required field; do not restore the whole schema to the context or substitute a digest from a fixture or configuration.
    const read = JSON.parse(toolText(context)).detail?.read;
    assert.equal(read?.tool, 'plugin_inspect', 'an omitted contract field needs an actual read-only continuation');
    assert.equal(read.arguments.workspace_id, input.workspace);
    assert.equal(read.arguments.plugin_id, method.plugin_id);
    assert.equal(read.arguments.capability, method.capability);
    contractDigest = read.arguments.result_digest;
    assert.match(contractDigest, /^[0-9a-f]{64}$/);
    return advance(faux, state, afterBasisContract, read.tool, { ...read.arguments,
      result_view: `/contracts/${index}/parameter_schema/properties/basis_release_digest`, result_offset: 0 });
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
