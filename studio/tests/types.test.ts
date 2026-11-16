// Real use of the model-type operations over HTTP, with the real core and the sealed plugins: a specification typed
// in layer by layer next to the imported one it copies, an ampacity table kept on a specification version, the
// initial structure a standard gives, and the GB 50217 correction. The data is the People Cable Group 8.7/15 kV
// published structure table (table 3, three-core steel-tape armoured YJV22).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { type App, createApp } from '../host/server.ts';
import type { RatingTable, RatingTableCondition, SeriesCreated, SpecCreated } from '../shared/model-types.ts';
import type {
  CheckRow, LibraryJob, ProjectView, RatingRow, RunRecord, SeriesDeclaration, SeriesView, SpecificationReport, SpecView, TableInspection, ValueRow,
} from '../shared/types.ts';

const home = mkdtempSync(join(tmpdir(), 'cable-studio-model-types-'));
let app: App;
let base: string;

before(async () => {
  app = createApp({ home, runtime: null });
  await new Promise<void>(done => app.server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});

after(async () => {
  await app.close();
  rmSync(home, { recursive: true, force: true });
});

type Failure = { error?: { code: string; message: string; path?: string } };

async function call<T>(id: string, params: unknown): Promise<{ status: number; body: T & Failure }> {
  const response = await fetch(`${base}/api/ops/${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) });
  return { status: response.status, body: await response.json() as T & Failure };
}

const op = async <T>(id: string, params: unknown): Promise<T> => {
  const reply = await call<T>(id, params);
  assert.equal(reply.status, 200, JSON.stringify(reply.body));
  return reply.body;
};

async function finished(job: LibraryJob): Promise<LibraryJob> {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const latest = await op<LibraryJob | null>('library.job', {});
    if (latest && latest.id === job.id && latest.state !== 'running') return latest;
    await new Promise(done => setTimeout(done, 500));
  }
  throw new Error('计算没有在预期时间内结束');
}

const pdfText = (id: string) => execFileSync(process.env.CABLE_STUDIO_PYTHON ?? 'python', ['-c',
  'import fitz,sys; d=fitz.open(sys.argv[1]); print("\\n".join(p.get_text() for p in d))', join(home, 'specifications', id, 'specification.pdf')],
{ encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });

// The published table is imported once; every test below works from it.
const published = new Map<string, { series: string; declaration: SeriesDeclaration; view: SeriesView }>();

async function importPublished(sheet: string) {
  const sample = await op<{ upload: string; declarations: { sheet: string; series: SeriesDeclaration }[] }>('library.import.sample', {});
  const declaration = sample.declarations.find(item => item.sheet === sheet)!.series;
  const inspection = await op<TableInspection>('library.import.inspect', { upload: sample.upload, designation: declaration.designation });
  const found = inspection.sheets.find(item => item.name === sheet)!;
  const mapping = Object.fromEntries(found.columns!.filter(column => column.suggested).map(column => [column.suggested!, column.index]));
  const committed = await op<{ series: string }>('library.import.commit', { upload: sample.upload, sheet, first_data_row: found.first_data_row!, mapping, series: declaration });
  const view = await op<SeriesView>('library.series.get', { series: committed.series });
  published.set(sheet, { series: committed.series, declaration, view });
  return published.get(sheet)!;
}

const structureValues = (spec: SpecView) => Object.fromEntries(spec.structure.filter(item => item.origin === 'table').map(item => [item.key, item.value]));
const projection = (result: SpecView['results'][keyof SpecView['results']]) => (result!.rows as (CheckRow & ValueRow & RatingRow)[]).map(row => ({
  id: row.id, verdict: row.verdict, limit: row.limit, actual: row.actual, value: row.value, ampacity_a: row.ampacity_a, status: row.status }));
const entry = (spec: SpecView) => spec.derivation as unknown as Record<string, string>;
let typedSpec = '';

test('a specification typed in is the same kind of object as the imported one it copies, and gives the same results', async () => {
  const { series, declaration, view } = await importPublished('表3 YJV22');
  const target = view.specs.find(spec => spec.key === '3×240')!;
  const imported = await op<SpecView>('library.spec.get', { spec: target.id });

  // The structure of one imported size is typed, field by field, into a series made by hand.
  const created = await op<SeriesCreated>('library.series.create', {
    name: '手工填写：YJV22-8.7/15 kV 三芯', designation: declaration.designation, cores: declaration.cores, u0_v: declaration.u0_v, u_v: declaration.u_v,
    um_v: declaration.um_v ?? undefined, standards: declaration.standards, common: declaration.common, common_basis: declaration.common_basis,
    modelling: declaration.modelling });
  assert.equal(created.declaration.source?.title, '人工填写');
  assert.equal(created.description, '铜芯交联聚乙烯绝缘双钢带铠装聚氯乙烯护套电力电缆');
  const empty = await op<SeriesView>('library.series.get', { series: created.series });
  assert.deepEqual([empty.specs.length, empty.series.created_by], [0, app.studio.user]);

  const typed = await op<SpecCreated>('library.spec.create', { series: created.series, values: structureValues(imported) });
  typedSpec = typed.spec;
  const version = typed.view.version;
  assert.deepEqual([typed.version, version.number, version.review, version.note], [1, 1, 'draft', '人工填写']);
  assert.equal(version.created_by, app.studio.user);
  assert.ok(Number.isFinite(Date.parse(version.created)));
  assert.deepEqual([typed.view.derivation.kind, entry(typed.view).entry, entry(typed.view).entered_by], [imported.derivation.kind, 'manual', app.studio.user]);
  assert.match(typed.view.entry.source, /^人工填写；Cable Studio 型号库/);
  assert.equal(typed.view.events[0].action, 'created');
  assert.deepEqual([typed.view.events[0].by, typed.view.events[0].detail.entry], [app.studio.user, 'manual']);
  // The same structure, whichever way it came in: the library fingerprints the cable the methods read.
  assert.equal(typed.view.entry.content_sha256, imported.entry.content_sha256);
  assert.deepEqual(typed.view.closure, imported.closure);
  assert.ok(typed.view.structure.filter(item => item.origin === 'table').every(item => item.basis === '人工填写'));

  // Both go through the batch: the electrical parameters and the standard check come out line by line the same.
  for (const [seriesId, spec] of [[series, target.id], [created.series, typed.spec]] as const) {
    const job = await op<LibraryJob>('library.compute', { series: seriesId, specs: [spec] });
    assert.equal((await finished(job)).state, 'done');
  }
  const after = await op<SpecView>('library.spec.get', { spec: typed.spec });
  const before = await op<SpecView>('library.spec.get', { spec: target.id });
  for (const kind of ['check', 'electrical', 'short_circuit', 'rating'] as const) {
    assert.ok(after.results[kind]!.current && !after.results[kind]!.error, kind);
    assert.deepEqual(projection(after.results[kind]), projection(before.results[kind]), kind);
  }
  assert.ok((after.results.check!.rows as CheckRow[]).length >= 12);
  assert.ok(!(after.results.check!.rows as CheckRow[]).some(row => row.verdict === 'failed'));

  // What is not given is not made up, a typo is not ignored, and a size cannot be there twice.
  const missing = await call('library.spec.create', { series: created.series, values: { area: 300, conductor_diameter: 21.2 } });
  assert.deepEqual([missing.status, missing.body.error?.code], [422, 'STRUCTURE_INCOMPLETE']);
  assert.match(missing.body.error!.message, /缺.*：结构表和系列声明里都没有/);
  const typo = await call('library.spec.create', { series: created.series, values: { ...structureValues(imported), area: 300, insulation_thickess: 4.5 } });
  assert.deepEqual([typo.status, typo.body.error?.code, typo.body.error?.path], [422, 'INPUT_INVALID', '/values/insulation_thickess']);
  const again = await call('library.spec.create', { series: created.series, values: structureValues(imported) });
  assert.deepEqual([again.status, again.body.error?.code], [409, 'SPEC_EXISTS']);
  const twice = await call('library.series.create', { name: '手工填写：YJV22-8.7/15 kV 三芯', designation: 'YJV22', cores: 3, u0_v: 8700, u_v: 15000 });
  assert.deepEqual([twice.status, twice.body.error?.code], [409, 'SERIES_EXISTS']);
  assert.equal((await op<SeriesView>('library.series.get', { series: created.series })).specs.length, 1);

  // An agent may fill in a draft, and says so; it cannot take the review.
  const bigger = view.specs.find(spec => spec.key === '3×300')!;
  const drafted = await app.studio.invoke('library.spec.create', { series: created.series, values: structureValues(await op<SpecView>('library.spec.get', { spec: bigger.id })) },
    { by: 'agent' }) as SpecCreated;
  assert.deepEqual([drafted.view.version.created_by, drafted.view.version.note, drafted.view.version.review], ['Agent', 'Agent 填写（待工程师核对）', 'draft']);
  await assert.rejects(app.studio.invoke('library.review', { spec: drafted.spec, version: 1, action: 'submit' }, { by: 'agent' }), { code: 'REVIEW_FORBIDDEN' });

  // A typed specification is revised like any other: a new draft, with what the engineer said about unchanged values kept.
  const revised = await op<{ view: SpecView }>('library.revise', { spec: typed.spec, values: { oversheath_thickness: 3.3 }, note: '外护套减薄 0.1 mm' });
  assert.deepEqual([revised.view.version.number, revised.view.version.review], [2, 'draft']);
  assert.equal(revised.view.structure.find(item => item.key === 'oversheath_thickness')!.revision!.previous,
    typed.view.structure.find(item => item.key === 'oversheath_thickness')!.value);
  assert.equal(revised.view.structure.find(item => item.key === 'insulation_thickness')!.basis, '人工填写');

  // The sheet says how the structure came in, who typed it and when.
  const report = await op<SpecificationReport>('library.export', { spec: typed.spec, version: 1 });
  const text = pdfText(report.id);
  assert.match(text, /录入方式：人工填写/);
  assert.ok(text.includes(app.studio.user));
});

test('an ampacity table is kept on a specification version, each number is a run record, and each equals a single check of the same inputs', async () => {
  const { series, view } = published.get('表3 YJV22')!;
  const target = view.specs.find(spec => spec.key === '3×240')!;
  const conditions: RatingTableCondition[] = [
    { label: '直埋单回 · 0.7 m', layout: 'three_core_buried_single', depth_m: 0.7, soil_thermal_resistivity: 1.0, ambient_temperature_c: 25 },
    { layout: 'three_core_buried_single', depth_m: 1.0, soil_thermal_resistivity: 1.5, ambient_temperature_c: 20 },
    { layout: 'three_core_buried_horizontal', depth_m: 0.8, soil_thermal_resistivity: 1.2, ambient_temperature_c: 25 },
  ];
  const projects = () => op<{ id: string }[]>('project.list', {}).then(list => list.length);
  const before = await projects();

  // A condition the laying cannot hold stops everything before anything is written.
  const shallow = await call('library.rating.table', { spec: target.id, conditions: [conditions[0], { ...conditions[1], depth_m: 0.03 }] });
  assert.deepEqual([shallow.status, shallow.body.error?.code], [422, 'LAYOUT_INVALID']);
  assert.match(shallow.body.error!.message, /第 2 条条件/);
  assert.deepEqual([await projects(), await op('library.rating.tables', { spec: target.id })], [before, []]);

  const table = await op<RatingTable>('library.rating.table', { spec: target.id, title: '规格书载流量表', conditions });
  assert.deepEqual([table.rows.length, table.spec, table.version, table.by, table.title], [3, target.id, 1, app.studio.user, '规格书载流量表']);
  assert.equal(await projects(), before + 1);
  assert.deepEqual(await op<RatingTable[]>('library.rating.tables', { spec: target.id }), [table]);

  // The batch of the library computes the reference condition too: the same number.
  const job = await op<LibraryJob>('library.compute', { series, specs: [target.id], kinds: ['rating'] });
  assert.equal((await finished(job)).state, 'done');
  const batch = ((await op<SpecView>('library.spec.get', { spec: target.id })).results.rating!.rows as RatingRow[]).find(row => row.id === 'three_core_buried_single@1')!;
  assert.ok(Math.abs(batch.ampacity_a! - table.rows[0].ampacity_a!) < 1e-6);

  for (const [index, row] of table.rows.entries()) {
    assert.equal(row.status, 'succeeded');
    assert.ok(row.ampacity_a! > 300 && row.run.project === table.project);
    // The number is a number of a run record: the inputs, the method and its version are in it.
    const record = await op<RunRecord>('run.get', { project: table.project, run: row.run.run });
    assert.equal(record.summary!.ampacity!.value_a, row.ampacity_a);
    assert.deepEqual([record.inputs.cable.id, record.inputs.cable.content_sha256], [target.id, table.content_sha256]);
    assert.deepEqual([record.inputs_sha256, record.plugin_id, record.plugin_version, record.method_version, record.manifest_sha256, record.request_sha256],
      [row.run.inputs_sha256, row.run.plugin_id, row.run.plugin_version, row.run.method_version, row.run.manifest_sha256, row.run.request_sha256]);
    assert.deepEqual([record.inputs.installation.depth_m, record.inputs.conditions.soil_thermal_resistivity],
      [conditions[index].depth_m, conditions[index].soil_thermal_resistivity]);
    // The same inputs checked alone in a project of their own: the same number, from the same inputs.
    const alone = await op<ProjectView>('project.create', { name: `单算对照 ${index + 1}`, model_id: target.id });
    await op('installation.set', { project: alone.meta.id, layout: conditions[index].layout, depth_m: conditions[index].depth_m });
    await op('conditions.set', { project: alone.meta.id, soil_thermal_resistivity: conditions[index].soil_thermal_resistivity,
      ambient_temperature_c: conditions[index].ambient_temperature_c, currents_a: [0] });
    const single = await op<RunRecord>('run.rate', { project: alone.meta.id });
    assert.ok(Math.abs(single.summary!.ampacity!.value_a - row.ampacity_a!) < 1e-9, `${row.label}: ${single.summary!.ampacity!.value_a} ≠ ${row.ampacity_a}`);
    assert.equal(single.inputs_sha256, row.run.inputs_sha256);
  }
  assert.deepEqual(table.rows.map(row => row.circuits), [1, 1, 3]);
  assert.ok(table.rows[2].ampacity_a! < table.rows[0].ampacity_a!);  // three circuits side by side carry less each

  // A table belongs to the version it was computed for: the next draft of the same specification has none.
  const typedFirst = await op<RatingTable>('library.rating.table', { spec: typedSpec, version: 1, conditions: [conditions[0]] });
  assert.equal(typedFirst.version, 1);
  assert.ok(Math.abs(typedFirst.rows[0].ampacity_a! - table.rows[0].ampacity_a!) < 1e-9);  // the same structure, the same number
  assert.deepEqual([(await op<RatingTable[]>('library.rating.tables', { spec: typedSpec, version: 1 })).length,
    (await op<RatingTable[]>('library.rating.tables', { spec: typedSpec })).length], [1, 0]);
  const unknown = await call('library.rating.table', { spec: typedSpec, version: 9, conditions: [conditions[0]] });
  assert.deepEqual([unknown.status, unknown.body.error?.code], [404, 'SPEC_UNKNOWN']);

  // An agent may ask for a table; the record says who.
  const asked = await app.studio.invoke('library.rating.table', { spec: target.id, conditions: [conditions[1]] }, { by: 'agent' }) as RatingTable;
  assert.equal(asked.by, 'Agent');
  assert.equal((await op<RunRecord>('run.get', { project: asked.project, run: asked.rows[0].run.run })).by, 'agent');

  // The specification sheet carries the table, with the record of each number.
  const report = await op<SpecificationReport>('library.export', { spec: target.id, version: 1 });
  const text = pdfText(report.id).replace(/\s+/g, ' ');
  assert.match(text, /载流量表 · 规格书载流量表/);
  for (const row of table.rows) {
    assert.ok(text.includes(row.ampacity_a!.toFixed(1)), row.label);
    assert.ok(text.includes(row.run.run), row.run.run);
  }
  assert.ok(text.includes(table.project));

  // A size the method does not cover gets its refusal in the table, with the record of the refusal: no number is made up.
  const outside = view.specs.find(spec => spec.key === '3×50')!;
  const refused = await op<RatingTable>('library.rating.table', { spec: outside.id, conditions: [conditions[0]] });
  assert.deepEqual([refused.rows[0].status, refused.rows[0].ampacity_a, refused.rows[0].error?.code], ['failed', null, 'SL_FILLER_GEOMETRY_RANGE']);
  const record = await op<RunRecord>('run.get', { project: refused.project, run: refused.rows[0].run.run });
  assert.deepEqual([record.status, record.summary!.error?.code], ['failed', 'SL_FILLER_GEOMETRY_RANGE']);
  const refusedText = pdfText((await op<SpecificationReport>('library.export', { spec: outside.id, version: 1 })).id).replace(/\s+/g, ' ');
  assert.match(refusedText, /有 1 个条件被方法拒算/);
  assert.ok(refusedText.includes(refused.rows[0].run.run));
});
