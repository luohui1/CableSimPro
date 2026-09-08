import {useEffect,useState} from 'react';
import {ArrowRight,Box,Check,Clock3,FileText,FolderOpen,Layers3,Workflow} from 'lucide-react';
import {api,errorText} from '../utils';
import {useStudio} from '../StudioState';
import {previousMode,type WorkMode} from './session';
interface Recent {id:string;name:string;revision:number;updated_at:string}
export default function ModeSelection({choose,openProject}:{choose:(mode:WorkMode)=>void;openProject:(id:string,mode:WorkMode)=>void}){
 const s=useStudio(),[recent,setRecent]=useState<Recent[]>([]),[error,setError]=useState('');
 const last=previousMode();
 useEffect(()=>{let ignore=false;api<Recent[]>('/api/workspaces').then(r=>{if(!ignore)setRecent(r.slice(0,6))}).catch(e=>{if(!ignore)setError(errorText(e))});return()=>{ignore=true}},[s.w?.id,s.w?.revision]);
 const locked=s.busy||Object.keys(s.inputDrafts).length>0;
 return <main className="mode-home">
  <div className="mode-intro"><span className="mode-kicker">电缆设计 · 载流量计算 · 企业资料</span><h1>选择你的工作方式</h1><p>同一个工程，两种操作方式。进入后可随时切换，参数和结果保持一致。</p></div>
  <div className="mode-choice-grid">
   <article className="mode-choice professional-choice"><header><span className="mode-symbol"><Box size={28}/></span><span className="mode-audience">精确建模 · 工程师主导</span>{last==='workbench'&&<span className="last-mode">上次使用</span>}</header><h2>专业工作台</h2><p>直接编辑电缆结构与敷设条件，在同一工作区计算、查看结果和复核依据。</p>
    <div className="mode-preview professional-preview" aria-label="专业工作台操作结构示意"><div className="mini-model-tree"><b>计算方案</b><span><Layers3 size={12}/>电缆结构</span><span><Box size={12}/>敷设与负荷</span><span><FileText size={12}/>计算结果</span></div><div className="mini-section"><div className="cable-rings"><i/></div><span>参数化电缆模型</span></div><div className="mini-properties"><b>参数 · 数值 · 单位</b><span>导体截面积 <em>mm²</em></span><span>环境温度 <em>°C</em></span><span>载流量 <em>A</em></span></div></div>
    <div className="mode-feature-row"><span><Check size={14}/>结构与敷设</span><span><Check size={14}/>同屏结果</span><span><Check size={14}/>版本与依据</span></div>
    <button className="mode-enter" disabled={!s.initialized||s.busy} onClick={()=>choose('workbench')}>进入专业工作台 <ArrowRight size={19}/></button>
   </article>
   <article className="mode-choice agent-choice"><header><span className="mode-symbol"><Workflow size={28}/></span><span className="mode-audience">描述目标 · 审查后执行</span>{last==='agent'&&<span className="last-mode">上次使用</span>}</header><h2>智能工程流</h2><p>用任务组织参数、计算与研究。检查变更，再调用工程工具；随时转到工作台精细修改。</p>
    <div className="mode-preview flow-preview" aria-label="智能工程流操作结构示意"><div><span>01</span><b>工程要求</b><small>明确目标和条件</small></div><ArrowRight size={16}/><div><span>02</span><b>变更审查</b><small>核对参数与依据</small></div><ArrowRight size={16}/><div><span>03</span><b>计算与结果</b><small>真实工具 · 可复核</small></div></div>
    <div className="mode-feature-row"><span><Check size={14}/>目标与任务</span><span><Check size={14}/>企业资料</span><span><Check size={14}/>人工确认</span></div>
    <button className="mode-enter" disabled={!s.initialized||s.busy} onClick={()=>choose('agent')}>进入智能工程流 <ArrowRight size={19}/></button>
   </article>
  </div>
  <div className="mode-data-note"><span><Layers3 size={16}/>共享工程版本、型号库与计算记录</span><span>{s.status.cloud_configured?'云端模型已配置 · 发送前需授权':'未配置云端模型时，提供本地明确命令演示'}</span></div>
  <section className="mode-recent" aria-label="最近工程"><header><h2><Clock3 size={19}/>最近工程</h2><small>{s.w?'当前工程：'+s.w.scenario.name:'选择模式后才创建新工程'}</small></header>
   {error&&<p role="alert">{error}</p>}
   {recent.length?<div className="recent-projects">{recent.map(p=><article key={p.id}><FolderOpen size={23}/><div><b>{p.name}</b><small>版本 {p.revision} · {new Date(p.updated_at).toLocaleDateString('zh-CN')}</small></div><div className="recent-actions"><button disabled={locked} onClick={()=>openProject(p.id,'workbench')}>工作台</button><button disabled={locked} onClick={()=>openProject(p.id,'agent')}>工程流</button></div></article>)}</div>:<div className="mode-empty"><FolderOpen size={24}/><p>还没有保存的工程。选择一种方式，从可核对的演示参数开始。</p></div>}
  </section>
  <footer className="mode-home-footer">本机工程辅助预览 · 现有单回路直埋／单根竖向研究范围不因模式切换而扩大。</footer>
 </main>;
}
