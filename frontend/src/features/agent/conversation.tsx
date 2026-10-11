import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { ObjectChip } from "@/components/object-link";
import { significantNumber, formatDateTime } from "@/lib/format";
import { EVIDENCE_LABEL, type Preview, type SavedRun, type Step, type Turn } from "./transcript";
import type { AgentProposal } from "./agent-api";
import "./agent.css";

/* Agent 对话组件（来自组件陈列的“中栏 · 对话 / 右栏 · 审核”）：
   提问气泡 · 工作过程（收起一行、展开每步）· 回答 · 试算卡 · 改动审核（按住批准）· 输入栏。 */

type Label = (entity: string) => string;
/** 方案前后值：去掉浮点噪声，前后按同样的小数位显示（1.0 → 1.2）。 */
const decimals = (value: unknown) => (typeof value === "number" ? (String(Number(value.toPrecision(10))).split(".")[1] || "").length : 0);
const show = (value: unknown, places = decimals(value)) => (value === null || value === undefined ? "—" : typeof value === "number" ? Number(value.toPrecision(10)).toFixed(Math.min(places, 6)) : typeof value === "object" ? JSON.stringify(value) : String(value));
const seconds = (ms: number) => (ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60_000)} 分 ${Math.round((ms % 60_000) / 1000)} 秒`);

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, index) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={index}>{part.slice(2, -2)}</strong>
      : part.startsWith("`") && part.endsWith("`") ? <code key={index}>{part.slice(1, -1)}</code> : part);
}

/** 回答正文：段落、列表、表格、加粗；不解析 HTML。 */
export function AnswerText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [], items: { ordered: boolean; text: string }[] = [], rows: string[][] = [];
  const flush = () => {
    if (paragraph.length) blocks.push(<p key={blocks.length}>{paragraph.flatMap((line, index) => index ? [<br key={index} />, ...inline(line)] : inline(line))}</p>);
    if (items.length) {
      const children = items.map((item, index) => <li key={index}>{inline(item.text)}</li>);
      blocks.push(items[0].ordered ? <ol key={blocks.length}>{children}</ol> : <ul key={blocks.length}>{children}</ul>);
    }
    if (rows.length) {
      const [head, ...body] = rows;
      blocks.push(<div key={blocks.length} className="agent-answer-table"><table><thead><tr>{head.map((cell, index) => <th key={index}>{inline(cell)}</th>)}</tr></thead>
        <tbody>{body.map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column}>{inline(cell)}</td>)}</tr>)}</tbody></table></div>);
    }
    paragraph = []; items = []; rows = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (/^\s*\|.*\|\s*$/.test(line)) {
      if (paragraph.length || items.length) { const kept = rows; rows = []; flush(); rows = kept; }
      if (!/^\s*\|?[\s:|-]+\|?\s*$/.test(line)) rows.push(line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()));
      continue;
    }
    if (rows.length) flush();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line), numbered = /^\s*\d+[.、)]\s*(.*)$/.exec(line), heading = /^#{1,4}\s+(.*)$/.exec(line);
    if (!line.trim()) flush();
    else if (bullet || numbered) {
      if (paragraph.length) { const kept = items; items = []; flush(); items = kept; }
      items.push({ ordered: !!numbered, text: (bullet || numbered)![1] });
    } else if (heading) { flush(); blocks.push(<p key={blocks.length} className="agent-answer-heading">{inline(heading[1])}</p>); }
    else { if (items.length) flush(); paragraph.push(line); }
  }
  flush();
  return <div className="agent-answer">{blocks}</div>;
}

/** 工作中的点阵（3×3 由中心向外涟漪）；完成或失败换成对应图标。 */
export function WorkingMark({ state }: { state: "working" | "done" | "error" }) {
  if (state === "done") return <Icon name="agent/approve" className="agent-mark is-done" />;
  if (state === "error") return <Icon name="status/warning" className="agent-mark is-error" />;
  return <span className="agent-lattice" aria-hidden="true">{Array.from({ length: 9 }, (_, index) => <span key={index} />)}</span>;
}

function useElapsed(turn: Turn) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!turn.running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [turn.running]);
  const start = turn.started ? Date.parse(turn.started) : now;
  const end = turn.running ? now : turn.finished ? Date.parse(turn.finished) : now;
  return Math.max(0, end - start);
}

const stepIcon = (step: Step, kinds: Map<string, string>) =>
  step.tool === "answer-check" ? "result/evidence" : ({ read: "agent/step-read", propose: "agent/proposal", run: "agent/step-run" } as Record<string, string>)[kinds.get(step.tool) || "read"] || "agent/step-read";

/** 工作过程：进行中展开并显示当前步骤；完成后收成“已完成 N 步，用时 …”。 */
export function WorkSteps({ turn, kinds }: { turn: Turn; kinds: Map<string, string> }) {
  const elapsed = useElapsed(turn);
  const [open, setOpen] = useState(false);
  const steps = turn.steps;
  if (!steps.length && !turn.running) return null;
  const current = [...steps].reverse().find((step) => step.status === "running");
  const failed = !turn.running && steps.some((step) => step.status === "error" && step.tool !== "answer-check");
  const expanded = open || (turn.running && steps.length > 0);
  return <div className={`agent-steps ${expanded ? "is-open" : ""}`}>
    <button type="button" className="agent-steps-head" aria-expanded={expanded} onClick={() => setOpen((value) => !value)} disabled={turn.running}>
      <WorkingMark state={turn.running ? "working" : failed ? "error" : "done"} />
      <span>{turn.running ? (current ? `正在${current.title}` : "正在思考") : `已完成 ${steps.length} 步，用时`}</span>
      <time>{seconds(elapsed)}</time>
      {!turn.running && <Icon name="action/chevron-down" className="agent-steps-chevron" />}
    </button>
    {expanded && <ol className="agent-step-list">{steps.map((step) => <li key={step.id} className={`agent-step is-${step.status}`}>
      <Icon name={stepIcon(step, kinds)} />
      <b>{step.title}</b>
      {step.summary && <span>{step.summary}</span>}
      <time>{step.status === "running" ? "…" : step.ms !== undefined ? seconds(step.ms) : ""}</time>
    </li>)}</ol>}
  </div>;
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
  useEffect(() => stop, []);
  return <button type="button" className="agent-hold" data-holding={holding || undefined} disabled={disabled || loading}
    onPointerDown={event => { if (event.button === 0) start(); }} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop} onBlur={stop}
    onKeyDown={(event) => { if (event.key === 'Escape') { stop(); return; } if ((event.key === " " || event.key === "Enter") && !event.repeat) { event.preventDefault(); start(); } }}
    onKeyUp={(event) => { if (event.key === " " || event.key === "Enter") stop(); }}>
    <span>{loading ? "正在保存" : children}</span>
  </button>;
}

/** 改动审核：字段级前后值；只有人能批准，批准走工作台同一保存路径。 */
export function ProposalCard({ proposal, onDecide, busy, error, receipt }: { proposal: AgentProposal; onDecide: (id: string, decision: "approve" | "reject") => void; busy?: boolean; error?: string; receipt?: { created: string; actor?: string; status: string } }) {
  return <article className={`agent-review-card is-${proposal.status}`}>
    <header><Icon name="agent/proposal" /><b>{proposal.title}</b><span>{proposal.status === "approved" ? "已批准" : proposal.status === "rejected" ? "已拒绝" : `待审核 · ${proposal.changes.length} 项`}</span></header>
    {proposal.base_revision != null && <p className="agent-card-meta">基于第 {proposal.base_revision} 修订</p>}
    {receipt && receipt.status === proposal.status && <p className="agent-card-meta">{receipt.actor ? `${receipt.actor} · ` : ''}{formatDateTime(receipt.created)} · {receipt.status === 'approved' ? '已保存输入，工程结果尚未批准' : '已拒绝方案'}</p>}
    <div className="agent-diff">{proposal.changes.map((change) => {
      const places = Math.max(decimals(change.before), decimals(change.after));
      return <div key={change.path} className="agent-diff-hunk">
        <div className="agent-diff-label">{change.label}</div>
        <div className="agent-diff-line is-removed"><span aria-hidden="true">−</span>{show(change.before, places)}{change.unit && ` ${change.unit}`}</div>
        <div className="agent-diff-line is-added"><span aria-hidden="true">+</span>{show(change.after, places)}{change.unit && ` ${change.unit}`}</div>
      </div>;
    })}</div>
    {!!proposal.checks?.length && <ul className="agent-review-checks">{proposal.checks.map((check) => <li key={check}>{check}</li>)}</ul>}
    {error && <p className="agent-notice" role="alert">{error}</p>}
    {proposal.status === "pending" && <div className="agent-review-actions">
      <HoldButton loading={busy} onConfirm={() => onDecide(proposal.id, "approve")}>按住批准 {proposal.changes.length} 项改动</HoldButton>
      <Button size="compact" variant="ghost" disabled={busy} onClick={() => onDecide(proposal.id, "reject")}>拒绝</Button>
    </div>}
  </article>;
}

/** 方案在对话里只留一行引用，审核在右栏完成（工作台属性栏这种窄位置则直接内嵌审核卡）。 */
function ProposalLine({ proposal }: { proposal: AgentProposal }) {
  return <div className={`agent-proposal-line is-${proposal.status}`}><Icon name="agent/branch" /><span>方案：{proposal.title}</span>
    <b>{proposal.status === "approved" ? "已批准" : proposal.status === "rejected" ? "已拒绝" : "在右侧审核"}</b></div>;
}

export function TurnView({ turn, kinds, proposals, label, review, onOpenStudy, onRetry }: {
  turn: Turn; kinds: Map<string, string>; proposals: Map<string, AgentProposal>; label: Label;
  review: "aside" | ((proposal: AgentProposal) => ReactNode); onOpenStudy?: (studyId: string) => void; onRetry?: () => void;
}) {
  const evidence = turn.evidenceOnly ? turn.answer.slice(EVIDENCE_LABEL.length).trim() : turn.answer;
  return <section className="agent-turn">
    <p className="agent-question">{turn.question}</p>
    <WorkSteps turn={turn} kinds={kinds} />
    {turn.proposals.map((id) => proposals.get(id)).filter((proposal): proposal is AgentProposal => !!proposal)
      .map((proposal) => <div key={proposal.id}>{review === "aside" ? <ProposalLine proposal={proposal} /> : review(proposal)}</div>)}
    {turn.previews.map((item) => <PreviewCard key={item.id} preview={item} label={label} proposalTitle={item.proposalId ? proposals.get(item.proposalId)?.title : undefined}
      onOpen={item.studyId && onOpenStudy ? () => onOpenStudy(item.studyId!) : undefined} />)}
    {turn.evidenceOnly && <p className="agent-evidence-tag"><Icon name="result/evidence" />证据摘要 · 模型的解释没有通过数值核对，下面只列工具结果</p>}
    {evidence && <AnswerText text={evidence} />}
    {/* 回答里提到的对象：同一张名片，点了回到它的家（§2.3） */}
    {!turn.running && turn.refs.length > 0 && <div className="agent-refs" aria-label="提到的对象">{turn.refs.map((card) => <ObjectChip key={card.kind + card.id} card={card} />)}</div>}
    {turn.notices.map((notice, index) => <p key={index} className="agent-notice" role="alert"><Icon name="status/warning" />{notice.text}</p>)}
    {onRetry && !turn.running && !turn.answer && turn.notices.length > 0 && <Button size="compact" variant="outline" className="agent-retry" onClick={onRetry}><Icon name="agent/retry" />重新发送</Button>}
  </section>;
}
