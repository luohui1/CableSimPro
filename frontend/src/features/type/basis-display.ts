import { numeric, optionalRecord, text } from '@/api/client';
import { formatNumber } from '@/lib/format';

const conditions: Record<string,[string,number,string]> = {
  area_m2:['导体截面',1e6,'mm²'], u0_v:['相电压',.001,'kV'],u_v:['额定电压',.001,'kV'],
  um_v:['最高电压',.001,'kV'],conductor_class:['导体类别',1,'类'],core_count:['芯数',1,'芯'],
  nominal_thickness_m:['标称厚度',1000,'mm'],diameter_m:['直径',1000,'mm'],
};
const names: Record<string,string> = {insulation:'绝缘',conductor_material:'导体材料',coating:'表面处理',copper:'铜',aluminium:'铝',plain:'裸导体',metal_coated:'镀金属导体'};
export function basisConditions(value: unknown) {
  return Object.entries(optionalRecord(value)).map(([key,raw])=>{
    const [label,scale,unit]=conditions[key] || [names[key]||'其他适用条件',1,''];
    const show=(v:unknown)=>numeric(v)!==null?formatNumber(Number(v)*scale,3)+' '+unit:names[text(v)]||text(v);
    const p=optionalRecord(raw),operators:Record<string,string>={eq:'',gt:'>',gte:'≥',lt:'<',lte:'≤',in:'适用于 '};
    return label+' '+(Object.keys(p).length?Object.entries(p).map(([op,v])=>(operators[op]||'')+(Array.isArray(v)?v.map(show).join('、'):show(v))).join('，'):show(raw));
  }).join('；') || '该条不含附加行条件';
}
export function basisValue(reference: unknown) {
  const r=optionalRecord(optionalRecord(reference).record),v=r.value,rawUnit=text(optionalRecord(r.quantity).unit),unit=({'ohm/km':'Ω/km','ohm/m':'Ω/m'} as Record<string,string>)[rawUnit]||rawUnit;
  if(v===null||v===undefined)return '本库暂未收录';
  if(typeof v==='object') {const f=optionalRecord(v);return f.kind==='affine'?`${f.a} × ${f.x==='diameter'?'直径':'标称厚度'} ${Number(f.b)<0?'−':'+'} ${Math.abs(Number(f.b))} ${unit}${numeric(f.floor)!==null?`；不小于 ${f.floor} ${unit}`:''}${f.rounding?'；附录 B 修约，本轮未覆盖':''}`:'公式参数见依据详情';}
  return `${v} ${unit}`;
}
