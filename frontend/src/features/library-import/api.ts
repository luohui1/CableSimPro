import { ApiError, optionalRecord, record, text } from '@/api/client';
import { displayText } from '@/lib/display-names';

export interface Field { key: string; label: string; unit: string }
export interface GivenParameter { value: number | string; unit?: string; reference: string }
export interface DeclaredMaterialProperty { value: number; unit: string; reference: string }
export interface SeriesDeclaration {
  name: string; manufacturer: string; designation: string; cores: number;
  u0_v: number; u_v: number; um_v?: number | null; standards: string[];
  origin: 'factory' | 'public' | 'demo'; common: Record<string, number>;
  common_basis: Record<string, string>; modelling: Record<string, GivenParameter>;
  material_properties?: Record<string, Record<string, DeclaredMaterialProperty>>;
  source?: Record<string, unknown> & { title?: string; location?: string; sha256?: string; file?: string; url?: string; locator?: string };
  armour_material?: string;
  conductor?: 'copper' | 'aluminium'; insulation?: 'XLPE' | 'PVC';
  metal_sheath?: 'lead' | 'corrugated_aluminium' | 'smooth_aluminium'; oversheath?: 'PVC' | 'PE';
  resistance_basis?: 'stated' | 'standard_limit'; reference?: Record<string, unknown> & { published_guidance?: PublishedGuidance };
}
export type UploadedSeriesDeclaration = Omit<SeriesDeclaration, 'common' | 'common_basis' | 'modelling'>
  & Partial<Pick<SeriesDeclaration, 'common' | 'common_basis' | 'modelling'>>;
