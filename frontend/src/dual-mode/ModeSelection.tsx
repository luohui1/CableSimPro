import {useEffect, useState} from 'react';
import {ArrowRight, Box, Check, Clock3, FolderOpen, Layers3, Workflow} from 'lucide-react';
import {api, errorText} from '../utils';
import {useStudio} from '../StudioState';
import EngineeringIllustration from '../engineering-visuals/EngineeringIllustration';
import {previousMode, type WorkMode} from './session';

interface Recent {id: string; name: string; revision: number; updated_at: string}

export default function ModeSelection({choose, openProject}: {
  choose: (mode: WorkMode) => void;
  openProject: (id: string, mode: WorkMode) => void;
}) {
  const s = useStudio();
  const [recent, setRecent] = useState<Recent[]>([]);
  const [error, setError] = useState('');
  const last = previousMode();
  useEffect(() => {
    let ignore = false;
    api<Recent[]>('/api/workspaces').then(items => {
      if (!ignore) {setRecent(items.slice(0, 6)); setError('');}
    }).catch(e => {if (!ignore) setError(errorText(e));});
    return () => {ignore = true;};
  }, [s.w?.id, s.w?.revision]);
  const locked = s.busy || Object.keys(s.inputDrafts).length > 0;

  return <main className="mode-home v073-home">
    <div className="mode-intro">
      <span className="mode-kicker">电缆企业 / 设计与验证</span>
      <h1>选择你的工作方式</h1>
      <p>从精确建模开始，或直接描述设计目标。两种模式共享工程，随时切换。</p>
    </div>
    <div className="mode-choice-grid">
      <article className="mode-choice professional-choice">
        <div className="mode-card-copy">
          <header><span className="mode-symbol"><Box size={23}/></span>
            <span className="mode-audience">工程师主导</span>
            {last === 'workbench' && <span className="last-mode">上次使用</span>}
          </header>
          <h2>专业工作台</h2>
          <p>结构、工况与计算结果，<br/>在同一张工程画布中检查。</p>
          <div className="mode-feature-row"><span><Check size={15}/>参数化建模</span><span><Check size={15}/>载流量与温度</span><span><Check size={15}/>依据追溯</span></div>
        </div>
        <EngineeringIllustration id="cable" eager/>
        <footer><span>适合结构设计、工况调整与精细复核</span>
          <button className="mode-enter" disabled={!s.initialized || s.busy} onClick={() => choose('workbench')}>进入专业工作台 <ArrowRight size={19}/></button>
        </footer>
      </article>
      <article className="mode-choice agent-choice">
        <div className="mode-card-copy">
          <header><span className="mode-symbol"><Workflow size={23}/></span>
            <span className="mode-audience">任务驱动 · 人工审查</span>
            {last === 'agent' && <span className="last-mode">上次使用</span>}
          </header>
          <h2>智能工程流</h2>
          <p>描述要解决的问题，<br/>核对计划，再执行工程工具。</p>
          <div className="mode-feature-row"><span><Check size={15}/>条件确认</span><span><Check size={15}/>型号比较</span><span><Check size={15}/>变更审查</span></div>
        </div>
        <EngineeringIllustration id="installation" eager/>
        <footer><span>适合载流量研究、企业选型与资料核对</span>
          <button className="mode-enter" disabled={!s.initialized || s.busy} onClick={() => choose('agent')}>进入智能工程流 <ArrowRight size={19}/></button>
        </footer>
      </article>
    </div>
    <div className="mode-data-note"><span><Layers3 size={17}/>同一工程版本 · 同一计算内核 · 同一审查记录</span>
      <span>{s.status.cloud_configured ? '云端模型已配置 · 发送前需授权' : '未配置模型时使用本地明确命令，不冒充通用 Agent'}</span>
    </div>
    <section className="mode-recent" aria-label="最近工程">
      <header><h2><Clock3 size={19}/>最近工程</h2><small>{s.w ? '当前工程：' + s.w.scenario.name : '选择模式后才创建新工程'}</small></header>
      {error && <p role="alert">{error}</p>}
      {recent.length ? <div className="recent-projects">{recent.map(project => <article key={project.id}>
        <FolderOpen size={23}/><div><b>{project.name}</b><small>版本 {project.revision} · {new Date(project.updated_at).toLocaleDateString('zh-CN')}</small></div>
        <div className="recent-actions"><button disabled={locked} onClick={() => openProject(project.id, 'workbench')}>工作台</button><button disabled={locked} onClick={() => openProject(project.id, 'agent')}>工程流</button></div>
      </article>)}</div> : <div className="mode-empty"><FolderOpen size={24}/><p>还没有保存的工程。选择一种方式，从可核对的演示参数开始。</p></div>}
    </section>
    <footer className="mode-home-footer">工程辅助预览 · 现有单回路直埋／单根竖向研究范围不因模式切换而扩大。</footer>
  </main>;
}
