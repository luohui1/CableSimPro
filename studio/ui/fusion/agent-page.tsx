// The Agent page as the old platform shows it: the conversation list on the left, the thread beside it, on the one white ground of the
// platform's own content panel. The platform's sidebar and top bar are around this frame; nothing here repeats them.
import { AssistantRuntimeProvider } from '@assistant-ui/react';
import { Button } from '@/components/ui/button';
import { ChatNotice } from '@/kit/chat/empty';
import { Icon } from '@/kit/icon';
import { useStatus } from '@/state/queries';
import { ConversationList } from '../agent/thread-list';
import { useAgentRuntime } from './runtime';
import { Thread } from './thread';

export function AgentPage({ sessionId }: { sessionId?: string }) {
  const runtime = useAgentRuntime(sessionId);
  const status = useStatus();
  const agent = status.data?.agent;
  // What stops the Agent from working: the sidecar cannot be reached (with a way to ask again), or no model is configured.
  const notice = status.isError
    ? <ChatNotice tone="error">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="min-w-0 flex-1">{status.error.message}</span>
        <Button variant="outline" size="sm" onClick={() => void status.refetch()}><Icon name="agent/retry" data-icon="inline-start" />重试</Button>
      </div>
    </ChatNotice>
    : agent && !agent.configured ? <ChatNotice>Agent 暂时不能用：{agent.hint}</ChatNotice> : undefined;
  return <AssistantRuntimeProvider runtime={runtime}>
    <div className="flex h-dvh min-h-0 bg-surface text-ink">
      <aside className="flex w-64 shrink-0 flex-col border-r border-line pt-3"><ConversationList /></aside>
      <main className="relative flex min-w-0 flex-1 flex-col"><Thread notice={notice} /></main>
    </div>
  </AssistantRuntimeProvider>;
}
