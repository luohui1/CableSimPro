// A project is a folder of typed JSON files. Inputs are overwritten in place;
// a run record is written once and never changed.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PartName, Parts, ProjectMeta, ProjectSource, RunHeader, RunRecord } from '../shared/types.ts';
import { StudioError } from './core.ts';

const SCHEMAS: Record<PartName, string> = {
  cable: 'cablesim.studio.cable/1',
  installation: 'cablesim.studio.installation/1',
  conditions: 'cablesim.studio.conditions/1',
  method: 'cablesim.studio.method/1',
};
const PARTS = Object.keys(SCHEMAS) as PartName[];
const ID = /^[a-z0-9][a-z0-9-]{2,40}$/;
const HEADER_KEYS = ['id', 'sequence', 'created', 'kind', 'title', 'by', 'task_id', 'inputs_sha256', 'status', 'tier', 'headline'] as const;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

export function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

/** Identity of the inputs a run was computed from; a run is current while it matches the saved parts. */
export function inputsDigest(parts: Parts): string {
  return digest({
    cable: { id: parts.cable.id, content_sha256: parts.cable.content_sha256 },
    installation: parts.installation,
    conditions: parts.conditions,
    method: parts.method,
  });
}

function read<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

function write(path: string, value: unknown, once = false): void {
  if (once && existsSync(path)) throw new StudioError({ code: 'RECORD_EXISTS', message: '运行记录已存在，不能改写。' }, 409);
  const staging = `${path}.${randomBytes(4).toString('hex')}.part`;
  writeFileSync(staging, JSON.stringify(value, null, 2) + '\n', 'utf-8');
  renameSync(staging, path);
}

export class Store {
  home: string;

  constructor(home: string) {
    this.home = home;
    mkdirSync(join(home, 'projects'), { recursive: true });
  }

  #dir(id: string): string {
    if (!ID.test(id)) throw new StudioError({ code: 'PROJECT_UNKNOWN', message: '工程标识无效。' }, 404);
    const dir = join(this.home, 'projects', id);
    if (!existsSync(join(dir, 'project.json'))) throw new StudioError({ code: 'PROJECT_UNKNOWN', message: '没有这个工程。' }, 404);
    return dir;
  }

  list(): ProjectMeta[] {
    const root = join(this.home, 'projects');
    return readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && existsSync(join(root, entry.name, 'project.json')))
      .map(entry => read<ProjectMeta>(join(root, entry.name, 'project.json')))
      .sort((a, b) => b.updated.localeCompare(a.updated));
  }

  create(name: string, parts: Parts, source?: ProjectSource): ProjectMeta {
    const id = 'p-' + randomBytes(4).toString('hex');
    const dir = join(this.home, 'projects', id);
    mkdirSync(join(dir, 'runs'), { recursive: true });
    mkdirSync(join(dir, 'reports'), { recursive: true });
    const now = new Date().toISOString();
    const meta: ProjectMeta = { id, name, created: now, updated: now, revision: 1, ...(source ? { source } : {}) };
    for (const part of PARTS) write(join(dir, `${part}.json`), { schema: SCHEMAS[part], ...parts[part] });
    write(join(dir, 'project.json'), { schema: 'cablesim.studio.project/1', ...meta });
    return meta;
  }

  meta(id: string): ProjectMeta {
    const { schema: _schema, ...meta } = read<ProjectMeta & { schema: string }>(join(this.#dir(id), 'project.json'));
    return meta;
  }

  parts(id: string): Parts {
    const dir = this.#dir(id);
    const parts = {} as Record<PartName, unknown>;
    for (const part of PARTS) {
      const { schema, ...value } = read<Record<string, unknown>>(join(dir, `${part}.json`));
      if (schema !== SCHEMAS[part]) throw new StudioError({ code: 'PROJECT_INVALID', message: `${part}.json 的结构版本不是 ${SCHEMAS[part]}。` }, 500);
      parts[part] = value;
    }
    return parts as unknown as Parts;
  }

  #touch(id: string, change: Partial<ProjectMeta> = {}): ProjectMeta {
    const meta = { ...this.meta(id), ...change, updated: new Date().toISOString() };
    meta.revision += 1;
    write(join(this.#dir(id), 'project.json'), { schema: 'cablesim.studio.project/1', ...meta });
    return meta;
  }

  writePart<K extends PartName>(id: string, part: K, value: Parts[K]): ProjectMeta {
    write(join(this.#dir(id), `${part}.json`), { schema: SCHEMAS[part], ...value });
    return this.#touch(id);
  }

  rename(id: string, name: string): ProjectMeta {
    return this.#touch(id, { name });
  }

  runs(id: string): RunHeader[] {
    const root = join(this.#dir(id), 'runs');
    return readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && existsSync(join(root, entry.name, 'record.json')))
      .map(entry => {
        const record = read<RunRecord>(join(root, entry.name, 'record.json'));
        const header = Object.fromEntries(HEADER_KEYS.filter(key => record[key] !== undefined).map(key => [key, record[key]])) as unknown as RunHeader;
        if (existsSync(join(this.#dir(id), 'reports', `${record.id}.html`))) header.report = `${record.id}.html`;
        return header;
      })
      .sort((a, b) => b.sequence - a.sequence);
  }

  run(id: string, runId: string): RunRecord {
    if (!ID.test(runId)) throw new StudioError({ code: 'RUN_UNKNOWN', message: '运行记录标识无效。' }, 404);
    const path = join(this.#dir(id), 'runs', runId, 'record.json');
    if (!existsSync(path)) throw new StudioError({ code: 'RUN_UNKNOWN', message: '没有这条运行记录。' }, 404);
    return read<RunRecord>(path);
  }

  saveRun(id: string, record: Omit<RunRecord, 'id' | 'sequence' | 'created'>): RunRecord {
    const sequence = this.runs(id).reduce((highest, run) => Math.max(highest, run.sequence), 0) + 1;
    const saved = { ...record, id: 'run-' + randomBytes(4).toString('hex'), sequence, created: new Date().toISOString() } as RunRecord;
    const dir = join(this.#dir(id), 'runs', saved.id);
    mkdirSync(dir, { recursive: true });
    write(join(dir, 'record.json'), saved, true);
    this.#touch(id);
    return saved;
  }

  saveReport(id: string, runId: string, html: string): string {
    this.run(id, runId);
    const path = join(this.#dir(id), 'reports', `${runId}.html`);
    writeFileSync(path, html, 'utf-8');
    return path;
  }

  report(id: string, runId: string): string | null {
    if (!ID.test(runId)) return null;
    const path = join(this.#dir(id), 'reports', `${runId}.html`);
    return existsSync(path) ? readFileSync(path, 'utf-8') : null;
  }
}
