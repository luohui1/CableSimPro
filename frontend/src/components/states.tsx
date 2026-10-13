import type { ReactNode } from 'react';
import { displayText } from '@/lib/display-names';
import { Icon } from './icon';
import { StatusMark } from './status-mark';
import { illustration } from '@/lib/illustrations';
import { isResultInformation } from '@/lib/notice-level';
import { InformationNotice } from './information-notice';

/**
 * 空状态插画：not-run（尚未计算）、no-results（检索无匹配）、queued（等待计算）、missing-data（缺数据）、
 * plugin（插件）、report（计算书）、simulation（仿真）、standard-check（标准核对）。
 * 未指定时按标题区分：检索无匹配用 no-results，其余「尚无…」用 not-run。
 */
export type EmptyArt = 'not-run' | 'no-results' | 'queued' | 'missing-data' | 'plugin' | 'report' | 'simulation' | 'standard-check';
/**
 * 空状态：图标、一句标题、怎么继续、下一步按钮。默认不配大插图——同一张插图在十几个页面重复、
 * 和内容无关还占半屏（实测 2026-10-09）；只有整页级的空状态才显式传 art。
 */
export function EmptyState({ title = '尚无选型结果', description = '选择候选型号后运行选型。', action, art }: { title?: string; description?: string; action?: ReactNode; art?: EmptyArt }) {
  const src = art ? illustration('empty-' + art) : null;
  return <div className={`state-view state-empty ${src ? 'has-art' : ''}`}>{src ? <img className="state-art" src={src} alt="" /> : <Icon name={/^(没有匹配|未找到)/.test(title) ? 'action/search' : 'status/info'} className="icon-large" />}<h2>{displayText(title)}</h2>{description && <p className="muted">{displayText(description)}</p>}{action}</div>;
}
/** 行内空状态（FRONTEND_REQUIREMENTS §2.4）：一行原因加一个下一步按钮，放在内容区顶部，不配大插图。 */
export function InlineEmpty({ title, action }: { title: string; action?: ReactNode }) {
  return <div className="state-inline" role="status"><Icon name="status/info" /><span>{displayText(title)}</span>{action}</div>;
}
export function LoadingState({ title = '正在读取', description = '' }: { title?: string; description?: string }) {
  return <div className="state-view" role="status" aria-busy="true"><StatusMark kind="running" label={title} />{description && <p className="muted">{description}</p>}<div className="skeleton-lines" aria-hidden="true"><div /><div /><div /></div></div>;
}
export function ErrorState({ title = '结果读取失败', description, action }: { title?: string; description: string; action?: ReactNode }) {
  if (!action && isResultInformation(description))
    return <InformationNotice title="方法说明更新" description={description} />;
  return <div className="state-view" role="alert"><StatusMark kind="error" label={title} /><p className="muted" title={displayText(description)}>{displayText(description)}</p>{action}</div>;
}
export function StaleBanner({ description = '输入已变化，以下为历史结果。', action }: { description?: string; action?: ReactNode }) {
  return <div className="stale-banner" role="status"><StatusMark kind="historical" /><span>{description}</span>{action}</div>;
}
