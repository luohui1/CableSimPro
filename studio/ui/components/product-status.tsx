import { Badge } from '@mantine/core';
import { REVIEW_NAMES, STATE_NAMES } from '@shared/format';

export function ReviewBadge({ state, count }: { state: string; count?: number }) {
  return <Badge variant="light" color={({ draft: 'gray', submitted: 'orange', reviewed: 'teal', published: 'blue' } as Record<string, string>)[state] ?? 'gray'} radius="sm" size="sm">{REVIEW_NAMES[state] ?? state}{count !== undefined ? ` ${count}` : ''}</Badge>;
}
export function OriginBadge({ origin }: { origin: string }) {
  return <Badge variant="outline" color={origin === 'factory' ? 'blue' : origin === 'public' ? 'cyan' : 'gray'} radius="sm" size="sm">{STATE_NAMES[origin] ?? origin}</Badge>;
}
