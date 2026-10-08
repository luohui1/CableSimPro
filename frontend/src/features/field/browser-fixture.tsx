/** Test-only mount for verify-hpc.mjs; never imported by the product entry. */
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@fontsource/noto-sans-sc/400.css';
import '@fontsource/noto-sans-sc/600.css';
import 'virtual:design-tokens.css';
import '@/styles/theme.css';
import '@/styles/research.css';
import '@/styles/workbench.css';
import { HpcJobList } from './hpc-job-list';
import { AdaptiveConvergence } from './adaptive-convergence';
import { SavedFieldComparison } from './saved-comparison';
import { StudyTemperature } from '@/components/study-temperature';

const root = createRoot(document.getElementById('test')!);
let client: QueryClient | undefined;
export function renderFixture(kind: string, run: Record<string, unknown>, key: number) {
  client?.clear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  root.render(<QueryClientProvider client={client} key={key}>{kind === 'field' ? <StudyTemperature run={run} tab="field" onSelect={() => {}} /> : kind === 'jobs' ? <HpcJobList /> : kind === 'adaptive' ? <AdaptiveConvergence run={run} /> : <SavedFieldComparison run={run} />}</QueryClientProvider>);
}
