// Operations of the product library: reading it, importing a structure table, computing and checking a
// series in the background, revising a specification, and the review steps that only a person takes.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { arr, bool, int, map, num, obj, oneOf, opt, str, union } from '@earendil-works/pi-schema';
import { compact, REVIEW_NAMES, STATE_NAMES } from '../shared/format.ts';
import {
  RESULT_KINDS, type BuildResult, type BuiltRow, type CardRef, type Change, type CheckFailures, type CheckRow, type ImportPreview, type LibraryEntry,
  type LibraryJob, type ProductResult, type ResultKind, type SeriesDeclaration, type SeriesSummary, type SeriesView, type SpecificationReport, type SpecView,
  type TableInspection,
} from '../shared/types.ts';
import type { ProductCad } from '../shared/cad.ts';
import { StudioError } from './core.ts';
import { REVIEW_STEPS } from './library.ts';
import type { Context, Operation, Review, Studio } from './operations.ts';
import { exportSpecification, specificationReports } from './specification.ts';

const TABLES = ['.xlsx', '.xlsm', '.xls', '.csv', '.tsv', '.txt'];
const UPLOAD = /^u-[0-9a-f]{8}$/;
// How many products go into one run of a method: enough to share the start-up, few enough to report progress.
const CHUNK: Record<ResultKind, number> = { check: 12, electrical: 40, short_circuit: 40, rating: 8 };
const KIND_LABEL: Record<ResultKind, string> = { check: '标准核对', electrical: '电气参数', short_circuit: '短路容量', rating: '载流量表' };

