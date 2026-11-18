// Model observations are deliberately different from review cards and saved evidence. Keep complete source values on the
// platform/in the card, give the model enough facts to continue, and let authorized reads expand one small source page at a time.
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { BackendTool, ToolResult } from './backend.ts';
import type { Shown } from './cards.ts';
import { scrubPaths } from '../host/agent-tools.ts';

export const MODEL_RESULT_MAX_CHARS = 12_000;
export const MODEL_RESULT_MAX_BYTES = 18_000;
const HISTORY_TARGET_CHARS = 4_000;
const record = (value: unknown): value is Record<string, any> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const rows = (value: unknown): Record<string, any>[] => Array.isArray(value) ? value.filter(record) : [];
const pick = (value: Record<string, any>, keys: string[]) => Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value) ?? 'null', 'utf8');
const pointer = (path: string, key: string | number) => path + '/' + String(key).replace(/~/g, '~0').replace(/\//g, '~1');
const priority = ['status', 'kind', 'executed', 'complete', 'may_have_written', 'engineering_approval', 'state', 'integrity',
  'error', 'code', 'missing_count', 'missing_spec_count', 'error_count', 'incomplete_count', 'row_count', 'valid_count',
  'check_counts', 'statuses', 'next_read', 'next_page', 'detail', 'read', 'arguments', 'data', 'receipt', 'result',
  'message', 'id', 'title', 'name', 'object',
  'run_id', 'study_id', 'workspace_id', 'type_id', 'preview_id', 'preview_digest', 'series_id', 'batch_id', 'sha256',
  'created', 'missing', 'missing_fields', 'next_offset',
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
  const checks = record(data.checks) ? { ...pick(data.checks, ['integrity', 'numerical', 'engineering_approval', 'cad_analysis_qualification']),
    ...(record(data.checks.artifact_status) ? { artifact_status: Object.fromEntries(Object.entries(data.checks.artifact_status)
      .filter(([, artifacts]) => record(artifacts)).map(([caseId, artifacts]) => [caseId,
        Object.fromEntries(Object.entries(artifacts as Record<string, any>).filter(([, state]) => record(state))
          .map(([kind, state]) => [kind, pick(state as Record<string, any>, ['status', 'reason'])]))])) } : {}) } : data.checks;
  return { ...pick(data, ['run_id', 'study_id', 'workspace_id', 'workspace_revision', 'study_revision', 'status', 'integrity', 'freshness',
    'input_digest', 'output_digest', 'method', 'headlines', 'assessment', 'method_family', 'input_fields', 'case_input_digest', 'read_hint',
    'limitations', 'warnings', 'diagnostics', 'next_actions']),
    cases: rows(data.cases).map(item => ({ ...pick(item, ['case_id', 'status', 'error', 'warnings', 'diagnostics', 'limitations']),
      results: rows(item.results).filter(importantQuantity), factors: rows(item.factors).map(factor => pick(factor,
        ['key', 'title', 'label', 'entity', 'entity_name', 'condition', 'value', 'unit', 'status', 'reason', 'message', 'statement'])),
      quantity_count: rows(item.results).length })),
    checks };
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
  if (receipt.kind === 'structure_import') {
    const specs = rows(receipt.specs);
    return { ...pick(receipt, ['kind', 'status', 'executed', 'complete', 'may_have_written', 'series_id', 'created', 'state',
      'preview_id', 'preview_digest', 'skipped_rows', 'next_read', 'error', 'message']),
      missing_spec_count: specs.filter(spec => Array.isArray(spec.missing) && spec.missing.length).length,
      missing_fields: [...new Set(specs.flatMap(spec => Array.isArray(spec.missing) ? spec.missing : []))],
      specs: specs.map(spec => pick(spec, ['id', 'name', 'workspace_id', 'model_id', 'version', 'content_sha256', 'state', 'missing'])),
      engineering_approval: false };
  }
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

/** The platform exposes its projection beside the same legacy top-level
 * fields. Keep one exact copy, and promote only non-conflicting page metadata.
 * Different values remain separate evidence rather than being overwritten. */
function workspaceSummary(data: Record<string, any>): Record<string, any> {
  if (!record(data.agent_projection)) return data;
  const result = { ...data };
  const projection = { ...data.agent_projection };
  for (const [key, value] of Object.entries(projection)) {
    if (Object.hasOwn(result, key) && JSON.stringify(result[key]) === JSON.stringify(value)) delete projection[key];
    else if (['coverage', 'lock_summary', 'view', 'offset', 'total_parts', 'next_page'].includes(key) && !Object.hasOwn(result, key)) {
      result[key] = value;
      delete projection[key];
    }
  }
  if (Object.keys(projection).length) result.agent_projection = projection;
  else delete result.agent_projection;
  return result;
}

function savedRunSource(source: Record<string, any>, digestBound: boolean, owner?: Record<string, any>): Record<string, any> {
  if (!digestBound || typeof source.run_id !== 'string' || typeof source.study_id !== 'string') return source;
  // The read digest addresses the complete source. Equal IDs already on the
  // enclosing run need no second copy; different source identities stay exact.
  const { input_digest: _input, output_digest: _output, archive_url: _archive, ...identity } = source;
  for (const key of ['run_id', 'study_id', 'channel'])
    if (owner?.[key] !== undefined && owner[key] === identity[key]) delete identity[key];
  return identity;
}

function dataSummary(tool: string, data: Record<string, any>, digestBound = false): Record<string, any> {
  if (data.projection === 'result_page') return data;
  if (tool === 'study_compare') return comparisonSummary(data);
  if (tool === 'run_read') return runSummary(data);
  const result = { ...(tool === 'workspace_read' ? workspaceSummary(data) : data) };
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
    ...pick(item, ['section', 'id', 'label', 'title', 'path', 'value', 'unit', 'display_value', 'display_unit', 'status', 'message', 'missing', 'editable',
      'blocking', 'excluded', 'exclusion_reason', 'construction', 'base_reference', 'creation', 'locks', 'reason', 'result', 'quantities', 'quantity_missing', 'verdict', 'standard', 'clause',
      'printed_page', 'pdf_page', 'source_status', 'run_id', 'study_id', 'channel', 'stale', 'submission_id', 'published_asset_id']),
    ...(record(item.material) ? { material: pick(item.material, ['id', 'name']) } : {}),
    ...(record(item.source) ? { source: savedRunSource({
      ...pick(item.source, ['index', 'kind', 'origin', 'reference', 'reviewed', 'type_id', 'revision', 'digest', 'path',
        'channel', 'workspace_id', 'run_id', 'study_id', 'case_id', 'input_digest', 'output_digest', 'workspace_revision',
        'study_revision', 'method', 'freshness', 'status', 'engineering_approval', 'archive_url']),
      ...(record(item.source.provenance) ? { provenance: pick(item.source.provenance, ['kind', 'origin', 'reference', 'reviewed']) } : {}),
    }, digestBound && item.section === 'runs', item) } : {}),
  }));
  if (tool === 'type_read') {
    if (record(data.object)) {
      const { updated: _updated, ...object } = data.object;
      for (const key of ['parent', 'source', 'subtype', 'validation', 'version']) if (object[key] === null) delete object[key];
      result.object = object;
    }
    if (Array.isArray(data.sources)) result.sources = data.sources.map(source => record(source) ? savedRunSource(source, digestBound) : source);
    if (digestBound && typeof data.check_details === 'string')
      result.check_details = 'source.index 对应本页 sources；完整依据按 detail.read 读取。';
  }
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

