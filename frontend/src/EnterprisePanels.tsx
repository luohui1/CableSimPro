import {useEffect,useRef,useState} from 'react';
import {ArrowRight,Check,ChevronDown,FileText,Layers3,Plus,Search,ShieldCheck,X} from 'lucide-react';
import {useStudio,type Proposal} from './StudioState';
import type {Cable,Scenario} from './types';
import {api,canonical,download,errorText,fmt,layers} from './utils';
import {engineeringCall} from './runtimeClient';
import {labelFor} from './StudioPanels';
import {defaultVertical,VerticalSettings,type VerticalConfig} from './VerticalPanel';

export interface ProductSpec {
 code:string;name:string;manufacturer:string;cable:Cable;rated_u0_kv:number;
 r20_basis:'manufacturer_maximum'|'sample_measurement'|'estimated';evidence_note:string;
 price_per_m:number|null;currency:'CNY'|'USD'|'EUR';source_workspace_id:string|null;source_id:string|null;
 source_snapshot?:unknown;
}
export interface ProductVersion {
 id:string;product_id:string;version:number;head:number;state:'draft'|'reviewed'|'withdrawn';is_current_reviewed:boolean;
 content_sha256:string;specification:ProductSpec;events:{event:string;reviewer:string;note:string;created:string}[];
}
export const stateName={draft:'待核对',reviewed:'已核对',withdrawn:'已停用'};
const resistanceName={manufacturer_maximum:'厂家保证最大值',sample_measurement:'试样实测值',estimated:'估算／未取得保证值'};

