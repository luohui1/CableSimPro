// A GB 50217 correction of one run's allowed current: each coefficient with its clause and page, the total factor, and the current
// after it. The baseline was confirmed by a person; the card says whose run it stands on.
import { useQuery } from '@tanstack/react-query';
import type { Gb50217Correction } from '@shared/model-types';
import type { CardRef } from '@shared/types';
import { compact, fixed } from '@shared/format';
import { CardFrame, CardLoading, OpenInWorkbench, RefusalCard } from '@/kit/chat/cards';
import { Metric } from '@/kit/metric';
import { TierMark, type Tier } from '@/kit/marks';
import { PropertyList } from '@/kit/properties';
import { SourceTag } from '@/kit/workbench/form';
import { api } from '@/state/api';
import { useOpen } from './open';

export function CorrectionResult({ card }: { card: Extract<CardRef, { kind: 'correction' }> }) {
  const open = useOpen();
  const record = useQuery({ queryKey: ['correction', card.project, card.correction], staleTime: Infinity,
    queryFn: () => api.op<Gb50217Correction>('correction.get', { project: card.project, correction: card.correction }) });
  if (record.isPending) return <CardLoading icon="module/standard-check" title="GB 50217 校正" height="h-40" />;
  if (record.error) return <RefusalCard kind="error" title="GB 50217 校正" reason={`读不出这条校正记录：${record.error.message}`} />;
  const data = record.data;
  return <CardFrame icon="module/standard-check" title="GB 50217 校正" aside={<TierMark tier={data.method_card.tier.tier as Tier} label={data.method_card.tier.label} />}
    actions={<OpenInWorkbench onClick={() => open(card.href)} />} data-card="correction">
    <div className="flex flex-col gap-4">
      <Metric label="校正后允许电流" value={fixed(data.corrected_current_a)} unit="A" detail={`基准 ${fixed(data.baseline.ampacity_a)} A × 总系数 ${compact(data.total_factor)}`} />
      <PropertyList rows={data.coefficients.map(item => ({ label: item.label, value: compact(item.factor),
        source: <SourceTag kind="standard" place={`${item.standard} ${item.clause}${item.printed_page ? ` 第 ${item.printed_page} 页` : ''}`} /> }))} />
    </div>
  </CardFrame>;
}
