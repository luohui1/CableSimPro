import { ApiError, optionalRecord, text } from '@/api/client';

export type ReferenceCategory = 'materials' | 'environment';
export type ReferenceValue = string | number | boolean | null | ReferenceValue[] | { [key: string]: ReferenceValue };
export type Conditions = Record<string, ReferenceValue>;
export interface SIQuantity { value: number; unit: string; dimension: string }
export interface ReferenceMethod { name: string; version: string; method_version: string; plugin_id?: string }
export interface ReferenceTrust { grade: string; label: string; reason?: string }
export interface ReferenceSelection {
  release_digest: string; data_sha256: string; standard: string; edition: string;
  locator: string; quantity: string; record_id: string; conditions: Conditions;
}
export interface ReferenceRecord {
  id: string; standard: string; edition: string; clause: string; table: string; title: string;
  row_label: string; value: ReferenceValue; conditions: Conditions; citation: string;
  quantity: { key: string; name: string; dimension: string; unit: string };
  printed_page: string | number | null; pdf_page: number | null; source_file: string;
  source_sha256: string; record_sha256: string; semantic: string; limitations: string[];
  trust?: ReferenceTrust; selectable?: boolean; method_version?: string;
  verification?: { status: string; methods?: { id?: string; description?: string; source_sha256?: string; independent?: boolean }[] };
}
export interface ReferenceTable {
  id: string; standard: string; edition: string; title: string; table: string; clause: string;
  record_count: number; quantities: ReferenceRecord['quantity'][];
}
export interface ReferenceCatalogue {
  tables: ReferenceTable[]; limitations: string[]; not_covered: ReferenceValue;
  release_digest: string; data_sha256: string; method: ReferenceMethod;
}
export interface ReferenceTableData {
  table: ReferenceTable; rows: ReferenceRecord[]; method: ReferenceMethod;
  release_digest: string; data_sha256: string;
}
export interface ReferenceReceipt {
  record: ReferenceRecord; trust: ReferenceTrust; conditions: Conditions;
  method: ReferenceMethod; quantity: SIQuantity | null; quantity_status: 'available' | 'unsupported';
  quantity_reason: string; release_digest: string; data_sha256: string;
  request_sha256: string; artifact_sha256: string;
}
export interface ReferenceEvidence {
  parameter: string; quantity: SIQuantity; selection: ReferenceSelection; receipt: ReferenceReceipt;
  record_sha256: string;
}
export interface ReferenceChoice {
  id: string; parameter: string; selection: ReferenceSelection; receipt: ReferenceReceipt;
}
export interface AssetSummary {
  id: string; asset_id: string; version: string; kind: string; name: string; status: string;
  revision: number; content_sha256: string;
}
export interface ReferenceAsset extends AssetSummary {
  release: { reference_evidence?: ReferenceEvidence[]; parameters: { name: string; quantity: SIQuantity }[];
    sources: { kind: string; reference: string; reviewed: boolean }[] };
  issues: { code: string; message: string }[];
}
export interface ReferenceDraftPreview {
  release: ReferenceAsset['release'] & { name: string; version: string; kind: string };
  content_sha256: string; preview_digest: string;
}
export interface MaterialTarget {
  id: string; name: string; role: string; input_digest: string | null; state: string; reason: string;
  binding: { resource_id: string; content_sha256: string; name: string; version: string } | null;
}
export interface TypeResourceView { workspace_id: string; revision: number; targets: MaterialTarget[] }
export interface BindingPreview {
  workspace_id: string; revision: number; digest: string;
  rows: { id: string; name: string; layer_count: number;
    before_resource: { name: string; version: string } | null;
    after_resource: AssetSummary;
    differences: { field: string; label: string; unit: string; before: ReferenceValue; after: ReferenceValue }[] }[];
}
export interface MaterialPreviewRequest {
  workspace_id: string; expected_revision: number; material_id: string; property: string;
  resource_id: string; content_sha256: string;
}
export interface MaterialPreview {
  preview_digest: string; workspace_id: string; revision: number; material_name: string; property: string;
  evidence: ReferenceEvidence; adoptable: boolean; reason: string; limitations: string[];
  comparison: {
    label: string; unit: string; actual: number | null; delta: number | null; percent: number | null;
    design_source: { kind?: string; reference?: string };
    condition_checks: { condition: string; required: ReferenceValue; selected: ReferenceValue; actual: ReferenceValue;
      status: string; reason: string }[];
  };
}
export interface RatingRow {
  case_id: string; name: string; layout: string; depth_m: number; soil_rho_k_m_w: number;
  ambient_temperature_c: number; frequency_hz: number; spacing_m: number | null;
  bonding: string; rating_basis: string; source: string;
  duct_inner_m?: number; duct_outer_m?: number; duct_rho_k_m_w?: number;
}
export interface EnvironmentPreviewRequest {
  workspace_id: string; expected_revision: number; row: RatingRow;
  resources: { resource_id: string; content_sha256: string; parameter: string }[];
  conditions: Conditions;
}
export interface EnvironmentPreview {
  preview_digest: string; before: RatingRow; proposed: RatingRow; limitations: string[];
  changes: { parameter: string; before: number; after: number; quantity: SIQuantity; reference_evidence: ReferenceEvidence }[];
}