const jsonPointer = (value: unknown): value is string => typeof value === 'string'
  && (value === '' || value.startsWith('/')) && !/~(?![01])/.test(value);
const inputPointer = (value: unknown): value is string => jsonPointer(value)
  && /^\/(materials|cable_types|cables|circuits|installation|environment|requirements|routes|loads|conditions|parameters|input|cases|placements|boundary|ground)(\/|$)/.test(value);
const nativeReadTools = new Set(['object_find', 'object_relations', 'workspace_list', 'cable_model_read', 'inbox_read',
  'workspace_read', 'study_list', 'project_digest', 'study_read', 'run_list', 'run_read', 'type_read', 'plugin_inspect',
  'plugin_query', 'method_list', 'type_creation_options', 'structure_import_inspect', 'study_compare', 'resource_read', 'structure_import_read']);

/** A source JSON Pointer is a field address, not a machine path. Protect only
 * the structured pointer contracts; free text and actual file paths still use
 * the same path scrubber as every other model observation. */
function scrubObservation(value: any, roots: string[], context = 'envelope'): any {
  if (typeof value === 'string') return (context === 'pointer' && jsonPointer(value)) ? value : scrubPaths(value, roots);
  if (Array.isArray(value)) return value.map(item => scrubObservation(item, roots, context));
  if (!record(value)) return value;
  const readArguments = context === 'read_reference' && nativeReadTools.has(value.tool) && record(value.arguments);
  const page = context === 'data' && record(value.page)
    && (value.projection === 'result_page' || /^[a-f0-9]{64}$/.test(String(value.source?.response_digest ?? '')));
  return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    const pointerValue = (key === 'result_view' && context === 'read_arguments')
      || (key === 'view' && ['read_arguments', 'page'].includes(context))
      || (key === 'path' && context === 'page_item')
      || (key === 'children' && context === 'page_item' && Array.isArray(child) && child.every(jsonPointer))
      || (key === 'omitted_paths' && (context === 'detail' || (context === 'envelope' && value.projection === 'bounded_summary')))
      || (key === 'checks_path' && context === 'check_item' && /^\/items\/\d+\/checks$/.test(String(child)))
      || (['path', 'field'].includes(key) && inputPointer(child))
      || (['fields', 'input_paths'].includes(key) && Array.isArray(child) && child.every(inputPointer));
    const nested = pointerValue ? 'pointer' : readArguments && key === 'arguments' ? 'read_arguments'
      : context === 'envelope' && key === 'data' ? 'data'
      : context === 'envelope' && key === 'detail' ? 'detail'
      : (context === 'detail' && key === 'read') || key === 'next_read' ? 'read_reference'
      : context === 'data' && key === 'receipt' && child?.kind === 'structure_check' ? 'check_receipt'
      : context === 'check_receipt' && key === 'items' ? 'check_item'
      : page && key === 'page' ? 'page' : context === 'page' && key === 'items' ? 'page_item' : '';
    const savedKey = context === 'provenance' && inputPointer(key) ? key : scrubPaths(key, roots);
    return [savedKey, scrubObservation(child, roots, key === 'provenance' ? 'provenance' : nested)];
  }));
}

