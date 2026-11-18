// The conversation, put together from assistant-ui's primitives, which hold the behaviour (scrolling, the composer, suggestions, copy and
// retry, the attachments), and the kit's parts, which hold the look. Nothing here is styled: what the agent did arrives as steps and
// cards (steps.tsx), what it wrote as Markdown (markdown.tsx).
import {
  ActionBarPrimitive, AttachmentPrimitive, AuiIf, ComposerPrimitive, ErrorPrimitive, MessagePrimitive, SuggestionPrimitive, ThreadPrimitive,
  groupPartByType, useAui, useAuiState, type AssistantState,
} from '@assistant-ui/react';
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { Badge } from '@/components/ui/badge';
import { reportFailure } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { AgentEmpty, ChatNotice, TaskStarter } from '@/kit/chat/empty';
import { ComposerAttach, ComposerBar, ComposerFrame, ComposerSend, ComposerStop, FileChip, composerInputClass } from '@/kit/chat/composer';
import { AssistantMessage, ThreadColumn, Typing, UserMessage, threadViewportClass } from '@/kit/chat/messages';
import { Icon } from '@/kit/icon';
import { DropZone } from '@/kit/workbench/form';
import { useChat } from '@/state/queries';
import { RatingFacts, RatingFigure, TypeFacts, TypeFigure } from './empty-tiles';
import { MarkdownText } from './markdown';
import { ALL_STARTERS, STARTERS } from './starters';
import { StepGroup } from './steps';

// A thread with nothing in it yet shows the welcome and the starting tasks; a thread that is still fetching its history shows neither.
const isNewChatView = (state: AssistantState) => state.thread.messages.length === 0 && !state.thread.isLoading;
const isHistoryLoadingView = (state: AssistantState) => state.thread.messages.length === 0 && state.thread.isLoading;

export function Thread({ notice, sessionId }: { notice?: ReactNode; sessionId?: string }) {
  const empty = useAuiState(isNewChatView);
  const history = useChat(sessionId);
  const viewport = useRef<HTMLDivElement>(null);
  const waitingForHistory = Boolean(sessionId) && !history.data;
  const historyError = history.isError && <ChatNotice tone="error">
    <p className="m-0 font-medium">这段对话暂时无法读取</p>
    <p className="my-2 whitespace-pre-wrap wrap-anywhere">{history.error.message}</p>
    {history.data && <p className="my-2">当前保留上次读取的内容，请重试以确认最新状态。</p>}
    <Button variant="outline" size="sm" disabled={history.isFetching} onClick={() => void history.refetch()}>
      <Icon name="agent/retry" data-icon="inline-start" />{history.isFetching ? '正在重试…' : '重新读取对话'}
    </Button>
  </ChatNotice>;
  return <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
    {waitingForHistory
      ? <div className="min-h-0 flex-1 overflow-y-auto py-8"><ThreadColumn className="gap-3">
        {historyError || <p role="status" className="m-0 py-10 text-center text-sm text-ink-2">正在打开对话…</p>}
        {notice}
      </ThreadColumn></div>
      : empty
      ? <div className="flex min-h-0 flex-1 flex-col overflow-y-auto py-8">
        <AgentEmpty title="今天要处理哪款电缆？" lead="导入结构表、按国标核对、算载流量、出规格书和计算书——交给我做，改动由你审。" className="2xl:max-w-4xl"
          notice={historyError ? <div className="flex flex-col gap-3">{historyError}{notice}</div> : notice}
          composer={<div className="flex flex-col gap-2"><Composer /><ImportDrop /></div>}
          groups={STARTERS.map(group => ({ label: group.label, icon: group.icon, ...TILES[group.label],
            tasks: <Starters first={ALL_STARTERS.indexOf(group.tasks[0])} count={group.tasks.length} /> }))} />
      </div>
      : <>
        {/* A new turn starts at the top of the page, and a conversation that is opened shows its latest turn from the person's words on,
            nothing cut off above (the design's screen). */}
        <ThreadPrimitive.Viewport ref={viewport} turnAnchor="top" scrollToBottomOnInitialize={false} scrollToBottomOnThreadSwitch={false} className={threadViewportClass}>
          <OpenAtLatestTurn viewport={viewport} />
          <ThreadColumn className="pb-6">
            {historyError}
            <AuiIf condition={isHistoryLoadingView}><p role="status" className="m-0 py-10 text-center text-sm text-ink-2">正在打开对话…</p></AuiIf>
            <ThreadPrimitive.Messages>{() => <ThreadMessage />}</ThreadPrimitive.Messages>
          </ThreadColumn>
        </ThreadPrimitive.Viewport>
        <div className="shrink-0 pb-4">
          {/* The button for the latest sits above the composer on a narrow page and beside it, in the free space, where the page is wide. */}
          <ThreadColumn className="relative gap-3">
            {notice}
            <ThreadPrimitive.ScrollToBottom render={<Button variant="outline" size="icon" aria-label="回到最新"
              className="absolute -top-12 left-1/2 z-10 -translate-x-1/2 rounded-full shadow-menu disabled:invisible xl:top-auto xl:bottom-1 xl:left-full xl:ml-3 xl:translate-x-0" />}>
              <Icon name="action/arrow-down" />
            </ThreadPrimitive.ScrollToBottom>
            <Composer placeholder="接着交办，或追问这条结果" />
          </ThreadColumn>
        </div>
      </>}
  </ThreadPrimitive.Root>;
}

