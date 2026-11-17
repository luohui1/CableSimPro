import { ApiError, optionalRecord, text } from '@/api/client';
import { displayText } from '@/lib/display-names';

export interface Field { key: string; label: string; unit: string }
export interface GivenParameter { value: number | string; unit?: string; reference: string }
export interface SeriesDeclaration {
  name: string; manufacturer: string; designation: string; cores: number;
  u0_v: number; u_v: number; um_v?: number | null; standards: string[];
  origin: 'factory' | 'public' | 'demo'; common: Record<string, number>;
  common_basis: Record<string, string>; modelling: Record<string, GivenParameter>;
  source?: { title?: string; location?: string; sha256?: string; file?: string; url?: string };
  armour_material?: string;
  conductor?: 'copper' | 'aluminium'; insulation?: 'XLPE' | 'PVC';
  metal_sheath?: 'lead' | 'corrugated_aluminium' | 'smooth_aluminium'; oversheath?: 'PVC' | 'PE';
  resistance_basis?: 'stated' | 'standard_limit'; reference?: Record<string, unknown>;
}
export interface Mapping { name: string; mapping: Record<string, number>; headers: Record<string, string> }
export interface Vocabulary {
  fields: Field[]; modelling: Field[]; reference_modelling: Record<string, GivenParameter>;
  mappings: Mapping[]; supported_voltages: unknown[];
}
export interface TableColumn { index: number; letter: string; header: string; suggested: string | null; sample: (string | number | null)[] }
export interface TableSheet {
  name: string; rows: number; data_rows?: number; first_data_row?: number; title?: string;
  table: boolean; columns?: TableColumn[];
}
export interface Upload {
  upload_id: string; file: string; sha256: string; size: number; sheets: TableSheet[]; fields: Field[];
  declarations?: { sheet: string; series: SeriesDeclaration; mapping?: Record<string, number>; first_data_row?: number }[];
}
export interface ValueSource {
  key: string; label: string; value: number | string | null; unit: string;
  display_value?: number | string; display_unit?: string;
  usage?: 'catalogue_result';
  source: unknown; confidence?: string; method_version?: string; method?: unknown;
}
export interface ImportIssue { column?: string; field?: string; message: string }
export interface PreviewRow {
  row_number: number; status: 'ready' | 'incomplete' | 'error'; name?: string; key?: string;
  values: ValueSource[]; issues: ImportIssue[]; missing: (string | ImportIssue)[];
}
export interface Preview {
  preview_id: string; preview_digest: string; file: string; sha256: string; sheet: string;
  series: SeriesDeclaration; rows: PreviewRow[]; valid_count: number; error_count: number; incomplete_count: number;
  execution_standards?: { items: { declared: string; standard: string; edition: string; source_digest: string; method: unknown }[]; missing: { declared: string; reason: string }[] };
}
export interface CommitReceipt {
  series_id: string; created: number; skipped?: number;
  specs: { id: string; model_id: string; workspace_id?: string; name: string; version: number }[];
}
export interface SeriesSummary {
  id: string; name: string; manufacturer: string; designation: string; cores: number;
  u0_v: number; u_v: number; spec_count: number; states?: Record<string, number>;
}
export interface LibrarySpec {
  id: string; name: string; area_m2: number; version: number; model_id: string; workspace_id?: string;
  content_sha256: string; state: string; missing: (string | ImportIssue)[]; values: ValueSource[];
  workspace_revision?: number; has_design_changes?: boolean;
  results?: Record<string, unknown> | unknown[];
}
export interface SeriesDetail { series: SeriesSummary; specs: LibrarySpec[] }

export interface CatalogueMetric {
  published: number | null; value: number | null; unit: string;
  difference: number | null; relative_difference: number | null;
  status: 'declared_input' | 'missing' | 'refused' | 'compared'; reason: string;
  method?: unknown; tier?: unknown; missing_fields?: { field: string; label: string; reason: string }[];
}
export interface CatalogueComparisonRow {
  key: string; sheet: string; table: string; area_mm2: number; designation: string;
  metrics: Record<string, CatalogueMetric>; source: unknown;
}
export interface CatalogueComparisonSummary {
  specifications: number; ampacity_compared: number; ampacity_refused: number;
  ampacity_mean_absolute_relative_difference: number | null;
  ampacity_max_absolute_relative_difference: number | null; weight_compared: number; four_metric_passed?: number;
}
export interface ReferenceAssumption {
  key: string; label: string; value: unknown; unit: string | null;
  source: { kind: string; reference: string; version: string; file_sha256?: string };
  confidence: 'reference'; manufacturer_data: false;
}
export interface CatalogueComparisonReport {
  sample_id: string; source: unknown; scope: string; rows: CatalogueComparisonRow[];
  summary: CatalogueComparisonSummary & { four_metric_passed: number };
  reference_scenario: {
    id: string; requires_confirmation: true; confirmed: boolean; executed: boolean;
    manufacturer_data: false; scope: string; method: { name: string; version: string };
    assumptions: ReferenceAssumption[]; raw_assumptions: Record<string, unknown>;
  };
  reference_calculation: {
    rows: CatalogueComparisonRow[]; summary: CatalogueComparisonSummary; method: unknown;
    scope: string; human_reviewed: false; manufacturer_comparison: false;
  } | null;
}

