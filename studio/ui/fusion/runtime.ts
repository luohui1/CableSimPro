// The conversation page's runtime: assistant-ui drives the thread, the sidecar owns the conversation. The page sends messages, stops
// runs and switches conversations through the sidecar's API (reached through the platform), and reads the messages it rebuilds from its
// session files.
import { useNavigate } from '@tanstack/react-router';
import { useExternalStoreRuntime, type AppendMessage, type ThreadMessageLike } from '@assistant-ui/react';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';
import type { ChatMessage, ChatStep } from '@shared/types';
import { STRUCTURE_ATTACHMENT_BYTES, STRUCTURE_ATTACHMENT_COUNT, type StructureAttachmentInput } from '@shared/fusion-types';
import { reportFailure } from '@/components/notice';
import { api } from '@/state/api';
import { chatQuery, queryClient, useChat, useChats, useStatus } from '@/state/queries';
import { ALL_STARTERS } from './starters';
import { MESSAGE_SOURCE, notifyPlatformChanged } from './open';
import { structureAttachments, type SelectedAttachments } from './attachments';

const stepFailed = (step: ChatStep) => step.status === 'failed' || step.status === 'rejected';

const textOf = (message: AppendMessage) => message.content.map(part => (part.type === 'text' ? part.text : '')).join('').trim();
interface MessageInput { text: string; files: StructureAttachmentInput[]; selected: string[] }

function convert(message: ChatMessage): ThreadMessageLike {
  const content = message.parts.map(part => (part.type === 'text'
    ? { type: 'text' as const, text: part.text }
    // The step travels as the tool call's result; the page's own tool renderer draws it, so nothing of it is the model's to say twice.
    : { type: 'tool-call' as const, toolCallId: part.id, toolName: part.tool, args: {}, argsText: '', result: part, isError: stepFailed(part) }));
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
  const status = useStatus();
  const notified = useRef(new Set<string>());
  const selected = useRef<SelectedAttachments>(new Map());
  const attachments = useMemo(() => structureAttachments(selected.current), []);
  const query = new URLSearchParams(window.location.search);
  const workspace = query.get('workspace');
  const context = workspace ? { workspace_id: workspace, study_id: query.get('study') || undefined, label: query.get('context') || undefined } : undefined;
  useEffect(() => {
    window.parent.postMessage({ source: MESSAGE_SOURCE, type: 'session', session: sessionId || null }, window.location.origin);
  }, [sessionId]);
  useEffect(() => {
    // Recovered conversations can contain an accepted write whose original HTTP callback was lost.
    // These are platform step states, never conclusions parsed out of model text.
    const workspaces = new Set<string | undefined>();
    for (const item of view.data?.items || []) for (const part of item.parts) {
      if (part.type !== 'step' || part.proposal?.status !== 'accepted' || !['done', 'failed', 'interrupted'].includes(part.status)) continue;
      const key = `${sessionId}/${part.id}/${part.status}`;
      if (notified.current.has(key)) continue;
      notified.current.add(key);
      workspaces.add(part.proposal.project_id);
    }
    for (const workspace of workspaces) notifyPlatformChanged(workspace);
  }, [sessionId, view.data?.items]);

  const send = useMutation({
    mutationFn: async (input: MessageInput) => api.send(input.text, sessionId, input.files, context),
    onSuccess: async (reply, input) => {
      for (const id of input.selected) selected.current.delete(id);
      if (reply.session === sessionId) return;
      // A new conversation: load it once so its first message is on the page when the address changes.
      await queryClient.fetchQuery({ ...chatQuery(reply.session), staleTime: 0 });
      // Awaited: the send stays pending until the address has changed, so a second message cannot slip in between and start another conversation.
      await navigate({ to: '/chat/$sessionId', params: { sessionId: reply.session } });
    },
    onError: reportFailure,
  });

  const toSend = (message: AppendMessage): MessageInput => {
    const ids = (message.attachments ?? []).map(item => item.id);
    if (ids.length > STRUCTURE_ATTACHMENT_COUNT) throw new Error('每条消息最多附上 4 份结构表。');
    const files = ids.map(id => {
      const file = selected.current.get(id);
      if (!file) throw new Error('附件尚未读取或已失效，请重新选择文件。');
      return file;
    });
    const bytes = files.reduce((total, file) => total + file.content_base64.length / 4 * 3 - (file.content_base64.endsWith('==') ? 2 : file.content_base64.endsWith('=') ? 1 : 0), 0);
    if (bytes > STRUCTURE_ATTACHMENT_BYTES) throw new Error('每条消息的附件合计不能超过 1 MiB，请分开发送。');
    return { text: textOf(message), files, selected: ids };
  };
  const enqueue = (message: AppendMessage) => {
    try { const input = toSend(message); if (input.text || input.files.length) send.mutate(input); }
    catch (error) { reportFailure(error); }
  };

  return useExternalStoreRuntime<ChatMessage>({
    messages: view.data?.items ?? [],
    convertMessage: convert,
    isRunning: Boolean(view.data?.running) || send.isPending,
    isLoading: Boolean(sessionId) && view.isPending,
    // The first message of a new conversation is on its way; a second one sent now would start another conversation.
    isSendDisabled: status.data?.agent.configured !== true || (!sessionId && send.isPending),
    suggestions: ALL_STARTERS.map(task => ({ title: task.title, label: task.result, prompt: task.prompt })),
    onNew: async message => {
      try {
        const input = toSend(message);
        if (input.text || input.files.length) await send.mutateAsync(input).catch(() => undefined);
      } catch (error) { reportFailure(error); }
    },
    onCancel: async () => {
      if (sessionId) await api.stop(sessionId);
    },
    // The sidecar's conversation only grows: a retry is the last request asked again, below the answer that went wrong.
    onReload: async () => {
      const last = [...(view.data?.items ?? [])].reverse().find(item => item.role === 'user');
      const text = last?.parts.map(part => (part.type === 'text' ? part.text : '')).join('').trim();
      if (last && (text || last.attachments?.length)) await send.mutateAsync({ text: text || '', selected: [],
        files: (last.attachments ?? []).map(item => ({ id: item.upload })) }).catch(() => undefined);
    },
    // With a queue adapter every send goes through it, idle or not. The sidecar does the queueing: a message sent while the agent works
    // is held until the current step is done and shown on the page as waiting, so this adapter only passes the message on.
    queue: {
      items: [], steerItems: [],
      enqueue,
      steer: enqueue,
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
