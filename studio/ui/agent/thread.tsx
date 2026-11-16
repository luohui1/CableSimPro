// The conversation, put together from assistant-ui's primitives, which hold the behaviour (scrolling, the composer, suggestions, copy and
// retry, the attachments), and the kit's parts, which hold the look. Nothing here is styled: what the agent did arrives as steps and
// cards (steps.tsx), what it wrote as Markdown (markdown.tsx).
import {
  ActionBarPrimitive, AttachmentPrimitive, AuiIf, ComposerPrimitive, ErrorPrimitive, MessagePrimitive, SuggestionPrimitive, ThreadPrimitive,
  groupPartByType, useAui, useAuiState, type AssistantState,
} from '@assistant-ui/react';
import { useEffect, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AgentEmpty, ChatNotice, TaskStarter } from '@/kit/chat/empty';
import { ComposerAttach, ComposerBar, ComposerFrame, ComposerSend, ComposerStop, FileChip, composerInputClass } from '@/kit/chat/composer';
import { AssistantMessage, ThreadColumn, Typing, UserMessage, threadViewportClass } from '@/kit/chat/messages';
import { Icon } from '@/kit/icon';
import { MarkdownText } from './markdown';
import { ALL_STARTERS, STARTERS } from './starters';
import { StepGroup } from './steps';

// A thread with nothing in it yet shows the welcome and the starting tasks; a thread that is still fetching its history shows neither.
const isNewChatView = (state: AssistantState) => state.thread.messages.length === 0 && (!state.thread.isLoading || state.threads.isLoading);
const isHistoryLoadingView = (state: AssistantState) => state.thread.messages.length === 0 && state.thread.isLoading && !state.threads.isLoading;

export function Thread({ notice }: { notice?: ReactNode }) {
  const empty = useAuiState(isNewChatView);
  return <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
    {empty
      ? <div className="flex min-h-0 flex-1 flex-col justify-center overflow-y-auto py-12">
        <AgentEmpty title="今天要处理哪款电缆？" lead="导入结构表、按国标核对、算载流量、出规格书和计算书——交给我做，改动由你审。"
          notice={notice} composer={<Composer />}
          groups={STARTERS.map(group => ({ label: group.label, icon: group.icon, tasks: <Starters first={ALL_STARTERS.indexOf(group.tasks[0])} count={group.tasks.length} /> }))} />
      </div>
      : <>
        {/* A new turn starts at the top of the page; a conversation that is opened shows its latest turn from its start. */}
        <ThreadPrimitive.Viewport turnAnchor="top" scrollToBottomOnInitialize={false} scrollToBottomOnThreadSwitch={false} className={threadViewportClass}>
          <OpenAtLatestTurn />
          <ThreadColumn className="pb-6">
            <AuiIf condition={isHistoryLoadingView}><p role="status" className="m-0 py-10 text-center text-sm text-ink-2">正在打开对话…</p></AuiIf>
            <ThreadPrimitive.Messages>{() => <ThreadMessage />}</ThreadPrimitive.Messages>
          </ThreadColumn>
        </ThreadPrimitive.Viewport>
        <div className="shrink-0 pb-4">
          {/* The button for the latest sits above the composer on a narrow page and beside it, in the free space, where the page is wide. */}
          <ThreadColumn className="relative">
            <ThreadPrimitive.ScrollToBottom render={<Button variant="outline" size="icon" aria-label="回到最新"
              className="absolute -top-12 left-1/2 z-10 -translate-x-1/2 rounded-full shadow-menu disabled:invisible xl:top-auto xl:bottom-1 xl:left-full xl:ml-3 xl:translate-x-0" />}>
              <Icon name="action/arrow-down" />
            </ThreadPrimitive.ScrollToBottom>
            <Composer />
          </ThreadColumn>
        </div>
      </>}
  </ThreadPrimitive.Root>;
}

/** A conversation that is opened shows its latest turn from the person's words on, not its last lines with a card cut off at the top.
 *  Each message carries its own space above it, so the turn that sits at the top of the page still has air above its first line. */
function OpenAtLatestTurn() {
  const loaded = useAuiState(state => state.thread.messages.length > 0 && !state.thread.isLoading);
  useEffect(() => {
    if (!loaded) return;
    const turns = document.querySelectorAll('[data-turn="user"]');
    turns[turns.length - 1]?.scrollIntoView({ block: 'start' });
  }, [loaded]);
  return null;
}

// ---- The empty page ----

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

// ---- The composer ----

function Composer() {
  return <ComposerPrimitive.Root>
    <ComposerPrimitive.AttachmentDropzone render={<ComposerFrame />}>
      <div className="flex w-full flex-row flex-wrap items-center gap-2 px-1 empty:hidden">
        <ComposerPrimitive.Attachments>{() => <ComposerChip />}</ComposerPrimitive.Attachments>
      </div>
      <ComposerPrimitive.Input className={composerInputClass} placeholder="交办一件事，或把 Excel、CSV 结构表拖到这里" rows={1} autoFocus enterKeyHint="send" aria-label="给 Agent 的消息" />
      <ComposerBar
        start={<ComposerPrimitive.AddAttachment render={<ComposerAttach />} />}
        end={<>
          <AuiIf condition={state => state.thread.isRunning && state.thread.capabilities.cancel}><ComposerPrimitive.Cancel render={<ComposerStop />} /></AuiIf>
          <ComposerPrimitive.Send render={<ComposerSend title="发送；任务进行中发送会在当前一步做完后插话" />} />
        </>} />
    </ComposerPrimitive.AttachmentDropzone>
  </ComposerPrimitive.Root>;
}

/** A table waiting to be sent with the message: uploaded when the message goes, removable until then. */
function ComposerChip() {
  const aui = useAui();
  const name = useAuiState(state => state.attachment.name);
  const status = useAuiState(state => state.attachment.status.type);
  return <AttachmentPrimitive.Root render={<span className="inline-flex" />}>
    <FileChip name={name} state={status === 'running' ? 'uploading' : status === 'incomplete' ? 'error' : 'done'} onRemove={() => aui.attachment().remove()} />
  </AttachmentPrimitive.Root>;
}

// ---- Messages ----

function ThreadMessage() {
  const role = useAuiState(state => state.message.role);
  return role === 'user' ? <PersonMessage /> : <AgentMessage />;
}

function PersonMessage() {
  // A message sent while the agent was busy waits for the current step; say so, so it is not mistaken for ignored.
  const queued = useAuiState(state => Boolean(state.message.metadata.custom?.queued));
  const hasFiles = useAuiState(state => (state.message.attachments?.length ?? 0) > 0);
  return <MessagePrimitive.Root data-turn="user" className="pt-8">
    <UserMessage attachments={hasFiles ? <MessagePrimitive.Attachments>{() => <SentChip />}</MessagePrimitive.Attachments> : undefined}>
      <MessagePrimitive.Parts />
      {queued && <Badge variant="outline">排队中，当前一步做完后处理</Badge>}
    </UserMessage>
  </MessagePrimitive.Root>;
}

function SentChip() {
  const name = useAuiState(state => state.attachment.name);
  return <AttachmentPrimitive.Root render={<span className="inline-flex" />}><FileChip name={name} /></AttachmentPrimitive.Root>;
}

function AgentMessage() {
  return <MessagePrimitive.Root className="pt-8">
    <AssistantMessage>
      {/* Adjacent tool calls are one stretch of work: one line for them, then their proposals and cards. */}
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
