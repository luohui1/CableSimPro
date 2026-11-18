import { ApiError } from '@/api/client';
import { indexObjects } from '@/api/object-index';
import type { components } from '@/api/generated/schema';
import type { DomainDocument } from '@/lib/domain-fields';
import { referenceRequest, type AssetSummary, type ReferenceAsset, type ReferenceValue } from './reference-api';

export type ApplicationKind = 'component' | 'study_template';
export type ComponentPart = 'conductor' | 'core_layer' | 'common_layer';
export interface ComponentSelection { cable_type_id: string; core_id?: string | null; part: ComponentPart; layer_index?: number | null }
export interface ApplicationWorkspace { id: string; name: string; revision: number; updated_at?: string }
export interface ApplicationSnapshot { id: string; revision: number; domain: DomainDocument; updated_at: string }
export type ApplicationStudy = components['schemas']['StudyResponse'];
export type ApplicationRun = components['schemas']['RunSummary'];
export interface ApplicationRunPage { items: ApplicationRun[]; next_cursor: number | null }
export interface ApplicationSource {
  workspace_id: string; revision: number; document_sha256: string; name: string;
  snapshot: { domain: DomainDocument; [key: string]: unknown }; study_id?: string; study_revision?: number;
  run_id?: string; input_digest?: string; output_digest?: string;
}
export interface ApplicationMethod { name: string; version: string; method_version?: string; release_digest?: string }
export interface ApplicationField { path: string; label: string; value: ReferenceValue; unit: string | null; source: unknown; source_path?: string | null }
export interface ApplicationBindings { cable_type_ids: string[]; circuit_ids: string[]; cable_ids: string[] }
export interface ApplicationEvidence {
  kind: ApplicationKind; source: ApplicationSource; method: ApplicationMethod;
  fields: ApplicationField[]; missing: string[]; trust: { grade: string; label: string; reason?: string };
  limitations: string[]; approval: 'not_granted'; definition?: components['schemas']['StudyDefinition'];
  bindings?: ApplicationBindings; selection?: ComponentSelection; resource?: AssetSummary; dependencies?: unknown[];
  issues?: { code: string; message: string }[]; application?: Record<string, unknown>; read_only?: boolean;
}
export interface ApplicationAsset extends ReferenceAsset { release: ReferenceAsset['release'] & { application?: Record<string, unknown> | null } }
export interface ApplicationCapturePreview extends ApplicationEvidence {
  release: ApplicationAsset['release'] & { asset_id: string; name: string; version: string; kind: ApplicationKind };
  content_sha256: string; preview_digest: string; persisted: false;
}
export interface CaptureRequest { asset_id: string; version: string; name: string; workspace_id: string; expected_revision: number }
export interface ComponentCaptureRequest extends CaptureRequest { selection: ComponentSelection }
export interface StudyCaptureRequest extends CaptureRequest { study_id: string; expected_study_revision: number; source_run_id: string }
export interface TargetRequest { resource_id: string; content_sha256: string; workspace_id: string; expected_revision: number }
export interface ComponentTargetRequest extends TargetRequest { target: ComponentSelection; target_material_id: string }
export interface StudyTargetRequest extends TargetRequest { title: string; bindings: ApplicationBindings }
export interface ApplicationChange {
  path: string; label: string; before: ReferenceValue; after: ReferenceValue; unit: string | null;
  source: unknown; previous_source: unknown; source_action: 'replace' | 'unchanged';
}
export interface ApplicationTargetPreview extends ApplicationEvidence {
  workspace_id: string; revision: number; preview_digest: string; adoptable: true;
  changes?: ApplicationChange[]; material_action?: 'create' | 'reuse_identical';
  before?: { component: unknown; material: unknown }; proposed?: { component: unknown; material: unknown };
  source_run_status?: 'verified_local_run' | 'external_declared_run'; preflight?: unknown;
}
export interface StudyAdoption { study: { id: string; revision: number }; workspace_id: string; revision: number; run_started: false; approval: 'not_granted' }
export const applicationPrefix = (kind: ApplicationKind) => `/api/library/resources/${kind === 'component' ? 'components' : 'study-templates'}`;

