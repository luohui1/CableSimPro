// Model observations are deliberately different from review cards and saved evidence. Keep complete source values on the
// platform/in the card, give the model enough facts to continue, and let authorized reads expand one small source page at a time.
import { createHash } from 'node:crypto';
import type { BackendTool, ToolResult } from './backend.ts';
import type { Shown } from './cards.ts';
import { scrubValue } from '../host/agent-tools.ts';

export const MODEL_RESULT_MAX_CHARS = 12_000;
export const MODEL_RESULT_MAX_BYTES = 18_000;
const record = (value: unknown): value is Record<string, any> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const rows = (value: unknown): Record<string, any>[] => Array.isArray(value) ? value.filter(record) : [];
const pick = (value: Record<string, any>, keys: string[]) => Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value) ?? 'null', 'utf8');
const pointer = (path: string, key: string | number) => path + '/' + String(key).replace(/~/g, '~0').replace(/\//g, '~1');
const priority = ['status', 'kind', 'executed', 'error', 'message', 'engineering_approval', 'id', 'title', 'name', 'object',
  'run_id', 'study_id', 'workspace_id', 'type_id', 'preview_id', 'preview_digest', 'series_id', 'batch_id', 'sha256',
  'created', 'row_count', 'valid_count', 'error_count', 'incomplete_count', 'next_read', 'next_page', 'next_offset',
  'headlines', 'fields', 'items', 'specs', 'declarations', 'differences', 'input_changes', 'method', 'definition'];

/** Whole values only: never clip serialized JSON or a numeric literal, and never imply omitted evidence has been read. */
function bounded(value: any, budget: number, path: string, omitted: Set<string>): any {
  if (bytes(value) <= budget) return value;
  omitted.add(path);
  if (typeof value === 'string') return { omitted: true, characters: value.length, path,
    sha256: createHash('sha256').update(value).digest('hex'), reason: '长文本保留在原记录，未作为模型证据读取。' };
  if (!record(value) && !Array.isArray(value)) return { omitted: true, path };
  const out: any = Array.isArray(value) ? [] : {};
  const entries = Object.entries(value);
  if (!Array.isArray(value)) entries.sort(([a], [b]) => {
    const rank = (key: string) => { const index = priority.indexOf(key); return index < 0 ? priority.length : index; };
    return rank(a) - rank(b);
  });
  for (const [key, child] of entries) {
    const available = budget - bytes(out) - bytes(key) - 20;
    if (available < 180) { omitted.add(pointer(path, key)); continue; }
    // Don't let one large branch consume the identities, counts or failure flags which follow it.
    const allowance = Math.min(available, Math.max(500, Math.floor(budget * .65)));
    const item = bounded(child, allowance, pointer(path, key), omitted);
    if (bytes(out) + bytes(item) + bytes(key) + 8 > budget) { omitted.add(pointer(path, key)); continue; }
    if (Array.isArray(out)) out.push(item); else out[key] = item;
  }
  return out;
}

const importantQuantity = (item: Record<string, any>) => ['ampacity', 'conductor_temperature', 'temperature_margin', 'current_margin'].includes(item.key);

function runSummary(data: Record<string, any>): Record<string, any> {
  return { ...pick(data, ['run_id', 'study_id', 'status', 'freshness', 'input_digest', 'output_digest', 'method', 'headlines',
    'assessment', 'method_family', 'input_fields', 'case_input_digest', 'read_hint']),
    cases: rows(data.cases).map(item => ({ ...pick(item, ['case_id', 'status', 'error', 'warnings', 'limitations']),
      results: rows(item.results).filter(importantQuantity), factors: rows(item.factors).map(factor => pick(factor, ['key', 'entity', 'condition', 'value', 'unit'])),
      quantity_count: rows(item.results).length })),
    checks: record(data.checks) ? pick(data.checks, ['integrity', 'numerical', 'engineering_approval', 'cad_analysis_qualification']) : data.checks };
}

const fieldNames: Record<string, string> = { thermal_resistivity: '土壤热阻率', thermal_conductivity: '导热系数',
  surface_temperature: '地表温度', air_temperature: '环境温度', temperature: '温度', depth: '埋深',
  insulation_thickness: '绝缘厚度', oversheath_thickness: '外护套厚度', currents: '负荷电流' };
const units: Record<string, string> = { thermal_resistivity: 'K·m/W', thermal_conductivity: 'W/(m·K)',
  surface_temperature: 'K', air_temperature: 'K', depth: 'm' };

/** Literal input differences, not a new engineering calculation. Full source snapshots remain in the saved comparison. */
function changedInputs(left: any, right: any, path = ''): Record<string, any>[] {
  if (JSON.stringify(left) === JSON.stringify(right)) return [];
  if ((record(left) && record(right)) || (Array.isArray(left) && Array.isArray(right))) {
    return [...new Set([...Object.keys(left), ...Object.keys(right)])].flatMap(key => changedInputs(
      (left as Record<string, any>)[key], (right as Record<string, any>)[key], pointer(path, key)));
  }
  const field = path.split('/').at(-1) ?? '';
  return [{ label: fieldNames[field] ?? '保存输入字段', trace: { path }, before: left ?? null, after: right ?? null,
    ...(units[field] ? { unit: units[field] } : {}) }];
}

function comparisonSummary(data: Record<string, any>): Record<string, any> {
  const comparison = data.comparison;
  if (!record(comparison)) return data;
  const sources = rows(comparison.sources);
  const names = new Map(sources.map(source => [source.run_id,
    [source.snapshot?.definition?.title, source.sequence === undefined ? '保存记录' : `第 ${source.sequence} 条记录`].filter(Boolean).join(' · ')]));
  return { ...pick(data, ['workspace_id', 'run_ids']), comparison: {
    ...pick(comparison, ['kind', 'interpretation']),
    sources: sources.map(source => ({ ...pick(source, ['run_id', 'sequence', 'created', 'status', 'headlines']), name: names.get(source.run_id) })),
    differences: rows(comparison.differences).map(difference => {
      const original = sources.find(source => source.run_id === difference.baseline_run_id);
      const current = sources.find(source => source.run_id === difference.run_id);
      const changes = original && current ? changedInputs(original.snapshot?.cases, current.snapshot?.cases) : [];
      const quantities = rows(difference.quantities);
      return { ...pick(difference, ['run_id', 'baseline_run_id', 'same_input', 'same_parameters', 'same_method']),
        baseline_name: names.get(difference.baseline_run_id), name: names.get(difference.run_id),
        quantities: quantities.filter(importantQuantity), quantity_count: quantities.length,
        input_changes: changes.slice(0, 12), input_change_count: changes.length,
        unmatched_count: Array.isArray(difference.unmatched) ? difference.unmatched.length : 0 };
    }),
  } };
}

function receiptSummary(receipt: Record<string, any>): Record<string, any> {
  // No full proposal, per-row value/source tree, input payload or plugin detail is needed to accept the NEXT proposal.
  if (receipt.kind === 'structure_upload') return { ...pick(receipt, ['kind', 'status', 'executed', 'attachment_id', 'upload_id',
    'filename', 'file', 'sha256', 'size', 'next_read', 'error', 'message']),
    sheets: rows(receipt.sheets).map(sheet => ({ ...pick(sheet, ['name', 'rows', 'table', 'first_data_row', 'data_rows']),
      columns: rows(sheet.columns).map(column => pick(column, ['index', 'letter', 'header', 'suggested'])) })),
    // Several complete declarations can themselves fill a context. Expose a directory, then read only the chosen declaration.
    declarations: rows(receipt.declarations).map((declaration, index) => ({ ...pick(declaration, ['table', 'sheet', 'first_data_row']),
      series_name: declaration.series?.name,
      next_read: { tool: 'structure_import_read', arguments: { kind: 'upload', id: receipt.upload_id,
        view: `/declarations/${index}`, limit: 10 } },
    })), engineering_approval: false };
  if (receipt.kind === 'structure_preview') {
    const preview = record(receipt.preview) ? receipt.preview : {};
    const problems = rows(preview.rows).filter(row => row.status !== 'ready' || row.issues?.length || row.missing?.length);
    return { ...pick(receipt, ['kind', 'status', 'executed', 'row_count', 'valid_count', 'error_count', 'incomplete_count',
      'upload_id', 'sha256', 'preview_id', 'preview_digest', 'next_read', 'error', 'message']),
      file: preview.file, sheet: preview.sheet, problem_row_count: record(receipt.preview) ? problems.length : null,
      problem_rows_available: record(receipt.preview),
      problem_rows: problems.map(row => pick(row, ['row_number', 'name', 'status', 'issues', 'missing'])),
      skipped_count: Array.isArray(preview.skipped) ? preview.skipped.length : null,
      preview_in_card: record(receipt.preview), engineering_approval: false };
  }
  if (receipt.kind === 'structure_import') return { ...pick(receipt, ['kind', 'status', 'executed', 'series_id', 'created', 'state',
    'preview_id', 'preview_digest', 'skipped_rows', 'next_read', 'error', 'message']),
    specs: rows(receipt.specs).map(spec => pick(spec, ['id', 'name', 'workspace_id', 'model_id', 'version', 'content_sha256', 'state'])),
    engineering_approval: false };
  if (receipt.kind === 'structure_check') {
    const items = rows(receipt.items);
    const statuses = Object.fromEntries([...new Set(items.map(item => String(item.status)))].map(status => [status, items.filter(item => item.status === status).length]));
    const verdict = (check: Record<string, any>) => String(check.verdict ?? check.status ?? 'unknown');
    const counts = (checks: Record<string, any>[]) => Object.fromEntries([...new Set(checks.map(verdict))]
      .map(value => [value, checks.filter(check => verdict(check) === value).length]));
    const summary = { ...pick(receipt, ['kind', 'id', 'batch_id', 'series_id', 'status', 'executed', 'complete', 'may_have_written', 'message', 'error', 'next_read']),
      check_counts: counts(items.flatMap(item => rows(item.checks))),
      item_count: items.length, statuses, items: items.map((item): Record<string, any> & { checks: Record<string, any>[] } => ({ ...pick(item, ['spec_id', 'name', 'workspace_id', 'study_id', 'run_id', 'status',
        'input_digest', 'output_digest', 'message', 'method_name', 'method_version', 'confidence', 'errors']),
        check_counts: counts(rows(item.checks)),
        checks: rows(item.checks).filter(check => !['passed', 'pass', 'succeeded'].includes(verdict(check)))
          .map(check => pick(check, ['name', 'title', 'label', 'key', 'verdict', 'reason', 'actual', 'limit', 'unit', 'comparison', 'status', 'message', 'missing'])) })),
      engineering_approval: false };
    // Reserve room for the tool envelope, proposal and read instruction. A catalogue must never consume the saved-run identities.
    const fits = (value: unknown, reserved = 0) => JSON.stringify(value).length <= 10000 - reserved && bytes(value) <= 15000 - reserved;
    if (fits(summary)) return summary;
    const common: Record<string, any> = {};
    for (const key of ['message', 'method_name', 'method_version', 'confidence', 'errors']) {
      const value = summary.items[0]?.[key];
      if (value !== undefined && summary.items.every(item => JSON.stringify(item[key]) === JSON.stringify(value))) common[key] = value;
    }
    const catalogue: Record<string, any>[] = [];
    const index = new Map<string, number>();
    const references = summary.items.map(item => item.checks.map(check => {
      // Actual values, limits, units and reasons are part of the key: equal titles do not imply equal engineering findings.
      const key = JSON.stringify(check);
      if (!index.has(key)) { index.set(key, catalogue.length); catalogue.push(check); }
      return index.get(key)!;
    }));
    const compactItems = summary.items.map((item, position) => {
      const { checks: _checks, ...identity } = item;
      for (const key of Object.keys(common)) delete identity[key];
      return { ...identity, issue_refs: [] as number[], omitted_issue_counts: counts(item.checks), checks_path: `/items/${position}/checks` };
    });
    const compact: Record<string, any> = { ...summary, common_item_details: common, items: compactItems,
      items_complete: true, issue_catalog: [], issue_catalog_count: catalogue.length, issue_catalog_complete: false,
      checks_in_card: true, checks_note: 'issue_refs 对应 issue_catalog 中的 id。计数包含全部检查；完整检查保留在卡片及保存记录，按 next_read 的 view 指定 checks_path 只读续查。' };
    // Very large batches are explicitly paged by whole items; the ordinary eleven-size manufacturer table keeps every identity.
    while (compact.items.length > 11 && !fits(compact, 1800)) compact.items.pop();
    if (compact.items.length !== items.length) {
      compact.items_complete = false;
      // The proposal receipt has no native read digest. Start at zero to obtain
      // it; only the backend's next_read may continue at a non-zero offset.
      compact.next_read = { ...receipt.next_read, arguments: { ...receipt.next_read?.arguments,
        view: '/items', offset: 0, limit: 10 } };
    }
    // Show at least a representative of each available verdict, then prioritize failed comparisons. Omitted detail remains counted.
    const rank = (check: Record<string, any>) => ({ failed: 0, fail: 0, missing: 1, uncovered: 2 }[verdict(check)] ?? 3);
    const visible = new Set(references.slice(0, compact.items.length).flat());
    const representatives = new Map<string, number>();
    const order = catalogue.map((check, id) => ({ id, check })).filter(entry => visible.has(entry.id));
    for (const { id, check } of order) if (!representatives.has(verdict(check))) representatives.set(verdict(check), id);
    const allocationRank = (entry: { id: number; check: Record<string, any> }) => rank(entry.check)
      - (representatives.get(verdict(entry.check)) === entry.id ? 10 : 0);
    order.sort((left, right) => allocationRank(left) - allocationRank(right));
    const included = new Set<number>();
    for (const { id, check } of order) {
      const candidateIds = new Set([...included, id]);
      const candidateItems = compact.items.map((item: Record<string, any>, position: number) => ({ ...item,
        issue_refs: references[position].filter(reference => candidateIds.has(reference)),
        omitted_issue_counts: counts(references[position].filter(reference => !candidateIds.has(reference)).map(reference => catalogue[reference])) }));
      const candidate = { ...compact, items: candidateItems, issue_catalog: [...compact.issue_catalog, { id, ...check }] };
      if (!fits(candidate)) continue;
      included.add(id);
      compact.items = candidateItems;
      compact.issue_catalog = candidate.issue_catalog;
    }
    compact.issue_catalog_complete = included.size === catalogue.length;
    return compact;
  }
  const result = { ...receipt };
  if (record(result.result) && result.result.run_id) result.result = runSummary(result.result);
  return result;
}

function dataSummary(tool: string, data: Record<string, any>): Record<string, any> {
  if (data.projection === 'result_page') return data;
  if (tool === 'study_compare') return comparisonSummary(data);
  if (tool === 'run_read') return runSummary(data);
  const result = { ...data };
  if (record(result.proposal)) result.proposal = {
    ...pick(result.proposal, ['id', 'title', 'status', 'checks', 'assumptions']),
    change_count: Array.isArray(result.proposal.changes) ? result.proposal.changes.length : 0,
    full_review_in_card: true,
  };
  if (record(result.receipt)) result.receipt = receiptSummary(result.receipt);
  if (tool === 'method_list') result.methods = rows(data.methods).map(method => ({
    ...pick(method, ['method', 'name', 'platform_supported']), capabilities: rows(method.capabilities).map(capability => pick(capability, ['id', 'title', 'preview'])),
  }));
  if (tool === 'type_read') result.items = rows(data.items).map(item => ({
    ...pick(item, ['section', 'label', 'title', 'path', 'value', 'unit', 'display_value', 'display_unit', 'status', 'message', 'missing', 'editable',
      'blocking', 'construction', 'base_reference', 'creation', 'locks', 'reason', 'quantities', 'verdict', 'standard', 'clause',
      'printed_page', 'pdf_page', 'source_status', 'run_id', 'study_id', 'channel', 'stale', 'submission_id', 'published_asset_id']),
    ...(record(item.material) ? { material: pick(item.material, ['id', 'name']) } : {}),
    ...(record(item.source) ? { source: {
      ...pick(item.source, ['kind', 'origin', 'reference', 'reviewed']),
      ...(record(item.source.provenance) ? { provenance: pick(item.source.provenance, ['kind', 'origin', 'reference', 'reviewed']) } : {}),
    } } : {}),
  }));
  if (tool === 'structure_import_inspect') delete result.preview_parameters; // The exact schema is already in the tool definition.
  return result;
}

/** Display conversions are explicitly labelled. SI facts and identifiers stay in trace metadata for exact subsequent calls. */
function displayFacts(value: any): any {
  if (Array.isArray(value)) return value.map(displayFacts);
  if (!record(value)) return value;
  // Exact engineering inputs and schema subtrees must remain copyable into the next strict tool contract.
  const exact = new Set(['parameters', 'method', 'mapping', 'series', 'request_schema', 'parameter_schema', 'preview_parameters']);
  const converted = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, exact.has(key) ? child : displayFacts(child)]));
  if (record(value.parameters) && value.parameters.eddy === 'ignored') converted.parameter_notes = ['未计涡流损耗，适用范围受限。'];
  if (typeof value.r20 === 'number') converted.r20_display = {
    label: '20 °C 导体直流电阻', value: Number((value.r20 * 1000).toPrecision(12)), unit: 'Ω/km',
    trace: { value_si: value.r20, unit_si: 'Ω/m' },
    note: '是否标准上限或厂家实测须依该字段的保存来源判断。',
  };
  if (typeof value.value === 'number' && ['ohm/m', 'Ω/m'].includes(value.unit)) {
    converted.display_value = Number((value.value * 1000).toPrecision(12));
    converted.display_unit = 'Ω/km';
    converted.trace = { ...(record(converted.trace) ? converted.trace : {}), value_si: value.value, unit_si: value.unit };
    // Retain value/unit for exact contracts; mark which pair is meant for prose, including standard upper-bound provenance.
    converted.presentation = '正文使用 display_value 与 display_unit；来源及是否标准上限仍以保存记录为准。';
  }
  if (value.condition === 'rating') converted.condition_name = '额定工况';
  if (value.condition === 'rating-simultaneous') converted.condition_name = '全回路共同载流能力';
  if (value.condition === 'operating') converted.condition_name = '保存负荷下';
  if (value.eddy === 'ignored') converted.eddy_note = '未计涡流损耗，适用范围受限';
  return converted;
}

