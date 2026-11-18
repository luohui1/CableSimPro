// Cards and scope adoption are projections of saved platform receipts. No import rows, dimensions or success states are invented here.
import type { CardRef } from '../shared/types.ts';
import type { ImportedStructureSpec, SavedStructureCheckView, SavedStructurePreviewView, StructureCheckItem, StructurePreviewRow } from '../shared/fusion-types.ts';
import type { ToolResult } from './backend.ts';

const object = (value: unknown): value is Record<string, any> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const digest = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const count = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0;

function importedSpecs(receipt: Record<string, any>): ImportedStructureSpec[] | undefined {
  if (receipt.kind !== 'structure_import' || receipt.status !== 'succeeded' || receipt.executed !== true || receipt.error
    || !uuid(receipt.series_id) || !uuid(receipt.preview_id) || !digest(receipt.preview_digest)
    || receipt.state !== 'draft' || !count(receipt.created) || !Array.isArray(receipt.specs) || receipt.created !== receipt.specs.length || !receipt.created) return;
  const specs = receipt.specs;
  if (!specs.every((spec: unknown) => object(spec) && uuid(spec.id) && uuid(spec.workspace_id) && uuid(spec.model_id)
    && typeof spec.name === 'string' && spec.name && count(spec.version) && spec.version > 0 && digest(spec.content_sha256)
    && spec.state === 'draft') || new Set(specs.map((spec: ImportedStructureSpec) => spec.workspace_id)).size !== specs.length) return;
  return specs;
}

/** A successful import authorizes its exact created workspaces, without choosing one as a replacement for the user's original scope. */
export function createdTypeScopes(operation: string, receipt: Record<string, any>): string[] {
  if (receipt.error || receipt.executed === false || (receipt.status !== undefined && receipt.status !== 'succeeded')) return [];
  if (operation === 'propose_type_create' && receipt.kind === 'type' && typeof receipt.type_id === 'string' && receipt.type_id && receipt.workspace_id === receipt.type_id) return [receipt.type_id];
  if (operation === 'propose_structure_import') return importedSpecs(receipt)?.map(spec => spec.workspace_id) ?? [];
  return [];
}

/** A saved batch can contain failed checks or be interrupted: its actual saved item states must remain visible. */
export function savedStructureCheck(receipt: Record<string, any>): boolean {
  return receipt.kind === 'structure_check' && receipt.executed === true && !receipt.error
    && ['succeeded', 'partial', 'failed', 'running', 'interrupted'].includes(receipt.status) && uuid(receipt.batch_id) && uuid(receipt.series_id) && Array.isArray(receipt.items);
}

export function unfinishedStructureCheck(receipt: Record<string, any>): boolean {
  return savedStructureCheck(receipt) && ['running', 'interrupted'].includes(receipt.status);
}

function rows(value: unknown): value is StructurePreviewRow[] {
  return Array.isArray(value) && value.every(row => object(row) && count(row.row_number) && row.row_number > 0
    && typeof row.name === 'string' && typeof row.status === 'string' && Array.isArray(row.values)
    && row.values.every((fact: unknown) => object(fact) && typeof fact.key === 'string' && typeof fact.label === 'string'
      && 'value' in fact && typeof fact.unit === 'string' && object(fact.source))
    && Array.isArray(row.issues) && row.issues.every((issue: unknown) => object(issue) && typeof issue.message === 'string')
    && Array.isArray(row.missing) && row.missing.every((item: unknown) => typeof item === 'string'));
}

function preview(identity: Record<string, any>, data: Record<string, any>, complete: boolean): CardRef | undefined {
  if (!uuid(identity.preview_id) || !digest(identity.preview_digest) || !digest(identity.sha256) || typeof identity.file !== 'string'
    || !['valid_count', 'error_count', 'incomplete_count', 'row_count'].every(key => count(identity[key])) || !rows(data.rows)) return;
  if (data.sha256 !== undefined && data.sha256 !== identity.sha256) return;
  if (data.preview_digest !== undefined && data.preview_digest !== identity.preview_digest) return;
  if (data.preview_id !== undefined && data.preview_id !== identity.preview_id) return;
  if (data.upload_id !== undefined && identity.upload_id !== undefined && data.upload_id !== identity.upload_id) return;
  if (identity.valid_count + identity.error_count !== identity.row_count || identity.incomplete_count > identity.valid_count) return;
  const view: SavedStructurePreviewView = {
    file: identity.file, sha256: identity.sha256, preview_id: identity.preview_id, preview_digest: identity.preview_digest,
    valid_count: identity.valid_count, error_count: identity.error_count, incomplete_count: identity.incomplete_count, row_count: identity.row_count,
    rows: data.rows, skipped: Array.isArray(data.skipped) ? data.skipped : [],
    ...(object(data.series) ? { series: data.series } : {}), ...(object(data.mapping) ? { mapping: data.mapping } : {}),
    ...(typeof data.sheet === 'string' ? { sheet: data.sheet } : {}), ...(count(data.first_data_row) ? { first_data_row: data.first_data_row } : {}),
    ...(data.method ? { method: data.method } : {}), complete: complete && data.rows.length === identity.row_count,
  };
  return { kind: 'structure_preview', view };
}