/** Last-resort truncation must not turn a successful read of a failed or
 * uncertain action into apparent execution success. These are copied flags
 * and counts, never inferred engineering conclusions. */
function executionState(value: Record<string, any>): Record<string, any> {
  const state = pick(value, ['status', 'kind', 'executed', 'complete', 'may_have_written', 'engineering_approval', 'state', 'integrity',
    'row_count', 'valid_count', 'error_count', 'incomplete_count', 'missing_count', 'missing_spec_count', 'item_count']);
  if (record(value.error)) state.error = pick(value.error, ['code']);
  else if (value.error !== undefined && bytes(value.error) < 300) state.error = value.error;
  if (Array.isArray(value.missing)) state.missing_count = value.missing.length;
  if (Array.isArray(value.missing_fields)) state.missing_field_count = value.missing_fields.length;
  return Object.fromEntries(Object.entries(state).filter(([, child]) => bytes(child) < 300));
}

function retainExecutionState(source: any, projected: any, depth = 0): any {
  if (!record(source) || !record(projected) || depth > 3) return projected;
  const result = { ...projected, ...executionState(source) };
  for (const key of ['data', 'receipt', 'result', 'checks']) if (record(source[key]))
    result[key] = retainExecutionState(source[key], record(projected[key]) ? projected[key] : {}, depth + 1);
  return result;
}

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
    : scopedReads(displayFacts(dataSummary(tool.name, result.data, /^[a-f0-9]{64}$/.test(result.result_digest ?? ''))), params);
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
  if (semantic || read) reply.detail = { summary_only: true, original_characters: JSON.stringify(result).length,
    character_limit: MODEL_RESULT_MAX_CHARS, byte_limit: MODEL_RESULT_MAX_BYTES,
    full_record: '完整明细保留在卡片和平台保存记录。', ...(read ? { read } : {}),
    instruction: read ? '完整明细按 read 取页；省略项尚未核对。' : '完整明细在卡片和保存记录；不重复写操作。' };
  if (bytes(reply) > MODEL_RESULT_MAX_BYTES || JSON.stringify(reply).length > MODEL_RESULT_MAX_CHARS) {
    reply.data = retainExecutionState(data, bounded(data, 7200, '', omitted));
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
  let clean = scrubObservation(value, roots);
  let text = JSON.stringify(clean) ?? 'null';
  if (text.length <= MODEL_RESULT_MAX_CHARS && Buffer.byteLength(text) <= MODEL_RESULT_MAX_BYTES) return text;
  const omitted = new Set<string>();
  clean = retainExecutionState(clean, bounded(clean, 7500, '', omitted));
  text = JSON.stringify({ projection: 'bounded_summary', value: clean, details_omitted: true,
    omitted_paths: [...omitted].slice(0, 8), instruction: '完整结果在原记录与卡片；仅按需使用所列只读分页工具，不重复写操作。' });
  if (text.length > MODEL_RESULT_MAX_CHARS || Buffer.byteLength(text) > MODEL_RESULT_MAX_BYTES) throw new Error('工具摘要仍超过上下文边界；请在工作台查看保存结果，勿重复写入。');
  return text;
}

