import {useEffect,useState} from 'react';
import {Check,ShieldCheck,X} from 'lucide-react';
import {useStudio,type Proposal} from '../StudioState';
import {api,errorText} from '../utils';
import {engineeringCall} from '../runtimeClient';

interface Standard {id:string;designation:string;title:string;category:string;implementation:string;scope:string}
export interface Basis {reference_ids:string[];rated_voltage_kv:number;highest_voltage_kv:number;environment:string;note:string}
interface BasisCheck {can_record:boolean;statement:string;findings:{code:string;level:string;message:string}[]}
const environments:[string,string][]=[['buried','均匀土壤直埋 · 单回路'],['vertical_air','空气中竖向敷设 · 单根隔离'],['duct','排管（尚无求解器）'],['shaft_bundle','竖井成束（尚无求解器）']];
const implementation:Record<string,string>={unsupported:'未实现',partial_reference:'部分方法参考',scope_only:'题录与范围',reference_only:'题录与范围'};
const blank:Basis={reference_ids:[],rated_voltage_kv:20,highest_voltage_kv:24,environment:'buried',note:''};
const envName=(v?:string)=>environments.find(([k])=>k===v)?.[1]??'未登记';

function Summary({basis,standards}:{basis:Basis|null;standards:Standard[]}){
 if(!basis)return <p className="wf-muted">尚未登记设计依据；计算按直埋方法范围检查。</p>;
 const refs=basis.reference_ids.map(id=>standards.find(s=>s.id===id)?.designation??id);
 return <dl className="wf-key-values"><dt>额定电压 U / Um</dt><dd>{basis.rated_voltage_kv} kV / {basis.highest_voltage_kv} kV</dd><dt>敷设环境</dt><dd>{envName(basis.environment)}</dd><dt>参考标准</dt><dd>{refs.length?refs.join('、'):'未选择'}</dd>{basis.note&&<><dt>依据说明</dt><dd>{basis.note}</dd></>}</dl>;
}

/** Design basis is recorded through a reviewable proposal; checking scope never writes. */
export default function DesignBasisSection(){
 const s=useStudio(),w=s.w!,dirty=Object.keys(s.inputDrafts).length>0;
 const saved=(w.design_basis as unknown as Basis|undefined)??null;
 const [standards,setStandards]=useState<Standard[]>([]),[verified,setVerified]=useState('');
 const [editing,setEditing]=useState(false),[basis,setBasis]=useState<Basis>(saved??blank);
 const [check,setCheck]=useState<BasisCheck|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{void api<{items:Standard[];verified_on:string}>('/api/runtime/standards').then(r=>{setStandards(r.items);setVerified(r.verified_on)}).catch(e=>setError(errorText(e)))},[]);
 const proposal:Proposal|null=s.proposal?.mode==='design-basis'&&!s.proposal.expired?s.proposal:null;
 function update(next:Basis){setBasis(next);setCheck(null)}
 async function call<T>(capability:string){setBusy(true);setError('');try{return await engineeringCall<T>(w.id,w.revision,capability,basis)}catch(e){setError(errorText(e));return null}finally{setBusy(false)}}
 async function inspect(){const r=await call<BasisCheck>('standards.inspect');if(r)setCheck(r)}
 async function propose(){const p=await call<Proposal>('standards.propose');if(p){s.adoptProposal(p);setEditing(false);setCheck(null)}}
 const blocked=busy||s.busy||dirty;
 return <div className="wf-basis" role="group" aria-label="设计依据">
  <Summary basis={saved} standards={standards}/>
  {proposal&&<div className="wf-basis-review" role="region" aria-label="设计依据变更审查">
   <h3><ShieldCheck size={15}/>待审查的设计依据变更 · 基于 rev.{proposal.base_revision}</h3>
   <div className="wf-basis-compare"><div><small>当前</small><Summary basis={(proposal.previous_design_basis as unknown as Basis)??null} standards={standards}/></div><div><small>提议</small><Summary basis={proposal.design_basis as unknown as Basis} standards={standards}/></div></div>
   {proposal.assumptions.map(a=><p className="wf-muted" key={a}>{a}</p>)}
   <p className="wf-muted">批准只记录设计依据，不更改电缆参数、物性或求解公式。</p>
   <div className="wf-basis-actions"><button className="wf-primary" disabled={s.busy||dirty||proposal.base_revision!==w.revision} onClick={()=>void s.review('approve')}><Check size={15}/>批准依据变更</button><button disabled={s.busy} onClick={()=>void s.review('reject')}><X size={15}/>拒绝</button></div>
   {proposal.base_revision!==w.revision&&<p className="wf-inline-error">提案基于旧工程版本，不能批准；请拒绝后重新提交。</p>}
  </div>}
  {!proposal&&!editing&&<button disabled={blocked} onClick={()=>{setBasis(saved??blank);setCheck(null);setEditing(true)}}>{saved?'修改设计依据':'登记设计依据'}</button>}
  {!proposal&&editing&&<form className="wf-basis-form" onSubmit={e=>{e.preventDefault();void inspect()}}>
   <fieldset><legend>参考标准 <small>题录核对：{verified||'读取中'}；选择标准不代表条款已实现</small></legend>
    {standards.map(t=><label className="wf-basis-standard" key={t.id}><input type="checkbox" checked={basis.reference_ids.includes(t.id)} onChange={e=>update({...basis,reference_ids:e.target.checked?[...basis.reference_ids,t.id]:basis.reference_ids.filter(x=>x!==t.id)})}/><span><b>{t.designation}</b> {t.title}<small>{t.scope}</small></span><em>{implementation[t.implementation]??t.implementation}</em></label>)}
   </fieldset>
   <div className="wf-basis-fields">
    <label>额定电压 U / kV<input type="number" required step="any" min={.1} max={110} value={basis.rated_voltage_kv||''} onChange={e=>update({...basis,rated_voltage_kv:Number(e.target.value)})}/></label>
    <label>设备最高电压 Um / kV<input type="number" required step="any" min={.1} max={126} value={basis.highest_voltage_kv||''} onChange={e=>update({...basis,highest_voltage_kv:Number(e.target.value)})}/></label>
    <label>敷设环境<select value={basis.environment} onChange={e=>update({...basis,environment:e.target.value})}>{environments.map(([v,n])=><option key={v} value={v}>{n}</option>)}</select></label>
    <label className="wf-basis-note">参数及环境依据<textarea value={basis.note} maxLength={1000} onChange={e=>update({...basis,note:e.target.value})}/></label>
   </div>
   <div className="wf-basis-actions"><button disabled={blocked}>检查适用范围</button><button type="button" disabled={busy} onClick={()=>{setEditing(false);setCheck(null);setError('')}}>取消</button></div>
   {check&&<div className="wf-basis-check" role="status"><h3>{check.can_record?'可记录为设计参考':'存在不适用项'}</h3><p>{check.statement}</p>{check.findings.map((f,i)=><p className={f.level==='error'?'wf-inline-error':'wf-muted'} key={i}>{f.message}</p>)}
    <button className="wf-primary" type="button" disabled={!check.can_record||blocked} onClick={()=>void propose()}>提交依据变更审查</button></div>}
  </form>}
  {dirty&&<p className="wf-inline-error">有未保存输入；保存或撤销后才能修改设计依据。</p>}
  {error&&<p role="alert" className="wf-inline-error">{error}</p>}
 </div>;
}
