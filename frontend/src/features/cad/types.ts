/** Display artifact contracts. These are renderer inputs, not handwritten HTTP models. */
import type { CrossSectionProfile } from '@/features/drawing/cross-section-profile';
export type CanvasState = 'empty' | 'loading' | 'error' | 'success' | 'historical';
export type CadMode = 'peel' | 'section' | 'transparent' | 'scene';
export type CadView = 'iso' | 'front' | 'top' | 'end';
export type MeasurementMode = 'part' | 'diameter' | 'point';
export type CadSelection = { kind: 'layer' | 'object'; id: string } | null;
export type Transform = readonly number[];

export interface MeshPrototype {
  positions?: ArrayLike<number>;
  triangles?: ArrayLike<number>;
  positions_f32?: string;
  triangles_u32?: string;
  instances: readonly Transform[];
}

export interface DisplayMesh {
  schema: 'cablesim.display-mesh/1';
  unit: 'mm';
  byte_order?: 'little';
  deflection_mm: number;
  prototypes: readonly MeshPrototype[];
}

export interface CadLayer {
  entity?: string;
  role: string;
  label?: string;
  source_target?: { scope: 'core' | 'common'; core_id?: string; role: string };
  center_m?: { x: number; z: number };
  section_profile?: { outer: CrossSectionProfile; inner?: CrossSectionProfile | null; holes: CrossSectionProfile[] };
  section_outline_brep?: string;
  peel_fraction?: number;
  material: string;
  category: string;
  inner_radius_m: number;
  outer_radius_m: number;
  geometry_key?: string;
  brep_text?: string;
  display_mesh?: DisplayMesh;
  construction?: { wire_diameter?: number; [key: string]: unknown };
  [key: string]: unknown;
}

export interface CadModel {
  schema: 'cablesim.cad-model/1';
  brep_unit: 'mm';
  axis: '+Z';
  input_sha256: string;
  length_m: number;
  outer_diameter_m: number;
  layers: readonly CadLayer[];
  envelope?: boolean;
  exact_pending?: boolean;
  material_sources?: readonly { id: string; label: string }[];
  [key: string]: unknown;
}

export interface SceneAsset {
  geometry_key: string;
  material?: string | null;
  category?: string;
  inner_radius_m?: number;
  outer_radius_m?: number;
  brep_text?: string;
  display_mesh?: DisplayMesh;
  primitive?: 'annulus' | 'box' | 'plane';
  bounds_m?: readonly number[];
}

export interface SceneObject {
  id: string;
  kind: 'cable' | 'enclosure' | 'backfill' | 'soil' | 'ground';
  label?: string;
  bounds_m: readonly number[];
  tint_index?: number;
  parts: readonly { asset_id: string; transform_mm: Transform }[];
}

export interface CadScene {
  schema: 'cablesim.cad-scene/1';
  brep_unit: 'mm';
  coordinate_frame: 'x/y/z';
  extrusion_axis: '+Y';
  input_sha256: string;
  length_m: number;
  crop_bounds_m: readonly number[];
  objects: readonly SceneObject[];
  assets: Readonly<Record<string, SceneAsset>>;
  envelope?: boolean;
  [key: string]: unknown;
}

export type CadGeometry = CadModel | CadScene;

export interface CameraPose {
  yaw: number;
  elevation: number;
  heading: number;
  zoom: number;
  panX: number;
  panY: number;
}

export interface CadCamera extends CameraPose {
  view: CadView | 'free';
  mode: CadMode;
  section: number;
}

export interface CadPick {
  part?: number;
  object_id?: string;
  x_mm?: number;
  y_mm?: number;
  z_mm?: number;
  diameter_mm?: number;
  distance_mm?: number;
  measure_pending?: boolean;
  [key: string]: unknown;
}

export interface CadTiming {
  phase: 'first-display' | 'update';
  schema: CadGeometry['schema'];
  inputSha256: string;
  envelope: boolean;
  elapsedMs: number;
  nativeUpdateMs: number;
  replacedParts: number;
  reusedParts: number;
  runtimeCacheHit: boolean;
}

export interface CadViewportHandle {
  fit(): void;
  zoom(factor: number): void;
  view(view: CadView): void;
  info(): Record<string, unknown> | null;
}

export interface CadViewportProps {
  geometry: CadGeometry | null;
  selectedObject?: CadSelection;
  onSelectionChange?: (selection: CadSelection) => void;
  onPick?: (pick: CadPick | null) => void;
  onCameraChange?: (camera: CadCamera) => void;
  onReady?: (timing: CadTiming) => void;
  onError?: (error: Error) => void;
  loadExact?: (model: CadModel, signal: AbortSignal) => Promise<CadModel>;
  state?: CanvasState;
  error?: string;
  onRetry?: () => void;
  initialCamera?: Partial<CameraPose>;
  className?: string;
  label?: string;
}
