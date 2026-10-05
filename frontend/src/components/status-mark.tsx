import { useState, type ReactNode } from 'react';
import { MotionGlyph, MotionReveal } from './motion';
import { Icon } from './icon';

export const statusLabels = { current: '当前', saved: '已保存', historical: '历史', draft: '草稿', queued: '排队', running: '执行中', success: '成功', partial: '部分成功', error: '失败', stopped: '中断', proposal: '待审核', locked: '已锁定', conflict: '版本冲突', invalid: '完整性失败', satisfied: '满足', unsatisfied: '不满足', inapplicable: '不适用', unknown: '无法判断' } as const;
export type StatusKind = keyof typeof statusLabels;

export function StatusMark({ kind, label, detail }: { kind: StatusKind; label?: string; detail?: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const verdict = ['satisfied', 'unsatisfied', 'inapplicable', 'unknown'].includes(kind);
  const content = <><span className={`status-symbol symbol-${kind}`} aria-hidden="true">{kind === 'running' && <MotionGlyph kind="running" />}</span><span>{label || statusLabels[kind]}</span>{detail && <Icon name="action/chevron-down" className={expanded ? 'rotated' : undefined} />}</>;
  return <span className={`status-wrap status-${kind}`} onKeyDown={event => { if (event.key === 'Escape' && expanded) { event.preventDefault(); event.stopPropagation(); setExpanded(false); } }}>
    {detail ? <button className="status-mark" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{content}</button> : <span className={`status-mark ${verdict ? 'is-verdict' : ''}`}>{content}</span>}
    {detail && <MotionReveal open={expanded} className="status-detail" kind="drawer">{detail}</MotionReveal>}
  </span>;
}
