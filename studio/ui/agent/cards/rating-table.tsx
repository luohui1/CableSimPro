// An ampacity table kept on a specification version, as it was saved: each laying condition, the allowed current the method gave for it,
// how far that can be trusted, or the method's own words where it refused. Nothing is estimated for a condition the method did not cover.
import { useQuery } from '@tanstack/react-query';
import type { RatingTable } from '@shared/model-types';
import type { CardRef } from '@shared/types';
import { compact, fixed } from '@shared/format';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CardFrame, CardLoading, OpenInWorkbench, RefusalCard } from '@/kit/chat/cards';
import { TierMark, type Tier } from '@/kit/marks';
import { api } from '@/state/api';
import { useOpen } from './open';

const SHOWN = 8;

export function RatingTableResult({ card }: { card: Extract<CardRef, { kind: 'rating_table' }> }) {
  const open = useOpen();
  const tables = useQuery({ queryKey: ['rating-tables', card.spec, card.version], staleTime: 5_000,
    queryFn: () => api.op<RatingTable[]>('library.rating.tables', { spec: card.spec, version: card.version }) });
  if (tables.isPending) return <CardLoading icon="module/rating-table" title="载流量表" height="h-40" />;
  if (tables.error) return <RefusalCard kind="error" title="载流量表" reason={`读不出这张载流量表：${tables.error.message}`} />;
  const table = tables.data.find(item => item.id === card.table);
  if (!table) return <RefusalCard kind="error" title="载流量表" reason="这张载流量表已经不在这个版本上。" />;
  const more = table.rows.length - SHOWN;
  return <CardFrame icon="module/rating-table" title={`${table.title} · 第 ${table.version} 版`} actions={<OpenInWorkbench onClick={() => open(card.href)} />} data-card="rating-table">
    <Table>
      <TableHeader><TableRow>
        <TableHead>敷设</TableHead><TableHead numeric>埋深 m</TableHead><TableHead numeric>土壤热阻率 K·m/W</TableHead><TableHead numeric>环境 °C</TableHead>
        <TableHead numeric>允许电流 A</TableHead><TableHead>可信分档</TableHead>
      </TableRow></TableHeader>
      <TableBody>{table.rows.slice(0, SHOWN).map(row => <TableRow key={row.id}>
        <TableCell>{row.layout_label}</TableCell>
        <TableCell numeric>{compact(row.depth_m)}</TableCell>
        <TableCell numeric>{compact(row.soil_thermal_resistivity)}</TableCell>
        <TableCell numeric>{compact(row.ambient_temperature_c)}</TableCell>
        {row.status === 'succeeded' && row.ampacity_a !== null
          ? <>
            <TableCell numeric className="font-medium">{fixed(row.ampacity_a)}</TableCell>
            <TableCell>{row.tier && <TierMark tier={row.tier as Tier} label={row.tier_label ?? undefined} />}</TableCell>
          </>
          : <TableCell colSpan={2} className="whitespace-normal text-attention-ink">没有算：{row.error?.message ?? '方法没有给出允许电流'}</TableCell>}
      </TableRow>)}</TableBody>
    </Table>
    {more > 0 && <p className="m-0 mt-3 text-sm text-ink">另有 {more} 个条件，在工作台查看。</p>}
  </CardFrame>;
}
