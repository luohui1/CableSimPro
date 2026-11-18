import { useEffect, useRef, useState, type ReactNode } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog } from "@/components/ui/dialog";
import { AnswerText, CopyAnswer } from "./answer-text";
import { WorkingMark } from "./working-mark";
export { WorkingMark } from "./working-mark";
export { AnswerText } from "./answer-text";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { ObjectChip } from "@/components/object-link";
import { significantNumber, formatDateTime } from "@/lib/format";
import { displayName, displayText } from '@/lib/display-names';
import type { ObjectCard } from '@/api/object-index';
import { EVIDENCE_LABEL, type Preview, type SavedRun, type Step, type Turn } from "./transcript";
import type { AgentProposal } from "./agent-api";
import "./agent.css";

/* Agent 对话组件（来自组件陈列的“中栏 · 对话 / 右栏 · 审核”）：
   提问气泡 · 工作过程（收起一行、展开每步）· 回答 · 试算卡 · 改动审核（按住批准）· 输入栏。 */

type Label = (entity: string) => string;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
function proposalFieldLabel(path: string, label: Label) {
  const parts = path.split('/').slice(1).map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'));
  const core = parts.indexOf('cores'), layer = parts.indexOf('layers');
  const field = parts.at(-1) || '';
  const key = layer >= 0 ? `${parts[layer + 1]}_${field}` : field;
  const name = displayName(key);
  return [core >= 0 ? label(parts[core + 1]) : '', name !== key ? name : '参数字段'].filter(Boolean).join(' · ');
}
function readableAgentText(value: string, label: Label, refs: ObjectCard[] = []) {
  const names = new Map(refs.map(card => [card.id, card.name]));
  const paths = value.replace(/\/(?:cable_types|parameters|values|materials|sections|circuits|loads|requirements|driver|definition)(?:\/[A-Za-z0-9_~.-]+)+/g, path => proposalFieldLabel(path, label));
  const entities = paths.replace(/\b(?:circuit|core|cable|section|material|load|case|condition|layer)\/[A-Za-z0-9_/-]+/g, id => label(id));
  return displayText(entities.replace(UUID, id => names.get(id) || '保存记录')
    .replace(/\bA\/B\/C\b/g, 'A、B、C')
    .replace(/\bv0 soil\b/g, '土壤')
    .replace(/\bv0 screen, construction unspecified\b/g, '屏蔽（结构未明确）')
    .replace(/\bunspecified\b/g, '未明确'));
}
/** 方案前后值：去掉浮点噪声，前后按同样的小数位显示（1.0 → 1.2）。 */
const decimals = (value: unknown) => (typeof value === "number" ? (String(Number(value.toPrecision(10))).split(".")[1] || "").length : 0);
const show = (value: unknown, places = decimals(value)) => (value === null || value === undefined ? "—" : typeof value === "number" ? Number(value.toPrecision(10)).toFixed(Math.min(places, 6)) : typeof value === "object" ? JSON.stringify(value) : String(value));
const seconds = (ms: number) => (ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60_000)} 分 ${Math.round((ms % 60_000) / 1000)} 秒`);

function useElapsed(turn: Turn) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!turn.running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [turn.running]);
  const start = turn.started ? Date.parse(turn.started) : now;
  const end = turn.running ? now : turn.finished ? Date.parse(turn.finished) : now;
  return Math.max(0, end - start);
}

const stepIcon = (step: Step, kinds: Map<string, string>) =>
  step.tool === "answer-check" ? "result/evidence" : ({ read: "agent/step-read", propose: "agent/proposal", run: "agent/step-run" } as Record<string, string>)[kinds.get(step.tool) || "read"] || "agent/step-read";

/** 工作过程：进行中展开并显示当前步骤；完成后收成“已完成 N 步，用时 …”。 */
export function WorkSteps({ turn, kinds, label = displayName }: { turn: Turn; kinds: Map<string, string>; label?: Label }) {
  const elapsed = useElapsed(turn);
  const [open, setOpen] = useState<boolean>();
  const steps = turn.steps;
  if (!steps.length && !turn.running) return null;
  const current = [...steps].reverse().find((step) => step.status === "running");
  const failed = !turn.running && (['blocked', 'failed'].includes(turn.task?.state || '') || turn.interrupted || steps.some((step) => step.status === "error" && step.tool !== "answer-check"));
  const expanded = open ?? (turn.running && steps.length > 0);
  return <Collapsible open={expanded} onOpenChange={setOpen} className={`agent-steps ${expanded ? "is-open" : ""}`}>
    <CollapsibleTrigger asChild><Button variant="ghost" size="compact" className="agent-steps-head">
      <WorkingMark state={turn.running ? "working" : failed ? "error" : "done"} />
      <span>{turn.running ? (current ? `正在${current.title}` : "正在思考") : `${failed ? '已结束' : '已完成'} ${steps.length} 步，用时`}</span>
      <time>{seconds(elapsed)}</time>
      <Icon name="action/chevron-down" className="agent-steps-chevron" />
    </Button></CollapsibleTrigger>
    <CollapsibleContent><ol className="agent-step-list">{steps.map((step) => <li key={step.id} className={`agent-step is-${step.status}`}>
      <Icon name={stepIcon(step, kinds)} />
      <b>{step.title}</b>
      {step.summary && <span title={step.summary}>{readableAgentText(step.summary, label, turn.refs)}</span>}
      <time>{step.status === "running" ? "…" : step.ms !== undefined ? seconds(step.ms) : ""}</time>
    </li>)}</ol></CollapsibleContent>
  </Collapsible>;
}

const BASIS: Record<string, string> = { rating: "单独额定", "rating-simultaneous": "同时额定" };

/** 试算卡：数值来自 study_preview 的结果，明确标注未保存、未批准。 */
export function PreviewCard({ preview, label, proposalTitle, onOpen }: { preview: Preview; label: Label; proposalTitle?: string; onOpen?: () => void }) {
  const bases = [...new Set(preview.ampacity.map((row) => row.basis))];
  const entities = [...new Set(preview.ampacity.map((row) => row.entity))];
  return <article className="agent-card">
    <header><Icon name="calc/ampacity" /><b>试算结果</b><span className="agent-card-tag">未保存</span></header>
    {proposalTitle && <p className="agent-card-meta">按方案「{proposalTitle}」试算</p>}
    {preview.headlines.length > 0 && <dl className="agent-card-values">{preview.headlines.map((row) => <div key={row.title + row.entity}>
      <dt>{row.title}{row.entity && <span>{label(row.entity)}</span>}</dt><dd>{significantNumber(row.value, 4)}<small>{row.unit}</small></dd>
    </div>)}</dl>}
    {entities.length > 0 && <table className="agent-card-table"><thead><tr><th>回路</th>{bases.map((basis) => <th key={basis}>{BASIS[basis] || basis} / A</th>)}</tr></thead>
      <tbody>{entities.map((entity) => <tr key={entity}><td>{label(entity)}</td>{bases.map((basis) => {
        const row = preview.ampacity.find((item) => item.entity === entity && item.basis === basis);
        return <td key={basis} title={row?.reason}>{row?.value != null ? significantNumber(row.value, 4) : row ? <span className="agent-card-none">无正值</span> : "—"}</td>;
      })}</tr>)}</tbody></table>}
    <footer><span>试算不写入工程，也不代表批准</span>{onOpen && <Button size="compact" variant="ghost" onClick={onOpen}>在工作台打开<Icon name="action/arrow-right" /></Button>}</footer>
  </article>;
}

/** 保存运行卡：Agent 读过的已保存结果，数值来自运行摘要的结论量值。 */
export function SavedRunCard({ run, title, label, onOpen }: { run: SavedRun; title?: string; label: Label; onOpen?: () => void }) {
  return <article className="agent-card">
    <header><Icon name="result/snapshot" /><b>{title || "保存运行"}</b><span className="agent-card-tag">{run.sequence ? `运行 ${run.sequence}` : "已保存"}</span></header>
    <dl className="agent-card-values">{run.headlines.map((row) => <div key={row.title + row.entity}>
      <dt>{row.title}{row.entity && <span>{label(row.entity)}</span>}</dt><dd>{significantNumber(row.value, 4)}<small>{row.unit}</small></dd>
    </div>)}</dl>
    <footer><span>{run.created ? `保存于 ${new Date(run.created).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : "已保存运行"}</span>{onOpen && <Button size="compact" variant="ghost" onClick={onOpen}>在工作台打开<Icon name="action/arrow-right" /></Button>}</footer>
  </article>;
}

