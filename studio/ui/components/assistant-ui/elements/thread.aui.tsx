"use client";

// assistant-ui's registry Thread, cut down to what Cable Studio uses: text and tool steps, attachments, steering while a run
// goes on, a stop control. Voice, branching, editing and reasoning are not part of this product and were removed.
import {
  ComposerAddAttachment,
  ComposerAttachments,
  UserMessageAttachments,
} from "@/components/assistant-ui/elements/attachment.aui";
import { MarkdownText } from "@/components/assistant-ui/elements/markdown-text";
import { TooltipIconButton } from "@/components/assistant-ui/elements/tooltip-icon-button";
import { cn } from "@/lib/utils";
import {
  ActionBarPrimitive,
  AuiIf,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  SuggestionPrimitive,
  ThreadPrimitive,
  useAuiState,
  type AssistantState,
  type ToolCallMessagePartComponent,
} from "@assistant-ui/react";
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, CopyIcon, SquareIcon, TriangleAlertIcon } from "lucide-react";
import type { FC, ReactNode } from "react";

// A thread with nothing in it yet shows the welcome and the starting tasks.
const isNewChatView = (s: AssistantState) =>
  s.thread.messages.length === 0 && (!s.thread.isLoading || s.threads.isLoading);

// A switched thread that is still fetching its history shows nothing rather than the welcome.
const isHistoryLoadingView = (s: AssistantState) =>
  s.thread.messages.length === 0 && s.thread.isLoading && !s.threads.isLoading;

/** Parts follow each other as they come: text, then the steps the agent took, then text. No grouping, no "N tool calls" folds. */
const inOrder = () => [] as const;

