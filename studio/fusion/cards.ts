// What a step leaves on the page besides its line: the card of what it read (a saved run as the rating card; anything else as a way to
// its object in the workbench), a few notes, and what it acted on in the engineer's words. A card carries no number the model wrote:
// a saved run's figures are the run record's, read from the platform here, and a run that cannot be read fully is not drawn as a card.
import type { CardRef } from '../shared/types.ts';
import type { SavedRunView } from '../shared/fusion-types.ts';
import { compact, fixed } from '../shared/format.ts';
import { engineeringText } from '../shared/fusion-presentation.ts';
import { resultValue } from '../shared/products.ts';
import type { Backend, ToolResult } from './backend.ts';
import { savedRatingTable } from './rating-table.ts';
import { structureImportCard } from './structure-import.ts';

export interface Shown { card?: CardRef; notes?: string[]; target?: string }

/** Names of what the agent has met, so a step can say "研究「…」" instead of an identifier. Kept with each result, so a restart loses none. */
const names = new Map<string, string>();
const nameOf = (id: unknown): string | undefined => (typeof id === 'string' ? names.get(id) : undefined);

export function remember(_tool: string, result: ToolResult): void {
  const data = result.data;
  const take = (id: unknown, name: unknown) => { if (typeof id === 'string' && typeof name === 'string' && name) names.set(id, name); };
  for (const card of data.items ?? []) take(card?.id, card?.name);
  for (const row of data.studies ?? []) take(row?.id, row?.title);
  for (const row of data.workspaces ?? []) take(row?.id, row?.name);
  for (const row of [...(data.uses ?? []), ...(data.used_by ?? [])]) take(row?.target?.id, row?.target?.name);
  take(data.model?.id, data.model?.payload?.name);
  take(data.object?.id, data.object?.name);
  take(data.receipt?.study_id ?? data.receipt?.type_id, data.receipt?.title);
}

const quoted = (kind: string, id: unknown) => { const name = nameOf(id); return name ? `${kind}「${name}」` : undefined; };

/** A step's target from its call alone, before its result exists. */
export const targetFor = (tool: string, args: Record<string, unknown>): string | undefined =>
  targetOf(tool, args, typeof args.workspace_id === 'string' ? args.workspace_id : undefined);

function targetOf(tool: string, args: Record<string, unknown>, workspace: string | undefined): string | undefined {
  switch (tool) {
    case 'object_find': return typeof args.q === 'string' && args.q ? `检索“${args.q}”` : undefined;
    case 'object_relations': return quoted('对象', args.id);
    case 'cable_model_read': return quoted('型号', args.model_id);
    case 'type_read': return quoted('型号设计', args.type_id);
    case 'workspace_read': case 'study_list': case 'project_digest': return quoted('工程', workspace);
    case 'study_read': case 'run_list': case 'run_read': return quoted('研究', args.study_id) ?? quoted('工程', workspace);
    default: return undefined;
  }
}

/** A way to an object, in the address form the page's parent turns into the old workbench's own route. */
const href = (kind: string, id: string, extra: Record<string, string | undefined> = {}) => {
  const query = Object.entries(extra).filter((entry): entry is [string, string] => Boolean(entry[1])).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
  return `cablesim:${kind}/${encodeURIComponent(id)}${query ? '?' + query : ''}`;
};

interface Headline { key: string; case_id?: string; condition?: string; entity?: string; display_value?: number; display_unit?: string }
interface Factor { key: string; entity?: string; condition?: string; value?: number; unit?: string; source?: { run_id?: string; case_id?: string } }
interface Quantity {
  key: string; entity?: string; case?: string; value?: number; unit?: string; status?: string;
  rating_basis?: { kind?: string; varied_circuits?: string[]; fixed_currents_a?: Record<string, number> };
}
interface SavedCase { case_id?: string; status?: string; results?: Quantity[]; factors?: Factor[] }
interface RunSummary { id: string; sequence: number; freshness: SavedRunView['freshness']; headline: string | null }
interface Domain {
  cable_types?: { id?: string; rating?: { max_conductor_temperature?: { normal?: number } } }[];
  sections?: { backfill?: unknown; medium?: { surface_temperature?: number | null; air_temperature?: number | null } }[];
  circuits?: { id?: string; cable_type?: string; cables?: { id?: string }[] }[];
  load_cases?: { currents?: Record<string, unknown> }[];
}

