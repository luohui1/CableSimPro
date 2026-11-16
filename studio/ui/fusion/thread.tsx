// The conversation, put together from assistant-ui's primitives, which hold the behaviour (scrolling, the composer, suggestions, copy and
// retry), and the kit's parts, which hold the look. Nothing here is styled: what the agent did arrives as steps and cards (steps.tsx), what
// it wrote as Markdown (the Cable Studio page's own renderer). Same page as Cable Studio's, without the structure-table attachments.
import {
  ActionBarPrimitive, AuiIf, ComposerPrimitive, ErrorPrimitive, MessagePrimitive, SuggestionPrimitive, ThreadPrimitive,
  groupPartByType, useAuiState, type AssistantState,
} from '@assistant-ui/react';
import { useEffect, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AgentEmpty, ChatNotice, TaskStarter } from '@/kit/chat/empty';
import { ComposerBar, ComposerFrame, ComposerSend, ComposerStop, composerInputClass } from '@/kit/chat/composer';
import { AssistantMessage, ThreadColumn, Typing, UserMessage, threadViewportClass } from '@/kit/chat/messages';
import { Icon } from '@/kit/icon';
import { MarkdownText } from '../agent/markdown';
import { ALL_STARTERS, STARTERS } from './starters';
import { StepGroup } from './steps';

// A thread with nothing in it yet shows the welcome and the starting tasks; a thread that is still fetching its history shows neither.
const isNewChatView = (state: AssistantState) => state.thread.messages.length === 0 && (!state.thread.isLoading || state.threads.isLoading);
const isHistoryLoadingView = (state: AssistantState) => state.thread.messages.length === 0 && state.thread.isLoading && !state.threads.isLoading;

export function Thread({ notice }: { notice?: ReactNode }) {
  const empty = useAuiState(isNewChatView);
  return <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
    {empty
      ? <div className="flex min-h-0 flex-1 flex-col overflow-y-auto py-8">
        <AgentEmpty title="想看哪项结果？" lead="读工程里已保存的研究结论、运行记录和库里的电缆型号——你问，我只读、不改，每个数都来自保存的记录。" notice={notice}
          composer={<Composer />}
          groups={STARTERS.map(group => ({ label: group.label, icon: group.icon,
            tasks: <Starters first={ALL_STARTERS.indexOf(group.tasks[0])} count={group.tasks.length} /> }))} />
      </div>
      : <>
        {/* A new turn starts at the top of the page, and a conversation that is opened shows its latest turn from the person's words on,
            nothing cut off above. */}
        <ThreadPrimitive.Viewport turnAnchor="top" scrollToBottomOnInitialize={false} scrollToBottomOnThreadSwitch={false} className={threadViewportClass}>
          <OpenAtLatestTurn />
          <ThreadColumn className="pb-6">
            <AuiIf condition={isHistoryLoadingView}><p role="status" className="m-0 py-10 text-center text-sm text-ink-2">正在打开对话…</p></AuiIf>
            <ThreadPrimitive.Messages>{() => <ThreadMessage />}</ThreadPrimitive.Messages>
          </ThreadColumn>
        </ThreadPrimitive.Viewport>
        <div className="shrink-0 pb-4">
          <ThreadColumn className="relative gap-3">
            {notice}
            <ThreadPrimitive.ScrollToBottom render={<Button variant="outline" size="icon" aria-label="回到最新"
              className="absolute -top-12 left-1/2 z-10 -translate-x-1/2 rounded-full shadow-menu disabled:invisible xl:top-auto xl:bottom-1 xl:left-full xl:ml-3 xl:translate-x-0" />}>
              <Icon name="action/arrow-down" />
            </ThreadPrimitive.ScrollToBottom>
            <Composer placeholder="接着问，或追问这条结果" />
          </ThreadColumn>
        </div>
      </>}
  </ThreadPrimitive.Root>;
}

/** A conversation that is opened shows its latest turn from the person's words on. The history arrives after the page is mounted, so
 *  this waits for it. */
