// Contracts shared by the host and the workbench. Physical values are SI unless the name says otherwise.
import type { SavedRunView } from './fusion-types.ts';

export interface Material {
  id: string;
  label: string;
  category: string;
  thermal_resistivity?: number;
  electrical_resistivity_20?: number;
  temperature_coefficient_20?: number;
  relative_permittivity?: number;
  loss_tangent?: number;
  relative_permeability?: number;
}

export interface Layer {
  role: string;
  material: string;
  thickness: number;
  form?: string | null;
  corrugation_depth?: number | null;
}

export interface Core {
  id: string;
  x: number;
  z: number;
  conductor: { material: string; form: string; nominal_area: number; diameter: number; r20?: number | null };
  layers: Layer[];
}

export interface CableType {
  id: string;
  label: string;
  construction: 'single_core' | 'three_core' | 'multi_core';
  rating: { u0: number; u?: number | null; um?: number | null; max_conductor_temperature: Record<string, number> };
  cores: Core[];
  common_layers: Layer[];
}

export interface Placement { cable: string; x: number; z: number; enclosure?: string | null }
export interface Enclosure { id: string; type: string; x: number; z: number; inner_diameter?: number; outer_diameter?: number; contains: string[] }
export interface Region { id: string; material: string; x: number; z: number; width: number; height: number }

export interface Section {
  id: string;
  label: string;
  kind: string;
  medium: { material: string; surface_temperature: number };
  placements: Placement[];
  enclosures?: Enclosure[];
  backfill?: Region | null;
  layout_template?: { kind?: string; depth?: number; spacing?: number | null };
}

export interface Circuit {
  id: string;
  label: string;
  cable_type: string;
  system: { kind: string; frequency: number; voltage?: number | null };
  cables: { id: string; phase: string }[];
  bonding: { kind: string };
}

export interface DomainDocument {
  schema_version: 'cablesim.domain/1';
  name: string;
  materials: Material[];
  cable_types: CableType[];
  circuits: Circuit[];
  sections: Section[];
  load_cases: { id: string; kind: string; currents: Record<string, number> }[];
}

// ---- The three inputs the engineer edits, plus the method choice ----

export interface LibraryEntry {
  id: string;
  version: string;
  name: string;
  family: string;
  /** Where the data comes from: a declared demonstration structure, a public table, or the factory's own table. */
  state: 'demo' | 'public' | 'factory' | string;
  /** Where the version stands in review; set when the entry comes out of the product library. */
  review?: 'draft' | 'submitted' | 'reviewed' | 'published';
  source: string;
  content_sha256: string;
  payload: { cable_type: CableType; materials: Material[] };
  method_defaults: Record<string, unknown>;
  method_parameters: Record<string, unknown>;
  summary: { construction: string; cores: number; area_mm2: number; u0_v: number; u_v?: number | null; outer_diameter_m: number; r20_ohm_m?: number | null };
}

export interface Duct { inner_diameter_m: number; outer_diameter_m: number; thermal_resistivity?: number }
export interface Installation {
  layout: string;
  depth_m: number;
  spacing_m: number | null;
  duct: Duct | null;
  backfill: { width?: number; height?: number; thermal_resistivity?: number } | null;
  bonding: 'both_ends' | 'single_point';
}

export interface Conditions {
  soil_thermal_resistivity: number;
  ambient_temperature_c: number;
  frequency_hz: number;
  system_voltage_v: number | null;
  currents_a: number[];
}

export interface MethodChoice { method: string; parameters: Record<string, unknown> }
export interface Parts { cable: LibraryEntry; installation: Installation; conditions: Conditions; method: MethodChoice }
export type PartName = 'cable' | 'installation' | 'conditions' | 'method';

export interface Issue { code: string; message: string; path?: string }
export interface Tier { tier: 'deliverable' | 'reference' | 'exploratory'; label: string; meaning: string; basis: string[] }
export interface LayoutOption { kind: string; label: string; circuits: number; ducted: boolean; default_duct?: Duct | null }

export interface Preview {
  document: DomainDocument;
  outer_diameter_m: number;
  layout: { kind: string; depth: number; spacing: number | null };
  layout_label: string;
  circuit_count: number;
  duct: Duct | null;
  parameters: Record<string, unknown>;
  tier: Tier;
  layouts: LayoutOption[];
}

// ---- Results ----

