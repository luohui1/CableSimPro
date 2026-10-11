import { Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { studyRuns } from '@/api/research';
import { message } from '@/api/client';
import { Dialog } from './ui/dialog';
import { Button } from './ui/button';
import { LoadingState, ErrorState, EmptyState } from './states';
import { runRecordsContent } from '@/lib/heavy-components';
const Content = runRecordsContent.Component;

export function RunRecordsDrawer({open, onOpenChange, runs, selectedId, onSelect, loading, error, onRetry, workspace, studyId, disabledReason}: {
  open: boolean; onOpenChange: (value: boolean) => void; runs: Record<string, unknown>[]; selectedId?: string; onSelect: (id: string) => void; loading?: boolean; error?: unknown; onRetry?: () => void; workspace?: string; studyId?: string; disabledReason?: string;
}) {
  const history = useQuery({queryKey:['run-history',workspace,studyId], queryFn:({signal}) => studyRuns(workspace!,studyId!,signal,'summary'), enabled:open && !!workspace && !!studyId,
    refetchInterval: query => query.state.data?.some(run => ['accepted','queued','running','validating'].includes(String(run.status))) ? 2000 : false });
  const rows = history.data || runs;
  const problem = history.error || error;
  return <Dialog open={open} onOpenChange={onOpenChange} variant="drawer" title="运行记录" description="查看每次计算保存的输入、方法和结果" initialFocus="form">
    {open && (problem ? <ErrorState title="运行记录读取失败" description={message(problem)} action={<Button onClick={() => {onRetry?.(); void history.refetch();}}>重新读取</Button>} />
      : loading || workspace && studyId && history.isPending ? <LoadingState title="正在读取运行记录" />
      : !rows.length ? <EmptyState title="尚无运行记录" description="完成预检并运行后，这里会保留输入和结果快照。" />
      : <Suspense fallback={<LoadingState title="正在读取运行记录组件" />}><Content runs={rows} selectedId={selectedId} workspace={workspace} studyId={studyId} disabledReason={disabledReason} onSelect={id => {onSelect(id); onOpenChange(false);}} /></Suspense>)}
  </Dialog>;
}
