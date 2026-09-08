import {useEffect,useState} from 'react';
import {ArrowRight,Check,Clock3,FolderOpen,Layers3} from 'lucide-react';
import {api,errorText} from '../utils';
import {useStudio} from '../StudioState';
import {previousMode,type WorkMode} from './session';
import {EngineeringPlate} from '../visual-assets/EngineeringPlate';
interface Recent {id:string;name:string;revision:number;updated_at:string}
export default function ModeSelection({choose,openProject}:{choose:(mode:WorkMode)=>void;openProject:(id:string,mode:WorkMode)=>void}){
 const s=useStudio(),[recent,setRecent]=useState<Recent[]>([]),[error,setError]=useState('');
 const last=previousMode(),locked=s.busy||Object.keys(s.inputDrafts).length>0;
 useEffect(()=>{let ignore=false;api<Recent[]>('/api/workspaces').then(r=>{if(!ignore)setRecent(r.slice(0,6))}).catch(e=>{if(!ignore)setError(errorText(e))});return()=>{ignore=true}},[s.w?.id,s.w?.revision]);
 return <main className="mode-home visual-home">
  <section className="entry-hero" aria-label="电缆工程工作入口">
   <div className="entry-hero-copy"><span className="entry-eyebrow">电缆工程 · 从结构到载流量</span><h1>选择你的工作方式</h1><p className="entry-lead">精确设计，<br/>有据可查。</p><p>在专业工作台直接建模，或交给智能工程流组织任务。<br className="desktop-break"/>同一份工程数据，从输入条件到计算书始终一致。</p><div className="entry-disciplines"><span>电缆结构</span><span>敷设条件</span><span>载流量计算</span></div></div>
   <figure className="entry-hero-figure"><EngineeringPlate kind="cable" priority/><div className="plate-index">01 / 电缆结构</div><div className="hero-annotation"><i/><span>导体 · 绝缘 · 金属屏蔽 · 护套</span></div><figcaption>原创结构示意 · 非厂家产品图，不代表当前工程</figcaption></figure>
  </section>
  <section className="mode-choice-grid" aria-label="选择工作模式">
   <article className="mode-choice professional-choice"><div className="mode-copy"><header><span className="mode-number">01</span><span className="mode-audience">工程师主导</span>{last==='workbench'&&<span className="last-mode">上次使用</span>}</header><h2>专业工作台</h2><p>检查电缆结构，精确调整敷设参数。模型、计算和结果在同一工作区。</p><div className="mode-feature-row"><span><Check size={14}/>参数化建模</span><span><Check size={14}/>同屏结果</span></div><button className="mode-enter" disabled={!s.initialized||s.busy} onClick={()=>choose('workbench')}>进入专业工作台<ArrowRight size={18}/></button></div><EngineeringPlate kind="installation"/></article>
   <article className="mode-choice agent-choice"><div className="mode-copy"><header><span className="mode-number">02</span><span className="mode-audience">目标驱动 · 人工审查</span>{last==='agent'&&<span className="last-mode">上次使用</span>}</header><h2>智能工程流</h2><p>描述工程任务，核对依据和参数差异。确认后调用工程工具，保留执行记录。</p><div className="mode-feature-row"><span><Check size={14}/>资料核对</span><span><Check size={14}/>变更审查</span></div><button className="mode-enter" disabled={!s.initialized||s.busy} onClick={()=>choose('agent')}>进入智能工程流<ArrowRight size={18}/></button></div><EngineeringPlate kind="documents"/></article>
  </section>
  <div className="mode-data-note"><span><Layers3 size={16}/>模式可随时切换，工程版本与计算记录共用</span><span>{s.status.cloud_configured?'云端模型已配置 · 发送前需授权':'本地明确命令可用 · 云端 Agent 需配置服务'}</span></div>
  <section className="mode-recent" aria-label="最近工程"><header><h2><Clock3 size={18}/>最近工程</h2><small>{s.w?'当前工程：'+s.w.scenario.name:'仅在选择模式后创建新工程'}</small></header>
   {error&&<p role="alert">{error}</p>}
   {recent.length?<div className="recent-projects">{recent.map(p=><article key={p.id}><FolderOpen size={22}/><div><b>{p.name}</b><small>版本 {p.revision} · {new Date(p.updated_at).toLocaleDateString('zh-CN')}</small></div><div className="recent-actions"><button disabled={locked} onClick={()=>openProject(p.id,'workbench')}>工作台</button><button disabled={locked} onClick={()=>openProject(p.id,'agent')}>工程流</button></div></article>)}</div>:<div className="mode-empty"><FolderOpen size={23}/><p>还没有保存的工程。选择上方模式开始，参数均可核对和修改。</p></div>}
  </section>
  <footer className="mode-home-footer">工程辅助预览 · 单回路直埋 / 单根隔离竖向 · 不宣称完整标准符合性</footer>
 </main>;
}
