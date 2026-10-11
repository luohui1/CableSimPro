import { text } from '@/api/client';
import type { StudyRow } from '@/api/research';
import type { StatusKind } from '@/components/status-mark';
import { isVersionStale } from './version-status';
import { STATUS_WORDS } from './status-vocabulary';

/**
 * 研究的唯一状态（FRONTEND_REQUIREMENTS §5.5）：首页、列表、待办都从这里取，不各写一套文字。
 * 统一索引接口就绪后改为读宿主算好的状态。
 */
export type StudyState = { code: 'not_run' | 'running' | 'current' | 'outdated' | 'failed'; mark: StatusKind; label: string };

export function studyState(row: StudyRow, latest?: Record<string, unknown>): StudyState {
  if (isVersionStale(row.raw) || isVersionStale(latest)) return { code: 'outdated', mark: 'historical', label: STATUS_WORDS.outdated };
  if (!latest) return { code: 'not_run', mark: 'draft', label: STATUS_WORDS.not_run };
  if (latest.freshness === 'historical') return { code: 'outdated', mark: 'historical', label: STATUS_WORDS.outdated };
  const status = text(latest.status);
  if (['accepted', 'queued', 'running', 'validating'].includes(status)) return { code: 'running', mark: 'running', label: STATUS_WORDS.running };
  if (['succeeded', 'partial'].includes(status)) return { code: 'current', mark: 'current', label: status === 'partial' ? `${STATUS_WORDS.current} · ${STATUS_WORDS.partial}` : STATUS_WORDS.current };
  return { code: 'failed', mark: 'error', label: STATUS_WORDS.failed };
}
