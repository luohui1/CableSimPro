// The initial structure a product standard gave, kept as a proposal: each dimension with the standard, the table or clause and the page it
// comes from, and what the engineer still has to supply. A value carries its citation only while it is the standard's number.
import { useQuery } from '@tanstack/react-query';
import type { DimensionSource, StructureProposal } from '@shared/model-types';
import type { CardRef } from '@shared/types';
import { compact } from '@shared/format';
import { CardFrame, CardLoading, RefusalCard } from '@/kit/chat/cards';
import { SourceTag } from '@/kit/workbench/form';
import { PropertyList } from '@/kit/properties';
import { api } from '@/state/api';

const place = (source: DimensionSource) => [source.standard, source.clause, source.printed_page ? `第 ${source.printed_page} 页` : undefined].filter(Boolean).join(' ');

export function StandardResult({ card }: { card: Extract<CardRef, { kind: 'standard' }> }) {
  const proposal = useQuery({ queryKey: ['proposal', card.proposal], staleTime: Infinity,
    queryFn: () => api.op<StructureProposal>('structure.proposal', { proposal: card.proposal }) });
  if (proposal.isPending) return <CardLoading icon="module/standard-check" title="按标准生成的结构" height="h-40" />;
  if (proposal.error) return <RefusalCard kind="error" title="按标准生成的结构" reason={`读不出这份标准提案：${proposal.error.message}`} />;
  const data = proposal.data;
  return <CardFrame icon="module/standard-check" title={`${data.standard} · ${data.scope === 'complete' ? '完整结构' : '绝缘厚度'}`} data-card="standard">
    <div className="flex flex-col gap-4">
      <PropertyList rows={data.dimensions.map(item => ({ label: item.label, value: compact(item.value), unit: item.unit,
        source: <SourceTag kind={item.source.kind} place={place(item.source)} /> }))} />
      {data.missing.length > 0 && <p className="m-0 flex items-start gap-2 rounded-lg bg-attention-fill px-3 py-2 text-sm text-ink">
        还缺 {data.missing.length} 项要工程师补：{data.missing.map(item => item.label).join('、')}
      </p>}
    </div>
  </CardFrame>;
}
