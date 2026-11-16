// What a step leaves on the page besides its line: the card of what it read (a saved run as the rating card; anything else as a way to
// its object in the workbench), a few notes, and what it acted on in the engineer's words. A card carries no number the model wrote:
// a saved run's figures are the run record's, read from the platform here, and a run that cannot be read fully is not drawn as a card.
import type { CardRef } from '../shared/types.ts';
import type { SavedRunView } from '../shared/fusion-types.ts';
import { compact, fixed } from '../shared/format.ts';
import type { Backend, ToolResult } from './backend.ts';

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

interface Headline { key: string; condition?: string; entity?: string; display_value?: number; display_unit?: string }
interface Factor { key: string; entity?: string; value?: number }
interface RunSummary { id: string; sequence: number; freshness: SavedRunView['freshness']; headline: string | null }
interface Domain {
  cable_types?: { construction?: string; cores?: { layers?: { role?: string; form?: string }[] }[]; common_layers?: { role?: string; form?: string }[] }[];
  sections?: { backfill?: unknown; medium?: { surface_temperature?: number | null; air_temperature?: number | null } }[];
  circuits?: unknown[];
  load_cases?: { currents?: Record<string, number> }[];
}

const IEC = 'cablesim.iec60287';
const STEADY = 'steady-rating';
const KELVIN = 273.15;

/** The rule of Cable Studio's methods.py, from the saved input alone: the method is validated against public whole-chain examples for a
 *  single circuit of single-core cables with smooth metal sheaths, buried or in a duct; anything else has only hand and self-consistency
 *  checks. It says nothing about the quality of the cable data. */
export function tierOf(document: Domain, parameters: Record<string, unknown> | null | undefined): SavedRunView['tier'] {
  const cable = document.cable_types?.[0];
  const section = document.sections?.[0];
  if (!cable || !section) return 'reference';
  const layers = [...(cable.cores ?? []).flatMap(core => core.layers ?? []), ...(cable.common_layers ?? [])];
  const corrugated = layers.some(layer => layer.role === 'metallic_sheath' && layer.form === 'corrugated');
  const weak = cable.construction !== 'single_core' || (document.circuits?.length ?? 0) > 1 || Boolean(section.backfill) || corrugated
    || Boolean(parameters && 'per_cable_losses' in parameters);
  return weak ? 'reference' : 'deliverable';
}

