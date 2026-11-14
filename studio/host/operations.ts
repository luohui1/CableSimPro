// The operation layer: every action of the workbench exists once here. A button calls an
// operation over HTTP; the agent calls the same operation as a tool.
import { EventEmitter } from 'node:events';
import { arr, bool, compile, nullable, num, obj, oneOf, opt, str, type Schema } from '@earendil-works/pi-schema';
import { compact, describeChanges, fixed, KIND_NAMES } from '../shared/format.ts';
import type {
  Change, Conditions, Installation, Issue, LayoutOption, LibraryEntry, MethodChoice, PartName, Parts, Preview, ProjectView,
  RunRecord, StudioEvent,
} from '../shared/types.ts';
import { type Core, StudioError } from './core.ts';
import { renderReport } from './report.ts';
import { inputsDigest, type Store } from './store.ts';

export interface Context { by: 'human' | 'agent'; task_id?: string }
export interface Plan { changes: Change[]; parts: Partial<Parts> }

export interface Operation {
  id: string;
  /** Tool name the agent sees. Operations without one are not offered to the agent. */
  tool?: string;
  title: string;
  description: string;
  kind: 'read' | 'write' | 'run';
  parameters: Schema;
  execute(params: any, context: Context): Promise<unknown>;
  /** Write operations: what would change, without saving anything. */
  plan?(params: any): Promise<Plan>;
  /** What the agent is told about the result; the full result stays in the workbench. */
  brief?(result: any): unknown;
}

