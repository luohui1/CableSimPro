import type { QueryClient } from '@tanstack/react-query';

export const AGENT_MESSAGE_SOURCE = 'cablesim-agent';

type AgentMessage =
  | { type: 'session'; session: string | null }
  | { type: 'changed'; workspace?: string }
  | { type: 'open'; href: string };

/** Only the embedded conversation can ask its parent to navigate or reread saved facts. */
export function readAgentMessage(event: Pick<MessageEvent, 'origin' | 'source' | 'data'>, frame: MessageEventSource | null, origin: string): AgentMessage | undefined {
  if (!frame || event.source !== frame || event.origin !== origin) return;
  const message: unknown = event.data;
  if (!message || typeof message !== 'object') return;
  const value = message as Record<string, unknown>;
  if (value.source !== AGENT_MESSAGE_SOURCE) return;
  if (value.type === 'session' && (typeof value.session === 'string' || value.session === null)) return { type: 'session', session: value.session };
  if (value.type === 'open' && typeof value.href === 'string') return { type: 'open', href: value.href };
  if (value.type === 'changed' && (value.workspace === undefined || typeof value.workspace === 'string' && value.workspace.length > 0))
    return { type: 'changed', workspace: value.workspace as string | undefined };
}

const indexes = new Set(['study-index', 'workspace-index', 'type-index', 'type-list', 'delivery-workspaces', 'index-inbox']);
const savedFacts = new Set([
  'workspace', 'study-context', 'runs', 'run-history', 'saved-run', 'saved-field-view', 'fem-conclusion',
  'run-record-comparison', 'report-source-runs', 'deliveries', 'delivery', 'archived-delivery',
  'type-workspace', 'type-evidence', 'type-specification', 'type-comparison', 'type-studies',
  'type-material-comparison', 'type-resource-bindings', 'type-requirements', 'type-rating-results',
]);

/** The iframe has a separate QueryClient. An accepted write may finish even when its HTTP reply is lost.
 * Mark the complete dependency set before active reads restart: study-context also holds a nested
 * saved response, and rereading only its outer projection can put the old conditions back in cache.
 * Inactive caches are only marked stale; no cold objects are fetched and no calculation is started.
 */
export function refreshAgentFacts(client: QueryClient, workspace?: string): Promise<void> {
  return client.invalidateQueries({
    predicate: query => {
      const [kind, owner] = query.queryKey;
      if (typeof kind !== 'string') return false;
      if (indexes.has(kind)) return true;
      if (kind === 'object-relations') return !workspace || query.queryKey[2] === workspace;
      if (!savedFacts.has(kind)) return false;
      // Ordinary study links first cache ownership under an empty workspace key.
      return !workspace || owner === workspace || kind === 'study-context' && !owner;
    },
    refetchType: 'active',
  });
}
