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
import { digest } from '../host/store.ts';
import type { CorrectionPending, Gb50217Correction, RatingTable, RatingTableCondition, SeriesCreated, SpecCreated, StructureProposal } from '../shared/model-types.ts';
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

  // A series that does not bring its own calculation parameters is not given made-up ones. The one number the closure of the outer diameter
  // cannot do without, the precision the diameters are written to, is asked for rather than picked; and a parameter that is misspelt is not ignored.
  const unsaid = await call('library.series.create', { name: '手工填写：只有型号', designation: 'YJV22', cores: 3, u0_v: 8700, u_v: 15000 });
  assert.deepEqual([unsaid.status, unsaid.body.error?.code, unsaid.body.error?.path], [422, 'INPUT_INVALID', '/outer_diameter_precision_mm']);
  const bare = await op<SeriesCreated>('library.series.create', { name: '手工填写：只有型号', designation: 'YJV22', cores: 3, u0_v: 8700, u_v: 15000, outer_diameter_precision_mm: 0.1 });
  assert.deepEqual(Object.keys(bare.declaration.modelling), ['diameter_rounding']);
  assert.equal(bare.declaration.modelling.diameter_rounding.value, 0.00005);
  const misspelt = await call('library.series.create', { name: '手工填写：拼错', designation: 'YJV22', cores: 3, u0_v: 8700, u_v: 15000, outer_diameter_precision_mm: 0.1,
    modelling: { filler_rhoo: { value: 6, unit: 'K*m/W', reference: '拼错的参数' } } });
  assert.deepEqual([misspelt.status, misspelt.body.error?.code, misspelt.body.error?.path], [422, 'SERIES_INVALID', '/series/modelling/filler_rhoo']);
  const referenced = await op<SeriesCreated>('library.series.create', { name: '手工填写：参考参数', designation: declaration.designation, cores: 3, u0_v: 8700, u_v: 15000,
    standards: declaration.standards, common: declaration.common, common_basis: declaration.common_basis, reference_modelling: true, outer_diameter_precision_mm: 1 });
  assert.deepEqual(Object.keys(referenced.declaration.modelling).sort(), Object.keys(declaration.modelling).sort());
  assert.ok(Object.values(referenced.declaration.modelling).every(item => item.reference));
  assert.equal(referenced.declaration.modelling.diameter_rounding.value, declaration.modelling.diameter_rounding.value);
  // And those reference parameters build the very structure the imported declaration does.
  const viaReference = await op<SpecCreated>('library.spec.create', { series: referenced.series, values: structureValues(imported) });
  assert.equal(viaReference.view.entry.content_sha256, imported.entry.content_sha256);

  // What an agent proposes waits for a person, who is shown what would be made. It comes from the same builder, and nothing is written to show it.
  const shown = (id: string, params: unknown) => (app.studio.operations.get(id) as unknown as {
    review(params: unknown): Promise<{ title: string; changes: { label: string; before: string; after: string }[] }> }).review(params);
  const seriesShown = await shown('library.series.create', { name: '审阅用系列', designation: 'YJV22', cores: 3, u0_v: 8700, u_v: 15000, standards: declaration.standards, outer_diameter_precision_mm: 0.1 });
  assert.deepEqual([seriesShown.title, seriesShown.changes.map(item => item.label)], ['新建系列', ['新系列', '芯数与电压', '执行标准', '计算用参数', '来源']]);
  assert.equal((await op<{ name: string }[]>('library.series', {})).some(item => item.name === '审阅用系列'), false);
  await assert.rejects(shown('library.series.create', { name: created.name, designation: 'YJV22', cores: 3, u0_v: 8700, u_v: 15000, outer_diameter_precision_mm: 0.1 }), { code: 'SERIES_EXISTS' });
  const specShown = await shown('library.spec.create', { series: created.series, values: structureValues(imported) });
  assert.match(specShown.title, /3×240/);
  assert.deepEqual(specShown.changes.find(item => item.label === '绝缘标称厚度'), { part: 'structure', field: 'insulation_thickness', label: '绝缘标称厚度', before: '—', after: '4.5 mm' });
  assert.equal((await op<SeriesView>('library.series.get', { series: created.series })).specs.length, 0);
  await assert.rejects(shown('library.spec.create', { series: created.series, values: { area: 300 } }), { code: 'STRUCTURE_INCOMPLETE' });

  const typed = await op<SpecCreated>('library.spec.create', { series: created.series, values: structureValues(imported) });
  typedSpec = typed.spec;
  await assert.rejects(shown('library.spec.create', { series: created.series, values: structureValues(imported) }), { code: 'SPEC_EXISTS' });
  const version = typed.view.version;
  assert.deepEqual([typed.version, version.number, version.review, version.note], [1, 1, 'draft', '人工填写']);
  assert.equal(version.created_by, app.studio.user);
  assert.ok(Number.isFinite(Date.parse(version.created)));
  assert.deepEqual([typed.view.derivation.kind, entry(typed.view).entry, entry(typed.view).entered_by, entry(typed.view).entered_how],
    [imported.derivation.kind, 'manual', app.studio.user, '人工填写']);
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
  const twice = await call('library.series.create', { name: '手工填写：YJV22-8.7/15 kV 三芯', designation: 'YJV22', cores: 3, u0_v: 8700, u_v: 15000, outer_diameter_precision_mm: 0.1 });
  assert.deepEqual([twice.status, twice.body.error?.code], [409, 'SERIES_EXISTS']);
  assert.equal((await op<SeriesView>('library.series.get', { series: created.series })).specs.length, 1);

  // An agent may fill in a draft, and says so; it cannot take the review.
  const bigger = view.specs.find(spec => spec.key === '3×300')!;
  const drafted = await app.studio.invoke('library.spec.create', { series: created.series, values: structureValues(await op<SpecView>('library.spec.get', { spec: bigger.id })) },
    { by: 'agent' }) as SpecCreated;
  assert.deepEqual([drafted.view.version.created_by, drafted.view.version.note, drafted.view.version.review], ['Agent', 'Agent 填写（待工程师核对）', 'draft']);
  assert.equal(entry(drafted.view).entered_how, 'Agent 填写（待工程师核对）');
  await assert.rejects(app.studio.invoke('library.review', { spec: drafted.spec, version: 1, action: 'submit' }, { by: 'agent' }), { code: 'REVIEW_FORBIDDEN' });
  const agentSeries = await app.studio.invoke('library.series.create', { name: 'Agent 建的系列', designation: 'YJV22', cores: 3, u0_v: 8700, u_v: 15000, outer_diameter_precision_mm: 0.1 },
    { by: 'agent' }) as SeriesCreated;
  assert.deepEqual([agentSeries.declaration.source?.title, (await op<SeriesView>('library.series.get', { series: agentSeries.series })).series.created_by],
    ['Agent 填写（待工程师核对）', 'Agent']);

  // A typed specification is revised like any other: a new draft. It stays a typed one (who typed it, when, and the source line of that entry),
  // and what the engineer said about a value is kept: on the value while it stays, on the revision once it is changed.
  const revised = await op<{ view: SpecView }>('library.revise', { spec: typed.spec, values: { oversheath_thickness: 3.3 }, note: '外护套减薄 0.1 mm' });
  assert.deepEqual([revised.view.version.number, revised.view.version.review], [2, 'draft']);
  const changed = revised.view.structure.find(item => item.key === 'oversheath_thickness')!;
  assert.equal(changed.revision!.previous, typed.view.structure.find(item => item.key === 'oversheath_thickness')!.value);
  assert.equal((changed.revision as unknown as { previous_basis: string }).previous_basis, '人工填写');
  assert.equal(revised.view.structure.find(item => item.key === 'insulation_thickness')!.basis, '人工填写');
  assert.deepEqual([entry(revised.view).entry, entry(revised.view).entered_by, entry(revised.view).entered_at], ['manual', app.studio.user, entry(typed.view).entered_at]);
  assert.equal(revised.view.entry.source, typed.view.entry.source);

  // The sheet says how the structure came in, who typed it and when, and that is the source it names: a file the series was imported from is not.
  const report = await op<SpecificationReport>('library.export', { spec: typed.spec, version: 1 });
  const text = pdfText(report.id).replace(/\s+/g, ' ');
  assert.match(text, new RegExp(`录入方式：人工填写；填写人 ${app.studio.user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}；填写时间`));
  assert.match(text, /资料：人工填写；Cable Studio 型号库/);
  const revisedText = pdfText((await op<SpecificationReport>('library.export', { spec: typed.spec, version: 2 })).id).replace(/\s+/g, ' ');
  assert.match(revisedText, /录入方式：人工填写/);
  assert.match(revisedText, /原始依据：结构表；人工填写/);

  // Typed into a series that was imported, the sheet does not claim the imported file as its source; and the series-wide look at a typing slip
  // (a weight lighter than the smaller size's) still applies to the typed row, as it does to an imported table.
  const big = await op<SpecView>('library.spec.get', { spec: view.specs.find(spec => spec.key === '3×400')!.id });
  const slip = { ...structureValues(big), area: 500, weight: structureValues(big).weight - 1000 };
  const inSeries = await op<SpecCreated>('library.spec.create', { series, values: slip });
  assert.ok(inSeries.view.warnings.some(item => item.code === 'WEIGHT_ORDER'), JSON.stringify(inSeries.view.warnings));
  const inText = pdfText((await op<SpecificationReport>('library.export', { spec: inSeries.spec, version: 1 })).id).replace(/\s+/g, ' ');
  assert.ok(!inText.includes(declaration.source!.sha256!.slice(0, 16)));
  assert.match(inText, /资料：人工填写；Cable Studio 型号库/);
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

  // A laying with a backfill region has no place in the table for the region's size and resistivity: refused, not tabulated without them.
  const backfilled = await call('library.rating.table', { spec: 'system.cu-xlpe-al-240',
    conditions: [{ layout: 'backfill', depth_m: 1.0, soil_thermal_resistivity: 1.0, ambient_temperature_c: 25 }] });
  assert.deepEqual([backfilled.status, backfilled.body.error?.code], [422, 'CONDITION_UNSUPPORTED']);

  // A table added after the review is marked as such on the sheet: the review did not cover it.
  const small = view.specs.find(spec => spec.key === '3×25')!;
  for (const action of ['submit', 'approve']) await op('library.review', { spec: small.id, version: 1, action, note: action === 'approve' ? '尺寸与目录一致' : undefined });
  await op<RatingTable>('library.rating.table', { spec: small.id, conditions: [conditions[0]] });
  const laterText = pdfText((await op<SpecificationReport>('library.export', { spec: small.id, version: 1 })).id).replace(/\s+/g, ' ');
  assert.match(laterText, /本表在版本审核（.*）之后追加，审核不覆盖这张表/);
});