interface DetailRead { tool: string; arguments: Record<string, unknown> }

/** Backend reads are scoped by the sidecar wrapper, so backend next_read references need that implicit scope restored. */
function scopedReads(value: any, params: Record<string, unknown>): any {
  if (Array.isArray(value)) return value.map(item => scopedReads(item, params));
  if (!record(value)) return value;
  const out = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, scopedReads(child, params)]));
  if (record(out.next_read) && record(out.next_read.arguments)) out.next_read = { ...out.next_read, arguments: {
    ...out.next_read.arguments,
    ...(typeof params.workspace_id === 'string' ? { workspace_id: params.workspace_id } : {}),
    ...(typeof params.type_id === 'string' ? { type_id: params.type_id } : {}),
  } };
  return out;
}

function detailRead(tool: BackendTool, params: Record<string, unknown>, result: ToolResult, view = ''): DetailRead | undefined {
  if (tool.kind === 'read') return { tool: tool.name, arguments: { ...params, result_view: view, result_offset: 0,
    ...(result.result_digest ? { result_digest: result.result_digest } : {}) } };
  const receipt = result.data.receipt;
  if (record(receipt?.next_read)) return { tool: receipt.next_read.tool, arguments: { ...receipt.next_read.arguments,
    ...(typeof params.workspace_id === 'string' ? { workspace_id: params.workspace_id } : {}) } };
  if (receipt?.run_id && (receipt.study_id || params.study_id)) return { tool: 'run_read', arguments: {
    workspace_id: params.workspace_id, study_id: receipt.study_id ?? params.study_id, run_id: receipt.run_id } };
  if (receipt?.type_id || params.type_id) return { tool: 'type_read', arguments: { type_id: receipt?.type_id ?? params.type_id, view: 'input', limit: 10 } };
  if (receipt?.study_id) return { tool: 'study_read', arguments: { workspace_id: params.workspace_id, study_id: receipt.study_id } };
  return undefined;
}

