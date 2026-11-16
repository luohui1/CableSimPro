// Contracts of the model-type operations: creating a series or a specification by hand, ampacity tables kept on a
// specification, the initial structure a standard gives, and the GB 50217 correction. They sit beside the
// contracts of types.ts and only build on them.
import type { Derivation, SeriesDeclaration, SpecView } from './types.ts';

// ---- Creating a series or a specification by hand ----

/** How a version's structure came in when it was typed rather than imported; the entry is where "人工填写" is recorded. */
export interface ManualDerivation extends Derivation {
  entry: 'manual';
  entered_by: string;
  entered_at: string;
}

export interface SeriesCreated { series: string; name: string; description: string; declaration: SeriesDeclaration }
export interface SpecCreated { spec: string; version: number; view: SpecView }

// ---- Ampacity tables kept on a specification version ----

/** One laying condition of a table, as the engineer states it. */
export interface RatingTableCondition {
  label?: string;
  layout: string;
  depth_m: number;
  spacing_m?: number | null;
  bonding?: 'both_ends' | 'single_point';
  duct?: { inner_diameter_m: number; outer_diameter_m: number; thermal_resistivity?: number } | null;
  soil_thermal_resistivity: number;
  ambient_temperature_c: number;
  frequency_hz?: number;
  system_voltage_v?: number | null;
}

/** The record a number of the table is traced to: one run of the project the table was computed in. */
export interface RatingTableRun {
  project: string;
  run: string;
  sequence: number;
  inputs_sha256: string;
  plugin_id: string;
  plugin_version: string;
  capability: string;
  method_version: string;
  manifest_sha256: string;
  request_sha256: string;
}

export interface RatingTableRow {
  id: string;
  label: string;
  layout: string;
  layout_label: string;
  depth_m: number;
  /** The centre spacing the template resolved to; null for a single circuit. */
  spacing_m: number | null;
  bonding: string;
  soil_thermal_resistivity: number;
  ambient_temperature_c: number;
  frequency_hz: number;
  system_voltage_v: number | null;
  circuits: number | null;
  status: 'succeeded' | 'failed';
  /** The method's own number, unrounded; there is none when the method refuses the condition. */
  ampacity_a: number | null;
  basis_name: string | null;
  tier: string | null;
  tier_label: string | null;
  error?: { code: string; message: string; path?: string };
  run: RatingTableRun;
}

export interface RatingTable {
  id: string;
  title: string;
  spec: string;
  version: number;
  content_sha256: string;
  /** The project holding one run record per row. */
  project: string;
  created: string;
  by: string;
  rows: RatingTableRow[];
}

// ---- The initial structure a product standard gives ----

/** Where one dimension of a proposal comes from. A `standard` or `derived` value carries the clause and the pages. */
export interface DimensionSource {
  kind: 'standard' | 'derived' | 'given';
  /** Standard and edition as the check writes them, e.g. "GB/T 12706.2—2020". */
  standard?: string;
  /** Table or clause, e.g. "表 7". */
  clause?: string | null;
  printed_page?: number | null;
  pdf_page?: number | null;
  citation?: string | null;
  record_id?: string;
  record_sha256?: string;
  source_sha256?: string;
  /** The steps of an annex calculation, as the method reported them. */
  calculation?: unknown[];
  /** For `given`: who stated the value. */
  note?: string;
}

export interface ProposedDimension {
  /** Field of the structure table, so the value can be handed to `library.spec.create` as it is. */
  field: string;
  label: string;
  /** In the table's own unit, mm. */
  value: number;
  unit: string;
  source: DimensionSource;
}

export interface MissingDimension { field: string; label: string; unit: string; reason: string }

export interface StructureProposal {
  /** `insulation`: the insulation thickness only; `complete`: also bedding, armour and oversheath, from the standard's annex. */
  scope: 'insulation' | 'complete';
  standard: string;
  inputs: Record<string, unknown>;
  dimensions: ProposedDimension[];
  /** field → value, in table units: what `library.spec.create` takes as `values`. */
  values: Record<string, number>;
  /** field → the clause and pages in words: what `library.spec.create` takes as `basis`. */
  basis: Record<string, string>;
  /** What a specification still needs from the engineer before it can be created. */
  missing: MissingDimension[];
  limitations: string[];
  method: {
    plugin_id: string; plugin_version: string; capability: string; method_version: string; manifest_sha256: string; request_sha256: string;
    run_id: string; steps: number;
  };
}
