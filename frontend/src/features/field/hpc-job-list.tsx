import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { message, numeric, optionalRecord, text } from '@/api/client';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/data-table';
import { Dialog } from '@/components/ui/dialog';
import { Link, useSearch } from '@tanstack/react-router';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { hpcJson, hpcStatus, localTime, savedRunLabel } from './run-label';
import './field.css';

/** Record list for /runs; settings contains connection configuration only. */
export function HpcJobList() {
  const search = useSearch({ strict: false });
  const theme = search.theme === 'dark' ? 'dark' : 'light';
  const [offset, setOffset] = useState(0), [error, setError] = useState('');
  const [busy, setBusy] = useState(''), locked = useRef(false);
  const [selected,setSelected]=useState('');
  const detail=useQuery({queryKey:['hpc-job-detail',selected],enabled:!!selected,retry:false,
    queryFn:({signal}) => hpcJson(`/jobs/${encodeURIComponent(selected)}`,{signal}),
    refetchInterval:query => query.state.data?.cancellable ? 3000 : false});
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
    {jobs.isPending ? <LoadingState title="读取超算作业" /> : !rows.length && !jobs.error ? <EmptyState title="尚无超算作业" description="选择仿真研究，完成超算设置与预检后提交，在这里查看状态与核时。" action={<Button asChild variant="primary"><Link to="/studies" search={{ theme, kind: 'simulation' }}>选择仿真研究</Link></Button>} /> : rows.length > 0 && <DataTable label="所有研究超算作业" columns={[
      { id: 'study', label: '研究与运行', render: row => <div>{row.study_href ? <Link to={text(row.study_href)}>{text(row.study_name)}</Link> : <span>{text(row.study_name)}</span>}
        <span className="field-state-note">{row.kind==='preflight' ? ' · 预检' : row.sequence ? ` · 运行 ${row.sequence}` : ''}</span></div> },
      { id: 'job', label: 'Slurm 作业', numeric: true, render: row => text(optionalRecord(row.execution).job_id) || '等待分配' },
      { id: 'status', label: '状态', render: row => optionalRecord(row.execution).cancel_requested && row.cancellable ? '取消待确认' : hpcStatus(row.status) },
      { id: 'cost', label: '已用核时', numeric: true, render: row => numeric(row.core_hours)?.toFixed(5) ?? '未结算' },
      { id: 'start', label: '开始', render: row => localTime(row.started) },
      { id: 'end', label: '结束', render: row => row.finished ? localTime(row.finished) : '—' },
      { id: 'action', label: '操作', render: row => <div className="hpc-actions"><Button variant="ghost" onClick={() => setSelected(row.id)}>作业详情</Button>{row.cancellable ? <Button variant="ghost" disabled={!!busy || !!optionalRecord(row.execution).cancel_requested} onClick={() => void action(row.id, 'cancel')}>取消作业</Button> : null}
        {(!row.started || ['disconnected', 'interrupted'].includes(text(row.status)) || optionalRecord(row.execution).cancel_requested) ? <Button variant="ghost" disabled={!!busy} onClick={() => void action(row.id, 'refresh')}>{busy === row.id ? '核对中…' : '核对状态'}</Button> : null}</div> },
    ]} groups={[{ id: 'jobs', label: '作业', rows }]} rowLabel={row => savedRunLabel(row)} showGroups={false} />}
    {(offset > 0 || jobs.data?.next_offset !== null && jobs.data?.next_offset !== undefined) && <div className="hpc-actions">
      <Button variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>上一页</Button>
      <span>共 {text(String(jobs.data?.total ?? 0))} 项</span>
      <Button variant="ghost" disabled={jobs.data?.next_offset == null} onClick={() => setOffset(Number(jobs.data?.next_offset))}>下一页</Button>
    </div>}
    <Dialog open={!!selected} onOpenChange={open => {if(!open)setSelected('');}} title="超算作业详情">
      {detail.isPending ? <LoadingState title="读取保存作业" /> : detail.error ? <ErrorState description={message(detail.error)} action={<Button onClick={() => void detail.refetch()}>重新读取</Button>} /> : detail.data && <dl className="field-scope">
        <div><dt>所属工程</dt><dd>{text(detail.data.workspace_name) || '历史记录未保存工程名称'}</dd></div>
        <div><dt>所属研究</dt><dd>{detail.data.study_href ? <Link to={text(detail.data.study_href)} onClick={() => setSelected('')}>{text(detail.data.study_name)}</Link> : '历史记录未保存研究归属'}</dd></div>
        <div><dt>记录</dt><dd>{detail.data.kind==='preflight' ? '超算预检' : detail.data.sequence ? `运行 ${detail.data.sequence}` : '保存作业'}</dd></div>
        <div><dt>作业号</dt><dd className="field-number">{text(detail.data.job_id) || '尚未分配'}</dd></div>
        <div><dt>状态</dt><dd>{hpcStatus(detail.data.status)}</dd></div>
        <div><dt>已用 / 预算核时</dt><dd className="field-number">{numeric(detail.data.used_core_hours)?.toFixed(5) ?? '未结算'} / {numeric(detail.data.budget_core_hours)?.toFixed(3) ?? '未记录'} 核时</dd></div>
        <div><dt>开始</dt><dd>{localTime(detail.data.started)}</dd></div>
        <div><dt>结束</dt><dd>{detail.data.finished ? localTime(detail.data.finished) : '尚未结束'}</dd></div>
      </dl>}
    </Dialog>
  </section>;
}
