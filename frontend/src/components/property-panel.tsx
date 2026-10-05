import type { ReactNode } from 'react';
import { displayText } from '@/lib/display-names';
import { IconButton } from './ui/button';
import { SourceBadge, type SourceKind } from './source-badge';
export type PropertyGroup = { label: string; items: { label: string; value: ReactNode; unit?: string; source?: SourceKind; sourceDetail?: string }[] };

export function PropertyPanel({ title, groups, collapsed, onToggle, empty }: { title: string; groups: PropertyGroup[]; collapsed: boolean; onToggle: () => void; empty?: boolean }) {
  return <aside className={`property-panel ${collapsed ? 'property-collapsed' : ''}`} aria-label="所选对象属性">
    {collapsed ? <IconButton icon="action/chevron-right" label="展开属性面板" variant="ghost" onClick={onToggle} /> : <><header><h2>{title}</h2><IconButton icon="action/chevron-right" label="收起属性面板" variant="ghost" onClick={onToggle} /></header>{empty ? <p className="property-empty muted">选择候选查看属性</p> : groups.map(group => <section key={group.label}><h3>{group.label}</h3><dl>{group.items.map(item => <div className="property-row" key={item.label}><dt>{item.label}</dt><dd>{typeof item.value === 'string' ? displayText(item.value) : item.value}{item.unit && <span className="unit">{item.unit}</span>}{item.source && <SourceBadge kind={item.source} detail={item.sourceDetail} />}</dd></div>)}</dl></section>)}</>}
  </aside>;
}
