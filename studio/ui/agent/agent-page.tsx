// Agent mode: one conversation page. Conversations on the left, the thread in the middle. Everything the agent does appears in the
// thread as steps and cards, and every card can take the object to the workbench.
import { AssistantRuntimeProvider } from '@assistant-ui/react';
import { Thread } from '@/components/assistant-ui/elements/thread.aui';
import { ThreadList } from '@/components/assistant-ui/elements/thread-list.aui';
import { StepPart } from './cards/step';
import { useAgentRuntime } from './runtime';
import { useStatus } from '@/state/queries';

function Welcome() {
  const status = useStatus();
  const agent = status.data?.agent;
  return <div className="mb-6 flex flex-col gap-1 px-1">
    <h1 className="m-0 text-xl font-semibold">想让我做点什么？</h1>
    {agent && !agent.configured && <p role="alert" className="text-attention m-0 text-sm">模型未配置，Agent 暂时不能干活：{agent.hint}</p>}
  </div>;
}

export function AgentPage({ sessionId }: { sessionId?: string }) {
  const runtime = useAgentRuntime(sessionId);
  return <AssistantRuntimeProvider runtime={runtime}>
    <div className="flex h-full min-h-0">
      <aside className="bg-sidebar flex w-64 shrink-0 flex-col gap-1 border-e p-3 max-md:hidden" aria-label="对话">
        <ThreadList />
      </aside>
      <main className="min-w-0 flex-1" aria-label="Agent 对话">
        <Thread welcome={<Welcome />} step={StepPart} />
      </main>
    </div>
  </AssistantRuntimeProvider>;
}
