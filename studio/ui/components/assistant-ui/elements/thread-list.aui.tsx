"use client";

// assistant-ui's registry thread list, cut down to what the conversation list needs: new conversation, search, the list with a mark
// on the one that is running. Rename, archive and delete are not offered because the host does not have them.
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { AuiIf, ThreadListItemPrimitive, ThreadListPrimitive, useAuiState } from "@assistant-ui/react";
import { Loader2Icon, PlusIcon, SearchIcon } from "lucide-react";
import { useState, type FC } from "react";

export const ThreadList: FC = () => {
  const [search, setSearch] = useState("");
  const hasThreads = useAuiState((s) => s.threads.threadIds.length > 0);
  return (
    <ThreadListPrimitive.Root data-slot="aui_thread-list-root" className="flex min-h-0 flex-1 flex-col gap-1">
      <ThreadListPrimitive.New
        render={
          <Button
            variant="ghost"
            data-slot="aui_thread-list-new"
            className="hover:bg-muted data-active:bg-muted h-9 justify-start gap-2 rounded-lg px-2.5 text-sm font-normal"
          />
        }
      >
        <PlusIcon className="size-4 shrink-0" />
        <span className="whitespace-nowrap">新对话</span>
      </ThreadListPrimitive.New>
      {hasThreads && (
        <div data-slot="aui_thread-list-search" className="relative px-0.5 py-1">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="搜索对话"
            placeholder="搜索对话"
            className="h-8 ps-8 text-sm"
          />
        </div>
      )}
      <div data-slot="aui_thread-list-items" className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        <AuiIf condition={(s) => s.threads.isLoading}>
          <div role="status" aria-label="正在载入对话" className="flex flex-col gap-0.5">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} aria-hidden="true" className="flex h-9 items-center px-2.5">
                <Skeleton className="h-3.5 w-full" />
              </div>
            ))}
          </div>
        </AuiIf>
        <AuiIf condition={(s) => !s.threads.isLoading}>
          <Items query={hasThreads ? search : ""} />
        </AuiIf>
      </div>
    </ThreadListPrimitive.Root>
  );
};

const Items: FC<{ query: string }> = ({ query }) => {
  const ids = useAuiState((s) => s.threads.threadIds);
  const items = useAuiState((s) => s.threads.threadItems);
  const needle = query.trim().toLowerCase();
  const titles = new Map(items.map((item) => [item.id, item.title || "新对话"]));
  const shown = ids.map((id, index) => ({ id, index })).filter(({ id }) => !needle || (titles.get(id) ?? "").toLowerCase().includes(needle));
  if (needle && !shown.length) return <div className="text-muted-foreground px-2.5 py-4 text-sm">没有找到对话</div>;
  return shown.map(({ id, index }) => <ThreadListPrimitive.ItemByIndex key={id} index={index} components={{ ThreadListItem }} />);
};

export const ThreadListItem: FC = () => {
  const isRunning = useAuiState((s) => s.threadListItem.isRunning);
  return (
    <ThreadListItemPrimitive.Root
      data-slot="aui_thread-list-item"
      className="group hover:bg-muted focus-visible:bg-muted data-active:bg-muted relative flex h-9 items-center rounded-lg transition-colors focus-visible:outline-none"
    >
      <ThreadListItemPrimitive.Trigger
        className={cn("focus-visible:ring-ring/50 flex h-full min-w-0 flex-1 items-center rounded-lg px-2.5 text-start text-sm outline-none focus-visible:ring-2")}
      >
        {isRunning && <Loader2Icon aria-hidden className="text-muted-foreground me-1.5 size-3.5 shrink-0 animate-spin" />}
        <span className="min-w-0 flex-1 truncate">
          <ThreadListItemPrimitive.Title fallback="新对话" />
        </span>
        {isRunning && <span className="sr-only">进行中</span>}
      </ThreadListItemPrimitive.Trigger>
    </ThreadListItemPrimitive.Root>
  );
};
