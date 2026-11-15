// Operations of the product library: reading it, importing a structure table, computing and checking a
// series in the background, revising a specification, and the review steps that only a person takes.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { arr, bool, int, map, num, obj, oneOf, opt, str, union } from '@earendil-works/pi-schema';
import {
  RESULT_KINDS, type BuildResult, type BuiltRow, type ImportPreview, type LibraryEntry, type LibraryJob, type ProductResult, type ResultKind,
  type SeriesDeclaration, type SeriesView, type SpecView, type TableInspection,
} from '../shared/types.ts';
import { StudioError } from './core.ts';
import { REVIEW_STEPS } from './library.ts';
import type { Context, Operation, Studio } from './operations.ts';
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
  const file = readdirSync(dir)[0];
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
const table = { upload: str({ description: '上传文件的标识' }), sheet: str(), first_data_row: int({ minimum: 1 }),
  mapping: map(int({ minimum: 0 })) };

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

  async function preview(params: { upload: string; sheet: string; first_data_row: number; mapping: Record<string, number>; series: SeriesDeclaration }) {
    const file = uploaded(studio.home, params.upload);
    const read = await core.call<{ rows: { row: number; values: Record<string, number>; problems: { cell: string; field: string; text: string }[] }[];
      skipped: { row: number; text: string }[] }>('tables.rows', { path: file.path, sheet: params.sheet, first_data_row: params.first_data_row, mapping: params.mapping });
    if (!read.rows.length) throw new StudioError({ code: 'IMPORT_EMPTY', message: '这张表里没有找到规格行：请核对数据起始行和“标称截面”所在的列。' });
    const declaration: SeriesDeclaration = { ...params.series, source: { title: params.series.source?.title ?? file.file,
      location: params.series.source?.location ?? `工作表“${params.sheet}”`, sha256: params.series.source?.sha256 ?? file.sha256, file: file.file } };
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
    return { declaration, built, file, preview: { designation: build.designation, rows, skipped: read.skipped,
      ready: rows.filter(row => row.ok).length, failed: rows.filter(row => !row.ok).length } satisfies ImportPreview };
  }

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
    { id: 'library.job', title: '计算任务', kind: 'read', parameters: obj({}), description: '读取最近一批计算的进度，包括宿主重启前中断的任务。', execute: async () => job },
    { id: 'library.compute.cancel', title: '停止批量计算', kind: 'run', parameters: obj({ job: str() }),
      description: '当前批次完成后停止，已经保存的结果保留。', execute: async (params: { job: string }) => {
        if (!job || job.id !== params.job || job.state !== 'running') throw new StudioError({ code: 'JOB_UNKNOWN', message: '这批计算已经结束。' }, 409);
        job.cancel_requested = true;
        emitJob(job);
        return job;
      } },
    { id: 'library.documents', title: '规格书记录', kind: 'read', parameters: obj({ spec: str() }),
      description: '读取这个规格已经导出的固定版本 PDF 和来源快照。', execute: async (params: { spec: string }) => {
        library.specView(params.spec);
        return specificationReports(studio.home, params.spec);
      } },
    { id: 'library.export', title: '导出规格书', kind: 'run', parameters: obj({ spec: str(), version: int({ minimum: 1 }) }),
      description: '把指定版本的结构、已保存结果、计算条件、问题及来源保存为不可覆盖的 PDF 和快照。未审核版本标为草稿，缺项明确列出。',
      execute: async (params: { spec: string; version: number }, context) => {
        const report = await exportSpecification(studio, library.specView(params.spec, params.version), actor(context));
        studio.emit({ type: 'library' });
        return report;
      } },
    { id: 'library.series', tool: 'list_series', title: '产品系列', kind: 'read', parameters: obj({}),
      description: '列出产品库的全部系列：名称、厂家、型号、电压、执行标准、规格数和各审核状态的数量。',
      execute: async () => library.seriesList() },
    { id: 'library.series.get', tool: 'get_series', title: '读取系列', kind: 'read', parameters: obj({ series: str({ description: '系列标识，例如 s-1a2b3c4d' }) }),
      description: '读取一个系列：系列声明，以及每个规格的最新版本、外径、电阻、标准核对结论、短路容量和基准条件下的载流量。',
      execute: async (params: { series: string }) => view(params.series),
      brief: (result: SeriesView) => ({ series: result.series, reference_condition: result.reference, specs: result.specs.map(spec => ({ spec: spec.id, name: spec.name,
        review: spec.review, outer_diameter_mm: spec.outer_diameter_mm, check: spec.check, ac_resistance_ohm_km: spec.ac_resistance_ohm_km,
        short_circuit_ka: spec.short_circuit_ka, ampacity_a: spec.ampacity_a, warnings: spec.warnings.map(item => item.message) })) }) },
    { id: 'library.spec.get', tool: 'get_spec', title: '读取规格', kind: 'read',
      parameters: obj({ spec: str({ description: '规格标识' }), version: opt(int({ minimum: 1, description: '版本号；缺省为最新版' })) }),
      description: '读取一个规格的一个版本：结构表（每个值的来路）、外径闭合、标准核对逐条结论、电气参数、短路容量、载流量表、版本和审核记录。',
      execute: async (params: { spec: string; version?: number }) => library.specView(params.spec, params.version), brief: briefSpec },
    { id: 'library.vocabulary', title: '结构表字段', kind: 'read', parameters: obj({}),
      description: '结构表可以对应的字段、计算用参数及其参考取值、已保存的列对应关系和审核步骤。',
      execute: async () => ({ ...(await core.call<Record<string, unknown>>('structure.vocabulary')), mappings: library.mappings(), review_steps: REVIEW_STEPS }) },
    { id: 'library.designation', tool: 'read_designation', title: '解读型号', kind: 'read', parameters: obj({ text: str({ minLength: 1, maxLength: 120 }) }),
      description: '解读一个型号写法（如 ZC-YJV22-8.7/15 3×240）：导体、绝缘、铠装、护套、电压、芯数和截面；没有写的部分为空。',
      execute: async (params: { text: string }) => core.call('designation.parse', { text: params.text }) },
    { id: 'library.import.inspect', title: '读取结构表', kind: 'read', parameters: obj({ upload: table.upload, designation: opt(str()) }),
      description: '读取上传的结构表：每张工作表的表头、数据起始行和各列建议对应的字段。',
      execute: async (params: { upload: string; designation?: string }): Promise<TableInspection> => {
        const file = uploaded(studio.home, params.upload);
        return { upload: params.upload, ...(await core.call<Omit<TableInspection, 'upload'>>('tables.inspect', { path: file.path, designation: params.designation ?? null })) };
      } },
    { id: 'library.import.sample', title: '公开样例', kind: 'run', parameters: obj({}),
      description: '把一份公开厂家手册的结构表写成工作簿，连同导入它时需要声明的内容，用来试导入。',
      execute: async () => {
        const upload = 'u-' + randomBytes(4).toString('hex');
        mkdirSync(join(studio.home, 'uploads', upload), { recursive: true });
        const sample = await core.call<{ sheets: string[]; title: string; manufacturer: string; declarations: { sheet: string; series: SeriesDeclaration }[] }>(
          'catalogue.sample', { name: 'people_mv_xlpe', path: join(studio.home, 'uploads', upload, '人民电缆 8.7-15kV 结构表（公开手册）.xlsx') });
        return { upload, file: '人民电缆 8.7-15kV 结构表（公开手册）.xlsx', title: sample.title, manufacturer: sample.manufacturer, declarations: sample.declarations };
      } },
    { id: 'library.import.preview', title: '预览导入', kind: 'read', parameters: obj({ ...table, series }),
      description: '按列对应关系和系列声明把结构表的每一行生成规格，不保存：哪些行可用、哪些行缺什么、哪些行可疑。',
      execute: async (params: Parameters<typeof preview>[0]) => (await preview(params)).preview },
    { id: 'library.import.commit', title: '导入系列', kind: 'write',
      parameters: obj({ ...table, series, skip_failed: opt(bool()), mapping_name: opt(str({ minLength: 1, maxLength: 60 })), headers: opt(map(str())) }),
      description: '把结构表导入为一个新系列，每行成为一个规格的第 1 版草稿。',
      execute: async (params: Parameters<typeof preview>[0] & { skip_failed?: boolean; mapping_name?: string; headers?: Record<string, string> }, context) => {
        const result = await preview(params);
        if (result.preview.failed && !params.skip_failed) {
          throw new StudioError({ code: 'IMPORT_HAS_ERRORS', message: `有 ${result.preview.failed} 行不能导入；改正结构表，或选择只导入可用的行。` }, 409);
        }
        const rows = result.built.filter((row): row is Extract<BuiltRow, { ok: true }> => row.ok);
        const id = library.createSeries(result.declaration, result.preview.designation.description, rows, actor(context), result.file.file);
        if (params.mapping_name) library.saveMapping(params.mapping_name, params.mapping, params.headers ?? {}, actor(context));
        studio.emit({ type: 'library', series_id: id });
        return { series: id, imported: rows.length, left_out: result.preview.failed };
      } },
    { id: 'library.compute', tool: 'compute_series', title: '计算与核对', kind: 'run',
      parameters: obj({ series: str(), specs: opt(arr(str(), { minItems: 1, maxItems: 500 })),
        kinds: opt(arr(oneOf(RESULT_KINDS), { minItems: 1, description: 'check 标准核对；electrical 电气参数；short_circuit 短路容量；rating 载流量表' })), force: opt(bool()) }),
      description: '对一个系列（或其中几个规格）的最新版本成批运行标准核对、电气参数、短路容量和载流量表。在后台运行；已有且输入未变的结果不重算。',
      execute: async (params: { series: string; specs?: string[]; kinds?: ResultKind[]; force?: boolean }, context) => {
        if (job?.state === 'running') throw new StudioError({ code: 'JOB_RUNNING', message: '已有一批计算在进行，请等它结束。' }, 409);
        const current = library.seriesView(params.series);
        const chosen = current.specs.filter(spec => !params.specs || params.specs.includes(spec.id));
        if (!chosen.length) throw new StudioError({ code: 'COMPUTE_EMPTY', message: '没有选中任何规格。' });
        const kinds = params.kinds ?? RESULT_KINDS;
        const items = chosen.map(spec => ({ key: spec.version_id, cable: library.entry(spec.id, spec.version), standards: current.declaration.standards }));
        job = { id: 'job-' + randomBytes(4).toString('hex'), series_id: params.series, title: '准备计算', done: 0, total: items.length * kinds.length, state: 'running' };
        void run(job, items, kinds, params.force === true, actor(context));
        return job;
      } },
    { id: 'library.revise', title: '修改结构', kind: 'write',
      parameters: obj({ spec: str(), version: opt(int({ minimum: 1 })), values: map(num({ exclusiveMinimum: 0 })), note: str({ minLength: 1, maxLength: 400, description: '为什么改' }) }),
      description: '修改一个规格的结构尺寸（结构表的单位）。生成新的草稿版本，原版本保留不变。',
      execute: async (params: { spec: string; version?: number; values: Record<string, number>; note: string }, context) => {
        const spec = library.specView(params.spec);
        if (params.version !== undefined && spec.version.number !== params.version) throw new StudioError({ code: 'VERSION_CHANGED', message: '规格已产生新版本，请重新核对后修改。' }, 409);
        if (!params.note.trim()) throw new StudioError({ code: 'REVISION_INVALID', message: '请填写修改原因。' });
        if (spec.derivation.kind === 'bundled') {
          throw new StudioError({ code: 'REVISION_UNAVAILABLE', message: '随软件提供的结构没有结构表，不能改尺寸；请导入本厂结构表。' }, 409);
        }
        const editable = new Set(spec.structure.filter(item => item.origin === 'table' && item.key !== 'area').map(item => item.key));
        if (Object.keys(params.values).some(key => !editable.has(key))) throw new StudioError({ code: 'REVISION_INVALID', message: '只能修改原表已有的结构尺寸；标称截面属于规格身份，请另行导入规格。' });
        const row = { ...Object.fromEntries(spec.structure.filter(item => item.origin === 'table').map(item => [item.key, item.value])), ...params.values };
        const build = await core.call<BuildResult>('structure.build', { series: library.declaration(spec.series.id), rows: [row] });
        const built = build.rows[0];
        if (!built.ok) throw new StudioError(built.error);
        if (library.specView(params.spec).version.number !== spec.version.number) throw new StudioError({ code: 'VERSION_CHANGED', message: '计算结构期间规格已产生新版本，请重新核对后修改。' }, 409);
        const version = library.revise(params.spec, built, params.note.trim(), actor(context));
        studio.emit({ type: 'library', series_id: spec.series.id });
        return { version, view: library.specView(params.spec) };
      } },
    { id: 'library.review', title: '审核', kind: 'write',
      parameters: obj({ spec: str(), version: int({ minimum: 1 }), action: oneOf(['submit', 'return', 'approve', 'publish']), note: opt(str({ maxLength: 400 })) }),
      description: '审核步骤：提交审核、退回修改、审核通过、发布。只能由人来做。',
      execute: async (params: { spec: string; version: number; action: string; note?: string }, context) => {
        if (context.by === 'agent') throw new StudioError({ code: 'REVIEW_FORBIDDEN', message: '审核只能由人来做。' }, 403);
        const spec = library.specView(params.spec, params.version);
        library.transition(params.spec, params.version, params.action, params.note?.trim() ?? '', actor(context));
        studio.emit({ type: 'library', series_id: spec.series.id });
        return library.specView(params.spec, params.version);
      } },
    { id: 'library.review.series', title: '整系列审核', kind: 'write',
      parameters: obj({ series: str(), action: oneOf(['submit', 'return', 'approve', 'publish']), note: opt(str({ maxLength: 400 })) }),
      description: '对一个系列里处在相应状态的全部规格走同一个审核步骤。只能由人来做。',
      execute: async (params: { series: string; action: string; note?: string }, context) => {
        if (context.by === 'agent') throw new StudioError({ code: 'REVIEW_FORBIDDEN', message: '审核只能由人来做。' }, 403);
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
    { id: 'library.review.batch', title: '审核选中规格', kind: 'write',
      parameters: obj({ items: arr(obj({ spec: str(), version: int({ minimum: 1 }) }), { minItems: 1, maxItems: 500 }),
        action: oneOf(['submit', 'return', 'approve', 'publish']), note: str({ minLength: 1, maxLength: 400 }) }),
      description: '仅对人确认的规格与版本执行同一步审核，记录意见；任何版本或状态变化时整批拒绝。',
      execute: async (params: { items: { spec: string; version: number }[]; action: string; note: string }, context) => {
        if (context.by === 'agent') throw new StudioError({ code: 'REVIEW_FORBIDDEN', message: '审核只能由人来做。' }, 403);
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