export function ProductLibrary({onPropose,onChange}:{onPropose:()=>void;onChange:()=>void}){
 const s=useStudio();const [products,setProducts]=useState<ProductVersion[]>([]),[chosen,setChosen]=useState<ProductVersion|null>(null),[versions,setVersions]=useState<ProductVersion[]>([]);
 const [query,setQuery]=useState(''),[draft,setDraft]=useState<ProductSpec|null>(null),[parent,setParent]=useState<ProductVersion|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[reviewAction,setReviewAction]=useState<'review'|'withdraw'|null>(null),[reviewer,setReviewer]=useState(''),[note,setNote]=useState(''),[confirm,setConfirm]=useState(false);
 const counter=useRef(0);
 async function refresh(){setProducts(await api('/api/enterprise/products'))}
 useEffect(()=>{void refresh().catch(e=>setError(errorText(e)))},[]);
 async function task(fn:()=>Promise<void>){if(counter.current)return;counter.current++;setBusy(true);setError('');try{await fn()}catch(e){setError(errorText(e))}finally{counter.current--;setBusy(false)}}
 const blocked=busy||s.busy||Object.keys(s.inputDrafts).length>0;
 async function choose(v:ProductVersion){setDraft(null);setParent(null);setReviewAction(null);setChosen(v);setVersions(await api(`/api/enterprise/products/${v.product_id}/versions`))}
 function start(v?:ProductVersion){
  setError('');setReviewAction(null);setParent(v??null);
  if(v){const {source_snapshot,...spec}=v.specification;setDraft(structuredClone(spec))}
  else setDraft({code:'',name:s.w!.scenario.cable.name,manufacturer:'',cable:{...s.w!.scenario.cable},rated_u0_kv:s.w!.scenario.cable.u0_kv,r20_basis:'estimated',evidence_note:'',price_per_m:null,currency:'CNY',source_id:null,source_workspace_id:null});
 }
 async function save(){if(!draft)return;await task(async()=>{
  const body={...draft,cable:{...draft.cable,name:draft.name}};
  const v=await api<ProductVersion>(parent?`/api/enterprise/products/${parent.product_id}/versions`:'/api/enterprise/products',parent?{expected_head:parent.head,specification:body}:body);
  await refresh();await choose(v);onChange();
 })}
 async function transition(){if(!chosen||!reviewAction)return;await task(async()=>{
  const v=await api<ProductVersion>(`/api/enterprise/versions/${chosen.id}/${reviewAction}`,{content_sha256:chosen.content_sha256,confirmed:confirm,reviewer,note});
  await refresh();await choose(v);setConfirm(false);onChange();
 })}
 async function propose(){if(!chosen)return;await task(async()=>{const p=await engineeringCall<Proposal>(s.w!.id,s.w!.revision,'products.propose',{version_id:chosen.id});s.adoptProposal(p);onPropose()})}
 const numeric=[['area_mm2','导体截面积','mm²',50,1000],['insulation_mm','绝缘厚度','mm',2,15],['jacket_mm','外护套厚度','mm',1,8],['metallic_screen_mm','等效金属屏蔽厚度','mm',.05,3]] as const;
 return <div className="product-library">
  <header className="enterprise-section-heading"><div><span className="eyebrow">企业数据 / 型号版本</span><h1>产品型号</h1><p>型号内容按版本保存；项目引用快照，不回写产品主数据。</p></div><button className="primary" disabled={blocked} onClick={()=>start()}><Plus size={16}/>从当前电缆建草稿</button></header>
  {error&&<p role="alert" className="enterprise-error">{error}</p>}
  <div className="product-library-grid"><aside className="product-index"><label className="product-search"><Search size={16}/><input aria-label="检索企业型号" placeholder="型号、名称或企业…" value={query} onChange={e=>setQuery(e.target.value)}/></label>
   {!products.length&&<div className="enterprise-empty"><Layers3 size={30}/><b>尚无企业型号</b><p>从当前结构建立草稿，核对厂家保证电阻与全部参数后，才参与正式候选研究。</p><small>不会自动把演示模板当成可供货产品。</small></div>}
   {products.filter(v=>(v.specification.code+v.specification.name+v.specification.manufacturer).toLowerCase().includes(query.toLowerCase())).map(v=><button key={v.id} className={`product-index-row ${chosen?.product_id===v.product_id?'selected':''}`} disabled={busy} onClick={()=>void task(()=>choose(v))}><span><b>{v.specification.code}</b><small>{v.specification.name}</small><small>{v.specification.manufacturer}</small></span><span><em className={`lifecycle ${v.state}`}>{stateName[v.state]}</em><small>v{v.version}</small></span></button>)}
  </aside><section className="product-detail">
   {draft?<form className="product-editor" onSubmit={e=>{e.preventDefault();void save()}}><header><h2>{parent?'修订为新版本':'建立型号草稿'}</h2><button type="button" onClick={()=>setDraft(null)} disabled={busy}>取消编辑</button></header><p className="enterprise-note">以下是产品定义。已有型号不被覆盖；尺寸、电阻及未编辑的物性均需逐项核对。</p>
    <div className="enterprise-form-grid"><label>型号编码<input required maxLength={80} aria-label="企业型号编码" disabled={!!parent||busy} value={draft.code} onChange={e=>setDraft({...draft,code:e.target.value})}/></label><label>产品名称<input required maxLength={100} aria-label="企业产品名称" value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label><label>生产企业<input required maxLength={120} aria-label="生产企业" value={draft.manufacturer} onChange={e=>setDraft({...draft,manufacturer:e.target.value})}/></label><label>声明额定 U₀ / kV<input type="number" required min={1} max={26} step="any" value={Number.isFinite(draft.rated_u0_kv)?draft.rated_u0_kv:''} onChange={e=>setDraft({...draft,rated_u0_kv:e.target.value===''?NaN:Number(e.target.value)})}/></label><label>导体材料<select aria-label="产品导体材料" value={draft.cable.conductor} onChange={e=>setDraft({...draft,cable:{...draft.cable,conductor:e.target.value as Cable['conductor']}})}><option value="copper">铜</option><option value="aluminium">铝</option></select></label>
    {numeric.map(([key,label,unit,min,max])=><label key={key}>{label} / {unit}<input aria-label={'产品'+label} type="number" required min={min} max={max} step="any" value={Number.isFinite(draft.cable[key])?draft.cable[key]:''} onChange={e=>setDraft({...draft,cable:{...draft.cable,[key]:e.target.value===''?NaN:Number(e.target.value)}})}/></label>)}
    <label>20 °C 直流电阻 R20 / Ω·km⁻¹<input aria-label="产品 R20" type="number" min={.000001} max={10} step="any" value={draft.cable.r20_ohm_km??''} onChange={e=>setDraft({...draft,cable:{...draft.cable,r20_ohm_km:e.target.value===''?null:Number(e.target.value)}})}/></label><label>电阻数据性质<select aria-label="电阻数据性质" value={draft.r20_basis} onChange={e=>setDraft({...draft,r20_basis:e.target.value as ProductSpec['r20_basis']})}>{Object.entries(resistanceName).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label><label>单芯每米价格（可选）<input aria-label="单芯每米价格" type="number" min={0} max={100000} step="any" value={draft.price_per_m??''} onChange={e=>setDraft({...draft,price_per_m:e.target.value===''?null:Number(e.target.value)})}/></label><label>币种<select value={draft.currency} onChange={e=>setDraft({...draft,currency:e.target.value as ProductSpec['currency']})}><option>CNY</option><option>USD</option><option>EUR</option></select></label></div>
    <label>参数核对依据<textarea required minLength={5} maxLength={1500} aria-label="型号核对依据" placeholder="说明规格书、版本，以及保证电阻和其他参数的来源…" value={draft.evidence_note} onChange={e=>setDraft({...draft,evidence_note:e.target.value})}/></label>
    <label>已确认原文引用（可选）<select aria-label="产品资料引用" value={draft.source_id??''} onChange={e=>setDraft({...draft,source_id:e.target.value||null,source_workspace_id:e.target.value?s.w!.id:null})}><option value="">仅记录依据说明，尚无原文引用</option>{s.w!.sources.map(src=><option key={src.id} value={src.id}>{src.title} · p.{src.page}</option>)}</select></label>
    <details><summary>核对全部结构与物性参数</summary><pre>{JSON.stringify(draft.cable,null,2)}</pre><p>高级物性在工程“材料参数”中编辑后可建立草稿。此处未修改的字段按显示值保存，不由 AI 补全。</p></details>
    <button className="primary" disabled={blocked}>保存为待核对版本 <ArrowRight size={16}/></button>
   </form>:chosen?<><header className="product-detail-heading"><div><span className="eyebrow">{chosen.specification.manufacturer}</span><h2>{chosen.specification.name}</h2><span>{chosen.specification.code} · 版本 {chosen.version}</span></div><em className={`lifecycle ${chosen.state}`}>{stateName[chosen.state]}</em></header>
    <div className="product-version-bar"><label>历史版本<select aria-label="型号历史版本" value={chosen.id} onChange={e=>{const v=versions.find(v=>v.id===e.target.value);if(v){setChosen(v);setReviewAction(null)}}}>{versions.map(v=><option value={v.id} key={v.id}>v{v.version} · {stateName[v.state]}</option>)}</select></label><button onClick={()=>start(chosen)} disabled={blocked||chosen.version!==chosen.head}>修订为新版本</button><button className="primary" disabled={blocked||!chosen.is_current_reviewed} onClick={()=>void propose()}>引用到当前方案 <ArrowRight size={15}/></button></div>
    {!chosen.is_current_reviewed&&chosen.state==='reviewed'&&<p className="enterprise-warning">此为历史已核对版本；当前有效版本已更新或停用，不能用于新的候选应用。</p>}
    <dl className="product-facts"><div><dt>导体截面</dt><dd>{fmt(chosen.specification.cable.area_mm2,0)} <small>mm²</small></dd></div><div><dt>计算外径</dt><dd>{fmt(layers(chosen.specification.cable)[5].radius_mm*2,2)} <small>mm</small></dd></div><div><dt>R20</dt><dd>{fmt(chosen.specification.cable.r20_ohm_km,5)} <small>Ω/km</small></dd></div><div><dt>数据性质</dt><dd className="small-value">{resistanceName[chosen.specification.r20_basis]}</dd></div></dl>
    <h3>参数依据</h3><p className="product-evidence">{chosen.specification.evidence_note||'尚未提供'}</p><details><summary>查看不可变完整参数快照</summary><pre>{JSON.stringify(chosen.specification,null,2)}</pre><code>SHA-256 {chosen.content_sha256}</code></details>
    <div className="review-actions">{chosen.state==='draft'&&chosen.version===chosen.head&&<button disabled={blocked} onClick={()=>{setReviewAction('review');setConfirm(false)}}><ShieldCheck size={16}/>核对本版本</button>}{chosen.state==='reviewed'&&<button disabled={blocked} onClick={()=>{setReviewAction('withdraw');setConfirm(false)}}>停用本版本</button>}</div>
    {reviewAction&&<form className="product-review" onSubmit={e=>{e.preventDefault();void transition()}}><h3>{reviewAction==='review'?'型号参数核对':'停用型号版本'}</h3><p>仅记录本机用户声明，不是认证签名。{reviewAction==='review'?'核对前请检查全部参数，不能把试样实测值当作产品保证值。':'停用后不可再批准该版本的候选；历史报告保留，不自动恢复旧版供货。'}</p><div className="enterprise-form-grid"><label>核对人<input aria-label="型号核对人" required maxLength={80} value={reviewer} onChange={e=>setReviewer(e.target.value)}/></label><label>核对说明<input aria-label="型号核对说明" required minLength={5} maxLength={1500} value={note} onChange={e=>setNote(e.target.value)}/></label></div><label className="enterprise-checkbox"><input aria-label="确认型号核对" type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)}/>我已核对以上版本与依据，确认记录本次操作。</label><button className="primary" disabled={blocked||!confirm}>{reviewAction==='review'?'确认核对版本':'确认停用版本'}</button><button type="button" onClick={()=>setReviewAction(null)}>取消</button></form>}
    <h3>生命周期记录</h3><div className="product-events">{chosen.events.map((e,i)=><div key={i}><Check size={14}/><b>{e.event}</b><span>{e.reviewer||'本机操作'}</span><p>{e.note}</p><time>{new Date(e.created).toLocaleString()}</time></div>)}</div>
   </>:<div className="enterprise-empty product-detail-empty"><Layers3 size={38}/><h2>可追溯的企业产品定义</h2><p>选择型号查看版本、参数依据和核对记录。项目可以独立修改，但不会覆盖这里的产品内容。</p><span>草稿 → 参数核对 → 项目引用 → 新版修订</span></div>}
  </section></div>
 </div>;
}

