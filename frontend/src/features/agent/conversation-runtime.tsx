import { createContext, useContext, useMemo, type ReactNode } from 'react';
import {
  AssistantRuntimeProvider, MessagePrimitive, ThreadPrimitive, useAuiState, useExternalStoreRuntime,
  type ThreadMessageLike,
} from '@assistant-ui/react';
import { formatDateTime } from '@/lib/format';
import type { Turn } from './transcript';

const ReceiptContext = createContext<(turn: Turn) => ReactNode>(() => null);

/** assistant-ui is a view of the host's audit record, never a second model or tool executor. */
export function AgentConversationProvider({ children, turns, loading, sending, canSend, onSend, onStop }: {
  children: ReactNode; turns: Turn[]; loading: boolean; sending: boolean; canSend: boolean;
  onSend: (text: string) => Promise<void>; onStop: () => void;
}) {
  const messages = useMemo<ThreadMessageLike[]>(() => turns.flatMap(turn => [
    { id: `${turn.id}/user`, role: 'user', ...(turn.started ? { createdAt: new Date(turn.started) } : {}), content: [{ type: 'text', text: turn.question }] },
    {
      id: `${turn.id}/assistant`, role: 'assistant',
      // The presentation tool contains only the existing audit receipt. There is no frontend tool invocation adapter.
      content: [{ type: 'tool-call', toolCallId: `${turn.id}/receipt`, toolName: 'platform_turn_receipt', args: {}, argsText: '', result: turn }],
      status: turn.running ? { type: 'running' }
        : turn.interrupted ? { type: 'incomplete', reason: 'cancelled' }
          : turn.task?.state === 'failed' ? { type: 'incomplete', reason: 'error' }
            : { type: 'complete', reason: 'stop' },
    },
  ]), [turns]);
  const runtime = useExternalStoreRuntime({
    messages, convertMessage: message => message, isRunning: sending, isLoading: loading, isSendDisabled: !canSend || sending,
    onNew: async message => { await onSend(message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n')); },
    onCancel: async () => { onStop(); },
  });
  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}

function Receipt({ result }: { result?: unknown }) {
  const render = useContext(ReceiptContext);
  return result && typeof result === 'object' && 'question' in result ? render(result as Turn) : null;
}

function Message() {
  const role = useAuiState(state => state.message.role);
  const created = useAuiState(state => state.message.createdAt);
  return <MessagePrimitive.Root className={`agent-message is-${role}`}>
    {role === 'user'
      ? <><div className="agent-question-meta"><span>你</span>{created && <time dateTime={created.toISOString()}>{formatDateTime(created.toISOString())}</time>}</div>
        <MessagePrimitive.Parts components={{ Text: ({ text }) => <p className="agent-question">{text}</p> }} /></>
      : <MessagePrimitive.Parts components={{ tools: { by_name: { platform_turn_receipt: Receipt } } }} />}
  </MessagePrimitive.Root>;
}

export function AgentConversationMessages({ renderTurn }: { renderTurn: (turn: Turn) => ReactNode }) {
  return <ReceiptContext.Provider value={renderTurn}><ThreadPrimitive.Messages>{() => <Message />}</ThreadPrimitive.Messages></ReceiptContext.Provider>;
}
