"use client";

// assistant-ui's registry attachment parts, reduced to what structure tables need: a chip with the file name, a spinner while it
// uploads, a mark when it failed, and a remove button in the composer. Images are not accepted, so there is no preview.
import { TooltipIconButton } from "@/components/assistant-ui/elements/tooltip-icon-button";
import { cn } from "@/lib/utils";
import { AttachmentPrimitive, ComposerPrimitive, MessagePrimitive, useAui, useAuiState } from "@assistant-ui/react";
import { AlertCircleIcon, FileSpreadsheetIcon, Loader2Icon, PlusIcon, XIcon } from "lucide-react";
import type { FC } from "react";

const AttachmentChip: FC = () => {
  const aui = useAui();
  const isComposer = aui.attachment.source !== "message";
  const name = useAuiState((s) => s.attachment.name);
  // An attachment on a submission is still being prepared, whether or not the adapter reports progress.
  const state = useAuiState((s) =>
    s.attachment.status.type === "incomplete" && s.attachment.status.reason === "error"
      ? "error"
      : s.attachment.status.type === "running" || (s.optional.message?.submission !== undefined && s.attachment.status.type !== "complete")
        ? "uploading"
        : undefined,
  );
  const message = useAuiState((s) =>
    s.attachment.status.type === "incomplete" && s.attachment.status.reason === "error" ? (s.attachment.status.message ?? "上传失败") : undefined,
  );
  return (
    <AttachmentPrimitive.Root className={cn("relative", isComposer && "animate-in fade-in-0 duration-200")}>
      <div
        role="group"
        aria-label={`结构表 ${name}${state === "error" ? "，上传失败" : state === "uploading" ? "，正在上传" : ""}`}
        title={message}
        className={cn(
          "bg-muted text-foreground flex h-10 max-w-72 items-center gap-2 rounded-xl border px-3 text-sm",
          state === "error" && "border-destructive/60",
        )}
      >
        <FileSpreadsheetIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
        <span className="min-w-0 truncate">
          <AttachmentPrimitive.Name />
        </span>
        {state === "uploading" && <Loader2Icon className="text-muted-foreground size-4 shrink-0 animate-spin" aria-hidden />}
        {state === "error" && <AlertCircleIcon className="text-destructive size-4 shrink-0" aria-hidden />}
        {isComposer && (
          <AttachmentPrimitive.Remove
            render={<TooltipIconButton tooltip={`移除 ${name}`} side="top" className="-me-1.5 size-6 shrink-0 rounded-full" />}
          >
            <XIcon className="size-3.5" />
          </AttachmentPrimitive.Remove>
        )}
      </div>
    </AttachmentPrimitive.Root>
  );
};

export const UserMessageAttachments: FC = () => (
  <div className="col-span-full col-start-1 row-start-1 flex w-full flex-row justify-end gap-2 empty:hidden">
    <MessagePrimitive.Attachments>{() => <AttachmentChip />}</MessagePrimitive.Attachments>
  </div>
);

export const ComposerAttachments: FC = () => (
  <div className="flex w-full flex-row flex-wrap items-center gap-2 px-1 empty:hidden">
    <ComposerPrimitive.Attachments>{() => <AttachmentChip />}</ComposerPrimitive.Attachments>
  </div>
);

export const ComposerAddAttachment: FC = () => (
  <ComposerPrimitive.AddAttachment
    render={
      <TooltipIconButton
        tooltip="添加结构表（.xlsx、.xls、.csv）"
        side="bottom"
        variant="ghost"
        size="icon"
        className="text-muted-foreground hover:text-foreground size-8 rounded-full"
        aria-label="添加结构表"
      />
    }
  >
    <PlusIcon className="size-4" />
  </ComposerPrimitive.AddAttachment>
);