const project = str({ description: '工程标识，例如 p-1a2b3c4d' });
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
  events = new EventEmitter();
  operations = new Map<string, Operation>();
  #layouts = new Map<string, string>();
  #options = new Map<string, LayoutOption[]>();
  /** Draft results by project and inputs digest: computed, not written to disk. The few latest are kept, so undo finds its draft again. */
  #drafts = new Map<string, Map<string, { parts: Parts; record: any; shown: RunRecord }>>();

  constructor(core: Core, store: Store) {
    this.core = core;
    this.store = store;
    this.events.setMaxListeners(100);
    for (const operation of this.#define()) this.operations.set(operation.id, operation);
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
    const errors = compile(operation.parameters).errors(params);
    if (errors.length) {
      const first = errors[0] as { path?: string; instancePath?: string; message?: string };
      const path = first.path ?? first.instancePath ?? '';
      throw new StudioError({ code: 'INPUT_INVALID', message: `参数不符合要求：${path} ${first.message ?? ''}`.trim(), path: path || undefined });
    }
    return operation.execute(params, context);
  }

  layoutLabel = (kind: string): string => this.#layouts.get(kind) ?? kind;

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
    const { core, store } = this;
    const header = (record: RunRecord) => ({ run: record.id, sequence: record.sequence, title: record.title, status: record.status, tier: record.tier });
    const briefRun = (record: RunRecord): unknown => {
      const base = { ...header(record), kind: record.kind, method: record.method_card?.plugin, tier_basis: record.method_card?.tier.basis };
      if (record.kind === 'sweep') {
        return { ...base, variable: record.sweep!.label, unit: record.sweep!.unit,
                 points: record.sweep!.points.map(point => ({ value: point.value, ampacity_a: point.ampacity_a, hottest_conductor_c: point.hottest_conductor_c, error: point.error?.message })) };
      }
      if (record.kind === 'selection') {
        return { ...base, target_current_a: record.selection!.target_current_a, chosen: record.selection!.chosen, rule: record.selection!.rule,
                 reason: record.selection!.reason,
                 candidates: record.selection!.candidates.map(row => ({ model_id: row.model_id, name: row.name, area_mm2: row.area_mm2,
                   ampacity_a: row.ampacity_a, meets_target: row.meets_target, conductor_at_target_c: row.conductor_at_target_c,
                   error: (row.error ?? row.at_target_error)?.message })) };
      }
      const summary = record.summary!;
      if (summary.status !== 'succeeded') return { ...base, error: summary.error };
      return { ...base, ampacity_a: summary.ampacity?.value_a, basis: summary.ampacity?.basis_name, limiting_cable: summary.ampacity?.limiting_cable,
               circuits: summary.circuits, ambient_c: summary.ambient_c, verification_passed: summary.verification?.passed,
               operating: summary.operating?.cables.map(cable => ({ id: cable.id, phase: cable.phase, current_a: cable.current_a,
                 conductor_c: cable.conductor_c, limit_c: cable.limit_c, sheath_c: cable.sheath_c, surface_c: cable.surface_c,
                 losses_w_m: cable.losses_w_m, thermal_k_m_w: cable.thermal_k_m_w, lambda1: cable.lambda1 })),
               warnings: summary.warnings?.map(warning => warning.message) };
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

    const planCable = async (params: { project: string; model_id: string }): Promise<Plan> => {
      const before = store.parts(params.project);
      const defaults = await core.call<Pick<Parts, 'cable' | 'installation' | 'conditions'>>('library.defaults', { model_id: params.model_id });
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
      { id: 'project.list', title: '工程列表', description: '列出全部工程。', kind: 'read', parameters: obj({}),
        execute: async () => store.list() },
      { id: 'project.create', title: '新建工程', description: '新建工程并选定初始型号。', kind: 'write',
        parameters: obj({ name: str({ minLength: 1, maxLength: 80 }), model_id: opt(str()) }),
        execute: async (params: { name: string; model_id?: string }) => {
          const defaults = await core.call<Pick<Parts, 'cable' | 'installation' | 'conditions'>>('library.defaults',
            { model_id: params.model_id ?? 'system.yjq02-110kv-800' });
          const meta = store.create(params.name.trim(), { ...defaults, method: { method: 'iec60287.steady', parameters: {} } });
          this.emit({ type: 'project', project_id: meta.id });
          return this.view(meta.id);
        } },
      { id: 'project.rename', title: '重命名工程', description: '修改工程名称。', kind: 'write',
        parameters: obj({ project, name: str({ minLength: 1, maxLength: 80 }) }),
        execute: async (params: { project: string; name: string }) => {
          store.rename(params.project, params.name.trim());
          this.emit({ type: 'project', project_id: params.project });
          return this.view(params.project);
        } },
      { id: 'project.get', tool: 'get_project', title: '读取工程', kind: 'read', parameters: obj({ project }),
        description: '读取当前工程的型号、敷设、工况、方法参数、输入是否有问题、可信分档和运行记录列表。动手之前先调用它。',
        execute: async (params: { project: string }) => this.view(params.project), brief: briefView },
      { id: 'library.list', tool: 'list_library', title: '型号库', kind: 'read', parameters: obj({}),
        description: '列出型号库：每个型号的标识、名称、系列、数据来源状态、芯数、截面、电压和外径。选型的候选从这里取。',
        execute: async () => core.call<LibraryEntry[]>('library.list'),
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
        }, brief: briefRun },
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
        }, brief: briefRun },
      { id: 'run.select', tool: 'run_selection', title: '运行选型', kind: 'run',
        description: '在当前敷设和工况下，对一组候选型号逐个计算载流量，按目标电流选出满足要求的最小截面，生成一条运行记录。不改动工程输入；要采用选出的型号，再调用 set_cable。',
        parameters: obj({ project, target_current_a: num({ exclusiveMinimum: 0, description: '目标电流，A' }),
          candidates: opt(arr(str(), { minItems: 1, maxItems: 30, description: '候选型号标识；缺省为当前型号所在系列的全部型号' })) }),
        execute: async (params: { project: string; target_current_a: number; candidates?: string[] }, context) => {
          const parts = store.parts(params.project);
          let candidates = params.candidates;
          if (!candidates) {
            const library = await core.call<LibraryEntry[]>('library.list');
            candidates = library.filter(entry => entry.family === parts.cable.family).map(entry => entry.id);
          }
          const record = await core.call('study.select', { scene: this.scene(store.meta(params.project).name, parts),
            candidates, target_current_a: params.target_current_a });
          return this.#saveRun(params.project, parts, record, context);
        }, brief: briefRun },
      { id: 'run.get', tool: 'get_run', title: '读取运行记录', kind: 'read',
        description: '读取一条运行记录的结果摘要：允许电流、各电缆温度、损耗、热阻，或扫描点、选型候选表。',
        parameters: obj({ project, run: str({ description: '运行记录标识，例如 run-1a2b3c4d' }) }),
        execute: async (params: { project: string; run: string }) => store.run(params.project, params.run), brief: briefRun },
      { id: 'report.export', tool: 'export_report', title: '导出计算书', kind: 'run',
        description: '把一条运行记录导出为计算书（可打印的 HTML 文件），保存在工程的 reports 文件夹。',
        parameters: obj({ project, run: str(), open: opt(bool()) }),
        execute: async (params: { project: string; run: string }) => {
          const record = store.run(params.project, params.run);
          const path = store.saveReport(params.project, record.id, renderReport(record));
          this.emit({ type: 'project', project_id: params.project });
          return { run: record.id, path, url: `/api/projects/${params.project}/reports/${record.id}` };
        } },
    ];
  }
}
