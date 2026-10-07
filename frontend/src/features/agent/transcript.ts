import type { AgentEvent, AgentProposal, AgentRecord } from "./agent-api";

/** 对话按“轮”组织：一句提问 → 工作步骤 → 回答，附带这一轮产生的方案与试算。 */
export type Step = { id: string; tool: string; title: string; status: "running" | "ok" | "error"; summary?: string; ms?: number };
export type Headline = { title: string; entity?: string; value: number; unit: string };
export type Ampacity = { entity: string; basis: string; value: number | null; reason?: string };
export type Preview = { id: string; studyId?: string; proposalId?: string; headlines: Headline[]; ampacity: Ampacity[] };
export type SavedRun = { id: string; studyId: string; sequence?: number; created?: string; headlines: Headline[] };
export type Notice = { code?: string; text: string };
export type Turn = {
  id: string; question: string; steps: Step[]; answer: string; evidenceOnly: boolean;
  notices: Notice[]; proposals: string[]; previews: Preview[]; runs: SavedRun[]; started?: string; finished?: string; running: boolean;
};

const CHECK = "answer-check";
export const EVIDENCE_LABEL = "以下为工具证据摘要，模型解释未通过核验。";
/** 回答核验退回重写属于工作过程，不当作故障提示。 */
const isCheckCode = (code?: string) => !!code && /^(UNGROUNDED|UNSUPPORTED)_/.test(code);

const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

function checkStep(turn: Turn, status: Step["status"], summary: string) {
  const existing = turn.steps.find((step) => step.id === CHECK);
  if (existing) Object.assign(existing, { status, summary });
  else turn.steps.push({ id: CHECK, tool: CHECK, title: "核对回答里的数值", status, summary });
}

/** 宿主给出的结论量值（显示单位优先）。 */
const headlines = (value: unknown): Headline[] => list(value).map(record).flatMap((row) => {
  const amount = number(row.display_value) ?? number(row.value);
  return amount === null ? [] : [{ title: String(row.title || row.key), entity: row.entity ? String(row.entity) : undefined, value: amount, unit: String(row.display_unit || row.unit || "") }];
});

/** Agent 读过的保存运行：只收有结论量值的。 */
const savedRuns = (data: Record<string, unknown>): SavedRun[] => list(data.items).map(record)
  .map((row) => ({ id: String(row.id), studyId: String(row.study), sequence: number(row.sequence) ?? undefined, created: row.created ? String(row.created) : undefined, headlines: headlines(row.headlines) }))
  .filter((row) => row.headlines.length > 0);

/** 试算结果：宿主给出的结论量值，加上各回路允许电流（单独额定 / 同时额定）。 */
function preview(id: string, data: Record<string, unknown>, args: Record<string, unknown>): Preview {
  const ampacity = list(data.cases).map(record).flatMap((item) => list(item.results).map(record))
    .filter((row) => row.key === "ampacity")
    .map((row) => ({ entity: String(row.entity), basis: String(row.case), value: number(row.value), reason: record(row.reason).message ? String(record(row.reason).message) : undefined }));
  return { id, studyId: args.study_id ? String(args.study_id) : undefined, proposalId: data.proposal_id ? String(data.proposal_id) : undefined, headlines: headlines(data.headlines), ampacity };
}

/** 从会话审计记录还原对话；数值只取自已保存的工具结果。 */
export function buildTurns(source: AgentRecord): Turn[] {
  const steps = new Map(source.steps.map((step) => [step.node_id, step]));
  const turns: Turn[] = [];
  let turn: Turn | undefined;
  for (const event of source.events) {
    const data = event.data;
    if (event.type === "chat.message" && data.role === "user") {
      turn = { id: String(event.sequence), question: String(data.content || ""), steps: [], answer: "", evidenceOnly: false, notices: [], proposals: [], previews: [], runs: [], started: event.created, running: true };
      turns.push(turn);
      continue;
    }
    if (!turn) continue;
    if (event.type === "chat.message" && data.role === "assistant" && typeof data.content === "string") {
      turn.answer = data.content;
      turn.evidenceOnly = data.content.startsWith(EVIDENCE_LABEL);
    } else if (event.type === "tool.call") {
      turn.steps.push({ id: String(data.id), tool: String(data.tool), title: String(data.title || data.tool), status: "running" });
    } else if (event.type === "tool.result") {
      const step = turn.steps.find((item) => item.id === data.id), saved = steps.get(String(data.id));
      if (step) Object.assign(step, { status: data.status === "ok" ? "ok" : "error", summary: String(data.summary || ""), ms: saved?.elapsed_ms ?? undefined });
      const result = record(saved?.result?.data), proposal = record(result.proposal);
      if (proposal.id && !turn.proposals.includes(String(proposal.id))) turn.proposals.push(String(proposal.id));
      if (saved?.tool === "study_preview" && saved.result?.status === "ok") turn.previews.push(preview(String(data.id), result, record(saved.arguments)));
      if (saved?.tool === "run_list" && saved.result?.status === "ok") turn.runs.push(...savedRuns(result).filter((run) => !turn!.runs.some((item) => item.id === run.id)));
    } else if (event.type === "answer.rejected") {
      checkStep(turn, "error", `${list(data.issues).length} 处数值对不上证据，退回重写`);
    } else if (event.type === "answer.accepted") {
      checkStep(turn, "ok", "数值都来自工具结果");
    } else if (event.type === "answer.fallback") {
      checkStep(turn, "error", "改用工具证据摘要");
    } else if (event.type === "error" && !isCheckCode(data.code as string)) {
      turn.notices.push({ code: data.code as string | undefined, text: String(data.message || "") });
    } else if (event.type === "done") {
      turn.finished = event.created;
      turn.running = false;
    }
  }
  return turns;
}

/** 流式事件逐个并入正在进行的一轮；结束后以审计记录为准重建。 */
export function applyEvent(turn: Turn, event: AgentEvent, proposals: Map<string, AgentProposal>): Turn {
  const next = { ...turn, steps: turn.steps.map((step) => ({ ...step })), notices: [...turn.notices], proposals: [...turn.proposals] };
  if (event.type === "message.delta") {
    next.answer += event.text;
    next.evidenceOnly = next.answer.startsWith(EVIDENCE_LABEL);
  } else if (event.type === "tool.call") next.steps.push({ id: event.id, tool: event.tool, title: event.title || event.tool, status: "running" });
  else if (event.type === "tool.result") {
    const step = next.steps.find((item) => item.id === event.id);
    if (step) Object.assign(step, { status: event.status, summary: event.summary });
  } else if (event.type === "proposal.created") {
    proposals.set(event.id, { id: event.id, title: event.title, changes: event.changes, checks: event.checks, status: "pending" });
    if (!next.proposals.includes(event.id)) next.proposals.push(event.id);
  } else if (event.type === "error") {
    if (isCheckCode(event.code)) checkStep(next, "running", "数值对不上证据，正在重写");
    else next.notices.push({ code: event.code, text: event.message });
  } else if (event.type === "done") next.running = false;
  return next;
}

export const newTurn = (question: string): Turn => ({ id: `live-${Date.now()}`, question, steps: [], answer: "", evidenceOnly: false, notices: [], proposals: [], previews: [], runs: [], started: new Date().toISOString(), running: true });
