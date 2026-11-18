import { useSearch } from '@tanstack/react-router';
import { AppShell } from '@/components/app-shell';
import { usePageTheme } from '@/components/catalog-shell';
import { AgentEmbed, useAgentSidecarStatus } from '@/features/agent/agent-embed';

/** The platform keeps its navigation; every Agent entry uses the same standalone conversation. */
export function AgentPage() {
  const { theme, search: themeSearch, navigate } = usePageTheme();
  const search = useSearch({ strict: false }) as { workspace?: string; task?: string };
  const status = useAgentSidecarStatus();
  const agent = status.data?.agent;
  const model = agent?.configured ? agent.model : undefined;
  return <AppShell title="Agent" theme={theme} onTheme={() => void navigate({
    to: window.location.pathname, search: { ...themeSearch, theme: theme === 'light' ? 'dark' : 'light' }, replace: true,
  })} onUnavailable={() => {}} actions={null}
    status={agent ? <><span className={`status-dot ${model ? 'is-ok' : 'is-off'}`} /><span className="agent-panel-model">{model || '模型未配置'}</span></> : null}>
    <div className="agent-page" data-page="agent">
      <AgentEmbed key={`${search.workspace || 'all'}/${search.task || ''}`} theme={theme} workspaceId={search.workspace} sessionId={search.task} />
    </div>
  </AppShell>;
}
