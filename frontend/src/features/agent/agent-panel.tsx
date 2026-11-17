import { usePageTheme } from '@/components/catalog-shell';
import { AgentEmbed } from './agent-embed';

/** The workbench uses the same pi conversation and approval flow as Agent mode. */
export function AgentPanel({ workspaceId, studyId, context }: {
  workspaceId: string; studyId?: string; context: string; suggestions?: string[];
}) {
  const { theme } = usePageTheme();
  return <section className="agent-panel" aria-label="Agent">
    <AgentEmbed key={`${workspaceId}/${studyId || ''}`} theme={theme} workspaceId={workspaceId} studyId={studyId} context={context} compact />
  </section>;
}
