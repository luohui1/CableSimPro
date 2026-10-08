import { numeric, optionalRecord, text } from '@/api/client';
import { cableShape } from '@/features/drawing/cable-geometry';
import type { DomainDocument } from '@/lib/domain-fields';
import { formatNumber } from '@/lib/format';
import { cleanLabel } from './labels';

export type DesignStatus = 'draft' | 'review' | 'published';
export function versionLabel(value: string) { return value.replace(/\+engineering$/, '（工程版）').replace(/\+[^\s]+$/, '（定制版）') || '未提供'; }
export function publicationStatus(raw: Record<string, unknown>): DesignStatus {
  const state = text(optionalRecord(raw.type_lifecycle).status);
  return state === 'published' ? 'published' : ['submitted', 'approved'].includes(state) && optionalRecord(raw.type_lifecycle).stale !== true ? 'review' : 'draft';
}
export const publicationLabels = { draft: '草稿', review: '审核中', published: '已发布' } as const;
export function localTime(value: string) { const date = new Date(value); return value && Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { hour12: false }) : '未提供'; }
/** Read declared SI values only; a reference standard is not an execution declaration. */
export function designSummary(document: DomainDocument, raw: Record<string, unknown>) {
  const origin = optionalRecord(raw.type_origin_reference), cable = document.cable_types[0];
  const ratings = document.cable_types.map(c => [c.rating.u0, c.rating.u].every(v => typeof v === 'number' && Number.isFinite(v) && v > 0)
    ? `${formatNumber(c.rating.u0! / 1000, 1)}/${formatNumber(c.rating.u! / 1000, 1)} kV` : '未提供');
  const sections = document.cable_types.map(c => {
    const areas = c.cores.map(core => numeric(core.conductor.nominal_area));
    return areas.length && areas.every(v => v !== null && v > 0) ? areas.every(v => v === areas[0])
      ? `${areas.length}×${formatNumber(areas[0]! * 1e6, 1)} mm²` : areas.map(v => formatNumber(v! * 1e6, 1)).join(' + ') + ' mm²' : '未提供';
  });
  const declared = raw.declared_standards;
  const standards = Array.isArray(declared) ? declared.map(v => typeof v === 'string' ? v : text(optionalRecord(v).name)).filter(Boolean).join('、') : '';
  let diameter: number | null = null;
  try { if (cable) diameter = cableShape(cable, document.materials).radiusM * 2000; } catch { /* Missing/invalid geometry must remain explicit. */ }
  const kinds = new Set(Object.values(document.provenance || {}).map(v => v.kind));
  const source = kinds.has('asset') ? '库引用' : kinds.has('manufacturer') ? '厂家资料' : kinds.has('user') ? '用户录入' : kinds.has('standard') ? '标准值' : kinds.has('demo') ? '演示' : '未提供';
  return { name: cleanLabel(document.name), version: versionLabel(text(origin.version)), voltage: [...new Set(ratings)].join('、'), area: [...new Set(sections)].join('、'),
    standards: standards || '未声明', source, sourceDetail: text(origin.source), originName: cleanLabel(text(origin.name)), originId: text(origin.id),
    updated: localTime(text(raw.updated_at)), diameter, layers: cable ? cable.common_layers.length + cable.cores.reduce((n, core) => n + core.layers.length + 1, 0) : null };
}
