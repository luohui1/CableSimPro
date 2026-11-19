import { QueryObserver, queryOptions, type FetchQueryOptions, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { queryClient } from '@/lib/query-client';
import { savedTypeRunDestination } from '@/lib/saved-run-destination';
import { fullTypeRun, matchingTypeRun, typeEvidence, typeRunReceipt } from './api';
import { ratingResults } from './rating-api';

export function typeEvidenceOptions(wid: string, history: boolean, module: string) {
  return queryOptions({ queryKey: ['type-evidence', wid, history ? 'history' : 'recent', module],
    queryFn: ({ signal }) => typeEvidence(wid, AbortSignal.any([signal, AbortSignal.timeout(20000)]), !history, module),
    retry: false, staleTime: 30000 });
}

/** A dependent workspace remains an observer until it has consumed this read. */
export async function readTypeEvidenceForWorkspace<T, Key extends QueryKey>(options: FetchQueryOptions<T, Error, T, Key>, read: () => Promise<T>,
  signal: AbortSignal, client: QueryClient = queryClient) {
  signal.throwIfAborted();
  const observer = new QueryObserver(client, { ...options, enabled: false });
  const release = observer.subscribe(() => {});
  let abort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    const value = await Promise.race([read(), cancelled]);
    signal.throwIfAborted();
    return value;
  } finally {
    signal.removeEventListener('abort', abort);
    release();
  }
}

export function typeRatingResultsOptions(wid: string, runId: string) {
  return queryOptions({ queryKey: ['type-rating-results', wid, runId],
    queryFn: ({ signal }) => ratingResults(wid, runId, signal) });
}

/** Only a real, exact StudyProvider read supplies the optional archive receipt. */
function cachedStudyRun(client: QueryClient, wid: string, runId: string) {
  const query = client.getQueryCache().findAll({ queryKey: ['saved-run', wid] }).find(query =>
    query.queryKey[3] === runId && ['detail', 'evidence'].includes(String(query.queryKey[4]))
    && query.state.status === 'success' && !query.state.isInvalidated);
  if (!query) return undefined;
  const run = typeRunReceipt(wid, runId, query.state.data);
  if (run.study !== query.queryKey[2]) throw new Error('保存运行与研究缓存身份不一致，停止显示');
  if (['accepted', 'queued', 'running', 'validating'].includes(String(run.status))) return undefined;
  return run;
}

export function fixedRatingEvidenceOptions(client: QueryClient, wid: string, runId: string) {
  return queryOptions({ queryKey: ['type-fixed-rating-run', wid, runId], staleTime: 0, retry: false,
    queryFn: async ({ signal }) => {
      const rowsOptions = typeRatingResultsOptions(wid, runId);
      const cached = cachedStudyRun(client, wid, runId), dependency = new AbortController();
      const reading = AbortSignal.any([signal, dependency.signal]);
      try {
        // Cold type links discover the study from the verified row receipt.
        // Warm study links start this same rows read and full archive together.
        const rows = readTypeEvidenceForWorkspace(rowsOptions, () => client.fetchQuery(rowsOptions), reading, client);
        const full = cached ? fullTypeRun(wid, runId, cached, reading)
          : rows.then(value => fullTypeRun(wid, runId, value.run, reading));
        const [saved, result] = await Promise.all([full, rows]);
        matchingTypeRun(wid, runId, saved.run, result.run);
        if (savedTypeRunDestination(saved.run, { workspaceId: wid, studyId: saved.study.id, runId })?.module !== 'rating-table')
          throw new Error('所选运行不是保存的型号载流量表，停止显示');
        return [saved];
      } finally {
        // Release this dependency even if its parallel archive read fails.
        dependency.abort();
      }
    } });
}
