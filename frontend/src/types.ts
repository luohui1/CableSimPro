export interface Cable {
  name: string; conductor: 'copper' | 'aluminium'; area_mm2: number; fill_factor: number;
  r20_ohm_km: number | null; conductor_screen_mm: number; insulation_mm: number;
  insulation_screen_mm: number; metallic_screen_mm: number; jacket_mm: number;
  insulation_rho_k_m_w: number; jacket_rho_k_m_w: number; semicon_rho_k_m_w: number;
  u0_kv: number; frequency_hz: 50 | 60; relative_permittivity: number; tan_delta: number;
  ac_extra_factor: number; screen_loss_factor: number; max_temperature_c: number;
}
export interface Installation {
  arrangement: 'flat' | 'trefoil'; depth_m: number; spacing_m: number;
  ambient_temperature_c: number; soil_rho_k_m_w: number;
}
export interface Scenario {
  schema_version: 1; name: string; description: string; cable: Cable; installation: Installation;
  operating_current_a: number; circuit_length_m: number;
}
export interface Preset { id: string; label: string; source: string; scenario: Scenario }
export interface ProjectMeta { id: string; name: string; created_at: string; updated_at: string }
export interface Project extends ProjectMeta { scenario: Scenario }
export interface Layer { name: string; radius_mm: number; color: string }
export interface State {
  current_a: number; temperatures_c: number[]; surface_temperatures_c: number[];
  resistances_ohm_km: number[]; conductor_losses_w_m: number[]; screen_losses_w_m: number[];
  dielectric_loss_w_m: number; total_losses_w_m: number[]; circuit_loss_kw: number; residual_k: number;
  radial_profiles: {phase: string; points: {radius_mm: number; temperature_c: number; layer: string}[]}[];
}
export interface Result {
  model_version: string; input_sha256: string; computed_at: string; input: Scenario;
  summary: {ampacity_a: number; operating_current_a: number; operating_max_temperature_c: number | null;
    thermal_margin_c: number | null; utilization_percent: number; limiting_phase: string; circuit_loss_kw: number | null};
  rating: State; operating: State | null; operating_error: string | null;
  geometry: {diameter_mm: number; positions_m: number[][]; layers: Layer[]};
  thermal: {layer_resistances_k_m_w: number[]; soil_matrix_k_m_w: number[][];
    conductor_influence_matrix_k_m_w: number[][]; capacitance_nf_km: number;
    r20_ohm_km: number; alpha_per_k: number; dielectric_loss_w_m: number};
  curve: {current_a: number; temperature_c: number}[];
  field: {x_m: number[]; depth_m: number[]; current_a: number; temperature_c: (number | null)[][]; method: string};
  warnings: string[]; sources: {title: string; url: string}[];
}
export interface Sweep { parameter: string; points: {value: number; ampacity_a: number | null; error: string | null}[] }
