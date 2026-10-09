import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { message, numeric, optionalRecord, text } from '@/api/client';
import { moduleConfiguration } from '@/lib/study-config';
import { hpcJson } from '@/features/field/run-label';
import { useStudy } from './study-provider';
import { StudyRunControl, StudyRemoteProgress } from './study-run-control';
import { LoadingState, ErrorState } from './states';
import '@/features/field/field.css';

export function SimulationSetupStatus({ estimate, loading, error, action }: {
  estimate?: Record<string, unknown>; loading?: boolean; error?: string; action?: ReactNode;
}) {
  if (loading) return <LoadingState title="读取超算预算" />;
  if (error) return <ErrorState title="超算预算不可用" description={error} />;
  return <section className="input-section" aria-label="有限元研究状态"><div className="hpc-actions">
    <p role="status">尚未运行 · 预计自由度 {numeric(estimate?.estimated_nodes) ?? '待网格预检'}
      {numeric(estimate?.node_limit) !== null ? `（上限 ${Number(estimate?.node_limit).toLocaleString()}）` : ''}
      {' · 核时预算 '}{numeric(estimate?.budget_core_hours)?.toFixed(3) ?? '待预检'} 核时</p>
    {action}
  </div></section>;
}

export function SimulationSetup({ module }: { module: string }) {
  const context = useStudy(), configuration = moduleConfiguration(context.study.definition, module);
  const active = context.runs.some(run => ['accepted', 'queued', 'running', 'validating'].includes(text(run.status)));
  const query = useQuery({ queryKey: ['simulation-estimate', context.study.id, context.study.revision, context.workspace.revision, module],
    enabled: !!configuration && !active && !context.dirty, retry: false,
    queryFn: ({ signal }) => hpcJson(`/workspaces/${context.study.workspace}/studies/${context.study.id}/estimate?` +
      new URLSearchParams({ expected_revision: String(context.workspace.revision), expected_study_revision: String(context.study.revision),
        ...(context.study.definition.modules?.[module] ? { module } : {}) }), { signal }) });
  if (active) return <StudyRemoteProgress />;
  return <SimulationSetupStatus estimate={query.data || { node_limit: optionalRecord(configuration?.parameters?.mesh).max_nodes }}
    loading={query.isFetching} error={context.dirty ? '输入有未保存修改，请先保存。' : query.error ? message(query.error) : undefined}
    action={<StudyRunControl module={module} secondary label="提交超算" onResult={() => context.refresh()} />} />;
}
