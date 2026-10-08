import type { DomainDocument, Section } from './types';

export type GeometryPreview = (document: DomainDocument) => Promise<Record<string, unknown>>;
export interface GeometryChange { path: string; previousValue: number; value: number; unit: 'm' }
export interface WhatIfProps {
  preview?: GeometryPreview;
  onPropose?: (changes: readonly GeometryChange[]) => void | Promise<void>;
}
const escape = (value: string) => value.replace(/~/g, '~0').replace(/\//g, '~1');
export function geometryChanges(base: DomainDocument, current: DomainDocument, sectionId: string): GeometryChange[] {
  const before = base.sections.find(s => s.id === sectionId), after = current.sections.find(s => s.id === sectionId);
  if (!before || !after) throw Error('试算截面已不存在，请退出试算后重新选择。');
  if (before.placements.length !== after.placements.length || (before.enclosures || []).length !== (after.enclosures || []).length
    || (before.soil_layers || []).length !== (after.soil_layers || []).length || !!before.backfill !== !!after.backfill) throw Error('试算不支持增删几何对象。');
  const changes: GeometryChange[] = [], root = `/sections/${escape(sectionId)}`;
  function collect(a: object, b: object, path: string, keys: readonly string[]) {
    const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
    for (const key of keys) if (left[key] !== right[key]) {
      if (typeof left[key] !== 'number' || typeof right[key] !== 'number' || !Number.isFinite(right[key])) throw Error(`试算字段 ${path}/${key} 必须为有限 SI 长度。`);
      changes.push({ path: `${path}/${key}`, previousValue: left[key], value: right[key], unit: 'm' });
    }
  }
  for (const p of before.placements) { const next = after.placements.find(v => v.cable === p.cable); if (!next) throw Error('试算不支持增删电缆。'); collect(p, next, `${root}/placements/${escape(p.cable)}`, ['x', 'z']); }
  for (const p of before.enclosures || []) { const next = after.enclosures?.find(v => v.id === p.id); if (!next) throw Error('试算不支持增删排管。'); collect(p, next, `${root}/enclosures/${escape(p.id)}`, ['x', 'z', 'inner_diameter', 'outer_diameter', 'width', 'height']); }
  if (before.backfill && after.backfill) collect(before.backfill, after.backfill, `${root}/backfill`, ['x', 'z', 'width', 'height']);
  for (const p of before.soil_layers || []) { const next = after.soil_layers?.find(v => v.id === p.id); if (!next) throw Error('试算不支持增删土层。'); collect(p, next, `${root}/soil_layers/${escape(p.id)}`, ['top_z', 'bottom_z']); }
  return changes;
}
export function replaceSection(document: DomainDocument, section: Section): DomainDocument {
  return { ...document, sections: document.sections.map(s => s.id === section.id ? section : s) };
}

/** Debounced, serial latest-input queue. Late or expired responses cannot publish. */
export class PreviewQueue<T> {
  private timer?: ReturnType<typeof setTimeout>;
  private revision = 0;
  private active = false;
  private activeExpired = false;
  private pending?: { document: DomainDocument; revision: number; key: string };
  private lastKey = '';
  private alive = true;
  constructor(private preview: GeometryPreview, private normalize: (value: Record<string, unknown>, document: DomainDocument) => T,
    private publish: (value: { status: 'pending' | 'success' | 'error'; result?: T; error?: string }) => void, private delay = 180, private timeout = 10000) {}
  schedule(document: DomainDocument) {
    const key = JSON.stringify(document);
    if (!this.alive || key === this.lastKey) return;
    this.lastKey = key; this.pending = { document: structuredClone(document), revision: ++this.revision, key };
    clearTimeout(this.timer); this.publish(this.activeExpired ? { status: 'error', error: '上一试算超时；等待网络请求结束，几何草稿保留。' } : { status: 'pending' });
    this.timer = setTimeout(() => { this.timer = undefined; void this.start(); }, this.delay);
  }
  private async start() {
    if (!this.alive || this.active || !this.pending || this.timer) return;
    const job = this.pending; this.pending = undefined; this.active = true; this.activeExpired = false;
    let expired = false;
    const deadline = setTimeout(() => { expired = true; this.activeExpired = true; if (this.alive && (job.revision === this.revision || this.pending)) this.publish({ status: 'error', error: '试算超时；几何草稿保留，请重试。' }); }, this.timeout);
    try {
      const value = await this.preview(job.document);
      if (this.alive && !expired && job.revision === this.revision) this.publish({ status: 'success', result: this.normalize(value, job.document) });
    } catch (error) {
      if (this.alive && !expired && job.revision === this.revision) this.publish({ status: 'error', error: error instanceof Error ? error.message : String(error) });
    } finally { clearTimeout(deadline); this.active = false; this.activeExpired = false; if (this.alive && this.pending && !this.timer) { this.publish({ status: 'pending' }); void this.start(); } }
  }
  retry(document: DomainDocument) { this.lastKey = ''; this.schedule(document); }
  cancel() { clearTimeout(this.timer); this.timer = undefined; this.revision++; this.pending = undefined; this.lastKey = ''; }
  dispose() { this.cancel(); this.alive = false; }
}
