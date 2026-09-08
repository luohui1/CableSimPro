import {useEffect,useRef} from 'react';
import {ChevronDown,ChevronUp,MessageSquare,X} from 'lucide-react';
import {AgentPanel,ResultsPanel} from './StudioPanels';
import {useStudio} from './StudioState';

/** Always-mounted input. Transcript takes vertical space, never model width. */
export function AssistantDock({expanded,onExpandedChange,pageTitle}:{
 expanded:boolean;onExpandedChange:(open:boolean)=>void;pageTitle:string;
}) {
 const s=useStudio(),host=useRef<HTMLElement>(null);
 useEffect(()=>{
  const scroll=host.current?.querySelector<HTMLElement>('.agent-scroll');
  if(expanded&&scroll)scroll.scrollTop=s.proposal?Math.max(0,(scroll.querySelector<HTMLElement>('.proposal-card')?.offsetTop??0)-scroll.offsetTop):scroll.scrollHeight;
 },[expanded,s.proposal,s.notes.length]);
 const pending=!!s.proposal?.ready;
 const status=s.busy?'正在执行工程任务':pending?'有待审查的工程变更':s.output?'工程工具已返回结果':'参数修改与计算，先审查再执行';
 return <section ref={host} className={`task-dock ${expanded?'is-expanded':''}`} aria-label="工程任务输入区" onKeyDown={e=>{
  if(e.key==='Escape'&&!e.nativeEvent.isComposing&&expanded){e.preventDefault();onExpandedChange(false);host.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus()}
 }}>
  <div className="task-dock-inner">
   <header className="task-dock-header">
    <span className="task-context"><b>{pageTitle}</b><span>·</span><span>{s.selected==='installation'?`CKT-01 / ${'ABC'[s.phase]} 相`:'当前电缆'}</span></span>
    <button className="task-history-toggle" aria-expanded={expanded} aria-controls="engineering-conversation" onClick={()=>onExpandedChange(!expanded)}>
     <MessageSquare size={16}/>{expanded?'收起会话':pending?'审查变更':'任务与会话'}{pending&&<span className="pending-indicator"/>}{expanded?<ChevronDown size={16}/>:<ChevronUp size={16}/>}
    </button>
    {expanded&&<button aria-label="关闭工程助手" onClick={()=>{onExpandedChange(false);host.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus()}}><X size={17}/></button>}
   </header>
   <AgentPanel docked expanded={expanded} onExpand={()=>onExpandedChange(true)}/>
   <div className="task-dock-footer"><span role="status" aria-live="polite">{status}</span><span>Enter 发送 · Shift+Enter 换行 · Ctrl/⌘ K 聚焦</span></div>
  </div>
 </section>;
}

/** Local result tabs preserve the mounted model, selection and camera. */
export function InlineResults({open,onOpenChange}:{open:boolean;onOpenChange:(open:boolean)=>void}) {
 const {current,currentSweep,output,busy}=useStudio();
 const hasOutput=!!output?.result||!!output?.sweep;
 return <section className={`inline-results ${open?'is-open':''}`} aria-label="当前工况结果">
  <header>
   <button aria-expanded={open} aria-controls="current-result-content" onClick={()=>onOpenChange(!open)}>
    {open?<ChevronDown size={16}/>:<ChevronUp size={16}/>}<b>当前计算结果</b>
    <span>{current?'三相直埋 · 与当前输入一致':currentSweep?'参数扫描 · 与当前版本一致':hasOutput?'输入已变化，结果待更新':busy?'正在计算':'尚未计算'}</span>
   </button>
   {open&&<button aria-label="收起当前结果" onClick={()=>onOpenChange(false)}><X size={16}/></button>}
  </header>
  {hasOutput&&!current&&!currentSweep&&<p className="inline-stale" role="status">当前参数、设计依据或未提交输入已变化。旧温度、曲线及报告不作为本工况结果。</p>}
  <div id="current-result-content" className="inline-results-body" hidden={!open}><ResultsPanel embedded/></div>
 </section>;
}
