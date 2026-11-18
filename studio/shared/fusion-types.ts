// What the Agent page shows of the platform's own saved runs. The numbers are the saved run's, read from the platform when the agent
// read the run (a saved run never changes); the model is never the source of one.

/** Explicit chat inputs only. Bytes are staged on the platform and never persisted in pi's conversation. */
export type StructureAttachmentInput = { filename: string; content_base64: string } | { id: string };
export interface StructureAttachment { id: string; filename: string; sha256: string; size: number }
/** The Agent proxy has a 2 MiB JSON request boundary; base64 plus the message must fit inside it. */
export const STRUCTURE_ATTACHMENT_BYTES = 1024 * 1024;
export const STRUCTURE_ATTACHMENT_COUNT = 4;

export interface StructurePreviewRow {
  row_number: number;
  name: string;
  key: string;
  status: string;
  values: {
    key: string; label: string; value: number | string | null; unit: string;
    display_value?: number | string | null; display_unit?: string;
    source: Record<string, unknown>; method?: unknown; confidence?: string;
  }[];
  issues: { column?: string | number; field?: string; message: string }[];
  missing: string[];
  warnings?: unknown[];
  derivation?: unknown;
  closure?: unknown;
}

/** A saved preview or an explicitly bounded page of it. Counts describe the whole saved preview, not merely the shown rows. */
export interface SavedStructurePreviewView {
  file: string; sha256: string; preview_id: string; preview_digest: string;
  valid_count: number; error_count: number; incomplete_count: number; row_count: number;
  rows: StructurePreviewRow[];
  skipped: unknown[];
  series?: Record<string, unknown>;
  mapping?: Record<string, number>;
  sheet?: string;
  first_data_row?: number;
  method?: unknown;
  complete: boolean;
}

export interface ImportedStructureSpec {
  id: string; name: string; workspace_id: string; model_id: string; version: number; content_sha256: string; state: string;
}

export interface SavedStructureImportView {
  series_id: string; created: number; state: string; specs: ImportedStructureSpec[]; skipped_rows: number[];
  preview_id: string; preview_digest: string;
}

export interface StructureCheckItem {
  spec_id: string; name: string; status: string; workspace_id?: string; study_id?: string; run_id?: string;
  input_digest?: string; output_digest?: string;
  message?: string; method_name?: string; method_version?: string; confidence?: string;
  checks?: unknown[]; errors?: unknown[]; detail?: unknown;
}

export interface SavedStructureCheckView {
  batch_id: string; series_id: string; status: string; items: StructureCheckItem[];
  complete: boolean; total: number;
}

export interface SavedRunView {
  /** The study and the record: 城南线路 · 110 kV 直埋单回校核 · 第 51 条记录. */
  title: string;
  /** How far the method is validated for the configuration that was actually computed. */
  tier: 'deliverable' | 'reference';
  /** Kept visible when this saved platform record did not carry an engineering confidence classification. */
  tier_note?: string;
  /** The method's name and version, never its plugin identifier: IEC 60287 载流量 1.2.0. */
  method: string;
  /** The allowed current, formatted: 748.3. */
  current: string;
  /** What the current means, in the producer's words: 全回路共同能力. */
  basis: string;
  /** Where the record stands against the project's present inputs. */
  freshness: 'current' | 'historical' | 'unknown';
  limiting: {
    /** The cable that reaches its limit first: 回路 1 · A 相. */
    name: string;
    /** Conductor temperature at the saved load, its limit and the ambient, in °C; a value the record does not give is null. */
    conductor: number | null;
    limit: number | null;
    ambient: number | null;
    /** The saved load and the margin to the allowed current, formatted with units; null when the record does not give them. */
    load: string | null;
    margin: string | null;
  };
}

/** A bounded slice of the platform's saved type facts; absent fields are never filled from model text. */
export interface SavedTypeView {
  title: string;
  fields: { label: string; value: string; unit: string | null; source: string }[];
  checks: string[];
  complete: boolean;
  source: string;
}

/** Rows of an authenticated platform rating-table run. Nulls and refusal reasons are retained, never filled by the model. */
export interface SavedRatingTableView {
  title: string;
  /** The saved method's display name and version. */
  method: string;
  freshness: 'current' | 'historical' | 'unknown';
  rows: {
    case_id: string;
    name: string;
    depth_m: number | null;
    soil_rho_k_m_w: number | null;
    ambient_temperature_c: number | null;
    value_a: number | null;
    status: string;
    reason: string | null;
    rating_basis: string;
  }[];
  total: number;
}
