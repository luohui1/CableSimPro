// Agent mode: one conversation page. The conversations on the left in the kit's frame, the thread in the middle. Everything the agent
// does appears in the thread as steps and cards, and every card can take its object to the workbench.
import { AssistantRuntimeProvider } from '@assistant-ui/react';
import { AppFrame } from '@/kit/frame';
import { ChatNotice } from '@/kit/chat/empty';
import { useStatus } from '@/state/queries';
import { useAgentRuntime } from './runtime';
import { Thread } from './thread';
import { ConversationList } from './thread-list';

export function AgentPage({ sessionId }: { sessionId?: string }) {
  const runtime = useAgentRuntime(sessionId);
  const agent = useStatus().data?.agent;
  return <AssistantRuntimeProvider runtime={runtime}>
    {/* The shell above holds the top bar; the frame here is the sidebar and the sheet. */}
    <AppFrame top={null} side={<ConversationList />}>
      <Thread notice={agent && !agent.configured ? <ChatNotice>模型未配置，Agent 暂时不能干活：{agent.hint}</ChatNotice> : undefined} />
    </AppFrame>
  </AssistantRuntimeProvider>;
}