/** Check pages were read in their original user turn. A later turn keeps their
 * totals and explicit missing fields, with the unchanged source read, rather
 * than duplicating every standard's sentence in each subsequent request. */
function historyTypePage(data: Record<string, any>): Record<string, any> {
  if (!Array.isArray(data.items)) return data;
  const items = rows(data.items);
  const checks = items.filter(item => item.section === 'checks');
  if (!checks.length) return data;
  const counts = (values: unknown[]) => values.reduce<Record<string, number>>((result, value) => {
    if (typeof value === 'string') result[value] = (result[value] ?? 0) + 1;
    return result;
  }, {});
  const missing = (item: Record<string, any>): unknown[] => [item.missing, item.result?.missing, item.result?.missing_parameters,
    item.result?.basis_missing_fields, ...rows(item.quantities).map(quantity => quantity.quantity_missing)]
    .flatMap(value => Array.isArray(value) ? value : typeof value === 'string' || value === true || record(value) ? [value] : []);
  return { ...pick(data, ['object', 'type_id', 'type_revision', 'view', 'total', 'next_page',
    'status', 'state', 'complete', 'executed', 'may_have_written', 'engineering_approval']),
    page_item_count: items.length,
    check_summary: {
      count: checks.length, channels: counts(checks.map(item => item.channel)),
      blocking_count: checks.filter(item => item.blocking === true).length,
      blocking_unknown_count: checks.filter(item => typeof item.blocking !== 'boolean').length,
      excluded_count: checks.filter(item => item.excluded === true).length,
      check_status_counts: counts(checks.map(item => item.status)),
      result_status_counts: counts(checks.map(item => item.result?.status)),
      verdict_counts: counts(checks.map(item => item.result?.verdict)),
      missing_check_count: checks.filter(item => missing(item).length || item.status === 'missing'
        || item.result?.status === 'missing' || item.result?.verdict === 'missing').length,
      explicit_missing_labels: [...new Set(checks.flatMap(missing).flatMap(value => typeof value === 'string' ? [value]
        : record(value) && typeof (value.label ?? value.field) === 'string' ? [value.label ?? value.field] : []))],
    },
    items: items.filter(item => item.section !== 'checks'),
    ...(Array.isArray(data.sources) ? { sources: data.sources.map(source => record(source) ? pick(source,
      ['kind', 'type_id', 'revision', 'workspace_id', 'study_id', 'run_id', 'case_id', 'channel', 'status', 'freshness', 'engineering_approval']) : source) } : {}),
  };
}

function historyRun(data: Record<string, any>): Record<string, any> {
  return { ...pick(data, ['run_id', 'study_id', 'workspace_id', 'workspace_revision', 'study_revision', 'status', 'integrity',
    'freshness', 'method', 'title', 'sequence', 'input_digest', 'output_digest', 'case_input_digest', 'limitations', 'warnings',
    'diagnostics', 'next_actions', 'checks', 'assessment', 'input_fields']),
    ...(Array.isArray(data.headlines) ? { headlines: rows(data.headlines).map(item => pick(item,
      ['key', 'title', 'entity', 'entity_name', 'case_id', 'case', 'condition', 'condition_name', 'status', 'reason',
        'value', 'unit', 'display_value', 'display_unit'])) } : {}),
    ...(Array.isArray(data.cases) ? { cases: rows(data.cases).map(item => ({
      ...pick(item, ['case_id', 'status', 'error', 'warnings', 'diagnostics', 'limitations', 'quantity_count']),
      ...(Array.isArray(item.factors) ? { factor_count: item.factors.length,
        factors: rows(item.factors).filter(factor => ['limiting_cable', 'hottest_cable', 'temperature_margin', 'current_margin'].includes(factor.key))
          .map(factor => pick(factor, ['key', 'title', 'label', 'entity', 'entity_name', 'condition', 'condition_name',
            'value', 'unit', 'status', 'reason', 'message', 'statement'])) } : {}),
    })) } : {}),
  };
}

function historyStudy(data: Record<string, any>): Record<string, any> {
  return { ...pick(data, ['workspace_id', 'study_id', 'revision', 'workspace_revision', 'run_id', 'case_id',
    'status', 'freshness', 'limitations', 'warnings', 'diagnostics', 'input_fields', 'parameter_fields',
    'parameter_units_unavailable', 'driver', 'next_read']),
    ...(record(data.definition) ? { definition: pick(data.definition, ['title', 'task', 'method', 'input_source']) } : {}),
    ...(Array.isArray(data.cases) ? { cases: rows(data.cases).map(item => pick(item, ['case_id', 'label', 'status'])) } : {}),
  };
}

