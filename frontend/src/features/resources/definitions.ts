import type { components } from '@/api/generated/schema';
import type { SourceKind } from '@/components/source-badge';
import { displayUnit } from '@/lib/display-names';

export type AssetRelease = components['schemas']['AssetRelease'];
export type AssetKind = AssetRelease['kind'];
export type AssetStatus = 'draft' | 'reviewed' | 'published' | 'deprecated';
export type AssetAction = components['schemas']['TransitionAsset']['action'];
export type Asset = {
  id: string; asset_id: string; name: string; kind: AssetKind; version: string;
  status: AssetStatus; revision: number; content_sha256: string; reviewed_sha256: string | null;
  release: AssetRelease; issues: { code: string; message: string }[];
  events: { revision: number; action: string; note: string; created: string; content_sha256: string }[];
};
export const assetKinds: Record<AssetKind, string> = { material: '材料', component: '部件', assembly: '结构', installation: '敷设模板', study_template: '计算方案', rule: '规则' };
export const assetStatuses: Record<AssetStatus, string> = { draft: '草稿', reviewed: '已审核', published: '已发布', deprecated: '已停用' };
export const assetActions: Record<AssetAction, string> = { review: '核对来源', publish: '发布', return_to_draft: '退回草稿', deprecate: '停用' };
export const actionStates: Record<AssetAction, { from: AssetStatus; to: AssetStatus }> = {
  review: { from: 'draft', to: 'reviewed' }, publish: { from: 'reviewed', to: 'published' },
  return_to_draft: { from: 'reviewed', to: 'draft' }, deprecate: { from: 'published', to: 'deprecated' },
};
export const sourceKinds: Record<AssetRelease['sources'][number]['kind'], { label: string; badge: SourceKind }> = {
  manufacturer: { label: '厂家资料', badge: 'document' }, standard: { label: '标准依据', badge: 'standard' },
  literature: { label: '文献资料', badge: 'document' },
  project_input: { label: '工程师填写', badge: 'user' }, derived: { label: '推导', badge: 'derived' },
};
export const assetUnit = (unit: string) => ({ degC: '°C', delta_degC: '°C（温差）', delta_K: 'K（温差）', m2: 'm²', mm2: 'mm²',
  'kg/m3': 'kg/m³', 'J/(m3.K)': 'J/(m³·K)' }[unit] || displayUnit(unit));

// This is the host's Quantity contract, not a new physical-property registry.
// Unsupported dimensions remain absent instead of being relabelled to fit a unit.
export const quantityKinds = {
  length: { label: '长度', units: ['m', 'mm'] }, area: { label: '面积', units: ['m2', 'mm2'] },
  absolute_temperature: { label: '温度', units: ['degC', 'K'] }, temperature_difference: { label: '温差', units: ['delta_K', 'delta_degC'] },
  linear_resistance: { label: '单位长度电阻', units: ['ohm/m', 'ohm/km'] }, thermal_resistivity: { label: '热阻率', units: ['K.m/W'] },
  thermal_conductivity: { label: '热导率', units: ['W/(m.K)'] }, current: { label: '电流', units: ['A'] }, frequency: { label: '频率', units: ['Hz'] },
  mass_density: { label: '密度', units: ['kg/m3'] }, resistivity: { label: '电阻率', units: ['ohm.m'] },
  volumetric_heat_capacity: { label: '体积热容', units: ['J/(m3.K)'] }, dimensionless: { label: '无量纲', units: ['1'] },
} satisfies Record<components['schemas']['Quantity']['dimension'], { label: string; units: string[] }>;
export type Dimension = keyof typeof quantityKinds;
export const parameterPresets: { name: string; label: string; dimension: Dimension }[] = [
  { name: 'thermal_resistivity', label: '热阻率', dimension: 'thermal_resistivity' },
  { name: 'thermal_conductivity', label: '热导率', dimension: 'thermal_conductivity' },
  { name: 'burial_depth', label: '埋深', dimension: 'length' },
  { name: 'conductor_area', label: '导体截面', dimension: 'area' },
  { name: 'conductor_limit', label: '导体温度上限', dimension: 'absolute_temperature' },
  { name: 'ambient_temperature', label: '环境温度', dimension: 'absolute_temperature' },
  { name: 'temperature_rise', label: '温升', dimension: 'temperature_difference' },
  { name: 'linear_resistance', label: '单位长度电阻', dimension: 'linear_resistance' },
  { name: 'current', label: '电流', dimension: 'current' },
  { name: 'frequency', label: '频率', dimension: 'frequency' },
];
export const validVersion = (value: string) => value.length <= 64 && /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(value);
export const validIdentifier = (value: string) => value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/.test(value);
export function transitionProblem(asset: Asset, action: AssetAction) {
  if (asset.status !== actionStates[action].from) return `${assetActions[action]}需要${assetStatuses[actionStates[action].from]}；当前为${assetStatuses[asset.status]}。`;
  if (['review', 'publish'].includes(action) && asset.issues.length) return asset.issues.map(issue => issue.message).join('；');
  if (action === 'publish' && asset.reviewed_sha256 !== asset.content_sha256) return '核对记录不属于当前内容，请退回草稿后重新核对。';
  return '';
}
export function comparableRelease(release: AssetRelease) {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
  return JSON.stringify(canonical({ ...release, parameters: (release.parameters || []).map(parameter => ({ ...parameter, overridable: parameter.overridable ?? false })),
    dependencies: release.dependencies || [], files: release.files || [], geometry_recipe: release.geometry_recipe ?? null }));
}
