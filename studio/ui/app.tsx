// The shell of the workbench: project tree, canvas, property panel, with the agent at the side.
import { Bot, Cable, Check, ChevronDown, CircleDot, FileText, FolderOpen, History, Layers, Loader, Play, Plus, Sigma, Thermometer, Zap } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { BONDING_NAMES, compact, LEVEL_NAMES, PHASE_NAMES, STATE_NAMES } from '../shared/format.ts';
import { AgentPanel, ReviewBar } from './agent.tsx';
import { Badge, Button, Facts, Group, Notice, TierBadge } from './components.tsx';
import { LibraryDialog, ProjectDialog, SelectionDialog, SweepDialog } from './dialogs.tsx';
import { CableDrawing, SectionDrawing } from './drawing.tsx';
import { Inspector } from './inspector.tsx';
import { IssueNotice, ReportView, ResultView, stepOf, TierPanel } from './result.tsx';
import { type Step, STEPS, type Studio, useStudio } from './studio.ts';

function RunMenu({ studio }: { studio: Studio }) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!host.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  const blocked = !!studio.busy || !!studio.view?.issue;
  const pick = (action: () => void) => () => { setOpen(false); action(); };
  return <div className="menu-host" ref={host}>
    <Button aria-haspopup="menu" aria-expanded={open} disabled={blocked} onClick={() => setOpen(value => !value)}>更多计算<ChevronDown size={15} /></Button>
    {open && <div className="menu" role="menu">
      <button type="button" role="menuitem" onClick={pick(() => studio.run('run.rate'))}>校核：按当前输入算允许电流</button>
      <button type="button" role="menuitem" onClick={pick(() => studio.setDialog('sweep'))}>扫描：只改一个量，逐点计算…</button>
      <button type="button" role="menuitem" onClick={pick(() => studio.setDialog('selection'))}>选型：按目标电流挑截面…</button>
    </div>}
  </div>;
}