export interface CableState {
  id: string;
  circuit: string;
  phase: string;
  x: number | null;
  z: number | null;
  current_a: number;
  conductor_c: number;
  limit_c: number;
  margin_k: number;
  sheath_c: number;
  surface_c: number;
  armour_c?: number | null;
  duct_inner_c?: number;
  duct_outer_c?: number;
  losses_w_m: { conductor: number; sheath: number; dielectric: number; total: number; armour?: number };
  thermal_k_m_w: { t1: number; t3: number; t4_air: number; t4_wall: number; t4_soil: number; t2?: number };
  mutual_rise_k: number;
  external_rise_k: number;
  lambda1: number;
  lambda2?: number;
  ac_resistance_ohm_m: number;
  capacitance_f_m: number;
}

/** How much of one cable's surface temperature rise each cable causes, at the saved load. */
export interface HeatContribution {
  target: string;
  source: string;
  self: boolean;
  resistance_k_m_w: number;
  source_loss_w_m: number;
  temperature_rise_k: number;
}

/** The soil temperature field the method publishes for some layouts (artifact x-cablesim.temperature-field). */
export interface TemperatureField {
  schema_version: string;
  mesh: { points: [number, number][]; triangles: [number, number, number][]; representation?: string };
  temperature_k: number[];
  analytical_soil_view?: {
    model: string;
    condition: string;
    soil_thermal_resistivity_k_m_w: number;
    excluded_regions?: { entity: string; center_m: [number, number]; radius_m: number; kind: string }[];
  };
}
export const TEMPERATURE_FIELD = 'x-cablesim.temperature-field';

export interface Summary {
  status: 'succeeded' | 'failed' | 'not_applicable';
  heat_contributions?: HeatContribution[];
  error?: Issue;
  headline_text?: string;
  ampacity?: { value_a: number; basis: string; basis_name: string; meaning: string; limiting_cable: string; limiting_circuit: string } | null;
  circuits?: { id: string; label: string; ampacity_a: number | null; limiting_cable?: string; load_a?: number; margin_a?: number | null; error?: Issue }[];
  operating?: { cables: CableState[]; hottest_cable: string | null; within_limit: boolean | null; iterations?: number; residual_k?: number; error?: Issue };
  rated?: { cables: CableState[] };
  ambient_c?: number;
  verification?: { passed: boolean; basis: string; rows: { entity: string; item: string; computed: number; reference: number; difference: number; unit: string; tolerance: number; passed: boolean; source: string }[] };
  soil?: Record<string, unknown>;
  warnings?: { code: string; message: string }[];
  input_sha256?: string;
}

export interface MethodCard {
  method: string;
  family: string;
  summary: string;
  plugin: string;
  capability: string;
  method_version: string;
  manifest_sha256: string;
  standards: string[];
  scope: string[];
  assumptions: string[];
  validation: { level: string; cases: string[]; this_configuration: string[] };
  tier: Tier;
}

export interface SweepPoint {
  case_id: string; value: number; status?: string; error?: Issue; ampacity_a?: number | null; limiting_cable?: string | null;
  hottest_conductor_c?: number | null; within_limit?: boolean | null; operating_error?: Issue | null;
}
export interface Candidate {
  case_id: string;
  model_id: string;
  name: string;
  area_mm2: number;
  content_sha256: string;
  status?: string;
  error?: Issue;
  ampacity_a?: number | null;
  basis_name?: string | null;
  meets_target?: boolean | null;
  margin_a?: number | null;
  conductor_at_target_c?: number | null;
  at_target_error?: Issue;
  tier?: string;
}

export interface RunHeader {
  id: string;
  sequence: number;
  created: string;
  kind: 'rating' | 'sweep' | 'selection';
  title: string;
  by: 'human' | 'agent';
  task_id?: string;
  inputs_sha256: string;
  status: 'succeeded' | 'failed';
  tier?: string;
  headline?: string;
  report?: string;
}

