// The host is the single source of truth. These hooks read it; the event stream tells them when to read again.
import { keepPreviousData, QueryClient, useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { ChatSummary, ChatView, LibraryJob, LibraryVocabulary, SeriesSummary, SeriesView, SpecificationReport, SpecView, StudioEvent } from '@shared/types';
import { api, subscribe } from './api';

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, retry: 1, refetchOnWindowFocus: false } },
});

export const useStatus = () => useQuery({ queryKey: ['status'], queryFn: api.status, staleTime: 60_000 });
export const useProjects = () => useQuery({ queryKey: ['projects'], queryFn: api.projects });
export const useProject = (id: string) => useQuery({ queryKey: ['project', id], queryFn: () => api.project(id) });
export const useLibrary = () => useQuery({ queryKey: ['library'], queryFn: api.library, staleTime: Infinity });
export const useProductLibrary = () => useQuery({ queryKey: ['library', 'series'], queryFn: () => api.op<SeriesSummary[]>('library.series', {}) });
export const useProductSeries = (id: string) => useQuery({ queryKey: ['library', 'series', id], queryFn: () => api.op<SeriesView>('library.series.get', { series: id }) });
const specQuery = (id: string | undefined, version?: number) => ({ queryKey: ['library', 'spec', id, version],
  queryFn: () => api.op<SpecView>('library.spec.get', { spec: id!, ...(version ? { version } : {}) }) });
export const useProductSpec = (id: string | undefined, version?: number) => useQuery({ ...specQuery(id, version), enabled: Boolean(id) });
/** The size being looked at in the series workspace: the previous one stays on screen until the next has loaded. */
export const useActiveSpec = (id: string | undefined, version?: number) => useQuery({ ...specQuery(id, version), enabled: Boolean(id), placeholderData: keepPreviousData });
export const prefetchSpec = (id: string) => void queryClient.prefetchQuery({ ...specQuery(id), staleTime: 5_000 });
export const useVocabulary = () => useQuery({ queryKey: ['library', 'vocabulary'], queryFn: () => api.op<LibraryVocabulary>('library.vocabulary', {}) });
export const useLibraryJob = () => useQuery({ queryKey: ['library', 'job'], queryFn: () => api.op<LibraryJob | null>('library.job', {}),
  refetchInterval: query => query.state.data?.state === 'running' ? 1000 : false });
export const useSpecificationReports = (spec: string) => useQuery({ queryKey: ['library', 'documents', spec],
  queryFn: () => api.op<SpecificationReport[]>('library.documents', { spec }) });

/** Run records never change once written, so a loaded record stays fresh. */
export const useRun = (project: string, run: string | undefined) =>
  useQuery({ queryKey: ['run', project, run], queryFn: () => api.run(project, run as string), enabled: Boolean(run), staleTime: Infinity });

// ---- Conversations with the agent ----

export const useChats = () => useQuery({ queryKey: ['chats'], queryFn: api.chats, refetchOnMount: 'always' });
export const useChat = (id: string | undefined) => useQuery({ queryKey: ['chat', id], queryFn: () => api.chat(id as string), enabled: Boolean(id), staleTime: Infinity });

/** The host sends the last few messages as they stand; they replace the page's own tail. A gap means events were missed: read the whole conversation again. */
function takeChat(event: Extract<StudioEvent, { type: 'chat' }>): void {
  const id = event.summary.id;
  queryClient.setQueryData<ChatSummary[]>(['chats'], list => {
    if (!list) return list;
    const next = list.some(item => item.id === id) ? list.map(item => (item.id === id ? event.summary : item)) : [event.summary, ...list];
    return next.sort((a, b) => b.updated.localeCompare(a.updated));
  });
  const held = queryClient.getQueryData<ChatView>(['chat', id]);
  if (!held) {
    void queryClient.invalidateQueries({ queryKey: ['chats'] });
    return;
  }
  const kept = event.count - event.tail.length;
  if (kept < 0 || held.items.length < kept) {
    void queryClient.invalidateQueries({ queryKey: ['chat', id] });
    return;
  }
  queryClient.setQueryData<ChatView>(['chat', id], { ...held, ...event.summary, items: [...held.items.slice(0, kept), ...event.tail], waiting: event.waiting });
}

export function useHostEvents() {
  useEffect(() => subscribe(event => {
    if (event.type === 'chat') {
      takeChat(event);
      return;
    }
    if (event.type === 'library') {
      void queryClient.invalidateQueries({ queryKey: ['library'] });
      return;
    }
    if (event.type !== 'project') return;
    void queryClient.invalidateQueries({ queryKey: ['project', event.project_id] });
    void queryClient.invalidateQueries({ queryKey: ['projects'] });
  }, () => {
    // A connection that came back may have missed events.
    void queryClient.invalidateQueries({ queryKey: ['chats'] });
    void queryClient.invalidateQueries({ queryKey: ['chat'] });
  }), []);
}
