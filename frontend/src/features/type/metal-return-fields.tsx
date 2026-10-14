import { optionalRecord, text } from '@/api/client';
import type { DomainDocument } from '../drawing/types';
import { Input } from '@/components/ui/input';
import { NumberField } from '@/components/ui/number-field';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { layerRows } from './layers';

export function MetalReturnFields({document,values,readOnly,onChange,parallel}:{document:DomainDocument;values:Record<string,unknown>;readOnly:boolean;onChange:(path:string,value:unknown)=>void;parallel:boolean}){
  const rows=layerRows(document,document.cable_types[0]).filter(layer=>['metallic_screen','metallic_sheath','armour'].includes(layer.target.role));
  const components=Array.isArray(values.parallel_components)?values.parallel_components.map(optionalRecord):[];
  function change(index:number,key:string,value:unknown){onChange('/parallel_components',components.map((item,i)=>i===index?{...item,[key]:value}:item));}
  if(!parallel)return <label className="type-form-label"><Checkbox checked={values.metal_nonmagnetic===true} disabled={readOnly} onCheckedChange={checked=>onChange('/metal_nonmagnetic',checked===true?true:null)}/>已核对本分支金属回路为非磁性材料（含钢铠装时不可勾选）</label>;
  return <details className="type-metal-returns"><summary>并联金属回流 · {components.length} 个部件</summary>
    {!components.length?<Button size="compact" disabled={readOnly||!rows.length} onClick={()=>onChange('/parallel_components',rows.map(row=>({row_id:(row.target.scope==='core'?row.target.coreId:'common')+':'+row.target.role+'-adiabatic',resistance_ohm:null,initial_temperature_k:null,final_temperature_k:null,source:''})))}>配置全部回流部件</Button>:components.map((component,index)=>{const layer=rows.find(row=>text(component.row_id)===(row.target.scope==='core'?row.target.coreId:'common')+':'+row.target.role+'-adiabatic');return <fieldset key={text(component.row_id)}><legend>{layer?.label||'金属回流部件'}</legend><div className="type-method-inline-fields">
      <NumberField label="回流段电阻" unit="Ω" value={typeof component.resistance_ohm==='number'?component.resistance_ohm:null} min={0} minExclusive precision={6} disabled={readOnly} onCommit={value=>change(index,'resistance_ohm',value)}/>
      <NumberField label="组件初温" unit="°C" value={typeof component.initial_temperature_k==='number'?component.initial_temperature_k-273.15:null} min={-50} max={500} precision={1} disabled={readOnly} onCommit={value=>change(index,'initial_temperature_k',value==null?null:value+273.15)}/>
      <NumberField label="允许终温" unit="°C" value={typeof component.final_temperature_k==='number'?component.final_temperature_k-273.15:null} min={-50} max={500} precision={1} disabled={readOnly} onCommit={value=>change(index,'final_temperature_k',value==null?null:value+273.15)}/>
      <label>电阻、温限与连接出处<Input value={text(component.source)} disabled={readOnly} onChange={event=>change(index,'source',event.target.value)}/></label>
    </div></fieldset>;})}<p className="type-meta">填写同一电气段的全部部件；按电阻倒数分流，每个部件保留自己的温度与来源。</p></details>;
}