function historyWorkspace(data: Record<string, any>): Record<string, any> {
  if ('fields' in data || !record(data.objects)) return data;
  const objects = Object.fromEntries(Object.entries(data.objects).map(([kind, entries]) => [kind,
    Array.isArray(entries) ? rows(entries).map(item => ({
      ...pick(item, ['id', 'name', 'label', 'kind', 'category', 'construction', 'path', 'medium_material', 'cable_type', 'object_part']),
      ...(Array.isArray(item.fields) ? { field_count: item.fields.length } : {}),
      ...(Array.isArray(item.placements) ? { placements: rows(item.placements).map(placement => pick(placement, ['cable', 'path'])) } : {}),
      ...(Array.isArray(item.cables) ? { cables: rows(item.cables).map(cable => pick(cable, ['id', 'label', 'phase', 'path'])) } : {}),
    })) : entries]));
  return { ...pick(data, ['workspace_id', 'workspace_revision', 'current_revision', 'freshness', 'name', 'projection',
    'view', 'offset', 'total_parts', 'next_page', 'next_read', 'coverage', 'lock_summary', 'locks', 'status', 'warnings', 'limitations']),
    objects, object_item_counts: Object.fromEntries(Object.entries(data.objects)
      .filter(([, entries]) => Array.isArray(entries)).map(([kind, entries]) => [kind, (entries as unknown[]).length])),
  };
}

function historyData(tool: string, data: Record<string, any>): Record<string, any> {
  if (data.projection === 'result_page') return data;
  if (tool === 'type_read') return historyTypePage(data);
  if (tool === 'run_read') return historyRun(data);
  if (tool === 'study_read') return historyStudy(data);
  if (tool === 'workspace_read') return historyWorkspace(data);
  if (data.receipt?.kind === 'run' && record(data.receipt.result)) return { ...data,
    receipt: { ...data.receipt, result: historyRun(data.receipt.result) },
    ...(record(data.proposal) ? { proposal: pick(data.proposal, ['id', 'title', 'status', 'change_count', 'assumptions']) } : {}),
  };
  return data;
}

function historyProjection(tool: string, value: Record<string, any>, catalog: readonly BackendTool[], current: string): string | undefined {
  const detail = value.detail;
  const read = record(detail) && record(detail.read) ? detail.read : undefined;
  if (!read || detail.history_summary === true || !record(read.arguments) || !record(value.data) || value.status === 'error' || bytes(read) > 3000
    || catalog.find(entry => entry.name === read.tool)?.kind !== 'read') return;
  // A digest-bound read rejects changed sources; a run ID already identifies an
  // immutable saved run. Live unversioned workspace outlines are not evidence
  // references and must not silently replace the old facts.
  const stable = /^[a-f0-9]{64}$/.test(String(read.arguments.result_digest ?? ''))
    || (read.tool === 'run_read' && ['workspace_id', 'study_id', 'run_id'].every(key => typeof read.arguments[key] === 'string'));
  if (!stable) return;
  const data = historyData(tool, value.data);
  if (data === value.data) return;
  const text = JSON.stringify({ ...value, data, detail: { ...detail, history_summary: true, history_target_characters: HISTORY_TARGET_CHARS,
    instruction: '先前回合摘要；逐项依据按 read 回读，省略不表示通过。' } });
  // Four thousand characters is an optimization target, not permission to
  // remove limitations. Any shorter complete projection under both hard caps
  // is useful, even when all the limitations take more than the target.
  return text.length < current.length && text.length <= MODEL_RESULT_MAX_CHARS && Buffer.byteLength(text) <= MODEL_RESULT_MAX_BYTES ? text : undefined;
}

interface HistoryTool {
  index: number;
  callId: string;
  value: Record<string, any>;
}

/** A reference substitutes only repeated model evidence. Each message keeps
 * its own exact reader and original size; the first fact/skill remains visible
 * in this same provider prefix, and the stored transcript is never changed. */
function historyReference(value: Record<string, any>, callId: string, pages = false): Record<string, any> {
  const state = record(value.data) ? retainExecutionState(value.data, {}) : {};
  return { status: value.status, summary: pages ? '先前完整分页汇总见引用；已读完不表示工程通过。' : '相同保存事实见引用；原记录仍可回读。',
    data_ref: { tool_call_id: callId, path: '/data' }, ...(Object.keys(state).length ? { data_state: state } : {}),
    ...pick(value, ['diagnostics', 'next_actions']),
    detail: { ...pick(value.detail, ['read', 'original_characters', 'character_limit', 'byte_limit']), history_summary: true } };
}

