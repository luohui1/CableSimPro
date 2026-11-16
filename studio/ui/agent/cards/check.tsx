// The standard check of a series, read from the host: how many items passed, failed or are missing, and the items that failed.
import { useQuery } from '@tanstack/react-query';
import type { CardRef, CheckFailures } from '@shared/types';
import { compact } from '@shared/format';
import { CheckCard, CardLoading, OpenInWorkbench, RefusalCard } from '@/kit/chat/cards';
import { api } from '@/state/api';
import { useOpen } from './open';

const SHOWN = 8;

export function CheckResult({ card }: { card: Extract<CardRef, { kind: 'check' }> }) {
  const open = useOpen();
  const check = useQuery({ queryKey: ['check', card.series, card.specs], staleTime: 5_000,
    queryFn: () => api.op<CheckFailures>('library.check.failures', { series: card.series, ...(card.specs ? { specs: card.specs } : {}) }) });
  if (check.isPending) return <CardLoading icon="module/standard-check" title="标准核对" />;
  if (check.error) return <RefusalCard kind="error" title="标准核对" reason={`读不出核对结论：${check.error.message}`} actions={<OpenInWorkbench onClick={() => open(card.href)} />} />;
  const data = check.data;
  const value = (amount: number | null) => (amount === null ? '—' : compact(amount));
  return <CheckCard title={`标准核对 · ${data.name}`} counts={data.counts} unchecked={data.not_checked.length} more={data.failures.length - SHOWN}
    failures={data.failures.slice(0, SHOWN).map(item => ({
      title: item.title, scope: item.name,
      actual: `${value(item.actual)} ${item.unit}`.trim(), required: `${item.comparison ?? ''} ${value(item.limit)} ${item.unit}`.trim(),
      clause: `${item.standard} ${item.clause}${item.page ? `，第 ${item.page} 页` : ''}`,
    }))}
    actions={<OpenInWorkbench onClick={() => open(card.href)} />} />;
}
