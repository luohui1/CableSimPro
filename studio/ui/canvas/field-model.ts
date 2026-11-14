// The soil temperature field of a run, as the method published it.
//
// The method publishes the field on a coarse display grid (cells of 5 to 6 cm, wider than a cable radius)
// and states the model behind it: mirror line sources with each cable's total loss at the saved load.
// Drawn from the grid alone, isotherms near a cable would be polygons. So the display evaluates the stated
// model at every pixel, and before doing so compares it with every published node. If any node differs,
// the display falls back to the published nodes with linear interpolation. No temperature is invented here.
import { TEMPERATURE_FIELD, type RunRecord, type TemperatureField } from '@shared/types';

export interface FieldSource { x: number; z: number; /** Soil resistivity × loss / 2π, in kelvin. */ k: number }

export interface FieldModel {
  ambient: number;
  /** 'analytic': the stated closed form, equal to the method's output at every published node. 'mesh': the published nodes only. */
  kind: 'analytic' | 'mesh';
  sources: FieldSource[];
  nodes: number;
  /** Largest difference between the closed form and a published node, in kelvin. */
  deviation: number;
  hottest: number;
  mesh: { points: [number, number][]; triangles: [number, number, number][]; celsius: Float32Array<ArrayBuffer> };
}

const TOLERANCE_K = 1e-6;

export function temperatureAt(ambient: number, sources: FieldSource[], x: number, z: number): number {
  let temperature = ambient;
  for (const source of sources) {
    const direct = Math.hypot(x - source.x, z - source.z);
    const mirrored = Math.hypot(x - source.x, z + source.z);
    temperature += source.k * Math.log(mirrored / Math.max(direct, 1e-9));
  }
  return temperature;
}

export function fieldModel(record: RunRecord | undefined): FieldModel | null {
  const field = record?.result.cases[0]?.artifacts[TEMPERATURE_FIELD] as TemperatureField | undefined;
  const summary = record?.summary;
  if (!field || !summary?.operating || summary.ambient_c === undefined) return null;
  const ambient = summary.ambient_c;
  const published = field.temperature_k.map(value => value - 273.15);
  const view = field.analytical_soil_view;
  let sources: FieldSource[] = [];
  let deviation = Number.POSITIVE_INFINITY;
  if (view?.model === 'kennelly-image-line-sources' && view.condition === 'operating') {
    sources = summary.operating.cables.flatMap(cable => cable.x === null || cable.z === null ? [] :
      [{ x: cable.x, z: cable.z, k: view.soil_thermal_resistivity_k_m_w * cable.losses_w_m.total / (2 * Math.PI) }]);
    if (sources.length === summary.operating.cables.length) {
      deviation = 0;
      field.mesh.points.forEach(([x, z], index) => {
        deviation = Math.max(deviation, Math.abs(temperatureAt(ambient, sources, x, z) - published[index]));
      });
    }
  }
  return {
    ambient,
    kind: deviation <= TOLERANCE_K ? 'analytic' : 'mesh',
    sources,
    nodes: published.length,
    deviation,
    hottest: Math.max(...published),
    mesh: { points: field.mesh.points, triangles: field.mesh.triangles, celsius: Float32Array.from(published) },
  };
}

/** Where a temperature level lies on a ray from a point, by bisection. Temperature falls along the ray beyond `from`. */
export function levelOnRay(model: FieldModel, level: number, origin: [number, number], angle: number, from: number, to: number): [number, number] | null {
  const at = (distance: number): [number, number] => [origin[0] + Math.cos(angle) * distance, origin[1] + Math.sin(angle) * distance];
  const value = (distance: number) => temperatureAt(model.ambient, model.sources, ...at(distance));
  if (!(value(from) > level && value(to) < level)) return null;
  let near = from;
  let far = to;
  for (let step = 0; step < 40; step += 1) {
    const middle = (near + far) / 2;
    if (value(middle) > level) near = middle; else far = middle;
  }
  return at((near + far) / 2);
}
