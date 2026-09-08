import {useEffect,useRef,useState} from 'react';
import {ArrowRight,ArrowUp,Check,CheckCircle2,ChevronDown,FileText,FolderOpen,History,Layers3,LockKeyhole,Menu,Plus,Settings2,Thermometer,TriangleAlert,Workflow,X} from 'lucide-react';
import {useStudio,valueAt} from '../StudioState';
import {labelFor} from '../StudioPanels';
import {ReviewedSelection} from '../EnterprisePanels';
import {LibraryPanel} from '../LibraryDesignPanels';
import {StandardsPanel} from '../EngineeringPanels';
import {InlineResults} from '../WorkspaceInteraction';
import CablePortrait,{InstallationSketch} from '../engineering-visuals/CablePortrait';
import {api,errorText,fmt,layers} from '../utils';
import {EngineeringPlate} from '../visual-assets/EngineeringPlate';
import TaskRecordView,{type ArchivedTask} from './TaskRecordView';

type Section='task'|'selection'|'documents'|'standards'|'history';
type Artifact='model'|'installation'|'evidence';
interface TaskRecord {id:string;capability:string;base_revision:number;status:string;created:string}
interface Journal {tasks:TaskRecord[];nodes:{id:string;label:string}[];coverage:string}
const pathUnit:Record<string,string>={'cable.area_mm2':'mm²','cable.u0_kv':'kV','cable.r20_ohm_km':'Ω/km','cable.insulation_mm':'mm','cable.jacket_mm':'mm','installation.depth_m':'m','installation.spacing_m':'m','installation.ambient_temperature_c':'°C','installation.soil_rho_k_m_w':'K·m/W','operating_current_a':'A','cable.max_temperature_c':'°C','circuit_length_m':'m'};
const displayValue=(v:unknown)=>v===null?'按模型估算':typeof v==='number'?new Intl.NumberFormat('zh-CN',{maximumSignificantDigits:15}).format(v):String(v??'—');

