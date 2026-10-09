import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { message, numeric, optionalRecord, text } from '@/api/client';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/data-table';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { hpcJson, hpcStatus, localTime, savedRunLabel } from './run-label';
import './field.css';

/** Record list for /runs; settings contains connection configuration only. */
export function HpcJobList() {
  const [offset, setOffset] = useState(0), [error, setError] = useState('');
  const [busy, setBusy] = useState(''), locked = useRef(false);
  const jobs = useQuery({ queryKey: ['hpc-jobs', offset], queryFn: ({ signal }) => hpcJson(`/jobs?offset=${offset}&limit=20`, { signal }),
    refetchInterval: query => (query.state.data?.items as Record<string, unknown>[] | undefined)?.some(row => row.cancellable) ? 3000 : false, retry: false });
  const rows: (Record<string, unknown> & { id: string })[] = Array.isArray(jobs.data?.items) ? jobs.data.items.map(value => ({ ...optionalRecord(value), id: text(optionalRecord(value).id) })) : [];
  async function action(id: string, command: 'cancel' | 'refresh') {
    if (locked.current) return;
    locked.current = true; setBusy(id); setError('');
    try { await hpcJson(`/jobs/${encodeURIComponent(id)}/${command}`, { method: 'POST' }); await jobs.refetch(); }
    catch (failure) { setError(message(failure)); }
    finally { locked.current = false; setBusy(''); }
  }
  return <section className="input-section hpc-job-list" aria-label="超算作业">
    <div className="hpc-actions"><h3>超算作业</h3><Button variant="ghost" disabled={jobs.isFetching} onClick={() => { setError(''); void jobs.refetch(); }}>刷新</Button></div>
    {(error || jobs.error) && <ErrorState title="作业状态暂不可用" description={error || message(jobs.error)} />}
    {jobs.isPending ? <LoadingState title="读取超算作业" /> : !rows.length && !jobs.error ? <EmptyState title="尚无超算作业" description="提交研究后在这里查看状态与核时。" /> : rows.length > 0 && <DataTable label="所有研究超算作业" columns={[
      { id: 'study', label: '研究与运行', render: row => savedRunLabel(row) },
      { id: 'job', label: 'Slurm 作业', render: row => text(optionalRecord(row.execution).job_id) || '等待分配' },
      { id: 'status', label: '状态', render: row => optionalRecord(row.execution).cancel_requested && row.cancellable ? '取消待确认' : hpcStatus(row.status) },
      { id: 'cost', label: '已用核时', numeric: true, render: row => numeric(row.core_hours)?.toFixed(5) ?? '未结算' },
      { id: 'start', label: '开始', render: row => localTime(row.started) },
      { id: 'end', label: '结束', render: row => row.finished ? localTime(row.finished) : '—' },
      { id: 'action', label: '操作', render: row => <div className="hpc-actions">{row.cancellable ? <Button variant="ghost" disabled={!!busy || !!optionalRecord(row.execution).cancel_requested} onClick={() => void action(row.id, 'cancel')}>取消作业</Button> : null}
        {(!row.started || ['disconnected', 'interrupted'].includes(text(row.status)) || optionalRecord(row.execution).cancel_requested) ? <Button variant="ghost" disabled={!!busy} onClick={() => void action(row.id, 'refresh')}>{busy === row.id ? '核对中…' : '核对状态'}</Button> : null}</div> },
    ]} groups={[{ id: 'jobs', label: '作业', rows }]} rowLabel={row => savedRunLabel(row)} showGroups={false} />}
    {(offset > 0 || jobs.data?.next_offset !== null && jobs.data?.next_offset !== undefined) && <div className="hpc-actions">
      <Button variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>上一页</Button>
      <span>共 {text(String(jobs.data?.total ?? 0))} 项</span>
      <Button variant="ghost" disabled={jobs.data?.next_offset == null} onClick={() => setOffset(Number(jobs.data?.next_offset))}>下一页</Button>
    </div>}
  </section>;
}
