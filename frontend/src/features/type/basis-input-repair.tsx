import {useState} from 'react';
import {message,optionalRecord,array,record,text,ApiError} from '@/api/client';
import {Button} from '@/components/ui/button';
import {Checkbox} from '@/components/ui/checkbox';
import {Select} from '@/components/ui/select';
import {Dialog} from '@/components/ui/dialog';
import {change} from '@/lib/domain-fields';
import {saveType} from './api';
import {useTypeWorkspace} from './provider';
import {basisValue} from './basis-display';

export async function queryTypeBasis(wid:string,revision:number){
  const response=await fetch(`/api/design/type-workspaces/${encodeURIComponent(wid)}/requirements/basis`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:crypto.randomUUID(),expected_revision:revision}),signal:AbortSignal.timeout(45000)});
  const payload=await response.json();if(!response.ok)throw new ApiError(response.status,text(optionalRecord(payload.detail).message)||text(payload.detail)||'依据查询失败，请重试');return record(payload);
}
/** Explicit edition choice or input edit, followed by real read-only Executor lookup. */
export function BasisInputRepair({field,onResolved}:{field?:{field:string;label:string};onResolved:(value:Record<string,unknown>)=>void}){
  const state=useTypeWorkspace();
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[plan,setPlan]=useState<Record<string,unknown>|null>(null),[resolved,setResolved]=useState<Record<string,unknown>|null>(null),[value,setValue]=useState(''),[ack,setAck]=useState(false);
  const disabled=state.readOnly||state.dirty||state.busy;
  const editions=array(plan?.undeclared_standards||[]).map(item=>record(item));
  const missingFields=array(plan?.missing_fields||[]).map(item=>record(item));
  const unlistedSources=array(plan?.missing||[]).map(item=>record(item));
  const classField=field?.field.endsWith('/conductor_class'),materialField=field?.field.endsWith('/standard_kind');
  const supported=classField||materialField;
  const options=classField?[1,2,5,6].map(number=>({value:String(number),label:'第 '+number+' 类'})):field?.label.startsWith('铠装')?[{value:'steel_galvanized',label:'镀锌钢'},{value:'steel_stainless_nonmagnetic',label:'非磁性不锈钢'},{value:'aluminium',label:'铝'},{value:'aluminium_alloy',label:'铝合金'}]:field?.label.startsWith('导体')?[{value:'copper_bare',label:'裸铜'},{value:'copper_coated',label:'镀金属铜'},{value:'aluminium',label:'铝'}]:field?.label.startsWith('金属')?[{value:'aluminium',label:'铝'},{value:'lead',label:'铅'},{value:'copper_bare',label:'铜'}]:[{value:'XLPE',label:'XLPE'},{value:'EPR',label:'EPR'}];
  const cannotConfirm=disabled||!plan||(field? !supported||!value:!editions.length||!ack);
  async function start(){setOpen(true);setBusy(true);setError('');setPlan(null);setResolved(null);setAck(false);setValue('');try{setPlan(await queryTypeBasis(state.workspace!.id,state.workspace!.revision));}catch(failure){setError(message(failure));}finally{setBusy(false);}}
  async function confirm(){if(busy||disabled||!plan||(!field&&!ack)||field&&(!supported||!value))return;setBusy(true);setError('');try{
    let next=state.workspace!;
    await state.commitResourceValue(async()=>{
      let document=structuredClone(state.document!);
      if(field){document=change(document,field.field,classField?Number(value):value);document.provenance={...document.provenance,[field.field]:{kind:'user',reference:'工程师在要求清单填写'+field.label+'；未批准产品判定',reviewed:false}};}
      else {
        const source=optionalRecord(document.provenance?.['/execution_standards']);let prior:unknown[]=[];
        try{prior=array(optionalRecord(JSON.parse(text(source.reference))).items);}catch{ /* Explicit confirmation replaces an invalid declaration, never an approval. */ }
        const items=[...prior,...editions].filter((item,index,all)=>all.findIndex(other=>text(optionalRecord(other).standard)===text(optionalRecord(item).standard))===index);
        document.provenance={...document.provenance,'/execution_standards':{kind:'standard',reviewed:true,reference:JSON.stringify({schema:'cablesim.execution-standards/1',items})}};
      }
      next=await saveType(state.workspace!,document);
    },field?'已保存'+field.label+'；旧判定为历史。':'已确认执行标准版本；未批准要求或产品。');
    const receipt=await queryTypeBasis(next.id,next.revision);setResolved(receipt);onResolved(receipt);
  }catch(failure){setError(message(failure));}finally{setBusy(false);}}
  const references=[...new Map(Object.values(optionalRecord(optionalRecord(resolved?.parameters).basis_references)).map(ref=>record(ref)).map(ref=>[text(ref.record_id),ref])).values()];
  return <><Button variant="ghost" size="compact" disabled={disabled} onClick={event=>{event.stopPropagation();void start();}}>{field?'填写'+field.label:'声明执行标准'}</Button>
    <Dialog open={open} onOpenChange={value=>{if(!busy)setOpen(value);}} title={field?'填写'+field.label:'确认执行标准版本'} description="保存为新修订并查询依据；旧判定保留为历史，要求批准需单独确认。" actions={resolved||!field&&plan&&!editions.length?<Button onClick={()=>setOpen(false)}>返回要求清单</Button>:<Button variant="primary" loading={busy} disabled={cannotConfirm} onClick={()=>void confirm()}>{field?'保存并查询依据':'确认执行标准并查询依据'}</Button>}>
      {error&&<p role="alert" className="field-error">{error}</p>}
      {busy&&<p role="status">{plan?'正在保存并查询固定版本依据':'正在读取型号条件'}</p>}
      {!resolved&&field&&supported&&<Select label={field.label} value={value} disabled={busy} onChange={setValue} options={options} />}
      {!resolved&&!field&&plan&&<><ul>{editions.map(item=><li key={text(item.standard)}>{text(item.standard)}</li>)}</ul>{editions.length?<label className="type-check-label"><Checkbox aria-label="已核对执行标准版本" checked={ack} disabled={busy} onCheckedChange={checked=>setAck(checked===true)} />已核对执行标准版本</label>:<section role="status" aria-label="执行标准版本与缺项"><p>执行标准版本已经声明，无须重复确认。请返回要求清单处理实际缺项。</p>{missingFields.length>0&&<><p>{missingFields.length} 组型号条件尚未完整，按原始依据查询定位如下：</p><ul>{missingFields.map((item,index)=><li key={index}>{text(item.reason)||array(item.fields||[]).map(value=>text(optionalRecord(value).label)).filter(Boolean).join('、')}</li>)}</ul></>}{unlistedSources.map((item,index)=><p key={index}>本库尚未收录：{text(item.reason)||'请查看标准依据与版本。'}</p>)}</section>}</>}
      {resolved&&<section aria-label="当前输入标准依据"><p>当前输入依据 · 旧判定需重算</p>{references.map(ref=><p key={text(ref.record_id)} title={JSON.stringify(optionalRecord(ref.record).conditions)}>依据已核验 · {text(optionalRecord(ref.record).citation).split('（PDF')[0]} · {basisValue(ref)}</p>)}{!references.length&&<p>尚未取得依据，请核对执行标准版本与型号条件。</p>}{array(resolved.missing_fields).map((item,index)=><p key={'field'+index}>{text(optionalRecord(item).reason)}</p>)}{array(resolved.undeclared_standards||[]).map(item=><p key={text(optionalRecord(item).standard)}>缺字段：执行标准版本 · {text(optionalRecord(item).standard)}；返回后使用“声明执行标准”。</p>)}{array(resolved.missing).map((item,index)=><p key={'missing'+index}>本库暂未收录 · {text(optionalRecord(item).reason)}</p>)}</section>}
    </Dialog></>;
}