export interface RunRecord extends RunHeader {
  schema: 'cablesim.studio.run/1';
  project: { id: string; name: string };
  inputs: Parts;
  plugin_id: string;
  plugin_version: string;
  capability: string;
  method_version: string;
  manifest_sha256: string;
  request_sha256: string;
  core_run_id: string;
  environment: Record<string, unknown>;
  request: { cases: { case_id: string; input: unknown; parameters: unknown }[] };
  result: { cases: { case_id: string; status: string; results: unknown[]; artifacts: Record<string, unknown>; artifact_digests: Record<string, string>; warnings: unknown[]; error?: Issue }[] };
  document: DomainDocument | null;
  parameters: Record<string, unknown> | null;
  outer_diameter_m?: number;
  summary?: Summary;
  method_card: MethodCard | null;
  sweep?: { variable: string; label: string; unit: string; part: string; points: SweepPoint[] };
  selection?: { target_current_a: number; candidates: Candidate[]; chosen: string | null; rule: string; reason: string | null };
}

export interface ProjectMeta { id: string; name: string; created: string; updated: string; revision: number }
export interface ProjectView {
  meta: ProjectMeta;
  parts: Parts;
  inputs_sha256: string;
  preview: Preview | null;
  issue: Issue | null;
  /** Laying templates for this cable's core count; available even while the inputs have an issue. */
  layouts: LayoutOption[];
  runs: RunHeader[];
}

// ---- Agent ----

/** One thing a person is asked to accept: what the value was and what it would become, in the units the screen uses. */
export interface Change { part: string; field: string; label: string; before: string; after: string }
export interface Proposal {
  id: string;
  /** The conversation the agent made it in. */
  session_id: string;
  /** The tool call that waits for the decision. */
  step_id: string;
  project_id?: string;
  operation: string;
  title: string;
  changes: Change[];
  preview?: Preview | null;
  issue?: Issue | null;
  status: 'pending' | 'accepted' | 'rejected';
  note?: string;
}

export interface AgentStatus { configured: boolean; model?: string; provider?: string; hint?: string }

/** What a result card shows. References only: the card reads the numbers from the host, so none of them passes through the model. */
export type CardRef =
  | { kind: 'run'; project: string; run: string; href: string }
  | { kind: 'check'; series: string; /** The specifications the agent asked about, when it did not ask about the whole series. */ specs?: string[]; href: string }
  /** status: where the version stands in review (draft or not), so an unreviewed sheet is never taken for an issued one. */
  | { kind: 'file'; url: string; title: string; type: 'pdf' | 'html'; href?: string; status?: string }
  | { kind: 'model3d'; spec: string; version: number; href: string }
  | { kind: 'open'; label: string; href: string }
  /** An ampacity table kept on a specification version; its rows are read from the host by the table's identifier. */
  | { kind: 'rating_table'; spec: string; version: number; table: string; href: string }
  /** The initial structure a standard gave, kept as a proposal. */
  | { kind: 'standard'; proposal: string }
  /** A GB 50217 correction kept on a project. */
  | { kind: 'correction'; project: string; correction: string; href: string }
  /** A saved run of the old platform's studies, as the agent read it (the fused product's Agent page). */
  | { kind: 'saved_run'; href: string; view: SavedRunView };

export type StepStatus = 'running' | 'waiting_review' | 'done' | 'failed' | 'rejected' | 'interrupted';
export interface ChatStep {
  type: 'step';
  id: string;
  tool: string;
  /** The operation's name as the workbench calls it. */
  label: string;
  status: StepStatus;
  /** What the step did in a few words of the engineer's own language, from the arguments. */
  target?: string;
  /** Facts worth a look when the step is opened, written by the host from the result. */
  notes?: string[];
  /** Why a step failed or was refused. */
  reason?: string;
  card?: CardRef;
  proposal?: Proposal;
  duration_ms?: number;
}
export interface ChatText { type: 'text'; text: string }
export type ChatPart = ChatText | ChatStep;
export interface ChatAttachment { upload: string; file: string }
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  parts: ChatPart[];
  created: string;
  attachments?: ChatAttachment[];
  /** A user message that waits for the agent to finish what it is doing. */
  queued?: boolean;
  status?: 'streaming' | 'done' | 'stopped' | 'error';
  error?: string;
}
/** revision counts the states the host has sent of a running conversation; the page keeps only a state newer than the one it holds. */
export interface ChatSummary {
  id: string; title: string; created: string; updated: string; message_count: number; running: boolean; revision: number;
  /** Which run of the host counted the revisions: after a restart they begin again, and an older count must not be trusted. */
  epoch: string;
}
export interface ChatView extends ChatSummary { items: ChatMessage[]; waiting: Proposal[] }

