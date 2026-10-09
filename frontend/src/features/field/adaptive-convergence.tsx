import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { message, numeric, optionalRecord, text } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { DataTable } from '@/components/data-table';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { ConvergenceChart } from './convergence-chart';
import { hpcJson, hpcStatus, savedRunLabel } from './run-label';
import './field.css';

const records = (value: unknown) => Array.isArray(value) ? value.map(optionalRecord) : [];

export function AdaptiveConvergence({ run }: { run: Record<string, unknown> }) {
  const [open, setOpen] = useState(false), [budget, setBudget] = useState('100');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), lock = useRef(false), request = useRef({ scope: '', id: '' });
  const wid = text(run.workspace), sid = text(run.study);
  const history = useQuery({ queryKey: ['adaptive-convergence', wid, sid], enabled: !!wid && !!sid,
    queryFn: ({ signal }) => hpcJson(`/convergence?workspace=${encodeURIComponent(wid)}&study=${encodeURIComponent(sid)}`, { signal }),
    refetchInterval: query => records(query.state.data?.items).some(row => ['queued', 'running'].includes(text(row.status))) ? 3000 : false, retry: false });
  const item = records(history.data?.items).find(row => row.source_run_id === run.id || row.study === sid);
  const continuation = item && ['cancelled', 'blocked', 'budget_exhausted'].includes(text(item.status))
    ? records(item.rows).filter(row => row.kind === 'mesh' && row.run_id !== item.source_run_id).at(-1) : undefined;
  const active = item && ['queued', 'running'].includes(text(item.status));
  const verdict = optionalRecord(item?.verdict);
  const execution = optionalRecord(item?.current_execution), pending = optionalRecord(item?.pending);
  const savedProof = optionalRecord(run.convergence), tolerance = Math.min(.1, numeric(savedProof.tolerance_k) ?? .1);
  const sourceTitle = text(optionalRecord(optionalRecord(run.snapshot).definition).title) || '保存研究';
  const rows: (Record<string, unknown> & { id: string })[] = records(item?.rows ?? savedProof.rows).map((row, index) => {
    const attempt = [...records(item?.history_attempts), ...records(item?.attempts)].find(attempt => attempt.run_id === row.run_id), execution = optionalRecord(attempt?.execution);
    const start = Date.parse(text(execution.started)), end = Date.parse(text(execution.finished));
    return { sequence: run.sequence, created: run.created, run_id: run.id, ...row, id: String(index),
      core_hours: numeric(attempt?.actual_cpu_seconds) === null ? null : Number(attempt?.actual_cpu_seconds) / 3600,
      wall_seconds: Number.isFinite(start) && Number.isFinite(end) ? (end-start)/1000 : null };
  });
  async function perform(action: 'start' | 'cancel' | 'resume') {
    if (lock.current) return;
    if (action === 'start' && (!Number.isFinite(Number(budget)) || Number(budget) <= 0 || Number(budget) > 2000)) { setError('累计核时预算须大于 0 且不超过 2000。'); return; }
    lock.current = true; setBusy(true); setError('');
    try {
      if (action === 'start') {
        const sourceRun = continuation?.run_id ?? run.id, sourceStudy = continuation ? text(item?.study) : sid;
        const scope = `${wid}:${sourceStudy}:${text(sourceRun)}:${continuation ? text(item?.id) : ''}`;
        if (request.current.scope !== scope) request.current = { scope, id: crypto.randomUUID() };
        await hpcJson(`/workspaces/${encodeURIComponent(wid)}/studies/${encodeURIComponent(sourceStudy)}/convergence`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ request_id: request.current.id, source_run_id: sourceRun, max_core_hours: Number(budget), tolerance_k: tolerance, max_steps: 12, budget_confirmed: true, max_nodes: 4000000, upgrade_method: true,
            ...(continuation ? { continue_from: item?.id } : {}) }) });
      } else await hpcJson(`/convergence/${text(item?.id)}/${action}`, { method: 'POST' });
      setOpen(false); await history.refetch();
    } catch (failure) { setError(message(failure)); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className="input-section" aria-label="自动加密与扩域">
    <div className="hpc-actions"><h3>自动加密与扩域</h3>{!item && <Button disabled={busy || history.isPending || !!history.error} onClick={() => setOpen(true)}>设置收敛预算</Button>}
      {active && <Button variant="ghost" disabled={busy || !!item.cancel_requested} onClick={() => void perform('cancel')}>{item.cancel_requested ? '取消待确认' : '停止后续级别'}</Button>}
      {item?.status === 'interrupted' && <Button disabled={busy} onClick={() => void perform('resume')}>恢复原作业</Button>}
      {continuation && <Button disabled={busy} onClick={() => setOpen(true)}>用当前版本继续</Button>}
      {history.error && <Button variant="ghost" onClick={() => void history.refetch()}>重试</Button>}
    </div>
    {(history.error || error) && !open && <ErrorState description={error || message(history.error)} />}
    {history.isPending ? <LoadingState title="读取逐级收敛记录" /> : !item && !history.error ? rows.length ? <p>保存核验{savedProof.status === 'converged' ? '已达到门槛' : '尚未收敛'} · 门槛 {tolerance} K</p> : <EmptyState title="尚未启动自动收敛" description="网格尺寸逐级减半，计算域宽度与深度逐级加倍；保留原门槛。" /> : item && <>
      <dl className="field-scope"><div><dt>状态</dt><dd>{hpcStatus(item.status)} · {verdict.status === 'converged' ? '达到门槛' : '尚未收敛'}</dd></div>
        <div><dt>门槛</dt><dd>网格与扩域各连续两级变化均小于 {numeric(verdict.tolerance_k) ?? .1} K</dd></div>
        {active && <div><dt>当前级别</dt><dd>第 {rows.length+1} 级 · {pending.kind === 'domain' ? '扩域' : pending.kind === 'rating' ? '最终载流量' : '网格'} · 排队位置 {numeric(execution.queue_position) ?? '尚未提供'}</dd></div>}
        <div><dt>核时</dt><dd>{(numeric(item.live_core_hours) ?? numeric(item.actual_core_hours))?.toFixed(5)} / {numeric(optionalRecord(item.request).max_core_hours)} 核时</dd></div>
        <div><dt>后续一级预算</dt><dd>预检与求解上限 {numeric(item.per_step_upper_core_hours)?.toFixed(3)} 核时</dd></div>
      </dl>
      {verdict.status !== 'converged' && <p role="status">尚未收敛：{verdict.mesh_passed ? '扩域' : verdict.domain_passed ? '网格' : '网格与扩域'}未达到连续两级门槛{item.reason ? `；${text(item.reason)}` : '。'}</p>}
      {records(item.attempts).filter(row => row.status === 'preflight_failed').map((row, index) => <p key={index}>{row.kind === 'mesh' ? '网格加密' : '计算域扩展'}：{records(row.errors).map(error => error.path === '/parameters/mesh/max_nodes' ? text(error.message).split('；')[0] + '；需提高可保存网格容量，保留原场阶次。' : text(error.message)).join('；')}</p>)}
    </>}
    {rows.length > 0 && <>
      <ConvergenceChart label="逐级网格热点温差" unit="K" threshold={tolerance} values={rows.filter(row => row.kind === 'mesh').map(row => numeric(row.change_k))} />
      <ConvergenceChart label="逐级扩域热点温差" unit="K" threshold={tolerance} values={rows.filter(row => row.kind === 'domain' && row.mesh_size_m === rows.filter(item => item.kind === 'mesh').at(-1)?.mesh_size_m).map(row => numeric(row.change_k))} />
      <DataTable label="自动收敛保存记录" columns={[
        { id: 'kind', label: '级别', render: row => row.kind === 'mesh' ? '网格加密' : row.kind === 'rating' ? '最终允许电流' : '计算域扩展' },
        { id: 'mesh', label: '网格 m', numeric: true, render: row => numeric(row.mesh_size_m)?.toFixed(5) },
        { id: 'nodes', label: '自由度', numeric: true, render: row => numeric(row.nodes) },
        { id: 'temperature', label: '热点 °C', numeric: true, render: row => numeric(row.hotspot_k) === null ? '—' : (Number(row.hotspot_k) - 273.15).toFixed(3) },
        { id: 'delta', label: '变化 K', numeric: true, render: row => numeric(row.change_k)?.toFixed(4) ?? '基准' },
        { id: 'hours', label: '核时', numeric: true, render: row => numeric(row.core_hours)?.toFixed(4) ?? '原记录' },
        { id: 'wall', label: '墙钟 s', numeric: true, render: row => numeric(row.wall_seconds) ?? '原记录' },
        { id: 'run', label: '保存运行', render: row => savedRunLabel(row, text(row.study_name) || (item ? row.run_id === item.source_run_id ? text(item.title).replace(/ · 自动收敛$/, '') : text(item.title) : sourceTitle)) },
      ]} groups={[{ id: 'levels', label: '级别', rows }]} rowLabel={row => `级别 ${Number(row.id) + 1}`} showGroups={false} />
    </>}
    <Dialog open={open} onOpenChange={setOpen} title="确认收敛研究预算" description="逐级提交 dg83；达到门槛即停，资源不足或预算耗尽时保留已有结果。" initialFocus="form"
      actions={<Button variant="primary" disabled={busy} onClick={() => void perform('start')}>{busy ? '提交中…' : '确认预算并开始'}</Button>}>
      <label className="hpc-budget">累计核时预算<input type="number" min="0.001" max="2000" step="0.1" value={budget} onChange={event => setBudget(event.target.value)} aria-invalid={!!error} aria-describedby={error ? 'convergence-budget-error' : undefined} /></label>
      <p>最多 12 级；每级网格减半或域加倍；门槛保留 {tolerance} K。</p>
      <p>使用已安装方法版本，完整计算网格上限 400 万节点；原保存运行保留。</p>
      <p>逐级核验温度；达到门槛后在最终网格反求允许电流。</p>
      {error && <p id="convergence-budget-error" role="alert">{error}</p>}
    </Dialog>
  </section>;
}
