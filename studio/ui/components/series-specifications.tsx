import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { REVIEW_NAMES, compact } from '@shared/format';
import type { ProjectView, SpecRow } from '@shared/types';
import { api } from '@/state/api';
import { useProductSeries } from '@/state/queries';
import { Button } from './button';
import { reportFailure } from './notice';

/** The homepage's specification picker; detailed product editing belongs to the series workspace. */
export function SeriesSpecifications({ id, review }: { id: string; review: string }) {
  const series = useProductSeries(id);
  const navigate = useNavigate();
  const open = useMutation({
    mutationFn: (spec: SpecRow) => api.op<ProjectView>('project.create', { name: spec.name, model_id: spec.id }),
    onSuccess: view => void navigate({ to: '/p/$projectId', params: { projectId: view.meta.id }, search: {} }),
    onError: reportFailure,
  });

  if (series.isPending) return <p role="status" className="m-0 py-4 text-14">正在读取规格…</p>;
  if (series.error) return <div role="alert" className="flex flex-wrap items-center gap-3 py-4">
    <p className="m-0 text-14 text-error">{series.error.message}</p>
    <Button size="compact" onClick={() => void series.refetch()}>重新读取规格</Button>
  </div>;
  const { declaration, specs } = series.data;
  const visible = specs.filter(spec => review === 'all' || spec.review === review);
  return <section aria-label="系列规格" className="grid gap-4 py-4">
    <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-14">
      <h2 className="m-0 text-16 font-strong">选择规格，打开断面工作台</h2>
      {declaration.standards.length > 0 && <span>{declaration.standards.join('、')}</span>}
    </div>
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {visible.map(spec => <Button key={spec.id} className="h-auto min-h-12 justify-between rounded-field px-3 py-2" disabled={open.isPending}
        aria-label={`${spec.key}，第 ${spec.version} 版，${REVIEW_NAMES[spec.review]}，打开断面工作台`}
        busy={open.isPending && open.variables?.id === spec.id} onClick={() => open.mutate(spec)}>
        <span className="font-strong">{spec.key} mm²</span>
        <span className="text-14">第 {spec.version} 版 · {REVIEW_NAMES[spec.review]}</span>
      </Button>)}
    </div>
    <details className="text-14">
      <summary className="w-fit cursor-pointer">系列声明与资料来源</summary>
      <dl className="m-0 mt-3 grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-6">
        <dt>制造商</dt><dd className="m-0">{declaration.manufacturer || '未声明'}</dd>
        <dt>额定电压</dt><dd className="m-0">{compact(declaration.u0_v / 1000)} / {compact(declaration.u_v / 1000)} kV · {declaration.cores} 芯</dd>
        <dt>资料</dt><dd className="m-0 break-words">{declaration.source?.title || '随软件提供的结构'}</dd>
        {declaration.source?.location && <><dt>位置</dt><dd className="m-0 break-words">{declaration.source.location}</dd></>}
        {declaration.source?.sha256 && <><dt>资料摘要</dt><dd className="m-0 break-all font-mono text-14">{declaration.source.sha256}</dd></>}
      </dl>
    </details>
  </section>;
}
