import type { ReactNode } from 'react';
import { displayText } from '@/lib/display-names';
import { IconButton } from './ui/button';
import { SourceBadge, type SourceKind } from './source-badge';
export type PropertyGroup = { label: string; items: { label: string; value: ReactNode; unit?: string; source?: SourceKind; sourceDetail?: string; stacked?: boolean }[] };
/** 文字长的行（条件、原因、范围）改成标签在上、正文换行，不截断。 */
const stackedRow = (item: PropertyGroup["items"][number]) => item.stacked ?? (typeof item.value === "string" && item.label.length + item.value.length > 24);

/** summary：名称后的摘要；extra：分组后的关联等附加内容。旧调用均为可选。 */
export function PropertyPanel({ title, groups, collapsed, onToggle, empty, summary, extra }: { title: string; groups: PropertyGroup[]; collapsed: boolean; onToggle: () => void; empty?: boolean; summary?: ReactNode; extra?: ReactNode }) {
  return <aside className={`property-panel ${collapsed ? 'property-collapsed' : ''}`} aria-label="所选对象属性">
    {collapsed ? <IconButton icon="action/chevron-right" label="展开属性面板" variant="ghost" onClick={onToggle} /> : <><header><h2>{title}</h2><IconButton icon="action/chevron-right" label="收起属性面板" variant="ghost" onClick={onToggle} /></header>{!empty && summary}{empty ? <p className="property-empty muted">选择候选查看属性</p> : groups.map(group => <section key={group.label}><h3>{group.label}</h3><dl>{group.items.map(item => <div className={stackedRow(item) ? "property-row is-stacked" : "property-row"} key={item.label}><dt>{item.label}</dt><dd>{typeof item.value === 'string' ? displayText(item.value) : item.value}{item.unit && <span className="unit">{item.unit}</span>}{item.source && <SourceBadge kind={item.source} detail={item.sourceDetail} />}</dd></div>)}</dl></section>)}{!empty && extra}</>}
  </aside>;
}