const IEC = 'cablesim.iec60287';
const STEADY = 'steady-rating';
const KELVIN = 273.15;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const only = <T>(items: T[]): T | undefined => items.length === 1 ? items[0] : undefined;

async function savedRun(backend: Backend, workspace: string, result: ToolResult, signal?: AbortSignal): Promise<{ card: CardRef; notes: string[] } | undefined> {
  const data = result.data;
  if (!data.study_id || !data.run_id) return undefined;
  const study = String(data.study_id);
  const run = String(data.run_id);
  const open = (reason = '请在工作台查看此运行的完整保存结果。'): { card: CardRef; notes: string[] } => ({
    card: { kind: 'open', label: '查看已保存运行', href: href('study', study, { workspace, run }) }, notes: [reason],
  });
  if (data.method?.plugin_id !== IEC || data.method?.capability !== STEADY || data.status !== 'succeeded') return open();
  const headlines: Headline[] = data.headlines ?? [];
  const ampacity = only(headlines.filter(item => item.key === 'ampacity'));
  const kase = only<SavedCase>(data.cases ?? []);
  if (!kase?.case_id || kase.status !== 'succeeded') return open('此记录没有唯一可用工况，请在工作台逐项查看保存结果。');
  // run_read(case_id=...) narrows cases, while headlines may still describe a different recommended selection case.
  // Never join those by array position, or treat a multi-circuit minimum as the first circuit's rating and margin.
  if (!ampacity || !finite(ampacity.display_value) || ampacity.display_unit !== 'A' || ampacity.case_id !== kase.case_id
    || !ampacity.entity || !['rating', 'rating-simultaneous'].includes(ampacity.condition ?? '')) {
    return open('保存结论的工况或额定口径无法唯一对应，请在工作台查看此运行。');
  }

  // The producer's own sentence for the record (the conclusion, what it means, which cable limits), the record's number, the saved input.
  let summary: RunSummary | undefined;
  for (let after = 0, pages = 0; summary === undefined && pages < 10; pages += 1) {
    const page = await backend.read<{ items: RunSummary[]; next_cursor: number | null }>(`/api/workspaces/${workspace}/studies/${study}/runs?view=summary&limit=100&after=${after}`, signal);
    summary = page.items.find(item => item.id === run);
    if (page.next_cursor === null || page.next_cursor === undefined) break;
    after = page.next_cursor;
  }
  const input = await backend.read<{ input: Domain; run_id?: string; case_id?: string; integrity?: string }>(`/api/workspaces/${workspace}/studies/${study}/runs/${run}/cases/${kase.case_id}/input`, signal);
  if (input.integrity !== 'verified' || input.run_id !== run || input.case_id !== kase.case_id) return open('保存输入与此运行的工况标识无法核对，请在工作台查看记录。');
  const document = input.input;
  const circuit = only(document.circuits ?? []);
  const section = only(document.sections ?? []);
  const loadCase = only(document.load_cases ?? []);
  if (!circuit?.id || circuit.id !== ampacity.entity || !section || !loadCase || Object.keys(loadCase.currents ?? {}).length !== 1) {
    return open('此记录的回路、敷设段或负荷工况无法唯一对应，请在工作台分别查看。');
  }
  const load = loadCase.currents?.[circuit.id];
  if (!finite(load)) return open('此记录没有唯一的保存负荷电流，请在工作台查看各相或各回路结果。');

  const ratings = (kase.results ?? []).filter(item => item.key === 'ampacity');
  const rating = only(ratings.filter(item => item.entity === circuit.id && item.case === ampacity.condition));
  if (!rating || rating.unit !== 'A' || rating.status !== 'available' || rating.value !== ampacity.display_value) {
    return open('保存结论与同工况的额定电流证据不一致，请在工作台核对记录。');
  }
  // One balanced circuit can explicitly declare equivalent individual/common ratings. Retain that existing card only when
  // both saved quantities declare the same physical basis and agree at the displayed precision; never aggregate new values.
  if (ratings.length !== 1 && !(ratings.length === 2 && new Set(ratings.map(item => item.case)).size === 2
    && ratings.every(item => item.entity === circuit.id && ['rating', 'rating-simultaneous'].includes(item.case ?? '')
      && item.status === 'available' && item.unit === 'A' && finite(item.value) && fixed(item.value) === fixed(ampacity.display_value)
      && item.rating_basis?.kind === 'single_circuit' && item.rating_basis.varied_circuits?.length === 1
      && item.rating_basis.varied_circuits[0] === circuit.id && item.rating_basis.fixed_currents_a !== undefined
      && Object.keys(item.rating_basis.fixed_currents_a).length === 0))) {
    return open('此记录含多个不能合并展示的额定口径，请在工作台分别查看保存结果。');
  }
  const factors = (kase.factors ?? []).filter(item => item.source?.run_id === run && item.source.case_id === kase.case_id);
  const limitingCable = only(factors.filter(item => item.key === 'limiting_cable'))?.entity;
  const conductor = only(headlines.filter(item => item.key === 'conductor_temperature' && item.case_id === kase.case_id
    && item.condition === 'operating' && item.entity === limitingCable));
  const temperatureMargin = only(factors.filter(item => item.key === 'temperature_margin' && item.entity === limitingCable
    && item.condition === 'operating' && item.unit === 'K'))?.value;
  const currentMargin = only(factors.filter(item => item.key === 'current_margin' && item.entity === circuit.id
    && item.condition === ampacity.condition && item.unit === 'A'))?.value;
  const limit = only((document.cable_types ?? []).filter(item => item.id === circuit.cable_type))?.rating?.max_conductor_temperature?.normal;
  if (!limitingCable || !circuit.cables?.some(item => item.id === limitingCable) || conductor?.display_unit !== '°C'
    || !finite(conductor.display_value) || !finite(temperatureMargin) || !finite(currentMargin) || !finite(limit)
    || fixed(conductor.display_value + temperatureMargin) !== fixed(limit - KELVIN)
    || fixed(ampacity.display_value - load) !== fixed(currentMargin)) {
    return open('限制对象、温限或余量无法与同一工况和保存负荷对应，请在工作台核对完整结果。');
  }
  const index = await backend.read<{ items: { id: string; name: string }[] }>(`/api/index/objects?kind=study&q=${encodeURIComponent(study)}&limit=5`, signal);
  const studyName = index.items.find(item => item.id === study)?.name;
  const methods = await backend.read<{ method: { plugin_id: string; version: string }; name: string }[]>('/api/methods?view=summary', signal);
  const method = methods.find(item => item.method.plugin_id === IEC);
  if (!summary || !studyName || !method) return open();

  const text = engineeringText(summary.headline ?? '');
  const basis = /（([^）]+)）/.exec(text)?.[1] ?? '';
  const name = /受限于(.+)$/.exec(text)?.[1]?.trim() ?? '—';
  const medium = section.medium;
  const surface = medium?.surface_temperature ?? medium?.air_temperature ?? null;
  const celsius = conductor.display_value;
  const view: SavedRunView = {
    title: `${studyName} · 第 ${summary.sequence} 条记录`,
    // The platform's saved evidence has no engineering confidence classification. Geometry and today's installed method are not
    // evidence that this historic result is deliverable. Keep it explicitly reference-only until the saved contract supplies a tier.
    tier: 'reference', tier_note: '保存记录未声明工程可信分档，按参考结果展示；不据结构推定可交付。', method: `${method.name} ${String(data.method.version)}`,
    current: fixed(ampacity.display_value), basis, freshness: summary.freshness,
    limiting: {
      name, conductor: celsius, limit: Math.round((limit - KELVIN) * 10) / 10,
      ambient: finite(surface) ? Math.round((surface - KELVIN) * 10) / 10 : null,
      load: `${compact(load)} A`, margin: `${fixed(currentMargin)} A`,
    },
  };
  return {
    card: { kind: 'saved_run', href: href('study', study, { workspace, run }), view },
    notes: [text || `允许电流 ${view.current} A`, view.tier_note!, ...(summary.freshness === 'current' ? [] : ['这条记录已不是当前输入下的结果'])],
  };
}

