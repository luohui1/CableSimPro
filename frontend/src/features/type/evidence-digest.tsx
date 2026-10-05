import { Tooltip } from '@/components/ui/tooltip';
import { text } from '@/api/client';

export function EvidenceDigest({ value }: { value: unknown }) {
  const digest = text(value);
  return digest ? <Tooltip content={digest}><span tabIndex={0}>{digest.slice(0, 8)}{digest.length > 8 ? '…' : ''}</span></Tooltip> : <>未提供</>;
}