/** This is the existing unified project index; no catalogue or shadow store is built. */
export async function applicationProjects(signal?: AbortSignal): Promise<ApplicationWorkspace[]> {
  const items: ApplicationWorkspace[] = [];
  for (let offset = 0; offset < 5000; offset += 100) {
    const page = await indexObjects({ kind: 'project', limit: 100, offset }, signal);
    for (const item of page.items) {
      if (item.kind !== 'project' || typeof item.revision !== 'number' || !item.updated)
        throw new ApiError(502, '工程索引缺少类别、修订或保存时间，请重新读取。');
      items.push({ id: item.id, name: item.name, revision: item.revision, updated_at: item.updated });
    }
    if (items.length >= page.total) return items;
    if (!page.items.length) throw new ApiError(502, '工程索引分页尚未返回完整记录，请重新读取。');
  }
  throw new ApiError(502, '工程索引超出当前选择器范围，请先缩小工程库。');
}
export function applicationTypes(signal?: AbortSignal) {
  return referenceRequest<ApplicationWorkspace[]>('/api/design/type-workspaces', { signal });
}
export function applicationSnapshot(id: string, signal?: AbortSignal) {
  return referenceRequest<ApplicationSnapshot>(`/api/workspaces/${encodeURIComponent(id)}`, { signal });
}
export function applicationWorkspaceOptions(items: ApplicationWorkspace[]) {
  const counts = new Map<string, number>();
  return items.map(item => {
    const key = `${item.name}\u0000${item.revision}`, occurrence = (counts.get(key) ?? 0) + 1;
    counts.set(key, occurrence);
    const duplicates = items.filter(other => other.name === item.name && other.revision === item.revision).length;
    return { value: item.id, label: `${item.name} · 输入修订 ${item.revision}${duplicates > 1 ? ` · 同名条目 ${occurrence}${item.updated_at ? ` · ${item.updated_at}` : ''}` : ''}` };
  });
}
export function componentChoices(document: DomainDocument, allowedPart?: ComponentPart) {
  const rows: { value: string; label: string; selection: ComponentSelection }[] = [];
  for (const cable of document.cable_types) {
    cable.cores.forEach((core, index) => {
      if (!allowedPart || allowedPart === 'conductor') {
        const selection: ComponentSelection = { cable_type_id: cable.id, core_id: core.id, part: 'conductor' };
        rows.push({ value: JSON.stringify(selection), label: `${cable.label} · 第 ${index + 1} 芯 · 导体`, selection });
      }
      if (!allowedPart || allowedPart === 'core_layer') core.layers.forEach((layer, layerIndex) => {
        const selection: ComponentSelection = { cable_type_id: cable.id, core_id: core.id, part: 'core_layer', layer_index: layerIndex };
        rows.push({ value: JSON.stringify(selection), label: `${cable.label} · 第 ${index + 1} 芯 · 第 ${layerIndex + 1} 层 · ${layerName(layer.role)}`, selection });
      });
    });
    if (!allowedPart || allowedPart === 'common_layer') cable.common_layers.forEach((layer, layerIndex) => {
      const selection: ComponentSelection = { cable_type_id: cable.id, part: 'common_layer', layer_index: layerIndex };
      rows.push({ value: JSON.stringify(selection), label: `${cable.label} · 公共第 ${layerIndex + 1} 层 · ${layerName(layer.role)}`, selection });
    });
  }
  return rows;
}
const layerNames: Record<string, string> = {
  conductor_screen: '导体屏蔽', insulation: '绝缘', insulation_screen: '绝缘屏蔽', metallic_screen: '金属屏蔽',
  buffer: '缓冲层', metallic_sheath: '金属套', separator: '隔离层', armour: '铠装', oversheath: '外护套',
  bedding: '垫层', filler: '填充层', binder: '扎带', tape: '包带', water_blocking: '阻水层', inner_sheath: '内护套',
};
function layerName(role: string) { return layerNames[role] ?? '已保存结构层'; }
export function applicationDownload(filename: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
