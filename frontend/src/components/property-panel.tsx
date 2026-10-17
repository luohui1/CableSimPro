import type { ReactNode } from 'react';
import { displayText } from '@/lib/display-names';
import { Icon } from './icon';
import { IconButton } from './ui/button';
import { SourceBadge, type SourceKind } from './source-badge';
export type PropertyGroup = { label: string; items: { label: string; value: ReactNode; unit?: string; source?: SourceKind; sourceDetail?: string }[] };

export function PropertyPanel({ title, groups, collapsed, onToggle, empty }: { title: string; groups: PropertyGroup[]; collapsed: boolean; onToggle: () => void; empty?: boolean }) {
  return <aside className={`property-panel ${collapsed ? 'property-collapsed' : ''}`} aria-label="所选对象属性">
    {collapsed ? <button type="button" className="button button-ghost button-compact" aria-label="展开属性面板" aria-expanded={false} onClick={onToggle}><Icon name="action/chevron-right" /><span className="property-toggle-label">对象属性</span></button>
      : <><header><h2 title={title}>{title}</h2><IconButton icon="action/chevron-right" label="收起属性面板" variant="ghost" onClick={onToggle} aria-expanded={true} /></header>
        {empty ? <p className="property-empty muted">选择表格、图形或场景中的对象查看属性。</p> : groups.map(group => <section key={group.label}><h3>{group.label}</h3><dl>{group.items.map(item => <div className="property-row" key={item.label}><dt>{item.label}</dt><dd><span className="property-value">{typeof item.value === 'string' ? displayText(item.value) : item.value}</span>{item.unit && <span className="unit">{item.unit}</span>}{item.source && <SourceBadge kind={item.source} detail={item.sourceDetail} />}</dd></div>)}</dl></section>)}
      </>}
  </aside>;
}