function completeTypeHistory(pages: HistoryTool[]): Record<string, any> | undefined {
  if (pages.length < 2) return;
  const first = pages[0].value;
  const data = first.data;
  if (!Number.isSafeInteger(data.total) || data.total < 1 || !Number.isSafeInteger(data.type_revision)) return;
  let cursor = 0;
  let expected: Record<string, any> | undefined;
  const sourceByChannel = new Map<string, Record<string, any>>();
  const sourceIdentity = ['run_id', 'study_id', 'case_id', 'workspace_revision', 'study_revision', 'method', 'freshness', 'status', 'engineering_approval'];
  const addSource = (source: Record<string, any>, owner: Record<string, any>) => {
    const merged = { ...source };
    for (const key of ['run_id', 'study_id', 'channel']) if (owner[key] !== undefined) {
      if (merged[key] !== undefined && !isDeepStrictEqual(merged[key], owner[key])) return false;
      merged[key] = owner[key];
    }
    if (typeof merged.channel !== 'string' || typeof merged.run_id !== 'string' || typeof merged.study_id !== 'string') return true;
    const previous = sourceByChannel.get(merged.channel);
    if (previous && sourceIdentity.some(key => previous[key] !== undefined && merged[key] !== undefined
      && !isDeepStrictEqual(previous[key], merged[key]))) return false;
    sourceByChannel.set(merged.channel, { ...previous, ...merged });
    return true;
  };
  const counts: Record<string, any> = { count: 0, channels: {}, blocking_count: 0, blocking_unknown_count: 0, excluded_count: 0,
    check_status_counts: {}, result_status_counts: {}, verdict_counts: {}, missing_check_count: 0, explicit_missing_labels: [] };
  const items: Record<string, any>[] = [];
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const value = pages[pageIndex].value;
    const page = value.data;
    const read = value.detail?.read;
    if (value.status !== 'ok' || value.detail?.truncated || value.detail?.history_summary || read?.tool !== 'type_read'
      || !record(read.arguments) || !/^[a-f0-9]{64}$/.test(String(read.arguments.result_digest ?? ''))
      || read.arguments.result_view !== '' || read.arguments.result_offset !== 0
      || !Array.isArray(page?.items) || page.items.some((item: unknown) => !record(item))
      || page.type_id !== data.type_id || page.type_revision !== data.type_revision || page.view !== 'runs' || page.total !== data.total
      || !isDeepStrictEqual(page.object, data.object)) return;
    const { result_view: _view, result_offset: _offset, result_digest: _digest, ...arguments_ } = read.arguments;
    if (arguments_.type_id !== data.type_id || arguments_.view !== 'runs' || (arguments_.after ?? 0) !== cursor
      || (arguments_.expected_revision !== undefined && arguments_.expected_revision !== data.type_revision)
      || (expected && !isDeepStrictEqual(arguments_, expected))) return;
    cursor += page.items.length;
    if (!page.items.length || cursor > data.total) return;
    for (const item of page.items) {
      let source = item.source;
      if (record(source) && source.index !== undefined) {
        if (!Number.isSafeInteger(source.index) || source.index < 0 || !record(page.sources?.[source.index])) return;
        source = page.sources[source.index];
      }
      if (record(source) && !addSource(source, item)) return;
      if (item.section !== 'checks') items.push({ ...item, ...(record(source) ? { source } : {}) });
    }
    const summary = historyTypePage(page).check_summary;
    if (summary) {
      for (const key of ['count', 'blocking_count', 'blocking_unknown_count', 'excluded_count', 'missing_check_count']) counts[key] += summary[key];
      for (const key of ['channels', 'check_status_counts', 'result_status_counts', 'verdict_counts'])
        for (const [name, count] of Object.entries(summary[key])) counts[key][name] = (counts[key][name] ?? 0) + Number(count);
      counts.explicit_missing_labels = [...new Set([...counts.explicit_missing_labels, ...summary.explicit_missing_labels])];
    }
    if (pageIndex === pages.length - 1) {
      if (page.next_page !== null || cursor !== data.total) return;
    } else {
      if (!record(page.next_page) || page.next_page.after !== cursor || page.next_page.expected_revision !== data.type_revision) return;
      expected = page.next_page;
    }
  }
  const remainingSources = [...sourceByChannel.values()].filter(source => !items.some(item => item.section === 'runs'
    && item.run_id === source.run_id && item.study_id === source.study_id && item.channel === source.channel));
  return { status: first.status, summary: '先前完整分页的历史汇总；已读完不表示工程通过。',
    data: { ...pick(data, ['object', 'type_id', 'type_revision', 'view', 'total', 'status', 'state', 'engineering_approval']),
      history_aggregate: 'completed_type_pages', read_complete: true, read_page_count: pages.length, read_item_count: cursor,
      check_summary: counts, items, ...(remainingSources.length ? { check_sources: remainingSources } : {}) },
    detail: { ...pick(first.detail, ['read', 'original_characters', 'character_limit', 'byte_limit']), history_summary: true } };
}

