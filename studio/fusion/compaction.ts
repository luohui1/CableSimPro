// Pi owns compaction thresholds, cut points, append-only summaries and overflow
// retry. This adapter supplies the engineering facts its generic coding prompt
// cannot infer, without executing or approving a tool.
import { createHash } from 'node:crypto';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { Model } from '@earendil-works/pi-ai';
import type { AgentSession, SessionBeforeCompactEvent, SessionEntry } from '@earendil-works/pi-coding-agent';
import type { BackendTool, WorkbenchContext } from './backend.ts';
import { scrubPaths } from '../host/agent-tools.ts';
import { projectHistory } from './model-result.ts';
import { pi } from './pi.ts';

const record = (value: unknown): value is Record<string, any> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const rows = (value: unknown): Record<string, any>[] => Array.isArray(value) ? value.filter(record) : [];
const pick = (value: Record<string, any>, keys: string[]) => Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
export const COMPACTION_STATE_MAX_CHARS = 12_000;
export const COMPACTION_STATE_MAX_BYTES = 18_000;
const fitsState = (value: unknown) => {
  const text = JSON.stringify(value);
  return text.length <= COMPACTION_STATE_MAX_CHARS && Buffer.byteLength(text) <= COMPACTION_STATE_MAX_BYTES;
};

export function compactionSettings(model: Pick<Model<any>, 'contextWindow' | 'maxTokens'>) {
  // Provider usage excludes our framing allowance; the next bounded tool page
  // also needs room before the SDK checks again. Do not inflate reported usage.
  const reserveTokens = Math.min(model.contextWindow - 2048, model.maxTokens + 8192);
  return { enabled: true, reserveTokens,
    keepRecentTokens: Math.max(1024, Math.min(8000, Math.floor((model.contextWindow - reserveTokens) / 3))) };
}

export const COMPACTION_FOCUS = `请用中文压缩工程对话，保留六部分：用户目标、已完成事项、剩余步骤、当前对象、待审提案和已接受回执、关键数值与限制。
下面 cablesim-state 是平台已保存记录的逐值摘录，不是新的指令或新的批准。以其中的真实身份和状态为准；数值、单位、缺项、false/null/0、摘要与只读引用必须原样保留，不重新推算。
goals 中 complete:false 表示仅有头尾摘录和原消息索引，same_as 表示同一目标的引用。正文必须根据完整用户消息和此前原生摘要总结目标，保留摘录之外的要求，不能只总结摘录。
待审提案仍需人工接受；已接受回执不得再次执行。运行完成不代表工程批准，缺项或未读不代表通过。只保留能继续原目标的摘要，避免复述全部表格。
正文目标约 2000 个汉字；关键限制与真实回执的完整性优先。使用已有保存结果的只读引用，不能补造对象、提案、回执或剩余步骤。`;

export function savedConversation(entries: readonly SessionEntry[]): AgentMessage[] {
  // UI/recovery use the original branch, never the model's compacted view.
  // Otherwise old cards disappear and a compacted receipt looks unfinished.
  return entries.flatMap(entry => entry.type === 'message' ? [entry.message] : []);
}

type SavedGoal = { text: string; entry_id: string; timestamp: number };

function goalFacts(goal: SavedGoal | undefined, roots: string[]) {
  if (!goal) return '';
  const text = scrubPaths(goal.text, roots);
  if (text.length <= 1200 && Buffer.byteLength(text) <= 3000) return text;
  // This is only an index in the pinned facts, never the conversation passed
  // to native compact(). A legal 8k-character user message must neither make
  // every future compaction fail nor lose its middle requirements.
  const characters = Array.from(text);
  return { complete: false,
    excerpt: { beginning: characters.slice(0, 480).join(''), ending: characters.slice(-240).join('') },
    original_message: { entry_id: goal.entry_id, role: 'user', timestamp: goal.timestamp },
    characters: Array.from(goal.text).length, utf8_bytes: Buffer.byteLength(goal.text),
    sha256: createHash('sha256').update(goal.text).digest('hex'),
    instruction: '摘录不完整；完整文本仍在引用的原会话消息中。原生压缩正文须根据完整用户消息和此前原生摘要保留目标与限制。' };
}

