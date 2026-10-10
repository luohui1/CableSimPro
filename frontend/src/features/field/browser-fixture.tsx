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
import { SimulationSetupStatus } from '@/components/simulation-setup';
import { SavedRunProgress } from '@/components/study-run-control';
import { FieldHistoryNotice } from './history-notice';
import { Button } from '@/components/ui/button';
import { DuctSensitivity } from './duct-sensitivity';
import { StepResponse } from './step-response';

const root = createRoot(document.getElementById('test')!);
let client: QueryClient | undefined;
export function renderFixture(kind: string, run: Record<string, unknown>, key: number) {
  client?.clear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const setup = run.fixtureState === 'history' ? <FieldHistoryNotice run={{...run, freshness:'historical',version_status:{status:'stale',reasons:[{code:'METHOD_VERSION_CHANGED',from_version:'1.0.3',to_version:'1.0.4'}]}}} />
    : run.fixtureState === 'success' ? <SavedRunProgress run={run} />
    : <SimulationSetupStatus loading={run.fixtureState === 'loading'} error={run.fixtureState === 'error' ? '超算连接中断，保存数据保留。' : undefined}
        estimate={{node_limit:4000000,budget_core_hours:6.2}} boundary={{label:'镜像远场（默认）'}} action={<Button>提交超算</Button>} />;
  const diagnostic = run.sensitivity ?? {baseline_ampacity_a:667.882,reference_gap_a:14.932,classification:'not_resolved',rows:[{id:'air',label:'空气温度包络（浏览器夹具）',basis:'温度包络；系数保持来源值',status:'complete',ampacity_a:670,delta_a:2.118,delta_percent:.317,nodes:240000}]};
  root.render(<QueryClientProvider client={client} key={key}>{kind === 'step' ? <StepResponse run={run} /> : kind === 'diagnostic' ? <DuctSensitivity data={run.fixtureState === 'empty' ? undefined : diagnostic} loading={run.fixtureState === 'loading'} error={run.fixtureState === 'error' ? '超算连接中断，保存数据保留。' : undefined} historical={run.fixtureState === 'history'} /> : kind === 'setup' ? setup : kind === 'field' ? <StudyTemperature run={run} tab="field" onSelect={() => {}} /> : kind === 'jobs' ? <HpcJobList /> : kind === 'adaptive' ? <AdaptiveConvergence run={run} /> : <SavedFieldComparison run={run} />}</QueryClientProvider>);
}