function TopBar({ studio }: { studio: Studio }) {
  const { view, currentRating, busy } = studio;
  const stepState = (step: Step): 'done' | 'warn' | 'none' => {
    if (!view) return 'none';
    if (step === 'result') return currentRating ? 'done' : studio.runs.length ? 'warn' : 'none';
    if (step === 'report') return currentRating?.report ? 'done' : 'none';
    return view.issue && stepOf(view.issue.path) === step ? 'warn' : 'done';
  };
  const primary = !view ? null : !currentRating
    ? <Button variant="primary" icon={<Play size={16} />} disabled={!!busy || !!view.issue} title={view.issue?.message} onClick={() => studio.run('run.rate')}>运行校核</Button>
    : !currentRating.report
      ? <Button variant="primary" icon={<FileText size={16} />} disabled={!!busy} onClick={() => studio.exportReport(currentRating.id)}>导出计算书</Button>
      : <Button variant="primary" icon={<FileText size={16} />} onClick={() => studio.navigate({ step: 'report', run: currentRating.id })}>查看计算书</Button>;
  return <header className="topbar">
    <div className="brand">Cable Studio</div>
    <select className="project-switch" aria-label="工程" value={studio.route.project ?? ''} onChange={event => {
      if (event.target.value === '+') studio.setDialog('project');
      else studio.navigate({ project: event.target.value || undefined, step: 'cable', run: undefined });
    }}>
      {!studio.route.project && <option value="">选择工程</option>}
      {studio.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
      <option value="+">＋ 新建工程…</option>
    </select>
    {view && <nav className="stepper" aria-label="步骤">{STEPS.map((step, index) => {
      const state = stepState(step.id);
      return <button key={step.id} type="button" className={`step-tab ${studio.route.step === step.id ? 'is-current' : ''}`}
        aria-current={studio.route.step === step.id ? 'step' : undefined} onClick={() => studio.navigate({ step: step.id })}>
        <span className={`step-mark step-mark-${state}`}>{state === 'done' ? <Check size={13} /> : index + 1}</span>{step.label}
      </button>;
    })}</nav>}
    <div className="topbar-actions">
      {busy && <span className="busy"><Loader size={16} className="spin" />{busy}</span>}
      {primary}{view && <RunMenu studio={studio} />}
      <Button variant={studio.agentOpen ? 'agent' : 'default'} icon={<Bot size={16} />} aria-pressed={studio.agentOpen}
        onClick={() => studio.setAgentOpen(!studio.agentOpen)}>Agent{studio.proposals.length > 0 && <b className="count">{studio.proposals.length}</b>}</Button>
    </div>
  </header>;
}

function Node({ icon, label, depth, active, onClick, trailing }: {
  icon: ReactNode; label: string; depth: number; active?: boolean; onClick?: () => void; trailing?: ReactNode;
}) {
  const content = <>{icon}<span className="node-label">{label}</span>{trailing}</>;
  const style = { paddingLeft: 10 + depth * 16 };
  // The project name heads the tree; it is a title, not something to press.
  if (!onClick) return <div className="node node-static" style={style}>{content}</div>;
  return <button type="button" className={`node ${active ? 'is-active' : ''}`} style={style} onClick={onClick}>{content}</button>;
}

function Tree({ studio }: { studio: Studio }) {
  const view = studio.view!;
  const { step, run } = studio.route;
  const document = view.preview?.document;
  const go = (target: Step) => () => studio.navigate({ step: target });
  return <aside className="tree" aria-label="工程树">
    <Node icon={<FolderOpen size={16} />} label={view.meta.name} depth={0} />
    <Node icon={<Cable size={16} />} label="型号" depth={1} active={step === 'cable'} onClick={go('cable')} />
    <Node icon={<CircleDot size={15} />} label={view.parts.cable.name} depth={2} onClick={go('cable')} />
    <Node icon={<Layers size={16} />} label="敷设" depth={1} active={step === 'installation'} onClick={go('installation')} />
    <Node icon={<CircleDot size={15} />} label={view.preview?.layout_label ?? '有待修正的输入'} depth={2} onClick={go('installation')} />
    {document?.circuits.map(circuit => <div key={circuit.id}>
      <Node icon={<Zap size={15} />} label={circuit.label} depth={2} onClick={go('installation')} />
      {circuit.cables.map(cable => <Node key={cable.id} icon={<CircleDot size={14} />} label={PHASE_NAMES[cable.phase] ?? cable.phase} depth={3}
        active={studio.selection?.id === cable.id} onClick={() => {
          studio.setSelection({ kind: 'cable', id: cable.id });
          if (!['installation', 'conditions', 'result'].includes(step)) studio.navigate({ step: 'installation' });
        }} />)}
    </div>)}
    <Node icon={<Thermometer size={16} />} label="工况" depth={1} active={step === 'conditions'} onClick={go('conditions')} />
    <Node icon={<CircleDot size={15} />} label={`${compact(view.parts.conditions.ambient_temperature_c)} °C · ${compact(view.parts.conditions.soil_thermal_resistivity)} K·m/W · ${view.parts.conditions.currents_a.map(value => compact(value)).join(' / ')} A`}
      depth={2} onClick={go('conditions')} />
    <Node icon={<Sigma size={16} />} label="方法" depth={1} active={step === 'method'} onClick={go('method')} />
    <Node icon={<CircleDot size={15} />} label="IEC 60287 稳态载流量" depth={2} onClick={go('method')} />
    <Node icon={<History size={16} />} label={`运行记录（${view.runs.length}）`} depth={1} active={step === 'result' && !view.runs.length} onClick={go('result')} />
    {view.runs.map(item => <Node key={item.id} icon={<CircleDot size={15} />} label={`#${item.sequence} ${item.title}`} depth={2}
      active={step === 'result' && studio.runId === item.id} onClick={() => studio.navigate({ step: 'result', run: item.id })}
      trailing={item.status === 'failed' ? <Badge tone="bad">未算出</Badge> : item.inputs_sha256 !== view.inputs_sha256 ? <Badge>旧输入</Badge> : undefined} />)}
    <Node icon={<FileText size={16} />} label="计算书" depth={1} active={step === 'report' && !run} onClick={go('report')} />
    {view.runs.filter(item => item.report).map(item => <Node key={item.id} icon={<CircleDot size={15} />} label={`#${item.sequence} 计算书`} depth={2}
      active={step === 'report' && studio.runId === item.id} onClick={() => studio.navigate({ step: 'report', run: item.id })} />)}
  </aside>;
}

function StepPage({ studio, focused }: { studio: Studio; focused: string | null }) {
  const view = studio.view!;
  const step = studio.route.step;
  const preview = view.preview;
  const proposal = studio.proposals.find(item => item.id === focused);
  if (step === 'result') return <ResultView studio={studio} />;
  if (step === 'report') return <ReportView studio={studio} />;
  if (step === 'method') {
    const method = studio.methods[0];
    return <div className="page">
      <header className="page-head"><h2>方法</h2><span className="page-object">{method?.title ?? 'IEC 60287 稳态载流量'}</span>{preview && <TierBadge tier={preview.tier} />}</header>
      {method && <section className="panel panel-pad">
        <p className="prose">{method.summary}</p>
        <Facts rows={[['方法族', method.family], ['插件', `${method.plugin} ${method.plugin_version}`], ['方法版本', method.method_version],
          ['验证等级', LEVEL_NAMES[method.validation_level] ?? method.validation_level], ['计算开销', method.cost]]} />
        <div className="columns"><div><h4 className="subhead">它回答什么</h4><ul className="bullets">{method.answers.map(item => <li key={item}>{item}</li>)}</ul></div>
          <div><h4 className="subhead">它需要什么</h4><ul className="bullets">{method.inputs.map(item => <li key={item}>{item}</li>)}</ul></div></div>
      </section>}
      {preview ? <section className="panel panel-pad"><h3>当前敷设形式的可信分档</h3><TierPanel tier={preview.tier} /></section>
        : view.issue && <IssueNotice issue={view.issue} studio={studio} title="输入有待修正，暂时无法判断分档" />}
      {method && <>
        <Group title="方法的全部验证算例" summary={`${method.validation_cases.length} 项`} defaultOpen={false}><ul className="bullets">{method.validation_cases.map(item => <li key={item}>{item}</li>)}</ul></Group>
        <Group title="适用范围与限制" summary={`${method.limitations.length} 条`} defaultOpen={false}><ul className="bullets">{method.limitations.map(item => <li key={item}>{item}</li>)}</ul></Group>
      </>}
    </div>;
  }
  if (step === 'cable' && !proposal) {
    const cable = view.parts.cable;
    return <div className="page page-fill">
      <header className="page-head"><h2>型号</h2><span className="page-object">{cable.name}</span><Badge tone="warn">{STATE_NAMES[cable.state] ?? cable.state}</Badge></header>
      <section className="panel panel-canvas grow"><CableDrawing cable={cable.payload.cable_type} materials={cable.payload.materials}
        selected={studio.selection?.kind === 'ring' ? studio.selection.id : null} onSelect={id => studio.setSelection(id ? { kind: 'ring', id } : null)} /></section>
    </div>;
  }
  const conditions = view.parts.conditions;
  const titles: Record<string, string> = { cable: '型号', installation: '敷设', conditions: '工况' };
  return <div className="page page-fill">
    <header className="page-head"><h2>{titles[step]}</h2>
      {preview && <span className="page-object">{preview.layout_label} · {BONDING_NAMES[view.parts.installation.bonding]}</span>}
      {preview && <TierBadge tier={preview.tier} />}</header>
    {!preview && view.issue ? <IssueNotice issue={view.issue} studio={studio} title="这组输入还不能计算" />
      : preview && <section className="panel panel-canvas grow"><SectionDrawing document={preview.document} proposed={proposal?.preview?.document}
        selected={studio.selection?.kind === 'cable' ? studio.selection.id : null} onSelect={id => studio.setSelection(id ? { kind: 'cable', id } : null)}
        facts={step === 'conditions' ? <Facts rows={[['环境温度', `${compact(conditions.ambient_temperature_c)} °C`],
          ['土壤热阻率', `${compact(conditions.soil_thermal_resistivity)} K·m/W`], ['负荷', conditions.currents_a.map(value => compact(value)).join(' / ') + ' A']]} />
          : <Facts rows={[['电缆外径', `${compact(preview.outer_diameter_m * 1000, 5)} mm`], ['回路数', preview.circuit_count]]} />} /></section>}
  </div>;
}

function StartPage({ studio }: { studio: Studio }) {
  return <main className="start">
    <h1>Cable Studio</h1>
    <p className="start-lead">电缆载流量工作台：选型号、摆敷设、填工况，按 IEC 60287 算出允许电流，并带着依据导出计算书。</p>
    <Button variant="primary" icon={<Plus size={16} />} onClick={() => studio.setDialog('project')}>新建工程</Button>
    {studio.loadError && <Notice tone="bad" title="没有连上本机服务">{studio.loadError}</Notice>}
    {studio.projects.length > 0 && <section className="panel panel-pad"><h3>已有工程</h3>
      <table className="grid"><thead><tr><th>工程</th><th>最近修改</th></tr></thead><tbody>{studio.projects.map(project =>
        <tr key={project.id} onClick={() => studio.navigate({ project: project.id, step: 'cable', run: undefined })}>
          <td>{project.name}</td><td>{new Date(project.updated).toLocaleString('zh-CN', { hour12: false })}</td></tr>)}</tbody></table></section>}
  </main>;
}

export function App() {
  const studio = useStudio();
  const [focused, setFocused] = useState<string | null>(null);
  const { view } = studio;
  return <div className={`app ${studio.agentOpen ? 'has-agent' : ''} ${view ? '' : 'is-start'}`}>
    <TopBar studio={studio} />
    {view ? <>
      <Tree studio={studio} />
      <main className="main">
        <ReviewBar studio={studio} focused={focused} onFocus={setFocused} />
        {studio.failure && <IssueNotice issue={studio.failure} studio={studio} title="没有运行" />}
        <StepPage studio={studio} focused={focused} />
      </main>
      <Inspector studio={studio} />
    </> : studio.route.project && !studio.loadError ? <main className="start"><p className="prose">正在打开工程…</p></main> : <StartPage studio={studio} />}
    {studio.agentOpen && <AgentPanel studio={studio} />}
    {studio.dialog === 'project' && <ProjectDialog studio={studio} />}
    {studio.dialog === 'library' && view && <LibraryDialog studio={studio} />}
    {studio.dialog === 'sweep' && view && <SweepDialog studio={studio} />}
    {studio.dialog === 'selection' && view && <SelectionDialog studio={studio} />}
  </div>;
}
