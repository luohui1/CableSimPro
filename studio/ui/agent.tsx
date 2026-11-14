// The agent's place in the workbench: a side panel for handing over work and following it,
// and a review bar above the canvas where its proposed changes are accepted or rejected.
// Results never appear here; they land in the run records like the engineer's own.
import { ArrowRight, Check, CircleAlert, CircleDashed, CircleStop, Loader, Send, X } from 'lucide-react';
import { useState } from 'react';
import type { Proposal, Task, TaskStep } from '../shared/types.ts';
import { api, ApiError } from './api.ts';
import { Badge, Button, Notice } from './components.tsx';
import { cableLabel } from './drawing.tsx';
import type { Studio } from './studio.ts';

const SUGGESTIONS = ['按 400 A 选型', '土壤热阻率从 1.0 扫到 2.0，看载流量怎么变', '检查当前输入有没有不合理的地方'];
const TASK_STATES: Record<Task['status'], { label: string; tone: 'agent' | 'warn' | 'ok' | 'bad' | 'neutral' }> = {
  running: { label: '进行中', tone: 'agent' }, waiting_review: { label: '等你审阅', tone: 'warn' }, done: { label: '已完成', tone: 'ok' },
  failed: { label: '失败', tone: 'bad' }, stopped: { label: '已停止', tone: 'neutral' },
};

function StepIcon({ status }: { status: TaskStep['status'] }) {
  if (status === 'running') return <Loader size={16} className="spin" />;
  if (status === 'waiting_review') return <CircleDashed size={16} className="tone-warn" />;
  if (status === 'done') return <Check size={16} className="tone-ok" />;
  if (status === 'rejected') return <X size={16} className="tone-muted" />;
  return <CircleAlert size={16} className="tone-bad" />;
}

function TaskCard({ task, studio }: { task: Task; studio: Studio }) {
  const state = TASK_STATES[task.status];
  const live = task.status === 'running' || task.status === 'waiting_review';
  return <article className="task">
    <header className="task-head"><p className="task-instruction">{task.instruction}</p><Badge tone={state.tone}>{state.label}</Badge></header>
    {task.context && <div className="task-context">针对：{task.context}</div>}
    {task.steps.length > 0 && <ol className="steps">{task.steps.map(step => <li key={step.id} className="step">
      <StepIcon status={step.status} />
      <div className="step-text">
        <span className="step-label">{step.label}</span>
        {step.status === 'waiting_review' && <span className="step-result">改动已放到工作台上，等你接受或拒绝</span>}
        {step.status === 'rejected' && <span className="step-result">你拒绝了这项改动</span>}
        {step.status === 'failed' && step.result && <span className="step-result step-result-bad">{step.result}</span>}
        {step.status === 'done' && step.result && <span className="step-result">{step.result}</span>}
      </div>
      {step.run_id && <button type="button" className="link" onClick={() => studio.navigate({ step: 'result', run: step.run_id })}>查看<ArrowRight size={14} /></button>}
    </li>)}</ol>}
    {task.reply && <p className="task-reply">{task.reply}</p>}
    {task.error && <p className="task-reply task-error">{task.error}</p>}
    {live && <Button icon={<CircleStop size={15} />} onClick={() => api.stop(task.project_id)}>停止</Button>}
  </article>;
}