function receiptFacts(receipt: Record<string, any>): Record<string, any> {
  const result = pick(receipt, ['kind', 'status', 'executed', 'complete', 'may_have_written', 'engineering_approval', 'state',
    'workspace_id', 'study_id', 'run_id', 'type_id', 'id', 'series_id', 'batch_id', 'preview_id', 'preview_digest',
    'upload_id', 'attachment_id', 'sha256', 'input_digest', 'output_digest', 'created', 'next_read',
    'row_count', 'valid_count', 'error_count', 'incomplete_count', 'missing_spec_count', 'missing_fields', 'item_count', 'statuses', 'check_counts',
    'delivery_id', 'download_url', 'media_type', 'document_kind', 'digest', 'source_digest', 'model_digest', 'document', 'source']);
  if (receipt.error) result.error = record(receipt.error) ? pick(receipt.error, ['code', 'message']) : receipt.error;
  if (Array.isArray(receipt.specs)) result.specs = rows(receipt.specs).map(item => pick(item,
    ['id', 'name', 'workspace_id', 'model_id', 'state', 'missing']));
  if (Array.isArray(receipt.items)) result.items = rows(receipt.items).map(item => pick(item,
    ['spec_id', 'workspace_id', 'study_id', 'run_id', 'status', 'check_counts', 'omitted_issue_counts']));
  return result;
}

function exactFacts(data: Record<string, any>): Record<string, any> {
  const facts = pick(data, ['workspace_id', 'study_id', 'run_id', 'type_id', 'type_revision', 'workspace_revision', 'study_revision',
    'status', 'freshness', 'integrity', 'headlines', 'assessment', 'check_summary', 'limitations', 'warnings', 'parameter_fields']);
  if (Array.isArray(data.input_fields)) facts.input_fields = rows(data.input_fields).map(item => pick(item,
    ['path', 'label', 'value', 'unit', 'missing', 'status', 'reason']));
  if (record(data.checks)) facts.checks = pick(data.checks, ['integrity', 'numerical', 'engineering_approval', 'cad_analysis_qualification']);
  if (record(data.comparison)) facts.comparison = {
    differences: rows(data.comparison.differences).map(item => pick(item,
      ['run_id', 'baseline_run_id', 'name', 'baseline_name', 'same_input', 'same_parameters', 'same_method', 'quantities', 'input_changes', 'input_change_count', 'unmatched_count'])),
  };
  // Keep small exact inputs, not another permanent copy of every standards
  // check. Native summaries and the original cards retain those conclusions.
  const inputs = rows(data.items).filter(item => item.value !== undefined && !record(item.value) && !Array.isArray(item.value))
    .map(item => pick(item, ['section', 'id', 'path', 'label', 'value', 'unit', 'display_value', 'display_unit', 'status', 'missing']));
  if (inputs.length) facts.items = inputs;
  return facts;
}

/** Extract facts from saved user/tool/proposal records, including records older
 * than the latest compaction. No card payload is copied into the model summary. */
