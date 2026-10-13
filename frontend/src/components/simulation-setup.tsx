import type { ReactNode } from 'react';
import { Link, useLocation } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { message, numeric, optionalRecord, text } from '@/api/client';
import { moduleConfiguration } from '@/lib/study-config';
import { hpcJson } from '@/features/field/run-label';
import { boundaryScope } from '@/features/field/boundary-scope';
import { useStudy } from './study-provider';
import { StudyRunControl, StudyRemoteProgress } from './study-run-control';
import { LoadingState, ErrorState } from './states';
import { SolverLocation } from './solver-location';
import type { SolverCapability } from '@/lib/solver-location';
import { deferredView } from './deferred-view';
import { domainCapacityRegions } from '@/features/field/capacity-regions';
const HeatCapacityForm = deferredView(() => import('@/features/field/heat-capacity-form').then(m => ({default:m.HeatCapacityForm})));
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
  const active = context.runs.some(run => ['accepted', 'queued', 'running', 'validating'].includes(text(run.status)) && (!run.module || run.module === module));
  const query = useQuery({ queryKey: ['simulation-estimate', context.study.id, context.study.revision, context.workspace.revision, module],
    enabled: availability.data?.configured === true && !!configuration && !active && !context.dirty, retry: false,
    queryFn: ({ signal }) => hpcJson(`/workspaces/${context.study.workspace}/studies/${context.study.id}/estimate?` +
      new URLSearchParams({ expected_revision: String(context.workspace.revision), expected_study_revision: String(context.study.revision),
        ...(context.study.definition.modules?.[module] ? { module } : {}) }), { signal }) });
  const materialRegions = domainCapacityRegions(context.domain);
  const savedSource = context.runs.filter(run=>run.status==='succeeded').sort((a,b)=>Number(b.sequence)-Number(a.sequence))[0];
  if (!materialRegions.some(region=>region.category==='soil')) materialRegions.push({id:'material/soil',label:'现场土壤',category:'soil'});
  if (!configuration) return <div className="input-module"><section className="input-section" aria-label="模块配置">
    <p role="status">尚未配置该模块</p>
    <p>请先选择计算方法并保存参数，再检查输入和运行。</p>
    <Link to="/studies/$sid/$module/$tab" params={{ sid: context.study.id, module, tab: 'parameters' }}
      search={previous => ({ ...previous, theme: previous.theme === 'dark' ? 'dark' : 'light',
        workspace: context.study.workspace, run: '', delivery: '', inspector: 'method' })}>配置方法与参数</Link>
  </section>{module==='transient'&&materialRegions.length>0&&<HeatCapacityForm regions={materialRegions}
    savedSource={savedSource?{workspace:context.study.workspace,study:context.study.id,run:text(savedSource.id)}:undefined}/>}</div>;
  if (active) return <StudyRemoteProgress />;
  const input = context.moduleInputs[module]?.value ?? configuration?.method_input ?? context.domain;
  const boundary = configuration?.method?.capability === 'iec-thermal-field'
    ? boundaryScope(input, configuration.parameters || {}) : undefined;
  const solver = availability.data?.solver;
  const capability = solver === 'slurm' || solver === 'local' || solver === 'either'
    ? { id: configuration?.method.capability || '', solver } satisfies SolverCapability : undefined;
  const content: Record<string, string> = {
    results: '结果：封存后显示导体温度、允许电流及与标准方法的对照。',
    field: '场图：封存后显示温度分布、等温线和最热点。',
    samples: '取样：封存后可选取位置，读取温度与坐标。',
    diagnostics: '诊断：封存后显示热平衡残差、边界条件及求解诊断。',
    convergence: '收敛：运行收敛研究后显示逐级曲线与 0.1 K 门槛。',
  };
  return <div className="input-module"><p role="status">{content[tab] || content.results}</p>
    {availability.isPending ? <LoadingState title="读取计算位置" /> : availability.error ? <ErrorState title="计算位置暂不可读" description={message(availability.error)} /> : availability.data?.configured !== true ? <section className="input-section">
      <p>未运行 · <SolverLocation pluginId={configuration?.method.plugin_id || ''} capability={capability} /></p>
      <p>{solver === 'slurm' ? '本方法不能在本机求解。' : ''}输入检查可先完成；连接配置完成后再确认核时预算并提交。</p>
      <StudyRunControl module={module} secondary label="检查输入" onResult={() => context.refresh()} />
    </section> : <SimulationSetupStatus estimate={query.data || { node_limit: optionalRecord(configuration?.parameters?.mesh).max_nodes }}
    boundary={boundary}
    loading={query.isFetching} error={context.dirty ? '输入有未保存修改，请先保存。' : query.error ? message(query.error) : undefined}
    action={<StudyRunControl module={module} secondary label="提交超算" onResult={() => context.refresh()} />} />}</div>;
}
