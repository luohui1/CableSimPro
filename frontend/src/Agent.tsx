import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Icon } from './Controls';
import type { Result, Scenario, Sweep } from './types';
import { fmt } from './utils';

export interface AgentStatus { cloud_configured: boolean; model: string | null }
export interface Proposal {
  ready: boolean; questions: string[]; mode: string; action?: 'calculate' | 'sweep' | 'inspect';
  changes: {path: string; before: unknown; after: unknown}[]; scenario?: Scenario;
  parameter?: string; values?: number[]; ticket: string | null; assumptions?: string[]; elapsed_ms?: number;
}
export interface Execution {
  scenario: Scenario; result: Result | null; sweep: Sweep | null; statement: string;
  events: {tool: string; status: string; detail: string}[]; elapsed_ms: number; action: string;
}
export interface Message { id: number; role: 'user' | 'assistant'; text: string; proposal?: Proposal; execution?: Execution; base?: string }

export const NAMES: Record<string, string> = {
  'cable.area_mm2': '导体截面积 / mm²', 'cable.conductor': '导体材料', 'cable.insulation_mm': '绝缘厚度 / mm',
  'installation.depth_m': '平均中心埋深 / m', 'installation.spacing_m': '中心间距 / m',
  'installation.soil_rho_k_m_w': '土壤热阻率 / K·m/W', 'installation.ambient_temperature_c': '环境温度 / °C',
  'installation.arrangement': '排列方式', 'operating_current_a': '运行电流 / A', 'circuit_length_m': '线路长度 / m',
};
const LABELS: Record<string, string> = {copper: '铜', aluminium: '铝', trefoil: '三角', flat: '水平'};
const display = (value: unknown) => value == null ? '自动估算' : (LABELS[String(value)] ?? String(value));
export const SUGGESTIONS = ['运行电流设为 350 A，计算载流量', '比较土壤热阻率 0.8、1.2、1.6、2.0 下的载流量', '解释当前模型的假设'];

export function Composer({onSend, busy, mode, setMode, status, consent, setConsent, compact = false}: {
  onSend: (message: string) => void; busy: boolean; mode: 'local' | 'openai'; setMode: (mode: 'local' | 'openai') => void;
  status: AgentStatus; consent: boolean; setConsent: (v: boolean) => void; compact?: boolean;
}) {
  const [text, setText] = useState('');
  function submit(event?: FormEvent) { event?.preventDefault(); if (!text.trim() || busy || (mode === 'openai' && !consent)) return; onSend(text.trim()); setText(''); }
  return <div className={`composer-wrap ${compact ? 'compact' : ''}`}>
    <form className="composer" onSubmit={submit}>
      <textarea aria-label="工程任务" placeholder={compact ? '继续这个工程任务…' : '描述任务，或输入：截面积改为 400 mm²，重新计算'} value={text} maxLength={3000} disabled={busy} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}/>
      <div className="composer-tools"><select aria-label="Agent 模式" value={mode} disabled={busy} onChange={e => setMode(e.target.value as 'local' | 'openai')}><option value="local">本地命令</option><option value="openai" disabled={!status.cloud_configured}>OpenAI{status.cloud_configured ? '' : ' · 未配置'}</option></select><button className="send" aria-label="提交任务" title="提交任务" disabled={busy || !text.trim() || (mode === 'openai' && !consent)}><Icon name="up" size={17}/></button></div>
    </form>
    {mode === 'openai' && <label className="consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}/>允许发送任务与当前工程参数至 OpenAI</label>}
    <p className="composer-note">{mode === 'local' ? '本地命令使用有限语法，不是大模型。' : `${status.model} · 仅在确认后执行修改`}</p>
  </div>;
}

export function Conversation({messages, signature, activeProposal, busy, onExecute}: {
  messages: Message[]; signature: string; activeProposal: number | null; busy: boolean; onExecute: (m: Message) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => { if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight; }, [messages.length]);
  return <div className="conversation" aria-label="任务记录" ref={viewport}>
    {messages.length === 0 && <div className="conversation-empty"><p>和当前模型一起工作</p><span>提出任务，检查变更，再执行求解。<br/>也可以直接编辑模型树中的参数。</span></div>}
    {messages.map(message => {
      const plan = message.proposal;
      const expired = message.id !== activeProposal || message.base !== signature;
      return <article className={`chat-message ${message.role}`} key={message.id}>
        <span className="message-author">{message.role === 'user' ? '你' : 'CableSim'}</span>
        <p className="message-text">{message.text}</p>
        {plan?.ready && <div className="proposal" data-testid="proposal">
          <div className="proposal-title"><Icon name="list" size={15}/><strong>{plan.action === 'inspect' ? '查看模型依据' : plan.action === 'sweep' ? '参数研究' : '稳态载流量研究'}</strong><span>{expired ? '已失效 / 已执行' : '待确认'}</span></div>
          <div className="proposal-diff">{plan.changes.length ? plan.changes.map(c => <div key={c.path}><span>{NAMES[c.path] ?? c.path}</span><code>{display(c.before)} → <b>{display(c.after)}</b></code></div>) : <p>沿用当前全部参数，不修改几何与工况。</p>}</div>
          {plan.action === 'sweep' && <p className="sweep-values">扫描 {NAMES[`installation.${plan.parameter}`] ?? plan.parameter}：{plan.values?.join(' / ')}</p>}
          <details><summary>查看完整输入与假设</summary>{plan.assumptions?.map(a => <p key={a}>{a}</p>)}<pre>{JSON.stringify(plan.scenario, null, 2)}</pre></details>
          <button className="button primary" disabled={expired || busy} onClick={() => onExecute(message)}>{plan.action === 'inspect' ? '确认查看' : plan.action === 'sweep' ? '确认并扫描' : '确认并求解'}<Icon name="arrow" size={14}/></button>
        </div>}
        {message.execution && <div className="execution-trace"><details><summary>{message.execution.events.length} 项工具操作 · {fmt(message.execution.elapsed_ms, 0)} ms</summary>{message.execution.events.map((event, i) => <div className="trace-row" key={i}><Icon name="check" size={13}/><div><code>{event.tool}</code><p>{event.detail}</p></div></div>)}</details><small>结论来自计算内核，不由语言模型估算。</small></div>}
      </article>;
    })}
  </div>;
}
