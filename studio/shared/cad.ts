/** Published plugin artifact, never a locally invented model or fallback. */
export interface CadPrototype { positions_f32: string; triangles_u32: string; instances: number[][] }
export interface CadLayer {
  entity: string; role: string; label?: string; material: string; display_color?: number[];
  inner_radius_m: number; outer_radius_m: number; peel_fraction?: number;
  display_mesh: { schema: 'cablesim.display-mesh/1'; unit: 'mm'; byte_order: 'little'; prototypes: CadPrototype[] };
}
export interface ProductCad {
  spec: string; version: number; content_sha256: string; artifact_sha256: string;
  method: { plugin_id: string; plugin_version: string; method_version: string; manifest_sha256: string; request_sha256: string };
  warnings: { code: string; message: string }[];
  environment: Record<string, unknown>;
  model: { schema: 'cablesim.cad-model/1'; axis: '+Z'; step_unit: 'mm'; geometry_unit: 'm'; length_m: number; outer_diameter_m: number;
    layers: CadLayer[]; step_text: string; display_approximation: string; geometry_approximation: string; input_sha256: string;
    mass_kg_per_km: number | null; quantity_missing_layers: string[] };
}