/** Task-first client. All modifications and calculations still use the shared engineering session. */
export default function AgentWorkspace({active,draft,setDraft,openWorkbench}:{active:boolean;draft:string;setDraft:(value:string)=>void;openWorkbench:(view?:string)=>void}){
 const s=useStudio(),w=s.w!,p=s.proposal;
 const [section,setSection]=useState<Section>('task'),[artifact,setArtifact]=useState<Artifact>('model');
 const [provider,setProvider]=useState<'local'|'openai'>('local'),[consent,setConsent]=useState(false);
 const [resultsOpen,setResultsOpen]=useState(true),[now,setNow]=useState(Date.now()),[fresh,setFresh]=useState(false),[navOpen,setNavOpen]=useState(false);
 const [journal,setJournal]=useState<Journal|null>(null),[archive,setArchive]=useState<ArchivedTask|null>(null),[readError,setReadError]=useState('');
 const composing=useRef(false),input=useRef<HTMLTextAreaElement>(null),archiveRequest=useRef(0);
 const pending=!!p?.ready,dirty=Object.keys(s.inputDrafts).length>0,blocked=s.busy||dirty;
 const expired=!!p?.expired||!!(p?.expires_at&&p.expires_at*1000<now),stale=!!p&&p.base_revision!==w.revision;
 const validOutput=!!s.current||!!s.currentSweep||s.outputCurrent;
 const latest=[...s.notes].reverse().find(n=>n.role==='user')?.text??p?.message;
 const hasTask=!fresh&&!!(latest||p||s.output);
 const candidate=pending&&p.scenario&&!stale&&!expired?p.scenario:w.scenario;
 const status=s.error?'需要处理':s.busy?'工具执行中':pending?(stale||expired?'提案待更新':'等待审查'):p&&!p.ready?'请补充条件':s.current||s.currentSweep?'结果可复核':s.outputCurrent?'工具已完成':s.output?'输入已变化':'等待任务';
 useEffect(()=>{if(p?.ready){setSection('task');setFresh(false);setArchive(null)}},[p]);
 useEffect(()=>{if(!active)return;const timer=window.setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[active]);
 useEffect(()=>{if(!active||s.busy)return;let canceled=false;api<Journal>(`/api/runtime/${w.id}/provenance`).then(j=>{if(!canceled){setJournal(j);setReadError('')}}).catch(e=>{if(!canceled)setReadError(errorText(e))});return()=>{canceled=true}},[active,s.busy,w.id,w.revision]);
 useEffect(()=>{if(!active)return;const key=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();setSection('task');setNavOpen(false);requestAnimationFrame(()=>input.current?.focus())}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[active]);
 function focusTask(text?:string){setSection('task');setNavOpen(false);if(text!==undefined){setDraft(text);setFresh(true)}requestAnimationFrame(()=>input.current?.focus())}
 function send(){if(blocked||pending||!draft.trim()||(provider==='openai'&&(!consent||!s.status.cloud_configured)))return;setFresh(false);setArchive(null);void s.plan(draft.trim(),provider,consent)}
 function navigate(next:Section){setSection(next);setNavOpen(false)}
 async function readTask(id:string){const token=++archiveRequest.current;setArchive(null);setReadError('');navigate('history');try{const r=await api<ArchivedTask>(`/api/runtime/${w.id}/tasks/${id}`);if(token===archiveRequest.current)setArchive(r)}catch(e){if(token===archiveRequest.current)setReadError(errorText(e))}}
 const taskLabel=(t:TaskRecord)=>journal?.nodes.find(n=>n.id==='task:'+t.id)?.label??t.capability;
 const Composer=<section className="cs-composer" aria-label="工程任务输入">
  <label htmlFor="flow-objective" className="cs-sr-only">描述本次工程任务</label>
  <textarea id="flow-objective" ref={input} value={draft} maxLength={3000} placeholder={pending?'当前变更待审查；批准或拒绝后，可继续新任务。':'描述你的工程任务，例如：截面积改为 400 mm²，重新计算'} onChange={e=>setDraft(e.target.value)} onCompositionStart={()=>{composing.current=true}} onCompositionEnd={()=>{composing.current=false}} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!composing.current&&!e.nativeEvent.isComposing&&e.nativeEvent.keyCode!==229){e.preventDefault();send()}}}/>
  <div className="cs-compose-toolbar"><button onClick={()=>navigate('documents')} title="从企业资料核对参数"><Plus size={17}/><span>企业资料</span></button><label className="cs-provider"><span className="cs-sr-only">任务解析方式</span><select aria-label="工程流解析方式" value={provider} onChange={e=>{setProvider(e.target.value as typeof provider);setConsent(false)}}><option value="local">本地命令 · 非大模型</option><option value="openai" disabled={!s.status.cloud_configured}>云端模型{s.status.cloud_configured?'':' · 未配置'}</option></select></label><button className="cs-send" aria-label="生成任务计划" title="生成任务计划" disabled={blocked||pending||!draft.trim()||(provider==='openai'&&(!consent||!s.status.cloud_configured))} onClick={send}><ArrowUp size={19}/></button></div>
  {provider==='openai'&&<label className="cs-consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>允许发送本次任务与完整工程参数到已配置服务，可能计费。</label>}
  <div className="cs-compose-foot"><span>{pending?'正式参数需人工批准；输入草稿继续保留。':'所有数值由工程工具计算；不以文本推测代替计算。'}</span><kbd>Ctrl K</kbd></div>
 </section>;
 return <main className={`agent-workspace cs-agent ${hasTask?'has-task':'is-idle'} ${pending?'has-review':''}`}  aria-label="智能工程流工作区">
  <aside className={`cs-task-rail ${navOpen?'is-open':''}`} aria-label="工程任务导航">
   <div className="cs-rail-title"><span className="cs-project-monogram">C</span><div><b>电缆设计</b><small>智能工程流</small></div><button aria-label="关闭任务导航" className="cs-rail-close" onClick={()=>setNavOpen(false)}><X size={17}/></button></div>
   <button className="cs-new-task" disabled={blocked||pending} onClick={()=>{setDraft('');setFresh(true);setArchive(null);focusTask()}}><Plus size={17}/>新任务</button>
   <nav aria-label="工程流内容">{([['task','当前任务',Workflow],['selection','企业型号选型',Layers3],['documents','资料与参数核对',FileText],['standards','计算依据',CheckCircle2]] as const).map(([id,label,Icon])=><button key={id} className={section===id?'active':''} aria-current={section===id?'page':undefined} onClick={()=>navigate(id)}><Icon size={16}/><span>{label}</span>{id==='task'&&pending&&<i className="cs-pending-dot"/>}</button>)}</nav>
   <div className="cs-rail-section"><h2>最近执行记录 <span>{journal?.tasks.length??0}</span></h2>{readError&&<p className="cs-read-error" role="status">任务记录读取失败</p>}{!journal?.tasks.length&&<p className="cs-rail-empty">开始第一项研究后，执行记录会保存在这里。</p>}{journal?.tasks.slice(0,8).map(t=><button key={t.id} className={archive?.id===t.id?'selected':''} onClick={()=>void readTask(t.id)}><History size={13}/><span>{taskLabel(t)}<small>版本 {t.base_revision} · {t.status==='succeeded'?'已完成':t.status==='failed'?'失败':'执行中'}</small></span></button>)}</div>
   <div className="cs-rail-footer"><FolderOpen size={16}/><div><b title={w.scenario.name}>{w.scenario.name}</b><small>同一工程 · 版本 {w.revision}</small></div><button aria-label="Agent 服务接入" onClick={()=>openWorkbench('settings')}><Settings2 size={16}/></button></div>
  </aside>
  {navOpen&&<button className="cs-nav-scrim" aria-label="收起任务导航" onClick={()=>setNavOpen(false)}/>}
  <div className="cs-agent-main">
   <header className="cs-task-header"><button className="cs-rail-toggle" aria-label="显示任务导航" onClick={()=>setNavOpen(!navOpen)}><Menu size={19}/></button><div><span>智能工程流</span><h1>{section==='selection'?'企业型号选型':section==='documents'?'资料与参数核对':section==='standards'?'计算依据':section==='history'?'执行记录':'载流量设计研究'}</h1></div><span className="flow-status" role="status">{status}</span><button className="cs-open-workbench" onClick={()=>openWorkbench()}><Layers3 size={16}/><span>在专业工作台打开</span><ArrowRight size={15}/></button></header>
   <div className="cs-task-layout" hidden={section!=='task'}>
    <div className="cs-thread-column">
     <div className="cs-thread-scroll">
      <div className="engineering-task-stages" aria-label="任务阶段">{['描述任务','审查变更','复核结果'].map((label,i)=><span key={label} aria-current={(s.output&&!pending?2:pending?1:0)===i?'step':undefined}><i>{i+1}</i>{label}</span>)}</div>
      {!hasTask?<section className="cs-welcome"><div className="cs-welcome-illustration" aria-label="载流量研究示意"><EngineeringPlate kind="installation"/><span>直埋截面 · 结构示意</span></div><span className="cs-eyebrow">电缆结构 / 敷设条件 / 载流量</span><h2>这次，需要解决<br/>什么电缆设计问题？</h2><p>从当前工程开始。描述目标，检查修改，再查看真实计算结果。</p>
       <div className="cs-task-starters"><button onClick={()=>focusTask('计算载流量')}><span className="cs-starter-icon"><EngineeringPlate kind="cable"/></span><b>校核载流量</b><small>当前结构与敷设条件</small><ArrowRight size={16}/></button><button onClick={()=>focusTask('比较土壤热阻率 0.8、1.2、1.6 下的载流量')}><span className="cs-starter-icon"><EngineeringPlate kind="installation"/></span><b>比较敷设条件</b><small>逐工况计算，不更改原方案</small><ArrowRight size={16}/></button><button onClick={()=>navigate('selection')}><span className="cs-starter-icon"><Layers3 size={22}/></span><b>从企业型号选型</b><small>限定已核对的产品版本</small><ArrowRight size={16}/></button><button onClick={()=>navigate('documents')}><span className="cs-starter-icon"><EngineeringPlate kind="documents"/></span><b>从资料核对参数</b><small>原文、提取值与来源同屏</small><ArrowRight size={16}/></button></div>
      </section>:<div className="cs-thread">
       {latest&&<article className="cs-user-request"><span>本次任务</span><p>{latest}</p></article>}
       <div className="cs-tool-event"><FolderOpen size={15}/><span>当前工程上下文</span><small>版本 {w.revision} · {w.scenario.cable.area_mm2} mm² · {w.scenario.operating_current_a} A</small></div>
       {s.busy&&<div className="cs-running" role="status"><i/>工程工具处理中，参数锁与版本检查保持生效。</div>}
       {p&&!p.ready&&<section className="cs-question" aria-label="待补充条件"><h2><TriangleAlert size={18}/>请补充必要条件</h2>{p.questions.map((q,i)=><p key={i}>{q}</p>)}<small>未生成参数修改，也未进行计算。可在下方补充描述。</small></section>}
       {pending&&<section className="flow-review cs-review" aria-label="待审查工程变更"><header><div><span className="cs-eyebrow">拟用输入 · 尚未写入工程</span><h2>{p.action==='sweep'?'比较敷设条件':p.action==='import'?'导入资料参数':p.changes.length?'审查电缆参数变更':'确认本次计算计划'}</h2></div><span className="cs-change-count">{p.changes.length} 项修改</span></header>
        <p className="cs-review-intro">{p.action==='sweep'?'对计划中的每一个值独立求解，保留原工程条件。':'批准后才更新工程并执行所示工具。右侧显示拟用结构。'}</p>
        {!!p.changes.length&&<table className="cs-diff-table"><thead><tr><th>工程参数</th><th>原值</th><th>拟用值</th><th>单位</th></tr></thead><tbody>{p.changes.map(c=><tr key={c.path}><td>{labelFor(c.path)}</td><td className="cs-before">{displayValue(c.before)}</td><td className="cs-after">{displayValue(c.after)}</td><td>{pathUnit[c.path]??'—'}</td></tr>)}</tbody></table>}
        {!p.changes.length&&<div className="cs-unchanged"><Check size={16}/>不修改当前电缆参数</div>}
        {p.source&&<p className="cs-source"><FileText size={14}/>{p.source.title} · 第 {p.source.page} 页</p>}
        <details className="cs-assumptions"><summary>完整输入、计算计划与假设 <ChevronDown size={14}/></summary>{p.assumptions?.map((a,i)=><p key={i}>{a}</p>)}<pre>{JSON.stringify({scenario:p.scenario,design_basis:p.design_basis},null,2)}</pre></details>
        {(stale||expired)&&<p className="cs-warning" role="status">{expired?'提案已过期':'工程输入已变化'}，不可批准旧提案。请拒绝后重新规划。</p>}
        <footer><span><LockKeyhole size={13}/>{w.locks.length} 项锁定条件保持不变</span><button disabled={blocked} onClick={()=>void s.review('reject')}>拒绝提案</button><button className="cs-primary" disabled={blocked||stale||expired} onClick={()=>void s.review('approve')}><Check size={16}/>批准并执行</button></footer>
       </section>}
       {s.output&&!pending&&!s.busy&&!p&&<section className="cs-result" aria-label="任务结果"><header><CheckCircle2 size={18}/><h2>{validOutput?'当前工程结果':'历史计算记录'}</h2><small>{s.output.run_id?.slice(0,8)}</small></header><p className={!validOutput?'cs-warning':''}>{validOutput?s.output.statement:'输入或版本已变化，旧结果不再作为当前结论。请重新计算。'}</p>
        {s.current&&<div className="flow-result-metrics"><div><span>允许载流量</span><strong>{fmt(s.current.summary.ampacity_a)} <small>A</small></strong></div><div><span>最高导体温度</span><strong>{fmt(s.current.summary.operating_max_temperature_c)} <small>°C</small></strong></div><div><span>限制相</span><strong>{s.current.summary.limiting_phase}</strong></div></div>}
        {(s.output.result||s.output.sweep)&&<InlineResults open={resultsOpen} onOpenChange={setResultsOpen}/>}
        <details className="cs-tool-details"><summary>求解器执行记录</summary>{s.output.events.map((e,i)=><p key={i}><code>{e.tool}</code> — {e.detail}</p>)}</details>
        <button onClick={()=>openWorkbench()}>在模型中检查结果 <ArrowRight size={15}/></button>
       </section>}
      </div>}
     </div>
     {pending?<details className="pending-composer"><summary>任务输入草稿 <span>批准或拒绝后可继续</span></summary>{Composer}</details>:Composer}
    </div>
    <aside className="cs-artifacts flow-context" aria-label="任务工程依据">
     <header><span>工程附件</span><b>{pending&&!stale&&!expired?'拟用结构':'当前工程'}</b></header>
     <nav aria-label="工程附件视图">{([['model','电缆结构'],['installation','敷设截面'],['evidence','参数依据']] as const).map(([id,label])=><button key={id} aria-pressed={artifact===id} onClick={()=>setArtifact(id)}>{label}</button>)}</nav>
     <div className="cs-artifact-content">
      {artifact==='model'&&<><div className="cs-model-title"><span>{candidate.cable.conductor==='copper'?'铜':'铝'}芯 / XLPE / 无铠装</span><h2>{candidate.cable.area_mm2} <small>mm²</small></h2><p>{pending&&!stale&&!expired?'候选结构 · 等待批准':'已保存结构 · 非制造图'}</p></div><CablePortrait cable={candidate.cable} interactive/><div className="cs-layer-key">{layers(candidate.cable).map((l,i)=><div key={l.name}><i style={{background:l.color}}/><span>{l.name}</span><b>{fmt((l.radius_mm-(i?layers(candidate.cable)[i-1].radius_mm:0)),2)} <small>mm {i===0?'半径':'厚度'}</small></b></div>)}</div><p className="cs-visual-note">绞线与屏蔽线为显示细节；计算采用等效层。</p></>}
      {artifact==='installation'&&<><h2>单回路直埋</h2><InstallationSketch scenario={candidate}/><dl><dt>排列方式</dt><dd>{candidate.installation.arrangement==='flat'?'水平排列':'等边三角'}</dd><dt>平均埋深</dt><dd>{candidate.installation.depth_m} m</dd><dt>中心间距</dt><dd>{candidate.installation.spacing_m} m</dd><dt>环境温度</dt><dd>{candidate.installation.ambient_temperature_c} °C</dd><dt>土壤热阻率</dt><dd>{candidate.installation.soil_rho_k_m_w} K·m/W</dd></dl><p className="cs-visual-note">敷设图只表示当前输入，未叠加温度结果。</p><button onClick={()=>openWorkbench('installation')}>在工作台调整布置 <ArrowRight size={14}/></button></>}
      {artifact==='evidence'&&<><h2>输入依据</h2><p>工程版本 {w.revision} · 参数来源与锁定项</p>{w.sources.length?w.sources.map(src=><article className="cs-evidence-item" key={src.id}><b><FileText size={14}/>{src.title}</b><small>第 {src.page} 页 · 原文节选</small>{src.excerpts.map(e=><p key={e.path}><q>{e.quote}</q><small>{valueAt(w.scenario,e.path)===e.value?'与当前值一致':'历史引用，当前值已改变'}</small></p>)}</article>):<p className="cs-warning">尚未附加核对资料。演示默认值不等于厂家数据。</p>}<h3>保持锁定</h3>{w.locks.map(path=><p key={path}><LockKeyhole size={13}/>{labelFor(path)} <b>{displayValue(valueAt(w.scenario,path))} {pathUnit[path]}</b></p>)}<button onClick={()=>navigate('documents')}>打开企业资料 <ArrowRight size={14}/></button></>}
      <details className="cs-method"><summary>本次任务的计算范围</summary><p>当前本地任务：单回路三相直埋稳态热网络。交流附加和屏蔽损耗系数为输入假设。未连接 COMSOL。</p><p>竖向研究、企业选型和资料核对使用各自工程工具。</p><p>演示默认值不等于厂家数据。</p><button onClick={()=>navigate('standards')}>检查设计依据</button></details>
     </div>
    </aside>
   </div>
   <section className="cs-module-surface flow-domain" hidden={section!=='selection'}><ReviewedSelection onPropose={()=>navigate('task')} refreshKey={active?w.revision:0}/></section>
   <section className="cs-module-surface flow-domain existing-panel" hidden={section!=='documents'}><h2>资料与工程参数</h2><p>原件 → 文字／OCR → 核对引用 → 审查后应用。识别结果不会自动成为厂家保证值。</p><LibraryPanel/></section>
   <section className="cs-module-surface existing-panel" hidden={section!=='standards'}><StandardsPanel/></section>
   <section className="cs-module-surface" hidden={section!=='history'} aria-label="执行记录详情"><h2>不可变任务快照</h2><p>只读查看，不会重新计算或改变当前工程。</p>{readError&&<p role="alert">{readError}</p>}{archive?<TaskRecordView task={archive} label={journal?.nodes.find(n=>n.id==='task:'+archive.id)?.label??archive.capability}/>:<p>从左侧选择一条执行记录。</p>}</section>
  </div>
 </main>;
}