export function normalizeSeriesDeclaration(suggestion: UploadedSeriesDeclaration): SeriesDeclaration {
  const value = structuredClone(suggestion);
  record(value, '工作表系列声明');
  if (['name', 'manufacturer', 'designation'].some(key => typeof value[key as keyof UploadedSeriesDeclaration] !== 'string')
      || !Array.isArray(value.standards) || value.standards.some(item => typeof item !== 'string'))
    throw new ApiError(502, '工作表系列名称、制造商、型号或执行标准格式不完整，请重新上传并核对声明。');
  // Omitted maps mean no declared data. Invalid maps must not erase supplied values.
  for (const [key, label] of [['common', '统一尺寸'], ['common_basis', '尺寸依据'], ['modelling', '计算参数']] as const) {
    if (value[key] !== undefined) record(value[key], `工作表${label}`);
  }
  if (Object.values(value.common ?? {}).some(item => typeof item !== 'number' || !Number.isFinite(item))
      || Object.values(value.common_basis ?? {}).some(item => typeof item !== 'string'))
    throw new ApiError(502, '工作表统一尺寸或出处格式不完整，请重新上传并核对声明。');
  for (const parameter of Object.values(value.modelling ?? {})) {
    const entry = record(parameter, '工作表计算参数');
    if (!['number', 'string'].includes(typeof entry.value) || typeof entry.reference !== 'string')
      throw new ApiError(502, '工作表计算参数的数值或出处缺失，请重新上传并核对声明。');
  }
  if (value.material_properties !== undefined) {
    for (const properties of Object.values(record(value.material_properties, '工作表材料物性'))) {
      for (const parameter of Object.values(record(properties, '工作表材料用途'))) {
        const entry = record(parameter, '工作表明示材料物性');
        if (typeof entry.value !== 'number' || !Number.isFinite(entry.value)
            || typeof entry.unit !== 'string' || typeof entry.reference !== 'string')
          throw new ApiError(502, '工作表明示材料物性的数值、单位或出处缺失，请重新上传并核对声明。');
      }
    }
  }
  return { ...value, common: value.common ?? {}, common_basis: value.common_basis ?? {}, modelling: value.modelling ?? {} };
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
  declarations?: { sheet: string; series: UploadedSeriesDeclaration; mapping?: Record<string, number>; first_data_row?: number }[];
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
export interface SeriesDetail { series: SeriesSummary; declaration?: SeriesDeclaration; specs: LibrarySpec[] }

export interface PublishedGuidanceSource {
  reference: string; sha256: string; pdf_page: number; printed_page: number;
  section?: string; table?: string; row?: string | number; column?: string | number;
  row_label?: string; column_label?: string; original_text?: string;
  bbox_pdf_points: number[]; unit_basis?: string;
  condition_evidence?: { field: string; unit: string; bbox_pdf_points: number[]; original_text: string }[];
}
export interface PublishedGuidanceMethod { id: string; name: string; version: string }
export type PublishedGuidanceConditions = Record<string, number | string | boolean | null | Partial<Record<'gt' | 'gte' | 'lt' | 'lte', number>>>;
export interface PublishedGuidanceValue {
  id: string; value: number; unit: string; conditions: PublishedGuidanceConditions;
  source: PublishedGuidanceSource; method: PublishedGuidanceMethod; confidence: 'reference';
}
export interface PublishedGuidance {
  schema: 'cablesim.catalogue-published-guidance/1'; id: string;
  source: { title: string; url: string; sha256: string; nature: string; edition: string | null };
  method: PublishedGuidanceMethod; confidence: 'reference'; reviewed: false;
  usage: 'published_reference_only'; limitations: string[]; content_sha256: string;
  baseline: {
    conditions: PublishedGuidanceConditions; source: PublishedGuidanceSource; limitations: string[];
    original_values: Record<string, { value: number; unit: string; original_text?: string; conversion?: string }>;
  };
  material_facts: (PublishedGuidanceValue & { label: string; quantity: string; usage: 'resistance_temperature_conversion' | 'capacitance_calculation' })[];
  correction_tables: { id: string; title: string; original_title: string; installation: 'direct_buried'; limitations: string[]; factors: PublishedGuidanceValue[] }[];
}

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
  published_guidance?: PublishedGuidance | null;
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
  const original = [text(catalogue.title), ...new Set([text(catalogue.location), text(catalogue.locator)].filter(Boolean).map(sourceLocationText))].filter(Boolean).join(' · ');
  const location = [row.file, row.sheet, row.row_number ? `第 ${row.row_number} 行` : row.row ? `第 ${row.row} 行` : '', row.column].filter(Boolean).join(' · ');
  if (row.origin === 'standard') return ['标准上限，非厂家实测值', basis, location ? `关联规格：${location}` : ''].filter(Boolean).join('；');
  return [row.kind === 'demo' ? '结构演示' : '', basis, original, location].filter(Boolean).join('；') || '来源未登记';
}
export function methodText(method: unknown): string {
  const value = optionalRecord(method);
  const names: Record<string, string> = { 'cablesim.iec60287': 'IEC 60287 稳态载流量', 'cablesim.standard-check': '电缆标准核对', 'cablesim.standards-basis': '标准依据库' };
  return [text(value.name) || text(value.method_name) || names[text(value.plugin_id)], text(value.method_version) || text(value.version) || text(value.plugin_version)].filter(Boolean).join(' · ') || '方法版本未登记';
}
const IMPORT_PARAMETER_NAMES: Record<string, string> = {
  conductor_form: '导体构造', normal_temperature_k: '正常运行温限（K）', short_circuit_temperature_k: '短路温限（K）',
  conductor_class: '导体类别', core_lay_length: '成缆节距', screen_model: '铜带纵向电阻模型',
  screen_radial_factor: '铜带径向包络与单带厚度之比', filler_rho: '填充与包带热阻率',
  armour_gap_ratio: '钢带间隙与带宽之比', steel_relative_permeability: '钢带相对磁导率', diameter_rounding: '外径列示精度的半个单位',
};
export const IMPORT_MATERIAL_ROLES: Record<string, string> = {
  conductor: '导体', conductor_screen: '导体屏蔽', insulation: '绝缘', insulation_screen: '绝缘屏蔽',
  buffer: '缓冲层', metallic_sheath: '金属套', separator: '隔离层', oversheath: '外护套',
  metallic_screen: '金属屏蔽', bedding: '内衬层', filler: '填充', binder: '包带', armour: '铠装',
};
export const IMPORT_MATERIAL_PROPERTIES: Record<string, string> = {
  thermal_resistivity: '热阻率', volumetric_heat_capacity: '体积热容', electrical_resistivity_20: '20 °C 电阻率',
  temperature_coefficient_20: '20 °C 电阻温度系数', relative_permittivity: '相对介电常数', loss_tangent: '介质损耗角正切',
  relative_permeability: '相对磁导率', emissivity: '发射率', solar_absorptivity: '太阳吸收率', density: '密度',
};
export function issueText(value: string | ImportIssue): string { return displayLibraryText(typeof value === 'string' ? value : value.message); }
export function tableHeaderText(value: string): string { return value.replace(/\buF(?=\/)/g, 'μF'); }
export function displayLibraryText(value: string): string {
  const named = value.replace(/cable_types\/(?:cable_type\/)?[^/\s]+\/cores\/layers\/metallic_screen\/longitudinal_r20/g, '金属屏蔽纵向电阻')
    .replace(/\bmaterial_properties\./g, '材料物性 · ').replace(/\b([a-z][a-z_]+)\.([a-z][a-z_0-9]+)\b/g, (original, role: string, property: string) =>
    IMPORT_MATERIAL_ROLES[role] && IMPORT_MATERIAL_PROPERTIES[property] ? `${IMPORT_MATERIAL_ROLES[role]}${IMPORT_MATERIAL_PROPERTIES[property]}` : original)
    .replace(/\b[a-z][a-z_0-9]+\b/g, key => IMPORT_PARAMETER_NAMES[key] || IMPORT_MATERIAL_ROLES[key] || IMPORT_MATERIAL_PROPERTIES[key] || key);
  return displayText(named);
}
export function confidenceText(value?: unknown): string {
  const key = typeof value === 'string' ? value : text(optionalRecord(value).tier);
  return ({ manufacturer: '厂家资料', public: '公开资料', reference: '参考', reference_only: '参考', reviewed: '已人工核对', unverified: '待核对', incomplete: '缺项', deliverable: '可交付', exploratory: '探索' } as Record<string, string>)[key] || '待核对';
}