function check(identity: Record<string, any>, items: unknown, complete: boolean, total?: unknown): CardRef | undefined {
  if (!uuid(identity.batch_id) || !uuid(identity.series_id) || typeof identity.status !== 'string' || !Array.isArray(items)
    || !items.every((item: unknown) => object(item) && uuid(item.spec_id) && typeof item.name === 'string' && typeof item.status === 'string')) return;
  const totalItems = count(total) ? total : items.length;
  const view: SavedStructureCheckView = { batch_id: identity.batch_id, series_id: identity.series_id, status: identity.status,
    items: items as StructureCheckItem[], total: totalItems, complete: complete && items.length === totalItems };
  return { kind: 'structure_check', view };
}

/** Only whole returned page items are drawn. A path stub or an omitted item is not treated as an inspected row. */
export function structureImportCard(tool: string, args: Record<string, unknown>, result: ToolResult): CardRef | undefined {
  const receipt = result.data.receipt;
  if (object(receipt)) {
    if (receipt.kind === 'structure_preview' && receipt.status === 'succeeded' && receipt.executed === true && !receipt.error && object(receipt.preview))
      return preview({ ...receipt.preview, ...receipt, row_count: receipt.row_count }, receipt.preview, true);
    if (receipt.kind === 'structure_import') {
      const specs = importedSpecs(receipt);
      if (specs && Array.isArray(receipt.skipped_rows)) return { kind: 'structure_import', view: {
        series_id: receipt.series_id, created: receipt.created, state: receipt.state, specs, skipped_rows: receipt.skipped_rows,
        preview_id: receipt.preview_id, preview_digest: receipt.preview_digest,
      } };
    }
    if (savedStructureCheck(receipt)) return check(receipt, receipt.items, true, receipt.items.length);
  }
  if (tool !== 'structure_import_read' || !object(result.data.resource) || !object(result.data.page)) return;
  const { resource, page } = result.data;
  if (resource.id !== args.id || resource.kind !== args.kind || !digest(result.data.source?.response_digest)
    || (args.expected_digest !== undefined && args.expected_digest !== result.data.source.response_digest)) return;
  const listed = Array.isArray(page.items) ? page.items : [];
  if (resource.kind === 'preview') {
    const identity = { ...resource, preview_id: resource.preview_id ?? resource.id };
    if (object(page.value) && rows(page.value.rows)) return preview(identity, page.value, page.complete === true);
    if (page.view === '/rows' && rows(page.value)) return preview(identity, { rows: page.value }, page.complete === true);
    if (page.view === '/rows' && listed.length) {
      const shown = listed.filter((item: any) => !item.omitted && /^\/rows\/\d+$/.test(item.path ?? '')).map((item: any) => item.value);
      return preview(identity, { rows: shown }, page.complete === true && shown.length === listed.length);
    }
    if (/^\/rows\/\d+$/.test(page.view ?? '') && object(page.value)) return preview(identity, { rows: [page.value] }, false);
  }
  if (resource.kind === 'check') {
    const identity = { ...resource, batch_id: resource.batch_id ?? resource.id };
    if (object(page.value) && Array.isArray(page.value.items)) return check(identity, page.value.items, page.complete === true, page.value.items.length);
    if (page.view === '/items' && Array.isArray(page.value)) return check(identity, page.value, page.complete === true, page.value.length);
    if (page.view === '/items' && listed.length) {
      const shown = listed.filter((item: any) => !item.omitted && /^\/items\/\d+$/.test(item.path ?? '')).map((item: any) => item.value);
      return check(identity, shown, page.complete === true && shown.length === listed.length, page.total);
    }
  }
}
