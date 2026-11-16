// A run of the calculation, read from the host's run record: the allowed current, which cable reaches its limit first, the trust
// tier of the method, and the laying. A sweep or a selection shows its table instead.
import type { CardRef, RunRecord } from '@shared/types';
import { compact, fixed, PHASE_NAMES } from '@shared/format';
import { Seal } from '@/components/marks';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useRun } from '@/state/queries';
import { CardFrame } from './frame';
import { SectionThumb } from './section-thumb';

type RunRef = Extract<CardRef, { kind: 'run' }>;

export function RunCard({ card }: { card: RunRef }) {
  const run = useRun(card.project, card.run);
  if (run.isPending) return <CardFrame title="载流量结果" href={card.href}><Skeleton className="h-24 w-full" /></CardFrame>;
  if (run.error) return <CardFrame title="载流量结果" href={card.href}><p role="alert" className="text-destructive m-0 text-sm">读不出这条运行记录：{run.error.message}</p></CardFrame>;
  const record = run.data;
  if (record.kind === 'sweep') return <SweepCard record={record} href={card.href} />;
  if (record.kind === 'selection') return <SelectionCard record={record} href={card.href} />;
  return <RatingCard record={record} href={card.href} />;
}

function RatingCard({ record, href }: { record: RunRecord; href: string }) {
  const summary = record.summary;
  const tier = record.method_card?.tier;
  if (!summary || summary.status !== 'succeeded' || !summary.ampacity) {
    return <CardFrame title={`校核 · 第 ${record.sequence} 条记录`} href={href}>
      <p className="m-0 text-sm">这组输入没有算出载流量：{summary?.error?.message ?? '方法拒绝了这组输入。'}</p>
    </CardFrame>;
  }
  const limiting = summary.operating?.cables.find(cable => cable.id === summary.ampacity?.limiting_cable);
  const name = limiting ? PHASE_NAMES[limiting.phase] ?? limiting.phase : summary.ampacity.limiting_cable;
  return <CardFrame title={record.title.split(' · ')[0] + ` · 第 ${record.sequence} 条记录`} href={href}
    aside={tier && <Seal tier={tier.tier} label={tier.label} />}>
    <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
      <SectionThumb record={record} className="h-auto w-44 shrink-0" />
      <dl className="m-0 grid min-w-0 flex-1 grid-cols-[auto_1fr] items-baseline gap-x-6 gap-y-2 text-sm">
        <dt className="text-muted-foreground">允许电流</dt>
        <dd className="m-0 text-2xl leading-8 font-semibold tabular-nums">{fixed(summary.ampacity.value_a)} <span className="text-sm font-normal">A</span></dd>
        <dt className="text-muted-foreground">先到温限</dt>
        <dd className="m-0">{name}{limiting && <span className="text-muted-foreground">，保存负荷 {compact(limiting.current_a)} A 下导体 {fixed(limiting.conductor_c)} °C，限值 {fixed(limiting.limit_c, 0)} °C</span>}</dd>
        {summary.circuits && summary.circuits.length > 1 && <>
          <dt className="text-muted-foreground">回路</dt>
          <dd className="m-0">{summary.circuits.length} 回，按全部回路同时带载计算</dd>
        </>}
      </dl>
    </div>
  </CardFrame>;
}

function SweepCard({ record, href }: { record: RunRecord; href: string }) {
  const sweep = record.sweep!;
  return <CardFrame title={record.title} href={href}>
    <Table>
      <TableHeader><TableRow><TableHead>{sweep.label}（{sweep.unit}）</TableHead><TableHead className="text-end">允许电流 A</TableHead></TableRow></TableHeader>
      <TableBody>{sweep.points.map(point => <TableRow key={point.case_id}>
        <TableCell className="tabular-nums">{compact(point.value)}</TableCell>
        <TableCell className="text-end tabular-nums">{point.ampacity_a === null || point.ampacity_a === undefined ? <span className="text-muted-foreground">{point.error?.message ?? '未算出'}</span> : fixed(point.ampacity_a)}</TableCell>
      </TableRow>)}</TableBody>
    </Table>
  </CardFrame>;
}

function SelectionCard({ record, href }: { record: RunRecord; href: string }) {
  const selection = record.selection!;
  return <CardFrame title={record.title} href={href}>
    <p className="m-0 mb-3 text-sm">{selection.reason ?? (selection.chosen ? '按目标电流选出满足要求的最小截面。' : '候选里没有满足目标电流的型号。')}</p>
    <Table>
      <TableHeader><TableRow><TableHead>型号</TableHead><TableHead className="text-end">截面 mm²</TableHead><TableHead className="text-end">允许电流 A</TableHead><TableHead className="text-end">满足 {compact(selection.target_current_a)} A</TableHead></TableRow></TableHeader>
      <TableBody>{selection.candidates.map(row => <TableRow key={row.case_id} data-state={row.model_id === selection.chosen ? 'selected' : undefined}>
        <TableCell className={row.model_id === selection.chosen ? 'font-medium' : undefined}>{row.name}</TableCell>
        <TableCell className="text-end tabular-nums">{compact(row.area_mm2)}</TableCell>
        <TableCell className="text-end tabular-nums">{row.ampacity_a === null || row.ampacity_a === undefined ? <span className="text-muted-foreground">未算出</span> : fixed(row.ampacity_a)}</TableCell>
        <TableCell className="text-end">{row.meets_target === null || row.meets_target === undefined ? '—' : row.meets_target ? '是' : '否'}</TableCell>
      </TableRow>)}</TableBody>
    </Table>
  </CardFrame>;
}
