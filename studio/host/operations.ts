// The operation layer: every action of the workbench exists once here. A button calls an
// operation over HTTP; the agent calls the same operation as a tool.
import { EventEmitter } from 'node:events';
import { arr, bool, compile, int, nullable, num, obj, oneOf, opt, str, type Schema } from '@earendil-works/pi-schema';
import { compact, describeChanges, describeStart, fixed, KIND_NAMES, PHASE_NAMES } from '../shared/format.ts';
import type {
  CardRef, Change, Conditions, Installation, Issue, LayoutOption, LibraryEntry, MethodChoice, PartName, Parts, Preview, ProjectMeta,
  ProjectView, RunRecord, StudioEvent,
} from '../shared/types.ts';
import { userInfo } from 'node:os';
import { type Core, StudioError } from './core.ts';
import type { Library } from './library.ts';
import { productOperations } from './products.ts';
import { renderReport } from './report.ts';
import { inputsDigest, type Store } from './store.ts';
import { attachTypeCards } from './type-cards.ts';
import { typeOperations } from './type-operations.ts';
import { ratingOperations } from './rating-operations.ts';

/** Who runs an operation. For the agent, task_id is the conversation and signal ends a long wait when the person stops it. */
export interface Context { by: 'human' | 'agent'; task_id?: string; signal?: AbortSignal }
export interface Plan { changes: Change[]; parts: Partial<Parts> }
/** What a person is shown before accepting an agent's write: the changes with their old and new values, and where they lead. */
export interface Review {
  title: string; project?: string; changes: Change[]; preview?: Preview | null; issue?: Issue | null;
  /** The specification version the person looked at; the change is made on that version. */
  version?: number;
  /** Asked once more when the person has accepted: what the card showed may have gone out of date while it waited. Gives the reason when it has. */
  stale?: () => string | null;
}

const PROJECT_MOVED = '审阅期间这个工程被改动过，已经接受的改动没有执行。请按现在的状态重新提出。';
const MODEL_MOVED = '型号在审阅期间有了新版本，已经接受的改动没有执行。请按现在的状态重新提出。';

export interface Operation {
  id: string;
  /** Tool name the agent sees. Operations without one are not offered to the agent. */
  tool?: string;
  title: string;
  description: string;
  kind: 'read' | 'write' | 'run';
  parameters: Schema;
  execute(params: any, context: Context): Promise<unknown>;
  /** Write operations on a project: what would change, without saving anything. */
  plan?(params: any): Promise<Plan>;
  /** Write operations in general: what the person is asked to accept. Without a plan or a review the agent cannot run a write. */
  review?(params: any): Promise<Review>;
  /** What the agent is told about the result; the full result stays in the workbench. */
  brief?(result: any): unknown;
  /** The object the agent's result card shows: references only, so every number on a card comes from the host. */
  card?(params: any, result: any): CardRef | undefined;
  /** Facts for the step row, written from the real result. */
  notes?(params: any, result: any): string[];
  /** Only a person may run it. The agent is refused before anything else is looked at, and is never offered the tool. */
  human_only?: true;
  /** Takes out of the agent's arguments what only a person may decide, before the change is shown for review, so review and run see the same arguments. */
  agentParams?(params: any): void;
}

const project = str({ description: '工程标识，例如 p-1a2b3c4d' });
const DEFAULT_MODEL = 'system.yjq02-110kv-800';
const KIND_OPEN: Record<string, string> = { library: '型号库', import: '导入页', series: '系列', spec: '规格', project: '工程', run: '运行记录' };
const SWEEP_VARIABLES = ['soil_thermal_resistivity', 'ambient_temperature_c', 'depth_m', 'spacing_m', 'current_a'] as const;

function runTitle(record: { kind: string; summary?: RunRecord['summary']; sweep?: RunRecord['sweep']; selection?: RunRecord['selection'] }): string {
  const kind = KIND_NAMES[record.kind];
  if (record.kind === 'rating') {
    return record.summary?.ampacity ? `${kind} · ${fixed(record.summary.ampacity.value_a)} A` : `${kind} · 未算出`;
  }
  if (record.sweep) {
    const values = record.sweep.points.map(point => point.value);
    return `${kind} · ${record.sweep.label} ${compact(Math.min(...values))}–${compact(Math.max(...values))} ${record.sweep.unit}`;
  }
  const selection = record.selection!;
  const chosen = selection.candidates.find(row => row.model_id === selection.chosen);
  return `${kind} · ${compact(selection.target_current_a)} A → ${chosen ? chosen.name : '无满足型号'}`;
}