function repeatedHistory<T extends { role: string }>(messages: T[], originals: Map<number, Record<string, any>>,
  catalog: readonly BackendTool[], lastUser: number, editedAt: number | undefined): T[] {
  const output = [...messages];
  const groups = new Map<string, HistoryTool[]>();
  const failedTurns = new Set<number>();
  const grouped = new Set<number>();
  const textOf = (message: T) => {
    const content = (message as T & { content?: any[] }).content;
    return content?.length === 1 && content[0].type === 'text' ? String(content[0].text) : undefined;
  };
  const fitsText = (text: string) => text.length <= MODEL_RESULT_MAX_CHARS && Buffer.byteLength(text) <= MODEL_RESULT_MAX_BYTES;
  const replace = (index: number, text: string) => {
    const old = textOf(output[index]);
    if (old === undefined || old === text || !fitsText(text)) return;
    output[index] = { ...output[index], content: [{ type: 'text', text }], ...(editedAt === undefined ? {} : { timestamp: editedAt }) };
  };
  let turn = -1;
  messages.forEach((message, index) => {
    if (message.role === 'user') turn = index;
    const item = message as T & { toolName?: string; toolCallId?: string; isError?: boolean };
    if (index >= lastUser || item.role !== 'toolResult' || item.toolName !== 'type_read') return;
    const value = originals.get(index);
    if (item.isError || value?.status === 'error') failedTurns.add(turn);
    if (!value || value.data?.view !== 'runs' || !item.toolCallId || textOf(message) === undefined) return;
    const key = JSON.stringify([turn, value.data.type_id, value.data.type_revision]);
    const pages = groups.get(key) ?? [];
    pages.push({ index, callId: item.toolCallId, value });
    groups.set(key, pages);
  });
  for (const [key, pages] of groups) {
    if (failedTurns.has(JSON.parse(key)[0])) continue;
    const combined = completeTypeHistory(pages);
    if (!combined) continue;
    const texts = pages.map((page, index) => JSON.stringify(index === 0 ? combined : historyReference(page.value, pages[0].callId, true)));
    if (!texts.every(fitsText) || texts.reduce((sum, text) => sum + text.length, 0)
      >= pages.reduce((sum, page) => sum + textOf(messages[page.index])!.length, 0)) continue;
    pages.forEach((page, index) => { replace(page.index, texts[index]); grouped.add(page.index); });
  }
  const reads: { callId: string; value: Record<string, any>; facts: Record<string, any> }[] = [];
  const skills = new Map<string, string>();
  output.forEach((message, index) => {
    const item = message as T & { toolName?: string; toolCallId?: string; isError?: boolean };
    if (index >= lastUser || item.role !== 'toolResult' || item.isError || !item.toolCallId || grouped.has(index)) return;
    const text = textOf(message);
    if (text === undefined) return;
    if (item.toolName === 'read' && /^---\r?\nname:/.test(text) && !text.includes('【技能尚未读完；')) {
      const prior = skills.get(text);
      if (prior && prior !== item.toolCallId) replace(index, JSON.stringify({ summary: '技能全文同前，沿用完整规则。', history_ref: { tool_call_id: prior } }));
      else skills.set(text, item.toolCallId);
      return;
    }
    const value = originals.get(index);
    if (!value || value.status !== 'ok' || !record(value.data) || !record(value.detail?.read)
      || catalog.find(tool => tool.name === item.toolName)?.kind !== 'read') return;
    let facts: Record<string, any>;
    try { facts = JSON.parse(text); } catch { return; }
    if (!record(facts.data) || facts.data_ref) return;
    const prior = reads.find(previous => previous.callId !== item.toolCallId && isDeepStrictEqual(previous.value.data, value.data)
      && isDeepStrictEqual(previous.value.detail.read, value.detail.read) && isDeepStrictEqual(previous.facts.data, facts.data)
      && ['status', 'summary', 'diagnostics', 'next_actions'].every(key => isDeepStrictEqual(previous.value[key], value[key])));
    if (prior) {
      const reference = JSON.stringify(historyReference(value, prior.callId));
      if (reference.length < text.length) replace(index, reference);
    } else reads.push({ callId: item.toolCallId, value, facts });
  });
  return output;
}

