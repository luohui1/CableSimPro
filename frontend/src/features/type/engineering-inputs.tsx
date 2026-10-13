import { useRef, useState } from 'react';
import { message, optionalRecord, text } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NumberField } from '@/components/ui/number-field';
import { Select } from '@/components/ui/select';
import { change } from '@/lib/domain-fields';
import { saveType } from './api';
import { useTypeWorkspace } from './provider';

type Field = { field: string; label: string; unit: string; type: string; storage: string; scale: number; display_unit: string; min?: number; max?: number; context: string };
const materialOptions = [{value:'steel_galvanized',label:'镀锌钢'},{value:'steel_stainless_nonmagnetic',label:'非磁性不锈钢'},{value:'aluminium',label:'铝'},{value:'aluminium_alloy',label:'铝合金'},{value:'other',label:'其他（保留缺项）'}];
export function EngineeringInputEntry({ checks, label='录入工程输入' }: { checks: Record<string,unknown>[]; label?: string }) {
  const state=useTypeWorkspace(), fields=new Map<string,Field>();
  for(const check of checks){
    const row=optionalRecord(check.result),target=optionalRecord(row.target),index=state.document?.cable_types[0].cores.findIndex(core=>core.id===target.core_id) ?? -1;
    for(const value of Array.isArray(row.engineering_inputs)?row.engineering_inputs:[]){
      const spec=optionalRecord(value),key=text(spec.field);
      if(key&&!fields.has(key))fields.set(key,{field:key,label:text(spec.label),unit:text(spec.unit)||'1',type:text(spec.type),storage:text(spec.storage)||'provenance',scale:Number(spec.scale)||1,display_unit:text(spec.display_unit)||text(spec.unit),min:spec.min==null?undefined:Number(spec.min),max:spec.max==null?undefined:Number(spec.max),context:index>=0?'芯 '+(index+1):'公共护层'});
    }
  }
  const [open,setOpen]=useState(false),[values,setValues]=useState<Record<string,string|number|boolean|null>>({}),[drafts,setDrafts]=useState<Record<string,string|undefined>>({}),[reference,setReference]=useState(''),[ack,setAck]=useState(false),[error,setError]=useState('');
  const pending=useRef(false), disabled=state.readOnly||state.dirty||state.busy;
  const provided=[...fields.values()].filter(field=>values[field.field]!=null&&values[field.field]!=='');
  async function save(){
    if(pending.current||disabled||!provided.length||!reference.trim()||!ack)return;
    pending.current=true;setError('');
    try{
      await state.commitResourceValue(async()=>{
        let document=structuredClone(state.document!);
        for(const field of provided){
          const raw=values[field.field],value=field.type==='number'?Number(raw)/field.scale:raw;
          if(field.type==='number'&&(!Number.isFinite(Number(value))||field.min!=null&&Number(value)<field.min||field.max!=null&&Number(value)>field.max))throw new Error(field.label+'：请核对单位与范围。');
          const source={kind:'user' as const,reviewed:false,reference:field.storage==='domain'?'工程师声明：'+reference.trim():JSON.stringify({schema:'cablesim.manufacturing-input/1',value,unit:field.unit,reference:reference.trim(),recorded_at:new Date().toISOString()})};
          if(field.storage==='domain')document=change(document,field.field,value);
          document.provenance={...document.provenance,[field.field]:source};
        }
        return saveType(state.workspace!,document);
      },'工程输入已保存为新修订；请重新核对标准。撤销可回到录入前。');
      setOpen(false);
    }catch(failure){setError(message(failure));}finally{pending.current=false;}
  }
  if(!fields.size)return null;
  return <><Button size="compact" variant="outline" disabled={disabled} onClick={event=>{event.stopPropagation();setValues({});setDrafts({});setReference('');setAck(false);setError('');setOpen(true);}}>{label}</Button>
    <Dialog open={open} onOpenChange={value=>{if(!pending.current)setOpen(value);}} title="录入工程输入" description="仅保存明确声明的输入；屏蔽截面仍需独立短路容量校核，不自动批准。留空项保持缺项。" actions={<Button variant="primary" loading={state.busy} disabled={disabled||!provided.length||!reference.trim()||!ack||Object.values(drafts).some(v=>v!==undefined)} onClick={()=>void save()}>保存工程输入</Button>}>
      <div className="type-measurements">
        <div className="type-measured-values type-engineering-values">{[...fields.values()].map(field=>{const label=field.context+' · '+field.label;return <div key={field.field} data-engineering-field={field.label}>
          {field.type==='number'?<NumberField label={label} value={typeof values[field.field]==='number'?values[field.field] as number:null} precision={3} unit={field.display_unit} min={(field.min??0)*field.scale} max={field.max==null?undefined:field.max*field.scale} minExclusive={(field.min??0)>0} draftText={drafts[field.field]} onDraftChange={value=>setDrafts(previous=>({...previous,[field.field]:value}))} onCommit={value=>setValues(previous=>({...previous,[field.field]:value}))}/>:field.type==='text'?<label>{label}<Input aria-label={label} value={text(values[field.field])} maxLength={1000} onChange={event=>setValues(previous=>({...previous,[field.field]:event.target.value}))}/></label>:<Select label={label} value={values[field.field]==null?'':String(values[field.field])} options={[{value:'',label:'尚未声明'},...(field.type==='material'?materialOptions:[{value:'true',label:'是'},{value:'false',label:'否'}])]} onChange={value=>setValues(previous=>({...previous,[field.field]:value===''?null:field.type==='boolean'?value==='true':value}))}/>}</div>;})}</div>
        <label>工程输入出处<Input aria-label="工程输入出处" value={reference} maxLength={1000} onChange={event=>setReference(event.target.value)}/></label>
        <label className="type-confirm"><Checkbox checked={ack} onCheckedChange={value=>setAck(value===true)}/>已逐项核对输入、单位与出处；这是工程声明，不代替实测或要求批准</label>
        {error&&<p className="field-error" role="alert">{error}</p>}
      </div>
    </Dialog></>;
}