function requestError(detail: unknown): string {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map(item => {
    const row = optionalRecord(item);
    return text(row.msg) || '填写的资料不完整';
  }).join('；');
  return text(optionalRecord(detail).message) || '资料接口未返回可用数据，请重新读取。';
}
export async function referenceRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...init });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const detail = optionalRecord(payload).detail ?? payload;
    throw new ApiError(response.status, requestError(detail), detail);
  }
  return payload as T;
}
export function referencePost<T>(path: string, body: unknown): Promise<T> {
  return referenceRequest<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CableSim-Actor': 'human' }, body: JSON.stringify(body) });
}

export const parameterNames: Record<string, string> = {
  density: '密度', volumetric_heat_capacity: '体积热容', electrical_resistivity_20: '20 °C 电阻率',
  relative_permittivity: '相对介电常数', thermal_resistivity: '热阻率', depth_m: '原文电缆埋深（基准待核）',
  soil_rho_k_m_w: '土壤热阻率', ambient_temperature_c: '环境温度',
};
export const assetStatusNames: Record<string, string> = { draft: '草稿', reviewed: '已核对来源', published: '已发布参考版本', deprecated: '已停用' };
export function referenceTarget(category: ReferenceCategory, row: ReferenceRecord): string | null {
  if (category === 'materials') return ({
    mass_density: 'density', volumetric_heat_capacity: 'volumetric_heat_capacity',
    resistivity_20_ohm_m: 'electrical_resistivity_20', relative_permittivity: 'relative_permittivity',
    thermal_resistivity: 'thermal_resistivity', thermal_resistivity_k_m_w: 'thermal_resistivity',
  } as Record<string, string>)[row.quantity.key] ?? null;
  if (!['iec60287-3-1-table1/', 'iec60287-3-1-table2/', 'iec60287-3-1-annex-a4/'].some(prefix => row.id.startsWith(prefix))) return null;
  return ({ laying_depth: 'depth_m', thermal_resistivity: 'soil_rho_k_m_w', soil_thermal_resistivity: 'soil_rho_k_m_w',
    ground_temperature_summer: 'ambient_temperature_c', ground_temperature_winter: 'ambient_temperature_c',
    ground_min_c: 'ambient_temperature_c', ground_max_c: 'ambient_temperature_c',
    air_temperature_maximum: 'ambient_temperature_c', air_temperature_minimum: 'ambient_temperature_c',
    air_min_c: 'ambient_temperature_c', air_max_c: 'ambient_temperature_c',
  } as Record<string, string>)[row.quantity.key] ?? null;
}