test('the initial structure a standard gives becomes a draft specification whose thickness checks do not fail', async () => {
  const { declaration, view } = published.get('表3 YJV22')!;
  const imported = await op<SpecView>('library.spec.get', { spec: view.specs.find(spec => spec.key === '3×240')!.id });
  const printed = structureValues(imported);
  const inputs = { standard: 'GB/T 12706.2-2020', u0_v: 8700, u_v: 15000, cores: 3, conductor: 'copper', area_mm2: 240, insulation: 'XLPE', armour: 'steel_tape' };
  const screens = { screened: true, conductor_screen_thickness_mm: 0.8, insulation_screen_thickness_mm: 0.7, screen_tape_thickness_mm: 0.1, screen_tape_width_mm: 40 };

  // Only the six things the standard needs: the insulation, from its table, with the pages; everything else is listed as still to give.
  const first = await op<StructureProposal>('structure.propose', inputs);
  assert.equal(first.scope, 'insulation');
  assert.deepEqual(first.values, { insulation_thickness: printed.insulation_thickness });  // the number the published table prints
  assert.deepEqual(first.dimensions[0].source, { ...first.dimensions[0].source, kind: 'standard', standard: 'GB/T 12706.2—2020', clause: '表 7', printed_page: 7, pdf_page: 15 });
  assert.ok(first.missing.some(item => item.field === 'oversheath_thickness'));
  const wrong = await call('structure.propose', { ...inputs, standard: 'GB/T 12706.3-2020' });
  assert.deepEqual([wrong.status, wrong.body.error?.code], [422, 'STANDARD_MISMATCH']);
  const other = await call('structure.propose', { ...inputs, insulation: 'PVC' });
  assert.deepEqual([other.status, other.body.error?.code, other.body.error?.path], [422, 'INPUT_INVALID', '/insulation']);

  // With the screens the engineer states, the standard's annex gives the bedding, the armour tape and the oversheath.
  const proposal = await op<StructureProposal>('structure.propose', { ...inputs, ...screens });
  assert.equal(proposal.scope, 'complete');
  for (const field of ['insulation_thickness', 'bedding_thickness', 'armour_tape_thickness', 'oversheath_thickness']) {
    const source = proposal.dimensions.find(item => item.field === field)!.source;
    assert.ok(source.standard === 'GB/T 12706.2—2020' && source.clause && source.printed_page && source.pdf_page, field);
  }
  assert.deepEqual(proposal.missing.map(item => item.field), ['conductor_diameter', 'outer_diameter']);

  // The conductor and the finished outer diameter are the engineer's: here the published table's. The rest is the proposal's, with its sources.
  const created = await op<SeriesCreated>('library.series.create', { name: '按标准生成：YJV22-8.7/15 kV 三芯', designation: declaration.designation, cores: 3,
    u0_v: 8700, u_v: 15000, standards: declaration.standards, common: { binder_thickness: 0.2, armour_tape_width: 50 },
    common_basis: { binder_thickness: '取同电压等级公开结构表的包带厚度', armour_tape_width: '钢带损耗按间隙率计，结果与带宽无关' }, modelling: declaration.modelling });
  const values = { area: 240, conductor_diameter: printed.conductor_diameter, outer_diameter: printed.outer_diameter, ...proposal.values };
  assert.match(proposal.id, /^prop-[0-9a-f]{12}$/);
  assert.notEqual(proposal.id, first.id);
  assert.deepEqual(await op('structure.proposal', { proposal: proposal.id }), proposal);
  // The standard's citation belongs to the standard's number: another number cannot carry it, and a proposal that is not there is not made up.
  const altered = await call('library.spec.create', { series: created.series, proposal: proposal.id, values: { ...values, oversheath_thickness: 3.0 } });
  assert.deepEqual([altered.status, altered.body.error?.code, altered.body.error?.path], [422, 'PROPOSAL_VALUE_CHANGED', '/values/oversheath_thickness']);
  const reworded = await call('library.spec.create', { series: created.series, proposal: proposal.id, values, basis: { insulation_thickness: '另写的依据' } });
  assert.deepEqual([reworded.status, reworded.body.error?.code], [422, 'PROPOSAL_BASIS_GIVEN']);
  const missingProposal = await call('library.spec.create', { series: created.series, proposal: 'prop-000000000000', values });
  assert.deepEqual([missingProposal.status, missingProposal.body.error?.code], [404, 'PROPOSAL_UNKNOWN']);
  assert.equal((await op<SeriesView>('library.series.get', { series: created.series })).specs.length, 0);

  const typed = await op<SpecCreated>('library.spec.create', { series: created.series, proposal: proposal.id, values });
  const thickness = typed.view.structure.find(item => item.key === 'insulation_thickness')!;
  assert.deepEqual([thickness.value, thickness.basis], [4.5, '人工填写；GB/T 12706.2—2020 表 7（印刷第 7 页，PDF 第 15 页）']);
  // The version says which proposal its dimensions were taken from and the method and version that gave it.
  const taken = (typed.view.derivation as unknown as { proposal: { id: string; fields: string[]; method: { plugin_id: string; plugin_version: string; request_sha256: string } } }).proposal;
  assert.deepEqual([taken.id, taken.method.plugin_id, taken.method.plugin_version, taken.method.request_sha256],
    [proposal.id, proposal.method.plugin_id, proposal.method.plugin_version, proposal.method.request_sha256]);
  assert.ok(['insulation_thickness', 'bedding_thickness', 'armour_tape_thickness', 'oversheath_thickness'].every(field => taken.fields.includes(field)));
  assert.ok(pdfText((await op<SpecificationReport>('library.export', { spec: typed.spec, version: 1 })).id).replace(/\s+/g, '').includes(`取用的标准提案${proposal.id}`));

  // The check of the standard: no thickness requirement fails for the structure the standard itself gave.
  assert.equal((await finished(await op<LibraryJob>('library.compute', { series: created.series, kinds: ['check'] }))).state, 'done');
  const checked = (await op<SpecView>('library.spec.get', { spec: typed.spec })).results.check!;
  assert.ok(!checked.error && checked.current);
  const rows = checked.rows as CheckRow[];
  const thicknesses = rows.filter(row => /nominal$/.test(row.id));
  assert.ok(thicknesses.length >= 5, rows.map(row => row.id).join(', '));
  // Every thickness the check can judge passes. The three that follow from the annex's diameter chain (bedding, armour tape, oversheath)
  // are left unjudged for any three-core structure that has a filler wrapping, imported or typed alike: not failed, but not passed either.
  const judged = thicknesses.filter(row => row.verdict !== 'uncovered');
  assert.ok(judged.length >= 4);
  assert.deepEqual(judged.filter(row => row.verdict !== 'passed').map(row => `${row.id}:${row.verdict}`), []);
  assert.deepEqual(thicknesses.filter(row => row.verdict === 'uncovered').map(row => row.id.split(':')[1]), ['bedding-nominal', 'armour-tape-nominal', 'oversheath-nominal']);
  assert.ok(!rows.some(row => row.verdict === 'failed'));
  assert.deepEqual(checked.summary!.count, (await op<SpecView>('library.spec.get', { spec: view.specs.find(spec => spec.key === '3×240')!.id })).results.check!.summary!.count);

  // The tools an agent gets: every new operation has a name, a title and a sentence, and takes the project its call carries.
  const added = ['library.series.create', 'library.spec.create', 'library.rating.table', 'library.rating.tables', 'structure.propose', 'structure.proposal',
    'correction.gb50217', 'correction.list', 'correction.get'].map(id => app.studio.operations.get(id)!);
  const tools = [...app.studio.operations.values()].map(item => item.tool).filter(Boolean);
  assert.equal(new Set(tools).size, tools.length);
  for (const item of added) {
    assert.ok(item.tool && /^[a-z][a-z0-9_]*$/.test(item.tool) && /[一-鿿]/.test(item.title) && /[一-鿿]/.test(item.description), item.id);
    // Only what works on a project asks for one.
    assert.equal('project' in (item.parameters.properties as object), item.id.startsWith('correction.'), item.id);
  }
  // A write an agent proposes has something to show a person: it is a draft, never an approval.
  assert.ok(added.filter(item => item.kind === 'write').every(item => 'review' in item), 'write operations');
});