export const Thread: FC<{ welcome: ReactNode; step: ToolCallMessagePartComponent }> = ({ welcome, step }) => {
  const isEmpty = useAuiState(isNewChatView);
  return (
    <ThreadPrimitive.Root
      className="aui-root bg-background @container flex h-full flex-col"
      style={{ ["--thread-max-width" as string]: "46rem" }}
    >
      <ThreadPrimitive.Viewport
        data-slot="aui_thread-viewport"
        className="relative flex flex-1 flex-col overflow-x-auto overflow-y-scroll scroll-smooth"
      >
        <div className={cn("mx-auto flex w-full max-w-(--thread-max-width) flex-1 flex-col px-5 pt-6", isEmpty && "justify-center")}>
          <AuiIf condition={isNewChatView}>{welcome}</AuiIf>
          <AuiIf condition={isHistoryLoadingView}>
            <p role="status" className="text-muted-foreground py-10 text-center text-sm">正在打开对话…</p>
          </AuiIf>
          <div data-slot="aui_message-group" className="mb-10 flex flex-col gap-7 empty:hidden">
            <ThreadPrimitive.Messages>
              {() => <ThreadMessage step={step} />}
            </ThreadPrimitive.Messages>
          </div>
          <ThreadPrimitive.ViewportFooter
            className={cn("bg-background flex flex-col gap-4 overflow-visible pb-5", !isEmpty && "sticky bottom-0 mt-auto")}
          >
            <ThreadPrimitive.ScrollToBottom
              render={
                <TooltipIconButton
                  tooltip="回到最新"
                  variant="outline"
                  className="absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible"
                />
              }
            >
              <ArrowDownIcon />
            </ThreadPrimitive.ScrollToBottom>
            <Composer />
            <AuiIf condition={(s) => isNewChatView(s) && s.composer.isEmpty}>
              <Suggestions />
            </AuiIf>
          </ThreadPrimitive.ViewportFooter>
        </div>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
};

const ThreadMessage: FC<{ step: ToolCallMessagePartComponent }> = ({ step }) => {
  const role = useAuiState((s) => s.message.role);
  return role === "user" ? <UserMessage /> : <AssistantMessage step={step} />;
};

const Suggestions: FC = () => (
  <div className="grid w-full grid-cols-1 gap-2 @xl:grid-cols-2">
    <ThreadPrimitive.Suggestions>{() => <SuggestionCard />}</ThreadPrimitive.Suggestions>
  </div>
);

const SuggestionCard: FC = () => (
  <SuggestionPrimitive.Trigger
    send
    render={
      <button
        type="button"
        className="hover:bg-muted focus-visible:ring-ring/50 border-border bg-background flex h-full flex-col items-start gap-1 rounded-xl border px-4 py-3 text-start text-sm transition-colors outline-none focus-visible:ring-2"
      />
    }
  >
    <SuggestionPrimitive.Title className="text-foreground font-medium" />
    <SuggestionPrimitive.Description className="text-muted-foreground empty:hidden" />
  </SuggestionPrimitive.Trigger>
);

const Composer: FC = () => (
  <ComposerPrimitive.Root className="relative flex w-full flex-col">
    <ComposerPrimitive.AttachmentDropzone
      render={
        <div
          data-slot="aui_composer-shell"
          className="border-border focus-within:border-foreground/30 data-[dragging=true]:border-ring bg-background flex w-full cursor-text flex-col gap-2 rounded-3xl border p-2 shadow-sm transition-[border-color] data-[dragging=true]:border-dashed data-[dragging=true]:bg-muted"
        />
      }
    >
      <ComposerAttachments />
      <ComposerPrimitive.Input
        placeholder="交办一件事，或把 Excel、CSV 结构表拖到这里"
        className="placeholder:text-muted-foreground max-h-48 min-h-10 w-full resize-none bg-transparent px-3 py-1.5 text-sm leading-6 outline-none"
        rows={1}
        autoFocus
        enterKeyHint="send"
        aria-label="给 Agent 的消息"
      />
      <div className="relative flex items-center justify-between">
        <ComposerAddAttachment />
        <div className="flex items-center gap-1.5">
          <AuiIf condition={(s) => s.thread.isRunning && s.thread.capabilities.cancel}>
            <ComposerPrimitive.Cancel
              render={
                <TooltipIconButton tooltip="停止" side="bottom" type="button" variant="outline" size="icon" className="size-8 rounded-full" aria-label="停止" />
              }
            >
              <SquareIcon className="size-3.5 fill-current" />
            </ComposerPrimitive.Cancel>
          </AuiIf>
          <ComposerPrimitive.Send
            render={
              <TooltipIconButton
                tooltip="发送；任务进行中发送会在当前一步做完后插话"
                side="bottom"
                type="button"
                variant="default"
                size="icon"
                className="size-8 rounded-full"
                aria-label="发送"
              />
            }
          >
            <ArrowUpIcon className="size-4" />
          </ComposerPrimitive.Send>
        </div>
      </div>
    </ComposerPrimitive.AttachmentDropzone>
  </ComposerPrimitive.Root>
);

const MessageError: FC = () => (
  <MessagePrimitive.Error>
    <ErrorPrimitive.Root className="border-destructive/40 bg-destructive/10 text-destructive mt-2 flex items-start gap-2 rounded-xl border p-3 text-sm">
      <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
      <ErrorPrimitive.Message className="min-w-0 flex-1" />
    </ErrorPrimitive.Root>
  </MessagePrimitive.Error>
);

const AssistantMessage: FC<{ step: ToolCallMessagePartComponent }> = ({ step: Step }) => (
  <MessagePrimitive.Root
    data-slot="aui_assistant-message-root"
    data-role="assistant"
    className="fade-in slide-in-from-bottom-1 animate-in relative duration-150"
  >
    <div data-slot="aui_assistant-message-content" className="text-foreground flex flex-col gap-3 leading-relaxed wrap-break-word">
      <MessagePrimitive.GroupedParts groupBy={inOrder}>
        {({ part }) => {
          switch (part.type) {
            case "text":
              return <MarkdownText />;
            case "tool-call":
              return part.toolUI ?? <Step {...part} />;
            case "indicator":
              return (
                <span data-slot="aui_assistant-message-indicator" className="text-muted-foreground animate-pulse font-sans" aria-label="Agent 正在处理">
                  {"●"}
                </span>
              );
            default:
              return null;
          }
        }}
      </MessagePrimitive.GroupedParts>
      <MessageError />
    </div>
    <ActionBarPrimitive.Root hideWhenRunning autohide="not-last" className="text-muted-foreground -ms-1 mt-1 flex gap-1">
      <ActionBarPrimitive.Copy render={<TooltipIconButton tooltip="复制" />}>
        <AuiIf condition={(s) => s.message.isCopied}>
          <CheckIcon />
        </AuiIf>
        <AuiIf condition={(s) => !s.message.isCopied}>
          <CopyIcon />
        </AuiIf>
      </ActionBarPrimitive.Copy>
    </ActionBarPrimitive.Root>
  </MessagePrimitive.Root>
);

const UserMessage: FC = () => {
  // A message sent while the agent was busy waits for the current step; say so, so it is not mistaken for ignored.
  const queued = useAuiState((s) => Boolean(s.message.metadata.custom?.queued));
  return (
  <MessagePrimitive.Root
    data-slot="aui_user-message-root"
    data-role="user"
    className="fade-in slide-in-from-bottom-1 animate-in grid auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 duration-150 [&:where(>*)]:col-start-2"
  >
    <UserMessageAttachments />
    <div className="relative col-start-2 flex min-w-0 flex-col items-end gap-1">
      <div className="bg-muted text-foreground rounded-2xl px-4 py-2 wrap-break-word empty:hidden">
        <MessagePrimitive.Parts />
      </div>
      {queued && <span className="text-muted-foreground text-sm">排队中，当前一步做完后处理</span>}
    </div>
  </MessagePrimitive.Root>
  );
};