const BASE = '/api/type-library';
export async function libraryRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(BASE + path, { credentials: 'same-origin', cache: 'no-store', ...init });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = optionalRecord(body).detail ?? body;
    const note = typeof detail === 'string' ? detail : Array.isArray(detail)
      ? detail.map(item => text(optionalRecord(item).msg) || text(optionalRecord(item).message)).filter(Boolean).join('；')
      : text(optionalRecord(detail).message) || '读取或保存失败，请重试。';
    throw new ApiError(response.status, note, detail);
  }
  if (body === null) throw new ApiError(502, '服务没有返回可读取的数据。');
  return body as T;
}
export function libraryPost<T>(path: string, body: unknown): Promise<T> {
  return libraryRequest<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CableSim-Actor': 'human' }, body: JSON.stringify(body) });
}
export function catalogueComparison(sample: string, referenceScenarioConfirmed = false): Promise<CatalogueComparisonReport> {
  return libraryPost(`/catalogue-comparison/${sample}`, referenceScenarioConfirmed ? { reference_scenario_confirmed: true } : {});
}
const SOURCE_SECTIONS: Record<string, string> = { 'construction table': '结构表', 'technical information': '技术信息', 'rating assumptions': '载流量计算假设' };
export function sourceLocationText(value: string): string {
  return value.replace(/(construction table|technical information|rating assumptions): printed p\. (\d+) \/ PDF p\. (\d+)/g,
    (_match, section: string, printedPage: string, pdfPage: string) => `${SOURCE_SECTIONS[section]}：印刷第 ${printedPage} 页 / PDF 第 ${pdfPage} 页`);
}
export function sourceText(source: unknown): string {
  if (typeof source === 'string') return source;
  const row = optionalRecord(source);
  const catalogue = optionalRecord(row.catalogue);
  const reference = optionalRecord(row.reference);
  const record = optionalRecord(reference.record);
  const basis = text(row.reference) || text(row.title) || text(row.basis)
    || [text(reference.standard), text(reference.edition), text(reference.locator), text(record.reference)].filter(Boolean).join(' · ');
  const original = [text(catalogue.title), sourceLocationText(text(catalogue.location))].filter(Boolean).join(' · ');
  const location = [row.file, row.sheet, row.row_number ? `第 ${row.row_number} 行` : row.row ? `第 ${row.row} 行` : '', row.column].filter(Boolean).join(' · ');
  if (row.origin === 'standard') return ['标准上限，非厂家实测值', basis, location ? `关联规格：${location}` : ''].filter(Boolean).join('；');
  return [row.kind === 'demo' ? '结构演示' : '', basis, original, location].filter(Boolean).join('；') || '来源未登记';
}
export function methodText(method: unknown): string {
  const value = optionalRecord(method);
  const names: Record<string, string> = { 'cablesim.iec60287': 'IEC 60287 稳态载流量', 'cablesim.standard-check': '电缆标准核对', 'cablesim.standards-basis': '标准依据库' };
  return [text(value.name) || text(value.method_name) || names[text(value.plugin_id)], text(value.method_version) || text(value.version) || text(value.plugin_version)].filter(Boolean).join(' · ') || '方法版本未登记';
}
export function issueText(value: string | ImportIssue): string { return typeof value === 'string' ? value : value.message; }
export function displayLibraryText(value: string): string {
  return displayText(value.replace(/cable_types\/(?:cable_type\/)?[^/\s]+\/cores\/layers\/metallic_screen\/longitudinal_r20/g, '金属屏蔽纵向电阻'));
}
export function confidenceText(value?: unknown): string {
  const key = typeof value === 'string' ? value : text(optionalRecord(value).tier);
  return ({ manufacturer: '厂家资料', public: '公开资料', reference: '参考', reference_only: '参考', reviewed: '已人工核对', unverified: '待核对', incomplete: '缺项', deliverable: '可交付', exploratory: '探索' } as Record<string, string>)[key] || '待核对';
}
