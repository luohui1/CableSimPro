import { numeric, optionalRecord, text } from '@/api/client';
import { cableShape } from '@/features/drawing/cable-geometry';
import type { DomainDocument } from '@/lib/domain-fields';
import { formatNumber } from '@/lib/format';
import { cleanLabel } from './labels';
import { missingTypeInputs } from './missing';

export type DesignStatus = 'draft' | 'review' | 'published';
export function versionLabel(value: string) { return value.replace(/\+engineering$/, '（工程版）').replace(/\+[^\s]+$/, '（定制版）') || '未提供'; }
export function standardVersionLabel(value:string) { return /^\d{4}\.0\.0$/.test(value) ? value.slice(0,4)+' 版' : value; }
export function publicationStatus(raw: Record<string, unknown>): DesignStatus {
  const state = text(optionalRecord(raw.type_lifecycle).status);
  return state === 'published' ? 'published' : ['submitted', 'approved'].includes(state) && optionalRecord(raw.type_lifecycle).stale !== true ? 'review' : 'draft';
}
export const publicationLabels = { draft: '草稿', review: '审核中', published: '已发布' } as const;
export function localTime(value: string) { const date = new Date(value); return value && Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { hour12: false }) : '未提供'; }
/** Rated/nominal values retain meaningful decimals without padding them with zeroes. */
export function nominalNumber(value: number | null, precision = 2) { return formatNumber(value, precision).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, ''); }
export function approvedStandardNames(ledger: Record<string, unknown>, runId: string): string[] {
  if (ledger.run_id !== runId || ledger.source_current !== true || !Array.isArray(ledger.items)) return [];
  return [...new Set(ledger.items.flatMap(value => {
    const item = optionalRecord(value), approval = optionalRecord(item.approval), definition = optionalRecord(item.definition);
    const name = text(definition.standard).trim();
    return item.state === 'approved' && item.bindable === true && text(approval.id) && text(approval.digest)
      && text(optionalRecord(approval.definition).standard) === name && name ? [name] : [];
  }))];
}
export type ExecutionStandardsSummary = {
  standards: string[]; approvedStandards: string[]; standardsLabel: string; standardsReason: string;
  declarationState: 'declared' | 'undeclared' | 'unconfirmed' | 'invalid'; approvalState: 'ready' | 'error';
};
/** Project the saved explicit declaration for display; this neither validates engineering use nor approves requirements. */
export function executionStandardsSummary(document: DomainDocument, approval: { standards: string[] } | { error: string }): ExecutionStandardsSummary {
  const source = document.provenance?.['/execution_standards'];
  let standards: string[] = [], declarationState: ExecutionStandardsSummary['declarationState'] = 'undeclared';
  let label = '未声明', reason = '当前输入未声明执行版本；在要求与标准中核对并声明。';
  if (source != null) {
    if (source.kind !== 'standard' || source.reviewed !== true) {
      declarationState = 'unconfirmed'; label = '声明待确认'; reason = '执行版本声明尚未确认；在要求与标准中核对来源与版本。';
    } else {
      try {
        const declaration = optionalRecord(JSON.parse(source.reference || ''));
        if (declaration.schema !== 'cablesim.execution-standards/1' || !Array.isArray(declaration.items) || declaration.items.length > 64) throw new Error('声明格式不完整');
        standards = [...new Set(declaration.items.map(value => {
          const item = optionalRecord(value), name = text(item.standard).trim();
          if (!name || name.length > 128 || !/^[a-f0-9]{64}$/.test(text(item.source_digest))) throw new Error('声明项目缺少标准名称或来源摘要');
          return name;
        }))];
        if (standards.length) {
          declarationState = 'declared'; label = standards.join('、'); reason = '当前输入已明确声明执行版本；声明不等于批准要求或计算结果。';
        }
      } catch {
        standards = []; declarationState = 'invalid'; label = '声明待核对'; reason = '已保存的执行版本声明无法完整读取；在要求与标准中重新核对，不能按未声明处理。';
      }
    }
  }
  const approvalState = 'error' in approval ? 'error' : 'ready';
  const approvedStandards = 'error' in approval ? [] : [...new Set(approval.standards)];
  if ('error' in approval) {
    label = declarationState === 'undeclared' ? '标准读取失败' : label + '；批准状态读取失败';
    reason += ' 已批准要求标准未能读取：' + approval.error;
  } else if (approvedStandards.length) {
    if (!standards.length) label += '；已有批准要求';
    reason += ' 当前已有批准要求涉及：' + approvedStandards.join('、') + '；不据此推断执行版本声明。';
  } else {
    reason += ' 尚无当前已批准要求；批准仍需在要求清单中由工程师确认。';
  }
  return { standards, approvedStandards, standardsLabel: label, standardsReason: reason, declarationState, approvalState };
}
/** Read declared SI values only; a reference standard is not an execution declaration. */
export function designSummary(document: DomainDocument, raw: Record<string, unknown>) {
  const origin = optionalRecord(raw.type_origin_reference), cable = document.cable_types[0];
  const ratings = document.cable_types.map(c => [c.rating.u0, c.rating.u].every(v => typeof v === 'number' && Number.isFinite(v) && v > 0)
    ? `${nominalNumber(c.rating.u0! / 1000)}/${nominalNumber(c.rating.u! / 1000)} kV` : '未提供');
  const sections = document.cable_types.map(c => {
    const areas = c.cores.map(core => numeric(core.conductor.nominal_area));
    return areas.length && areas.every(v => v !== null && v > 0) ? areas.every(v => v === areas[0])
      ? `${areas.length}×${nominalNumber(areas[0]! * 1e6)} mm²` : areas.map(v => nominalNumber(v! * 1e6)).join(' + ') + ' mm²' : '未提供';
  });
  const declared = raw.declared_standards;
  const standards = Array.isArray(declared) ? declared.map(v => typeof v === 'string' ? v : text(optionalRecord(v).name)).filter(Boolean).join('、') : '';
  let diameter: number | null = null;
  try { if (cable && !missingTypeInputs(document).some(item => !item.path.includes('/rating/'))) diameter = cableShape(cable, document.materials).radiusM * 2000; } catch { /* Missing/invalid geometry must remain explicit. */ }
  const kinds = new Set(Object.values(document.provenance || {}).map(v => v.kind));
  const creation = optionalRecord(raw.type_creation), saved = optionalRecord(creation.source);
  const references = optionalRecord(saved.references);
  const pages = [...new Set(Object.values(references).flatMap(value => { try { const reference = JSON.parse(text(optionalRecord(value).reference)); return Array.isArray(reference.selections) ? reference.selections.map((v: { page?: number }) => v.page).filter(Boolean) : reference.page ? [reference.page] : []; } catch { return []; } }))];
  const source = creation.kind === 'library' ? '库引用 · 版本 ' + versionLabel(text(saved.version)) : creation.kind === 'standard' ? '标准生成 · 人工确认' : creation.kind === 'import' ? '资料' + (pages.length ? ' · 第 ' + pages.join('、') + ' 页' : ' · 页码见来源') : creation.kind === 'blank' ? '空白 · 用户录入' : kinds.has('asset') ? '库引用' : kinds.has('manufacturer') ? '厂家资料' : kinds.has('user') ? '用户录入' : kinds.has('standard') ? '标准值' : kinds.has('demo') ? '演示' : '未提供';
  return { name: cleanLabel(document.name), version: versionLabel(text(origin.version)), voltage: [...new Set(ratings)].join('、'), area: [...new Set(sections)].join('、'),
    standards: standards || '未声明', source, sourceDetail: creation.kind ? JSON.stringify(saved) : text(origin.source), originName: cleanLabel(text(origin.name)), originId: text(origin.id),
    updated: localTime(text(raw.updated_at)), diameter, layers: cable ? cable.common_layers.length + cable.cores.reduce((n, core) => n + core.layers.length + 1, 0) : null };
}
