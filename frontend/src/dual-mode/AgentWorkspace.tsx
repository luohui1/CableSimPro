import {useEffect,useRef,useState} from 'react';
import {ArrowRight,Check,CheckCircle2,FileText,Layers3,LockKeyhole,Send,Settings2,TriangleAlert,Workflow,X} from 'lucide-react';
import {useStudio} from '../StudioState';
import {labelFor} from '../StudioPanels';
import {ReviewedSelection} from '../EnterprisePanels';
import {LibraryPanel} from '../LibraryDesignPanels';
import {InlineResults} from '../WorkspaceInteraction';
import {fmt} from '../utils';

export default function AgentWorkspace({active,draft,setDraft,openWorkbench}:{active:boolean;draft:string;setDraft:(value:string)=>void;openWorkbench:(view?:string)=>void}){
 const s=useStudio(),w=s.w!,p=s.proposal;
 const [section,setSection]=useState<'task'|'selection'|'documents'>('task'),[provider,setProvider]=useState<'local'|'openai'>('local'),[consent,setConsent]=useState(false),[resultsOpen,setResultsOpen]=useState(true),[now,setNow]=useState(Date.now());
 const composing=useRef(false),input=useRef<HTMLTextAreaElement>(null),pending=!!p?.ready;
 const dirty=Object.keys(s.inputDrafts).length>0,blocked=s.busy||dirty;
 const expired=!!p?.expired||!!(p?.expires_at&&p.expires_at*1000<now),stale=!!p&&p.base_revision!==w.revision;
 const validResult=!!s.current||!!s.currentSweep;
 useEffect(()=>{if(p?.ready)setSection('task')},[p]);
 useEffect(()=>{if(!active)return;const timer=window.setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[active]);
 useEffect(()=>{if(!active)return;const key=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();setSection('task');requestAnimationFrame(()=>input.current?.focus())}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[active]);
 function send(){if(blocked||pending||!draft.trim()||(provider==='openai'&&(!consent||!s.status.cloud_configured)))return;void s.plan(draft.trim(),provider,consent)}
 const latestRequirement=[...s.notes].reverse().find(n=>n.role==='user')?.text??p?.message;
 const status=s.error?'需要处理':s.busy?'工具执行中':pending?(stale||expired?'提案待更新':'等待审查'):p&&!p.ready?'请补充条件':validResult?'结果可复核':s.output?'输入已变化':'等待任务';
 return <main className="agent-workspace" aria-label="智能工程流工作区">
  <header className="flow-page-heading"><div><span className="mode-kicker">智能工程流 / 当前工程</span><h1>从工程目标，到可复核的结果</h1><p>任务、参数变更和计算记录都属于 <b>{w.scenario.name}</b>。</p></div><button className="flow-link" onClick={()=>openWorkbench()}><Layers3 size={17}/>在专业工作台打开<ArrowRight size={15}/></button></header>
  <nav className="flow-nav" aria-label="工程流内容"><button aria-current={section==='task'?'page':undefined} onClick={()=>setSection('task')}>设计任务{pending&&<span className="pending-dot"/>}</button><button aria-current={section==='selection'?'page':undefined} onClick={()=>setSection('selection')}>企业型号选型</button><button aria-current={section==='documents'?'page':undefined} onClick={()=>setSection('documents')}>资料与参数核对</button><span className="flow-status" role="status">{status}</span></nav>
  <div hidden={section!=='task'} className="flow-task-layout">
   <section className="flow-task-main">
    <section className="flow-composer" aria-label="工程任务输入"><label htmlFor="flow-objective">描述本次工程任务</label><textarea id="flow-objective" ref={input} value={draft} maxLength={3000} placeholder="例如：将导体截面积改为 400 mm²，重新计算载流量。" onChange={e=>setDraft(e.target.value)} onCompositionStart={()=>{composing.current=true}} onCompositionEnd={()=>{composing.current=false}} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!composing.current&&!e.nativeEvent.isComposing&&e.nativeEvent.keyCode!==229){e.preventDefault();send()}}}/><div className="flow-compose-actions"><label>任务解析<select aria-label="工程流解析方式" value={provider} onChange={e=>{setProvider(e.target.value as typeof provider);setConsent(false)}}><option value="local">本地明确命令 · 非大模型</option><option value="openai" disabled={!s.status.cloud_configured}>云端模型{s.status.cloud_configured?'':' · 未配置'}</option></select></label><button disabled={blocked||pending||!draft.trim()||(provider==='openai'&&(!consent||!s.status.cloud_configured))} onClick={send}><Send size={16}/>生成任务计划</button></div>
     {provider==='openai'&&<label className="flow-consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>允许将本次任务和完整工程参数发送到已配置的云端服务，可能计费。</label>}
     {pending&&<p className="flow-warning">先批准或拒绝当前提案，再发起新任务；不会静默覆盖待审查内容。</p>}
     {!pending&&<div className="flow-examples">{['计算载流量','截面积改为 400 mm²，重新计算','比较土壤热阻率 0.8、1.2、1.6 下的载流量'].map(t=><button key={t} onClick={()=>{setDraft(t);input.current?.focus()}}>{t}<ArrowRight size={13}/></button>)}</div>}
    </section>
    {(latestRequirement||s.output)&&<div className="flow-stage-strip" aria-label="任务阶段"><span className={latestRequirement?'complete':''}>01 任务要求</span><span className={pending?'current':s.output?'complete':''}>02 人工审查</span><span className={s.busy?'current':validResult?'complete':''}>03 工具执行</span><span className={validResult?'complete':''}>04 结果复核</span></div>}
    {latestRequirement&&<article className="flow-requirement"><span>本次要求</span><p>{latestRequirement}</p></article>}
    {p&&!p.ready&&<section className="flow-artifact flow-question" aria-label="待补充条件"><h2><TriangleAlert size={19}/>条件尚不完整</h2>{p.questions.map((q,i)=><p key={i}>{q}</p>)}<small>补充任务描述后重新规划；不会自动猜测关键工程参数。</small></section>}
    {pending&&<section className="flow-artifact flow-review" aria-label="待审查工程变更"><header><div><span className="mode-kicker">工程变更 / 先审查后应用</span><h2>{p.action==='sweep'?'参数扫描计划':p.action==='import'?'资料参数导入':'本次任务计划'}</h2></div><span>依据版本 {p.base_revision}</span></header>
      <table><thead><tr><th>工程参数</th><th>当前记录值</th><th>拟用值</th></tr></thead><tbody>{p.changes.map(c=><tr key={c.path}><td>{labelFor(c.path)}</td><td>{String(c.before??'估算')}</td><td><b>{String(c.after??'估算')}</b></td></tr>)}</tbody></table>
      {!p.changes.length&&<p>不修改电缆参数，执行所示研究或记录引用。</p>}
      {p.source&&<p><FileText size={14}/>来源：{p.source.title} · 第 {p.source.page} 页</p>}
      <details><summary>检查完整参数、设计依据与假设</summary>{p.assumptions?.map((a,i)=><p key={i}>{a}</p>)}<pre>{JSON.stringify({scenario:p.scenario,design_basis:p.design_basis},null,2)}</pre></details>
      {(stale||expired)&&<p className="flow-warning" role="status">{expired?'提案已过期':'工程输入已变化'}。不可批准旧提案；拒绝后请按当前版本重新规划。</p>}
      <footer><button disabled={blocked} onClick={()=>void s.review('reject')}><X size={16}/>拒绝提案</button><button className="flow-approve" disabled={blocked||stale||expired} onClick={()=>void s.review('approve')}><Check size={17}/>批准并执行</button></footer>
    </section>}
    {s.output&&<section className="flow-artifact flow-output" aria-label="任务结果"><header><h2><CheckCircle2 size={19}/>计算与工具记录</h2><span>{validResult?'与当前工况一致':'历史输出／非当前计算结论'}</span></header>{validResult?<p>{s.output.statement}</p>:<p className="flow-warning">输入或版本已变化，以下记录只作历史依据；请重新计算当前工况。</p>}
     {s.current&&<div className="flow-result-metrics"><div><span>允许载流量</span><strong>{fmt(s.current.summary.ampacity_a)} <small>A</small></strong></div><div><span>运行最高温度</span><strong>{fmt(s.current.summary.operating_max_temperature_c)} <small>°C</small></strong></div><div><span>限制相</span><strong>{s.current.summary.limiting_phase}</strong></div></div>}
     <InlineResults open={resultsOpen} onOpenChange={setResultsOpen}/>
     <details><summary>查看工具执行明细</summary>{s.output.events.map((event,i)=><p key={i}><code>{event.tool}</code> — {event.detail}</p>)}</details>
     <button className="flow-link" onClick={()=>openWorkbench()}>在模型中检查结果<ArrowRight size={15}/></button>
    </section>}
    {!p&&!s.output&&<section className="flow-start"><Workflow size={28}/><h2>由你确认条件，由工程工具计算</h2><p>这里不是另一个项目。工作台中的电缆、负荷、参数锁和资料引用，会直接用于本次任务。</p><div><span>提出目标</span><ArrowRight size={14}/><span>检查变更</span><ArrowRight size={14}/><span>计算复核</span></div></section>}
   </section>
   <aside className="flow-context" aria-label="任务工程依据"><section><header><h2>当前输入</h2><button onClick={()=>openWorkbench()}>检查</button></header><p className="flow-context-note">以下来自当前保存的工程，不是从本次描述中推测的参数。</p><dl><dt>电缆截面积</dt><dd>{w.scenario.cable.area_mm2} mm²</dd><dt>相对地电压 U₀</dt><dd>{w.scenario.cable.u0_kv} kV</dd><dt>运行电流</dt><dd>{w.scenario.operating_current_a} A</dd><dt>环境温度</dt><dd>{w.scenario.installation.ambient_temperature_c} °C</dd><dt>土壤热阻率</dt><dd>{w.scenario.installation.soil_rho_k_m_w} K·m/W</dd><dt>平均埋深</dt><dd>{w.scenario.installation.depth_m} m</dd></dl></section>
    <section><h2><LockKeyhole size={16}/>锁定条件</h2>{w.locks.length?w.locks.map(path=><p key={path}>{labelFor(path)}</p>):<p>当前无锁定项，请检查设计边界。</p>}</section>
    <section><h2>计算方法与范围</h2><p>当前本地任务入口：单回路三相直埋稳态热网络。交流附加和屏蔽损耗系数为输入假设。</p><p>竖向研究、企业选型和资料核对使用独立的工程工具；不宣称自动完成全部多物理场任务。</p><button onClick={()=>openWorkbench('methods')}>检查设计依据<ArrowRight size={13}/></button></section>
    <section><h2>参数来源</h2>{w.sources.length?w.sources.slice(-4).map(source=><p key={source.id}><FileText size={14}/>{source.title} · p.{source.page}</p>):<p>尚未附加核对资料。演示默认值不等于厂家数据。</p>}</section>
    <button className="flow-settings" onClick={()=>openWorkbench('settings')}><Settings2 size={16}/>配置 OCR 与 Agent 服务</button>
   </aside>
  </div>
  <section hidden={section!=='selection'} className="flow-domain"><ReviewedSelection onPropose={()=>setSection('task')} refreshKey={active?w.revision:0}/></section>
  <section hidden={section!=='documents'} className="flow-domain existing-panel"><h2>资料解析与参数核对</h2><p>原文、提取值和变更审查共用企业资料库；云端识别需先配置服务并授权。</p><LibraryPanel/></section>
 </main>;
}
