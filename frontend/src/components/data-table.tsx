import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icon } from './icon';
import { cn } from '@/lib/cn';
import { displayText, displayUnit } from '@/lib/display-names';
import { composing, interactiveRowSelector, neighborIndex } from '@/lib/ui-interactions';

export type Column<T> = { id: string; label: string; unit?: string; numeric?: boolean; wrap?: boolean; render: (row: T) => ReactNode };
export type RowGroup<T> = { id: string; label: string; rows: T[]; defaultCollapsed?: boolean };

export function DataTable<T extends { id: string }>({ label, columns, groups, selectedId, onSelect, onActivate, rowLabel, density = 'compact', loading, error, showGroups = true, rowClassName }: {
  label: string; columns: Column<T>[]; groups: RowGroup<T>[]; selectedId?: string; onSelect?: (row: T) => void; onActivate?: (row: T) => void; rowLabel: (row: T) => string;
  density?: 'compact' | 'standard'; loading?: boolean; error?: string; showGroups?: boolean; rowClassName?: (row: T) => string | undefined;
}) {
  const id = useId(), scroll = useRef<HTMLDivElement>(null), table = useRef<HTMLTableElement>(null);
  const rows = useRef(new Map<string, HTMLTableRowElement>());
  const [collapsed, setCollapsed] = useState(() => new Set(groups.filter(group => group.defaultCollapsed).map(group => group.id)));
  const [focusKey, setFocusKey] = useState<string | null>(null), [overflow, setOverflow] = useState(false);
  const visible = groups.flatMap(group => showGroups && collapsed.has(group.id) ? [] : group.rows.map(row => ({ row, key: JSON.stringify([group.id, row.id]) })));
  const activeKey = visible.some(entry => entry.key === focusKey) ? focusKey : (visible.find(entry => entry.row.id === selectedId) || visible[0])?.key;
  const interactive = !!onSelect || !!onActivate;
  useEffect(() => {
    const element = scroll.current, content = table.current;
    if (!element || !content) return;
    let frame = 0;
    const measure = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => setOverflow(element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1)); };
    const observer = new ResizeObserver(measure); observer.observe(element); observer.observe(content); measure();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [groups, columns, collapsed, showGroups, loading, error]);
  function focusEntry(index: number) {
    const entry = visible[index];
    if (!entry) return;
    setFocusKey(entry.key); onSelect?.(entry.row); rows.current.get(entry.key)?.focus();
  }
  return <div className="table-region">
    <div ref={scroll} className="table-scroll" data-long={!loading && !error && visible.length > 20} tabIndex={overflow ? 0 : undefined} role={overflow ? 'region' : undefined} aria-label={overflow ? `${label}滚动区域` : undefined} aria-describedby={overflow ? `${id}-scroll-help` : undefined}>
      <table ref={table} className={cn('data-table', `density-${density}`)} aria-label={label} aria-busy={loading || undefined}>
        <thead><tr>{columns.map(column => <th key={column.id} scope="col" className={column.numeric ? 'numeric' : undefined}>{displayText(column.label)}{column.unit && <span className="unit"> / {displayUnit(column.unit)}</span>}</th>)}</tr></thead>
        <tbody>
          {loading ? <tr><td colSpan={columns.length} className="table-state" role="status">正在加载…</td></tr>
            : error ? <tr><td colSpan={columns.length} className="table-state field-error" role="alert">{error}</td></tr>
            : !groups.some(group => group.rows.length) ? <tr><td colSpan={columns.length} className="table-state muted">暂无记录</td></tr>
            : groups.map(group => <Fragment key={group.id}>
              {showGroups && <tr className="group-row"><th colSpan={columns.length} scope="rowgroup"><button type="button" aria-label={`${collapsed.has(group.id) ? '展开' : '收起'}${group.label}`} aria-expanded={!collapsed.has(group.id)} onClick={() => setCollapsed(previous => { const next = new Set(previous); if (next.has(group.id)) next.delete(group.id); else next.add(group.id); return next; })}><Icon name={collapsed.has(group.id) ? 'action/chevron-right' : 'action/chevron-down'} /><strong>{displayText(group.label)}</strong><span className="muted">{group.rows.length} 项</span></button></th></tr>}
              {(!showGroups || !collapsed.has(group.id)) && group.rows.map(row => {
                const key = JSON.stringify([group.id, row.id]);
                return <tr key={row.id} ref={element => { if (element) rows.current.set(key, element); else rows.current.delete(key); }}
                  className={cn('data-row', rowClassName?.(row))} data-selected={selectedId === row.id || undefined} aria-label={rowLabel(row)} aria-selected={onSelect ? selectedId === row.id : undefined}
                  tabIndex={interactive ? activeKey === key ? 0 : -1 : undefined} onFocus={event => { if (event.target === event.currentTarget) setFocusKey(key); }}
                  onClick={event => {
                    if (!interactive || event.defaultPrevented || (event.target instanceof Element && event.target !== event.currentTarget && event.target.closest(interactiveRowSelector))) return;
                    const selection = window.getSelection();
                    if (selection && !selection.isCollapsed && (event.currentTarget.contains(selection.anchorNode) || event.currentTarget.contains(selection.focusNode))) return;
                    setFocusKey(key); event.currentTarget.focus({ preventScroll: true });
                    if (onActivate) onActivate(row); else onSelect?.(row);
                  }}
                  onKeyDown={event => {
                    if (!interactive || event.defaultPrevented || composing(event.nativeEvent) || event.ctrlKey || event.metaKey || event.altKey) return;
                    if (event.target instanceof Element && event.target !== event.currentTarget && event.target.closest(interactiveRowSelector)) return;
                    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (onActivate) onActivate(row); else onSelect?.(row); return; }
                    const next = neighborIndex(visible.findIndex(entry => entry.key === key), visible.length, event.key);
                    if (next !== null) { event.preventDefault(); focusEntry(next); }
                  }}>
                  {columns.map(column => <td key={column.id} className={cn(column.numeric && 'numeric', column.wrap && 'cell-wrap')}>{(() => { const value = column.render(row); return typeof value === 'string' ? displayText(value) : value; })()}</td>)}
                </tr>;
              })}
            </Fragment>)}
        </tbody>
      </table>
    </div>
    {overflow && <p id={`${id}-scroll-help`} className="table-hint">表格可滚动查看，原始记录未裁减。{interactive ? '聚焦记录后可用上下方向键、Home 和 End 移动，Enter 打开或选择。' : '聚焦此区域后可用方向键滚动。'}</p>}
  </div>;
}
