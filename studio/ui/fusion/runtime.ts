// The conversation page's runtime: assistant-ui drives the thread, the sidecar owns the conversation. The page sends messages, stops
// runs and switches conversations through the sidecar's API (reached through the platform), and reads the messages it rebuilds from its
// session files.
import { useNavigate } from '@tanstack/react-router';
import { useExternalStoreRuntime, type AppendMessage, type ThreadMessageLike } from '@assistant-ui/react';
import { useMutation } from '@tanstack/react-query';
import type { ChatMessage, ChatStep } from '@shared/types';
import { reportFailure } from '@/components/notice';
import { api } from '@/state/api';
import { chatQuery, queryClient, useChat, useChats } from '@/state/queries';
import { ALL_STARTERS } from './starters';

const stepFailed = (step: ChatStep) => step.status === 'failed' || step.status === 'rejected';

const textOf = (message: AppendMessage) => message.content.map(part => (part.type === 'text' ? part.text : '')).join('').trim();

function convert(message: ChatMessage): ThreadMessageLike {
  const content = message.parts.map(part => (part.type === 'text'
    ? { type: 'text' as const, text: part.text }
    // The step travels as the tool call's result; the page's own tool renderer draws it, so nothing of it is the model's to say twice.
    : { type: 'tool-call' as const, toolCallId: part.id, toolName: part.tool, args: {}, argsText: '', result: part, isError: stepFailed(part) }));
  if (message.role === 'user') {
    return { role: 'user', id: message.id, createdAt: new Date(message.created), content: content.length ? content : [{ type: 'text', text: '' }],
      metadata: { custom: { queued: Boolean(message.queued) } } };
  }
  const status = message.status === 'streaming' ? { type: 'running' as const }
    : message.status === 'error' ? { type: 'incomplete' as const, reason: 'error' as const, error: message.error }
    : message.status === 'stopped' ? { type: 'incomplete' as const, reason: 'cancelled' as const }
    : { type: 'complete' as const, reason: 'stop' as const };
  return { role: 'assistant', id: message.id, createdAt: new Date(message.created), status, content };
}

export function useAgentRuntime(sessionId: string | undefined) {
  const navigate = useNavigate();
  const chats = useChats();
  const view = useChat(sessionId);

  const send = useMutation({
    mutationFn: async (text: string) => api.send(text, sessionId),
    onSuccess: async reply => {
      if (reply.session === sessionId) return;
      // A new conversation: load it once so its first message is on the page when the address changes.
      await queryClient.fetchQuery({ ...chatQuery(reply.session), staleTime: 0 });
      // Awaited: the send stays pending until the address has changed, so a second message cannot slip in between and start another conversation.
      await navigate({ to: '/chat/$sessionId', params: { sessionId: reply.session } });
    },
    onError: reportFailure,
  });

  return useExternalStoreRuntime<ChatMessage>({
    messages: view.data?.items ?? [],
    convertMessage: convert,
    isRunning: Boolean(view.data?.running) || send.isPending,
    isLoading: Boolean(sessionId) && view.isPending,
    // The first message of a new conversation is on its way; a second one sent now would start another conversation.
    isSendDisabled: !sessionId && send.isPending,
    suggestions: ALL_STARTERS.map(task => ({ title: task.title, label: task.result, prompt: task.prompt })),
    onNew: async message => {
      const text = textOf(message);
      if (text) await send.mutateAsync(text).catch(() => undefined);
    },
    onCancel: async () => {
      if (sessionId) await api.stop(sessionId);
    },
    // The sidecar's conversation only grows: a retry is the last request asked again, below the answer that went wrong.
    onReload: async () => {
      const last = [...(view.data?.items ?? [])].reverse().find(item => item.role === 'user');
      const text = last?.parts.map(part => (part.type === 'text' ? part.text : '')).join('').trim();
      if (text) await send.mutateAsync(text).catch(() => undefined);
    },
    // With a queue adapter every send goes through it, idle or not. The sidecar does the queueing: a message sent while the agent works
    // is held until the current step is done and shown on the page as waiting, so this adapter only passes the message on.
    queue: {
      items: [], steerItems: [],
      enqueue: message => { const text = textOf(message); if (text) send.mutate(text); },
      steer: message => { const text = textOf(message); if (text) send.mutate(text); },
      move: () => undefined, edit: () => undefined, remove: () => undefined,
    },
    adapters: {
      threadList: {
        threadId: sessionId,
        isLoading: chats.isPending,
        threads: (chats.data ?? []).map(item => ({ status: 'regular' as const, id: item.id, title: item.title })),
        archivedThreads: [],
        onSwitchToNewThread: () => void navigate({ to: '/' }),
        onSwitchToThread: id => void navigate({ to: '/chat/$sessionId', params: { sessionId: id } }),
      },
    },
  });
}