// ---- The product library: series → specification → version ----

/** Where a version stands on its way to being issued. Only a person moves it forward. */
export type ReviewState = 'draft' | 'submitted' | 'reviewed' | 'published';
export type ResultKind = 'check' | 'electrical' | 'short_circuit' | 'rating';
export const RESULT_KINDS: ResultKind[] = ['check', 'electrical', 'short_circuit', 'rating'];

export interface GivenParameter { value: number | string; unit: string; reference: string }
/** What a series states once for all its sizes; structure values are in the table's own units (mm, mm², Ω/km, kg/km). */
export interface SeriesDeclaration {
  name: string;
  manufacturer: string;
  designation: string;
  cores: 1 | 3;
  u0_v: number;
  u_v: number;
  um_v?: number | null;
  standards: string[];
  common: Record<string, number>;
  common_basis: Record<string, string>;
  modelling: Record<string, GivenParameter>;
  source?: { title?: string; location?: string; sha256?: string; file?: string };
  origin?: 'factory' | 'public' | 'demo';
  armour_material?: string;
}
export interface StructureValue { key: string; label: string; unit: string; value: number; origin: 'table' | 'series' | 'standard'; basis?: string;
  revision?: { previous: number; by: string; at: string; note: string } }
export interface Closure { declared_mm: number; listed_mm: number; residual_mm: number; tolerance_mm: number; placed_in: string | null }
export interface Derivation { kind: 'plugin' | 'stated' | 'bundled'; note: string; plugin_id?: string; plugin_version?: string }
export type BuiltRow =
  | { ok: true; row: number; key: string; name: string; area_mm2: number; entry: LibraryEntry; structure: StructureValue[]; closure: Closure;
      derivation: Derivation; warnings: Issue[] }
  | { ok: false; row: number; error: Issue };
export interface DesignationParts {
  text: string; model: string; prefixes: string[]; conductor: 'copper' | 'aluminium'; sheath: 'PVC' | 'PE'; description: string; name: string;
  armour: { kind: string; label: string } | null; metal_sheath: string | null; u0_v: number | null; u_v: number | null; cores: number | null; area_mm2: number | null;
}
export interface BuildResult { designation: DesignationParts; rows: BuiltRow[]; modelling_used: string[] }

