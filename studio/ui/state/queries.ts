// The host is the single source of truth. These hooks read it; the event stream tells them when to read again.
import { QueryClient, useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api, subscribe } from './api';

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, retry: 1, refetchOnWindowFocus: false } },
});

export const useStatus = () => useQuery({ queryKey: ['status'], queryFn: api.status, staleTime: 60_000 });
export const useProjects = () => useQuery({ queryKey: ['projects'], queryFn: api.projects });
export const useProject = (id: string) => useQuery({ queryKey: ['project', id], queryFn: () => api.project(id) });

/** Run records never change once written, so a loaded record stays fresh. */
export const useRun = (project: string, run: string | undefined) =>
  useQuery({ queryKey: ['run', project, run], queryFn: () => api.run(project, run as string), enabled: Boolean(run), staleTime: Infinity });

export function useHostEvents() {
  useEffect(() => subscribe(event => {
    if (event.type !== 'project') return;
    void queryClient.invalidateQueries({ queryKey: ['project', event.project_id] });
    void queryClient.invalidateQueries({ queryKey: ['projects'] });
  }), []);
}
