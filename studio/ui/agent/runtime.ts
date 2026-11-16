// The conversation page's runtime: assistant-ui drives the thread, the host owns the conversation. The page sends messages, stops
// runs and switches conversations through the host's API, and reads the messages the host rebuilds from its session files.
import { useNavigate } from '@tanstack/react-router';
import { useExternalStoreRuntime, type AttachmentAdapter, type ThreadMessageLike } from '@assistant-ui/react';
import { useMutation } from '@tanstack/react-query';
import type { ChatMessage, ChatStep } from '@shared/types';
import { reportFailure } from '@/components/notice';
import { api } from '@/state/api';
import { queryClient, useChat, useChats } from '@/state/queries';

/** Real tasks to start from; one click sends it. */
const STARTERS = [
  { title: '导入公开结构表示例并核对', prompt: '导入公开结构表示例，算参数并按国标核对，列出不通过项。' },
  { title: '选一款型号，算直埋载流量', prompt: '选一款型号，直埋敷设，算载流量，说明哪根电缆先到温限。' },
  { title: '导出一份规格书', prompt: '挑一个规格，导出一份规格书。' },
  { title: '建一个电缆三维结构模型', prompt: '挑一个三芯铠装规格，建三维结构模型，让我看各层。' },
];

/** A structure table is kept on the host when the message is sent; the agent reads it by the identifier that comes back. */
const attachments: AttachmentAdapter = {
  accept: '.xlsx,.xls,.csv,.tsv',
  add: async ({ file }) => ({ id: crypto.randomUUID(), type: 'document', name: file.name, contentType: file.type, file, status: { type: 'requires-action', reason: 'composer-send' } }),
  send: async attachment => {
    const saved = await api.upload(attachment.file);
    return { id: saved.upload, type: 'document', name: saved.file, contentType: attachment.contentType, status: { type: 'complete' }, content: [] };
  },
  remove: async () => undefined,
};

const stepStatus = (step: ChatStep) => (step.status === 'failed' || step.status === 'rejected');

function convert(message: ChatMessage): ThreadMessageLike {
  const content = message.parts.map(part => (part.type === 'text'
    ? { type: 'text' as const, text: part.text }
    // The step travels as the tool call's result; the page's own tool renderer draws it, so nothing of it is the model's to say twice.
    : { type: 'tool-call' as const, toolCallId: part.id, toolName: part.tool, args: {}, argsText: '', result: part, isError: stepStatus(part) }));
  if (message.role === 'user') {
    return { role: 'user', id: message.id, createdAt: new Date(message.created), content: content.length ? content : [{ type: 'text', text: '' }],
      attachments: message.attachments?.map(item => ({ id: item.upload, type: 'document', name: item.file, status: { type: 'complete' }, content: [] })),
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
    mutationFn: async (input: { text: string; files: { upload: string; file: string }[] }) => api.send(input.text, sessionId, input.files),
    onSuccess: async reply => {
      if (reply.session === sessionId) return;
      // A new conversation: load it once so its first message is on the page when the address changes.
      await queryClient.fetchQuery({ queryKey: ['chat', reply.session], queryFn: () => api.chat(reply.session), staleTime: 0 });
      void navigate({ to: '/chat/$sessionId', params: { sessionId: reply.session } });
    },
    onError: reportFailure,
  });

  return useExternalStoreRuntime<ChatMessage>({
    messages: view.data?.items ?? [],
    convertMessage: convert,
    isRunning: Boolean(view.data?.running) || send.isPending,
    isLoading: Boolean(sessionId) && view.isPending,
    suggestions: STARTERS,
    onNew: async message => {
      const text = message.content.map(part => (part.type === 'text' ? part.text : '')).join('').trim();
      const files = (message.attachments ?? []).map(item => ({ upload: item.id, file: item.name }));
      if (!text && !files.length) return;
      await send.mutateAsync({ text, files }).catch(() => undefined);
    },
    onCancel: async () => {
      if (sessionId) await api.stop(sessionId);
    },
    // Sending while the agent works is a message to it, not a new run: the host holds it until the current step is done.
    queue: {
      items: [], steerItems: [],
      enqueue: message => void send.mutate({ text: message.content.map(part => (part.type === 'text' ? part.text : '')).join('').trim(), files: [] }),
      steer: message => void send.mutate({ text: message.content.map(part => (part.type === 'text' ? part.text : '')).join('').trim(), files: [] }),
      move: () => undefined, edit: () => undefined, remove: () => undefined,
    },
    adapters: {
      attachments,
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
