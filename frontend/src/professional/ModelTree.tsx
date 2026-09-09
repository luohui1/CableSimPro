import {Eye, EyeOff, Layers3} from 'lucide-react';
import {useStudio} from '../StudioState';
import {layers, fmt} from '../utils';
/** Inspectors refer to the same parameter objects as the real WebGL meshes. */
export function ModelTree({onInspect}:{onInspect:(index:number)=>void}){
 const s=useStudio();if(!s.w)return null;
 return <section className="ref-model-tree" aria-label="电缆模型树"><p>单芯电缆 · 六层等效结构</p>{layers(s.w.scenario.cable).map((l,i)=><button key={l.name} onClick={()=>onInspect(i)}><Layers3 size={18}/><span><b>{l.name}</b><small>外径 {fmt(l.radius_mm*2,2)} mm</small></span><span>检查 →</span></button>)}<small>层级与尺寸来自当前工程；不代表厂家制造结构。</small></section>;
}
