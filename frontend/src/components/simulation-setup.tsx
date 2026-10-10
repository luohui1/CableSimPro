import type { ReactNode } from 'react';
import { useLocation } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { message, numeric, optionalRecord, text } from '@/api/client';
import { moduleConfiguration } from '@/lib/study-config';
import { hpcJson } from '@/features/field/run-label';
import { boundaryScope } from '@/features/field/boundary-scope';
import { useStudy } from './study-provider';
import { StudyRunControl, StudyRemoteProgress } from './study-run-control';
import { LoadingState, ErrorState } from './states';
import '@/features/field/field.css';

export function SimulationSetupStatus({ estimate, loading, error, action, boundary }: {
  estimate?: Record<string, unknown>; loading?: boolean; error?: string; action?: ReactNode;
  boundary?: { label: string; reason?: string };
}) {
  if (loading) return <LoadingState title="读取超算预算" />;
  if (error) return <ErrorState title="超算预算不可用" description={error} />;
  return <section className="input-section" aria-label="有限元研究状态"><div className="hpc-actions">
    <p role="status">未运行 · 预计自由度 {numeric(estimate?.estimated_nodes) ?? '待网格预检'}
      {numeric(estimate?.node_limit) !== null ? `（上限 ${Number(estimate?.node_limit).toLocaleString()}）` : ''}
      {' · 核时预算 '}{numeric(estimate?.budget_core_hours)?.toFixed(3) ?? '待预检'} 核时</p>
    {action}
  </div>{boundary && <p className="field-state-note" title={boundary.reason}>侧边与底边：{boundary.label}
    {boundary.reason ? ` · ${boundary.reason}` : ' · 均匀土壤、恒温地表'}</p>}</section>;
}

export function SimulationSetup({ module }: { module: string }) {
  const context = useStudy(), configuration = moduleConfiguration(context.study.definition, module);
  const pathname = useLocation({ select: location => location.pathname });
  const tab = pathname.split('/').at(-1) || 'results';
  const availability = useQuery({ queryKey: ['simulation-availability', context.study.id, module],
    enabled: !!configuration, retry: false,
    queryFn: ({ signal }) => hpcJson(`/workspaces/${context.study.workspace}/studies/${context.study.id}/availability?` +
      new URLSearchParams(context.study.definition.modules?.[module] ? { module } : {}), { signal }) });
  const active = context.runs.some(run => ['accepted', 'queued', 'running', 'validating'].includes(text(run.status)));
  const query = useQuery({ queryKey: ['simulation-estimate', context.study.id, context.study.revision, context.workspace.revision, module],
    enabled: availability.data?.configured === true && !!configuration && !active && !context.dirty, retry: false,
    queryFn: ({ signal }) => hpcJson(`/workspaces/${context.study.workspace}/studies/${context.study.id}/estimate?` +
      new URLSearchParams({ expected_revision: String(context.workspace.revision), expected_study_revision: String(context.study.revision),
        ...(context.study.definition.modules?.[module] ? { module } : {}) }), { signal }) });
  if (active) return <StudyRemoteProgress />;
  const input = context.moduleInputs[module]?.value ?? configuration?.method_input ?? context.domain;
  const boundary = configuration?.method?.capability === 'iec-thermal-field'
    ? boundaryScope(input, configuration.parameters || {}) : undefined;
  const content: Record<string, string> = {
    results: '结果：封存后显示导体温度、允许电流及与标准方法的对照。',
    field: '场图：封存后显示温度分布、等温线和最热点。',
    samples: '取样：封存后可选取位置，读取温度与坐标。',
    diagnostics: '诊断：封存后显示热平衡残差、边界条件及求解诊断。',
    convergence: '收敛：运行收敛研究后显示逐级曲线与 0.1 K 门槛。',
  };
  return <div className="input-module"><p role="status">{content[tab] || content.results}</p>
    {availability.isPending ? <LoadingState title="读取计算位置" /> : availability.error ? <ErrorState title="计算位置暂不可读" description={message(availability.error)} /> : availability.data?.configured !== true ? <section className="input-section">
      <p>未运行 · 运行位置：超算。本方法不能在本机求解。</p>
      <p>请在设置 → 计算位置配置超算连接，再确认核时预算并提交。输入已保存。</p>
      <a href="/settings?section=compute">配置计算位置</a>
    </section> : <SimulationSetupStatus estimate={query.data || { node_limit: optionalRecord(configuration?.parameters?.mesh).max_nodes }}
    boundary={boundary}
    loading={query.isFetching} error={context.dirty ? '输入有未保存修改，请先保存。' : query.error ? message(query.error) : undefined}
    action={<StudyRunControl module={module} secondary label="提交超算" onResult={() => context.refresh()} />} />}</div>;
}
