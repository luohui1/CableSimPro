import {lazy,Suspense,useEffect,useRef,useState} from 'react';
import {ArrowRight,Box,Check,ChevronDown,ChevronRight,FileText,FolderOpen,Layers3,Maximize2,Minimize2,Minus,Package,Play,Plus,RotateCcw,Ruler,Save,Search,Settings2,ShieldCheck,X} from 'lucide-react';
import {StudioProvider,useStudio,valueAt} from '../StudioState';
import type {Result} from '../types';
import {api,fmt,canonical} from '../utils';
import {objects,layerKeys,parseDraft,type ObjectKey} from './fields';
import DocumentTabs from './DocumentTabs';
import ObjectInspector,{LayerSwatch} from './ObjectInspector';
import CommandSearch from './CommandSearch';
import {CableSection,InstallationDiagram,SavedCurve,type GeometryLayer} from './EngineeringGraphics';
import './workflow.css';
import './workspace-finish.css';
import './mac-tokens.css';
import './mac-workspace.css';
const CableModelView=lazy(()=>import('../CableModelView'));
const PluginDialog=lazy(()=>import('../plugins/ProjectPluginDialog'));
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
  <SavedCurve result={r}/><section><h2>输入与方法</h2><dl className="wf-key-values"><dt>运行所用工程版本</dt><dd>rev.{run.revision}</dd><dt>电缆截面积 / 绝缘厚度</dt><dd>{r.input.cable.area_mm2} mm² / {r.input.cable.insulation_mm} mm</dd><dt>埋深 / 中心间距</dt><dd>{r.input.installation.depth_m} m / {r.input.installation.spacing_m} m</dd><dt>方法版本</dt><dd>{r.model_version}</dd></dl><p className="wf-muted">现有稳态热网络；不是完整标准实现、有限元结果或认证结论。</p></section>
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
 const [modelToolbarHost,setModelToolbarHost]=useState<HTMLDivElement|null>(null);
 const [focused,setFocused]=useState(false),[commandOpen,setCommandOpen]=useState(false),[objectQuery,setObjectQuery]=useState('');
 const [zoom,setZoom]=useState(100),[dimensions,setDimensions]=useState(true);
 const [layersOpen,setLayersOpen]=useState(true);
 function activate(id:DocumentId){setDoc(id);if(id==='study')setSelection('study');else if(id==='cable'&&!layerKeys.includes(selection))setSelection('cable')}
 const visibleLayerKeys=layerKeys.filter(key=>objects[key].name.includes(objectQuery.trim())||key.includes(objectQuery.trim().toLowerCase()));
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
 const shortcuts=useRef({save,dirty,invalid,conflict,busy:s.busy});shortcuts.current={save,dirty,invalid,conflict,busy:s.busy};
 useEffect(()=>{const key=(e:KeyboardEvent)=>{
  if(e.isComposing||e.defaultPrevented||(e.target as HTMLElement)?.closest('[role="dialog"]'))return;
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();setCommandOpen(v=>!v)}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();const a=shortcuts.current;if(a.dirty&&!a.invalid&&!a.conflict&&!a.busy)void a.save()}
  if(e.key==='Escape'&&!(e.target as HTMLElement)?.closest('input,select,textarea'))setFocused(false);
 };window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[]);
 const object=objects[selection];
 const resultMeta=doc.startsWith('run:')?w.runs.find(r=>r.id===doc.slice(4)):null;
 const title=(id:DocumentId)=>id==='cable'?'C-001 · 电缆':id==='study'?'R-001 · 稳态研究':`运行 ${id.slice(4,12)}`;
 return <div className={`wf-shell wf-material-workspace ${focused?'wf-focus-mode':''}`}>
  <header className="wf-top"><button className="wf-brand" disabled={dirty||s.busy} onClick={onHome} aria-label="返回工程首页"><img className="wf-brand-asset" src="/workbench-assets/brand.webp" alt=""/><span>CableSim<span className="wf-brand-pro">Pro</span></span></button>
   <span className="wf-project-name" title={w.scenario.name}>{w.scenario.name}</span><span className="wf-revision" data-testid="workflow-revision">rev.{w.revision}</span><span className="wf-top-spacer"/>
   <button id="wf-command-trigger" className="wf-command-trigger" onClick={()=>setCommandOpen(true)}><Search size={15}/><span>查找命令</span><kbd>Ctrl K</kbd></button>
   <details className="wf-more"><summary aria-label="更多工程操作">更多 <ChevronDown size={13}/></summary><div><button onClick={()=>{setPlugins(true);document.querySelector('.wf-more')?.removeAttribute('open')}}>插件管理</button><button disabled={dirty||s.busy} onClick={()=>{const u=new URL(location.href);u.searchParams.delete('workflow');u.searchParams.set('mode','workbench');location.assign(u.href)}}>返回原工作台</button></div></details>
  </header>
  <div className="wf-ribbon" role="toolbar" aria-label="工程操作">
   <span className="wf-workspace-label"><Box size={17}/>工程工作区</span><span className="wf-ribbon-divider"/>
   <button disabled={s.busy||dirty||!w.can_undo} onClick={()=>void s.history('undo')} title="撤销已保存的工程修改"><RotateCcw size={16}/><span>撤销修改</span></button>
   <button disabled={s.busy} onClick={()=>{void s.reload();setPreflightNonce(n=>n+1)}} title="重新读取服务端版本，不丢弃草稿"><FolderOpen size={16}/><span>读取最新版本</span></button>
   <span className="wf-ribbon-divider"/><button onClick={()=>pick('study')}><Play size={16}/><span>研究设置</span></button><button onClick={()=>setPlugins(true)}><Package size={16}/><span>插件中心</span></button>
   <span className="wf-top-spacer"/><span className="wf-save-indicator" data-state={dirty?'draft':'saved'}><i/>{dirty?'草稿待保存':'已保存'}</span>
   <button aria-pressed={focused} aria-label={focused?'退出专注画布':'专注画布'} title="专注画布 · Esc 恢复布局" onClick={()=>setFocused(v=>!v)}>{focused?<Minimize2 size={16}/>:<Maximize2 size={16}/>}</button>
  </div>
  {s.error&&<div className="wf-banner wf-error" role="alert"><span>{s.error}</span><button aria-label="关闭操作错误" onClick={s.dismiss}><X size={14}/></button></div>}
  {conflict&&<div className="wf-banner wf-error" role="alert">草稿基于 rev.{base.current}，当前已读取 rev.{w.revision}。已阻止覆盖；请核对下方已保存值，撤销草稿后重新编辑。</div>}
  <div className="wf-body">
   <aside className="wf-outline"><header className="wf-pane-heading"><h2>模型构建器</h2><span>C-001</span></header>
    <label className="wf-object-search"><Search size={14}/><input aria-label="筛选工程对象" placeholder="筛选对象…" value={objectQuery} onChange={e=>{setObjectQuery(e.target.value);setLayersOpen(true)}}/>{objectQuery&&<button aria-label="清除对象筛选" onClick={()=>setObjectQuery('')}><X size={13}/></button>}</label>
    <nav aria-label="工程对象"><div className="wf-tree-group"><span className="wf-group-label">电缆定义</span><div className="wf-cable-node"><button className="wf-expand" aria-expanded={layersOpen} aria-label="展开或折叠电缆层" onClick={()=>setLayersOpen(v=>!v)}>{layersOpen?<ChevronDown size={13}/>:<ChevronRight size={13}/>}</button><button className={selection==='cable'&&doc==='cable'?'is-selected':''} onClick={()=>pick('cable')}><Box size={16}/><b>C-001 · 电缆</b></button></div>
    <div className="wf-layer-list" hidden={!layersOpen}>{visibleLayerKeys.map(key=>{const i=layerKeys.indexOf(key);return <button key={key} className={selection===key&&doc==='cable'?'is-selected':''} aria-pressed={selection===key} aria-label={objects[key].name} onClick={()=>pick(key)}><LayerSwatch object={key} conductor={w.scenario.cable.conductor}/><span>{objects[key].name}</span><small>{String(i+1).padStart(2,'0')}</small></button>})}{!visibleLayerKeys.length&&<p className="wf-empty-inline">没有匹配的结构层</p>}</div></div>
    <div className="wf-tree-group"><span className="wf-group-label">分析定义</span><button className={selection==='installation'&&doc==='study'?'is-selected':''} onClick={()=>pick('installation')}><Layers3 size={16}/>敷设方案 A</button><button className={doc==='study'&&selection==='study'?'is-selected':''} onClick={()=>pick('study')}><Settings2 size={16}/>R-001 · 稳态研究</button></div>
    <div className="wf-tree-group"><h2>保存的运行 <span>{w.runs.length}</span></h2>{!w.runs.length&&<p className="wf-empty-inline">尚未生成计算记录</p>}{w.runs.map(r=><button key={r.id} aria-pressed={doc===`run:${r.id}`} className={doc===`run:${r.id}`?'is-selected':''} onClick={()=>open(`run:${r.id}`)}><FileText size={15}/><span>rev.{r.revision} <small>{r.id.slice(0,8)}</small></span></button>)}</div>
   </nav><div className="wf-outline-bottom"><ShieldCheck size={15}/><div><b>工程输入与来源</b><p>{w.sources.length} 项关联资料 · 待人工核对</p></div></div></aside>
   <main className="wf-editor">
    <DocumentTabs ids={docs} active={doc} title={id=>title(id as DocumentId)} dirty={dirty} onSelect={id=>activate(id as DocumentId)} onClose={id=>close(id as DocumentId)}/>
    <section id="wf-panel-cable" role="tabpanel" aria-labelledby="wf-tab-cable" className="wf-cable-document" hidden={doc!=='cable'} aria-label="电缆设计文档">
     <div className="wf-document-toolbar"><div className="wf-view-tabs"><button aria-pressed={view==='section'} onClick={()=>setView('section')}><Ruler size={15}/>二维截面</button><button aria-pressed={view==='3d'} onClick={()=>{setThreeMounted(true);setView('3d')}}><Box size={15}/>三维结构</button></div><span className="wf-toolbar-object" hidden={view==='3d'}>{object.name}</span><div ref={setModelToolbarHost} className="wf-model-toolbar-host" hidden={view!=='3d'}/></div>
     <div className="wf-canvas" data-testid="workflow-canvas">
      {view==='section'&&<><div className="wf-view-ident"><span>横截面 / XY</span><small>参数化几何</small></div><div className="wf-view-axis"><svg viewBox="0 0 52 50" role="img" aria-label="截面坐标方向"><path d="M13 34H43M13 34V7"/><text x="43" y="47">X</text><text x="3" y="9">Y</text></svg></div></>}
      <div hidden={view!=='section'} className="wf-section-host">{prepared.error?<div className="wf-center-message" role="alert">{prepared.error}<button onClick={()=>setPreflightNonce(n=>n+1)}>重试读取几何</button></div>:!data?<p className="wf-center-message" role="status">正在读取工程几何…</p>:<CableSection layers={data.package.geometry_recipe.layers} selection={selection} onSelect={pick} zoom={zoom} dimensions={dimensions} conductor={w.scenario.cable.conductor}/>}</div>
      {threeMounted&&<div hidden={view!=='3d'} className="wf-three-host"><Suspense fallback={<p>正在加载三维显示…</p>}><CableModelView cable={w.scenario.cable} studio refined toolbarTarget={modelToolbarHost} activeLayer={layerKeys.includes(selection)?layerKeys.indexOf(selection):null} onInspectLayer={i=>pick(layerKeys[i])}/></Suspense></div>}
      {view==='section'&&<div className="wf-view-controls" role="toolbar" aria-label="截面显示控制"><button aria-label="缩小截面" disabled={zoom<=50} onClick={()=>setZoom(v=>Math.max(50,v-10))}><Minus size={15}/></button><span aria-label="显示缩放">{zoom}%</span><button aria-label="放大截面" disabled={zoom>=130} onClick={()=>setZoom(v=>Math.min(130,v+10))}><Plus size={15}/></button><i/><button aria-label="截面适合画布" onClick={()=>setZoom(100)}><Maximize2 size={15}/></button><button aria-label="显示截面尺寸" aria-pressed={dimensions} onClick={()=>setDimensions(v=>!v)}><Ruler size={15}/></button></div>}
      <div className="wf-canvas-caption"><span>已保存模型 · rev.{w.revision}{dirty?' · 草稿尚未应用':''}</span><span>等效结构；外观不参与求解</span></div>
     </div>
    </section>
    <section id="wf-panel-study" role="tabpanel" aria-labelledby="wf-tab-study" className="wf-study-document" hidden={doc!=='study'} aria-label="稳态研究文档">
     <div className="wf-reading"><small>研究 / R-001</small><h1>稳态载流量</h1><p className="wf-lead">电缆 C-001 · 敷设方案 A · 当前工程 rev.{w.revision}</p>
      <section><h2>01　方法与适用范围</h2><p>现有单回路直埋热网络。三根相同单芯电缆、均匀土壤、稳态平衡电流。</p><p className="wf-muted">不等于完整 IEC 60287 实现；交流附加和屏蔽损耗系数仍是输入。本轮不调用有限元插件。</p><details><summary>查看当前登记的设计依据</summary><pre>{JSON.stringify(w.design_basis??{},null,2)}</pre></details></section>
      <section><h2>02　工况与输入检查</h2><InstallationDiagram scenario={w.scenario} diameterMm={data?data.package.geometry_recipe.layers.at(-1)!.outer_radius_m*2000:undefined}/><dl className="wf-key-values"><dt>排列 / 平均中心埋深</dt><dd>{w.scenario.installation.arrangement==='flat'?'平行':'三角形'} / {w.scenario.installation.depth_m} m <button className="wf-text" onClick={()=>setSelection('installation')}>编辑敷设</button></dd><dt>环境温度 / 土壤热阻率</dt><dd>{w.scenario.installation.ambient_temperature_c} °C / {w.scenario.installation.soil_rho_k_m_w} K·m/W</dd><dt>运行电流</dt><dd>{w.scenario.operating_current_a} A <button className="wf-text" onClick={()=>setSelection('study')}>编辑研究</button></dd><dt>20°C 导体电阻</dt><dd>{w.scenario.cable.r20_ohm_km??'未提供'} Ω/km <button className="wf-text" onClick={()=>pick('conductor')}>核对导体</button></dd></dl>
       {!buried&&<p className="wf-inline-error">设计依据不属于直埋域，请在原工作台调整并批准方法范围。</p>}{dirty&&<p className="wf-inline-error">还有未保存输入，不能使用旧值运行。</p>}{w.scenario.cable.r20_ohm_km===null&&<p className="wf-inline-error">本流程要求明确保存 R20，避免沿用理想电阻估计。</p>}{prepared.error&&<p role="alert">{prepared.error}</p>}
       <p className="wf-muted">几何预检只确认输入配方，不代表数值精度或标准合规。</p>
      </section>
      <section className="wf-run-action"><label><input type="checkbox" checked={ack===w.revision} disabled={s.busy} onChange={e=>setAck(e.target.checked?w.revision:null)}/>已核对本版本参数来源、损耗系数与方法范围</label><button className="wf-primary" disabled={!ready||ack!==w.revision} onClick={()=>{pendingRun.current=s.output?.run_id??null;void s.run()}}><Play size={15}/>{s.busy?'任务执行中…':'运行当前版本'}</button></section>
     </div>
    </section>
    {docs.filter(id=>id.startsWith('run:')).map(id=><section key={id} id={`wf-panel-${id}`} role="tabpanel" aria-labelledby={`wf-tab-${id}`} hidden={doc!==id} className="wf-run-document"><ResultView runId={id.slice(4)}/></section>)}
   </main>
   <ObjectInspector selection={selection} layers={data?.package.geometry_recipe.layers} result={resultMeta} baseRevision={base.current} conflict={conflict} invalid={invalid} onEdit={edit} onSave={()=>void save()} onPick={pick}/>
  </div>
  <footer className="wf-status"><span className={dirty?'wf-dirty':''}>{s.busy?'正在执行工程操作':dirty?'有未保存输入':'工程输入已保存'}</span><span>{s.notice||'数据来自本机工程服务'}<span className="wf-status-separator">·</span>专业工作区 · 工程预览</span></footer>
  <CommandSearch open={commandOpen} onClose={()=>setCommandOpen(false)} commands={[
   {id:'save',name:'保存工程修改',keywords:'save',disabled:!dirty||s.busy||invalid||conflict,action:()=>void save()},
   {id:'section',name:'显示二维截面',keywords:'2d section',action:()=>{pick('cable');setView('section')}},
   {id:'3d',name:'显示三维结构',keywords:'3d model',action:()=>{pick('cable');setThreeMounted(true);setView('3d')}},
   {id:'study',name:'打开稳态研究',keywords:'study analysis',action:()=>pick('study')},
   {id:'plugins',name:'打开插件管理',keywords:'plugin',action:()=>setPlugins(true)},
   {id:'focus',name:focused?'恢复完整工作区':'专注画布',keywords:'focus',action:()=>setFocused(v=>!v)},
   {id:'conductor',name:'核对导体电阻 R20',keywords:'conductor resistance',action:()=>pick('conductor')},
  ]}/>
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
 return <main className="wf-home"><header><span className="wf-mark">C</span><b>CableSimPro</b><small>电缆设计与工程分析</small><span className="wf-top-spacer"/><span className="wf-home-local"><i/>本机工程服务</span></header>
  <div className="wf-home-layout"><aside><span className="wf-home-caption">WORKSPACE</span><h2>工程中心</h2><p>设计、研究与交付</p><div className="wf-home-nav"><FolderOpen size={17}/>最近工程</div><div className="wf-home-version">工程工作区<br/>专业版式 · 集成预览</div></aside>
   <section><div className="wf-home-heading"><div><small>CABLE ENGINEERING</small><h1>从一个工程开始。</h1><p>定义电缆，核对工况，让计算与每个工程版本保持一致。</p></div><Box size={40} strokeWidth={1}/></div>
    {(s.error||error)&&<p role="alert">{s.error||error}</p>}
    <div className="wf-new-project"><div><span className="wf-new-symbol"><Plus size={23}/></span><div><h2>新建研究工程</h2><p>从现有单芯电缆与直埋工况开始。</p></div></div><button className="wf-primary" disabled={s.busy} onClick={()=>{setTarget({id:'new',previous:s.w?.id??null});void s.create()}}>新建研究工程 <ArrowRight size={16}/></button></div>
    <div className="wf-recent-heading"><h2>最近工程</h2><span>{recent.length} 个工程</span></div><div className="wf-recent">{recent.map(r=><button disabled={s.busy} key={r.id} onClick={()=>{setTarget({id:r.id,previous:s.w?.id??null});void s.load(r.id)}}><FolderOpen size={20}/><span><strong>{r.name}</strong><small>本机工程</small></span><span className="wf-recent-revision">rev.{r.revision}</span><ArrowRight size={15}/></button>)}</div>{!recent.length&&<div className="wf-home-empty"><FolderOpen size={28}/><p>还没有保存的工程。</p><small>新建后，电缆、研究和计算记录会保留在同一个工程中。</small></div>}
    <footer className="wf-home-note"><ShieldCheck size={16}/><p>新工程包含演示输入，不代表厂家数据。运行前请核对来源和方法适用范围。</p></footer>
   </section>
  </div></main>;
}
export default function WorkflowApp(){return <div className="wf-root"><StudioProvider stayInWorkspace deferCreate restoreSession initialWorkspaceId={projectFromUrl} onWorkspaceChange={rememberProject}><Application/></StudioProvider></div>}
