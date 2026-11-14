// Real use of the product library over HTTP: a manufacturer's published structure tables come in as a
// workbook, become series, are computed and checked in one batch, revised, and taken through review.
// The workbook is the People Cable Group 8.7/15 kV catalogue (tables 1, 2 and 3: 35 copper sizes).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { type App, createApp } from '../host/server.ts';
import type {
  CheckRow, ColumnMapping, ImportPreview, LibraryJob, ProjectView, RatingRow, RunRecord, SeriesDeclaration, SeriesSummary, SeriesView, SpecView,
  StudioEvent, TableInspection,
} from '../shared/types.ts';

const home = mkdtempSync(join(tmpdir(), 'cable-studio-library-'));
let app: App;
let base: string;
let upload: string;
const declarations = new Map<string, SeriesDeclaration>();
const series = new Map<string, string>();

before(async () => {
  app = createApp({ home, runtime: null });
  await new Promise<void>(done => app.server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});

after(async () => {
  await app.close();
  rmSync(home, { recursive: true, force: true });
});

async function call<T>(id: string, params: unknown): Promise<{ status: number; body: T & { error?: { code: string; message: string } } }> {
  const response = await fetch(`${base}/api/ops/${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) });
  return { status: response.status, body: await response.json() as T & { error?: { code: string; message: string } } };
}

const op = async <T>(id: string, params: unknown): Promise<T> => {
  const reply = await call<T>(id, params);
  assert.equal(reply.status, 200, JSON.stringify(reply.body));
  return reply.body;
};

const finished = (id: string) => new Promise<LibraryJob>(done => {
  const listen = (event: StudioEvent) => {
    if (event.type === 'library' && event.job?.id === id && event.job.state !== 'running') {
      app.studio.events.off('event', listen);
      done(event.job);
    }
  };
  app.studio.events.on('event', listen);
});

async function bring(sheet: string, extra: Record<string, unknown> = {}) {
  const declaration = declarations.get(sheet)!;
  const inspection = await op<TableInspection>('library.import.inspect', { upload, designation: declaration.designation });
  const found = inspection.sheets.find(item => item.name === sheet)!;
  const mapping = Object.fromEntries(found.columns!.filter(column => column.suggested).map(column => [column.suggested!, column.index]));
  return { found, mapping, request: { upload, sheet, first_data_row: found.first_data_row!, mapping, series: declaration, ...extra } };
}

test('the library starts with the structures that come with the software, issued', async () => {
  const list = await op<SeriesSummary[]>('library.series', {});
  const huayuan = list.find(item => item.name.includes('华远'))!;
  assert.equal(huayuan.specs, 10);
  assert.deepEqual(huayuan.states, { published: 10 });
  assert.ok(list.every(item => item.created_by === '系统'));
  const spec = await op<SpecView>('library.spec.get', { spec: 'huayuan.yjv22-15kv-240' });
  assert.equal(spec.version.review, 'published');
  assert.equal(spec.derivation.kind, 'bundled');
});

test('a workbook is uploaded as it is and its header is read', async () => {
  const sample = await op<{ upload: string; file: string; declarations: { sheet: string; series: SeriesDeclaration }[] }>('library.import.sample', {});
  for (const item of sample.declarations) declarations.set(item.sheet, item.series);
  // The same bytes go through the upload a browser would make.
  const bytes = readFileSync(join(home, 'uploads', sample.upload, readdirSync(join(home, 'uploads', sample.upload))[0]));
  const response = await fetch(`${base}/api/uploads?name=${encodeURIComponent('人民电缆结构表.xlsx')}`, { method: 'POST', body: bytes });
  const saved = await response.json() as { upload: string; file: string; size: number; sha256: string };
  assert.equal(response.status, 200);
  assert.equal(saved.size, bytes.length);
  upload = saved.upload;
  const { found, mapping } = await bring('表3 YJV22');
  assert.deepEqual([found.header_rows, found.first_data_row, found.data_rows], [[3, 4], 5, 11]);
  // Four weight columns, one per designation: only the YJV22 one is this series' weight.
  assert.deepEqual(mapping, { area: 0, conductor_diameter: 1, insulation_thickness: 2, bedding_thickness: 3, armour_tape_thickness: 4,
    oversheath_thickness: 5, outer_diameter: 6, weight: 7 });
  const refused = await fetch(`${base}/api/uploads?name=notes.docx`, { method: 'POST', body: bytes });
  assert.equal(refused.status, 415);
});

test('three published tables become three series of 35 sizes, and a suspicious row is pointed out', async () => {
  for (const sheet of ['表1 YJV', '表2 YJV', '表3 YJV22']) {
    const { request, found } = await bring(sheet, sheet === '表3 YJV22' ? { mapping_name: '人民电缆手册版式',
      headers: Object.fromEntries(found.columns!.filter(column => column.suggested).map(column => [column.suggested!, column.header])) } : {});
    const preview = await op<ImportPreview>('library.import.preview', request);
    assert.equal(preview.failed, 0);
    if (sheet === '表1 YJV') {
      const flagged = preview.rows.filter(row => row.warnings.length);
      assert.deepEqual(flagged.map(row => row.key), ['1×185']);  // the catalogue prints 36 mm for both 1×185 and 1×240
      assert.match(flagged[0].warnings[0].message, /请核对这一行的外径或层厚/);
    }
    const committed = await op<{ series: string; imported: number }>('library.import.commit', request);
    assert.equal(committed.imported, found.data_rows);
    series.set(sheet, committed.series);
  }
  const list = await op<SeriesSummary[]>('library.series', {});
  const mine = list.filter(item => [...series.values()].includes(item.id));
  assert.equal(mine.reduce((sum, item) => sum + item.specs, 0), 35);
  assert.ok(mine.every(item => item.states.draft === item.specs && item.created_by === app.studio.user));
  assert.equal(mine.find(item => item.id === series.get('表3 YJV22'))!.description, '铜芯交联聚乙烯绝缘双钢带铠装聚氯乙烯护套电力电缆');
  // The same table cannot come in twice under the same name.
  const again = await call('library.import.commit', (await bring('表3 YJV22')).request);
  assert.equal(again.status, 409);
  assert.equal(again.body.error?.code, 'SERIES_EXISTS');
  const vocabulary = await op<{ mappings: ColumnMapping[] }>('library.vocabulary', {});
  assert.deepEqual(vocabulary.mappings.map(item => item.name), ['人民电缆手册版式']);
  assert.equal(vocabulary.mappings[0].headers.armour_tape_thickness, '钢带厚度 mm');
});

test('a row that cannot be built is left out only when the engineer says so', async () => {
  const { request } = await bring('表2 YJV');
  const declaration = { ...request.series, name: '缺声明的系列', common: { ...request.series.common } };
  delete declaration.common.insulation_screen_thickness;
  const preview = await op<ImportPreview>('library.import.preview', { ...request, series: declaration });
  assert.equal(preview.ready, 0);
  assert.match(preview.rows[0].error!.message, /绝缘屏蔽厚度/);
  const refused = await call('library.import.commit', { ...request, series: declaration });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error?.code, 'IMPORT_HAS_ERRORS');
});

test('a series is computed and checked in one batch, and the batch gives what a single calculation gives', async () => {
  const id = series.get('表3 YJV22')!;
  const job = await op<LibraryJob>('library.compute', { series: id });
  assert.equal(job.total, 44);
  const busy = await call('library.compute', { series: id });
  assert.equal(busy.body.error?.code, 'JOB_RUNNING');
  const done = await finished(job.id);
  assert.deepEqual([done.state, done.done], ['done', 44]);
  const view = await op<SeriesView>('library.series.get', { series: id });
  assert.deepEqual(view.reference, { id: 'three_core_buried_single@1', layout: 'three_core_buried_single', depth_m: .7, ambient_temperature_c: 25, soil_thermal_resistivity: 1 });
  for (const spec of view.specs) {
    assert.deepEqual(spec.computed, { check: 'done', electrical: 'done', short_circuit: 'done', rating: 'done' }, spec.name);
    assert.ok(spec.check!.passed >= 12 && !spec.check!.failed, spec.name);
    assert.ok(spec.ac_resistance_ohm_km! > spec.r20_ohm_km! * 1.27 && spec.short_circuit_ka! > 0 && spec.ampacity_a! > 0, spec.name);
  }
  // Larger conductors carry more and withstand more.
  assert.deepEqual(view.specs.map(spec => spec.ampacity_a), [...view.specs.map(spec => spec.ampacity_a)].sort((a, b) => a! - b!));
  const target = view.specs.find(spec => spec.key === '3×240')!;
  assert.ok(Math.abs(target.short_circuit_ka! - 34.34) < .05);
  // The same product, the same laying, one calculation in a project: the same current.
  const project = await op<ProjectView>('project.create', { name: '成批与单算对照', model_id: target.id });
  await op('installation.set', { project: project.meta.id, depth_m: .7 });
  await op('conditions.set', { project: project.meta.id, soil_thermal_resistivity: 1.0, ambient_temperature_c: 25, current_a: 0 });
  const single = await op<RunRecord>('run.rate', { project: project.meta.id });
  assert.ok(Math.abs(single.summary!.ampacity!.value_a - target.ampacity_a!) < 1e-6);
  // Nothing is computed twice while the inputs stand.
  const repeat = await op<LibraryJob>('library.compute', { series: id });
  const quick = await finished(repeat.id);
  assert.equal(quick.done, 44);
  const detail = await op<SpecView>('library.spec.get', { spec: target.id });
  const rating = detail.results.rating!;
  assert.equal(rating.rows!.length, 12);
  const buried = (rating.rows as RatingRow[]).filter(row => row.id.startsWith('three_core_buried_single@')).map(row => row.ampacity_a!);
  assert.deepEqual(buried, [...buried].sort((a, b) => b - a));  // drier soil, less current
  assert.equal(detail.results.check!.method!.plugin_id, 'cablesim.standard-check');
  assert.ok(detail.results.check!.current && detail.results.rating!.current);
});

test('a thinner insulation is a new draft that fails the declared standard at its clause', async () => {
  const view = await op<SeriesView>('library.series.get', { series: series.get('表3 YJV22')! });
  const target = view.specs.find(spec => spec.key === '3×240')!;
  const revised = await op<{ view: SpecView }>('library.revise', { spec: target.id, values: { insulation_thickness: 4.0 }, note: '客户要求减薄绝缘，先看是否合规' });
  assert.deepEqual([revised.view.version.number, revised.view.version.review], [2, 'draft']);
  assert.equal(revised.view.structure.find(item => item.key === 'insulation_thickness')!.value, 4);
  const job = await op<LibraryJob>('library.compute', { series: series.get('表3 YJV22')!, specs: [target.id], kinds: ['check'] });
  await finished(job.id);
  const second = await op<SpecView>('library.spec.get', { spec: target.id });
  const failed = (second.results.check!.rows as CheckRow[]).filter(row => row.verdict === 'failed');
  assert.equal(failed.length, 3);
  for (const row of failed) {
    assert.deepEqual([row.standard, row.clause, row.limit, row.actual], ['GB/T 12706.2—2020', '表 7', 4.5, 4]);
    assert.equal(row.pdf_page, 15);
  }
  // The version before it is untouched and still passes.
  const first = await op<SpecView>('library.spec.get', { spec: target.id, version: 1 });
  assert.equal(first.structure.find(item => item.key === 'insulation_thickness')!.value, 4.5);
  assert.ok(!(first.results.check!.rows as CheckRow[]).some(row => row.verdict === 'failed'));
  const same = await call('library.revise', { spec: target.id, values: { insulation_thickness: 4.0 }, note: '重复' });
  assert.equal(same.body.error?.code, 'REVISION_UNCHANGED');
  const thick = await call('library.revise', { spec: target.id, values: { oversheath_thickness: 9 }, note: '护套写错' });
  assert.equal(thick.body.error?.code, 'RADIAL_DIMENSIONS_CONFLICT');
});

test('review is taken step by step by a person and leaves a record', async () => {
  const view = await op<SeriesView>('library.series.get', { series: series.get('表3 YJV22')! });
  const target = view.specs.find(spec => spec.key === '3×25')!;
  const early = await call('library.review', { spec: target.id, version: 1, action: 'publish' });
  assert.deepEqual([early.status, early.body.error?.code], [409, 'REVIEW_INVALID']);
  await assert.rejects(app.studio.invoke('library.review', { spec: target.id, version: 1, action: 'submit' }, { by: 'agent' }), { code: 'REVIEW_FORBIDDEN' });
  for (const [action, state] of [['submit', 'submitted'], ['approve', 'reviewed'], ['publish', 'published']]) {
    const moved = await op<SpecView>('library.review', { spec: target.id, version: 1, action, note: action === 'approve' ? '尺寸与目录一致' : undefined });
    assert.equal(moved.version.review, state);
  }
  const issued = await op<SpecView>('library.spec.get', { spec: target.id });
  assert.deepEqual([issued.version.submitted_by, issued.version.reviewed_by, issued.version.published_by], Array(3).fill(app.studio.user));
  assert.deepEqual(issued.events.map(event => event.action), ['publish', 'approve', 'submit']);
  assert.equal(issued.events[1].detail.note, '尺寸与目录一致');
  const back = await call('library.review', { spec: target.id, version: 1, action: 'return' });
  assert.equal(back.body.error?.code, 'REVIEW_INVALID');  // what is issued is not taken back; a change is a new version
  const whole = await op<{ moved: number }>('library.review.series', { series: series.get('表3 YJV22')!, action: 'submit' });
  assert.equal(whole.moved, 10);  // the ten sizes still in draft, the revised 3×240 among them
});
