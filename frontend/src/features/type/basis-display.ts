import { numeric, optionalRecord, text } from '@/api/client';
import { formatNumber } from '@/lib/format';

const conditions: Record<string,[string,number,string]> = {
  area_m2:['导体截面',1e6,'mm²'], u0_v:['相电压',.001,'kV'],u_v:['额定电压',.001,'kV'],
  um_v:['最高电压',.001,'kV'],conductor_class:['导体类别',1,'类'],core_count:['芯数',1,'芯'],
  nominal_thickness_m:['标称厚度',1000,'mm'],diameter_m:['直径',1000,'mm'],
};
const names: Record<string,string> = {insulation:'绝缘',conductor_material:'导体材料',coating:'表面处理',copper:'铜',aluminium:'铝',plain:'裸导体',metal_coated:'镀金属导体',screen_kind:'屏蔽构造',copper_tape:'铜带',copper_wire:'铜丝',covering_construction:'内衬构造',extruded:'挤包',armour_kind:'铠装构造',tape:'金属带',metal_layer_relation:'金属层关系',same:'相同金属',different:'不同金属',longitudinal_water_barrier:'纵向阻水隔层',lead_sheath_present:'铅套',galvanized_steel:'镀锌钢',nonmagnetic_stainless_steel:'非磁性不锈钢',aluminium_alloy:'铝合金','required_conforming_8.2':'内衬须符合 8.2',extruded_required:'须设置挤包隔离层'};
export function basisConditions(value: unknown) {
  return Object.entries(optionalRecord(value)).map(([key,raw])=>{
    const [label,scale,unit]=conditions[key] || [names[key]||'其他适用条件',1,''];
    const show=(v:unknown)=>typeof v==='boolean'?(v?'是':'否'):numeric(v)!==null?formatNumber(Number(v)*scale,3)+' '+unit:names[text(v)]||text(v);
    const p=optionalRecord(raw),operators:Record<string,string>={eq:'',gt:'>',gte:'≥',lt:'<',lte:'≤',in:'适用于 '};
    return label+' '+(Object.keys(p).length?Object.entries(p).map(([op,v])=>(operators[op]||'')+(Array.isArray(v)?v.map(show).join('、'):show(v))).join('，'):show(raw));
  }).join('；') || '该条不含附加行条件';
}
export function basisValue(reference: unknown) {
  const r=optionalRecord(optionalRecord(reference).record),v=r.value,rawUnit=text(optionalRecord(r.quantity).unit),unit=({'ohm/km':'Ω/km','ohm/m':'Ω/m'} as Record<string,string>)[rawUnit]||rawUnit;
  if(v===null||v===undefined)return '本库暂未收录';
  if(Array.isArray(v))return v.map(item=>names[text(item)]||'其他材料类别').join('、');
  if(typeof v==='object') {const f=optionalRecord(v);if(f.fixed_numeric_area==='standard_not_specified')return '标准未规定固定截面；需工程输入与短路容量依据';return f.kind==='affine'?`${f.a} × ${f.x==='diameter'?'直径':'标称厚度'} ${Number(f.b)<0?'−':'+'} ${Math.abs(Number(f.b))} ${unit}${numeric(f.floor)!==null?`；不小于 ${f.floor} ${unit}`:''}${f.rounding?'；附录 B 修约，本轮未覆盖':''}`:'公式参数见依据详情';}
  return names[text(v)]||`${v} ${unit}`;
}
