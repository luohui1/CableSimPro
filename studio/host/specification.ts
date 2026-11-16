// A specification sheet is an immutable snapshot, independent of subsequent edits and recalculations.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SpecificationReport, SpecView } from '../shared/types.ts';
import { StudioError } from './core.ts';
import type { Studio } from './operations.ts';
import { ratingTables } from './rating-tables.ts';

const ID = /^sheet-[0-9a-f]{24}$/;
const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

export function specificationFile(home: string, id: string, snapshot = false): string {
  if (!ID.test(id)) throw new StudioError({ code: 'REPORT_UNKNOWN', message: '找不到这份规格书。' }, 404);
  const file = join(home, 'specifications', id, snapshot ? 'snapshot.json' : 'specification.pdf');
  if (!existsSync(file)) throw new StudioError({ code: 'REPORT_UNKNOWN', message: '找不到这份规格书。' }, 404);
  return file;
}

export function specificationReports(home: string, spec: string): SpecificationReport[] {
  const root = join(home, 'specifications');
  if (!existsSync(root)) return [];
  return readdirSync(root).filter(id => ID.test(id) && existsSync(join(root, id, 'record.json')))
    .map(id => JSON.parse(readFileSync(join(root, id, 'record.json'), 'utf8')) as SpecificationReport)
    .filter(record => record.spec === spec).sort((a, b) => b.created.localeCompare(a.created));
}

export async function exportSpecification(studio: Studio, view: SpecView, by: string): Promise<SpecificationReport> {
  const id = 'sheet-' + randomBytes(12).toString('hex');
  const created = new Date().toISOString();
  const snapshot = JSON.stringify({ schema: 'cablesim.studio.specification/1', id, created, by, view,
    declaration: studio.library.declaration(view.series.id), rating_tables: ratingTables(studio.library, view.version.id) }, null, 2);
  const snapshot_sha256 = hash(snapshot);
  const dir = join(studio.home, 'specifications', id);
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(join(dir, 'snapshot.json'), snapshot, { flag: 'wx' });
    await studio.core.call('specification.render', { snapshot: JSON.parse(snapshot), snapshot_sha256, path: join(dir, 'specification.pdf') });
    const record: SpecificationReport = { id, title: `${view.spec.name} · 第 ${view.version.number} 版`,
      spec: view.spec.id, version: view.version.number, review: view.version.review, created, by,
      content_sha256: view.version.content_sha256, snapshot_sha256, sha256: hash(readFileSync(join(dir, 'specification.pdf'))),
      url: `/api/specifications/${id}` };
    writeFileSync(join(dir, 'record.json'), JSON.stringify(record, null, 2), { flag: 'wx' });
    studio.library.note(by, 'version', view.version.id, 'exported', { id, snapshot_sha256, sha256: record.sha256 });
    return record;
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}