/** 按住确认：松手即取消，避免误触批准。 */
export function HoldButton({ children, onConfirm, disabled, loading }: { children: ReactNode; onConfirm: () => void; disabled?: boolean; loading?: boolean }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<number | null>(null);
  const stop = () => { if (timer.current) window.clearTimeout(timer.current); timer.current = null; setHolding(false); };
  const start = () => {
    if (disabled || loading || timer.current) return;
    setHolding(true);
    timer.current = window.setTimeout(() => { timer.current = null; setHolding(false); onConfirm(); }, 800);
  };
  useEffect(() => {
    const cancel = () => stop();
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', cancel);
    return () => { window.removeEventListener('blur', cancel); document.removeEventListener('visibilitychange', cancel); stop(); };
  }, []);
  useEffect(() => { if (disabled || loading) stop(); }, [disabled, loading]);
  return <Button type="button" variant="primary" className="agent-hold" data-holding={holding || undefined} aria-busy={loading || undefined} disabled={disabled || loading}
    onPointerDown={event => { if (event.button === 0) start(); }} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop} onBlur={stop}
    onKeyDown={(event) => { if (event.key === 'Escape') { stop(); return; } if ((event.key === " " || event.key === "Enter") && !event.repeat) { event.preventDefault(); start(); } }}
    onKeyUp={(event) => { if (event.key === " " || event.key === "Enter") stop(); }}>
    <span>{loading ? "正在保存" : children}</span>
  </Button>;
}

