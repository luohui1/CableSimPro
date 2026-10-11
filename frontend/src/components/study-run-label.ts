import { text, numeric } from '@/api/client';
import { formatDateTime } from '@/lib/format';
import { readableRunName } from '@/lib/status-vocabulary';

/** Saved sequence and timestamp identify a run, never its current study name. */
export function savedRunLabel(run: Record<string, unknown>, fallback = '保存运行') {
  const sequence = numeric(run.sequence);
  const name = sequence !== null ? readableRunName(`保存研究 · 运行 ${sequence}`) : fallback;
  return `${name} · ${formatDateTime(text(run.created))}`;
}
