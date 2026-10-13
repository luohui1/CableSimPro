import { numeric, optionalRecord, text } from '@/api/client';
import { formatNumber } from '@/lib/format';
import type { InputSelection } from '@/components/study-inputs';

const records = (value: unknown) => Array.isArray(value) ? value.map(optionalRecord) : [];

/** Only frozen, verified inputs; current workspace edits never describe a saved run. */
export function savedFieldInputs(run: Record<string, unknown>, caseId: string, workflow?: Record<string, unknown>): InputSelection | undefined {
  if (run.integrity !== 'verified') return;
  const snapshot = optionalRecord(run.snapshot);
  const saved = records(snapshot.cases).find(value => value.case_id === caseId);
  const input = optionalRecord(saved?.input), parameters = optionalRecord(saved?.parameters);
  if (input.schema_version !== 'cablesim.domain/1') return;
  const options = optionalRecord(parameters.domain_options), load = records(input.load_cases).find(value => value.id === options.load_id);
  const circuits = records(input.circuits);
  const currents = Object.entries(optionalRecord(load?.currents)).map(([id, value], index) => {
    const circuit = circuits.find(row => row.id === id);
    return `${text(circuit?.label) || `回路 ${index + 1}`}：${formatNumber(numeric(value), 1)} A`;
  });
  const section = records(input.sections).find(value => value.id === options.section_id);
  const ambient = numeric(optionalRecord(section?.medium).surface_temperature);
  const mesh = optionalRecord(parameters.mesh), start = workflow?.current_grid_recheck ? undefined : optionalRecord(optionalRecord(workflow?.definition).parameters).mesh;
  const initial = optionalRecord(start);
  const size = numeric(initial.far_size_m) ?? numeric(mesh.far_size_m);
  const local = numeric(initial.size_m) ?? numeric(mesh.size_m);
  const bounds = Array.isArray(options.bounds_m) ? options.bounds_m.map(Number) : [];
  return { id: `saved-field-inputs:${text(run.id)}`, title: '本次计算输入', groups: [{ label: '保存输入', items: [
    { label: '负荷', value: currents.length ? currents.join('；') : '保存工况未提供电流汇总' },
    { label: '环境温度', value: ambient === null ? '未记录' : formatNumber(ambient - 273.15, 1), unit: ambient === null ? undefined : '°C' },
    { label: initial.far_size_m === undefined ? '计算网格' : '起始网格', value: `远场 ${formatNumber(size, 4)} m · 局部 ${formatNumber(local, 5)} m` },
    { label: '计算域', value: bounds.length === 4 ? `x ${formatNumber(bounds[0], 1)}～${formatNumber(bounds[2], 1)} m；z ${formatNumber(bounds[1], 1)}～${formatNumber(bounds[3], 1)} m` : '未记录' },
    { label: '外边界', value: parameters.outer_boundary === 'kennelly_image' ? 'Kennelly 镜像远场' : '保存的截断边界' },
  ] }] };
}
