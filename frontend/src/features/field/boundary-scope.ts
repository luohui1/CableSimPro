import { optionalRecord, text } from '@/api/client';

/** Describes eligibility only; the plugin validates the selected SI input. */
export function boundaryScope(input: unknown, parameters: Record<string, unknown>) {
  const domain = optionalRecord(input), selection = optionalRecord(parameters.domain_options);
  const sections = Array.isArray(domain.sections) ? domain.sections.map(optionalRecord) : [];
  const loads = Array.isArray(domain.load_cases) ? domain.load_cases.map(optionalRecord) : [];
  const section = sections.find(row => row.id === selection.section_id), load = loads.find(row => row.id === selection.load_id);
  let reason: string | undefined;
  if (!section || !load) reason = '选定截面与负荷尚未保存，不能判断远场适用性';
  else if (section.kind !== 'ground') reason = '地下均匀土壤的默认边界不适用于此截面';
  else if (Array.isArray(section.soil_layers) && section.soil_layers.length) reason = '分层土壤不满足均匀半无限土壤假设';
  else if (section.backfill) reason = '回填区不满足均匀半无限土壤假设';
  else if (load.kind !== 'steady') reason = '远场默认只覆盖稳态负荷';
  else if (typeof optionalRecord(section.medium).surface_temperature !== 'number' || !Number.isFinite(optionalRecord(section.medium).surface_temperature)) reason = '尚未保存恒温地表边界';
  const chosen = text(parameters.outer_boundary);
  return { label: chosen === 'ambient_truncated' ? '恒温截断（显式选择）' : reason ? '需显式选择边界' : '镜像远场（默认）', reason };
}
