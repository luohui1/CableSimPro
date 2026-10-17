import type { ReactNode } from 'react';
import { displayText } from '@/lib/display-names';
import { Icon } from './icon';
import { StatusMark } from './status-mark';

export function EmptyState({ title = '暂无内容', description = '选择对象或调整筛选条件后查看。', action }: { title?: string; description?: string; action?: ReactNode }) {
  return <div className="state-view" data-state-kind="empty"><Icon name="result/table" className="icon-large" /><h2>{title}</h2><p className="muted">{description}</p>{action}</div>;
}
export function LoadingState({ title = '正在读取数据', description = '正在加载当前页面，请勿重复提交操作。' }: { title?: string; description?: string }) {
  return <div className="state-view" data-state-kind="loading" role="status" aria-busy="true"><StatusMark kind="running" label={title} /><p className="muted">{description}</p><div className="skeleton-lines" aria-hidden="true"><div /><div /><div /></div></div>;
}
export function ErrorState({ title = '数据读取失败', description, action }: { title?: string; description: string; action?: ReactNode }) {
  return <div className="state-view" data-state-kind="error" role="alert"><StatusMark kind="error" label={title} /><p className="muted">{displayText(description)}</p>{action}</div>;
}
export function StaleBanner({ description = '输入已变化，以下为历史结果。', action }: { description?: string; action?: ReactNode }) {
  return <div className="stale-banner" role="status"><StatusMark kind="historical" /><span>{description}</span>{action}</div>;
}
