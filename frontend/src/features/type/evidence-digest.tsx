import { Tooltip } from '@/components/ui/tooltip';
import { text } from '@/api/client';

export function EvidenceDigest({ value }: { value: unknown }) {
  const digest = typeof value === 'number' ? String(value) : text(value);
  return digest ? <Tooltip content={digest}><span tabIndex={0}>已记录</span></Tooltip> : <>未提供</>;
}