function OpenAtLatestTurn() {
  const loaded = useAuiState(state => state.thread.messages.length > 0 && !state.thread.isLoading);
  useEffect(() => {
    if (!loaded) return;
    const turns = document.querySelectorAll('[data-turn-start]');
    turns[turns.length - 1]?.scrollIntoView({ block: 'start' });
  }, [loaded]);
  return null;
}

/** The starting tasks of one group, each a task starter that sends its prompt when clicked. */
function Starters({ first, count }: { first: number; count: number }) {
  return <>{Array.from({ length: count }, (_, offset) => <ThreadPrimitive.SuggestionByIndex key={first + offset} index={first + offset} components={{ Suggestion: Starter }} />)}</>;
}

function Starter() {
  const title = useAuiState(state => state.suggestion.title);
  const task = ALL_STARTERS.find(item => item.title === title);
  if (!task) return null;
  return <SuggestionPrimitive.Trigger send render={<TaskStarter icon={task.icon} title={task.title} result={task.result} />} />;
}

function Composer({ placeholder = '问一项研究的结论，或一款电缆的结构' }: { placeholder?: string }) {
  return <ComposerPrimitive.Root>
    <ComposerFrame>
      <ComposerPrimitive.Input className={composerInputClass} placeholder={placeholder} rows={1} autoFocus enterKeyHint="send" aria-label="给 Agent 的消息" />
      <ComposerBar
        end={<>
          <AuiIf condition={state => state.thread.isRunning && state.thread.capabilities.cancel}><ComposerPrimitive.Cancel render={<ComposerStop />} /></AuiIf>
          <ComposerPrimitive.Send render={<ComposerSend title="发送；任务进行中发送会在当前一步做完后插话" />} />
        </>} />
    </ComposerFrame>
  </ComposerPrimitive.Root>;
}

function ThreadMessage() {
  const role = useAuiState(state => state.message.role);
  return role === 'user' ? <PersonMessage /> : <AgentMessage />;
}

function PersonMessage() {
  // A message sent while the agent was busy waits for the current step; say so, so it is not mistaken for ignored.
  const queued = useAuiState(state => Boolean(state.message.metadata.custom?.queued));
  return <MessagePrimitive.Root data-turn-start className="pt-8">
    <UserMessage>
      <MessagePrimitive.Parts />
      {queued && <Badge variant="outline">排队中，当前一步做完后处理</Badge>}
    </UserMessage>
  </MessagePrimitive.Root>;
}

function AgentMessage() {
  return <MessagePrimitive.Root className="pt-8">
    <AssistantMessage>
      {/* Adjacent tool calls are one stretch of work: one line for them, then their cards. */}
      <MessagePrimitive.GroupedParts groupBy={groupPartByType({ 'tool-call': ['group-steps'] })}>
        {({ part }) => {
          switch (part.type) {
            case 'group-steps': return <StepGroup indices={part.indices} />;
            case 'text': return <MarkdownText />;
            case 'tool-call': return <></>;
            case 'indicator': return <Typing />;
            default: return null;
          }
        }}
      </MessagePrimitive.GroupedParts>
      <MessagePrimitive.Error><ChatNotice tone="error"><ErrorPrimitive.Message /></ChatNotice></MessagePrimitive.Error>
      <ActionBarPrimitive.Root hideWhenRunning autohide="not-last" className="-ml-2 flex gap-1">
        <ActionBarPrimitive.Copy render={<Button variant="ghost" size="icon-sm" aria-label="复制" title="复制" />}>
          <AuiIf condition={state => state.message.isCopied}><Icon name="action/check" /></AuiIf>
          <AuiIf condition={state => !state.message.isCopied}><Icon name="action/copy" /></AuiIf>
        </ActionBarPrimitive.Copy>
        {/* Only an answer that broke off (an error, a stop) can be asked again; a good one is not offered a second draw. */}
        <AuiIf condition={state => state.message.status?.type === 'incomplete'}>
          <ActionBarPrimitive.Reload render={<Button variant="ghost" size="icon-sm" aria-label="重试" title="重试：再发一遍上一个请求" />}><Icon name="agent/retry" /></ActionBarPrimitive.Reload>
        </AuiIf>
      </ActionBarPrimitive.Root>
    </AssistantMessage>
  </MessagePrimitive.Root>;
}
