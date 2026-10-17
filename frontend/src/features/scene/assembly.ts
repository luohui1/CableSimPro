import type { SurfaceDraw, SurfaceModel, Vec3 } from './surface-model';
/** Disassembly is a display transform. Its progress is not a physical time or thermal state. */
export function assemblyOffset(model: SurfaceModel, draw: SurfaceDraw): Vec3 {
  if (draw.category === 'temperature-field') return [0,0,0];
  if (draw.presentationOffset) return [...draw.presentationOffset];
  const object=model.objects.find(o=>o.id===draw.objectId);
  if(object?.kind!=='cable')return [0,0,0];
  const fraction: Record<string,number>={conductor:0,semiconductor:.12,insulation:.28,metal:.45,polymer:.65};
  return [0,(object.bounds[4]-object.bounds[1])*(fraction[draw.category]??.2),0];
}
export function assemblyProgress(from:number,to:number,elapsedMs:number,durationMs=1600):number {
  if (![from,to,elapsedMs,durationMs].every(Number.isFinite) || from<0 || from>1 || to<0 || to>1 || durationMs<=0) throw new Error('装配动画进度无效。');
  const t=Math.max(0,Math.min(1,elapsedMs/durationMs));
  return from+(to-from)*t*t*(3-2*t);
}