interface Candidate {product_id:string;name:string;manufacturer:string;area_mm2:number;diameter_mm:number;feasible:boolean;reasons:string[];ampacity_a:number|null;operating_temperature_c:number|null;loss_kw:number|null;cost:number|null;currency:string;scenario:Scenario|null;warnings:string[];catalog_snapshot:ProductSpec&{product_version:number;content_sha256:string}}
interface Study {id:string;base_revision:number;domain:string;required_ampacity_a:number;feasible_count:number;candidates:Candidate[];notes:string[];constraints:Record<string,unknown>}
export function ReviewedSelection({onPropose,refreshKey}:{onPropose:()=>void;refreshKey:number}){
 const s=useStudio();const [target,setTarget]=useState('400'),[reserve,setReserve]=useState('10'),[diameter,setDiameter]=useState('80'),[rank,setRank]=useState('area'),[currency,setCurrency]=useState('CNY');
 const [domain,setDomain]=useState<'buried'|'vertical_air'>('buried'),[vertical,setVertical]=useState<VerticalConfig>({...defaultVertical});
 const [study,setStudy]=useState<Study|null>(null),[signature,setSignature]=useState(''),[chosen,setChosen]=useState<string|null>(null),[ids,setIds]=useState<string[]>([]),[count,setCount]=useState(0);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');const action=useRef(false);
 const args={target_current_a:Number(target),reserve_percent:Number(reserve),max_diameter_mm:Number(diameter),rank_by:rank,currency,domain,vertical:domain==='vertical_air'?vertical:null};
 const current=!!study&&signature===canonical(args)&&study.base_revision===s.w!.revision&&!Object.keys(s.inputDrafts).length;
 const blocked=busy||s.busy||Object.keys(s.inputDrafts).length>0;
 useEffect(()=>{setSignature('');void api<ProductVersion[]>('/api/enterprise/eligible').then(list=>setCount(list.length)).catch(e=>setError(errorText(e)))},[refreshKey]);
 async function task(fn:()=>Promise<void>){if(action.current)return;action.current=true;setBusy(true);setError('');try{await fn()}catch(e){setError(errorText(e))}finally{action.current=false;setBusy(false)}}
 async function run(){await task(async()=>{const requested=canonical(args);const r=await engineeringCall<Study>(s.w!.id,s.w!.revision,'selection.reviewed',args);setStudy(r);setSignature(requested);setChosen(r.candidates[0]?.product_id??null);setIds(r.candidates.slice(0,3).map(c=>c.product_id))})}
 async function propose(){if(!current||!chosen)return;await task(async()=>{s.adoptProposal(await api<Proposal>(`/api/design/${s.w!.id}/selection/${study!.id}/propose`,{expected_revision:s.w!.revision,product_id:chosen}));onPropose()})}
 async function report(){if(!study)return;await task(async()=>{const r=await engineeringCall<{html:string}>(s.w!.id,s.w!.revision,'selection.report',{study_id:study.id});download('电缆选型研究记录.html',r.html,'text/html;charset=utf-8')})}
 const selected=study?.candidates.find(c=>c.product_id===chosen);
 return <div className="reviewed-selection"><header className="enterprise-section-heading"><div><span className="eyebrow">工程设计 / 有限候选研究</span><h1>按目标电流选型</h1><p>只计算当前已核对的企业型号。保存每个候选的版本、条件与淘汰原因。</p></div><span className="enterprise-count">{count} 个可用型号</span></header>
  <div className="selection-layout"><aside className="selection-brief"><h2>设计要求</h2><form onSubmit={e=>{e.preventDefault();void run()}}><label>研究环境<select aria-label="企业选型研究域" value={domain} disabled={busy} onChange={e=>setDomain(e.target.value as typeof domain)}><option value="buried">均匀土壤直埋 · 单回路三相</option><option value="vertical_air">空气竖向 · 单根隔离</option></select></label><div className="enterprise-form-grid"><label>目标电流 / A<input aria-label="企业选型目标电流" type="number" min={1} max={3000} step="any" required value={target} disabled={busy} onChange={e=>setTarget(e.target.value)}/></label><label>载流预留 / %<input aria-label="企业选型预留" type="number" min={0} max={50} step="any" required value={reserve} disabled={busy} onChange={e=>setReserve(e.target.value)}/></label></div><label>允许最大外径 / mm<input aria-label="企业选型最大外径" type="number" min={1} max={300} step="any" required value={diameter} disabled={busy} onChange={e=>setDiameter(e.target.value)}/></label><label>排序目标<select aria-label="企业选型排序" value={rank} disabled={busy} onChange={e=>setRank(e.target.value)}><option value="area">较小标称截面积</option><option value="loss">较小运行损耗</option><option value="cost">较低已知采购估算</option></select></label>{rank==='cost'&&<label>采购币种<select value={currency} onChange={e=>setCurrency(e.target.value)}><option>CNY</option><option>USD</option><option>EUR</option></select></label>}
  {domain==='vertical_air'?<VerticalSettings value={vertical} onChange={setVertical} disabled={busy}/>:<div className="fixed-conditions"><b>保持当前工程条件</b><span>环境 {s.w!.scenario.installation.ambient_temperature_c} °C</span><span>土壤热阻率 {s.w!.scenario.installation.soil_rho_k_m_w} K·m/W</span><span>埋深 {s.w!.scenario.installation.depth_m} m · 中心距 {s.w!.scenario.installation.spacing_m} m</span><span>温度上限 ≤ {s.w!.scenario.cable.max_temperature_c} °C</span></div>}
  <button className="primary" disabled={blocked||!count}>{busy?'正在逐项计算…':'计算企业候选'}<ArrowRight size={15}/></button><p className="enterprise-note">锁定参数不放宽；结果不是电压降、短路、保护配合及机械校核的替代品。</p></form></aside>
  <section className="selection-results">{error&&<p className="enterprise-error" role="alert">{error}</p>}{study?<>
   <header className="study-summary"><div><span>本次研究 · rev.{study.base_revision}</span><h2>{study.feasible_count} / {study.candidates.length} 个候选满足本次约束</h2><p>含预留要求 {fmt(study.required_ampacity_a)} A · {study.domain==='buried'?'三相线路总量':'单根竖向全高总量'}</p></div><button disabled={busy} onClick={()=>void report()}><FileText size={16}/>导出研究记录</button></header>
   {!current&&<p className="enterprise-warning" role="status">输入或版本已变化，以下为历史研究；禁止应用，重新计算后再选型。导出仍使用原始快照。</p>}
   <div className="enterprise-table-scroll"><table className="enterprise-table candidate-table"><thead><tr><th>对比</th><th>型号与版本</th><th>截面 / mm²</th><th>载流量 / A</th><th>导体温度 / °C</th><th>判定</th></tr></thead><tbody>{study.candidates.map(c=><tr key={c.product_id} className={chosen===c.product_id?'selected':''} onClick={()=>setChosen(c.product_id)}><td><input aria-label={'对比 '+c.name} type="checkbox" checked={ids.includes(c.product_id)} disabled={!ids.includes(c.product_id)&&ids.length>=4} onClick={e=>e.stopPropagation()} onChange={e=>setIds(e.target.checked?[...ids,c.product_id]:ids.filter(id=>id!==c.product_id))}/></td><td><button className="candidate-name" onClick={()=>setChosen(c.product_id)}>{c.name}</button><small>v{c.catalog_snapshot.product_version} · {c.manufacturer}</small></td><td>{fmt(c.area_mm2,0)}</td><td>{fmt(c.ampacity_a)}</td><td>{fmt(c.operating_temperature_c,2)}</td><td><span className={c.feasible?'pass':'fail'}>{c.feasible?'本次约束通过':'不满足'}</span></td></tr>)}</tbody></table></div>
   {selected&&<div className="candidate-explanation"><header><h3>{selected.name} · 判定依据</h3><button className="primary" disabled={blocked||!current||!selected.feasible} onClick={()=>void propose()}>形成方案变更 <ArrowRight size={15}/></button></header>{selected.feasible?<p>计算载流量 {fmt(selected.ampacity_a)} A ≥ 要求 {fmt(study.required_ampacity_a)} A。仅在保存的结构与工况、现有计算方法范围内成立。</p>:selected.reasons.map(r=><p className="fail" key={r}>{r}</p>)}<p>外径 {fmt(selected.diameter_mm,2)} mm · 损耗 {fmt(selected.loss_kw,3)} kW · 采购估算 {selected.cost===null?'缺少价格':fmt(selected.cost,2)+' '+selected.currency}</p><details><summary>型号、参数依据与求解警告</summary><p>{selected.catalog_snapshot.evidence_note}</p>{selected.warnings.map((n,i)=><p key={i}>{n}</p>)}<pre>{JSON.stringify(selected.catalog_snapshot,null,2)}</pre></details></div>}
   {!!ids.length&&<section className="candidate-comparison"><header><h3>候选并列对比</h3><small>最多 4 项 · 同一研究条件与总量口径</small></header><div className="comparison-grid" style={{gridTemplateColumns:`repeat(${Math.min(ids.length,4)},minmax(150px,1fr))`}}>{study.candidates.filter(c=>ids.includes(c.product_id)).map(c=><article key={c.product_id}><b>{c.name}</b><small>版本 {c.catalog_snapshot.product_version}</small><strong>{fmt(c.ampacity_a)} <span>A</span></strong><p>外径 {fmt(c.diameter_mm,2)} mm</p><p>损耗 {fmt(c.loss_kw,3)} kW</p><p>采购 {c.cost===null?'未提供':fmt(c.cost,0)+' '+c.currency}</p><em className={c.feasible?'pass':'fail'}>{c.feasible?'本次约束通过':c.reasons.join('；')}</em></article>)}</div></section>}
   <details className="study-limits"><summary>计算范围与未完成校核</summary>{study.notes.map(n=><p key={n}>{n}</p>)}</details>
  </>:<div className="enterprise-empty study-empty"><ShieldCheck size={38}/><h2>先定义要求，再比较产品</h2><p>不会按照截面积比例推算载流量。每个候选使用自身结构和电阻重新计算，并保留不满足的原因。</p><span>当前仅从已核对型号中筛选，不擅自修改产品参数。</span></div>}</section></div>
 </div>;
}

