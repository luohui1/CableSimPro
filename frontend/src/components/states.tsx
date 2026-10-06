import type { ReactNode } from 'react';
import { displayText } from '@/lib/display-names';
import { Icon } from './icon';
import { StatusMark } from './status-mark';
import { illustration } from '@/lib/illustrations';

/**
 * 空状态插画：not-run（尚未计算）、no-results（检索无匹配）、queued（等待计算）、missing-data（缺数据）、
 * plugin（插件）、report（计算书）、simulation（仿真）、standard-check（标准核对）。
 * 未指定时按标题区分：检索无匹配用 no-results，其余「尚无…」用 not-run。
 */
export type EmptyArt = 'not-run' | 'no-results' | 'queued' | 'missing-data' | 'plugin' | 'report' | 'simulation' | 'standard-check';
export function EmptyState({ title = '尚无选型结果', description = '选择候选型号后运行选型。', action, art }: { title?: string; description?: string; action?: ReactNode; art?: EmptyArt }) {
  const src = illustration('empty-' + (art || (/^(没有匹配|未找到)/.test(title) ? 'no-results' : 'not-run')));
  return <div className="state-view state-empty">{src ? <img className="state-art" src={src} alt="" /> : <Icon name="result/table" className="icon-large" />}<h2>{title}</h2>{description && <p className="muted">{description}</p>}{action}</div>;
}
export function LoadingState({ title = '正在读取选型结果', description = '已保存输入保留，可稍后查看。' }: { title?: string; description?: string }) {
  return <div className="state-view" role="status" aria-busy="true"><StatusMark kind="running" label={title} /><p className="muted">{description}</p><div className="skeleton-lines" aria-hidden="true"><div /><div /><div /></div></div>;
}
export function ErrorState({ title = '结果读取失败', description, action }: { title?: string; description: string; action?: ReactNode }) {
  return <div className="state-view" role="alert"><StatusMark kind="error" label={title} /><p className="muted">{displayText(description)}</p>{action}</div>;
}
export function StaleBanner({ description = '输入已变化，以下为历史结果。', action }: { description?: string; action?: ReactNode }) {
  return <div className="stale-banner" role="status"><StatusMark kind="historical" /><span>{description}</span>{action}</div>;
}
