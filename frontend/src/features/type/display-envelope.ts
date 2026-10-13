import { cableShape } from '../drawing/cable-geometry';
import type { CableType, DomainDocument } from '../drawing/types';
import type { CadModel } from '../cad/types';

export function hasCorrugatedSheath(cable: CableType) {
  return [...cable.common_layers, ...cable.cores.flatMap(core => core.layers)].some(layer => layer.form === 'corrugated');
}

/** Display-only nominal section. It contains no solid, volume, mass or exact topology. */
export async function corrugatedDisplay(document: DomainDocument, cable: CableType): Promise<CadModel> {
  if (!hasCorrugatedSheath(cable) || cable.construction !== 'single_core' || cable.cores.some(core => ['sectoral','hollow','segmental'].includes(core.conductor.form)))
    throw new Error('此结构的等效显示未覆盖，请查看二维截面。');
  return sectionEnvelope(document, cable, true);
}

/** Same section dimensions, display only. Gap fillers are omitted until the
 * plugin mesh arrives, rather than covered by a fictitious cylinder. */
export async function sectionEnvelope(document: DomainDocument, cable: CableType, corrugated = false): Promise<CadModel> {
  const shape = cableShape(cable, document.materials);
  if (shape.rings.some(ring => ring.profile.kind !== 'circle') || corrugated && shape.rings.some(ring => ring.holes.length)) throw new Error('非圆形截面不能替换为圆柱，请查看二维截面。');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(document)));
  const categories = { conductor: 'conductor', semi: 'semiconductor', insulation: 'insulation', metal: 'metal', sheath: 'polymer', fill: 'filler' };
  const depths = [...new Set(shape.rings.map(ring => ring.target.scope + '/' + ring.target.role))];
  return { schema:'cablesim.cad-model/1', brep_unit:'mm', axis:'+Z', input_sha256:[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join(''), length_m:.4,
    outer_diameter_m:shape.radiusM*2, envelope:true,
    layers:shape.rings.filter(ring=>!ring.holes.length).map(ring=>({ entity:ring.id, label:ring.name, role:ring.target.role,
      peel_fraction:1 - depths.indexOf(ring.target.scope + '/' + ring.target.role) / Math.max(1,depths.length - 1) * .55,
      source_target:{scope:ring.target.scope,role:ring.target.role,...(ring.target.scope==='core'?{core_id:ring.target.coreId}:{})},
      center_m:{x:ring.centerX,z:ring.centerZ}, inner_radius_m:ring.innerM,outer_radius_m:ring.outerM,
      material:(ring.target.scope==='common'?cable.common_layers:cable.cores.find(core=>ring.target.scope==='core'&&core.id===ring.target.coreId)!.layers).find(layer=>layer.role===ring.target.role)?.material || cable.cores.find(core=>ring.target.scope==='core'&&core.id===ring.target.coreId)!.conductor.material,
      category:categories[ring.materialRole], construction:{thickness:ring.outerM-ring.innerM} })),
    material_sources:document.materials.map(material=>({id:material.id,label:material.label})),
  };
}