export function EngineeringTask({open,onClose,initialText}:{open:boolean;onClose:()=>void;initialText:string}){
 const s=useStudio(),[text,setText]=useState(initialText),[mode,setMode]=useState<'local'|'openai'>('local'),[consent,setConsent]=useState(false);const composition=useRef(false),input=useRef<HTMLTextAreaElement>(null);
 useEffect(()=>{if(initialText)setText(initialText)},[initialText]);useEffect(()=>{if(open)input.current?.focus()},[open]);
 const p=s.proposal,stale=p?.base_revision!==s.w!.revision,blocked=s.busy||!!Object.keys(s.inputDrafts).length;
 function send(){if(blocked||!text.trim()||(mode==='openai'&&(!consent||!s.status.cloud_configured)))return;void s.plan(text,mode,consent)}
 return <section className="enterprise-task" hidden={!open} aria-label="设计任务"><header><div><span className="eyebrow">当前工程 · rev.{s.w!.revision}</span><h2>{p?.ready?'审查工程变更':'描述设计任务'}</h2></div><button aria-label="收起设计任务" onClick={onClose}><X size={18}/></button></header>
 <div className="task-definition"><textarea ref={input} aria-label="企业工程任务" placeholder="例如：比较土壤热阻率 0.8、1.2、1.6 下的载流量" value={text} maxLength={3000} onChange={e=>setText(e.target.value)} onCompositionStart={()=>{composition.current=true}} onCompositionEnd={()=>{composition.current=false}} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!composition.current&&!e.nativeEvent.isComposing&&e.nativeEvent.keyCode!==229){e.preventDefault();send()}}}/><div className="task-submit"><label>任务解析方式<select aria-label="企业任务解析方式" value={mode} onChange={e=>setMode(e.target.value as typeof mode)}><option value="local">本地明确命令 · 非大模型</option><option value="openai" disabled={!s.status.cloud_configured}>云端模型{s.status.cloud_configured?'':' · 未配置'}</option></select></label><button className="primary" disabled={blocked||!text.trim()||(mode==='openai'&&(!consent||!s.status.cloud_configured))} onClick={send}>规划任务 <ArrowRight size={15}/></button></div></div>
 {mode==='openai'&&<label className="enterprise-checkbox"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>允许向已配置服务发送任务与完整工程参数，可能产生费用。</label>}
 {s.busy&&<p role="status">工程任务处理中；结果将保留输入版本。</p>}
 {p?.ready&&<article className="enterprise-proposal"><header><h3>{p.message||'待确认操作'}</h3><span>基础版本 {p.base_revision}</span></header><table className="enterprise-table"><thead><tr><th>参数</th><th>原值</th><th>拟用值</th></tr></thead><tbody>{p.changes.map(c=><tr key={c.path}><td>{labelFor(c.path)}</td><td>{String(c.before??'估算')}</td><td><b>{String(c.after??'估算')}</b></td></tr>)}</tbody></table>{!p.changes.length&&<p>不修改电缆参数；执行所示研究或记录所示引用。</p>}{p.design_basis&&<p>设计依据将更新为：{String(p.design_basis.environment)}，U = {String(p.design_basis.rated_voltage_kv)} kV。</p>}
 {p.source&&<p>引用：{p.source.title} · 第 {p.source.page} 页</p>}
 {'product_binding' in p&&Boolean(p.product_binding)&&<p>关联企业型号：{String((p.product_binding as Record<string,unknown>).code)} · 版本 {String((p.product_binding as Record<string,unknown>).version)}。产品原件不会改变。</p>}
 <details><summary>查看完整候选参数与假设</summary>{p.assumptions.map(a=><p key={a}>{a}</p>)}<pre>{JSON.stringify({scenario:p.scenario,design_basis:p.design_basis},null,2)}</pre></details>
 {stale&&<p className="enterprise-warning">工程已变化，旧提案不能批准，请重新规划。</p>}<footer><button disabled={s.busy} onClick={()=>void s.review('reject')}>拒绝变更</button><button className="primary" disabled={blocked||stale} onClick={()=>void s.review('approve')}><Check size={16}/>批准并执行</button></footer></article>}
 {p&&!p.ready&&<p className="enterprise-warning">{p.questions.join('；')}</p>}
 {s.output&&!p&&<div className="task-outcome"><Check size={17}/><p>{s.output.statement}</p></div>}
 <details className="task-history"><summary>任务记录与工具执行明细 <ChevronDown size={13}/></summary>{s.notes.map(n=><p key={n.id}><b>{n.role==='user'?'要求':'工程工具'}：</b>{n.text}</p>)}{s.output?.events.map((e,i)=><p key={i}>{e.tool} · {e.detail}</p>)}</details>
 </section>;
}
