// Contracts shared by the host and the workbench. Physical values are SI unless the name says otherwise.

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
  state: 'demo' | 'public' | string;
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

export interface Summary {
  status: 'succeeded' | 'failed' | 'not_applicable';
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

export interface Change { part: PartName; field: string; label: string; before: string; after: string }
export interface Proposal {
  id: string;
  task_id: string;
  step_id: string;
  project_id: string;
  operation: string;
  title: string;
  reason?: string;
  changes: Change[];
  preview: Preview | null;
  issue: Issue | null;
  status: 'pending' | 'accepted' | 'rejected';
  note?: string;
}

export interface TaskStep {
  id: string;
  tool: string;
  label: string;
  detail?: string;
  status: 'running' | 'waiting_review' | 'done' | 'failed' | 'rejected';
  result?: string;
  run_id?: string;
  proposal_id?: string;
  duration_ms?: number;
}

export interface Task {
  id: string;
  project_id: string;
  instruction: string;
  context?: string;
  status: 'running' | 'waiting_review' | 'done' | 'failed' | 'stopped';
  created: string;
  finished?: string;
  steps: TaskStep[];
  reply?: string;
  error?: string;
}

export interface AgentStatus { configured: boolean; model?: string; provider?: string; hint?: string }
export type StudioEvent =
  | { type: 'task'; task: Task }
  | { type: 'proposal'; proposal: Proposal }
  | { type: 'project'; project_id: string };
