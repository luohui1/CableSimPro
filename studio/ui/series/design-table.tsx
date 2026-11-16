// The design table: every size of the series side by side, as a structure table reads, with results next to the
// dimensions. One row is the active size the drawing shows; ticked rows are what a batch action applies to.
import { ArrowDown, ArrowUp, CircleAlert, Clock3, Copy, Play, Search, ShieldCheck, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { REVIEW_NAMES } from '@shared/format';
import { pending, problems } from '@shared/products';
import type { RatingCondition, SpecRow } from '@shared/types';
import { reviewTone, tsv, type Column } from './model';

export type Filter = 'all' | 'pending' | 'failed' | 'missing' | 'problems' | 'draft' | 'submitted' | 'reviewed' | 'published';
const SORT_KEY = 'studio.series.sort';

function matches(row: SpecRow, filter: Filter) {
  switch (filter) {
    case 'all': return true;
    case 'pending': return pending(row).length > 0;
    case 'failed': return (row.check?.failed ?? 0) > 0;
    case 'missing': return (row.check?.missing ?? 0) > 0;
    case 'problems': return problems(row).length > 0;
    default: return row.review === filter;
  }
}

function CheckCell({ row }: { row: SpecRow }) {
  if (!row.check) return <span className="ws-faint">未核对</span>;
  const { passed = 0, failed = 0, missing = 0, uncovered = 0 } = row.check;
  const total = Math.max(1, passed + failed + missing + uncovered);
  return <span className="ws-check-cell" title={`通过 ${passed} · 不通过 ${failed} · 缺输入/需实测 ${missing} · 未覆盖 ${uncovered}`}>
    <span className="ws-check-bar">{([['passed', passed], ['failed', failed], ['missing', missing], ['uncovered', uncovered]] as const).map(([verdict, count]) =>
      count ? <i key={verdict} data-verdict={verdict} style={{ width: `${count / total * 100}%` }} /> : null)}</span>
    {failed ? <b className="ws-fail-text">{failed} 不通过</b> : <span>{passed} / {passed + missing + uncovered} 通过</span>}
  </span>;
}

function StateCell({ row }: { row: SpecRow }) {
  const issues = problems(row);
  const waiting = pending(row);
  if (issues.length) return <span className="ws-state-cell" data-state="error" title={issues.join('；')}><CircleAlert size={14} />{issues.length} 项</span>;
  if (waiting.length) return <span className="ws-state-cell" data-state="waiting" title={`待计算：${waiting.length} 类`}><Clock3 size={14} />待算 {waiting.length}</span>;
  return <span className="ws-state-cell" data-state="done"><ShieldCheck size={14} />完整</span>;
}

export function DesignTable({ rows, columns, reference, active, checked, lit, onActivate, onChecked, onCompute, onReview, computing }: {
  rows: SpecRow[]; columns: Column[]; reference: RatingCondition | null; active: string | undefined; checked: string[]; lit: Set<string>;
  onActivate: (id: string) => void; onChecked: (ids: string[]) => void; onCompute: () => void; onReview: () => void; computing: boolean;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ id: string; desc: boolean } | null>(() => { try { return JSON.parse(localStorage.getItem(SORT_KEY) ?? 'null'); } catch { return null; } });
  const [copied, setCopied] = useState('');
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => { try { localStorage.setItem(SORT_KEY, JSON.stringify(sort)); } catch { /* private browsing */ } }, [sort]);

  const visible = useMemo(() => {
    const text = search.trim().toLowerCase().replace(/[x*]/g, '×');
    const found = rows.filter(row => matches(row, filter) && (!text || `${row.key} ${row.name}`.toLowerCase().includes(text)));
    const column = columns.find(item => item.id === sort?.id);
    if (!sort || !column) return found;
    // Empty values go last whichever way the column is sorted.
    return [...found].sort((a, b) => {
      const x = column.value(a), y = column.value(b);
      if (x === null || y === null) return x === null ? (y === null ? 0 : 1) : -1;
      return sort.desc ? y - x : x - y;
    });
  }, [rows, columns, filter, search, sort]);
  const counts = useMemo(() => Object.fromEntries((['pending', 'failed', 'missing', 'problems'] as Filter[]).map(item => [item, rows.filter(row => matches(row, item)).length])), [rows]);
  const groups = columns.reduce<{ name: string; span: number; lit: boolean }[]>((list, column) => {
    const on = column.links.some(link => lit.has(link));
    const last = list[list.length - 1];
    if (last?.name === column.group) { last.span += 1; last.lit ||= on; } else list.push({ name: column.group, span: 1, lit: on });
    return list;
  }, []);
  const checkedVisible = visible.filter(row => checked.includes(row.id));
  const toggle = (id: string) => onChecked(checked.includes(id) ? checked.filter(item => item !== id) : [...checked, id]);
  const copy = async () => {
    const chosen = checked.length ? visible.filter(row => checked.includes(row.id)) : visible;
    try {
      await navigator.clipboard.writeText(tsv(chosen, columns));
      setCopied(`已复制 ${chosen.length} 行，可直接粘贴到 Excel`);
    } catch {
      setCopied('浏览器不允许写入剪贴板');
    }
    setTimeout(() => setCopied(''), 2600);
  };
  const keys = (event: KeyboardEvent) => {
    // Keys typed into a checkbox or the search box keep their own meaning.
    const target = event.target as HTMLElement;
    if (target !== event.currentTarget && !target.classList.contains('ws-key')) return;
    const index = visible.findIndex(row => row.id === active);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = visible[Math.min(visible.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))];
      if (next) onActivate(next.id);
    } else if (event.key === ' ' && active) { event.preventDefault(); toggle(active); }
    else if (event.key === 'Escape') onChecked([]);
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); onChecked(visible.map(row => row.id)); }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') { event.preventDefault(); void copy(); }
  };
  useEffect(() => {
    body.current?.querySelector<HTMLElement>('tr[data-active]')?.scrollIntoView({ block: 'nearest' });
  }, [active, visible.length]);
  const range = (column: Column) => {
    const values = visible.map(column.value).filter((value): value is number => value !== null);
    if (!values.length) return '';
    const [low, high] = [Math.min(...values), Math.max(...values)];
    return low === high ? column.format(low) : `${column.format(low)} – ${column.format(high)}`;
  };
  const chip = (value: Filter, label: string, count?: number, tone?: string) =>
    <button type="button" className="ws-chip" aria-pressed={filter === value} data-tone={tone} onClick={() => setFilter(filter === value ? 'all' : value)}>
      {label}{count !== undefined && <b>{count}</b>}</button>;

  return <section className="ws-table" aria-label="规格对比表">
    <div className="ws-table-bar">
      <div className="ws-table-title"><b>规格</b><span>{visible.length === rows.length ? rows.length : `${visible.length} / ${rows.length}`}</span></div>
      <div className="ws-chips" role="group" aria-label="筛选规格">
        {chip('all', '全部')}
        {counts.pending > 0 && chip('pending', '待计算', counts.pending)}
        {counts.failed > 0 && chip('failed', '不通过', counts.failed, 'fail')}
        {counts.missing > 0 && chip('missing', '需补实测', counts.missing)}
        {counts.problems > 0 && chip('problems', '拒算与告警', counts.problems, 'fail')}
        <select className="ws-select" aria-label="按审核状态筛选" value={['draft', 'submitted', 'reviewed', 'published'].includes(filter) ? filter : ''}
          onChange={event => setFilter((event.target.value || 'all') as Filter)}>
          <option value="">审核状态</option>{Object.entries(REVIEW_NAMES).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
        </select>
      </div>
      <label className="ws-search"><Search size={15} /><input type="search" aria-label="搜索规格" placeholder="截面，如 240" value={search} onChange={event => setSearch(event.target.value)} />
        {search && <button type="button" aria-label="清除搜索" onClick={() => setSearch('')}><X size={14} /></button>}</label>
      <div className="ws-table-actions">
        {copied ? <span role="status" className="ws-copied">{copied}</span> : checked.length > 0 ? <>
          <span className="ws-selection">已选 <b>{checked.length}</b></span>
          <button type="button" className="ws-button" disabled={computing} onClick={onCompute}><Play size={14} />计算选中 {checked.length} 项</button>
          <button type="button" className="ws-button" onClick={onReview}>审核选中项</button>
          <button type="button" className="ws-icon-button" aria-label="复制选中行" title="复制选中行（Ctrl+C）" onClick={() => void copy()}><Copy size={15} /></button>
          <button type="button" className="ws-button" data-variant="ghost" onClick={() => onChecked([])}>清除选择</button>
        </> : <button type="button" className="ws-button" data-variant="ghost" onClick={() => void copy()} title="复制表格（Ctrl+C）"><Copy size={14} />复制表格</button>}
      </div>
    </div>
    <div className="ws-table-scroll" data-scroll-table ref={body} tabIndex={0} onKeyDown={keys} aria-label="规格表，方向键切换规格，空格勾选">
      <table>
        <colgroup><col style={{ width: 36 }} /><col style={{ width: 84 }} /><col style={{ width: 64 }} />{columns.map(column => <col key={column.id} style={{ width: column.width }} />)}<col style={{ width: 150 }} /><col style={{ width: 92 }} /><col style={{ width: 84 }} /></colgroup>
        <thead>
          <tr className="ws-group-row">
            <th colSpan={3} className="ws-sticky-start" />
            {groups.map(group => <th key={group.name} colSpan={group.span} data-lit={group.lit ? '' : undefined}>
              {group.name}{group.name === '载流量' && reference && <span className="ws-group-note">直埋 {reference.depth_m} m · {reference.soil_thermal_resistivity} K·m/W · {reference.ambient_temperature_c} °C</span>}</th>)}
            <th colSpan={3} data-lit={lit.has('check') ? '' : undefined}>核对与审核</th>
          </tr>
          <tr>
            <th className="ws-sticky-start ws-col-check"><input type="checkbox" aria-label="勾选全部可见规格" checked={visible.length > 0 && checkedVisible.length === visible.length}
              ref={element => { if (element) element.indeterminate = checkedVisible.length > 0 && checkedVisible.length < visible.length; }}
              onChange={event => onChecked(event.target.checked ? [...new Set([...checked, ...visible.map(row => row.id)])] : checked.filter(id => !visible.some(row => row.id === id)))} /></th>
            <th className="ws-sticky-key">规格 <span className="ws-unit">mm²</span></th>
            <th>版本</th>
            {columns.map(column => {
              const on = sort?.id === column.id;
              return <th key={column.id} className="ws-num" data-lit={column.links.some(link => lit.has(link)) ? '' : undefined} aria-sort={on ? (sort!.desc ? 'descending' : 'ascending') : 'none'}>
                <button type="button" onClick={() => setSort(on ? (sort!.desc ? null : { id: column.id, desc: true }) : { id: column.id, desc: false })}>
                  {on && (sort!.desc ? <ArrowDown size={13} /> : <ArrowUp size={13} />)}{column.label}{column.unit && <span className="ws-unit">{column.unit}</span>}</button></th>;
            })}
            <th data-lit={lit.has('check') ? '' : undefined}>标准核对</th><th>状态</th><th>审核</th>
          </tr>
        </thead>
        <tbody>
          {visible.map(row => {
            const isActive = row.id === active;
            return <tr key={row.id} data-active={isActive ? '' : undefined} data-checked={checked.includes(row.id) ? '' : undefined} onClick={() => onActivate(row.id)}>
              <td className="ws-sticky-start ws-col-check" onClick={event => event.stopPropagation()}>
                <input type="checkbox" aria-label={`勾选 ${row.key}`} checked={checked.includes(row.id)} onChange={() => toggle(row.id)} /></td>
              <th scope="row" className="ws-sticky-key"><button type="button" className="ws-key" aria-current={isActive ? 'true' : undefined} onClick={event => { event.stopPropagation(); onActivate(row.id); }}>{row.key}</button></th>
              <td className="ws-version">第 {row.version} 版</td>
              {columns.map(column => {
                const value = column.value(row);
                const origin = column.origin?.(row);
                const failed = column.id === 'ampacity' && row.computed.rating === 'error';
                return <td key={column.id} className="ws-num" data-lit={column.links.some(link => lit.has(link)) ? '' : undefined}
                  data-origin={origin && origin.origin !== 'table' ? origin.origin : undefined}
                  title={origin ? `${{ table: '结构表', series: '系列声明', standard: '标准规定' }[origin.origin] ?? origin.origin}${origin.revised ? ' · 工程师修改' : ''}` : undefined}>
                  {origin?.revised && <i className="ws-revised" aria-label="已修改" />}
                  {failed ? <span className="ws-fail-text">拒算</span> : value === null ? <span className="ws-faint">—</span> : column.format(value)}</td>;
              })}
              <td data-lit={lit.has('check') ? '' : undefined}><CheckCell row={row} /></td>
              <td><StateCell row={row} /></td>
              <td><span className="ws-pill" data-tone={reviewTone(row.review)}>{REVIEW_NAMES[row.review]}</span></td>
            </tr>;
          })}
          {!visible.length && <tr className="ws-empty-row"><td colSpan={columns.length + 6}>没有符合条件的规格。<button type="button" onClick={() => { setFilter('all'); setSearch(''); }}>显示全部</button></td></tr>}
        </tbody>
        <tfoot>
          <tr><td className="ws-sticky-start" /><th scope="row" className="ws-sticky-key">范围</th><td />
            {columns.map(column => <td key={column.id} className="ws-num">{range(column)}</td>)}<td colSpan={3} /></tr>
        </tfoot>
      </table>
    </div>
  </section>;
}
