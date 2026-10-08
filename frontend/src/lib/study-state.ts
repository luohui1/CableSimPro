import { text } from '@/api/client';
import type { StudyRow } from '@/api/research';
import type { StatusKind } from '@/components/status-mark';
import { isVersionStale } from './version-status';

/**
 * 研究的唯一状态（FRONTEND_REQUIREMENTS §5.5）：首页、列表、待办都从这里取，不各写一套文字。
 * 统一索引接口就绪后改为读宿主算好的状态。
 */
export type StudyState = { code: 'not_run' | 'running' | 'current' | 'outdated' | 'failed'; mark: StatusKind; label: string };

export function studyState(row: StudyRow, latest?: Record<string, unknown>): StudyState {
  if (isVersionStale(row.raw) || isVersionStale(latest)) return { code: 'outdated', mark: 'historical', label: '已过期' };
  if (!latest) return { code: 'not_run', mark: 'draft', label: '未运行' };
  if (latest.freshness === 'historical') return { code: 'outdated', mark: 'historical', label: '已过期' };
  const status = text(latest.status);
  if (['accepted', 'running', 'validating'].includes(status)) return { code: 'running', mark: 'running', label: '运行中' };
  if (['succeeded', 'partial'].includes(status)) return { code: 'current', mark: 'current', label: status === 'partial' ? '当前 · 部分成功' : '当前' };
  return { code: 'failed', mark: 'error', label: '失败' };
}