export function saveUpload(home: string, name: string, data: Buffer): { upload: string; file: string; size: number; sha256: string } {
  const file = basename(name.replace(/\\/g, '/')).replace(/[<>:"|?*\u0000-\u001f]/g, '_').slice(-120);
  if (!TABLES.includes(extname(file).toLowerCase())) {
    throw new StudioError({ code: 'UPLOAD_UNSUPPORTED', message: '结构表支持 .xlsx、.xls 和 .csv 文件。' }, 415);
  }
  if (!data.length) throw new StudioError({ code: 'UPLOAD_EMPTY', message: '文件是空的。' }, 400);
  const upload = 'u-' + randomBytes(4).toString('hex');
  mkdirSync(join(home, 'uploads', upload), { recursive: true });
  writeFileSync(join(home, 'uploads', upload, file), data);
  return { upload, file, size: data.length, sha256: createHash('sha256').update(data).digest('hex') };
}

function uploaded(home: string, upload: string): { path: string; file: string; sha256: string } {
  const dir = join(home, 'uploads', upload);
  if (!UPLOAD.test(upload) || !existsSync(dir)) throw new StudioError({ code: 'UPLOAD_UNKNOWN', message: '找不到上传的文件，请重新选择。' }, 404);
  const file = readdirSync(dir).find(name => TABLES.includes(extname(name).toLowerCase())) ?? '';
  if (!file) throw new StudioError({ code: 'UPLOAD_UNKNOWN', message: '找不到上传的文件，请重新选择。' }, 404);
  const path = join(dir, file);
  return { path, file, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') };
}

const given = obj({ value: union([num(), str()]), unit: str(), reference: str({ minLength: 1, maxLength: 2000 }) });
const series = obj({
  name: str({ minLength: 1, maxLength: 80, description: '系列名称' }),
  manufacturer: str({ maxLength: 80 }),
  designation: str({ minLength: 1, maxLength: 40, description: '型号，例如 YJV22' }),
  cores: oneOf([1, 3]),
  u0_v: num({ exclusiveMinimum: 0, description: '额定电压 U0，V' }),
  u_v: num({ exclusiveMinimum: 0, description: '额定电压 U，V' }),
  um_v: opt(num({ exclusiveMinimum: 0 })),
  standards: arr(str({ minLength: 1, maxLength: 60 }), { maxItems: 12, description: '执行标准，写到年号，例如 GB/T 12706.2-2020' }),
  common: map(num({ exclusiveMinimum: 0 })),
  common_basis: map(str({ maxLength: 400 })),
  modelling: map(given),
  origin: opt(oneOf(['factory', 'public'])),
  armour_material: opt(oneOf(['steel_galvanized', 'steel_stainless_nonmagnetic'])),
  source: opt(obj({ title: opt(str()), location: opt(str()), sha256: opt(str()), file: opt(str()) })),
});
const table = { upload: str({ description: '上传文件的标识' }), sheet: str({ description: '工作表名' }),
  first_data_row: opt(int({ minimum: 1, description: '数据起始行；缺省采用读取结构表时建议的行' })),
  mapping: opt(map(int({ minimum: 0 }), { description: '字段到列序号的对应；缺省采用读取结构表时建议的对应' })) };
// Kept beside the upload's own folder, which holds the table and nothing else.
const DECLARATIONS = '.declarations.json';
interface ImportRequest { upload: string; sheet: string; first_data_row?: number; mapping?: Record<string, number>; series?: SeriesDeclaration }

export function productOperations(studio: Studio): Operation[] {
  const { core, library } = studio;
  const actor = (context: Context): string => (context.by === 'agent' ? 'Agent' : studio.user);
  let job: LibraryJob | null = JSON.parse(library.setting('product.job') ?? 'null');
  const emitJob = (current: LibraryJob) => {
    library.setSetting('product.job', JSON.stringify(current));
    studio.emit({ type: 'library', series_id: current.series_id, job: { ...current } });
  };
  if (job?.state === 'running') {
    job = { ...job, state: 'failed', title: '上次计算已中断', error: { code: 'JOB_INTERRUPTED', message: '宿主在计算完成前退出。已保存的结果保留，可以继续计算缺项。' } };
    library.setSetting('product.job', JSON.stringify(job));
  }
  const view = (id: string): SeriesView => ({ ...library.seriesView(id), job: job?.series_id === id ? job : null });

  /** The declaration of a sheet that came with a public sample, when the request does not carry one. */
  function sampleDeclaration(upload: string, sheet: string): SeriesDeclaration | null {
    const stored = join(studio.home, 'uploads', upload + DECLARATIONS);
    if (!existsSync(stored)) return null;
    const list = JSON.parse(readFileSync(stored, 'utf-8')) as { sheet: string; series: SeriesDeclaration }[];
    return list.find(item => item.sheet === sheet)?.series ?? null;
  }

  async function preview(params: ImportRequest) {
    const file = uploaded(studio.home, params.upload);
    const given = params.series ?? sampleDeclaration(params.upload, params.sheet);
    if (!given) {
      throw new StudioError({ code: 'IMPORT_DECLARATION_MISSING',
        message: '这张表还没有系列声明（系列名称、厂家、型号、芯数、额定电压 U0/U、执行标准）；这些需要工程师给出，不能猜。' });
    }
    let { first_data_row, mapping } = params;
    // The sheet is read for its own headers as well: what the columns were taken to mean is shown to whoever approves the import.
    const inspection = await core.call<Omit<TableInspection, 'upload'>>('tables.inspect', { path: file.path, designation: given.designation });
    const found = inspection.sheets.find(sheet => sheet.name === params.sheet);
    if (first_data_row === undefined || !mapping) {
      if (!found?.table || !found.columns) {
        throw new StudioError({ code: 'IMPORT_SHEET_UNKNOWN', message: `工作表“${params.sheet}”里没有找到规格表；可用的工作表：${inspection.sheets.filter(sheet => sheet.table).map(sheet => sheet.name).join('、') || '无'}。` });
      }
      first_data_row ??= found.first_data_row!;
      mapping ??= Object.fromEntries(found.columns.filter(column => column.suggested).map(column => [column.suggested!, column.index]));
    }
    const headers = Object.fromEntries(Object.entries(mapping).map(([field, index]) => [field, found?.columns?.find(column => column.index === index)?.header ?? `第 ${index + 1} 列`]));
    const read = await core.call<{ rows: { row: number; values: Record<string, number>; problems: { cell: string; field: string; text: string }[] }[];
      skipped: { row: number; text: string }[] }>('tables.rows', { path: file.path, sheet: params.sheet, first_data_row, mapping });
    if (!read.rows.length) throw new StudioError({ code: 'IMPORT_EMPTY', message: '这张表里没有找到规格行：请核对数据起始行和“标称截面”所在的列。' });
    const declaration: SeriesDeclaration = { ...given, source: { title: given.source?.title ?? file.file,
      location: given.source?.location ?? `工作表“${params.sheet}”`, sha256: given.source?.sha256 ?? file.sha256, file: file.file } };
    const build = await core.call<BuildResult>('structure.build', { series: declaration, rows: read.rows.map(row => row.values) });
    const built = build.rows.map((row, index): BuiltRow => {
      const problem = read.rows[index].problems[0];
      // A cell that should be a number and is not is never read around: the row waits for the table to be corrected.
      return problem ? { ok: false, row: row.row, error: { code: 'TABLE_CELL_INVALID', message: `单元格 ${problem.cell}（${problem.field}）不是数字：“${problem.text}”。` } } : row;
    });
    const rows: ImportPreview['rows'] = built.map((row, index) => (row.ok
      ? { source_row: read.rows[index].row, ok: true, key: row.key, name: row.name, area_mm2: row.area_mm2,
          outer_diameter_mm: row.entry.summary.outer_diameter_m * 1000, closure: row.closure, derivation: row.derivation, warnings: row.warnings }
      : { source_row: read.rows[index].row, ok: false, warnings: [], error: row.error }));
    const duplicate = rows.find((row, index) => row.ok && rows.findIndex(other => other.ok && other.key === row.key) !== index);
    if (duplicate) {
      throw new StudioError({ code: 'IMPORT_DUPLICATE', message: `表里有两行都是 ${duplicate.key}（第 ${duplicate.source_row} 行）；一个系列里每个截面只能有一行。` });
    }
    return { declaration, built, file, mapping: mapping!, table: { first_data_row: first_data_row!, headers }, preview: { designation: build.designation, rows, skipped: read.skipped,
      ready: rows.filter(row => row.ok).length, failed: rows.filter(row => !row.ok).length } satisfies ImportPreview };
  }

  /** The words for the structure fields and the calculation parameters, asked of the core once. */
  let askedVocabulary: Promise<{ fields: { key: string; label: string; unit: string }[]; modelling: { key: string; label: string; unit: string }[] }> | undefined;
  const vocabulary = () => (askedVocabulary ??= core.call('structure.vocabulary'));
  const ARMOUR: Record<string, string> = { steel_galvanized: '镀锌钢', steel_stainless_nonmagnetic: '不锈钢（非磁性）' };

  /** The batch the agent's last compute call started, so the agent's call can wait for it. */
  let running: Promise<void> | undefined;

  /** Compute what is missing for the given versions, kind by kind, saving each chunk as it comes back. */
  async function run(running: LibraryJob, items: { key: string; cable: LibraryEntry; standards: string[] }[], kinds: ResultKind[], force: boolean, by: string) {
    try {
      for (const kind of kinds) {
        const pending = items.filter(item => force || !library.hasCurrentResult(item.key, kind, library.inputs(kind, item.cable, item.standards)));
        running.done += items.length - pending.length;
        for (let start = 0; start < pending.length; start += CHUNK[kind]) {
          if (running.cancel_requested) { running.state = 'cancelled'; break; }
          const chunk = pending.slice(start, start + CHUNK[kind]);
          running.title = `${KIND_LABEL[kind]} · ${Math.min(start + chunk.length, pending.length)} / ${pending.length}`;
          emitJob(running);
          const results = await core.call<Record<string, Partial<Record<ResultKind, ProductResult>>>>('product.compute', { items: chunk, kinds: [kind] });
          for (const item of chunk) {
            library.saveResult(item.key, kind, library.inputs(kind, item.cable, item.standards), results[item.key][kind], by);
          }
          running.done += chunk.length;
          emitJob(running);
        }
        if (running.state === 'cancelled') break;
      }
      if (running.state !== 'cancelled') running.state = 'done';
      running.title = running.state === 'cancelled' ? '计算已停止，已完成的结果保留' : '处理完成';
    } catch (error) {
      running.state = 'failed';
      running.error = error instanceof StudioError ? error.issue() : { code: 'INTERNAL', message: error instanceof Error ? error.message : String(error) };
      running.title = '计算中断';
    }
    library.note(by, 'series', running.series_id, 'computed', { kinds, products: items.length, state: running.state });
    emitJob(running);
  }

  /** What refuses a revision of a specification, in one place: the review shows it before anyone is asked, and the run holds to it. */
  async function checkRevision(params: { spec: string; version?: number; values: Record<string, number>; note: string }) {
    const spec = library.specView(params.spec);
    if (params.version !== undefined && spec.version.number !== params.version) throw new StudioError({ code: 'VERSION_CHANGED', message: '规格已产生新版本，请重新核对后修改。' }, 409);
    if (!params.note.trim()) throw new StudioError({ code: 'REVISION_INVALID', message: '请填写修改原因。' });
    if (spec.derivation.kind === 'bundled') {
      throw new StudioError({ code: 'REVISION_UNAVAILABLE', message: '随软件提供的结构没有结构表，不能改尺寸；请导入本厂结构表。' }, 409);
    }
    const editable = new Set(spec.structure.filter(item => item.origin === 'table' && item.key !== 'area').map(item => item.key));
    if (!Object.keys(params.values).length || Object.keys(params.values).some(key => !editable.has(key))) {
      throw new StudioError({ code: 'REVISION_INVALID', message: '只能修改原表已有的结构尺寸；标称截面属于规格身份，请另行导入规格。' });
    }
    const current = Object.fromEntries(spec.structure.filter(item => item.origin === 'table').map(item => [item.key, item.value]));
    if (Object.entries(params.values).every(([key, value]) => current[key] === value)) throw new StudioError({ code: 'REVISION_UNCHANGED', message: '要改的值和现在的一样，没有可修改的。' });
    const build = await core.call<BuildResult>('structure.build', { series: library.declaration(spec.series.id), rows: [{ ...current, ...params.values }] });
    const built = build.rows[0];
    if (!built.ok) throw new StudioError(built.error);
    return { spec, built };
  }

  const briefJob = (current: LibraryJob | null) => (current ? { job: current.id, series: current.series_id, state: current.state, title: current.title,
    done: current.done, total: current.total, error: current.error?.message } : null);
  const issues = (list: { message: string }[]) => list.map(item => item.message);
  /** A series as the agent is told of it: not which person on this machine made it. */
  const publicSeries = ({ created_by: _by, ...rest }: SeriesSummary) => rest;
  /** Where the workbench shows one version of one specification. */
  const specHref = (spec: string, version: number) => `/library/${library.specView(spec, version).series.id}?spec=${encodeURIComponent(spec)}&version=${version}`;
  /** The solid the agent built is shown again on its card; building it twice would cost seconds for nothing. */
  const solids = new Map<string, Record<string, unknown>>();
  const briefSpec = (spec: SpecView) => ({
    spec: spec.spec.id, name: spec.spec.name, series: spec.series.name, version: spec.version.number, review: spec.version.review,
    summary: spec.entry.summary, source: spec.entry.source.slice(0, 600), warnings: spec.warnings.map(item => item.message),
    structure: spec.structure.map(item => `${item.label} ${item.value} ${item.unit}（${item.origin === 'table' ? '结构表' : item.basis}）`),
    results: Object.fromEntries(Object.entries(spec.results).map(([kind, result]) => [kind, result.error ? { error: result.error.message }
      : kind === 'check' ? { count: result.summary?.count, failed: (result.rows as { verdict: string; title: string; clause: string; standard: string }[])
          .filter(row => row.verdict === 'failed').map(row => `${row.title}：${row.standard} ${row.clause}`) }
        : { rows: (result.rows as { id: string; value?: number | null; ampacity_a?: number | null; status: string; unit?: string }[]).slice(0, 40)
            .map(row => ({ id: row.id, value: row.value ?? row.ampacity_a ?? null, unit: row.unit, status: row.status })) }])),
  });

  return [
    { id: 'library.job', tool: 'get_compute_job', title: '计算任务', kind: 'read', parameters: obj({}), description: '读取最近一批计算的进度，包括宿主重启前中断的任务。',
      execute: async () => job, brief: briefJob },
    { id: 'library.compute.cancel', tool: 'cancel_compute', title: '停止批量计算', kind: 'run', parameters: obj({ job: str({ description: '计算任务标识，例如 job-1a2b3c4d' }) }),
      description: '当前批次完成后停止，已经保存的结果保留。Agent 只能停自己发起的批次，工程师发起的由工程师停。', execute: async (params: { job: string }, context) => {
        if (!job || job.id !== params.job || job.state !== 'running') throw new StudioError({ code: 'JOB_UNKNOWN', message: '这批计算已经结束。' }, 409);
        if (context.by === 'agent' && job.started_by !== 'agent') throw new StudioError({ code: 'JOB_NOT_YOURS', message: '这批计算不是 Agent 发起的，只能由工程师停止。' }, 403);
        job.cancel_requested = true;
        emitJob(job);
        return job;
      }, brief: briefJob },
    { id: 'library.documents', tool: 'list_documents', title: '规格书记录', kind: 'read', parameters: obj({ spec: str({ description: '规格标识' }) }),
      description: '读取这个规格已经导出的固定版本 PDF 和来源快照。', execute: async (params: { spec: string }) => {
        library.specView(params.spec);
        return specificationReports(studio.home, params.spec);
      }, brief: (list: SpecificationReport[]) => list.map(item => ({ id: item.id, title: item.title, version: item.version,
        review: REVIEW_NAMES[item.review] ?? item.review, created: item.created, url: item.url })) },
    { id: 'library.geometry', tool: 'build_geometry', title: '生成 CAD 实体', kind: 'run', parameters: obj({ spec: str({ description: '规格标识' }), version: int({ minimum: 1, description: '版本号' }) }),
      description: '从指定版本的保存结构调用已封签的 CadQuery/OpenCASCADE 插件，生成三维实体与 STEP；缺少构造参数或不支持的结构直接拒绝，不画替代模型。实体会以三维卡片显示在对话里。',
      execute: async (params: { spec: string; version: number }) => {
        const selected = library.specView(params.spec, params.version);
        const held = solids.get(selected.version.content_sha256);
        // Another specification with the same structure shares the solid, not the name: the card and its link are for the one that asked.
        if (held) return { ...held, spec: selected.spec.id, version: selected.version.number };
        const result = await core.call<Record<string, unknown>>('product.geometry', { entry: selected.entry });
        const built = { ...result, spec: selected.spec.id, version: selected.version.number, content_sha256: selected.version.content_sha256 };
        solids.set(selected.version.content_sha256, built);
        if (solids.size > 4) solids.delete(solids.keys().next().value as string);
        return built;
      },
      brief: (cad: ProductCad) => ({ spec: cad.spec, version: cad.version, built: true, outer_diameter_mm: cad.model.outer_diameter_m * 1000, length_mm: cad.model.length_m * 1000,
        layers: cad.model.layers.map(layer => layer.label ?? layer.role), mass_kg_per_km: cad.model.mass_kg_per_km, quantity_missing_layers: cad.model.quantity_missing_layers,
        approximation: cad.model.geometry_approximation, warnings: issues(cad.warnings), step_file: '已随实体生成，工作台可下载' }),
      card: (_params: unknown, cad: ProductCad): CardRef => ({ kind: 'model3d', spec: cad.spec, version: cad.version, href: specHref(cad.spec, cad.version) }),
      notes: (_params: unknown, cad: ProductCad) => [`外径 ${compact(cad.model.outer_diameter_m * 1000)} mm`, `${cad.model.layers.length} 层，STEP 文件已生成`] },
    { id: 'library.export', tool: 'export_specification', title: '导出规格书', kind: 'run', parameters: obj({ spec: str({ description: '规格标识' }), version: int({ minimum: 1, description: '版本号' }) }),
      description: '把指定版本的结构、已保存结果、计算条件、问题及来源保存为不可覆盖的 PDF 和快照。未审核版本标为草稿，缺项明确列出。',
      execute: async (params: { spec: string; version: number }, context) => {
        const report = await exportSpecification(studio, library.specView(params.spec, params.version), actor(context));
        studio.emit({ type: 'library' });
        return report;
      },
      brief: (report: SpecificationReport) => ({ id: report.id, title: report.title, version: report.version, review: REVIEW_NAMES[report.review] ?? report.review,
        draft_marking: report.review === 'draft' ? '版本未审核，文件上标为草稿' : undefined, url: report.url }),
      card: (_params: unknown, report: SpecificationReport): CardRef => ({ kind: 'file', url: report.url, title: report.title, type: 'pdf', href: specHref(report.spec, report.version), status: REVIEW_NAMES[report.review] ?? report.review }),
      notes: (_params: unknown, report: SpecificationReport) => [report.title, `审核状态：${REVIEW_NAMES[report.review] ?? report.review}`] },
    { id: 'library.series', tool: 'list_series', title: '产品系列', kind: 'read', parameters: obj({}),
      description: '列出产品库的全部系列：名称、厂家、型号、电压、执行标准、规格数和各审核状态的数量。',
      execute: async () => library.seriesList(), brief: (list: SeriesSummary[]) => list.map(publicSeries) },
    { id: 'library.series.get', tool: 'get_series', title: '读取系列', kind: 'read', parameters: obj({ series: str({ description: '系列标识，例如 s-1a2b3c4d' }) }),
      description: '读取一个系列：系列声明，以及每个规格的最新版本、外径、电阻、标准核对结论、短路容量和基准条件下的载流量。',
      execute: async (params: { series: string }) => view(params.series),
      brief: (result: SeriesView) => ({ series: publicSeries(result.series), reference_condition: result.reference, specs: result.specs.map(spec => ({ spec: spec.id, name: spec.name,
        review: spec.review, outer_diameter_mm: spec.outer_diameter_mm, check: spec.check, ac_resistance_ohm_km: spec.ac_resistance_ohm_km,
        short_circuit_ka: spec.short_circuit_ka, ampacity_a: spec.ampacity_a, warnings: spec.warnings.map(item => item.message) })) }) },
    { id: 'library.spec.get', tool: 'get_spec', title: '读取规格', kind: 'read',
      parameters: obj({ spec: str({ description: '规格标识' }), version: opt(int({ minimum: 1, description: '版本号；缺省为最新版' })) }),
      description: '读取一个规格的一个版本：结构表（每个值的来路）、外径闭合、标准核对逐条结论、电气参数、短路容量、载流量表、版本和审核记录。',
      execute: async (params: { spec: string; version?: number }) => library.specView(params.spec, params.version), brief: briefSpec },
    { id: 'library.vocabulary', tool: 'get_import_vocabulary', title: '结构表字段', kind: 'read', parameters: obj({}),
      description: '结构表可以对应的字段、计算用参数及其参考取值、已保存的列对应关系和审核步骤。',
      execute: async () => ({ ...(await core.call<Record<string, unknown>>('structure.vocabulary')), mappings: library.mappings(), review_steps: REVIEW_STEPS }),
      brief: (result: { fields: { key: string; label: string; unit: string }[]; modelling: { key: string; label: string; unit: string }[]; mappings: { name: string }[] }) => ({
        fields: result.fields.map(field => `${field.key}：${field.label}${field.unit ? `（${field.unit}）` : ''}`),
        modelling: result.modelling.map(field => `${field.key}：${field.label}${field.unit ? `（${field.unit}）` : ''}`), saved_mappings: result.mappings.map(item => item.name) }) },
    { id: 'library.designation', tool: 'read_designation', title: '解读型号', kind: 'read', parameters: obj({ text: str({ minLength: 1, maxLength: 120 }) }),
      description: '解读一个型号写法（如 ZC-YJV22-8.7/15 3×240）：导体、绝缘、铠装、护套、电压、芯数和截面；没有写的部分为空。',
      execute: async (params: { text: string }) => core.call('designation.parse', { text: params.text }) },
    { id: 'library.import.inspect', tool: 'inspect_table', title: '读取结构表', kind: 'read', parameters: obj({ upload: table.upload, designation: opt(str({ description: '型号写法，用来提高列对应的准确度' })) }),
      description: '读取上传的结构表：每张工作表的表头、数据起始行和各列建议对应的字段。',
      execute: async (params: { upload: string; designation?: string }): Promise<TableInspection> => {
        const file = uploaded(studio.home, params.upload);
        return { upload: params.upload, ...(await core.call<Omit<TableInspection, 'upload'>>('tables.inspect', { path: file.path, designation: params.designation ?? null })) };
      },
      brief: (result: TableInspection) => ({ upload: result.upload, file: result.file, sheets: result.sheets.map(sheet => ({ name: sheet.name, rows: sheet.rows, is_spec_table: sheet.table,
        title: sheet.title, first_data_row: sheet.first_data_row, data_rows: sheet.data_rows,
        columns: sheet.columns?.map(column => ({ column: column.letter, header: column.header, field: column.suggested, sample: column.sample.slice(0, 2) })) })) }) },
    { id: 'library.import.sample', tool: 'load_public_sample', title: '公开样例', kind: 'run', parameters: obj({}),
      description: '把一份公开厂家手册（人民电缆 8.7/15 kV 结构表）写成工作簿并上传，附带导入它每张表所需的系列声明，用来试导入。之后对每张表调用 preview_import、import_series 时只需给 upload 和 sheet，声明自动采用样例自带的。',
      execute: async () => {
        const upload = 'u-' + randomBytes(4).toString('hex');
        mkdirSync(join(studio.home, 'uploads', upload), { recursive: true });
        const sample = await core.call<{ sheets: string[]; title: string; manufacturer: string; declarations: { sheet: string; series: SeriesDeclaration }[] }>(
          'catalogue.sample', { name: 'people_mv_xlpe', path: join(studio.home, 'uploads', upload, '人民电缆 8.7-15kV 结构表（公开手册）.xlsx') });
        writeFileSync(join(studio.home, 'uploads', upload + DECLARATIONS), JSON.stringify(sample.declarations));
        return { upload, file: '人民电缆 8.7-15kV 结构表（公开手册）.xlsx', title: sample.title, manufacturer: sample.manufacturer, declarations: sample.declarations };
      },
      brief: (sample: { upload: string; file: string; title: string; manufacturer: string; declarations: { sheet: string; series: SeriesDeclaration }[] }) => ({
        upload: sample.upload, file: sample.file, source: sample.title, manufacturer: sample.manufacturer,
        sheets: sample.declarations.map(item => ({ sheet: item.sheet, series: item.series.name, designation: item.series.designation, cores: item.series.cores,
          u0_u_kv: `${compact(item.series.u0_v / 1000)}/${compact(item.series.u_v / 1000)}`, standards: item.series.standards })) }) },
    { id: 'library.import.preview', tool: 'preview_import', title: '预览导入', kind: 'read', parameters: obj({ ...table, series: opt(series) }),
      description: '按系列声明和列对应把结构表一张工作表的每一行生成规格，不保存：哪些行可用、哪些行缺什么、哪些行可疑。公开样例不用给 series；自己的结构表必须由工程师提供声明。',
      execute: async (params: ImportRequest) => (await preview(params)).preview,
      brief: (result: ImportPreview) => ({ designation: result.designation.description, ready: result.ready, failed: result.failed,
        rows: result.rows.slice(0, 40).map(row => ({ source_row: row.source_row, ok: row.ok, name: row.name, area_mm2: row.area_mm2,
          outer_diameter_mm: row.outer_diameter_mm === undefined ? undefined : Number(row.outer_diameter_mm.toFixed(2)),
          warnings: row.warnings.length ? issues(row.warnings) : undefined, error: row.error?.message })),
        rows_not_shown: Math.max(0, result.rows.length - 40), skipped: result.skipped.slice(0, 10) }) },
    { id: 'library.import.commit', tool: 'import_series', title: '导入系列', kind: 'write',
      parameters: obj({ ...table, series: opt(series), skip_failed: opt(bool({ description: '有不能导入的行时，是否只导入可用的行；必须得到工程师同意才能为 true' })),
        mapping_name: opt(str({ minLength: 1, maxLength: 60 })), headers: opt(map(str())) }),
      description: '把结构表一张工作表导入为一个新系列，每行成为一个规格的第 1 版草稿。这是改动，先交给工程师审阅；审阅卡里会写明新系列、规格数和不能导入的行数。',
      agentParams: (params: ImportRequest & { mapping_name?: string; headers?: Record<string, string> }) => {
        // Where a table came from is what the host measured, not what the model writes; named column mappings are a person's to save.
        if (params.series?.source) params.series.source = { ...(params.series.source.title ? { title: params.series.source.title } : {}), ...(params.series.source.location ? { location: params.series.source.location } : {}) };
        delete params.mapping_name;
        delete params.headers;
      },
      review: async (params: ImportRequest & { skip_failed?: boolean }): Promise<Review> => {
        const result = await preview(params);
        if (result.preview.failed && !params.skip_failed) {
          throw new StudioError({ code: 'IMPORT_HAS_ERRORS', message: `有 ${result.preview.failed} 行不能导入；改正结构表，或经工程师同意后选择只导入可用的行。` }, 409);
        }
        const declared = result.declaration;
        const words = await vocabulary();
        const label = (list: { key: string; label: string }[], key: string) => list.find(item => item.key === key)?.label ?? key;
        const unit = (list: { key: string; unit: string }[], key: string) => list.find(item => item.key === key)?.unit ?? '';
        // What the commit itself would refuse is refused here, before a person is asked to approve something that cannot happen.
        if (!result.preview.ready) throw new StudioError({ code: 'IMPORT_EMPTY', message: '没有可以导入的规格。' });
        if (library.seriesList().some(item => item.name === declared.name)) {
          throw new StudioError({ code: 'SERIES_EXISTS', message: `产品库里已有名为“${declared.name}”的系列，请改名后再导入。`, path: '/series/name' }, 409);
        }
        const measuredSource = `${result.file.file} · 工作表“${params.sheet}”`;
        const savedSource = [declared.source?.title ?? result.file.file, declared.source?.location].filter(Boolean).join(' · ');
        const changes: Change[] = [
          { part: 'series', field: 'name', label: '新系列', before: '—', after: `${declared.name}（${declared.designation}）` },
          { part: 'series', field: 'specs', label: '规格数', before: '—', after: `${result.preview.ready} 个` },
          ...(result.preview.failed ? [{ part: 'series', field: 'left_out', label: '跳过的行', before: '—', after: `${result.preview.failed} 行不能导入` }] : []),
          { part: 'series', field: 'rating', label: '芯数与电压', before: '—', after: `${declared.cores} 芯，U0/U ${compact(declared.u0_v / 1000)}/${compact(declared.u_v / 1000)} kV${declared.um_v ? `，Um ${compact(declared.um_v / 1000)} kV` : ''}` },
          { part: 'series', field: 'standards', label: '执行标准', before: '—', after: declared.standards.join('、') || '未声明' },
          { part: 'series', field: 'origin', label: '厂家与资料性质', before: '—', after: `${declared.manufacturer || '厂家未声明'} · ${STATE_NAMES[declared.origin ?? 'public'] ?? declared.origin}` },
          { part: 'series', field: 'columns', label: '列对应', before: '—',
            after: `${Object.keys(result.mapping).map(field => `${label(words.fields, field)} ← ${result.table.headers[field]}`).join('\n')}\n数据从第 ${result.table.first_data_row} 行起` },
          // One item to a line: the card shows them as a list, not as a paragraph.
          ...(Object.keys(declared.common).length ? [{ part: 'series', field: 'common', label: '系列统一给的尺寸', before: '—',
            after: Object.entries(declared.common).map(([key, value]) => `${label(words.fields, key)} ${compact(value)} ${unit(words.fields, key)}${declared.common_basis[key] ? `（${declared.common_basis[key]}）` : ''}`).join('\n') }] : []),
          ...(Object.keys(declared.modelling).length ? [{ part: 'series', field: 'modelling', label: '计算用参数', before: '—',
            after: Object.entries(declared.modelling).map(([key, item]) => `${label(words.modelling, key)} ${item.value}${item.unit && item.unit !== '1' ? ` ${item.unit.replace('*', '·')}` : ''}（${item.reference}）`).join('\n') }] : []),
          ...(declared.armour_material ? [{ part: 'series', field: 'armour', label: '铠装材料', before: '—', after: ARMOUR[declared.armour_material] ?? declared.armour_material }] : []),
          // What is saved with every specification as where it came from is what the person decides on; the uploaded file is named when it is not already that.
          { part: 'series', field: 'source', label: '来源', before: '—', after: savedSource === measuredSource ? savedSource : `${savedSource}\n（上传文件 ${measuredSource}）` },
        ];
        return { title: '导入系列', changes };
      },
      execute: async (params: ImportRequest & { skip_failed?: boolean; mapping_name?: string; headers?: Record<string, string> }, context) => {
        const result = await preview(params);
        if (result.preview.failed && !params.skip_failed) {
          throw new StudioError({ code: 'IMPORT_HAS_ERRORS', message: `有 ${result.preview.failed} 行不能导入；改正结构表，或选择只导入可用的行。` }, 409);
        }
        const rows = result.built.filter((row): row is Extract<BuiltRow, { ok: true }> => row.ok);
        const id = library.createSeries(result.declaration, result.preview.designation.description, rows, actor(context), result.file.file);
        if (params.mapping_name) library.saveMapping(params.mapping_name, result.mapping, params.headers ?? {}, actor(context));
        studio.emit({ type: 'library', series_id: id });
        return { series: id, imported: rows.length, left_out: result.preview.failed };
      },
      brief: (result: { series: string; imported: number; left_out: number }) => ({ series: result.series, imported: result.imported, left_out: result.left_out, state: '第 1 版草稿' }),
      notes: (_params: unknown, result: { imported: number; left_out: number }) => [`导入 ${result.imported} 个规格，均为第 1 版草稿`, ...(result.left_out ? [`${result.left_out} 行未导入`] : [])] },
    { id: 'library.compute', tool: 'compute_series', title: '计算与核对', kind: 'run',
      parameters: obj({ series: str({ description: '系列标识' }), specs: opt(arr(str(), { minItems: 1, maxItems: 500, description: '只算这些规格；缺省为全系列' })),
        kinds: opt(arr(oneOf(RESULT_KINDS), { minItems: 1, description: 'check 标准核对；electrical 电气参数；short_circuit 短路容量；rating 载流量表' })), force: opt(bool()) }),
      description: '对一个系列（或其中几个规格）的最新版本成批运行标准核对、电气参数、短路容量和载流量表。已有且输入未变的结果不重算。Agent 调用时会等到这一批算完才返回；载流量表最慢，只要标准核对就只传 kinds: ["check"]。',
      execute: async (params: { series: string; specs?: string[]; kinds?: ResultKind[]; force?: boolean }, context) => {
        if (job?.state === 'running') throw new StudioError({ code: 'JOB_RUNNING', message: '已有一批计算在进行，请等它结束。' }, 409);
        const current = library.seriesView(params.series);
        const chosen = current.specs.filter(spec => !params.specs || params.specs.includes(spec.id));
        if (!chosen.length) throw new StudioError({ code: 'COMPUTE_EMPTY', message: '没有选中任何规格。' });
        const kinds = params.kinds ?? RESULT_KINDS;
        const items = chosen.map(spec => ({ key: spec.version_id, cable: library.entry(spec.id, spec.version), standards: current.declaration.standards }));
        job = { id: 'job-' + randomBytes(4).toString('hex'), series_id: params.series, title: '准备计算', done: 0, total: items.length * kinds.length, state: 'running', started_by: context.by };
        const started = job;
        running = run(started, items, kinds, params.force === true, actor(context));
        // The workbench follows a batch through events and returns at once; the agent has nothing to look at, so it waits.
        if (context.by === 'agent') {
          context.signal?.addEventListener('abort', () => { if (started.state === 'running') { started.cancel_requested = true; emitJob(started); } }, { once: true });
          await running;
        }
        return started;
      }, brief: briefJob,
      notes: (_params: unknown, finished: LibraryJob) => [`${finished.title}，${finished.done}/${finished.total} 项`, ...(finished.error ? [finished.error.message] : [])] },
    { id: 'library.check.failures', tool: 'list_check_failures', title: '标准核对结论', kind: 'read',
      parameters: obj({ series: str({ description: '系列标识' }), specs: opt(arr(str(), { minItems: 1, maxItems: 500, description: '只看这些规格；缺省为全系列' })) }),
      description: '汇总一个系列最新版本的标准核对结论：通过、不通过、缺项各有多少项，并逐项列出不通过的项（规格、核对项、标准条款、限值与实测值）。还没有核对结果的规格列在 not_checked 里，先用 compute_series 算。',
      execute: async (params: { series: string; specs?: string[] }): Promise<CheckFailures> => {
        const current = library.seriesView(params.series);
        const chosen = current.specs.filter(spec => !params.specs || params.specs.includes(spec.id));
        if (!chosen.length) throw new StudioError({ code: 'COMPUTE_EMPTY', message: '这个系列里没有选中的规格；规格标识取自 get_series。' });
        const counts = { passed: 0, failed: 0, missing: 0, uncovered: 0 };
        const failures: CheckFailures['failures'] = [];
        const missing: CheckFailures['missing'] = [];
        const notChecked: string[] = [];
        for (const spec of chosen) {
          const check = library.specView(spec.id, spec.version).results.check;
          if (!check?.rows || check.error) { notChecked.push(spec.name); continue; }
          for (const row of check.rows as CheckRow[]) {
            if (row.verdict in counts) counts[row.verdict as keyof typeof counts] += 1;
            if (row.verdict === 'failed') {
              failures.push({ spec: spec.id, name: spec.name, title: row.title, standard: row.standard, clause: row.clause, page: row.printed_page ?? null,
                limit: row.limit, actual: row.actual, unit: row.unit, comparison: row.comparison, reason: row.reason });
            } else if (row.verdict === 'missing') {
              missing.push({ spec: spec.id, name: spec.name, title: row.title, reason: row.reason });
            }
          }
        }
        return { series: params.series, name: current.series.name, specs: chosen.length, checked: chosen.length - notChecked.length, counts, failures, missing, not_checked: notChecked };
      },
      brief: (result: CheckFailures) => ({ series: result.name, specs: result.specs, checked: result.checked, counts: result.counts, not_checked: result.not_checked,
        failures: result.failures.slice(0, 60).map(item => ({ spec: item.name, item: item.title, standard: `${item.standard} ${item.clause}${item.page ? ` 第 ${item.page} 页` : ''}`,
          limit: item.limit, actual: item.actual, unit: item.unit, comparison: item.comparison, reason: item.reason })),
        failures_not_shown: Math.max(0, result.failures.length - 60),
        missing: result.missing.slice(0, 20).map(item => ({ spec: item.name, item: item.title, reason: item.reason })) }),
      card: (params: { series: string; specs?: string[] }): CardRef => ({ kind: 'check', series: params.series, ...(params.specs ? { specs: params.specs } : {}), href: `/library/${params.series}` }),
      notes: (_params: unknown, result: CheckFailures) => [`通过 ${result.counts.passed} 项，不通过 ${result.counts.failed} 项，缺项 ${result.counts.missing} 项`,
        ...(result.not_checked.length ? [`${result.not_checked.length} 个规格还没有核对结果`] : [])] },
    { id: 'library.revise', tool: 'revise_spec', title: '修改结构', kind: 'write',
      parameters: obj({ spec: str({ description: '规格标识' }), version: opt(int({ minimum: 1, description: '基于的版本号；缺省为最新版' })),
        values: map(num({ exclusiveMinimum: 0 }), { description: '要改的结构值：键取自 get_spec 的结构表（origin 为 table 的项），数值用结构表的单位' }),
        note: str({ minLength: 1, maxLength: 400, description: '为什么改' }) }),
      description: '修改一个规格的结构尺寸（结构表的单位），生成新的草稿版本，原版本和它的结果保留不变。只能改原表已有的尺寸。这是改动，先交给工程师审阅；审阅卡里写明每个值改前改后。',
      review: async (params: { spec: string; version?: number; values: Record<string, number>; note: string }): Promise<Review> => {
        // Everything that would refuse the revision refuses it here, before a person is asked to approve it.
        const { spec } = await checkRevision(params);
        const changes: Change[] = Object.entries(params.values).map(([key, value]) => {
          const item = spec.structure.find(entry => entry.key === key)!;
          return { part: 'structure', field: key, label: item.label, before: `${compact(item.value)} ${item.unit}`, after: `${compact(value)} ${item.unit}` };
        });
        return { title: `修改结构 · ${spec.spec.name}`, version: spec.version.number,
          changes: [...changes, { part: 'structure', field: 'note', label: '修改原因', before: '—', after: params.note.trim() }] };
      },
      execute: async (params: { spec: string; version?: number; values: Record<string, number>; note: string }, context) => {
        const { spec, built } = await checkRevision(params);
        if (library.specView(params.spec).version.number !== spec.version.number) throw new StudioError({ code: 'VERSION_CHANGED', message: '计算结构期间规格已产生新版本，请重新核对后修改。' }, 409);
        const version = library.revise(params.spec, built, params.note.trim(), actor(context));
        studio.emit({ type: 'library', series_id: spec.series.id });
        return { version, view: library.specView(params.spec) };
      },
      brief: (result: { version: { number: number; review: string }; view: SpecView }) => ({ spec: result.view.spec.id, new_version: result.version.number, review: REVIEW_NAMES[result.version.review] ?? result.version.review,
        note: '新草稿还没有计算结果；原版本和它的结果保留' }),
      notes: (_params: unknown, result: { version: { number: number } }) => [`生成第 ${result.version.number} 版草稿，原版本保留`] },
    { id: 'library.review', title: '审核', kind: 'write', human_only: true,
      parameters: obj({ spec: str(), version: int({ minimum: 1 }), action: oneOf(['submit', 'return', 'approve', 'publish']), note: opt(str({ maxLength: 400 })) }),
      description: '审核步骤：提交审核、退回修改、审核通过、发布。只能由人来做。',
      execute: async (params: { spec: string; version: number; action: string; note?: string }, context) => {
        const spec = library.specView(params.spec, params.version);
        library.transition(params.spec, params.version, params.action, params.note?.trim() ?? '', actor(context));
        studio.emit({ type: 'library', series_id: spec.series.id });
        return library.specView(params.spec, params.version);
      } },
    { id: 'library.review.series', title: '整系列审核', kind: 'write', human_only: true,
      parameters: obj({ series: str(), action: oneOf(['submit', 'return', 'approve', 'publish']), note: opt(str({ maxLength: 400 })) }),
      description: '对一个系列里处在相应状态的全部规格走同一个审核步骤。只能由人来做。',
      execute: async (params: { series: string; action: string; note?: string }, context) => {
        let moved = 0;
        for (const spec of library.seriesView(params.series).specs) {
          try {
            library.transition(spec.id, spec.version, params.action, params.note?.trim() ?? '', actor(context));
            moved += 1;
          } catch (error) {
            if (!(error instanceof StudioError) || error.code !== 'REVIEW_INVALID') throw error;  // not in a state this step starts from
          }
        }
        studio.emit({ type: 'library', series_id: params.series });
        return { moved, view: view(params.series) };
      } },
    { id: 'library.review.batch', title: '审核选中规格', kind: 'write', human_only: true,
      parameters: obj({ items: arr(obj({ spec: str(), version: int({ minimum: 1 }) }), { minItems: 1, maxItems: 500 }),
        action: oneOf(['submit', 'return', 'approve', 'publish']), note: str({ minLength: 1, maxLength: 400 }) }),
      description: '仅对人确认的规格与版本执行同一步审核，记录意见；任何版本或状态变化时整批拒绝。',
      execute: async (params: { items: { spec: string; version: number }[]; action: string; note: string }, context) => {
        if (!params.note.trim()) throw new StudioError({ code: 'REVIEW_INVALID', message: '请填写审核意见。' });
        if (new Set(params.items.map(item => item.spec)).size !== params.items.length) throw new StudioError({ code: 'REVIEW_INVALID', message: '选中的规格有重复。' });
        library.db.transaction(() => {
          for (const item of params.items) {
            if (library.specView(item.spec).version.number !== item.version) throw new StudioError({ code: 'VERSION_CHANGED', message: '规格已产生新版本，请重新核对选中项。' }, 409);
            library.transition(item.spec, item.version, params.action, params.note.trim(), actor(context));
          }
        })();
        studio.emit({ type: 'library' });
        return { moved: params.items.length };
      } },
  ];
}
