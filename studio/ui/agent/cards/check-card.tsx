// The standard check of a series, read from the host: how many items passed, failed or are missing, and each item that failed.
import { useQuery } from '@tanstack/react-query';
import type { CardRef, CheckFailures } from '@shared/types';
import { compact } from '@shared/format';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { api } from '@/state/api';
import { CardFrame } from './frame';

const SHOWN = 8;

function Count({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return <div className="flex flex-col">
    <span className={cn('text-2xl leading-8 font-semibold tabular-nums', value > 0 && tone)}>{value}</span>
    <span className="text-muted-foreground text-sm">{label}</span>
  </div>;
}

export function CheckCard({ card }: { card: Extract<CardRef, { kind: 'check' }> }) {
  const check = useQuery({ queryKey: ['check', card.series, card.specs], staleTime: 5_000,
    queryFn: () => api.op<CheckFailures>('library.check.failures', { series: card.series, ...(card.specs ? { specs: card.specs } : {}) }) });
  if (check.isPending) return <CardFrame title="标准核对" href={card.href}><Skeleton className="h-20 w-full" /></CardFrame>;
  if (check.error) return <CardFrame title="标准核对" href={card.href}><p role="alert" className="text-destructive m-0 text-sm">读不出核对结论：{check.error.message}</p></CardFrame>;
  const data = check.data;
  const more = data.failures.length - SHOWN;
  return <CardFrame title={`标准核对 · ${data.name}`} href={card.href}>
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-x-10 gap-y-3">
        <Count label="通过" value={data.counts.passed} tone="text-success" />
        <Count label="不通过" value={data.counts.failed} tone="text-destructive" />
        <Count label="缺项" value={data.counts.missing} tone="text-attention" />
      </div>
      {data.not_checked.length > 0 && <p className="text-attention m-0 text-sm">{data.not_checked.length} 个规格还没有核对结果。</p>}
      {data.failures.length === 0
        ? data.checked > 0 && <p className="m-0 text-sm">{data.checked} 个规格里没有不通过的项。缺项是缺实测值或依据，不等于不通过。</p>
        : <>
          <Table>
            <TableHeader><TableRow><TableHead>规格</TableHead><TableHead>核对项</TableHead><TableHead>标准条款</TableHead><TableHead className="text-end">限值 / 实测</TableHead></TableRow></TableHeader>
            <TableBody>{data.failures.slice(0, SHOWN).map((item, index) => <TableRow key={`${item.spec}/${item.title}/${index}`}>
              <TableCell className="whitespace-normal">{item.name}</TableCell>
              <TableCell className="whitespace-normal">{item.title}</TableCell>
              <TableCell className="whitespace-normal">{item.standard} {item.clause}{item.page ? `，第 ${item.page} 页` : ''}</TableCell>
              <TableCell className="text-end tabular-nums">{item.limit === null ? '—' : `${item.comparison ?? ''} ${compact(item.limit)}`} / {item.actual === null ? '—' : compact(item.actual)} {item.unit}</TableCell>
            </TableRow>)}</TableBody>
          </Table>
          {more > 0 && <p className="text-muted-foreground m-0 text-sm">另有 {more} 项不通过，在工作台里逐个规格查看。</p>}
        </>}
    </div>
  </CardFrame>;
}
