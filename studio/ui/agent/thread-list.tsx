// The conversations, listed by when they were last used. assistant-ui's thread list holds the behaviour (a new conversation, switching,
// the mark on a running one); the kit's sidebar parts hold the look. The host has no rename, archive or delete, so none is offered.
import { ThreadListPrimitive, useAui, useAuiState } from '@assistant-ui/react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ChatNotice } from '@/kit/chat/empty';
import { ChatGroup, ChatItem, ChatListEmpty, ChatSearch, ChatSidebar, NewChatButton } from '@/kit/chat/sidebar';
import { Icon } from '@/kit/icon';
import { useChats } from '@/state/queries';

const GROUPS = ['今天', '昨天', '近 7 天', '更早'] as const;
type Group = (typeof GROUPS)[number];

/** Which group a conversation belongs to, by the calendar day it was last used. */
function groupOf(updated: string, now: Date): Group {
  const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((day(now) - day(new Date(updated))) / 86_400_000);
  return days <= 0 ? '今天' : days === 1 ? '昨天' : days < 7 ? '近 7 天' : '更早';
}

export function ConversationList() {
  const chats = useChats();
  const [search, setSearch] = useState('');
  const ids = useAuiState(state => state.threads.threadIds);
  const loading = useAuiState(state => state.threads.isLoading);
  const needle = search.trim().toLowerCase();
  const now = new Date();
  const rows = (chats.data ?? []).filter(item => ids.includes(item.id) && (!needle || item.title.toLowerCase().includes(needle)));
  return <ThreadListPrimitive.Root className="flex h-full min-h-0 flex-col">
    <ChatSidebar header={<>
      <ThreadListPrimitive.New render={<NewChatButton />} />
      <ChatSearch value={search} onChange={event => setSearch(event.target.value)} />
    </>}>
      {chats.isError && <ChatNotice tone="error">
        <p className="m-0 font-medium">历史对话读取失败</p>
        <p className="my-2 whitespace-pre-wrap wrap-anywhere">{chats.error.message}</p>
        {chats.data && <p className="my-2">下方是上次读取到的对话，列表可能尚未更新。</p>}
        <Button variant="outline" size="sm" disabled={chats.isFetching} onClick={() => void chats.refetch()}>
          <Icon name="agent/retry" data-icon="inline-start" />{chats.isFetching ? '正在重试…' : '重试读取历史'}
        </Button>
      </ChatNotice>}
      {loading
        ? <div role="status" aria-label="正在载入对话" className="flex flex-col gap-1">{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-9 w-full rounded-nav" />)}</div>
        : rows.length === 0
          ? chats.isError ? null : needle ? <div className="flex flex-col items-start gap-2 px-3 py-2">
            <p role="status" className="m-0 text-sm text-ink-2">没有找到对话</p>
            <Button variant="ghost" size="sm" onClick={() => setSearch('')}>清除搜索</Button>
          </div> : <ChatListEmpty />
          : GROUPS.map(label => {
            const inGroup = rows.filter(item => groupOf(item.updated, now) === label);
            return inGroup.length === 0 ? null : <ChatGroup key={label} label={label}>
              {inGroup.map(item => <ThreadListPrimitive.ItemByIndex key={item.id} index={ids.indexOf(item.id)} components={{ ThreadListItem: Conversation }} />)}
            </ChatGroup>;
          })}
    </ChatSidebar>
  </ThreadListPrimitive.Root>;
}

function Conversation() {
  const aui = useAui();
  const title = useAuiState(state => state.threadListItem.title) || '新对话';
  const running = useAuiState(state => state.threadListItem.isRunning);
  const active = useAuiState(state => state.threadListItem.id === state.threads.mainThreadId);
  // The kit's item draws its own content, which a primitive's render would replace with nothing; the switch is the thread list's own.
  return <ChatItem title={title} active={active} running={running} onClick={() => aui.threadListItem.switchTo()} />;
}
