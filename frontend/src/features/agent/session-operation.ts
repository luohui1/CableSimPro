import type { AgentRecord } from './agent-api';

export type TurnOperation = {
  generation: number; sessionId?: string; question: string; boundary: number; liveId: string; accepted: boolean; uncertain?: boolean;
};
const TERMINAL = new Set(['waiting', 'reviewing', 'completed', 'blocked', 'failed', 'cancelled']);

export function submittedQuestionMatches(operation: TurnOperation, record: AgentRecord) {
  if (record.id !== operation.sessionId) return false;
  const question = [...record.events].reverse().find(event => event.type === 'chat.message' && event.data.role === 'user');
  return !!question && question.sequence > operation.boundary && question.data.content === operation.question;
}

/** A reply to an older read cannot stand in for this exact accepted question. */
export function savedTurnMatches(operation: TurnOperation, record: AgentRecord) {
  return !!(operation.accepted || operation.uncertain) && TERMINAL.has(record.state) && submittedQuestionMatches(operation, record);
}

/** Ownership is per send, including repeated identical questions in one session. */
export class AgentTurnOwner {
  private generation = 0;
  current: TurnOperation | null = null;

  begin(input: Omit<TurnOperation, 'generation' | 'accepted'>): TurnOperation {
    return this.current = { ...input, generation: ++this.generation, accepted: false };
  }
  owns(operation: TurnOperation) { return this.current === operation && operation.generation === this.generation; }
  reset() { this.current = null; this.generation++; }
  finish(operation: TurnOperation, record: AgentRecord) {
    if (!this.owns(operation) || !savedTurnMatches(operation, record)) return false;
    this.current = null;
    return true;
  }
}