export function modelResult(tool: BackendTool, params: Record<string, unknown>, result: ToolResult, shown?: Shown): Record<string, any> {
  // Exact source pages may be copied into a strict subsequent contract. Do not add display-only properties inside them.
  const data = result.data.projection === 'result_page'
    ? { ...result.data, ...(result.data.next_read ? { next_read: scopedReads({ next_read: result.data.next_read }, params).next_read } : {}) }
    : scopedReads(displayFacts(dataSummary(tool.name, result.data)), params);
  const omitted = new Set<string>();
  const semantic = bytes(data) !== bytes(result.data);
  const read = detailRead(tool, params, result);
  const reply: Record<string, any> = { status: result.status, summary: result.summary, data,
    ...(shown?.target ? { subject: shown.target } : {}),
    ...(shown?.card?.kind === 'saved_run' ? { display: shown.card.view } : {}),
    ...(shown?.card?.kind === 'saved_type' ? { subject: shown.card.view.title } : {}),
    ...(result.diagnostics.length ? { diagnostics: result.diagnostics.map(diagnostic => pick(diagnostic, ['code', 'message', 'path'])) } : {}),
    ...(result.next_actions.length ? { next_actions: result.next_actions } : {}),
  };
  // Most tools are already small. The three large workflows above always omit detail even when the record happens to be small.
  if (semantic || read) reply.detail = { summary_only: true, full_record: '完整明细保留在审阅卡、结果卡及平台保存记录；摘要不等于逐项审核。',
    ...(read ? { read } : {}), instruction: '只为具体问题续读一页；按 page.items 的 path 展开，按 next_read 续页。不要把所有明细回填到上下文。标识只供工具和追溯，正文用对象名称。' };
  if (bytes(reply) > MODEL_RESULT_MAX_BYTES || JSON.stringify(reply).length > MODEL_RESULT_MAX_CHARS) {
    reply.data = bounded(data, 7200, '', omitted);
    reply.detail = { ...reply.detail, summary_only: true, truncated: true, omitted_paths: [...omitted].slice(0, 12),
      ...(read ? { read } : {}), instruction: '需要省略字段时把其路径作为 result_view（只读工具）；next_read 原样续页。不要重放写工具。长文本在卡片或保存记录查看。' };
    if (result.diagnostics.length) reply.diagnostics = bounded(reply.diagnostics, 1000, '/diagnostics', omitted);
    if (result.next_actions.length) reply.next_actions = bounded(reply.next_actions, 600, '/next_actions', omitted);
    if (bytes(reply.summary) > 1200) reply.summary = '工具已返回；正文过长，摘要及省略字段见下方，完整内容仍保存在原记录。';
  }
  return reply;
}

