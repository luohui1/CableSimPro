/** Read saved, host-verified artifacts. This module never calculates a thermal solution. */
export type RecordValue = Record<string, unknown>;
export type Curve = { id: string; times: number[]; values: number[]; unit: '°C' | 'A'; label: string; crossing: number | null };
export type History = { curves: Curve[]; times: number[]; description: string };
export type NetworkState = { current: number; profiles: { phase: string; temperatures: number[] }[]; losses: number[] };
export type Network = {
  layers: { label: string; radius: number }[];
  positions: [number, number][];
  resistances: number[];
  mutual: number[][];
  ambient: number;
  limit: number;
  operating: NetworkState | null;
  rating: NetworkState;
  operatingError: string;
};
export type ResistanceBalance = { labels: string[]; values: number[]; notes: string; current: number };
export type SavedField = { points: [number, number][]; triangles: number[]; temperatures: number[]; minimum: number; maximum: number };
export type WorkbenchData = {
  runId: string; caseId: string; artifacts: { key: string; digest: string }[];
  network: Network | null; balance: ResistanceBalance | null; history: History | null;
  cad: unknown; field: SavedField | null; warnings: string[]; historical: boolean;
};
const digest = /^[0-9a-f]{64}$/;
export function object(value: unknown, name = '数据'): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name}不是有效对象。`);
  return value as RecordValue;
}
export function list(value: unknown, name: string, maximum = 200_000): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`${name}不是有效数组，或超出显示预算。`);
  return value;
}
export function number(value: unknown, name: string, minimum = -Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) throw new Error(`${name}不是有效数值。`);
  return value;
}
function string(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096) throw new Error(`${name}缺失或过长。`);
  return value;
}
function numbers(value: unknown, name: string, minimum = -Infinity): number[] {
  return list(value, name).map(v => number(v, name, minimum));
}
function warnings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap(v => typeof v === 'string' ? [v] : v && typeof v === 'object' && typeof (v as RecordValue).message === 'string' ? [(v as RecordValue).message as string] : []);
}
export function caseOptions(value: unknown): { id: string; status: string }[] {
  const run = object(value, '运行');
  if (run.integrity !== 'verified') throw new Error('运行未通过完整性校验，不能显示结果。');
  const cases = list(object(run.output, '输出').cases, '工况', 1024).map(v => object(v, '工况'));
  const ids = cases.map(c => string(c.case_id, '工况标识'));
  if (new Set(ids).size !== ids.length) throw new Error('工况标识重复。');
  return cases.map((c, i) => ({ id: ids[i], status: typeof c.status === 'string' ? c.status : 'unknown' }));
}
function networkState(value: unknown, layers: Network['layers']): NetworkState {
  const state = object(value, '热网络状态');
  const profiles = list(state.radial_profiles, '径向温度', 3).map(v => {
    const profile = object(v), phase = string(profile.phase, '相别');
    const points = list(profile.points, '径向节点', 32).map(p => object(p));
    if (points.length !== layers.length || !['A', 'B', 'C'].includes(phase)) throw new Error('热网络节点或相别不匹配。');
    const temperatures = points.map((p, i) => {
      if (Math.abs(number(p.radius_mm, '节点半径', 0) / 1000 - layers[i].radius) > 1e-8) throw new Error('温度节点与保存几何半径不一致。');
      return number(p.temperature_c, '节点温度', -273.15);
    });
    return { phase, temperatures };
  });
  if (profiles.length !== 3 || new Set(profiles.map(p => p.phase)).size !== 3) throw new Error('缺少完整三相温度。');
  const losses = numbers(state.total_losses_w_m, '每相损耗', 0);
  if (losses.length !== 3) throw new Error('每相损耗数量不匹配。');
  return { current: number(state.current_a, '电流', 0), profiles, losses };
}
export function readNetwork(value: unknown): Network {
  const data = object(value, '热网络工件');
  if (data.model_version !== 'MV-THERMAL-0.1.0' || !digest.test(String(data.input_sha256))) throw new Error('不支持的热网络版本或输入摘要。');
  const geometry = object(data.geometry), thermal = object(data.thermal), input = object(data.input);
  const layers = list(geometry.layers, '同心等效层', 32).map(v => {
    const layer = object(v);
    return { label: string(layer.name, '层名'), radius: number(layer.radius_mm, '层半径', Number.MIN_VALUE) / 1000 };
  });
  if (layers.length !== 6 || layers.some((layer, i) => i > 0 && layer.radius <= layers[i - 1].radius)) throw new Error('热网络几何半径必须严格递增。');
  const positions = list(geometry.positions_m, '三相位置', 3).map(v => {
    const p = numbers(v, '相位坐标');
    if (p.length !== 2 || p[1] <= 0) throw new Error('直埋热网络需要 x 与正埋深。');
    return [p[0], -p[1]] as [number, number];
  });
  if (positions.length !== 3) throw new Error('该热网络协议要求三相位置。');
  const resistances = numbers(thermal.layer_resistances_k_m_w, '层热阻', Number.MIN_VALUE);
  if (resistances.length !== layers.length - 1) throw new Error('层热阻与节点数不一致。');
  const mutual = list(thermal.soil_matrix_k_m_w, '土壤影响矩阵', 3).map(row => numbers(row, '土壤影响系数', 0));
  if (mutual.length !== 3 || mutual.some(row => row.length !== 3)) throw new Error('土壤影响矩阵必须为 3×3。');
  return { layers, positions, resistances, mutual,
    ambient: number(object(input.installation).ambient_temperature_c, '环境温度', -273.15),
    limit: number(object(input.cable).max_temperature_c, '导体温限', -273.15),
    operating: data.operating == null ? null : networkState(data.operating, layers),
    rating: networkState(data.rating, layers),
    operatingError: typeof data.operating_error === 'string' ? data.operating_error : '未保存有效运行点。' };
}
export function readHistory(value: unknown): History {
  const data = object(value, '温度历史');
  if (data.schema_version !== 'cablesim.temperature-history/1' || data.temperature_unit !== 'K' || data.time_unit !== 's') throw new Error('温度历史协议或单位不受支持。');
  let total = 0;
  const curves = list(data.curves, '温度曲线', 128).map(v => {
    const curve = object(v), id = string(curve.entity, '曲线对象');
    const times = numbers(curve.time_s, '时间', 0), raw = numbers(curve.maximum_temperature_k, '绝对温度', Number.MIN_VALUE);
    total += times.length;
    if (!times.length || total > 200_000 || times.length !== raw.length || times.some((t, i) => i > 0 && t <= times[i - 1])) throw new Error('时间序列为空、过大、不递增或温度数量不匹配。');
    const crossing = curve.limit_crossing == null ? null : object(curve.limit_crossing).time_s;
    return { id, times, values: raw.map(t => t - 273.15), unit: '°C' as const, label: '导体最高温度', crossing: crossing == null ? null : number(crossing, '温限到达时间', 0) };
  });
  if (!curves.length || new Set(curves.map(c => c.id)).size !== curves.length) throw new Error('温度曲线为空或对象重复。');
  return { curves, times: [...new Set(curves.flatMap(c => c.times))].sort((a, b) => a - b), description: '真实保存时间步；不同采样网格只保持上一保存值，不插值、不外推。' };
}
function readEmergency(value: unknown): History {
  const data = object(value);
  if (data.schema !== 'cablesim.iec60853-emergency-result/1') throw new Error('应急载流量协议不受支持。');
  const rows = list(data.current_curve, '允许电流曲线', 10_000).map(v => object(v));
  const times = rows.map(row => number(row.time_s, '持续时间', Number.MIN_VALUE));
  if (!times.length || times.some((t, i) => i > 0 && t <= times[i - 1])) throw new Error('应急持续时间必须严格递增。');
  const curve: Curve = { id: string(object(data.input).circuit_id, '回路'), times, values: rows.map(row => number(row.permissible_current_a, '允许电流', 0)), unit: 'A', label: '该持续时长的允许电流', crossing: null };
  return { curves: [curve], times, description: 'IEC 60853 保存的允许电流—持续时长曲线；不是实际运行电流，也不是导体温度时间历史。' };
}
export function readWorkbench(value: unknown, caseId: string): WorkbenchData {
  const run = object(value), options = caseOptions(run);
  if (!options.some(c => c.id === caseId)) throw new Error('指定工况不存在；没有替换为其他工况。');
  const selected = list(object(run.output).cases, '工况').map(v => object(v)).find(c => c.case_id === caseId)!;
  if (selected.status !== 'succeeded') throw new Error('该工况尚无成功结果。');
  const raw = object(selected.artifacts ?? {}, '工件'), statuses = object(object(run.artifact_status ?? {})[caseId] ?? {}), digests = object(selected.artifact_digests ?? {});
  const artifacts: WorkbenchData['artifacts'] = [];
  function verified(key: string): RecordValue | null {
    if (!(key in raw)) return null;
    if (object(statuses[key] ?? {}).status !== 'verified' || !digest.test(String(digests[key]))) throw new Error(`${key} 未通过工件校验或缺少摘要。`);
    const data = object(raw[key], key);
    if (key === 'x-cablesim.temperature-history' || key === 'x-cablesim.temperature-field') {
      const source = object(data.source ?? data.producer, '历史来源');
      if (!digest.test(String(digests['x-cablesim.simulation-bundle'])) || source.bundle_sha256 !== digests['x-cablesim.simulation-bundle']) throw new Error('温度历史没有绑定同次原始场束。');
    }
    artifacts.push({ key, digest: digests[key] as string });
    return data;
  }
  const networkData = verified('x-cablesim.thermal-network-rating');
  const trace = verified('x-cablesim.iec60287-trace');
  const historyData = verified('x-cablesim.temperature-history');
  const emergency = verified('x-cablesim.iec60853-emergency');
  const cad = verified('x-cablesim.cad-scene');
  const fieldData = verified('x-cablesim.temperature-field');
  let balance: ResistanceBalance | null = null;
  if (trace?.rating_components) {
    const b = object(trace.rating_components);
    if (b.schema !== 'cablesim.rating-components/1') throw new Error('热阻分解协议不受支持。');
    balance = { labels: ['T₁ 绝缘', 'T₂ 内衬', '金属层', 'T₃ 外护套', 'T₄ 外部'],
      values: ['t1_k_m_w', 't2_k_m_w', 'metal_k_m_w', 't3_k_m_w', 't4_k_m_w'].map(key => number(b[key], key, 0)),
      notes: typeof b.notes === 'string' ? b.notes : '额定点等效系数；不据此推导缺失的节点温度或热容。', current: number(b.ampacity_a, '额定电流', 0) };
  }
  return { runId: string(run.id, '运行标识'), caseId, artifacts, cad, field: fieldData ? readField(fieldData) : null,
    network: networkData ? readNetwork(networkData) : null, balance,
    history: historyData ? readHistory(historyData) : emergency ? readEmergency(emergency) : null,
    warnings: [...warnings(selected.warnings), ...warnings(networkData?.warnings), ...warnings(trace?.limitations), ...warnings(emergency?.limitations)],
    historical: run.freshness === 'historical' };
}
/** Last actual sample at/before time, never extrapolated outside the recorded interval. */
export function sampleAt(curve: Curve, time: number): { index: number; time: number; value: number; held: boolean } | null {
  if (!Number.isFinite(time) || time < curve.times[0] || time > curve.times[curve.times.length - 1]) return null;
  let low = 0, high = curve.times.length;
  while (low < high) { const mid = (low + high) >>> 1; if (curve.times[mid] <= time) low = mid + 1; else high = mid; }
  const index = low - 1;
  return { index, time: curve.times[index], value: curve.values[index], held: curve.times[index] !== time };
}
export function indexAt(times: readonly number[], time: number): number {
  let low = 0, high = times.length;
  while (low < high) { const mid = (low + high) >>> 1; if (times[mid] <= time) low = mid + 1; else high = mid; }
  return Math.max(0, low - 1);
}
/** Keep both extrema in every bucket; only display vertices are reduced, never playback data. */
export function chartIndices(values: readonly number[], budget = 1200): number[] {
  if (!Number.isInteger(budget) || budget < 4) throw new Error('曲线显示预算无效。');
  if (values.length <= budget) return values.map((_, i) => i);
  const indices = new Set([0, values.length - 1]), buckets = Math.floor((budget - 2) / 2);
  for (let b = 0; b < buckets; b++) {
    const start = 1 + Math.floor(b * (values.length - 2) / buckets), end = 1 + Math.floor((b + 1) * (values.length - 2) / buckets);
    let min = start, max = start;
    for (let i = start + 1; i < end; i++) { if (values[i] < values[min]) min = i; if (values[i] > values[max]) max = i; }
    indices.add(min); indices.add(max);
  }
  return [...indices].sort((a, b) => a - b);
}

export function readField(value: unknown): SavedField {
  const data = object(value, '节点温度场'), mesh = object(data.mesh, '温度场网格');
  if (data.schema_version !== 'cablesim.temperature-field/1' || data.association !== 'node' || data.temperature_unit !== 'K' || mesh.length_unit !== 'm' || mesh.coordinates !== 'section-x-z; z-up') throw new Error('温度场协议、单位或坐标不支持。');
  const points = list(mesh.points, '温度节点', 200_000).map(v => {
    const point = numbers(v, '节点坐标'); if (point.length !== 2) throw new Error('需要二维 x/z 节点。'); return point as [number, number];
  });
  const temperatures = numbers(data.temperature_k, '节点绝对温度', Number.MIN_VALUE).map(v => v - 273.15);
  if (points.length < 3 || points.length !== temperatures.length) throw new Error('温度与节点数量不一致。');
  const triangles = list(mesh.triangles, '温度场单元', 400_000).flatMap(v => {
    const face = numbers(v, '单元节点', 0); if (face.length !== 3 || new Set(face).size !== 3 || face.some(i => !Number.isInteger(i) || i >= points.length)) throw new Error('温度场单元索引无效。'); return face;
  });
  if (!triangles.length) throw new Error('温度场没有三角形单元。');
  let minimum = Infinity, maximum = -Infinity; for (const t of temperatures) { minimum = Math.min(minimum, t); maximum = Math.max(maximum, t); }
  return { points, triangles, temperatures, minimum, maximum };
}
