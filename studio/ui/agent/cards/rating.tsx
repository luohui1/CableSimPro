// A run of the calculation in the conversation, read from the host's run record: a rating as the kit's rating card, a sweep or a
// selection as a table, a method that refused in the method's own words. Every number is the record's; nothing is made here.
import { useMutation } from '@tanstack/react-query';
import type { CardRef, RunRecord } from '@shared/types';
import { compact, fixed, PHASE_NAMES } from '@shared/format';
import { reportFailure } from '@/components/notice';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CardAction, CardFrame, CardLoading, OpenInWorkbench, RatingCard, RefusalCard } from '@/kit/chat/cards';
import type { Tier } from '@/kit/marks';
import { api } from '@/state/api';
import { useRun } from '@/state/queries';
import { useOpen } from './open';
import { SectionThumb } from './section-thumb';

type RunRef = Extract<CardRef, { kind: 'run' }>;

export function RunResult({ card }: { card: RunRef }) {
  const run = useRun(card.project, card.run);
  const open = useOpen();
  if (run.isPending) return <CardLoading icon="calc/ampacity" title="载流量结果" />;
  if (run.error) return <RefusalCard kind="error" title="载流量结果" reason={`读不出这条运行记录：${run.error.message}`} actions={<OpenInWorkbench onClick={() => open(card.href)} />} />;
  const record = run.data;
  if (record.kind === 'sweep') return <SweepResult record={record} href={card.href} />;
  if (record.kind === 'selection') return <SelectionResult record={record} href={card.href} />;
  return <RatingResult record={record} card={card} />;
}

function RatingResult({ record, card }: { record: RunRecord; card: RunRef }) {
  const open = useOpen();
  const sheet = useMutation({
    mutationFn: () => api.op<{ url: string }>('report.export', { project: card.project, run: card.run }),
    onSuccess: made => { window.open(made.url, '_blank'); },
    onError: reportFailure,
  });
  const summary = record.summary;
  const cable = record.inputs.cable.name;
  if (!summary || summary.status !== 'succeeded' || !summary.ampacity) {
    return <RefusalCard kind="refused" title={`载流量 · ${cable}`} reason={summary?.error?.message ?? summary?.circuits?.find(circuit => circuit.error)?.error?.message ?? '方法拒绝了这组输入。'}
      actions={<OpenInWorkbench onClick={() => open(card.href)} />} />;
  }
  // The cable at the saved load; when the load could not be held, the cable at the rated current.
  const states = summary.operating?.cables.length ? summary.operating.cables : summary.rated?.cables ?? [];
  const limiting = states.find(item => item.id === summary.ampacity?.limiting_cable) ?? states[0];
  const circuit = summary.circuits?.find(item => item.limiting_cable === summary.ampacity?.limiting_cable);
  const several = (summary.circuits?.length ?? 0) > 1;
  const name = limiting ? [PHASE_NAMES[limiting.phase] ?? limiting.phase, several ? summary.circuits?.find(item => item.id === limiting.circuit)?.label : undefined].filter(Boolean).join(' · ') : '—';
  const held = Boolean(summary.operating?.cables.length);
  return <RatingCard title={`${cable} · 第 ${record.sequence} 条记录`} tier={(record.method_card?.tier.tier ?? 'exploratory') as Tier}
    current={fixed(summary.ampacity.value_a)} basis={summary.ampacity.basis_name ?? ''}
    limiting={{ name, conductor: limiting?.conductor_c ?? 0, limit: limiting?.limit_c ?? 0, ambient: summary.ambient_c ?? 0,
      load: held && limiting ? `${compact(limiting.current_a)} A` : '—', margin: held && circuit?.margin_a !== undefined && circuit.margin_a !== null ? `${fixed(circuit.margin_a)} A` : '—' }}
    figure={<SectionThumb record={record} className="h-auto w-40" />}
    actions={<>
      <CardAction icon="result/report" disabled={sheet.isPending} onClick={() => sheet.mutate()}>计算书</CardAction>
      <OpenInWorkbench onClick={() => open(card.href)} />
    </>} />;
}

function SweepResult({ record, href }: { record: RunRecord; href: string }) {
  const open = useOpen();
  const sweep = record.sweep!;
  return <CardFrame icon="calc/sweep" title={record.title} actions={<OpenInWorkbench onClick={() => open(href)} />} data-card="sweep">
    <Table>
      <TableHeader><TableRow><TableHead>{sweep.label}（{sweep.unit}）</TableHead><TableHead numeric>允许电流 A</TableHead></TableRow></TableHeader>
      <TableBody>{sweep.points.map(point => <TableRow key={point.case_id}>
        <TableCell className="tabular-nums">{compact(point.value)}</TableCell>
        <TableCell numeric>{point.ampacity_a === null || point.ampacity_a === undefined ? <span className="text-attention-ink">{point.error?.message ?? '没有算出'}</span> : fixed(point.ampacity_a)}</TableCell>
      </TableRow>)}</TableBody>
    </Table>
  </CardFrame>;
}

function SelectionResult({ record, href }: { record: RunRecord; href: string }) {
  const open = useOpen();
  const selection = record.selection!;
  return <CardFrame icon="calc/selection" title={record.title} actions={<OpenInWorkbench onClick={() => open(href)} />} data-card="selection">
    <div className="flex flex-col gap-3">
      <p className="m-0 text-sm text-ink">{selection.reason ?? (selection.chosen ? '按目标电流选出满足要求的最小截面。' : '候选里没有满足目标电流的型号。')}</p>
      <Table>
        <TableHeader><TableRow>
          <TableHead>型号</TableHead><TableHead numeric>截面 mm²</TableHead><TableHead numeric>允许电流 A</TableHead><TableHead numeric>满足 {compact(selection.target_current_a)} A</TableHead>
        </TableRow></TableHeader>
        <TableBody>{selection.candidates.map(row => <TableRow key={row.case_id} data-state={row.model_id === selection.chosen ? 'selected' : undefined}>
          <TableCell className={row.model_id === selection.chosen ? 'font-medium' : undefined}>{row.name}</TableCell>
          <TableCell numeric>{compact(row.area_mm2)}</TableCell>
          <TableCell numeric>{row.ampacity_a === null || row.ampacity_a === undefined ? '—' : fixed(row.ampacity_a)}</TableCell>
          <TableCell numeric>{row.meets_target === null || row.meets_target === undefined ? '—' : row.meets_target ? '是' : '否'}</TableCell>
        </TableRow>)}</TableBody>
      </Table>
    </div>
  </CardFrame>;
}