/** The card, notes and target of one finished step. A failure to draw the card is not a failure of the step: the step still stands. */
export async function describeResult(backend: Backend, tool: string, args: Record<string, unknown>, result: ToolResult, workspace: string | undefined, signal?: AbortSignal): Promise<Shown> {
  const target = targetOf(tool, args, workspace);
  const shown: Shown = target ? { target } : {};
  const study = typeof args.study_id === 'string' ? args.study_id : undefined;
  try {
    const structure = structureImportCard(tool, args, result);
    if (structure) return { ...shown, card: structure };
    if (result.data.receipt?.kind === 'structure_preview' && result.data.receipt.preview_omitted === true)
      return { ...shown, notes: ['预览已保存，但完整字段尚未读取；请按保存记录的分页提示查看所需明细。当前结果卡不能据以核对全部规格。'] };
    if (tool === 'study_compare' && workspace) {
      const sources = result.data.comparison?.sources;
      const requested = args.run_ids;
      if (Array.isArray(sources) && sources.length === 2 && Array.isArray(requested) && requested.length === 2
        && sources.every((source: any, index: number) => typeof source.run_id === 'string' && source.run_id === requested[index]
          && source.snapshot?.workspace_id === workspace && typeof source.snapshot?.study_id === 'string')) {
        const first = sources[0];
        const title = first.snapshot.definition?.title;
        return { ...shown, card: { kind: 'open', label: '两次保存运行对比' + (typeof title === 'string' && title ? ` · ${title}` : ''),
          href: href('study_comparison', first.snapshot.study_id, { workspace, compare: sources.map((source: any) => source.run_id).join(',') }) },
          notes: ['完整输入、方法差异和量值均来自这两条保存运行；可在工作台逐项查看并下载追溯证据。'] };
      }
    }
    if (tool === 'resource_read' && result.data.resource?.kind === 'rating_table' && (args.offset === undefined || args.offset === 0)) {
      const table = await savedRatingTable(backend, result.data.resource, signal);
      if (table) return { ...shown, ...table };
    }
    if (tool === 'resource_read' && typeof result.data.resource?.id === 'string') {
      const resource = result.data.resource;
      const kind = resource.kind === 'asset' ? 'asset' : ['document', 'document_page', 'document_extraction'].includes(resource.kind) ? 'document' : undefined;
      if (kind) {
        const index = await backend.read<{ items: { id: string; name: string; subtype?: string }[] }>(
          `/api/index/objects?kind=${kind}&q=${encodeURIComponent(resource.id)}&limit=5`, signal);
        const item = index.items.find(item => item.id === resource.id);
        if (item) {
          const groups: Record<string, string> = { material: 'materials', component: 'materials', assembly: 'materials',
            installation: 'templates', study_template: 'templates', rule: 'standards' };
          return { ...shown, card: { kind: 'open', label: item.name,
            href: href(kind, item.id, kind === 'asset' ? { group: groups[item.subtype ?? ''] ?? 'materials' } : {}) } };
        }
      }
    }
    const receipt = result.data.receipt;
    if (receipt && ['delivery', 'specification'].includes(receipt.kind) && typeof receipt.download_url === 'string'
      && /^\/(?!\/)/.test(receipt.download_url) && typeof receipt.href === 'string' && /^\/(?!\/)/.test(receipt.href)) {
      const source = receipt.source;
      const openHref = receipt.kind === 'specification' ? href('type', receipt.workspace_id)
        : source?.study_id && source?.run_id ? href('study', source.study_id, { workspace: receipt.workspace_id, run: source.run_id })
        : href('delivery', receipt.delivery_id, { workspace });
      return { ...shown, card: { kind: 'saved_file', title: receipt.title ?? '已保存文件', document_kind: receipt.kind === 'delivery' ? '计算书' : '规格书',
        format: receipt.media_type === 'application/pdf' ? 'pdf' : 'html',
        href: openHref, download_url: receipt.download_url,
        ...(typeof receipt.preview_url === 'string' && /^\/(?!\/)/.test(receipt.preview_url) ? { preview_url: receipt.preview_url } : {}) },
        notes: ['文件来自平台保存的输入与证据；生成文件没有重算或发布型号。'] };
    }
    if (receipt?.kind === 'run' && workspace && receipt.result && receipt.status === 'succeeded') {
      const saved = await savedRun(backend, workspace, { ...result, data: receipt.result }, signal);
      if (saved) return { ...shown, ...saved };
    }
    if (receipt?.kind === 'study' && receipt.study_id) return { ...shown, card: { kind: 'open', label: receipt.title ?? '研究', href: href('study', receipt.study_id, { workspace }) } };
    if (receipt?.kind === 'type' && receipt.type_id) return { ...shown, card: { kind: 'open', label: receipt.title ?? '型号设计', href: href('type', receipt.type_id) } };
    if (tool === 'run_read' && workspace) {
      const saved = await savedRun(backend, workspace, result, signal);
      if (saved) return { ...shown, ...saved };
    }
    if ((tool === 'run_read' || tool === 'run_list' || tool === 'study_read') && workspace && study) {
      return { ...shown, card: { kind: 'open', label: nameOf(study) ?? '研究', href: href('study', study, { workspace,
        run: tool === 'run_read' && typeof args.run_id === 'string' ? args.run_id : undefined }) } };
    }
    if (tool === 'project_digest' && workspace) return { ...shown, card: { kind: 'open', label: nameOf(workspace) ?? '工程', href: href('project', workspace) } };
    if (tool === 'type_read' && typeof args.type_id === 'string') {
      const data = result.data;
      const fields = (data.items ?? []).filter((item: any) => item.section === 'structure' && (typeof item.value === 'number' || item.material?.name))
        .map((item: any) => {
          const resistance = typeof item.value === 'number' && ['ohm/m', 'Ω/m'].includes(item.unit)
            ? resultValue({ value: item.value, unit: item.unit }) : undefined;
          return { label: item.label, value: item.material?.name ?? resistance?.value ?? compact(item.value),
            unit: resistance?.unit ?? (item.unit && item.unit !== '1' ? item.unit : null),
            source: item.source?.provenance?.reviewed ? '来源已人工核对' : '保存的设计输入，来源待核对' };
        });
      if (fields.length) return { ...shown, card: { kind: 'saved_type', href: href('type', args.type_id), view: {
        title: data.object?.name ?? nameOf(args.type_id) ?? '型号设计', fields,
        checks: (data.items ?? []).filter((item: any) => item.section === 'checks' && typeof item.message === 'string').map((item: any) => item.message),
        complete: !data.next_page, source: '数值来自已保存的型号输入；结构核对、人工审核和发布分别记录。',
      } } };
      return { ...shown, card: { kind: 'open', label: nameOf(args.type_id) ?? '型号设计', href: href('type', args.type_id) } };
    }
    if (tool === 'cable_model_read' && typeof args.model_id === 'string') return { ...shown, card: { kind: 'open', label: nameOf(args.model_id) ?? '电缆型号版本', href: href('cable_version', args.model_id) } };
  } catch {
    // The page shows the step without the card; nothing is made up in its place.
  }
  return shown;
}
