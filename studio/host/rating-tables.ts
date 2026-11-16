// Ampacity tables kept on a specification version. The batch of the product library already computes one fixed
// table for every version (the `rating` result: buried at 0.7 m, 25 °C, six soils) and the specification sheet shows
// it. What it does not do is answer for conditions the engineer states, keep several tables, or let a number be
// followed back to the record it came from. Here each stated condition is a run of the ordinary single check
// (`run.rate`), in a project made for the table, so a number in the table is a number of a run record.
import { randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import { arr, int, nullable, num, obj, oneOf, opt, str } from '@earendil-works/pi-schema';
import type { RatingTable, RatingTableCondition, RatingTableRow } from '../shared/model-types.ts';
import type { LibraryEntry, Parts, RunRecord } from '../shared/types.ts';
import { StudioError } from './core.ts';
import type { Library } from './library.ts';
import { anyProject } from './manual.ts';
import type { Operation, Studio } from './operations.ts';

const SCHEMA = `
create table if not exists rating_table (
  id text primary key, version_id text not null references version(id), title text not null, project_id text not null,
  created text not null, created_by text not null, body text not null
) strict;
create index if not exists rating_table_version on rating_table (version_id, created);
`;
const ready = new WeakSet<Database.Database>();
const ensure = (db: Database.Database): Database.Database => {
  if (!ready.has(db)) { db.exec(SCHEMA); ready.add(db); }
  return db;
};

interface Stored { id: string; title: string; project_id: string; created: string; created_by: string; body: string }

/** The tables of one version, newest first. */
export function ratingTables(library: Library, versionId: string): RatingTable[] {
  const rows = ensure(library.db).prepare('select id, title, project_id, created, created_by, body from rating_table where version_id = ? order by created desc, id')
    .all(versionId) as Stored[];
  return rows.map(row => ({ id: row.id, title: row.title, project: row.project_id, created: row.created, by: row.created_by,
    ...(JSON.parse(row.body) as Pick<RatingTable, 'spec' | 'version' | 'content_sha256' | 'rows'>) }));
}

const duct = obj({
  inner_diameter_m: num({ exclusiveMinimum: 0, description: '管内径，m' }),
  outer_diameter_m: num({ exclusiveMinimum: 0, description: '管外径，m' }),
  thermal_resistivity: opt(num({ exclusiveMinimum: 0, description: '管材热阻率，K·m/W；缺省 6.0（PVC，IEC 60287-2-1 表 1）' })),
});
const condition = obj({
  label: opt(str({ maxLength: 60, description: '这一行的名称；不写就按条件自动命名' })),
  layout: str({ description: '敷设方式标识，例如 three_core_buried_single（三芯直埋单回）、three_core_buried_horizontal（三芯直埋三回水平）；单芯有 trefoil、flat、ducts 等' }),
  depth_m: num({ exclusiveMinimum: 0, description: '电缆组中心埋深，m' }),
  spacing_m: opt(nullable(num({ exclusiveMinimum: 0 }), { description: '相邻电缆中心距，m；null 或不写表示用模板的默认间距' })),
  bonding: opt(oneOf(['both_ends', 'single_point'], { description: '护套接地：both_ends 两端接地（缺省），single_point 单点接地' })),
  duct: opt(nullable(duct)),
  soil_thermal_resistivity: num({ exclusiveMinimum: 0, description: '土壤热阻率，K·m/W' }),
  ambient_temperature_c: num({ minimum: -50, maximum: 80, description: '环境（地表）温度，°C' }),
  frequency_hz: opt(num({ exclusiveMinimum: 0, description: '频率，Hz，缺省 50' })),
  system_voltage_v: opt(nullable(num({ exclusiveMinimum: 0 }), { description: '系统线电压，V；缺省取型号额定电压 U' })),
});

const named = (item: RatingTableCondition): string => `${item.layout} · ${item.depth_m} m · ${item.soil_thermal_resistivity} K·m/W · ${item.ambient_temperature_c} °C`;

export function ratingTableOperations(studio: Studio): Operation[] {
  const { core, library, store } = studio;
  const actor = (by: 'human' | 'agent'): string => (by === 'agent' ? 'Agent' : studio.user);

  /** The inputs of one condition: the cable and the template defaults, then what the engineer stated. */
  const partsOf = (cable: LibraryEntry, defaults: Pick<Parts, 'installation' | 'conditions'>, item: RatingTableCondition): Parts => ({
    cable,
    installation: { ...defaults.installation, layout: item.layout, depth_m: item.depth_m, spacing_m: item.spacing_m ?? null, duct: item.duct ?? null,
      backfill: null, bonding: item.bonding ?? 'both_ends' },
    conditions: { ...defaults.conditions, soil_thermal_resistivity: item.soil_thermal_resistivity, ambient_temperature_c: item.ambient_temperature_c,
      frequency_hz: item.frequency_hz ?? defaults.conditions.frequency_hz,
      system_voltage_v: item.system_voltage_v === undefined ? defaults.conditions.system_voltage_v : item.system_voltage_v, currents_a: [0] },
    method: { method: 'iec60287.steady', parameters: {} },
  });

  const row = (index: number, item: RatingTableCondition, parts: Parts, record: RunRecord, project: string): RatingTableRow => {
    const ampacity = record.summary?.ampacity ?? null;
    const section = record.document?.sections[0];
    return {
      id: `c${index + 1}`, label: item.label?.trim() || named(item), layout: item.layout, layout_label: section?.label ?? studio.layoutLabel(item.layout),
      depth_m: parts.installation.depth_m, spacing_m: section?.layout_template?.spacing ?? null, bonding: parts.installation.bonding,
      soil_thermal_resistivity: parts.conditions.soil_thermal_resistivity, ambient_temperature_c: parts.conditions.ambient_temperature_c,
      frequency_hz: parts.conditions.frequency_hz, system_voltage_v: parts.conditions.system_voltage_v, circuits: record.document?.circuits.length ?? null,
      status: ampacity ? 'succeeded' : 'failed', ampacity_a: ampacity ? ampacity.value_a : null, basis_name: ampacity?.basis_name ?? null,
      tier: ampacity ? record.tier ?? null : null, tier_label: ampacity ? record.method_card?.tier.label ?? null : null,
      ...(ampacity ? {} : { error: record.summary?.error ?? record.summary?.circuits?.find(circuit => circuit.error)?.error
        ?? { code: 'NO_AMPACITY', message: '方法没有给出允许电流。' } }),
      run: { project, run: record.id, sequence: record.sequence, inputs_sha256: record.inputs_sha256, plugin_id: record.plugin_id, plugin_version: record.plugin_version,
        capability: record.capability, method_version: record.method_version, manifest_sha256: record.manifest_sha256, request_sha256: record.request_sha256 },
    };
  };

  const brief = (table: RatingTable) => ({
    table: table.id, title: table.title, spec: table.spec, version: table.version, project: table.project, by: table.by, created: table.created,
    rows: table.rows.map(item => ({ label: item.label, layout: item.layout_label, depth_m: item.depth_m, ambient_c: item.ambient_temperature_c,
      soil_k_m_w: item.soil_thermal_resistivity, circuits: item.circuits, ampacity_a: item.ampacity_a, basis: item.basis_name, tier: item.tier_label,
      error: item.error?.message, run: item.run.run }) ),
  });

  return [
    { id: 'library.rating.table', tool: 'build_rating_table', title: '载流量表写回规格书', kind: 'run',
      description: '对一个规格版本，按写明的敷设条件逐条算出允许电流（IEC 60287），存成这个版本的载流量表。每个数对应一条运行记录：表在自己的工程里，一个条件一条记录，'
        + '记录里有当时的输入、插件和方法版本。方法不覆盖的条件在表里写拒算原因，不补估计值。导出规格书时会带上这张表。不写 version 取最新版。',
      parameters: obj({
        spec: str({ description: '规格标识' }),
        version: opt(int({ minimum: 1, description: '版本号；缺省为最新版' })),
        title: opt(str({ minLength: 1, maxLength: 60, description: '表的名称，缺省“载流量表”' })),
        conditions: arr(condition, { minItems: 1, maxItems: 24, description: '敷设条件，一条一行；每条都要写明敷设方式、埋深、土壤热阻率和环境温度' }),
        ...anyProject,
      }),
      execute: async (params: { spec: string; version?: number; title?: string; conditions: RatingTableCondition[] }, context): Promise<RatingTable> => {
        const selected = library.specView(params.spec, params.version);
        const number = selected.version.number;
        const cable = library.entry(params.spec, number);
        const title = params.title?.trim() || '载流量表';
        const name = `${selected.spec.name} · 第 ${number} 版 · ${title}`;
        const defaults = await core.call<Pick<Parts, 'installation' | 'conditions'>>('cable.defaults', { cable });
        const all = params.conditions.map(item => partsOf(cable, defaults, item));
        // Every condition must make a valid input before anything is written.
        for (const [index, parts] of all.entries()) {
          const { issue } = await studio.preview(name, parts);
          if (issue) throw new StudioError({ code: issue.code, message: `第 ${index + 1} 条条件：${issue.message}`, path: `/conditions/${index}${issue.path ?? ''}` });
        }
        const meta = store.create(name, all[0]);
        const rows: RatingTableRow[] = [];
        try {
          for (const [index, parts] of all.entries()) {
            store.writePart(meta.id, 'installation', parts.installation);
            store.writePart(meta.id, 'conditions', parts.conditions);
            const record = await studio.invoke('run.rate', { project: meta.id }, context) as RunRecord;
            rows.push(row(index, params.conditions[index], parts, record, meta.id));
          }
        } catch (error) {
          store.rename(meta.id, `${name}（未完成）`);
          throw error;
        }
        const table: RatingTable = { id: 'rt-' + randomBytes(4).toString('hex'), title, spec: params.spec, version: number, content_sha256: selected.version.content_sha256,
          project: meta.id, created: new Date().toISOString(), by: actor(context.by), rows };
        ensure(library.db).prepare('insert into rating_table (id, version_id, title, project_id, created, created_by, body) values (?, ?, ?, ?, ?, ?, ?)')
          .run(table.id, selected.version.id, title, meta.id, table.created, table.by,
            JSON.stringify({ spec: table.spec, version: table.version, content_sha256: table.content_sha256, rows: table.rows }));
        library.note(table.by, 'version', selected.version.id, 'rating_table', { table: table.id, project: meta.id, rows: rows.length,
          succeeded: rows.filter(item => item.status === 'succeeded').length });
        studio.emit({ type: 'library', series_id: selected.series.id });
        return table;
      },
      brief },

    { id: 'library.rating.tables', tool: 'get_rating_tables', title: '规格的载流量表', kind: 'read',
      description: '读取一个规格版本上保存的载流量表：每行的敷设条件、允许电流、可信分档，以及对应的运行记录（工程和记录标识）。不写 version 取最新版。',
      parameters: obj({ spec: str({ description: '规格标识' }), version: opt(int({ minimum: 1, description: '版本号；缺省为最新版' })), ...anyProject }),
      execute: async (params: { spec: string; version?: number }): Promise<RatingTable[]> => ratingTables(library, library.specView(params.spec, params.version).version.id),
      brief: (tables: RatingTable[]) => tables.map(brief) },
  ];
}