/** A conversation that is opened shows its latest turn from the person's words on: the ask, then what came of it, nothing cut off above.
 *  The history arrives after the page is mounted, so this waits for it; each message carries its own space above it, so the turn at the
 *  top of the page still has air above its first line. */
function OpenAtLatestTurn({ viewport }: { viewport: RefObject<HTMLDivElement | null> }) {
  const loaded = useAuiState(state => state.thread.messages.length > 0 && !state.thread.isLoading);
  const threadId = useAuiState(state => state.threads.mainThreadId);
  useEffect(() => {
    const node = viewport.current;
    if (!loaded || !node) return;
    const turns = node.querySelectorAll<HTMLElement>('[data-turn-start]');
    const last = turns[turns.length - 1];
    // Only this thread scrolls: other embedded conversations and the outer page keep their positions.
    if (last) node.scrollTop = Math.max(0, node.scrollTop + last.getBoundingClientRect().top - node.getBoundingClientRect().top);
  }, [loaded, threadId, viewport]);
  return null;
}

// ---- The empty page ----

/** For each job, its own drawing and what the library or the projects hold now. */
const TILES: Record<string, { figure: ReactNode; facts: ReactNode }> = {
  电缆型号: { figure: <TypeFigure />, facts: <TypeFacts /> },
  载流量计算: { figure: <RatingFigure />, facts: <RatingFacts /> },
};

/** The tables the composer's attachment adapter takes (runtime.ts), as react-dropzone wants them. */
const ATTACHABLE: Record<string, string[]> = {
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.ms-excel': ['.xls'],
  'text/csv': ['.csv'],
  'text/tab-separated-values': ['.tsv'],
};

/** A structure table dropped here goes into the composer, like one attached with the paperclip. */
function ImportDrop() {
  const aui = useAui();
  return <DropZone compact accept={ATTACHABLE} title="把厂家结构表拖到这里" formats="支持 .xlsx、.xls 和 .csv"
    onFiles={files => files.forEach(file => void Promise.resolve(aui.composer().addAttachment(file)).catch(reportFailure))}
    onRejected={names => reportFailure(new Error(`不能导入 ${names.join('、')}：一次拖一张 .xlsx、.xls、.csv 或 .tsv 表。`))} />;
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

// ---- The composer ----

function Composer({ placeholder = '交办一件事，或把 Excel、CSV 结构表拖到这里' }: { placeholder?: string }) {
  return <ComposerPrimitive.Root>
    <ComposerPrimitive.AttachmentDropzone render={<ComposerFrame />}>
      <div className="flex w-full flex-row flex-wrap items-center gap-2 px-1 empty:hidden">
        <ComposerPrimitive.Attachments>{() => <ComposerChip />}</ComposerPrimitive.Attachments>
      </div>
      <ComposerPrimitive.Input className={composerInputClass} placeholder={placeholder} rows={1} autoFocus enterKeyHint="send" aria-label="给 Agent 的消息" />
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
  return <MessagePrimitive.Root data-turn-start className="pt-8">
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