export class Studio {
  core: Core;
  store: Store;
  library: Library;
  /** Where projects, the product library and uploaded files live. */
  home: string;
  /** The person at this machine; every change to the product library is recorded under this name. */
  user: string;
  events = new EventEmitter();
  operations = new Map<string, Operation>();
  #layouts = new Map<string, string>();
  #options = new Map<string, LayoutOption[]>();
  /** Draft results by project and inputs digest: computed, not written to disk. The few latest are kept, so undo finds its draft again. */
  #drafts = new Map<string, Map<string, { parts: Parts; record: any; shown: RunRecord }>>();
  #seeding?: Promise<void>;

  constructor(core: Core, store: Store, library: Library, user = process.env.CABLE_STUDIO_USER || userInfo().username) {
    this.core = core;
    this.store = store;
    this.library = library;
    this.home = store.home;
    this.user = user;
    this.events.setMaxListeners(100);
    for (const operation of [...this.#define(), ...productOperations(this), ...typeOperations(this)]) this.operations.set(operation.id, operation);
    attachTypeCards(this);
    // The agent's writes wait for a person; one that cannot be described must never reach it.
    for (const operation of this.agentOperations()) {
      if (operation.kind === 'write' && !operation.review && !operation.plan) throw new Error(`操作 ${operation.id} 是写操作，但没有审阅说明。`);
    }
    for (const operation of ratingOperations(this)) this.operations.set(operation.id, operation);
  }

  /** An empty product library starts with the structures that come with the software. */
  ready(): Promise<void> {
    this.#seeding ??= (async () => {
      if (!this.library.setting('seeded')) this.library.seed(await this.core.call<LibraryEntry[]>('library.bundled'), '系统');
    })();
    return this.#seeding;
  }

  emit(event: StudioEvent): void {
    this.events.emit('event', event);
  }

  scene(name: string, parts: Parts): Record<string, unknown> {
    return { name, cable: parts.cable, installation: parts.installation, conditions: parts.conditions, parameters: parts.method.parameters };
  }

  async preview(name: string, parts: Parts): Promise<{ preview: Preview | null; issue: Issue | null }> {
    try {
      const preview = await this.core.call<Preview>('scene.preview', { scene: this.scene(name, parts) });
      for (const layout of preview.layouts) this.#layouts.set(layout.kind, layout.label);
      return { preview, issue: null };
    } catch (error) {
      if (error instanceof StudioError && error.status === 422) return { preview: null, issue: error.issue() };
      throw error;
    }
  }

  async layouts(construction: string): Promise<LayoutOption[]> {
    const cached = this.#options.get(construction);
    if (cached) return cached;
    const options = await this.core.call<LayoutOption[]>('layouts.list', { construction });
    for (const layout of options) this.#layouts.set(layout.kind, layout.label);
    this.#options.set(construction, options);
    return options;
  }

  async view(id: string): Promise<ProjectView> {
    const meta = this.store.meta(id);
    const parts = this.store.parts(id);
    return { meta, parts, inputs_sha256: inputsDigest(parts), ...(await this.preview(meta.name, parts)),
             layouts: await this.layouts(parts.cable.summary.construction), runs: this.store.runs(id) };
  }

  /** Validate against the operation's schema, then run it. */
  async invoke(id: string, params: unknown, context: Context): Promise<unknown> {
    const operation = this.operations.get(id);
    if (!operation) throw new StudioError({ code: 'OPERATION_UNKNOWN', message: `没有操作 ${id}。` }, 404);
    if (context.by === 'agent' && operation.human_only) {
      throw new StudioError({ code: 'REVIEW_FORBIDDEN', message: `${operation.title}只能由人来做。` }, 403);
    }
    const errors = compile(operation.parameters).errors(params);
    if (errors.length) {
      const first = errors[0] as { path?: string; instancePath?: string; message?: string };
      const path = first.path ?? first.instancePath ?? '';
      throw new StudioError({ code: 'INPUT_INVALID', message: `参数不符合要求：${path} ${first.message ?? ''}`.trim(), path: path || undefined });
    }
    await this.ready();
    return operation.execute(params, context);
  }

  layoutLabel = (kind: string): string => this.#layouts.get(kind) ?? kind;

  /** The operations the agent is offered as tools: all of them but those only a person may run, and the workbench's own scratch layer. */
  agentOperations(): Operation[] {
    return [...this.operations.values()].filter(operation => operation.tool && !operation.human_only);
  }

  /** What a person is asked to accept for an agent's write. A write nobody can describe is not run. */
  async reviewFor(operation: Operation, params: any): Promise<Review> {
    // What the change is made on is noted before the review is worked out: a change made while it is being worked out counts as made after.
    const project: string | undefined = typeof params?.project === 'string' ? params.project : undefined;
    const before = project === undefined ? undefined : this.#projectState(project);
    const review = await this.#review(operation, params);
    if (project !== undefined && before !== undefined && review.project === project) {
      const own = review.stale;
      review.stale = () => own?.() ?? (this.#projectState(project) === before ? null : PROJECT_MOVED);
    }
    return review;
  }

  /** What a change to a project is made on: its name and its inputs. A run saved in the meantime does not count, an edit does. */
  #projectState(id: string): string {
    return `${this.store.meta(id).name}\n${inputsDigest(this.store.parts(id))}`;
  }