/** Hard boundary, including provider-independent errors and unexpected new tool payload shapes. */
export function resultText(value: unknown, roots: string[] = []): string {
  let clean = scrubValue(value, roots);
  let text = JSON.stringify(clean) ?? 'null';
  if (text.length <= MODEL_RESULT_MAX_CHARS && Buffer.byteLength(text) <= MODEL_RESULT_MAX_BYTES) return text;
  const omitted = new Set<string>();
  clean = bounded(clean, 8500, '', omitted);
  text = JSON.stringify({ projection: 'bounded_summary', value: clean, details_omitted: true,
    omitted_paths: [...omitted].slice(0, 8), instruction: '完整结果在原记录与卡片；仅按需使用所列只读分页工具，不重复写操作。' });
  if (text.length > MODEL_RESULT_MAX_CHARS || Buffer.byteLength(text) > MODEL_RESULT_MAX_BYTES) throw new Error('工具摘要仍超过上下文边界；请在工作台查看保存结果，勿重复写入。');
  return text;
}

/** Reopening a pre-fix conversation must not send its old 870 kB tool content again. Session/card details are left untouched. */
export function projectHistory<T extends { role: string }>(messages: T[], catalog: readonly BackendTool[], roots: string[]): T[] {
  const calls = new Map<string, { name: string; arguments: Record<string, unknown> }>();
  return messages.map(message => {
    const item = message as T & { content?: any[]; toolCallId?: string; toolName?: string };
    if (item.role === 'assistant') for (const part of item.content ?? []) if (part.type === 'toolCall') calls.set(part.id, part);
    if (item.role !== 'toolResult') return message;
    const call = calls.get(item.toolCallId ?? '');
    const tool = catalog.find(entry => entry.name === item.toolName);
    const content = (item.content ?? []).map(part => {
      if (part.type !== 'text') return part;
      try {
        const value = JSON.parse(part.text);
        if (tool && record(value.data) && !value.detail && !value.projection) return { ...part, text: resultText(modelResult(tool, call?.arguments ?? {},
          { status: value.status ?? 'ok', summary: value.summary ?? '', data: value.data, diagnostics: value.diagnostics ?? [], next_actions: value.next_actions ?? [] }), roots) };
      } catch { /* Skills and old failure messages are plain text. */ }
      return part.text.length <= MODEL_RESULT_MAX_CHARS && Buffer.byteLength(part.text) <= MODEL_RESULT_MAX_BYTES ? part
        : { ...part, text: resultText({ status: 'error', summary: '历史工具内容过长，完整内容保留在保存记录；请按需重新读取具体字段。', original_characters: part.text.length }, roots) };
    });
    return { ...message, content };
  });
}
