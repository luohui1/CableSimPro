// The product library: series → specification → version, in one SQLite file next to the projects.
// A version's structure never changes once written; a change is a new version. Computed results are
// kept per version; every write leaves an event saying who did what and when.
import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type {
  BuiltRow, Closure, ColumnMapping, Derivation, Issue, LibraryEntry, LibraryEvent, ProductResult, RatingCondition, RatingRow, ResultKind,
  ReviewState, SeriesDeclaration, SeriesSummary, SeriesView, SpecRow, SpecView, StructureValue, ValueRow, VersionHeader,
} from '../shared/types.ts';
import { REVIEW_NAMES } from '../shared/format.ts';
import { StudioError } from './core.ts';
import { digest } from './store.ts';

const SCHEMA = `
create table series (
  id text primary key, name text not null, manufacturer text not null, designation text not null, description text not null,
  cores integer not null, u0_v real not null, u_v real, origin text not null, declaration text not null,
  created text not null, created_by text not null, updated text not null
) strict;
create table spec (
  id text primary key, series_id text not null references series(id), key text not null, name text not null,
  area_mm2 real not null, position integer not null, unique (series_id, key)
) strict;
create table version (
  id text primary key, spec_id text not null references spec(id), number integer not null, review text not null,
  content_sha256 text not null, entry text not null, structure text not null, closure text, derivation text not null, warnings text not null,
  note text not null, created text not null, created_by text not null,
  submitted text, submitted_by text, reviewed text, reviewed_by text, published text, published_by text,
  unique (spec_id, number)
) strict;
create table result (
  version_id text not null references version(id), kind text not null, inputs_sha256 text not null, body text not null,
  created text not null, created_by text not null, primary key (version_id, kind)
) strict;
create table event (
  id integer primary key autoincrement, at text not null, actor text not null, object text not null, object_id text not null,
  action text not null, detail text not null
) strict;
create index event_object on event (object_id, id);
create table mapping (name text primary key, body text not null, updated text not null) strict;
create table setting (key text primary key, value text not null) strict;
`;
const STEPS: Record<string, { from: ReviewState[]; to: ReviewState; stamp?: 'submitted' | 'reviewed' | 'published'; label: string }> = {
  submit: { from: ['draft'], to: 'submitted', stamp: 'submitted', label: '提交审核' },
  return: { from: ['submitted', 'reviewed'], to: 'draft', label: '退回修改' },
  approve: { from: ['submitted'], to: 'reviewed', stamp: 'reviewed', label: '审核通过' },
  publish: { from: ['reviewed'], to: 'published', stamp: 'published', label: '发布' },
};
export const REVIEW_STEPS = Object.fromEntries(Object.entries(STEPS).map(([key, step]) => [key, step.label]));

const slug = (text: string): string => text.toLowerCase().replace(/×/g, 'x').replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '');
const now = (): string => new Date().toISOString();
const parse = <T>(text: string | null): T => JSON.parse(text ?? 'null') as T;

interface VersionRecord extends VersionHeader {
  spec_id: string; entry: string; structure: string; closure: string | null; derivation: string; warnings: string;
}

export class Library {
  db: Database.Database;

  constructor(home: string) {
    this.db = new Database(join(home, 'library.sqlite'));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    if (this.db.pragma('user_version', { simple: true }) === 0) {
      this.db.exec(SCHEMA);
      this.db.pragma('user_version = 1');
    }
  }

  close(): void {
    this.db.close();
  }

  setting(key: string): string | null {
    return (this.db.prepare('select value from setting where key = ?').get(key) as { value: string } | undefined)?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    this.db.prepare('insert into setting (key, value) values (?, ?) on conflict (key) do update set value = excluded.value').run(key, value);
  }