export interface MethodIdentity { plugin_id: string; plugin_version: string; capability: string; method_version: string; manifest_sha256: string; request_sha256: string; run_id: string }
export interface CheckRow {
  id: string; title: string; standard: string; clause: string; printed_page?: number | null; pdf_page?: number | null;
  limit: number | null; actual: number | null; margin: number | null; unit: string; comparison: string | null;
  verdict: 'passed' | 'failed' | 'missing' | 'uncovered' | string; reason: string | null; formula?: string | null;
  target: { scope: string; core_id: string | null; role: string };
}
export interface ValueRow { id: string; title?: string; label?: string; value: number | null; unit: string; status: string; reason?: string | null; formula?: string | null; source?: string | null }
export interface RatingRow {
  id: string; status: string; layout_label?: string; circuits?: number; tier?: Tier; ampacity_a?: number | null; basis_name?: string | null;
  verification_passed?: boolean | null; ac_resistance_ohm_m?: number | null; warnings?: string[]; error?: Issue;
}
export interface RatingCondition { id: string; layout: string; depth_m: number; ambient_temperature_c: number; soil_thermal_resistivity: number }
export interface ProductResult {
  kind: ResultKind;
  created: string;
  by: string;
  current: boolean;
  error?: Issue;
  method?: MethodIdentity | null;
  rows?: (CheckRow | ValueRow | RatingRow)[];
  summary?: { headline?: string | null; count: Record<string, number> };
  standards?: string[];
  undeclared_standards?: string[];
  basis_missing?: { key: string; reason: string }[];
  conditions?: { values: Record<string, number | string>; sources: Record<string, string> } | RatingCondition[];
  warnings?: unknown[];
}
export interface SeriesSummary {
  id: string; name: string; manufacturer: string; designation: string; description: string; cores: number; u0_v: number; u_v: number | null;
  origin: string; standards: string[]; specs: number; states: Partial<Record<ReviewState, number>>; created: string; created_by: string; updated: string;
}
export interface SpecRow {
  id: string; key: string; name: string; area_mm2: number; version: number; version_id: string; review: ReviewState;
  outer_diameter_mm: number; r20_ohm_km: number | null; weight_kg_km: number | null; warnings: Issue[];
  /** Structure values of this version by field, in the table's own units; empty for a structure that did not come from a table. */
  dimensions: Record<string, { value: number; origin: StructureValue['origin']; revised?: boolean }>;
  check: Record<string, number> | null; ac_resistance_ohm_km: number | null; short_circuit_ka: number | null; ampacity_a: number | null;
  computed: Partial<Record<ResultKind, 'done' | 'error'>>;
}
export interface LibraryJob {
  id: string; series_id: string; title: string; done: number; total: number; state: 'running' | 'done' | 'failed' | 'cancelled'; error?: Issue; cancel_requested?: boolean;
  /** Who started the batch; the agent may stop only a batch it started itself. */
  started_by?: 'human' | 'agent';
}
export interface SeriesView { series: SeriesSummary; declaration: SeriesDeclaration; specs: SpecRow[]; reference: RatingCondition | null; job: LibraryJob | null }
export interface VersionHeader {
  id: string; number: number; review: ReviewState; note: string; content_sha256: string; created: string; created_by: string;
  submitted?: string | null; submitted_by?: string | null; reviewed?: string | null; reviewed_by?: string | null; published?: string | null; published_by?: string | null;
}
export interface LibraryEvent { id: number; at: string; by: string; object: string; object_id: string; action: string; detail: Record<string, unknown> }
export interface SpecView {
  series: SeriesSummary;
  spec: { id: string; key: string; name: string; area_mm2: number };
  version: VersionHeader;
  entry: LibraryEntry;
  structure: StructureValue[];
  closure: Closure | null;
  derivation: Derivation;
  warnings: Issue[];
  results: Partial<Record<ResultKind, ProductResult>>;
  versions: VersionHeader[];
  events: LibraryEvent[];
}
export interface TableColumn { index: number; letter: string; header: string; suggested: string | null; sample: (string | number | null)[] }
export interface TableSheet {
  name: string; rows: number; table: boolean; title?: string | null; header_rows?: number[]; first_data_row?: number; data_rows?: number; columns?: TableColumn[];
}
export interface TableInspection { upload: string; file: string; sheets: TableSheet[]; fields: { key: string; label: string; unit: string }[] }
export interface ColumnMapping { name: string; mapping: Record<string, number>; headers: Record<string, string>; updated: string }
/** One row of a structure table as it would enter the library: built, or the reason it cannot be. */
export interface ImportRow {
  source_row: number; ok: boolean; key?: string; name?: string; area_mm2?: number; outer_diameter_mm?: number; closure?: Closure;
  derivation?: Derivation; warnings: Issue[]; error?: Issue;
}
export interface ImportPreview { designation: DesignationParts; rows: ImportRow[]; skipped: { row: number; text: string }[]; ready: number; failed: number }

export interface LibraryVocabulary {
  fields: { key: string; label: string; unit: string }[];
  modelling: { key: string; label: string; unit: string }[];
  reference_modelling: Record<string, GivenParameter>;
  mappings: ColumnMapping[];
  review_steps: Record<string, string>;
}
export interface SpecificationReport {
  id: string; title: string; spec: string; version: number; review: ReviewState; created: string; by: string;
  content_sha256: string; snapshot_sha256: string; sha256: string; url: string;
}

/** The standard check of a series boiled down: how many items passed, failed or are missing, and each item that failed. */
export interface CheckFailure {
  spec: string; name: string; title: string; standard: string; clause: string; page?: number | null;
  limit: number | null; actual: number | null; unit: string; comparison: string | null; reason?: string | null;
}
export interface CheckFailures {
  series: string; name: string; specs: number; checked: number;
  counts: { passed: number; failed: number; missing: number; uncovered: number };
  failures: CheckFailure[];
  missing: { spec: string; name: string; title: string; reason: string | null }[];
  not_checked: string[];
}

export type StudioEvent =
  /** The last few messages of a conversation as they stand now; the page replaces its own tail with them. */
  | { type: 'chat'; summary: ChatSummary; tail: ChatMessage[]; count: number; waiting: Proposal[] }
  | { type: 'proposal'; proposal: Proposal }
  | { type: 'project'; project_id: string }
  | { type: 'library'; series_id?: string; job?: LibraryJob };