test('the GB 50217 correction gives its factors and the corrected current, and the baseline stays for a person to confirm', async () => {
  const { view } = published.get('表3 YJV22')!;
  const target = view.specs.find(spec => spec.key === '3×240')!;
  const project = (await op<ProjectView>('project.create', { name: 'GB 50217 校正', model_id: target.id })).meta.id;

  // The baseline: one circuit alone at the annex's base 25 °C, in a system of 10 kV (the annex stops there).
  await op('installation.set', { project, layout: 'three_core_buried_single', depth_m: 0.7 });
  await op('conditions.set', { project, soil_thermal_resistivity: 1.0, ambient_temperature_c: 25, system_voltage_v: 10000, currents_a: [0] });
  const baseline = await op<RunRecord>('run.rate', { project });
  const base = baseline.summary!.ampacity!.value_a;
  assert.equal(baseline.summary!.ampacity!.basis, 'single_circuit');
  const diameter = baseline.inputs.cable.summary.outer_diameter_m;

  // The actual conditions: 30 °C, and three circuits side by side with 0.1 m clear between them.
  await op('installation.set', { project, layout: 'three_core_buried_horizontal', spacing_m: diameter + 0.1 });
  await op('conditions.set', { project, ambient_temperature_c: 30, currents_a: [300] });
  const confirmed = { project, baseline_run: baseline.id, baseline_confirmed: true };

  // Until a person confirms the baseline there is no number, only what the software could check; an agent cannot confirm.
  const pending = await op<CorrectionPending>('correction.gb50217', { project, baseline_run: baseline.id });
  assert.equal(pending.needs_confirmation, true);
  assert.ok(pending.checks.length >= 8 && pending.checks.every(item => item.passed));
  assert.equal(pending.baseline.ampacity_a, base);
  assert.ok(!('corrected_current_a' in pending));
  const asked = await app.studio.invoke('correction.gb50217', { project, baseline_run: baseline.id }, { by: 'agent' }) as CorrectionPending;
  assert.equal(asked.needs_confirmation, true);
  await assert.rejects(app.studio.invoke('correction.gb50217', confirmed, { by: 'agent' }), { code: 'REVIEW_FORBIDDEN' });
  assert.deepEqual(await op('correction.list', { project }), []);

  // The hand products of the plugin's own test: D.0.1 soil 30 °C at a 90 °C limit is 0.96 (page 72), D.0.4 three cables 0.1 m clear is 0.85 (page 73).
  const done = await op<Gb50217Correction>('correction.gb50217', confirmed);
  assert.deepEqual(done.coefficients.map(item => [item.factor, item.clause, item.printed_page]), [[0.96, 'D.0.1', 72], [0.85, 'D.0.4', 73]]);
  assert.ok(done.coefficients.every(item => item.standard === 'GB 50217—2018' && item.source_sha256.length === 64));
  assert.ok(Math.abs(done.total_factor - 0.96 * 0.85) < 1e-12);
  assert.ok(Math.abs(done.corrected_current_a - base * 0.96 * 0.85) < 1e-9);
  assert.deepEqual([done.method_card.tier.tier, done.method_card.validation.level, done.by, done.confirmed_by], ['reference', 'analytic-benchmark', 'human', app.studio.user]);
  // Everything it stands on is in the record: the baseline run, the actual inputs, the method and its version.
  assert.deepEqual([done.baseline.run, done.baseline.record_digest, done.inputs_sha256], [baseline.id, digest(baseline), (await app.studio.view(project)).inputs_sha256]);
  assert.deepEqual([done.plugin_id, done.capability], ['cablesim.gb50217-correction', 'steady-rating']);
  assert.equal((done.request.cases[0].parameters as { baseline_current_a: number }).baseline_current_a, base);
  assert.deepEqual(await op('correction.get', { project, correction: done.id }), done);
  assert.deepEqual((await op<{ id: string }[]>('correction.list', { project })).map(item => item.id), [done.id]);

  // Another ambient temperature is the standard's formula (D.0.2), not an interpolation of the table.
  await op('installation.set', { project, layout: 'three_core_buried_single' });
  await op('conditions.set', { project, ambient_temperature_c: 27 });
  const formula = await op<Gb50217Correction>('correction.gb50217', confirmed);
  assert.ok(Math.abs(formula.total_factor - Math.sqrt(63 / 65)) < 1e-12);
  const inputs = formula.coefficients[0].formula_inputs!;
  assert.deepEqual([formula.coefficients[0].clause, inputs.theta_m_k, inputs.theta_1_k], ['D.0.2', 363.15, 298.15]);
  assert.ok(Math.abs(inputs.theta_2_k - 300.15) < 1e-9);  // the actual 27 °C, which the project states and the formula takes from it

  // What the table does not hold is refused, with the field that needs another value: 0.15 m clear lies between 0.1 and 0.2.
  await op('installation.set', { project, layout: 'three_core_buried_horizontal', spacing_m: diameter + 0.15 });
  const between = await call('correction.gb50217', confirmed);
  assert.deepEqual([between.status, between.body.error?.code, between.body.error?.path], [422, 'CORRECTION_TABLE_NOT_COVERED', '/input/sections/0/placements']);
  // The annex stops at 10 kV. With the actual system at 15 kV the baseline of a 10 kV system is no longer the same one, and the software says so;
  // a baseline of its own at 15 kV passes the software's checks and is refused by the method, at the field that needs another value.
  await op('installation.set', { project, layout: 'three_core_buried_single' });
  await op('conditions.set', { project, system_voltage_v: 15000 });
  const differs = await op<CorrectionPending>('correction.gb50217', { project, baseline_run: baseline.id });
  assert.ok(differs.checks.some(item => !item.passed && /系统电压/.test(item.item)));
  await op('conditions.set', { project, ambient_temperature_c: 25, currents_a: [0] });
  const baseline15 = await op<RunRecord>('run.rate', { project });
  await op('conditions.set', { project, ambient_temperature_c: 30 });
  const high = await call('correction.gb50217', { project, baseline_run: baseline15.id, baseline_confirmed: true });
  assert.deepEqual([high.status, high.body.error?.path], [422, '/input/circuits/0/system/voltage']);

  // A baseline of another cable is not this cable's: the software says so, whoever confirms.
  await op('cable.set', { project, model_id: view.specs.find(spec => spec.key === '3×300')!.id });
  const other = await op<CorrectionPending>('correction.gb50217', { project, baseline_run: baseline.id });
  assert.ok(other.checks.some(item => !item.passed && /同一款型号/.test(item.item)) && /不符/.test(other.message));
  const refused = await call('correction.gb50217', confirmed);
  assert.deepEqual([refused.status, refused.body.error?.code], [422, 'BASELINE_INVALID']);
  assert.equal((await op<unknown[]>('correction.list', { project })).length, 2);  // only the two that were computed
});