  #event(actor: string, object: string, id: string, action: string, detail: Record<string, unknown> = {}): void {
    this.db.prepare('insert into event (at, actor, object, object_id, action, detail) values (?, ?, ?, ?, ?, ?)')
      .run(now(), actor, object, id, action, JSON.stringify(detail));
  }

  /** The version the library shows for a specification: the given number, else the newest. */
  #version(spec: string, number?: number): VersionRecord {
    const row = (number === undefined
      ? this.db.prepare('select * from version where spec_id = ? order by number desc limit 1').get(spec)
      : this.db.prepare('select * from version where spec_id = ? and number = ?').get(spec, number)) as VersionRecord | undefined;
    if (!row) throw new StudioError({ code: 'SPEC_UNKNOWN', message: number === undefined ? '产品库里没有这个规格。' : '这个规格没有这一版。' }, 404);
    return row;
  }

  #entry(row: VersionRecord): LibraryEntry {
    return { ...parse<LibraryEntry>(row.entry), id: row.spec_id, version: String(row.number), review: row.review };
  }

  /** A product as the workbench and the methods take it. */
  entry(spec: string, number?: number): LibraryEntry {
    return this.#entry(this.#version(spec, number));
  }

  /** Every specification's newest version, for choosing a cable. */
  entries(): LibraryEntry[] {
    const rows = this.db.prepare(`select v.* from version v join spec s on s.id = v.spec_id join series r on r.id = s.series_id
      where v.number = (select max(number) from version where spec_id = v.spec_id) order by r.created, r.id, s.position`).all() as VersionRecord[];
    return rows.map(row => this.#entry(row));
  }

  #insertSeries(id: string, declaration: SeriesDeclaration, description: string, actor: string): void {
    const at = now();
    this.db.prepare(`insert into series (id, name, manufacturer, designation, description, cores, u0_v, u_v, origin, declaration, created, created_by, updated)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, declaration.name, declaration.manufacturer, declaration.designation, description, declaration.cores, declaration.u0_v,
        declaration.u_v ?? null, declaration.origin ?? 'factory', JSON.stringify(declaration), at, actor, at);
  }

  #insertVersion(spec: string, number: number, review: ReviewState, entry: LibraryEntry, parts: {
    structure: StructureValue[]; closure: Closure | null; derivation: Derivation; warnings: Issue[]; note: string }, actor: string): string {
    const id = `${spec}@${number}`;
    const stored = { ...entry, id: spec, version: String(number) };
    const at = now();
    const stamp = review === 'published' ? [at, actor, at, actor, at, actor] : [null, null, null, null, null, null];
    this.db.prepare(`insert into version (id, spec_id, number, review, content_sha256, entry, structure, closure, derivation, warnings, note,
      created, created_by, submitted, submitted_by, reviewed, reviewed_by, published, published_by) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, spec, number, review, entry.content_sha256, JSON.stringify(stored), JSON.stringify(parts.structure),
        parts.closure ? JSON.stringify(parts.closure) : null, JSON.stringify(parts.derivation), JSON.stringify(parts.warnings), parts.note, at, actor, ...stamp);
    return id;
  }

  /** The bundled structures as the first content of an empty library: grouped by family, issued as they were. */
  seed(entries: LibraryEntry[], actor: string): void {
    this.db.transaction(() => {
      if (this.setting('seeded')) return;  // another host on the same folder got there first
      // A family that holds both a declared demonstration structure and a public table becomes two series.
      const mixed = new Set([...Map.groupBy(entries, entry => entry.family)].filter(([, members]) => new Set(members.map(entry => entry.state)).size > 1).map(([family]) => family));
      for (const [, members] of Map.groupBy(entries, entry => `${entry.family}|${entry.state}`)) {
        const first = members[0];
        const origin = first.state === 'demo' ? 'demo' : 'public';
        const id = 's-' + slug(first.id.split('.')[0] + '-' + first.id.split('.')[1].replace(/-\d+$/, ''));
        const declaration: SeriesDeclaration = {
          name: mixed.has(first.family) && origin === 'demo' ? `${first.family}（结构演示）` : first.family,
          manufacturer: origin === 'demo' ? '结构演示' : first.name.split(' ')[0], designation: first.name.match(/YJ[A-Z0-9]+/)?.[0] ?? '',
          cores: first.summary.cores as 1 | 3, u0_v: first.summary.u0_v, u_v: first.summary.u_v ?? 0, standards: [], common: {}, common_basis: {},
          modelling: {}, origin,
        };
        this.#insertSeries(id, declaration, origin === 'demo' ? '随软件提供的演示结构，尺寸为明示假设' : '随软件提供的公开结构表', actor);
        members.forEach((entry, position) => {
          this.db.prepare('insert into spec (id, series_id, key, name, area_mm2, position) values (?, ?, ?, ?, ?, ?)')
            .run(entry.id, id, `${entry.summary.cores}×${entry.summary.area_mm2}`, entry.name, entry.summary.area_mm2, position);
          this.#insertVersion(entry.id, 1, 'published', entry, { structure: [], closure: null, warnings: [], note: '随软件提供',
            derivation: { kind: 'bundled', note: '随软件提供的结构，未经结构表导入。' } }, actor);
        });
        this.#event(actor, 'series', id, 'seeded', { specs: members.length });
      }
      this.db.prepare("insert into setting (key, value) values ('seeded', ?)").run(now());
    }).immediate();
  }

  seriesList(): SeriesSummary[] {
    const rows = this.db.prepare('select * from series order by created, id').all() as (Omit<SeriesSummary, 'standards' | 'specs' | 'states'> & { declaration: string })[];
    const states = this.db.prepare(`select s.series_id, v.review, count(*) as n from version v join spec s on s.id = v.spec_id
      where v.number = (select max(number) from version where spec_id = v.spec_id) group by s.series_id, v.review`).all() as { series_id: string; review: ReviewState; n: number }[];
    return rows.map(({ declaration, ...row }) => {
      const mine = states.filter(state => state.series_id === row.id);
      return { ...row, standards: parse<SeriesDeclaration>(declaration).standards,
        specs: mine.reduce((sum, state) => sum + state.n, 0), states: Object.fromEntries(mine.map(state => [state.review, state.n])) };
    });
  }

  #series(id: string): { summary: SeriesSummary; declaration: SeriesDeclaration } {
    const summary = this.seriesList().find(series => series.id === id);
    if (!summary) throw new StudioError({ code: 'SERIES_UNKNOWN', message: '产品库里没有这个系列。' }, 404);
    const row = this.db.prepare('select declaration from series where id = ?').get(id) as { declaration: string };
    return { summary, declaration: parse<SeriesDeclaration>(row.declaration) };
  }

  declaration(id: string): SeriesDeclaration {
    return this.#series(id).declaration;
  }

  /** The inputs a kept result was computed from; it is current while they are the version's. */
  inputs(kind: ResultKind, entry: LibraryEntry, standards: string[]): string {
    return digest({ kind, content_sha256: entry.content_sha256, standards: kind === 'check' ? [...standards].sort() : [] });
  }

  seriesView(id: string): Omit<SeriesView, 'job'> {
    const { summary, declaration } = this.#series(id);
    const versions = this.db.prepare(`select v.*, s.key, s.name, s.area_mm2 from version v join spec s on s.id = v.spec_id
      where s.series_id = ? and v.number = (select max(number) from version where spec_id = v.spec_id) order by s.position`).all(id) as
      (VersionRecord & { key: string; name: string; area_mm2: number })[];
    const results = this.db.prepare(`select r.version_id, r.kind, r.body from result r join version v on v.id = r.version_id join spec s on s.id = v.spec_id
      where s.series_id = ?`).all(id) as { version_id: string; kind: ResultKind; body: string }[];
    let reference: RatingCondition | null = null;
    const specs = versions.map((row): SpecRow => {
      const entry = parse<LibraryEntry>(row.entry);
      const structure = parse<StructureValue[]>(row.structure);
      const mine = Object.fromEntries(results.filter(result => result.version_id === row.id).map(result => [result.kind, parse<ProductResult>(result.body)]));
      const value = (kind: ResultKind, suffix: string) => (mine[kind]?.rows as ValueRow[] | undefined)?.find(item => item.id.endsWith(suffix))?.value ?? null;
      const rating = mine.rating?.rows as RatingRow[] | undefined;
      const conditions = mine.rating?.conditions as RatingCondition[] | undefined;
      reference ??= conditions?.[0] ?? null;
      const ac = value('electrical', ':ac');
      const short = value('short_circuit', ':conductor-adiabatic');
      return {
        id: row.spec_id, key: row.key, name: row.name, area_mm2: row.area_mm2, version: row.number, version_id: row.id, review: row.review,
        outer_diameter_mm: entry.summary.outer_diameter_m * 1000, r20_ohm_km: entry.summary.r20_ohm_m ? entry.summary.r20_ohm_m * 1000 : null,
        weight_kg_km: structure.find(item => item.key === 'weight')?.value ?? null, warnings: parse<Issue[]>(row.warnings),
        // Each size's structure values with where they come from, so sizes can be compared side by side.
        dimensions: Object.fromEntries(structure.map(item => [item.key, { value: item.value, origin: item.origin, ...(item.revision ? { revised: true } : {}) }])),
        check: mine.check?.summary?.count ?? null, ac_resistance_ohm_km: ac === null ? null : ac * 1000, short_circuit_ka: short === null ? null : short / 1000,
        ampacity_a: rating?.find(item => item.id === conditions?.[0]?.id)?.ampacity_a ?? null,
        computed: Object.fromEntries(Object.entries(mine).map(([kind, result]) => [kind,
          result.error || (kind === 'rating' && !(result.rows as RatingRow[] | undefined)?.some(item => item.status === 'succeeded')) ? 'error' : 'done'])),
      };
    });
    return { series: summary, declaration, specs, reference };
  }

  specView(spec: string, number?: number): SpecView {
    const row = this.#version(spec, number);
    const header = this.db.prepare('select id, series_id, key, name, area_mm2 from spec where id = ?').get(spec) as
      { id: string; series_id: string; key: string; name: string; area_mm2: number };
    const { summary, declaration } = this.#series(header.series_id);
    const entry = this.#entry(row);
    const stored = this.db.prepare('select kind, inputs_sha256, body, created, created_by from result where version_id = ?').all(row.id) as
      { kind: ResultKind; inputs_sha256: string; body: string; created: string; created_by: string }[];
    const results = Object.fromEntries(stored.map(item => [item.kind, { ...parse<ProductResult>(item.body), kind: item.kind, created: item.created,
      by: item.created_by, current: item.inputs_sha256 === this.inputs(item.kind, entry, declaration.standards) }]));
    const versions = this.db.prepare(`select id, number, review, note, content_sha256, created, created_by, submitted, submitted_by, reviewed, reviewed_by,
      published, published_by from version where spec_id = ? order by number desc`).all(spec) as VersionHeader[];
    const events = (this.db.prepare(`select id, at, actor as by, object, object_id, action, detail from event
      where object_id = ? or object_id like ? order by id desc limit 200`).all(spec, `${spec}@%`) as (Omit<LibraryEvent, 'detail'> & { detail: string })[])
      .map(event => ({ ...event, detail: parse<Record<string, unknown>>(event.detail) }));
    const { spec_id: _spec, entry: _entry, structure, closure, derivation, warnings, ...version } = row;
    return {
      series: summary, spec: { id: header.id, key: header.key, name: header.name, area_mm2: header.area_mm2 }, version, entry,
      structure: parse<StructureValue[]>(structure), closure: parse<Closure | null>(closure), derivation: parse<Derivation>(derivation),
      warnings: parse<Issue[]>(warnings), results, versions, events,
    };
  }

  /** A new series from the rows of a structure table that built; each becomes the first draft of a specification. */
  createSeries(declaration: SeriesDeclaration, description: string, rows: Extract<BuiltRow, { ok: true }>[], actor: string, file?: string): string {
    if (!rows.length) throw new StudioError({ code: 'IMPORT_EMPTY', message: '没有可以导入的规格。' });
    if (this.db.prepare('select 1 from series where name = ?').get(declaration.name)) {
      throw new StudioError({ code: 'SERIES_EXISTS', message: `产品库里已有名为“${declaration.name}”的系列，请改名后再导入。`, path: '/series/name' }, 409);
    }
    const id = 's-' + randomBytes(4).toString('hex');
    this.db.transaction(() => {
      this.#insertSeries(id, declaration, description, actor);
      rows.forEach((row, position) => {
        const spec = `${id}.${slug(row.key)}`;
        this.db.prepare('insert into spec (id, series_id, key, name, area_mm2, position) values (?, ?, ?, ?, ?, ?)')
          .run(spec, id, row.key, row.name, row.area_mm2, position);
        this.#insertVersion(spec, 1, 'draft', row.entry, { structure: row.structure, closure: row.closure, derivation: row.derivation,
          warnings: row.warnings, note: file ? `由结构表 ${file} 导入` : '由结构表导入' }, actor);
      });
      this.#event(actor, 'series', id, 'imported', { specs: rows.length, file: file ?? null });
    })();
    return id;
  }

  /** A new series with no specification yet, entered by hand; its specifications are added one at a time. */
  openSeries(declaration: SeriesDeclaration, description: string, actor: string): string {
    if (this.db.prepare('select 1 from series where name = ?').get(declaration.name)) {
      throw new StudioError({ code: 'SERIES_EXISTS', message: `产品库里已有名为“${declaration.name}”的系列，请改名。`, path: '/name' }, 409);
    }
    const id = 's-' + randomBytes(4).toString('hex');
    this.db.transaction(() => {
      this.#insertSeries(id, declaration, description, actor);
      this.#event(actor, 'series', id, 'created', { specs: 0, entry: 'manual' });
    })();
    return id;
  }

  /** One specification typed in: its first version is a draft, the same kind of object an import leaves. */
  addSpec(series: string, row: Extract<BuiltRow, { ok: true }>, note: string, actor: string): string {
    this.#series(series);
    const spec = `${series}.${slug(row.key)}`;
    if (this.db.prepare('select 1 from spec where series_id = ? and key = ?').get(series, row.key) || this.db.prepare('select 1 from spec where id = ?').get(spec)) {
      throw new StudioError({ code: 'SPEC_EXISTS', message: `这个系列里已有 ${row.key}；要改它的尺寸请用“修改结构”，会生成新版本。` }, 409);
    }
    this.db.transaction(() => {
      const next = this.db.prepare('select coalesce(max(position), -1) + 1 as next from spec where series_id = ?').get(series) as { next: number };
      this.db.prepare('insert into spec (id, series_id, key, name, area_mm2, position) values (?, ?, ?, ?, ?, ?)').run(spec, series, row.key, row.name, row.area_mm2, next.next);
      this.#insertVersion(spec, 1, 'draft', row.entry, { structure: row.structure, closure: row.closure, derivation: row.derivation,
        warnings: row.warnings, note }, actor);
      this.db.prepare('update series set updated = ? where id = ?').run(now(), series);
      this.#event(actor, 'version', `${spec}@1`, 'created', { entry: 'manual', note });
    })();
    return spec;
  }

  /** A changed structure is a new draft; the versions before it stay as they were. */
  revise(spec: string, row: Extract<BuiltRow, { ok: true }>, note: string, actor: string): VersionHeader {
    const latest = this.#version(spec);
    if (latest.content_sha256 === row.entry.content_sha256) {
      throw new StudioError({ code: 'REVISION_UNCHANGED', message: '结构没有变化，没有生成新版本。' }, 409);
    }
    const number = latest.number + 1;
    const previous = parse<StructureValue[]>(latest.structure);
    const at = now();
    const structure = row.structure.map(value => {
      const before = previous.find(item => item.key === value.key);
      return { ...value, ...(before && before.value !== value.value
        ? { revision: { previous: before.value, by: actor, at, note } }
        : { ...(before?.revision ? { revision: before.revision } : {}), ...(before?.basis && !value.basis ? { basis: before.basis } : {}) }) };
    });
    this.db.transaction(() => {
      this.#insertVersion(spec, number, 'draft', row.entry, { structure, closure: row.closure, derivation: row.derivation,
        warnings: row.warnings, note }, actor);
      this.db.prepare('update series set updated = ? where id = (select series_id from spec where id = ?)').run(now(), spec);
      this.#event(actor, 'version', `${spec}@${number}`, 'revised', { from: latest.number, note });
    })();
    return this.specView(spec, number).version;
  }

  /** One step of the review. A step that does not follow from the present state is refused. */
  transition(spec: string, number: number, action: string, note: string, actor: string): VersionHeader {
    const step = STEPS[action];
    const row = this.#version(spec, number);
    if (!step) throw new StudioError({ code: 'REVIEW_INVALID', message: '没有这个审核动作。' });
    if (!step.from.includes(row.review)) {
      throw new StudioError({ code: 'REVIEW_INVALID', message: `这一版现在是“${REVIEW_NAMES[row.review]}”，不能${step.label}。` }, 409);
    }
    this.db.transaction(() => {
      const at = now();
      if (step.stamp) this.db.prepare(`update version set review = ?, ${step.stamp} = ?, ${step.stamp}_by = ? where id = ?`).run(step.to, at, actor, row.id);
      else {
        this.db.prepare(`update version set review = ?, submitted = null, submitted_by = null, reviewed = null, reviewed_by = null where id = ?`).run(step.to, row.id);
      }
      this.db.prepare('update series set updated = ? where id = (select series_id from spec where id = ?)').run(at, spec);
      this.#event(actor, 'version', row.id, action, { from: row.review, to: step.to, note });
    })();
    return this.specView(spec, number).version;
  }

  saveResult(versionId: string, kind: ResultKind, inputs: string, body: unknown, actor: string): void {
    this.db.prepare(`insert into result (version_id, kind, inputs_sha256, body, created, created_by) values (?, ?, ?, ?, ?, ?)
      on conflict (version_id, kind) do update set inputs_sha256 = excluded.inputs_sha256, body = excluded.body, created = excluded.created, created_by = excluded.created_by`)
      .run(versionId, kind, inputs, JSON.stringify(body), now(), actor);
  }

  hasCurrentResult(versionId: string, kind: ResultKind, inputs: string): boolean {
    const row = this.db.prepare('select inputs_sha256, body from result where version_id = ? and kind = ?').get(versionId, kind) as
      { inputs_sha256: string; body: string } | undefined;
    return !!row && row.inputs_sha256 === inputs && !parse<ProductResult>(row.body).error;
  }

  note(actor: string, object: string, id: string, action: string, detail: Record<string, unknown>): void {
    this.#event(actor, object, id, action, detail);
  }

  mappings(): ColumnMapping[] {
    return (this.db.prepare('select name, body, updated from mapping order by updated desc').all() as { name: string; body: string; updated: string }[])
      .map(row => ({ name: row.name, updated: row.updated, ...parse<Pick<ColumnMapping, 'mapping' | 'headers'>>(row.body) }));
  }

  saveMapping(name: string, mapping: Record<string, number>, headers: Record<string, string>, actor: string): void {
    this.db.prepare('insert into mapping (name, body, updated) values (?, ?, ?) on conflict (name) do update set body = excluded.body, updated = excluded.updated')
      .run(name, JSON.stringify({ mapping, headers }), now());
    this.#event(actor, 'mapping', name, 'saved', { fields: Object.keys(mapping).length });
  }
}
