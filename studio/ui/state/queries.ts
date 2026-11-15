// The host is the single source of truth. These hooks read it; the event stream tells them when to read again.
import { keepPreviousData, QueryClient, useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { LibraryJob, LibraryVocabulary, RunRecord, SeriesSummary, SeriesView, SpecificationReport, SpecView } from '@shared/types';
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
export const useProductSpec = (id: string | undefined, version?: number) => useQuery({ queryKey: ['library', 'spec', id, version],
  queryFn: () => api.op<SpecView>('library.spec.get', { spec: id!, ...(version ? { version } : {}) }), enabled: Boolean(id) });
export const useVocabulary = () => useQuery({ queryKey: ['library', 'vocabulary'], queryFn: () => api.op<LibraryVocabulary>('library.vocabulary', {}) });
export const useLibraryJob = () => useQuery({ queryKey: ['library', 'job'], queryFn: () => api.op<LibraryJob | null>('library.job', {}),
  refetchInterval: query => query.state.data?.state === 'running' ? 1000 : false });
export const useSpecificationReports = (spec: string) => useQuery({ queryKey: ['library', 'documents', spec],
  queryFn: () => api.op<SpecificationReport[]>('library.documents', { spec }) });

/** The result for the project's present inputs, computed by the host without writing a record. */
export const useDraft = (project: string, digest: string | undefined, enabled: boolean) => useQuery({
  queryKey: ['draft', project, digest],
  queryFn: () => api.op<RunRecord>('draft.rate', { project }),
  enabled: enabled && Boolean(digest),
  staleTime: Infinity,
  retry: false,
  placeholderData: keepPreviousData,
});

/** Run records never change once written, so a loaded record stays fresh. */
export const useRun = (project: string, run: string | undefined) =>
  useQuery({ queryKey: ['run', project, run], queryFn: () => api.run(project, run as string), enabled: Boolean(run), staleTime: Infinity });

export function useHostEvents() {
  useEffect(() => subscribe(event => {
    if (event.type === 'library') {
      void queryClient.invalidateQueries({ queryKey: ['library'] });
      return;
    }
    if (event.type !== 'project') return;
    void queryClient.invalidateQueries({ queryKey: ['project', event.project_id] });
    void queryClient.invalidateQueries({ queryKey: ['projects'] });
  }), []);
}