/** Reopening a pre-fix conversation must not send its old 870 kB tool content
 * again. Only the provider copy of ended turns is compacted further; session
 * content, non-text parts, review cards and source evidence stay untouched. */
export function projectHistory<T extends { role: string }>(messages: T[], catalog: readonly BackendTool[], roots: string[]): T[] {
  const calls = new Map<string, { name: string; arguments: Record<string, unknown> }>();
  const originals = new Map<number, Record<string, any>>();
  const lastUser = messages.findLastIndex(message => message.role === 'user');
  const userTimestamp = (messages[lastUser] as (T & { timestamp?: number }) | undefined)?.timestamp;
  const previousAssistantTime = messages.slice(0, Math.max(lastUser, 0)).reduce((latest, message) => {
    const timestamp = (message as T & { timestamp?: number }).timestamp;
    return message.role === 'assistant' && typeof timestamp === 'number' && Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
  }, Number.NEGATIVE_INFINITY);
  // pi invalidates usage when a prefix was edited after the response. Use this
  // user turn's real edit time, not Date.now() on every request, so a new actual
  // response can become the next usage anchor. This never touches the ledger.
  const editedAt = typeof userTimestamp === 'number' && Number.isFinite(userTimestamp)
    ? Math.max(userTimestamp, previousAssistantTime + 1) : undefined;
  const projected = messages.map((message, index) => {
    const item = message as T & { content?: any[]; toolCallId?: string; toolName?: string; isError?: boolean };
    if (item.role === 'assistant') for (const part of item.content ?? []) if (part.type === 'toolCall') calls.set(part.id, part);
    if (item.role !== 'toolResult') return message;
    const call = calls.get(item.toolCallId ?? '');
    const tool = catalog.find(entry => entry.name === item.toolName);
    let changed = false;
    let content = (item.content ?? []).map(part => {
      if (part.type !== 'text') return part;
      try {
        let value = JSON.parse(part.text);
        let text = part.text;
        if (tool && record(value.data) && !value.detail && !value.projection) {
          value = modelResult(tool, call?.arguments ?? {}, { status: item.isError || value.status === 'error' ? 'error' : 'ok',
            summary: value.summary ?? '', data: value.data, diagnostics: value.diagnostics ?? [], next_actions: value.next_actions ?? [],
            ...(typeof value.result_digest === 'string' ? { result_digest: value.result_digest } : {}) });
          text = resultText(value, roots);
          value = JSON.parse(text);
        }
        if (index < lastUser && item.content?.length === 1 && record(value)) originals.set(index, value);
        if (index < lastUser && record(value)) text = historyProjection(item.toolName ?? '', value, catalog, text) ?? text;
        if (text.length > MODEL_RESULT_MAX_CHARS || Buffer.byteLength(text) > MODEL_RESULT_MAX_BYTES) text = resultText(
          item.isError ? { ...(record(value) ? value : { data: value }), status: 'error', summary: '保存工具诊断较长；以下仅为有界诊断摘要。' } : value, roots);
        if (text !== part.text) { changed = true; return { ...part, text }; }
        return part;
      } catch { /* Skills and old failure messages are plain text. */ }
      if (part.text.length <= MODEL_RESULT_MAX_CHARS && Buffer.byteLength(part.text) <= MODEL_RESULT_MAX_BYTES) return part;
      changed = true;
      return { ...part, text: resultText({ ...(item.isError ? { status: 'error' } : {}),
        summary: '历史工具正文过长；原内容保留在会话，按需读取具体字段，不重复写操作。',
        original_characters: part.text.length, text: part.text }, roots) };
    });
    const text = content.filter(part => part.type === 'text').map(part => part.text).join('\n');
    if (text.length > MODEL_RESULT_MAX_CHARS || Buffer.byteLength(text) > MODEL_RESULT_MAX_BYTES) {
      const parts = content.filter(part => part.type === 'text').map(part => {
        try { return JSON.parse(part.text); } catch { return part.text; }
      });
      const boundedText = resultText({ ...(item.isError ? { status: 'error' } : {}),
        summary: '多段工具正文的有界摘要；省略项尚未核对，完整内容保留在会话和保存记录。', parts }, roots);
      let written = false;
      content = content.flatMap(part => {
        if (part.type !== 'text') return [part];
        if (written) return [];
        written = true;
        return [{ ...part, text: boundedText }];
      });
      changed = true;
    }
    return changed ? { ...message, content, ...(index < lastUser && editedAt !== undefined ? { timestamp: editedAt } : {}) } : message;
  });
  return repeatedHistory(projected, originals, catalog, lastUser, editedAt);
}
