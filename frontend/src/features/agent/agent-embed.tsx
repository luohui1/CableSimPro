import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { EmptyState, InlineEmpty } from '@/components/states';
import { Button } from '@/components/ui/button';
import { AGENT_MESSAGE_SOURCE as SOURCE, readAgentMessage, refreshAgentFacts } from '@/lib/agent-cache';
import './agent.css';

const PAGE = '/agent-app/fusion.html';
type Theme = 'light' | 'dark';
interface SidecarStatus { agent: { configured: boolean; model?: string; provider?: string; hint?: string } }

async function sidecarStatus(signal?: AbortSignal): Promise<SidecarStatus> {
  const response = await fetch('/agent-sidecar/api/status', { signal }).catch(() => null);
  if (!response) throw new Error('连不上本平台的服务，请确认它仍在运行，再重试。');
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message || `Agent 对话服务尚未启动（${response.status}）。请启动对话服务后重试。`);
  const page = await fetch(PAGE, { method: 'HEAD', signal }).catch(() => null);
  if (!page?.ok) throw new Error('Agent 对话界面尚未准备好。请重新运行启动器，完成界面构建后重试。');
  return body as SidecarStatus;
}

export const useAgentSidecarStatus = () => useQuery({ queryKey: ['agent-sidecar-status'], queryFn: ({ signal }) => sidecarStatus(signal), retry: false, staleTime: 30_000 });

/** One conversation implementation, used both by Agent mode and by the workbench's contextual panel. */
export function AgentEmbed({ theme, workspaceId, studyId, context, compact = false, sessionId }: {
  theme: Theme; workspaceId?: string; studyId?: string; context?: string; compact?: boolean; sessionId?: string;
}) {
  const navigate = useNavigate();
  const queries = useQueryClient();
  const frame = useRef<HTMLIFrameElement>(null);
  const status = useAgentSidecarStatus();
  const storageKey = `cablesim.agent.navigation:${workspaceId || 'all'}:${studyId || ''}`;
  // Theme changes are messages, so a running conversation is never reloaded to change its colours.
  const [src] = useState(() => {
    const query = new URLSearchParams({ theme });
    if (workspaceId) query.set('workspace', workspaceId);
    if (studyId) query.set('study', studyId);
    if (context) query.set('context', context);
    if (compact) query.set('compact', '1');
    let last = sessionId;
    try { last ||= sessionStorage.getItem(storageKey) || undefined; } catch { /* Navigation preferences are optional. */ }
    return `${PAGE}?${query}${last ? `#/chat/${encodeURIComponent(last)}` : ''}`;
  });
  const syncTheme = () => frame.current?.contentWindow?.postMessage({ source: SOURCE, type: 'theme', theme }, window.location.origin);
  useEffect(syncTheme, [theme, status.isSuccess]);

  useEffect(() => {
    const listen = (event: MessageEvent) => {
      const message = readAgentMessage(event, frame.current?.contentWindow || null, window.location.origin);
      if (!message) return;
      if (message.type === 'session') {
        try {
          if (message.session) sessionStorage.setItem(storageKey, message.session);
          else sessionStorage.removeItem(storageKey);
        } catch { /* Navigation preferences are optional. */ }
        return;
      }
      if (message.type === 'changed') { void refreshAgentFacts(queries, message.workspace); return; }
      const match = /^cablesim:([a-z_]+)\/([^?]+)(?:\?(.*))?$/.exec(message.href);
      if (!match) return;
      let id: string;
      try { id = decodeURIComponent(match[2]); } catch { return; }
      const query = new URLSearchParams(match[3] || '');
      // Navigation also covers restored conversations and writes made by another session.
      // Invalidation marks every dependency synchronously, before route loaders read it.
      if (['study', 'study_comparison', 'project', 'type', 'type_rating', 'delivery'].includes(match[1]))
        void refreshAgentFacts(queries, ['project', 'type', 'type_rating'].includes(match[1]) ? id : query.get('workspace') || undefined);
      if (match[1] === 'study') void navigate({ to: '/studies/$sid', params: { sid: id }, search: { theme, workspace: query.get('workspace') || '', run: query.get('run') || '', delivery: '' } });
      else if (match[1] === 'study_comparison') void navigate({ to: '/studies/$sid/$module/$tab', params: { sid: id, module: 'method-compare', tab: 'results' }, search: { theme, workspace: query.get('workspace') || '', compare: query.get('compare') || '', run: '', delivery: '' } });
      else if (match[1] === 'project') void navigate({ to: '/studies', search: { theme, workspace: id } });
      else if (match[1] === 'type') void navigate({ to: '/types/$wid/$module/$tab', params: { wid: id, module: 'structure', tab: 'section' }, search: { theme } });
      else if (match[1] === 'type_rating') void navigate({ to: '/types/$wid/$module/$tab', params: { wid: id, module: 'rating-table', tab: 'results' }, search: { theme, run: query.get('run') || undefined } });
      else if (match[1] === 'cable_version') void navigate({ to: '/resources/cables', search: { theme, item: id } });
      else if (match[1] === 'asset') {
        const group = query.get('group');
        if (group === 'materials' || group === 'templates' || group === 'standards')
          void navigate({ to: '/resources/$group', params: { group }, search: { theme, item: id } });
      }
      else if (match[1] === 'document') void navigate({ to: '/resources/cables/imports', search: { theme, document: id } });
      else if (match[1] === 'delivery') void navigate({ to: '/deliveries', search: { theme, workspace: query.get('workspace') || '', delivery: id } });
      else if (match[1] === 'settings') void navigate({ to: '/settings', search: { theme } });
      else if (match[1] === 'inbox') void navigate({ to: '/inbox', search: { theme } });
    };
    window.addEventListener('message', listen);
    return () => window.removeEventListener('message', listen);
  }, [navigate, queries, theme, storageKey]);

  if (status.isPending) return <InlineEmpty title="正在连接 Agent" />;
  if (status.isError) return <EmptyState title="Agent 对话服务未连接" description={status.error.message}
    action={<Button size="compact" onClick={() => void status.refetch()}>重试</Button>} />;
  return <iframe ref={frame} className="agent-embed" title={compact ? '当前对象的 Agent 对话' : 'Agent 对话'} src={src} onLoad={syncTheme} />;
}