  async #review(operation: Operation, params: any): Promise<Review> {
    if (operation.review) return operation.review(params);
    if (operation.plan) {
      const plan = await operation.plan(params);
      const parts = { ...this.store.parts(params.project), ...plan.parts };
      const { preview, issue } = await this.preview(this.store.meta(params.project).name, parts);
      // A cable is taken from the library as it is when the card is made; a newer version of it is not what was shown.
      const cable = plan.parts.cable;
      return { title: operation.title, project: params.project, changes: plan.changes, preview, issue,
        ...(cable ? { stale: () => (this.library.entry(cable.id).version === cable.version ? null : MODEL_MOVED) } : {}) };
    }
    throw new StudioError({ code: 'REVIEW_UNAVAILABLE', message: `${operation.title}没有可供审阅的改动说明，Agent 不能执行。` }, 409);
  }

  async #changes(before: Parts, after: Partial<Parts>): Promise<Change[]> {
    for (const construction of ['single_core', 'three_core']) await this.layouts(construction);
    return (Object.keys(after) as PartName[]).flatMap(part => describeChanges(part, before[part], after[part]!, this.layoutLabel));
  }

  async #apply(id: string, plan: Plan): Promise<{ changes: Change[]; view: ProjectView }> {
    for (const part of Object.keys(plan.parts) as PartName[]) {
      if (plan.changes.some(change => change.part === part)) this.store.writePart(id, part, plan.parts[part] as never);
    }
    if (plan.changes.length) this.emit({ type: 'project', project_id: id });
    return { changes: plan.changes, view: await this.view(id) };
  }

  /** A computed result with the inputs it belongs to: what a run record holds besides its number and time. */
  #entry(id: string, parts: Parts, record: any, context: Context) {
    const cases: { status: string }[] = record.result.cases;
    const status = record.kind === 'rating' ? cases[0].status : cases.some(item => item.status === 'succeeded') ? 'succeeded' : 'failed';
    return {
      schema: 'cablesim.studio.run/1' as const, project: { id, name: this.store.meta(id).name }, by: context.by, task_id: context.task_id,
      inputs: parts, inputs_sha256: inputsDigest(parts), title: runTitle(record),
      status: status === 'succeeded' ? 'succeeded' as const : 'failed' as const, tier: record.method_card?.tier?.tier,
      headline: record.summary?.headline_text, ...record,
    };
  }

  async #saveRun(id: string, parts: Parts, record: any, context: Context): Promise<RunRecord> {
    const saved = this.store.saveRun(id, this.#entry(id, parts, record, context));
    this.emit({ type: 'project', project_id: id });
    return saved;
  }

  #define(): Operation[] {
    const { core, store, library } = this;
    // A cable taken from the product library, with the laying and conditions a new project starts from.
    const starting = async (model: string): Promise<Pick<Parts, 'cable' | 'installation' | 'conditions'>> => {
      const cable = library.entry(model);
      return { cable, ...(await core.call<Pick<Parts, 'installation' | 'conditions'>>('cable.defaults', { cable })) };
    };
    const header = (record: RunRecord) => ({ run: record.id, sequence: record.sequence, title: record.title, status: record.status, tier: record.tier });
    // Words from the calculation, told to the model without the calculation's own identifiers (cable/c1-a, circuit/c2): a name where one is known, else a plain word.
    const plain = (text: string | undefined, names?: Map<string, string>): string | undefined =>
      text?.replace(/\b(cable|circuit)\/[\w-]+/g, id => names?.get(id) ?? (id.startsWith('cable') ? '某根电缆' : '某回路'));
    const issueOf = (issue: Issue | undefined, names?: Map<string, string>) => (issue ? { ...issue, message: plain(issue.message, names) } : undefined);
    const briefRun = (record: RunRecord): unknown => {
      const base = { ...header(record), kind: record.kind, method: record.method_card?.method ? `${record.method_card.method} ${record.method_card.method_version}` : undefined, tier_basis: record.method_card?.tier.basis };
      if (record.kind === 'sweep') {
        return { ...base, variable: record.sweep!.label, unit: record.sweep!.unit,
                 points: record.sweep!.points.map(point => ({ value: point.value, ampacity_a: point.ampacity_a, hottest_conductor_c: point.hottest_conductor_c, error: plain(point.error?.message) })) };
      }
      if (record.kind === 'selection') {
        return { ...base, target_current_a: record.selection!.target_current_a, chosen: record.selection!.chosen, rule: record.selection!.rule,
                 reason: record.selection!.reason,
                 candidates: record.selection!.candidates.map(row => ({ model_id: row.model_id, name: row.name, area_mm2: row.area_mm2,
                   ampacity_a: row.ampacity_a, meets_target: row.meets_target, conductor_at_target_c: row.conductor_at_target_c,
                   error: plain((row.error ?? row.at_target_error)?.message) })) };
      }
      const summary = record.summary!;
      if (summary.status !== 'succeeded') return { ...base, error: issueOf(summary.error) };
      // A cable is told to the model by a name it can say to an engineer, never by the calculation's own identifier: a model copies what it reads.
      // The names come from the cables at the saved load or, when the load could not be held, from the cables at the rated current.
      const operating = summary.operating?.cables ?? [];
      const listed = operating.length ? operating : summary.rated?.cables ?? [];
      const names = new Map<string, string>(summary.circuits?.map(circuit => [circuit.id, circuit.label]) ?? []);
      listed.forEach((cable, index) => {
        const phase = PHASE_NAMES[cable.phase] ?? cable.phase;
        const circuit = summary.circuits?.find(item => item.id === cable.circuit)?.label;
        names.set(cable.id, listed.length === 1 ? phase : circuit ? `${circuit} · ${phase}` : `第 ${index + 1} 根 · ${phase}`);
      });
      const unlisted = new Map<string, string>();
      // A cable the result does not list still gets a name of its own, so two of them are never taken for one.
      const named = (id: string | undefined): string | undefined => (id === undefined ? undefined
        : names.get(id) ?? unlisted.get(id) ?? unlisted.set(id, `未列出的电缆 ${unlisted.size + 1}`).get(id));
      return { ...base, ampacity_a: summary.ampacity?.value_a, basis: summary.ampacity?.basis_name, limiting_cable: named(summary.ampacity?.limiting_cable),
               circuits: summary.circuits?.map(circuit => ({ label: circuit.label, ampacity_a: circuit.ampacity_a, limiting_cable: named(circuit.limiting_cable),
                 load_a: circuit.load_a, margin_a: circuit.margin_a, error: issueOf(circuit.error, names),
                 held_currents_a: Object.fromEntries(Object.entries((circuit as { held_currents_a?: Record<string, number> }).held_currents_a ?? {}).map(([id, amps]) => [named(id), amps])) })),
               ambient_c: summary.ambient_c, verification_passed: summary.verification?.passed,
               operating: operating.map(cable => ({ cable: named(cable.id), current_a: cable.current_a,
                 conductor_c: cable.conductor_c, limit_c: cable.limit_c, sheath_c: cable.sheath_c, surface_c: cable.surface_c,
                 losses_w_m: cable.losses_w_m, thermal_k_m_w: cable.thermal_k_m_w, lambda1: cable.lambda1 })),
               operating_error: plain(summary.operating?.error?.message, names),
               warnings: summary.warnings?.map(warning => plain(warning.message, names)) };
    };
    const briefView = (view: ProjectView) => ({
      project: view.meta.id, name: view.meta.name,
      cable: { model_id: view.parts.cable.id, name: view.parts.cable.name, family: view.parts.cable.family, state: view.parts.cable.state, ...view.parts.cable.summary },
      installation: { ...view.parts.installation, layout_label: this.layoutLabel(view.parts.installation.layout),
                      resolved_spacing_m: view.preview?.layout.spacing, circuits: view.preview?.circuit_count },
      conditions: view.parts.conditions, method: view.parts.method,
      tier: view.preview?.tier.label, tier_basis: view.preview?.tier.basis, input_issue: view.issue,
      available_layouts: view.preview?.layouts.map(layout => ({ kind: layout.kind, label: layout.label })),
      runs: view.runs.slice(0, 12).map(run => ({ run: run.id, sequence: run.sequence, title: run.title, status: run.status,
        current: run.inputs_sha256 === view.inputs_sha256 })),
    });
    const briefWrite = (result: { changes: Change[]; view: ProjectView }) => ({
      applied: result.changes.map(change => `${change.label}：${change.before} → ${change.after}`),
      input_issue: result.view.issue, tier: result.view.preview?.tier.label,
    });
    const planned = (id: string, parts: Partial<Parts>) => async (): Promise<Plan> => ({ parts, changes: await this.#changes(store.parts(id), parts) });
    const runCard = (params: { project: string }, record: RunRecord): CardRef => ({ kind: 'run', project: params.project, run: record.id, href: `/p/${params.project}?run=${record.id}` });
    const runNotes = (_params: unknown, record: RunRecord): string[] => {
      if (record.kind !== 'rating') return [record.title];
      const summary = record.summary;
      if (!summary || summary.status !== 'succeeded') return [`未算出：${summary?.error?.message ?? '方法拒绝了这组输入'}`];
      const limiting = summary.operating?.cables.find(cable => cable.id === summary.ampacity?.limiting_cable);
      return [`允许电流 ${fixed(summary.ampacity?.value_a)} A`,
        `先到温限：${limiting ? PHASE_NAMES[limiting.phase] ?? limiting.phase : summary.ampacity?.limiting_cable}`, `可信分档：${record.method_card?.tier.label ?? '—'}`];
    };

    const planCable = async (params: { project: string; model_id: string }): Promise<Plan> => {
      const before = store.parts(params.project);
      const defaults = await starting(params.model_id);
      const parts: Partial<Parts> = { cable: defaults.cable };
      // A different core count needs a template of its own kind; the engineer's depth is kept.
      if (defaults.cable.summary.construction !== before.cable.summary.construction) {
        parts.installation = { ...defaults.installation, depth_m: before.installation.depth_m, bonding: before.installation.bonding };
      }
      // The system voltage follows the cable only while it was following the previous cable.
      if (before.conditions.system_voltage_v === (before.cable.summary.u_v ?? null)) {
        parts.conditions = { ...before.conditions, system_voltage_v: defaults.cable.summary.u_v ?? null };
      }
      return planned(params.project, parts)();
    };
    const planInstallation = async (params: { project: string } & Partial<Installation>): Promise<Plan> => {
      const { project: id, ...patch } = params;
      const before = store.parts(id);
      const next: Installation = { ...before.installation, ...patch };
      if (patch.layout && patch.layout !== before.installation.layout) {
        const layouts = await this.layouts(before.cable.summary.construction);
        const layout = layouts.find(item => item.kind === patch.layout);
        if (!layout) {
          throw new StudioError({ code: 'LAYOUT_INVALID', path: '/installation/layout',
            message: `当前电缆可用的敷设方式：${layouts.map(item => `${item.kind}（${item.label}）`).join('、')}。` });
        }
        // A new template starts from its own spacing and duct unless this call sets them.
        if (!('spacing_m' in patch)) next.spacing_m = null;
        if (!('duct' in patch)) next.duct = layout.default_duct ?? null;
        if (!('backfill' in patch)) next.backfill = null;
      }
      if (patch.duct && before.installation.duct) next.duct = { ...before.installation.duct, ...patch.duct };
      return planned(id, { installation: next })();
    };
    const planConditions = async (params: { project: string; current_a?: number } & Partial<Conditions>): Promise<Plan> => {
      const { project: id, current_a, ...patch } = params;
      const before = store.parts(id);
      const next: Conditions = { ...before.conditions, ...patch };
      if (current_a !== undefined) next.currents_a = [current_a];
      return planned(id, { conditions: next })();
    };
    const planMethod = async (params: { project: string; ks?: number; kp?: number; eddy?: string }): Promise<Plan> => {
      const { project: id, ...patch } = params;
      const before = store.parts(id);
      const next: MethodChoice = { ...before.method, parameters: { ...before.method.parameters, ...patch } };
      return planned(id, { method: next })();
    };
    const write = (plan: (params: any) => Promise<Plan>) => async (params: any) => this.#apply(params.project, await plan(params));

    const duct = obj({
      inner_diameter_m: num({ exclusiveMinimum: 0, description: '管内径，m' }),
      outer_diameter_m: num({ exclusiveMinimum: 0, description: '管外径，m' }),
      thermal_resistivity: opt(num({ exclusiveMinimum: 0, description: '管材热阻率，K·m/W；缺省 6.0（PVC，IEC 60287-2-1 表 1）' })),
    });

    return [
      { id: 'project.list', tool: 'list_projects', title: '工程列表', kind: 'read', parameters: obj({}),
        description: '列出全部载流量计算工程：标识、名称、最近修改时间。',
        execute: async () => store.list(),
        brief: (list: ProjectMeta[]) => list.map(item => ({ project: item.id, name: item.name, updated: item.updated })) },
      { id: 'project.create', tool: 'create_project', title: '新建工程', kind: 'write',
        description: '新建一个载流量计算工程并选定型号。敷设、土壤、环境温度、负荷从该型号的默认模板起步，工程师审阅时会看到这些起始值；之后用 set_installation、set_conditions 修改。必须指定型号（从 list_library 取标识）。这是改动，先交给工程师审阅。',
        parameters: obj({ name: str({ minLength: 1, maxLength: 80, description: '工程名称' }), model_id: opt(str({ description: '型号库标识；Agent 调用时必须给出' })) }),
        review: async (params: { name: string; model_id?: string }): Promise<Review> => {
          const defaults = await starting(params.model_id ?? DEFAULT_MODEL);
          await this.layouts(defaults.cable.summary.construction);
          const name = params.name.trim();
          const changes: Change[] = [
            { part: 'project', field: 'name', label: '工程名称', before: '—', after: name },
            ...describeStart('cable', defaults.cable, this.layoutLabel),
            ...describeStart('installation', defaults.installation, this.layoutLabel),
            ...describeStart('conditions', defaults.conditions, this.layoutLabel),
          ];
          const { preview, issue } = await this.preview(name, { ...defaults, method: { method: 'iec60287.steady', parameters: {} } });
          const cable = defaults.cable;
          return { title: '新建工程', changes, preview, issue, stale: () => (this.library.entry(cable.id).version === cable.version ? null : MODEL_MOVED) };
        },
        execute: async (params: { name: string; model_id?: string }) => {
          const defaults = await starting(params.model_id ?? DEFAULT_MODEL);
          const meta = store.create(params.name.trim(), { ...defaults, method: { method: 'iec60287.steady', parameters: {} } });
          this.emit({ type: 'project', project_id: meta.id });
          return this.view(meta.id);
        }, brief: briefView },
      { id: 'project.rename', tool: 'rename_project', title: '重命名工程', kind: 'write', description: '修改工程名称。这是改动，先交给工程师审阅。',
        parameters: obj({ project, name: str({ minLength: 1, maxLength: 80 }) }),
        review: async (params: { project: string; name: string }): Promise<Review> => ({ title: '重命名工程', project: params.project,
          changes: [{ part: 'project', field: 'name', label: '工程名称', before: store.meta(params.project).name, after: params.name.trim() }] }),
        execute: async (params: { project: string; name: string }) => {
          store.rename(params.project, params.name.trim());
          this.emit({ type: 'project', project_id: params.project });
          return this.view(params.project);
        }, brief: briefView },
      { id: 'project.get', tool: 'get_project', title: '读取工程', kind: 'read', parameters: obj({ project }),
        description: '读取当前工程的型号、敷设、工况、方法参数、输入是否有问题、可信分档和运行记录列表。动手之前先调用它。',
        execute: async (params: { project: string }) => this.view(params.project), brief: briefView },
      { id: 'library.list', tool: 'list_library', title: '型号库', kind: 'read', parameters: obj({}),
        description: '列出产品库里每个规格的最新版本：标识、名称、系列、数据来源、审核状态、芯数、截面、电压和外径。选型的候选从这里取。',
        execute: async () => library.entries(),
        brief: (entries: LibraryEntry[]) => entries.map(entry => ({ model_id: entry.id, name: entry.name, family: entry.family, state: entry.state, ...entry.summary })) },
      { id: 'methods.list', tool: 'list_methods', title: '方法库', kind: 'read', parameters: obj({}),
        description: '列出可用的计算方法及其方法卡：能回答什么、需要什么输入、适用范围、验证依据、可信分档的含义。',
        execute: async () => core.call('methods.list') },
      { id: 'cable.set', tool: 'set_cable', title: '更换型号', kind: 'write',
        description: '把工程的电缆换成型号库里的另一个型号。这是对输入的改动，会先交给工程师审阅，可能被拒绝。',
        parameters: obj({ project, model_id: str({ description: '型号库标识' }) }),
        plan: planCable, execute: write(planCable), brief: briefWrite },
      { id: 'installation.set', tool: 'set_installation', title: '修改敷设', kind: 'write',
        description: '修改敷设：敷设方式、中心埋深、中心距、护套接地方式、管道尺寸、回填尺寸。只传要改的字段。这是对输入的改动，会先交给工程师审阅。',
        parameters: obj({
          project,
          layout: opt(str({ description: '敷设方式标识，取值见 get_project 返回的 available_layouts' })),
          depth_m: opt(num({ exclusiveMinimum: 0, description: '电缆组中心埋深，m' })),
          spacing_m: opt(nullable(num({ exclusiveMinimum: 0 }), { description: '相邻电缆中心距，m；null 表示用模板的默认间距' })),
          bonding: opt(oneOf(['both_ends', 'single_point'], { description: '护套接地：both_ends 两端接地，single_point 单点接地' })),
          duct: opt(nullable(duct)),
          backfill: opt(nullable(obj({ width: opt(num({ exclusiveMinimum: 0 })), height: opt(num({ exclusiveMinimum: 0 })),
            thermal_resistivity: opt(num({ exclusiveMinimum: 0 })) }))),
        }),
        plan: planInstallation, execute: write(planInstallation), brief: briefWrite },
      { id: 'conditions.set', tool: 'set_conditions', title: '修改工况', kind: 'write',
        description: '修改工况：土壤热阻率、环境温度、负荷电流、系统电压、频率。只传要改的字段。这是对输入的改动，会先交给工程师审阅。',
        parameters: obj({
          project,
          soil_thermal_resistivity: opt(num({ exclusiveMinimum: 0, description: '土壤热阻率，K·m/W' })),
          ambient_temperature_c: opt(num({ minimum: -50, maximum: 80, description: '环境（地表）温度，°C' })),
          current_a: opt(num({ minimum: 0, description: '各回路相同的负荷电流，A' })),
          currents_a: opt(arr(num({ minimum: 0 }), { minItems: 1, maxItems: 9, description: '逐回路负荷电流，A' })),
          system_voltage_v: opt(nullable(num({ exclusiveMinimum: 0 }), { description: '系统线电压，V' })),
          frequency_hz: opt(num({ exclusiveMinimum: 0, description: '频率，Hz' })),
        }),
        plan: planConditions, execute: write(planConditions), brief: briefWrite },
      { id: 'method.set', tool: 'set_method', title: '修改方法参数', kind: 'write',
        description: '修改 IEC 60287 的方法参数：集肤效应系数 ks、邻近效应系数 kp、是否计入护套涡流损耗。会先交给工程师审阅。',
        parameters: obj({ project, ks: opt(num({ exclusiveMinimum: 0, maximum: 1 })), kp: opt(num({ exclusiveMinimum: 0, maximum: 1 })),
          eddy: opt(oneOf(['ignored', 'trefoil'], { description: 'ignored 不计，trefoil 计入' })) }),
        plan: planMethod, execute: write(planMethod), brief: briefWrite },
      { id: 'run.rate', tool: 'run_rating', title: '运行校核', kind: 'run', parameters: obj({ project }),
        description: '按当前型号、敷设、工况运行 IEC 60287 稳态载流量，生成一条不可改的运行记录。返回允许电流、限制电缆、保存负荷下的温度、损耗、热阻和可信分档。',
        execute: async (params: { project: string }, context) => {
          const parts = store.parts(params.project);
          const record = await core.call('study.rate', { scene: this.scene(store.meta(params.project).name, parts) });
          return this.#saveRun(params.project, parts, record, context);
        }, brief: briefRun, card: runCard, notes: runNotes },
      // Drafts are for the workbench: a result for the present inputs right after a change, without filling the
      // project with records. A draft is a real result of the method; keeping it writes that same result as a record.
      { id: 'draft.rate', title: '草算', kind: 'run', parameters: obj({ project }),
        description: '按当前输入运行一次校核，结果不写运行记录，留待“存为记录”。输入没有变时返回上一次的草算。',
        execute: async (params: { project: string }, context) => {
          const parts = store.parts(params.project);
          const digest = inputsDigest(parts);
          const drafts = this.#drafts.get(params.project) ?? new Map();
          this.#drafts.set(params.project, drafts);
          const held = drafts.get(digest);
          if (held) return held.shown;
          const record = await core.call('study.rate', { scene: this.scene(store.meta(params.project).name, parts) });
          const shown: RunRecord = { ...this.#entry(params.project, parts, record, context), id: 'draft', sequence: 0, created: new Date().toISOString() };
          drafts.set(digest, { parts, record, shown });
          if (drafts.size > 8) drafts.delete(drafts.keys().next().value as string);
          return shown;
        } },
      { id: 'draft.keep', title: '存为记录', kind: 'run', parameters: obj({ project }),
        description: '把当前输入的草算结果写成一条不可改的运行记录。',
        execute: async (params: { project: string }, context) => {
          const digest = inputsDigest(store.parts(params.project));
          const held = this.#drafts.get(params.project)?.get(digest);
          if (!held) throw new StudioError({ code: 'DRAFT_MISSING', message: '没有当前输入的草算结果，请先计算。' }, 409);
          this.#drafts.get(params.project)?.delete(digest);
          return this.#saveRun(params.project, held.parts, held.record, context);
        } },
      { id: 'run.sweep', tool: 'run_sweep', title: '运行扫描', kind: 'run',
        description: '在当前工程上只改变一个量，逐点计算载流量，生成一条运行记录。不改动工程输入。',
        parameters: obj({ project, variable: oneOf(SWEEP_VARIABLES, {
          description: 'soil_thermal_resistivity 土壤热阻率 K·m/W；ambient_temperature_c 环境温度 °C；depth_m 中心埋深 m；spacing_m 中心距 m；current_a 负荷电流 A' }),
          values: arr(num(), { minItems: 2, maxItems: 50, description: '扫描点的数值' }) }),
        execute: async (params: { project: string; variable: string; values: number[] }, context) => {
          const parts = store.parts(params.project);
          const record = await core.call('study.sweep', { scene: this.scene(store.meta(params.project).name, parts),
            variable: params.variable, values: params.values });
          return this.#saveRun(params.project, parts, record, context);
        }, brief: briefRun, card: runCard, notes: runNotes },
      { id: 'run.select', tool: 'run_selection', title: '运行选型', kind: 'run',
        description: '在当前敷设和工况下，对一组候选型号逐个计算载流量，按目标电流选出满足要求的最小截面，生成一条运行记录。不改动工程输入；要采用选出的型号，再调用 set_cable。',
        parameters: obj({ project, target_current_a: num({ exclusiveMinimum: 0, description: '目标电流，A' }),
          candidates: opt(arr(str(), { minItems: 1, maxItems: 30, description: '候选型号标识；缺省为当前型号所在系列的全部型号' })) }),
        execute: async (params: { project: string; target_current_a: number; candidates?: string[] }, context) => {
          const parts = store.parts(params.project);
          const candidates = params.candidates
            ? params.candidates.map(id => library.entry(id))
            : library.entries().filter(entry => entry.family === parts.cable.family).slice(0, 30);
          const record = await core.call('study.select', { scene: this.scene(store.meta(params.project).name, parts),
            candidates, target_current_a: params.target_current_a });
          return this.#saveRun(params.project, parts, record, context);
        }, brief: briefRun, card: runCard, notes: runNotes },
      { id: 'run.get', tool: 'get_run', title: '读取运行记录', kind: 'read',
        description: '读取一条运行记录的结果摘要：允许电流、各电缆温度、损耗、热阻，或扫描点、选型候选表。',
        parameters: obj({ project, run: str({ description: '运行记录标识，例如 run-1a2b3c4d' }) }),
        execute: async (params: { project: string; run: string }) => store.run(params.project, params.run), brief: briefRun, card: runCard },
      { id: 'report.export', tool: 'export_report', title: '导出计算书', kind: 'run',
        description: '把一条运行记录导出为计算书（可打印的 HTML 文件），保存在工程的 reports 文件夹。',
        parameters: obj({ project, run: str(), open: opt(bool()) }),
        execute: async (params: { project: string; run: string }) => {
          const record = store.run(params.project, params.run);
          const path = store.saveReport(params.project, record.id, renderReport(record));
          this.emit({ type: 'project', project_id: params.project });
          return { run: record.id, path, url: `/api/projects/${params.project}/reports/${record.id}` };
        }, brief: (result: { run: string; url: string }) => ({ run: result.run, saved: true, url: result.url }),
        card: (params: { project: string }, result: { run: string; url: string }): CardRef => ({ kind: 'file', url: result.url, type: 'html',
          title: `计算书 · ${store.run(params.project, result.run).title}`, href: `/p/${params.project}?run=${result.run}` }),
        notes: () => ['计算书已保存，可打印，浏览器里可另存为 PDF'] },
      { id: 'workbench.open', tool: 'open_in_workbench', title: '在工作台打开', kind: 'read',
        description: '让工程师在工作台里看一个对象：型号库、结构表导入、一个系列、一个规格（可指定版本）、一个工程或一条运行记录。对象必须已经存在。结果会显示成一个“在工作台打开”按钮。',
        parameters: obj({
          target: opt(oneOf(['library', 'import', 'series', 'spec', 'project', 'run'], { description: 'library 型号库；import 导入结构表；series 系列；spec 规格；project 工程；run 运行记录。可省略：按给出的 run、spec、series、project 推断' })),
          series: opt(str()), spec: opt(str()), version: opt(int({ minimum: 1 })), project: opt(str()), run: opt(str()),
        }),
        execute: async (params: { target?: string; series?: string; spec?: string; version?: number; project?: string; run?: string }) => {
          // Only a link is made, so what was given says what is meant: a model that names the series and forgets the kind is not turned away.
          const target = params.target ?? (params.run ? 'run' : params.spec ? 'spec' : params.series ? 'series' : params.project ? 'project' : 'library');
          const need = (value: string | undefined, name: string): string => {
            if (!value) throw new StudioError({ code: 'INPUT_INVALID', message: `打开${KIND_OPEN[target]}需要 ${name}。`, path: `/${name}` });
            return value;
          };
          if (target === 'library') return { label: '型号库', href: '/library' };
          if (target === 'import') return { label: '导入结构表', href: '/library/import' };
          if (target === 'series') {
            const view = library.seriesView(need(params.series, 'series'));
            return { label: `系列 ${view.series.name}`, href: `/library/${view.series.id}` };
          }
          if (target === 'spec') {
            const view = library.specView(need(params.spec, 'spec'), params.version);
            return { label: `${view.spec.name} · 第 ${view.version.number} 版`, href: `/library/${view.series.id}?spec=${encodeURIComponent(view.spec.id)}&version=${view.version.number}` };
          }
          if (target === 'project') {
            const meta = store.meta(need(params.project, 'project'));
            return { label: `工程 ${meta.name}`, href: `/p/${meta.id}` };
          }
          const record = store.run(need(params.project, 'project'), need(params.run, 'run'));
          return { label: `运行记录 ${record.sequence} · ${record.title}`, href: `/p/${record.project.id}?run=${record.id}` };
        },
        brief: (result: { label: string }) => ({ opened: result.label, shown_as: '工作台按钮' }),
        card: (_params: unknown, result: { label: string; href: string }): CardRef => ({ kind: 'open', label: result.label, href: result.href }) },
    ];
  }
}
