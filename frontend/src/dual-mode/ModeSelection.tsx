import {useEffect,useState} from 'react';
import {ArrowRight,Box,Check,Clock3,FileText,FolderOpen,Layers3,Workflow,ShieldCheck} from 'lucide-react';
import {api,errorText} from '../utils';
import {useStudio} from '../StudioState';
import CablePortrait from '../engineering-visuals/CablePortrait';
import {EngineeringPlate} from '../visual-assets/EngineeringPlate';
import type {Preset,Cable} from '../types';
import {previousMode,type WorkMode} from './session';
interface Recent {id:string;name:string;revision:number;updated_at:string}
/** Startup is a read-only choice; entering a mode delegates creation to the shared session. */
export default function ModeSelection({choose,openProject}:{choose:(mode:WorkMode)=>void;openProject:(id:string,mode:WorkMode)=>void}){
 const s=useStudio(),[recent,setRecent]=useState<Recent[]>([]),[error,setError]=useState('');
 const [sample,setSample]=useState<Cable|null>(null),last=previousMode();
 useEffect(()=>{let canceled=false;api<Preset[]>('/api/presets').then(p=>{if(!canceled)setSample(p[0]?.scenario.cable??null)}).catch(()=>{});return()=>{canceled=true}},[]);
 useEffect(()=>{let canceled=false;api<Recent[]>('/api/workspaces').then(rows=>{if(!canceled)setRecent(rows.slice(0,4))}).catch(e=>{if(!canceled)setError(errorText(e))});return()=>{canceled=true}},[s.w?.id,s.w?.revision]);
 const preview=s.w?.scenario.cable??sample,locked=s.busy||Object.keys(s.inputDrafts).length>0;
 return <main className="mode-home">
  <section className="mode-intro"><span className="mode-kicker"><span/>中压电缆 · 设计与载流量研究</span><h1>选择你的工作方式</h1><p>从精确建模到目标驱动，让每一项设计都有依据。</p><div className="entry-assurance"><ShieldCheck size={16}/>同一个工程，随时切换。模型、参数和计算记录保持一致。</div></section>
  <div className="mode-choice-grid">
   <article className="mode-choice professional-choice">
    <header><span className="mode-symbol"><Box size={23}/></span><span className="mode-audience">对象驱动 · 精确控制</span>{last==='workbench'&&<span className="last-mode">上次使用</span>}<span className="mode-number">01</span></header>
    <h2>专业工作台</h2><p>编辑电缆结构与敷设条件，在同一画布中完成计算与复核。</p>
    <div className="entry-asset" aria-label="专业工作台结构预览">
     <div className="entry-visual-label"><span>单芯电缆 / 分层结构</span><b>结构建模</b></div>
     {preview&&<CablePortrait cable={preview}/>}
     <div className="entry-visual-legend"><span><i/>导体</span><span><i/>绝缘</span><span><i/>金属屏蔽</span></div>
     <span className="entry-asset-caption">{s.w?'当前工程':'演示'}结构 · 非制造图</span>
    </div>
    <div className="mode-feature-row"><span><Check size={15}/>精确参数</span><span><Check size={15}/>三维与截面</span><span><Check size={15}/>同屏结果</span></div>
    <button className="mode-enter" disabled={!s.initialized||s.busy} onClick={()=>choose('workbench')}>进入专业工作台 <ArrowRight size={18}/></button>
   </article>
   <article className="mode-choice agent-choice">
    <header><span className="mode-symbol"><Workflow size={23}/></span><span className="mode-audience">目标驱动 · 审查后执行</span>{last==='agent'&&<span className="last-mode">上次使用</span>}<span className="mode-number">02</span></header>
    <h2>智能工程流</h2><p>描述工程目标，核对计划与参数差异，由工程工具完成计算。</p>
    <div className="entry-asset entry-task-asset" aria-label="智能工程流任务示意">
     <EngineeringPlate kind="documents" priority/>
     <div className="entry-task-paper"><span>从资料到方案</span><b>让任务，围绕工程展开。</b><div className="entry-task-step"><i>1</i>核对输入与依据</div><div className="entry-task-step"><i>2</i>审查修改与计算计划</div><div className="entry-task-step"><i>3</i>复核结果与推荐方案</div></div>
     <span className="entry-asset-caption">任务流程示意 · 不包含预设计算结论</span>
    </div>
    <div className="mode-feature-row"><span><Check size={15}/>资料核对</span><span><Check size={15}/>候选研究</span><span><Check size={15}/>可追溯审查</span></div>
    <button className="mode-enter" disabled={!s.initialized||s.busy} onClick={()=>choose('agent')}>进入智能工程流 <ArrowRight size={18}/></button>
   </article>
  </div>
  <div className="mode-data-note"><span><Layers3 size={16}/>共享产品版本、资料来源与求解工具</span><span>{s.status.cloud_configured?'云端模型已配置 · 发送前需授权':'未配置云端模型 · 可使用本地明确命令'}</span></div>
  <section className="mode-recent" aria-label="最近工程"><header><h2><Clock3 size={18}/>最近工程</h2><small>{s.w?'当前：'+s.w.scenario.name:'选择模式后才创建工程'}</small></header>
   {error&&<p role="alert">{error}</p>}
   {recent.length?<div className="recent-projects">{recent.map(p=><article key={p.id}><FolderOpen size={23}/><div><b>{p.name}</b><small>版本 {p.revision} · {new Date(p.updated_at).toLocaleDateString('zh-CN')}</small></div><div className="recent-actions"><button disabled={locked} onClick={()=>openProject(p.id,'workbench')}>工作台</button><button disabled={locked} onClick={()=>openProject(p.id,'agent')}>工程流</button></div></article>)}</div>:<div className="mode-empty"><FolderOpen size={24}/><p>还没有保存的工程。选择一种方式，从可核对的演示参数开始。</p></div>}
  </section>
  <footer className="mode-home-footer"><a href="/?plugins=1">插件中心</a> · <FileText size={14}/>本机研究预览 · 配图为说明性资产，计算以工程输入与方法适用范围为准。</footer>
 </main>;
}