/** 改动审核：字段级前后值；只有人能批准，批准走工作台同一保存路径。 */
export function ProposalCard({ proposal, onDecide, busy, error, receipt, label = displayName }: { proposal: AgentProposal; onDecide: (id: string, decision: "approve" | "reject") => void; busy?: boolean; error?: string; receipt?: { created: string; actor?: string; status: string }; label?: Label }) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const title = readableAgentText(proposal.title, label);
  const changes = (complete = false) => <div className="agent-diff">{(complete ? proposal.changes : proposal.changes.slice(0, 6)).map((change, index) => {
    const places = Math.max(decimals(change.before), decimals(change.after));
    const pathLabel = proposalFieldLabel(change.path, label);
    const field = change.label.startsWith('/') || change.path.includes('/cores/') && !pathLabel.endsWith('参数字段') ? pathLabel : readableAgentText(change.label, label);
    return <div key={`${index}/${change.path}`} className="agent-diff-hunk">
      <div className="agent-diff-label">{field}</div>
      <div className="agent-diff-line is-removed"><span className="agent-diff-kind">修改前</span><span>{show(change.before, places)}{change.unit && ` ${change.unit}`}</span></div>
      <div className="agent-diff-line is-added"><span className="agent-diff-kind">修改后</span><span>{show(change.after, places)}{change.unit && ` ${change.unit}`}</span></div>
    </div>;
  })}</div>;
  return <article className={`agent-review-card is-${proposal.status}`}>
    <header><Icon name="agent/proposal" /><b title={title}>{title}</b><span>{proposal.status === "approved" ? "已批准" : proposal.status === "rejected" ? "已拒绝" : `待审核 · ${proposal.changes.length} 项改动`}</span></header>
    {proposal.base_revision != null && <p className="agent-card-meta">基于第 {proposal.base_revision} 修订</p>}
    {receipt && receipt.status === proposal.status && <p className="agent-card-meta">{receipt.actor ? `${receipt.actor === 'human' ? '人工' : receipt.actor} · ` : ''}{formatDateTime(receipt.created)} · {receipt.status === 'approved' ? '已保存输入，工程结果尚未批准' : '已拒绝方案'}</p>}
    {changes()}
    {proposal.changes.length > 6 && <p className="agent-review-more">当前列出 6 项，共 {proposal.changes.length} 项。展开完整审核可查看每个字段。</p>}
    <Button variant="outline" size="compact" onClick={() => setReviewOpen(true)}>展开完整审核</Button>
    <Dialog open={reviewOpen} onOpenChange={setReviewOpen} title="审核字段改动" description={`${title}。逐项核对修改前、修改后和单位；关闭后回到方案卡批准或拒绝。`}>
      <div className="agent-review-document">{changes(true)}
        {!!proposal.checks?.length && <ul className="agent-review-checks">{proposal.checks.map((check, index) => <li key={index}>{readableAgentText(check, label)}</li>)}</ul>}
      </div>
    </Dialog>
    {!!proposal.checks?.length && <ul className="agent-review-checks">{proposal.checks.map((check) => <li key={check} title={check}>{readableAgentText(check, label)}</li>)}</ul>}
    <details className="agent-notice-details"><summary>追溯 · 提案详情</summary><pre>{proposal.title}{'\n'}{proposal.changes.map(change => change.path).join('\n')}</pre></details>
    {error && <p className="agent-notice" role="alert">{error}</p>}
    {proposal.status === "pending" && <div className="agent-review-actions">
      <HoldButton loading={busy} onConfirm={() => onDecide(proposal.id, "approve")}>按住批准 {proposal.changes.length} 项改动</HoldButton>
      <Button size="compact" variant="ghost" disabled={busy} onClick={() => onDecide(proposal.id, "reject")}>拒绝</Button>
    </div>}
  </article>;
}

