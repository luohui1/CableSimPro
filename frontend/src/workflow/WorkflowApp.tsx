import {lazy,Suspense,useEffect,useRef,useState} from 'react';
import {ArrowRight,Box,ChevronRight,FileText,FolderOpen,Layers3,Play,RotateCcw,Save,Settings2,X} from 'lucide-react';
import {StudioProvider,useStudio,valueAt} from '../StudioState';
import type {Result} from '../types';
import {api,fmt,canonical} from '../utils';
import {objects,layerKeys,parseDraft,type ObjectKey} from './fields';
import './workflow.css';
const CableModelView=lazy(()=>import('../CableModelView'));
const PluginDialog=lazy(()=>import('../plugins/ProjectPluginDialog'));
interface GeometryLayer {uid:string;role:string;inner_radius_m:number;outer_radius_m:number}
interface Prepared {status:string;package:{project_id:string;scenario_revision:number;geometry_recipe:{layers:GeometryLayer[]}};issues:{code:string;severity:string;message:string}[]}
interface SavedRun {id:string;revision:number;input_hash:string;output:{result:Result|null};created:string}
type DocumentId='cable'|'study'|`run:${string}`;
const projectFromUrl=new URLSearchParams(location.search).get('project');
function rememberProject(id:string){const u=new URL(location.href);u.searchParams.set('project',id);history.replaceState({},'',u)}
function useRead<T>(url:string|null){
 const [state,setState]=useState<{value:T|null;error:string;url:string|null}>({value:null,error:'',url:null});
 useEffect(()=>{let live=true;setState({value:null,error:'',url});if(url)void api<T>(url).then(value=>{if(live)setState({value,error:'',url})}).catch(e=>{if(live)setState({value:null,error:e.message,url})});return()=>{live=false}},[url]);
 return state.url===url?state:{value:null,error:'',url};
}
function Section({prepared,selection,onSelect}:{prepared:Prepared;selection:ObjectKey;onSelect:(s:ObjectKey)=>void}){
 const ls=prepared.package.geometry_recipe.layers,outer=ls.at(-1)!.outer_radius_m;
 return <svg className="wf-section" viewBox="0 0 640 530" role="img" aria-label="已保存工程的等比例电缆截面" data-diameter-mm={(outer*2000).toFixed(6)}>
  <defs><pattern id="wf-copper" width="11" height="11" patternUnits="userSpaceOnUse"><rect width="11" height="11" fill="#ba8755"/><circle cx="5.5" cy="5.5" r="4.4" fill="#d6ad7c" stroke="#a87548" strokeWidth=".6"/></pattern></defs>
  {[...ls].reverse().map(l=>{const i=ls.indexOf(l),key=layerKeys[i];return <circle key={l.uid} data-layer={key} cx="320" cy="250" r={l.outer_radius_m/outer*177} className={`wf-layer wf-layer-${i}`} style={i===0?{fill:'url(#wf-copper)'}:undefined} onClick={()=>onSelect(key)}/>;})}
  {layerKeys.includes(selection)&&<circle cx="320" cy="250" r={ls[layerKeys.indexOf(selection)].outer_radius_m/outer*177} fill="none" stroke="#246cb1" strokeWidth="3" pointerEvents="none"/>}
  <path d="M143 444V460 M497 444V460 M143 453H497" fill="none" stroke="#8b99a8"/>
  <text x="320" y="480" textAnchor="middle">外径 Ø {fmt(outer*2000,3)} mm</text>
 </svg>;
}
function ResultView({runId}:{runId:string}){
 const s=useStudio(),w=s.w!;
 const {value:run,error}=useRead<SavedRun>(`/api/workspaces/${w.id}/runs/${runId}`);
 const [compareId,setCompareId]=useState('');
 const {value:other,error:compareError}=useRead<SavedRun>(compareId?`/api/workspaces/${w.id}/runs/${compareId}`:null);
 if(error)return <p role="alert">{error}</p>;
 if(!run)return <p role="status">正在读取保存的运行…</p>;
 const r=run.output.result;
 if(!r)return <p>此记录不是单工况稳态结果，请在原工作台查看。</p>;
 const same=run.revision===w.revision&&canonical(r.input)===canonical(w.scenario)&&canonical(r.design_basis??null)===canonical(w.design_basis??null);
 const dirty=Object.keys(s.inputDrafts).length>0;
 const diff=other?.output.result;
 return <div className="wf-result" role="region" aria-label="所选运行结果">
  <div className={`wf-evidence ${same&&!dirty?'':'wf-warning'}`} role="status">{same&&!dirty?'与当前已保存工程版本一致':dirty?'有未保存草稿；下方仍是原运行快照':`历史运行 rev.${run.revision} · 当前工程 rev.${w.revision}`}<span>不会使用新参数重写旧结果</span></div>
  <header className="wf-result-title"><div><small>保存的运行 · {run.id.slice(0,8)}</small><h1>稳态载流量研究</h1></div><button disabled={s.busy} onClick={()=>void s.exportSavedRun(run.id)}><FileText size={16}/>导出此运行计算书</button></header>
  <div className="wf-result-values"><div><span>本模型计算载流量</span><strong>{fmt(r.summary.ampacity_a,2)} <small>A</small></strong></div><div><span>运行点最高温度</span><strong>{fmt(r.summary.operating_max_temperature_c,2)} <small>°C</small></strong></div><div><span>限制相</span><strong>{r.summary.limiting_phase}</strong></div></div>
  <section><h2>输入与方法</h2><dl className="wf-key-values"><dt>运行所用工程版本</dt><dd>rev.{run.revision}</dd><dt>电缆截面积 / 绝缘厚度</dt><dd>{r.input.cable.area_mm2} mm² / {r.input.cable.insulation_mm} mm</dd><dt>埋深 / 中心间距</dt><dd>{r.input.installation.depth_m} m / {r.input.installation.spacing_m} m</dd><dt>方法版本</dt><dd>{r.model_version}</dd></dl><p className="wf-muted">现有稳态热网络；不是完整标准实现、有限元结果或认证结论。</p></section>
  <section><h2>运行比较</h2><label className="wf-compare-label">另一保存运行<select aria-label="比较运行" value={compareId} onChange={e=>setCompareId(e.target.value)}><option value="">选择运行</option>{w.runs.filter(a=>a.id!==run.id).map(a=><option key={a.id} value={a.id}>rev.{a.revision} · {a.id.slice(0,8)}</option>)}</select></label>{compareError&&<p role="alert">{compareError}</p>}
   {diff&&<table aria-label="两次运行比较"><thead><tr><th>项目</th><th>所选 rev.{run.revision}</th><th>对照 rev.{other!.revision}</th></tr></thead><tbody>{[['绝缘厚度 / mm',r.input.cable.insulation_mm,diff.input.cable.insulation_mm],['埋深 / m',r.input.installation.depth_m,diff.input.installation.depth_m],['载流量 / A',r.summary.ampacity_a,diff.summary.ampacity_a],['运行点最高温度 / °C',r.summary.operating_max_temperature_c,diff.summary.operating_max_temperature_c]].map(([label,a,b])=><tr key={String(label)}><th>{label}</th><td>{fmt(a as number,3)}</td><td>{fmt(b as number,3)}</td></tr>)}</tbody></table>}
  </section>
  <details><summary>来源、警告与运行标识</summary><p>输入摘要：<code>{run.input_hash}</code></p>{r.warnings.map(t=><p key={t}>{t}</p>)}</details>
 </div>;
}
function Workbench({onHome}:{onHome:()=>void}){
 const s=useStudio(),w=s.w!;
 const [selection,setSelection]=useState<ObjectKey>('cable'),[doc,setDoc]=useState<DocumentId>('cable'),[docs,setDocs]=useState<DocumentId[]>(['cable']);
 const [threeMounted,setThreeMounted]=useState(false);
 const [view,setView]=useState<'section'|'3d'>('section'),[plugins,setPlugins]=useState(false),[ack,setAck]=useState<number|null>(null),[preflightNonce,setPreflightNonce]=useState(0);
 const base=useRef<number|null>(null),pendingRun=useRef<string|null|undefined>(undefined);
 const dirty=Object.keys(s.inputDrafts).length>0;
 const conflict=dirty&&base.current!==null&&base.current!==w.revision;
 const parsed=Object.entries(s.inputDrafts).map(([path,text])=>parseDraft(path,text)),invalid=parsed.some(p=>p.error);
 const prepared=useRead<Prepared>(`/api/foundation/workspaces/${w.id}/preflight?expected_revision=${w.revision}&target=schema&refresh=${preflightNonce}`);
 const data=prepared.value?.package.scenario_revision===w.revision?prepared.value:null;
 const buried=(w.design_basis?.environment??'buried')==='buried';
 const ready=!!data&&data.status==='package_ready'&&buried&&w.scenario.cable.r20_ohm_km!==null&&!dirty&&!s.busy;
 useEffect(()=>{if(!dirty)base.current=null},[dirty]);
 useEffect(()=>{const handler=(e:BeforeUnloadEvent)=>{if(dirty){e.preventDefault();e.returnValue=''}};window.addEventListener('beforeunload',handler);return()=>window.removeEventListener('beforeunload',handler)},[dirty]);
 useEffect(()=>{if(pendingRun.current!==undefined&&s.output?.run_id&&s.output.run_id!==pendingRun.current){open(`run:${s.output.run_id}`);pendingRun.current=undefined}},[s.output?.run_id]);
 // Persist only document identities. Never store electrical inputs or results in browser storage.
 useEffect(()=>{try{const saved=JSON.parse(localStorage.getItem(`csp-workflow-docs:${w.id}`)??'null');if(Array.isArray(saved)){const accepted=saved.filter((d):d is DocumentId=>d==='cable'||d==='study'||typeof d==='string'&&d.startsWith('run:')&&w.runs.some(r=>`run:${r.id}`===d));if(accepted.length){setDocs(accepted);setDoc(accepted[0])}}}catch{}},[w.id]);
 function open(id:DocumentId){setDoc(id);setDocs(prev=>{const next=prev.includes(id)?prev:[...prev,id];try{localStorage.setItem(`csp-workflow-docs:${w.id}`,JSON.stringify(next))}catch{}return next})}
 function pick(key:ObjectKey){setSelection(key);open(key==='study'||key==='installation'?'study':'cable')}
 function edit(path:string,text:string){if(!dirty)base.current=w.revision;const saved=valueAt(w.scenario,path);s.setInputDraft(path,text===String(saved??'')?null:text)}
 async function save(){if(s.busy||invalid||conflict||!dirty)return;await s.commitDraft(parsed.flatMap(p=>p.change?[p.change]:[]),base.current??w.revision)}
 function close(id:DocumentId){if(docs.length===1)return;const next=docs.filter(d=>d!==id);setDocs(next);if(doc===id)setDoc(next.at(-1)!);try{localStorage.setItem(`csp-workflow-docs:${w.id}`,JSON.stringify(next))}catch{}}
 const object=objects[selection];
 const resultMeta=doc.startsWith('run:')?w.runs.find(r=>r.id===doc.slice(4)):null;
 const title=(id:DocumentId)=>id==='cable'?'C-001 · 电缆':id==='study'?'R-001 · 稳态研究':`运行 ${id.slice(4,12)}`;
 return <div className="wf-shell">
  <header className="wf-top"><button className="wf-brand" disabled={dirty||s.busy} onClick={onHome} aria-label="返回工程首页"><span className="wf-mark">C</span>CableSimPro</button><span className="wf-project-name" title={w.scenario.name}>{w.scenario.name}</span><span className="wf-revision" data-testid="workflow-revision">rev.{w.revision}</span><span className="wf-top-spacer"/>
   <button disabled={s.busy||dirty||!w.can_undo} onClick={()=>void s.history('undo')}><RotateCcw size={15}/>撤销修改</button><button disabled={s.busy} onClick={()=>{void s.reload();setPreflightNonce(n=>n+1)}}>读取最新版本</button>
   <details className="wf-more"><summary>更多</summary><div><button onClick={()=>setPlugins(true)}>插件管理</button><button disabled={dirty||s.busy} onClick={()=>{const u=new URL(location.href);u.searchParams.delete('workflow');u.searchParams.set('mode','workbench');location.assign(u.href)}}>返回原工作台</button></div></details>
  </header>
  {s.error&&<div className="wf-banner wf-error" role="alert"><span>{s.error}</span><button aria-label="关闭操作错误" onClick={s.dismiss}><X size={14}/></button></div>}
  {conflict&&<div className="wf-banner wf-error" role="alert">草稿基于 rev.{base.current}，当前已读取 rev.{w.revision}。已阻止覆盖；请核对下方已保存值，撤销草稿后重新编辑。</div>}
  <div className="wf-body">
   <aside className="wf-outline"><h2>工程对象</h2><nav aria-label="工程对象"><button className={selection==='cable'&&doc==='cable'?'is-selected':''} onClick={()=>pick('cable')}><Box size={16}/><b>C-001 · 电缆</b></button><div className="wf-layer-list">{layerKeys.map((key,i)=><button key={key} className={selection===key&&doc==='cable'?'is-selected':''} aria-pressed={selection===key} onClick={()=>pick(key)}><i className={`wf-layer-dot wf-dot-${i}`}/>{objects[key].name}</button>)}</div>
    <div className="wf-nav-divider"/><button className={selection==='installation'&&doc==='study'?'is-selected':''} onClick={()=>pick('installation')}><Layers3 size={16}/>敷设方案 A</button><button className={doc==='study'&&selection==='study'?'is-selected':''} onClick={()=>pick('study')}><Settings2 size={16}/>R-001 · 稳态研究</button>
    <h2>保存的运行 <span>{w.runs.length}</span></h2>{!w.runs.length&&<p className="wf-empty-inline">完成计算后显示记录</p>}{w.runs.map(r=><button key={r.id} aria-pressed={doc===`run:${r.id}`} className={doc===`run:${r.id}`?'is-selected':''} onClick={()=>open(`run:${r.id}`)}><FileText size={15}/><span>rev.{r.revision} <small>{r.id.slice(0,8)}</small></span></button>)}
   </nav><div className="wf-outline-bottom"><span>输入来源</span><p>当前工程输入 · 非厂家发布资产</p><span>{w.sources.length} 项关联资料</span></div></aside>
   <main className="wf-editor">
    <div className="wf-documents" role="tablist" aria-label="已打开的工程文档">{docs.map(id=><div key={id} className={doc===id?'active':''}><button role="tab" aria-selected={doc===id} onClick={()=>setDoc(id)}>{id==='cable'?<Box size={15}/>:<FileText size={15}/>} {title(id)}{id==='cable'&&dirty&&<span aria-label="有未保存输入">●</span>}</button>{docs.length>1&&<button aria-label={`关闭${title(id)}`} onClick={()=>close(id)}><X size={13}/></button>}</div>)}</div>
    <section className="wf-cable-document" hidden={doc!=='cable'} aria-label="电缆设计文档">
     <div className="wf-document-toolbar"><span>C-001 <ChevronRight size={14}/> {object.name}</span><div><button aria-pressed={view==='section'} onClick={()=>setView('section')}>二维截面</button><button aria-pressed={view==='3d'} onClick={()=>{setThreeMounted(true);setView('3d')}}>三维结构</button></div></div>
     <div className="wf-canvas" data-testid="workflow-canvas">
      <div hidden={view!=='section'} className="wf-section-host">{prepared.error?<div className="wf-center-message" role="alert">{prepared.error}<button onClick={()=>setPreflightNonce(n=>n+1)}>重试读取几何</button></div>:!data?<p className="wf-center-message" role="status">正在读取工程几何…</p>:<Section prepared={data} selection={selection} onSelect={pick}/>}</div>
      {threeMounted&&<div hidden={view!=='3d'} className="wf-three-host"><Suspense fallback={<p>正在加载三维显示…</p>}><CableModelView cable={w.scenario.cable} studio onInspectLayer={i=>pick(layerKeys[i])}/></Suspense></div>}
      <div className="wf-canvas-caption"><span>已保存模型 · rev.{w.revision}{dirty?' · 草稿尚未应用':''}</span><span>等效结构；外观不参与求解</span></div>
     </div>
    </section>
    <section className="wf-study-document" hidden={doc!=='study'} aria-label="稳态研究文档">
     <div className="wf-reading"><small>研究 / R-001</small><h1>稳态载流量</h1><p className="wf-lead">电缆 C-001 · 敷设方案 A · 当前工程 rev.{w.revision}</p>
      <section><h2>01　方法与适用范围</h2><p>现有单回路直埋热网络。三根相同单芯电缆、均匀土壤、稳态平衡电流。</p><p className="wf-muted">不等于完整 IEC 60287 实现；交流附加和屏蔽损耗系数仍是输入。本轮不调用有限元插件。</p><details><summary>查看当前登记的设计依据</summary><pre>{JSON.stringify(w.design_basis??{},null,2)}</pre></details></section>
      <section><h2>02　工况与输入检查</h2><dl className="wf-key-values"><dt>排列 / 平均中心埋深</dt><dd>{w.scenario.installation.arrangement==='flat'?'平行':'三角形'} / {w.scenario.installation.depth_m} m <button className="wf-text" onClick={()=>setSelection('installation')}>编辑敷设</button></dd><dt>环境温度 / 土壤热阻率</dt><dd>{w.scenario.installation.ambient_temperature_c} °C / {w.scenario.installation.soil_rho_k_m_w} K·m/W</dd><dt>运行电流</dt><dd>{w.scenario.operating_current_a} A <button className="wf-text" onClick={()=>setSelection('study')}>编辑研究</button></dd><dt>20°C 导体电阻</dt><dd>{w.scenario.cable.r20_ohm_km??'未提供'} Ω/km <button className="wf-text" onClick={()=>pick('conductor')}>核对导体</button></dd></dl>
       {!buried&&<p className="wf-inline-error">设计依据不属于直埋域，请在原工作台调整并批准方法范围。</p>}{dirty&&<p className="wf-inline-error">还有未保存输入，不能使用旧值运行。</p>}{w.scenario.cable.r20_ohm_km===null&&<p className="wf-inline-error">本流程要求明确保存 R20，避免沿用理想电阻估计。</p>}{prepared.error&&<p role="alert">{prepared.error}</p>}
       <p className="wf-muted">几何预检只确认输入配方，不代表数值精度或标准合规。</p>
      </section>
      <section className="wf-run-action"><label><input type="checkbox" checked={ack===w.revision} disabled={s.busy} onChange={e=>setAck(e.target.checked?w.revision:null)}/>已核对本版本参数来源、损耗系数与方法范围</label><button className="wf-primary" disabled={!ready||ack!==w.revision} onClick={()=>{pendingRun.current=s.output?.run_id??null;void s.run()}}><Play size={15}/>{s.busy?'任务执行中…':'运行当前版本'}</button></section>
     </div>
    </section>
    {docs.filter(id=>id.startsWith('run:')).map(id=><section key={id} hidden={doc!==id} className="wf-run-document"><ResultView runId={id.slice(4)}/></section>)}
   </main>
   <aside className="wf-inspector" aria-label="上下文属性检查器"><header><small>上下文属性</small><h2>{resultMeta?`运行 rev.${resultMeta.revision}`:object.name}</h2><p>{resultMeta?'只读运行快照；不随当前输入变化':object.caption}</p></header>
    <div className="wf-properties">{resultMeta?<div><p>来源工程版本 rev.{resultMeta.revision}</p><p className="wf-muted">当前工程版本 rev.{w.revision}</p><p><code>{resultMeta.input_hash}</code></p><button onClick={()=>pick('cable')}>返回电缆参数</button></div>:object.fields.map(spec=>{const text=s.inputDrafts[spec.path]??String(valueAt(w.scenario,spec.path)??''),err=spec.path in s.inputDrafts?parseDraft(spec.path,text).error:null,locked=w.locks.includes(spec.path);return <div className="wf-property" key={spec.path}><label htmlFor={`wf-${spec.path}`}>{spec.label}{locked&&<span> · 已锁定</span>}</label><div className="wf-input-unit">{spec.options?<select id={`wf-${spec.path}`} value={text} disabled={s.busy||locked} onChange={e=>edit(spec.path,e.target.value)}>{spec.options.map(([v,n])=><option key={v} value={v}>{n}</option>)}</select>:<input id={`wf-${spec.path}`} inputMode="decimal" value={text} disabled={s.busy||locked} aria-invalid={!!err} aria-describedby={err?`wf-error-${spec.path}`:undefined} onChange={e=>edit(spec.path,e.target.value)} onKeyDown={e=>{if(e.key==='Escape'){s.setInputDraft(spec.path,null);e.stopPropagation()}}}/>}<span>{spec.unit}</span></div>{err&&<p id={`wf-error-${spec.path}`} className="wf-inline-error">{err}</p>}{spec.path in s.inputDrafts&&<small>已保存：{String(valueAt(w.scenario,spec.path)??'未提供')}</small>}</div>})}
     <details className="wf-source"><summary>来源与编辑约束</summary><p>上述值来自已保存工程。全组由后端校验尺寸、布置及锁定；成功后才更新模型。半导电层热阻率为共享属性。</p>{w.sources.map(src=><p key={src.id}>{src.title} · 第 {src.page} 页</p>)}</details>
    </div>
    <footer className="wf-save"><p>{dirty?`${Object.keys(s.inputDrafts).length} 项草稿 · 基于 rev.${base.current??w.revision}`:`已保存 · rev.${w.revision}`}</p><button className="wf-primary" disabled={!dirty||s.busy||invalid||conflict} onClick={()=>void save()}><Save size={15}/>保存全部修改</button>{dirty&&<button disabled={s.busy} onClick={()=>{s.discardInputs();s.dismiss()}}>撤销未保存输入</button>}</footer>
   </aside>
  </div>
  <footer className="wf-status"><span className={dirty?'wf-dirty':''}>{s.busy?'正在执行工程操作':dirty?'有未保存输入':'工程输入已保存'}</span><span>{s.notice||'数据来自本机工程服务'}<span className="wf-status-separator">·</span>集成审查版</span></footer>
  {plugins&&<Suspense fallback={<p role="status">正在打开插件管理…</p>}><PluginDialog onClose={()=>setPlugins(false)}/></Suspense>}
 </div>;
}
function Application(){
 const s=useStudio(),[home,setHome]=useState(!projectFromUrl);
 const [target,setTarget]=useState<{id:string;previous:string|null}|null>(null);
 const [recent,setRecent]=useState<{id:string;name:string;revision:number}[]>([]),[error,setError]=useState('');
 useEffect(()=>{if(home)void api<typeof recent>('/api/workspaces').then(setRecent).catch(e=>setError(e.message))},[home,s.w?.id,s.w?.revision]);
 useEffect(()=>{if(target&&!s.busy){if(s.error)setTarget(null);else if(s.w&&(target.id==='new'?s.w.id!==target.previous:s.w.id===target.id)){setHome(false);setTarget(null)}}},[target,s.busy,s.w?.id,s.error]);
 if(!s.initialized)return <div className="wf-home" role="status">正在连接本机工程服务…</div>;
 if(!home&&s.w)return <Workbench key={s.w.id} onHome={()=>setHome(true)}/>;
 return <main className="wf-home"><header><span className="wf-mark">C</span><b>CableSimPro</b><small>工程工作流 · 集成审查</small></header><section><small>工程入口</small><h1>从一个工程开始。</h1><p>电缆、工况、研究与结果，使用同一个已保存版本。</p>{(s.error||error)&&<p role="alert">{s.error||error}</p>}<button className="wf-primary" disabled={s.busy} onClick={()=>{setTarget({id:'new',previous:s.w?.id??null});void s.create()}}>新建研究工程 <ArrowRight size={16}/></button><p className="wf-muted">新工程使用明确标记的演示输入；计算前须核对参数来源。</p><h2>最近工程</h2><div className="wf-recent">{recent.map(r=><button disabled={s.busy} key={r.id} onClick={()=>{setTarget({id:r.id,previous:s.w?.id??null});void s.load(r.id)}}><FolderOpen size={20}/><span><strong>{r.name}</strong><small>rev.{r.revision}</small></span><ArrowRight size={16}/></button>)}</div>{!recent.length&&<p>暂无保存工程。</p>}</section></main>;
}
export default function WorkflowApp(){return <div className="wf-root"><StudioProvider stayInWorkspace deferCreate restoreSession initialWorkspaceId={projectFromUrl} onWorkspaceChange={rememberProject}><Application/></StudioProvider></div>}
