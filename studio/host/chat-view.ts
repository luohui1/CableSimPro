// What the conversation page shows, written from what the session file holds: user messages, the agent's text and each tool
// call with its outcome. The same function serves a live run and a conversation reopened from disk, so the two cannot differ.
import type { CardRef, ChatAttachment, ChatMessage, ChatStep, Proposal } from '../shared/types.ts';

// The pieces of pi's message types this page reads. Other roles (summaries, custom entries) are not shown.
interface Block { type: string; text?: string; id?: string; name?: string; arguments?: Record<string, unknown> }
export interface PiMessage {
  role: string;
  content?: string | Block[];
  timestamp?: number;
  stopReason?: string;
  errorMessage?: string;
  toolCallId?: string;
  isError?: boolean;
  durationMs?: number;
  /** target: what the step acted on, in the engineer's words, kept with the result so a conversation opened later still names it. */
  details?: { card?: CardRef; notes?: string[]; target?: string };
}

export interface ViewInput {
  messages: readonly PiMessage[];
  /** The assistant message being written right now. */
  partial?: PiMessage;
  /** Messages the person sent while the agent was busy; they wait for it. */
  queued: readonly string[];
  running: boolean;
  /** Decided and pending proposals by the tool call they belong to. */
  proposals: ReadonlyMap<string, Proposal>;
  /** The operation's name and what it acts on, in the engineer's words. */
  describe(tool: string, args: Record<string, unknown>): { label: string; target?: string };
  /** A run that failed before the agent could answer (no model, no key, no network). */
  error?: string;
}

const ATTACHMENT = /\n*\[附件：([^\]\n（）]+)（upload (u-[0-9a-f]{8})）\]/g;

/** The note the page appends to a message that carries uploaded files; the model reads it, the person sees chips instead. */
export function attachmentNote(attachments: ChatAttachment[]): string {
  return attachments.map(item => `\n[附件：${item.file.replace(/[\]\n（）]/g, '_')}（upload ${item.upload}）]`).join('');
}

export function plainText(message: PiMessage): string {
  if (typeof message.content === 'string') return message.content;
  return (message.content ?? []).filter(block => block.type === 'text').map(block => block.text ?? '').join('');
}

export function splitAttachments(text: string): { text: string; attachments: ChatAttachment[] } {
  const attachments = [...text.matchAll(ATTACHMENT)].map(match => ({ file: match[1], upload: match[2] }));
  return { text: text.replace(ATTACHMENT, '').trim(), attachments };
}

const iso = (timestamp: number | undefined): string => new Date(timestamp ?? Date.now()).toISOString();

export function chatMessages(input: ViewInput): ChatMessage[] {
  const out: ChatMessage[] = [];
  const steps = new Map<string, ChatStep>();
  let group: ChatMessage | undefined;

  const assistant = (message: PiMessage, index: number): ChatMessage => {
    if (!group) {
      group = { id: `a${index}`, role: 'assistant', parts: [], created: iso(message.timestamp), status: 'done' };
      out.push(group);
    }
    return group;
  };

  const take = (message: PiMessage, index: number, streaming: boolean) => {
    const target = assistant(message, index);
    if (streaming) target.status = 'streaming';
    for (const block of typeof message.content === 'string' ? [] : message.content ?? []) {
      if (block.type === 'text' && block.text?.trim()) {
        target.parts.push({ type: 'text', text: block.text });
      } else if (block.type === 'toolCall' && block.id && block.name) {
        const args = block.arguments ?? {};
        const shown = input.describe(block.name, args);
        const step: ChatStep = { type: 'step', id: block.id, tool: block.name, label: shown.label, status: 'running', ...(shown.target ? { target: shown.target } : {}) };
        const proposal = input.proposals.get(block.id);
        if (proposal) step.proposal = proposal;
        steps.set(block.id, step);
        target.parts.push(step);
      }
    }
    if (message.stopReason === 'error') { target.status = 'error'; target.error = message.errorMessage ?? '模型调用失败。'; }
    if (message.stopReason === 'aborted') target.status = 'stopped';
  };

  input.messages.forEach((message, index) => {
    if (message.role === 'user') {
      group = undefined;
      const { text, attachments } = splitAttachments(plainText(message));
      out.push({ id: `u${index}`, role: 'user', parts: [{ type: 'text', text }], created: iso(message.timestamp), ...(attachments.length ? { attachments } : {}) });
    } else if (message.role === 'assistant') {
      take(message, index, false);
    } else if (message.role === 'toolResult' && message.toolCallId) {
      const step = steps.get(message.toolCallId);
      if (!step) return;
      const proposal = input.proposals.get(message.toolCallId);
      step.status = message.isError ? (proposal?.status === 'rejected' ? 'rejected' : 'failed') : 'done';
      if (message.isError) step.reason = proposal?.status === 'rejected' ? (proposal.note ? `工程师拒绝：${proposal.note}` : '工程师拒绝了这项改动') : plainText(message);
      if (message.durationMs !== undefined) step.duration_ms = message.durationMs;
      if (message.details?.target && !step.target) step.target = message.details.target;
      if (message.details?.card) step.card = message.details.card;
      if (message.details?.notes?.length) step.notes = message.details.notes;
    }
  });

  if (input.partial) take(input.partial, input.messages.length, true);

  // A call with no result is waiting for a decision, still running, or was cut off by a restart or a stop.
  for (const step of steps.values()) {
    if (step.status !== 'running') continue;
    if (step.proposal?.status === 'pending') step.status = 'waiting_review';
    else if (!input.running) step.status = 'interrupted';
  }
  const last = out.at(-1);
  if (input.running && last?.role === 'assistant' && last.status === 'done') last.status = 'streaming';
  if (input.running && last?.role !== 'assistant') {
    out.push({ id: `a${input.messages.length}`, role: 'assistant', parts: [], created: new Date().toISOString(), status: 'streaming' });
  }
  if (input.error) out.push({ id: `e${input.messages.length}`, role: 'assistant', parts: [], created: new Date().toISOString(), status: 'error', error: input.error });
  input.queued.forEach((text, index) => {
    const { text: clean, attachments } = splitAttachments(text);
    out.push({ id: `q${index}`, role: 'user', parts: [{ type: 'text', text: clean }], created: new Date().toISOString(), queued: true, ...(attachments.length ? { attachments } : {}) });
  });
  return out;
}

/** The conversation's name in the list: what was asked first. */
export function titleOf(firstMessage: string): string {
  const text = splitAttachments(firstMessage).text.replace(/\s+/g, ' ').trim();
  return text.length > 28 ? `${text.slice(0, 28)}…` : text || '新对话';
}
