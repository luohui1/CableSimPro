// Presentation of saved platform rows only. Reads, calculations and authority remain with the platform bridge.
import { Fragment } from 'react';
import type { CardRef } from '@shared/types';
import { compact, fixed } from '@shared/format';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CardFrame, OpenInWorkbench } from '@/kit/chat/cards';
import { TierMark } from '@/kit/marks';
import { useOpen } from './open';

const STATUS: Record<string, string> = {
  succeeded: '已完成', available: '有保存结果', failed: '失败', unavailable: '不可用', missing: '缺数据',
  not_applicable: '不适用', uncovered: '未覆盖', partial: '部分完成', pending: '待执行', skipped: '已跳过',
};
const FRESHNESS = { current: '读取时与输入一致', historical: '历史输入', unknown: '时效未确认' };

export function SavedRatingTable({ card }: { card: Extract<CardRef, { kind: 'saved_rating_table' }> }) {
  const open = useOpen();
  const { view } = card;
  const rows = view.rows.slice(0, 8);
  const more = Math.max(0, view.total - rows.length);
  return <CardFrame icon="module/rating-table" title={view.title} aside={<TierMark tier="reference" />}
    actions={<OpenInWorkbench onClick={() => open(card.href)} />} data-card="rating-table">
    <p className="m-0 mb-3 text-sm text-ink-2">{view.method} · {FRESHNESS[view.freshness]}</p>
    <Table>
      <TableHeader><TableRow>
        <TableHead>工况</TableHead><TableHead numeric>埋深 m</TableHead><TableHead numeric>热阻率 K·m/W</TableHead>
        <TableHead numeric>环境 °C</TableHead><TableHead numeric>允许电流 A</TableHead><TableHead>状态</TableHead>
      </TableRow></TableHeader>
      <TableBody>{rows.map((row, index) => <Fragment key={`${row.case_id}/${index}`}>
        <TableRow data-case-id={row.case_id}>
          <TableCell className="max-w-xs whitespace-normal">
            <span>{row.name}</span>
            {row.rating_basis && <span className="mt-1 block text-xs text-ink-2">{row.rating_basis}</span>}
          </TableCell>
          <TableCell numeric>{compact(row.depth_m)}</TableCell>
          <TableCell numeric>{compact(row.soil_rho_k_m_w)}</TableCell>
          <TableCell numeric>{compact(row.ambient_temperature_c)}</TableCell>
          <TableCell numeric className="font-medium">{fixed(row.value_a)}</TableCell>
          <TableCell className="whitespace-normal">{STATUS[row.status] ?? row.status}</TableCell>
        </TableRow>
        {row.reason && <TableRow><TableCell colSpan={6} className="whitespace-normal text-attention-ink">{row.reason}</TableCell></TableRow>}
      </Fragment>)}</TableBody>
    </Table>
    {rows.length === 0 && <p className="m-0 mt-3 text-sm text-ink-2">此记录没有可显示的保存工况，请在工作台查看运行诊断。</p>}
    {more > 0 && <p className="m-0 mt-3 text-sm text-ink">此处显示前 {rows.length} 个工况，另有 {more} 个工况可在工作台查看。</p>}
    <p className="m-0 mt-3 text-sm text-ink-2">数值、缺项与原因来自此运行的保存记录。保存记录未声明工程可信分档，按参考结果展示。</p>
  </CardFrame>;
}
