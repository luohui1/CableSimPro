import type { Point, Triangle } from '@/features/field/contours';

/** Display a subset of saved triangles around cables; no new physical values.
 * Full-domain mode uses the original projection. Full-grid probing stays remote.
 */
export function focusField(points: Point[], triangles: Triangle[], values: number[], objects: {x:number;z:number;r:number}[]) {
  if(!objects.length)return {points,triangles,values};
  const left=Math.min(...objects.map(o=>o.x-o.r)),right=Math.max(...objects.map(o=>o.x+o.r));
  const bottom=Math.min(...objects.map(o=>o.z-o.r)),top=Math.max(0,...objects.map(o=>o.z+o.r));
  const padding=Math.max(.35,(right-left)*.5,(top-bottom)*.25);
  const inside=points.map(([x,z])=>x>=left-padding && x<=right+padding && z>=bottom-padding && z<=top+padding);
  const selected=triangles.filter(t=>t.every(i=>inside[i]));
  if(!selected.length)return {points,triangles,values};
  const indexes=[...new Set(selected.flat())],mapping=new Map(indexes.map((id,i)=>[id,i]));
  return {points:indexes.map(i=>points[i]),values:indexes.map(i=>values[i]),
    triangles:selected.map(t=>[mapping.get(t[0])!,mapping.get(t[1])!,mapping.get(t[2])!] as Triangle)};
}
