import { text, numeric, optionalRecord } from '@/api/client';
import { formatDateTime } from '@/lib/format';
import { readableRunName } from '@/lib/status-vocabulary';
import { entityLabel, savedDomain } from '@/lib/domain-fields';

/** Legacy host rating-table layout names; no conditions or values are inferred. */
const savedLayouts: Record<string,string> = {
  three_core_buried_single:'三芯直埋 · 单回', three_core_buried_horizontal:'三芯直埋 · 水平排列',
  three_core_ducts_horizontal:'三芯排管 · 水平排列', trefoil:'直埋 · 品字形', flat:'直埋 · 平行排列', ducts:'排管', air:'空气敷设',
};
export function savedCaseLabel(run: Record<string,unknown>, id: string) {
  if (savedLayouts[id]) return savedLayouts[id];
  const cases = optionalRecord(run.output).cases;
  const index = (Array.isArray(cases) ? cases : []).findIndex(row=>optionalRecord(row).case_id===id);
  return text(optionalRecord(optionalRecord(run.saved_case_labels)[id]).label) || `工况 ${Math.max(0,index)+1}`;
}
export function savedEntityLabel(run: Record<string,unknown>, caseId: string, id: string) {
  const fixed = text(optionalRecord(optionalRecord(optionalRecord(run.saved_case_labels)[caseId]).entities)[id]);
  if (fixed) return fixed;
  const cases = optionalRecord(run.snapshot).cases;
  const input = optionalRecord((Array.isArray(cases) ? cases : []).map(optionalRecord).find(row=>row.case_id===caseId)?.input);
  const label = entityLabel(Object.keys(input).length ? input : savedDomain(run), id);
  return label && label!==id ? label : id ? '保存对象（名称未记录）' : '';
}

/** Saved sequence and timestamp identify a run, never its current study name. */
export function savedRunLabel(run: Record<string, unknown>, fallback = '保存运行', studyName = '') {
  const sequence = numeric(run.sequence);
  const name = sequence !== null ? readableRunName(`保存研究 · 运行 ${sequence}`) : fallback;
  return `${studyName ? studyName + ' · ' : ''}${name} · ${formatDateTime(text(run.created))}`;
}
