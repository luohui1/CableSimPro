// The Agent page as the old platform shows it: the conversation list on the left, the thread beside it, on the one white ground of the
// platform's own content panel. The platform's sidebar and top bar are around this frame; nothing here repeats them.
import { AssistantRuntimeProvider, ThreadListPrimitive } from '@assistant-ui/react';
import { Button } from '@/components/ui/button';
import { ChatNotice } from '@/kit/chat/empty';
import { Icon } from '@/kit/icon';
import { useStatus } from '@/state/queries';
import { ConversationList } from '../agent/thread-list';
import { useAgentRuntime } from './runtime';
import { Thread } from './thread';
import { useOpen } from './open';

export function AgentPage({ sessionId }: { sessionId?: string }) {
  const runtime = useAgentRuntime(sessionId);
  const status = useStatus();
  const open = useOpen();
  const agent = status.data?.agent;
  const compact = new URLSearchParams(window.location.search).get('compact') === '1';
  // What stops the Agent from working: the sidecar cannot be reached (with a way to ask again), or no model is configured.
  const notice = status.isError
    ? <ChatNotice tone="error">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="min-w-0 flex-1">{status.error.message}</span>
        <Button variant="outline" size="sm" onClick={() => void status.refetch()}><Icon name="agent/retry" data-icon="inline-start" />重试</Button>
      </div>
    </ChatNotice>
    : agent && !agent.configured ? <ChatNotice><div className="flex flex-wrap items-center gap-2"><span>Agent 暂时不能用：{agent.hint}</span>
      <Button variant="outline" size="sm" onClick={() => open('cablesim:settings/model')}>打开模型设置</Button></div></ChatNotice> : undefined;
  return <AssistantRuntimeProvider runtime={runtime}>
    <div className="flex h-dvh min-h-0 bg-surface text-ink">
      {!compact && <aside className="flex w-52 shrink-0 flex-col border-r border-line pt-3 xl:w-64"><ConversationList /></aside>}
      <main className="relative flex min-w-0 flex-1 flex-col">
        {compact && <div className="flex shrink-0 justify-end border-b border-line px-3 py-2">
          <ThreadListPrimitive.New render={<Button variant="ghost" size="sm" />}><Icon name="action/add" data-icon="inline-start" />新对话</ThreadListPrimitive.New>
        </div>}
        <Thread notice={notice} compact={compact} />
      </main>
    </div>
  </AssistantRuntimeProvider>;
}