export function AgentPanel({ studio }: { studio: Studio }) {
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState('');
  const status = studio.status;
  const project = studio.view?.meta.id;
  const document = studio.view?.preview?.document;
  const context = studio.selection?.kind === 'cable' && document ? cableLabel(studio.selection.id, document) : undefined;
  const busy = studio.tasks.some(task => task.status === 'running' || task.status === 'waiting_review');

  async function send() {
    const text = studio.draft.trim();
    if (!text || !project) return;
    setSending(true); setProblem('');
    try {
      await api.instruct(project, text, context);
      studio.setDraft('');
      await studio.reloadAgent(project);
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : String(error));
    } finally {
      setSending(false);
    }
  }

  return <aside className="agent" aria-label="Agent">
    <header className="agent-head">
      <h2>Agent</h2>
      {status?.configured ? <Badge tone="agent">{status.provider} · {status.model}</Badge> : <Badge tone="warn">模型未配置</Badge>}
      <button type="button" className="icon-btn" aria-label="收起 Agent" onClick={() => studio.setAgentOpen(false)}><X size={18} /></button>
    </header>
    {status && !status.configured && <Notice tone="warn" title="模型未配置">{status.hint}工作台的其他功能不受影响。</Notice>}
    {!project && <Notice title="先打开一个工程">Agent 在工程里干活：它用和你一样的操作改输入、跑计算，结果落在同一处。</Notice>}
    {project && <div className="handoff">
      <label htmlFor="agent-instruction">交办一件事</label>
      <textarea id="agent-instruction" rows={3} value={studio.draft} placeholder="例如：按 400 A 选型" disabled={!status?.configured || sending}
        onChange={event => studio.setDraft(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void send(); } }} />
      {context && <div className="handoff-context"><span>针对所选：{context}</span>
        <button type="button" className="link" onClick={() => studio.setSelection(null)}>不带</button></div>}
      <div className="handoff-actions">
        <Button variant="agent" icon={<Send size={15} />} disabled={!status?.configured || sending || busy || !studio.draft.trim()} onClick={send}>
          {busy ? '上一件事还没做完' : '交办'}</Button>
      </div>
      {problem && <div className="field-note" role="alert">{problem}</div>}
      {!studio.draft && status?.configured && <div className="suggestions">{SUGGESTIONS.map(text =>
        <button key={text} type="button" className="suggestion" onClick={() => studio.setDraft(text)}>{text}</button>)}</div>}
    </div>}
    <div className="tasks">
      {studio.tasks.length > 0 && <h3>任务</h3>}
      {studio.tasks.map(task => <TaskCard key={task.id} task={task} studio={studio} />)}
    </div>
  </aside>;
}

/** Proposed changes, shown where the engineer works; each one is accepted or rejected on its own. */
export function ReviewBar({ studio, focused, onFocus }: { studio: Studio; focused: string | null; onFocus: (id: string | null) => void }) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [working, setWorking] = useState<string | null>(null);
  const [problem, setProblem] = useState('');
  if (!studio.proposals.length) return null;

  async function decide(proposal: Proposal, accept: boolean) {
    setWorking(proposal.id); setProblem('');
    try {
      await api.decide(proposal.id, accept, notes[proposal.id]?.trim() || undefined);
      onFocus(null);
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : String(error));
    } finally {
      setWorking(null);
    }
  }

  return <section className="review" aria-label="待审改动">
    <header className="review-head"><strong>Agent 提议了 {studio.proposals.length} 项改动</strong><span>接受后才会写入工程；拒绝时可以告诉它原因。</span></header>
    {studio.proposals.map(proposal => <div key={proposal.id} className={`review-item ${focused === proposal.id ? 'is-focused' : ''}`}>
      <div className="review-body">
        <div className="review-title">{proposal.title}</div>
        <table className="grid review-changes"><tbody>{proposal.changes.map(change =>
          <tr key={change.part + change.field}><td>{change.label}</td><td>{change.before}</td><td className="arrow"><ArrowRight size={15} /></td><td><strong>{change.after}</strong></td></tr>)}</tbody></table>
        {proposal.issue && <div className="field-note" role="alert">按这项改动，输入会有问题：{proposal.issue.message}</div>}
        {proposal.preview && <div className="review-effect">改动后的可信分档：<Badge tone={proposal.preview.tier.tier === 'deliverable' ? 'ok' : 'warn'}>{proposal.preview.tier.label}</Badge></div>}
      </div>
      <div className="review-actions">
        <input aria-label="拒绝原因（可不填）" placeholder="拒绝原因（可不填）" value={notes[proposal.id] ?? ''}
          onChange={event => setNotes(all => ({ ...all, [proposal.id]: event.target.value }))} />
        {proposal.preview && <Button onClick={() => onFocus(focused === proposal.id ? null : proposal.id)}>{focused === proposal.id ? '收起预览' : '在截面上预览'}</Button>}
        <Button disabled={working === proposal.id} onClick={() => decide(proposal, false)}>拒绝</Button>
        <Button variant="primary" disabled={working === proposal.id} onClick={() => decide(proposal, true)}>接受</Button>
      </div>
    </div>)}
    {problem && <div className="field-note" role="alert">{problem}</div>}
  </section>;
}
