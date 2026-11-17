import { infiniteQueryOptions, keepPreviousData, queryOptions, type QueryClient } from '@tanstack/react-query';
import { indexAll, indexInbox, indexObjects } from '@/api/object-index';
import { methodCatalog, typeIndex, workspaces } from '@/api/research';
import { studyCardIndex } from '@/lib/study-cards';

/** Route entry and the visible catalog share the same keys, response shapes,
 * and freshness policy. Start reads before the lazy page mounts without making
 * navigation wait for them; the page retains its loading/error/retry controls. */
export function homeRecentStudiesQuery() {
  return queryOptions({ queryKey: ['index-objects', 'study'],
    queryFn: ({ signal }) => indexObjects({ kind: 'study', limit: 100 }, signal) });
}

export function homeRecentTypesQuery() {
  return queryOptions({ queryKey: ['index-objects', 'type'],
    queryFn: ({ signal }) => indexObjects({ kind: 'type', limit: 100 }, signal) });
}

export function homeInboxQuery() {
  return queryOptions({ queryKey: ['index-inbox'], queryFn: ({ signal }) => indexInbox(signal) });
}

export function homeStudyCardsQuery(client: QueryClient) {
  return queryOptions({ queryKey: ['study-index', 'home-cards'],
    queryFn: ({ signal }) => studyCardIndex(signal, client.fetchQuery({
      queryKey: ['workspace-index'], queryFn: ({ signal: workspaceSignal }) => workspaces(workspaceSignal),
    })) });
}

/** Plugins display capability schemas, execution policy, and signed resources.
 * Keep the full directory separate from ['method-catalog', 'summary']. */
export function pluginCatalogQuery() {
  return queryOptions({ queryKey: ['method-catalog'], queryFn: ({ signal }) => methodCatalog(signal) });
}

// Preserve the visible list's InfiniteData shape and explicit history paging.
// A new cache starts with ten records; a prefetch never flattens saved pages.
export function runRecordsQuery(query: string) {
  return infiniteQueryOptions({
    queryKey: ['index-objects', 'run', query],
    queryFn: ({ signal, pageParam }) => indexObjects({ kind: 'run', q: query, limit: 10, offset: pageParam }, signal),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((sum, page) => sum + page.items.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
    placeholderData: keepPreviousData,
  });
}

export function runOwnerCardsQuery() {
  return queryOptions({ queryKey: ['study-index', 'sidebar-cards'], queryFn: ({ signal }) => indexAll('study', signal) });
}

export function runTypeIndexQuery() {
  return queryOptions({ queryKey: ['type-index'], queryFn: ({ signal }) => typeIndex(signal) });
}

export function prefetchHomePage(client: QueryClient): void {
  void client.prefetchQuery(homeRecentStudiesQuery());
  void client.prefetchQuery(homeRecentTypesQuery());
  void client.prefetchQuery(homeInboxQuery());
  void client.prefetchQuery(homeStudyCardsQuery(client));
}

export function prefetchPluginsPage(client: QueryClient): void {
  // Plugin usage/validation belong to their current page controls. Do not
  // promote the all-workspace studyIndex or full validation evidence here.
  void client.prefetchQuery(pluginCatalogQuery());
}

export function prefetchRunsPage(client: QueryClient): void {
  void client.prefetchInfiniteQuery(runRecordsQuery(''));
  void client.prefetchQuery(runOwnerCardsQuery());
  void client.prefetchQuery(runTypeIndexQuery());
  // The page derives the real visible parents and same-type siblings before
  // reading authoritative summaries with its existing four-request limit.
}