/** 方案在对话里只留一行引用，审核在右栏完成（工作台属性栏这种窄位置则直接内嵌审核卡）。 */
function ProposalLine({ proposal, label }: { proposal: AgentProposal; label: Label }) {
  const title = readableAgentText(proposal.title, label);
  return <div className={`agent-proposal-line is-${proposal.status}`}><Icon name="agent/branch" /><span title={title}>方案：{title.length > 50 ? title.split(' · ')[0] : title}</span>
    <b>{proposal.status === "approved" ? "已批准" : proposal.status === "rejected" ? "已拒绝" : "在右侧审核"}</b></div>;
}

export function TurnView({ turn, kinds, proposals, label, review, onOpenStudy, onRetry, onRefresh, onOpenWorkspace, onReview, showQuestion = true }: {
  turn: Turn; kinds: Map<string, string>; proposals: Map<string, AgentProposal>; label: Label;
  review: "aside" | ((proposal: AgentProposal) => ReactNode); onOpenStudy?: (studyId: string) => void; onRetry?: () => void;
  onRefresh?: () => void; onOpenWorkspace?: () => void; onReview?: () => void; showQuestion?: boolean;
}) {
  const evidence = turn.evidenceOnly ? turn.answer.slice(EVIDENCE_LABEL.length).trim() : turn.answer;
  const readableEvidence = readableAgentText(evidence, label, turn.refs);
  const pending = turn.proposals.some(id => proposals.get(id)?.status === 'pending');
  const state = turn.task?.state, reason = turn.task?.reason;
  const waiting = state === 'waiting' || state === 'reviewing', blocked = state === 'blocked', failed = state === 'failed';
  const status = turn.interrupted ? '对话连接已结束，任务以服务器记录为准。'
    : pending ? '请核对方案中的字段差异，再决定是否批准。'
      : waiting || blocked ? ({ missing_input: '请先在工作台补齐输入，再继续提问。', human_review: '等待你审核方案。', scope_confirmation: '请到工作台确认运行范围；Agent 不会代你提交。', external_job: '正在等待外部作业，可以更新任务状态。', budget: '本次任务预算已用尽，请核对已有过程后再安排后续任务。', capability: '当前步骤无法继续，请查看说明并在工作台处理。' } as Record<string, string>)[reason || ''] || '当前任务需要人工处理，请查看说明并在工作台处理。'
        : failed ? '本次任务未完成，已读取的内容仍保留。' : '';
  const refresh = turn.interrupted || reason === 'external_job';
  const retry = !turn.interrupted && !pending && !waiting && !blocked && (failed || !turn.answer && turn.notices.length > 0);
  return <section className="agent-turn">
    {showQuestion && <><div className="agent-question-meta"><span>你</span>{turn.started && <time dateTime={turn.started}>{formatDateTime(turn.started)}</time>}</div>
    <p className="agent-question">{turn.question}</p></>}
    <div className="agent-response-label"><Icon name="agent/agent" />Agent</div>
    <WorkSteps turn={turn} kinds={kinds} label={label} />
    {turn.proposals.map((id) => proposals.get(id)).filter((proposal): proposal is AgentProposal => !!proposal)
      .map((proposal) => <div key={proposal.id}>{review === "aside" ? <ProposalLine proposal={proposal} label={label} /> : review(proposal)}</div>)}
    {turn.previews.map((item) => <PreviewCard key={item.id} preview={item} label={label} proposalTitle={item.proposalId ? proposals.get(item.proposalId)?.title : undefined}
      onOpen={item.studyId && onOpenStudy ? () => onOpenStudy(item.studyId!) : undefined} />)}
    {turn.evidenceOnly && <p className="agent-evidence-tag"><Icon name="result/evidence" />证据摘要 · 模型的解释没有通过数值核对，下面只列工具结果</p>}
    {evidence && <AnswerText text={readableEvidence} />}
    {evidence && !turn.running && <CopyAnswer text={readableEvidence} />}
    {readableEvidence !== evidence && <details className="agent-notice-details"><summary>追溯 · 原文</summary><pre>{evidence}</pre></details>}
    {/* 回答里提到的对象：同一张名片，点了回到它的家（§2.3） */}
    {!turn.running && turn.refs.length > 0 && (turn.refs.length > 4
      ? <details className="agent-ref-details"><summary>相关对象 · {turn.refs.length} 项</summary><div className="agent-refs" aria-label="提到的对象">{turn.refs.map((card) => <ObjectChip key={card.kind + card.id} card={card} />)}</div></details>
      : <div className="agent-refs" aria-label="提到的对象">{turn.refs.map((card) => <ObjectChip key={card.kind + card.id} card={card} />)}</div>)}
    {turn.notices.map((notice, index) => {
      const technical = /reasoning_content|request_id|模型服务拒绝了请求（HTTP/.test(notice.text);
      return <div key={index}>
        <p className="agent-notice" role="alert"><Icon name="status/warning" />{technical ? '模型服务拒绝了请求，请稍后重试。技术详情可供管理员排查。' : notice.text}</p>
        {technical && <details className="agent-notice-details"><summary>技术详情</summary><pre>{notice.text}</pre></details>}
      </div>;
    })}
    {!turn.running && status && <div className="agent-next-step" role="status" data-task-state={turn.interrupted ? 'interrupted' : state}>
      <p>{status}</p>
      {pending && onReview ? <Button size="compact" variant="outline" onClick={onReview}>查看待审核方案</Button>
        : refresh && onRefresh ? <Button size="compact" variant="outline" onClick={onRefresh}>更新任务状态</Button>
          : (waiting || blocked) && onOpenWorkspace ? <Button size="compact" variant="outline" onClick={onOpenWorkspace}>在工作台处理</Button> : null}
    </div>}
    {onRetry && !turn.running && retry && <Button size="compact" variant="outline" className="agent-retry" onClick={onRetry}><Icon name="agent/retry" />重试这次提问</Button>}
  </section>;
}
