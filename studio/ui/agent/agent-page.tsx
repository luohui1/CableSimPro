// Agent mode: one conversation page. The conversations on the left in the kit's frame, the thread in the middle. Everything the agent
// does appears in the thread as steps and cards, and every card can take its object to the workbench.
import { AssistantRuntimeProvider } from '@assistant-ui/react';
import { Button } from '@/components/ui/button';
import { ChatNotice } from '@/kit/chat/empty';
import { AppFrame } from '@/kit/frame';
import { Icon } from '@/kit/icon';
import { useStatus } from '@/state/queries';
import { useAgentRuntime } from './runtime';
import { Thread } from './thread';
import { ConversationList } from './thread-list';

export function AgentPage({ sessionId }: { sessionId?: string }) {
  const runtime = useAgentRuntime(sessionId);
  const status = useStatus();
  const agent = status.data?.agent;
  // What stops the Agent from working: the host cannot be reached (with a way to ask again), or no model is configured.
  const notice = status.isError
    ? <ChatNotice tone="error">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="min-w-0 flex-1">{status.error.message}</span>
        <Button variant="outline" size="sm" onClick={() => void status.refetch()}><Icon name="agent/retry" data-icon="inline-start" />重试</Button>
      </div>
    </ChatNotice>
    : agent && !agent.configured ? <ChatNotice>模型未配置，Agent 暂时不能干活：{agent.hint}</ChatNotice> : undefined;
  return <AssistantRuntimeProvider runtime={runtime}>
    {/* The shell above holds the top bar; the frame here is the sidebar and the sheet. */}
    <AppFrame top={null} side={<ConversationList />}>
      <Thread notice={notice} />
    </AppFrame>
  </AssistantRuntimeProvider>;
}