async function savedRun(backend: Backend, workspace: string, result: ToolResult, signal?: AbortSignal): Promise<{ card: CardRef; notes: string[] } | undefined> {
  const data = result.data;
  if (data.method?.plugin_id !== IEC || data.method?.capability !== STEADY || data.status !== 'succeeded' || !data.study_id || !data.run_id) return undefined;
  const study = String(data.study_id);
  const run = String(data.run_id);
  const headlines: Headline[] = data.headlines ?? [];
  const ampacity = headlines.find(item => item.key === 'ampacity' && typeof item.display_value === 'number');
  const kase = (data.cases ?? [])[0];
  if (!ampacity || !kase?.case_id) return undefined;
  const factors: Factor[] = (data.cases ?? []).flatMap((item: { factors?: Factor[] }) => item.factors ?? []);
  const limitingCable = factors.find(item => item.key === 'limiting_cable')?.entity;
  const conductor = headlines.find(item => item.key === 'conductor_temperature' && item.condition === 'operating' && (!limitingCable || item.entity === limitingCable));
  const temperatureMargin = factors.find(item => item.key === 'temperature_margin' && item.entity === limitingCable)?.value;
  const currentMargin = factors.find(item => item.key === 'current_margin')?.value;

  // The producer's own sentence for the record (the conclusion, what it means, which cable limits), the record's number, the saved input.
  let summary: RunSummary | undefined;
  for (let after = 0, pages = 0; summary === undefined && pages < 10; pages += 1) {
    const page = await backend.read<{ items: RunSummary[]; next_cursor: number | null }>(`/api/workspaces/${workspace}/studies/${study}/runs?view=summary&limit=100&after=${after}`, signal);
    summary = page.items.find(item => item.id === run);
    if (page.next_cursor === null || page.next_cursor === undefined) break;
    after = page.next_cursor;
  }
  const input = await backend.read<{ input: Domain; parameters?: Record<string, unknown> | null }>(`/api/workspaces/${workspace}/studies/${study}/runs/${run}/cases/${kase.case_id}/input`, signal);
  const index = await backend.read<{ items: { id: string; name: string }[] }>(`/api/index/objects?kind=study&q=${encodeURIComponent(study)}&limit=5`, signal);
  const studyName = index.items.find(item => item.id === study)?.name;
  const methods = await backend.read<{ method: { plugin_id: string; version: string }; name: string }[]>('/api/methods?view=summary', signal);
  const method = methods.find(item => item.method.plugin_id === IEC);
  if (!summary || !studyName || !method) return undefined;

  const text = summary.headline ?? '';
  const basis = /（([^）]+)）/.exec(text)?.[1] ?? '';
  const name = /受限于(.+)$/.exec(text)?.[1]?.trim() ?? '—';
  const document = input.input;
  const medium = document.sections?.[0]?.medium;
  const surface = medium?.surface_temperature ?? medium?.air_temperature ?? null;
  const circuit = headlines.find(item => item.key === 'ampacity')?.entity;
  const load = circuit ? document.load_cases?.[0]?.currents?.[circuit] : undefined;
  const celsius = conductor?.display_unit === '°C' && typeof conductor.display_value === 'number' ? conductor.display_value : null;
  const view: SavedRunView = {
    title: `${studyName} · 第 ${summary.sequence} 条记录`,
    tier: tierOf(document, input.parameters), method: `${method.name} ${method.method.version}`,
    current: fixed(ampacity.display_value), basis, freshness: summary.freshness,
    limiting: {
      name, conductor: celsius, limit: celsius !== null && typeof temperatureMargin === 'number' ? Math.round((celsius + temperatureMargin) * 10) / 10 : null,
      ambient: typeof surface === 'number' ? Math.round((surface - KELVIN) * 10) / 10 : null,
      load: typeof load === 'number' ? `${compact(load)} A` : null, margin: typeof currentMargin === 'number' ? `${fixed(currentMargin)} A` : null,
    },
  };
  return {
    card: { kind: 'saved_run', href: href('study', study, { workspace, run }), view },
    notes: [text || `允许电流 ${view.current} A`, ...(summary.freshness === 'current' ? [] : ['这条记录已不是当前输入下的结果'])],
  };
}

/** The card, notes and target of one finished step. A failure to draw the card is not a failure of the step: the step still stands. */
export async function describeResult(backend: Backend, tool: string, args: Record<string, unknown>, result: ToolResult, workspace: string | undefined, signal?: AbortSignal): Promise<Shown> {
  const target = targetOf(tool, args, workspace);
  const shown: Shown = target ? { target } : {};
  const study = typeof args.study_id === 'string' ? args.study_id : undefined;
  try {
    if (tool === 'run_read' && workspace) {
      const saved = await savedRun(backend, workspace, result, signal);
      if (saved) return { ...shown, ...saved };
    }
    if ((tool === 'run_read' || tool === 'run_list' || tool === 'study_read') && workspace && study) {
      return { ...shown, card: { kind: 'open', label: nameOf(study) ?? '研究', href: href('study', study, { workspace }) } };
    }
    if (tool === 'project_digest' && workspace) return { ...shown, card: { kind: 'open', label: nameOf(workspace) ?? '工程', href: href('project', workspace) } };
    if (tool === 'type_read' && typeof args.type_id === 'string') return { ...shown, card: { kind: 'open', label: nameOf(args.type_id) ?? '型号设计', href: href('type', args.type_id) } };
    if (tool === 'cable_model_read' && typeof args.model_id === 'string') return { ...shown, card: { kind: 'open', label: nameOf(args.model_id) ?? '电缆型号版本', href: href('cable_version', args.model_id) } };
  } catch {
    // The page shows the step without the card; nothing is made up in its place.
  }
  return shown;
}