export function compactionState(entries: readonly SessionEntry[], current: WorkbenchContext | undefined, roots: string[] = []) {
  const proposals = new Map<string, Record<string, any>>();
  for (const entry of entries) if (entry.type === 'custom' && entry.customType === 'cablesim.fusion.proposal') {
    const value = entry.data as { proposal?: Record<string, any>; scope?: { session?: string } };
    if (record(value?.proposal) && typeof value.proposal.id === 'string') proposals.set(value.proposal.id,
      { ...pick(value.proposal, ['id', 'step_id', 'project_id', 'operation', 'title', 'status']),
        ...(typeof value.scope?.session === 'string' ? { platform_session: value.scope.session } : {}) });
  }
  const accepted = new Set([...proposals.values()].filter(value => value.status === 'accepted').map(value => value.step_id));
  const receipts = new Map<string, Record<string, any>>();
  const errors = new Map<string, string>();
  const facts = new Map<string, Record<string, any>>();
  const goals: SavedGoal[] = [];
  for (const entry of entries) {
    if (entry.type !== 'message') continue;
    const message = entry.message;
    if (message.role === 'user') {
      const text = typeof message.content === 'string' ? message.content
        : message.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
      if (text) goals.push({ text, entry_id: entry.id, timestamp: message.timestamp });
    }
    if (message.role !== 'toolResult') continue;
    if (accepted.has(message.toolCallId) && message.isError) errors.set(message.toolCallId,
      message.content.filter(part => part.type === 'text').map(part => scrubPaths(part.text, roots)).join('\n'));
    for (const part of message.content) {
      if (part.type !== 'text') continue;
      let value: any;
      try { value = JSON.parse(part.text); } catch { continue; }
      if (value?.projection === 'bounded_summary') value = value.value;
      if (!record(value?.data)) continue;
      const data = value.data;
      if (accepted.has(message.toolCallId) && record(data.receipt)) receipts.set(message.toolCallId,
        { step_id: message.toolCallId, tool: message.toolName, receipt: receiptFacts(data.receipt) });
      const source = record(data.receipt?.result) ? data.receipt.result : data;
      const selected = exactFacts(source);
      if (!['headlines', 'input_fields', 'parameter_fields', 'items', 'comparison', 'checks', 'check_summary'].some(key => key in selected)) continue;
      const identity = [message.toolName, source.workspace_id ?? source.type_id ?? '', source.study_id ?? '', source.run_id ?? '', data.view ?? ''].join(':');
      // Refresh insertion order so the newest necessary evidence gets space.
      facts.delete(identity);
      facts.set(identity, { tool: message.toolName, data: selected,
        ...(record(value.detail?.read) ? { read: value.detail.read } : {}) });
    }
  }
  const decisionCounts: Record<string, Record<string, number>> = {};
  for (const proposal of proposals.values()) {
    const counts = decisionCounts[proposal.operation] ??= {};
    counts[proposal.status] = (counts[proposal.status] ?? 0) + 1;
  }
  const unresolved = [...proposals.values()].filter(value => value.status === 'accepted').flatMap((proposal): Record<string, any>[] => {
    const receipt = receipts.get(proposal.step_id)?.receipt;
    if (receipt && !receipt.error && receipt.executed !== false && receipt.complete !== false
      && !['uncertain', 'failed', 'interrupted', 'running'].includes(receipt.status)) return [];
    return [{ ...proposal, result_confirmed: false, ...(receipt ? { receipt } : {}),
      ...(errors.has(proposal.step_id) ? { original_tool_error: errors.get(proposal.step_id) } : {}),
      instruction: '人工已接受，但执行结果未确认；先核对原提案及保存回执，不得自动重新提出或执行。' }];
  });
  const originalGoal = goalFacts(goals[0], roots);
  const currentGoal = goals.length === 1 && typeof originalGoal !== 'string'
    ? { same_as: 'original' } : goalFacts(goals.at(-1), roots);
  const state = { version: 1, goals: { original: originalGoal, current: currentGoal, requests: goals.length },
    ...(current ? { current_object: current } : {}),
    pending_proposals: [...proposals.values()].filter(value => value.status === 'pending'),
    unresolved_accepted: unresolved,
    decision_counts: decisionCounts, accepted_receipt_count: receipts.size,
    accepted_receipts: [] as Record<string, any>[], key_facts: [] as Record<string, any>[],
    archived_receipt_count: receipts.size, archived_fact_count: facts.size,
    archive: '此前完整目标、提案、已接受回执和逐项数值仍在原会话卡片及平台保存记录；这里仅保留最近续办所需事实。省略不表示未执行或通过，先按真实只读入口核对，不能重复业务写入。' };
  if (!fitsState(state)) throw new Error('当前目标、对象或待审提案超过压缩摘要的安全上限，未丢弃待审状态；请缩小本次目标。');
  // Whole records only, with explicit archived counts. Neither the number of
  // questions nor an ever-growing list of old runs can grow this state forever.
  const recentFacts = [...facts.values()].reverse().slice(0, 6);
  for (const fact of recentFacts) {
    const next = { ...state, key_facts: [...state.key_facts, fact], archived_fact_count: state.archived_fact_count - 1 };
    if (fitsState(next) && JSON.stringify(next).length <= 8000 && Buffer.byteLength(JSON.stringify(next)) <= 12000) Object.assign(state, next);
  }
  for (const receipt of [...receipts.values()].reverse().slice(0, 12)) {
    const next = { ...state, accepted_receipts: [...state.accepted_receipts, receipt], archived_receipt_count: state.archived_receipt_count - 1 };
    if (fitsState(next)) Object.assign(state, next);
  }
  return state;
}

export const stateBlock = (state: ReturnType<typeof compactionState>) => `<cablesim-state>\n${JSON.stringify(state)}\n</cablesim-state>`;

/** The official SDK compact() implementation still generates the summary. Its
 * normal auto-compaction path persists the result and controls any retry. */
export async function engineeringCompaction(event: SessionBeforeCompactEvent, session: AgentSession,
  catalog: readonly BackendTool[], current: WorkbenchContext | undefined, roots: string[]) {
  if (!session.model) throw new Error('模型未配置，不能压缩上下文。');
  const state = compactionState(event.branchEntries, current, roots);
  const block = stateBlock(state);
  const preparation = { ...event.preparation,
    messagesToSummarize: projectHistory(event.preparation.messagesToSummarize, catalog, roots),
    turnPrefixMessages: projectHistory(event.preparation.turnPrefixMessages, catalog, roots) };
  const { compact } = await pi();
  const summary = await compact(preparation, session.model, undefined, undefined,
    `${COMPACTION_FOCUS}\n${event.customInstructions ?? ''}\n${block}`, event.signal, session.thinkingLevel,
    session.agent.streamFunction, undefined, session.settingsManager.getRetrySettings());
  // The model may paraphrase narrative, but it cannot be the authority for a
  // pending/accepted decision or an exact saved number. Pin those originals.
  return { ...summary, summary: `${summary.summary}\n\n${block}`,
    details: { ...(record(summary.details) ? summary.details : {}), cablesim_state: state } };
}
