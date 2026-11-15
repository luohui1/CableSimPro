import { AllCommunityModule, themeQuartz, type ColDef, type GridApi } from 'ag-grid-community';
import { AG_GRID_LOCALE_CN } from '@ag-grid-community/locale';
import { AgGridProvider, AgGridReact } from 'ag-grid-react';
import { useEffect, useRef, useState } from 'react';
import { compact, fixed, REVIEW_NAMES } from '@shared/format';
import { pending, problems } from '@shared/products';
import type { SpecRow } from '@shared/types';
import { ProductIcon } from './product-controls';
import { Badge } from '@mantine/core';
import { ReviewBadge } from './product-status';

export interface GridPreferences { view: string; sizes: Record<string, number>; sorting: { id: string; desc: boolean }[] }
export const GRID_VIEWS = { overview: '概览', structure: '结构参数', values: '计算结果', checks: '核对与审核' };
const COLUMNS: Record<string, string[]> = {
  overview: ['key', 'version', 'outer_diameter_mm', 'ampacity_a', 'check', 'readiness', 'review'],
  structure: ['key', 'version', 'outer_diameter_mm', 'r20_ohm_km', 'weight_kg_km', 'readiness', 'review'],
  values: ['key', 'ac_resistance_ohm_km', 'short_circuit_ka', 'ampacity_a', 'readiness', 'review'],
  checks: ['key', 'version', 'check', 'readiness', 'review'],
};
const gridTheme = themeQuartz.withParams({
  fontFamily: 'Noto Sans SC Variable, Segoe UI, sans-serif', fontSize: 14, headerFontSize: 13, headerFontWeight: 600,
  backgroundColor: 'var(--panel)', foregroundColor: 'var(--text)', headerBackgroundColor: 'var(--ground)', headerTextColor: 'var(--text-secondary)',
  borderColor: 'var(--line)', rowBorder: true, wrapperBorder: false, wrapperBorderRadius: 0,
  accentColor: '#1971c2', selectedRowBackgroundColor: 'var(--product-selected)', rowHoverColor: 'var(--product-hover)',
  cellHorizontalPadding: 12, spacing: 6, checkboxBorderRadius: 3,
});
const localeText = { ...AG_GRID_LOCALE_CN, noRowsToShow: '没有匹配的规格，请调整搜索或筛选。', loadingOoo: '正在读取规格…' };
export function matchesSpec(row: SpecRow, filter: string) {
  return filter === 'all' || (filter === 'problems' ? problems(row).length > 0 : filter === 'pending' ? pending(row).length > 0 : filter === 'missing' ? (row.check?.missing ?? 0) > 0 : filter === 'failed' ? (row.check?.failed ?? 0) > 0 : row.review === filter);
}

export function ProductGrid({ rows, search, filter, view, inspected, preferences, selected, onSelection, onInspect, onPreferences, onCount }: {
  rows: SpecRow[]; search: string; filter: string; view: string; inspected?: string; preferences: GridPreferences; selected: string[];
  onSelection: (ids: string[]) => void; onInspect: (id: string, tab?: string) => void; onPreferences: (values: Partial<GridPreferences>) => void; onCount: (count: number) => void;
}) {
  const [api, setApi] = useState<GridApi<SpecRow>>();
  const inspect = useRef(onInspect);
  inspect.current = onInspect;
  const filters = useRef(filter);
  filters.current = filter;
  const [columnDefs] = useState<ColDef<SpecRow>[]>(() => {
    const number = (field: keyof SpecRow, name: string, width: number, formatter = compact): ColDef<SpecRow> => ({
      field, headerName: name, minWidth: width, type: 'numericColumn', filter: 'agNumberColumnFilter',
      valueFormatter: params => formatter(params.value),
    });
    const defs: ColDef<SpecRow>[] = [
      { colId: 'key', headerName: '规格 mm²', valueGetter: params => params.data?.area_mm2, initialWidth: 110, minWidth: 110, pinned: 'left', lockPinned: true, filter: 'agNumberColumnFilter',
        cellRenderer: ({ data }: { data: SpecRow }) => <button className="spec-key" type="button" onClick={() => inspect.current(data.id)}>{data.key}</button>, getQuickFilterText: params => `${params.data?.key} ${params.data?.name}` },
      { field: 'version', headerName: '版本', minWidth: 76, valueFormatter: params => `第 ${params.value} 版` },
      number('outer_diameter_mm', '外径 mm', 100, value => compact(value, 5)),
      number('r20_ohm_km', 'R20 Ω/km', 116, value => compact(value, 6)),
      number('weight_kg_km', '重量 kg/km', 126, value => compact(value, 6)),
      number('ac_resistance_ohm_km', '交流电阻 Ω/km', 145, value => compact(value, 6)),
      number('short_circuit_ka', '1 s 短路 kA', 130, value => fixed(value, 2)),
      number('ampacity_a', '基准载流量 A', 140, value => fixed(value, 1)),
      { colId: 'check', headerName: '标准核对', minWidth: 150, valueGetter: params => params.data?.check?.failed ?? -1,
        cellRenderer: ({ data }: { data: SpecRow }) => <button type="button" className="spec-check" aria-label={`查看 ${data.key} 标准核对`} onClick={() => inspect.current(data.id, 'checks')}>{data.check ? <><Badge color={data.check.failed ? 'red' : 'teal'} size="sm" variant="light">{data.check.failed ? `${data.check.failed} 项不通过` : `${data.check.passed ?? 0} 项通过`}</Badge><span className="text-ink-2">缺 {data.check.missing ?? 0}</span></> : <Badge color="gray" variant="light" size="sm">未核对</Badge>}</button> },
      { colId: 'readiness', headerName: '计算 / 问题', minWidth: 148, sortable: false, filter: false,
        cellRenderer: ({ data }: { data: SpecRow }) => { const errors = problems(data); const waiting = pending(data); return <span className={`spec-readiness ${errors.length ? 'text-error' : 'text-ink-2'}`} title={errors.join('；')}><ProductIcon name={errors.length ? 'warning' : waiting.length ? 'action/history' : 'action/check'} />{errors.length ? `${errors.length} 项需处理` : waiting.length ? `待计算 ${waiting.length} 类` : '计算已完成'}</span>; } },
      { field: 'review', headerName: '审核状态', minWidth: 106, cellRenderer: ({ data }: { data: SpecRow }) => <ReviewBadge state={data.review} />, valueFormatter: params => REVIEW_NAMES[params.value] },
    ];
    return defs.map(def => { const id = def.colId ?? def.field!; const sorting = preferences.sorting.find(item => item.id === id); return { ...def, initialHide: !(COLUMNS[view] ?? COLUMNS.overview).includes(id), initialWidth: preferences.sizes[id] ?? def.initialWidth, initialFlex: def.pinned || preferences.sizes[id] ? 0 : 1, initialSort: sorting ? sorting.desc ? 'desc' : 'asc' : undefined }; });
  });
  useEffect(() => { api?.onFilterChanged(); }, [api, filter]);
  useEffect(() => { if (!api) return; const shown = COLUMNS[view] ?? COLUMNS.overview; api.setColumnsVisible(columnDefs.map(column => column.colId ?? column.field!).filter(id => !shown.includes(id)), false); api.setColumnsVisible(shown, true); }, [api, view, columnDefs]);
  useEffect(() => { if (!selected.length) api?.deselectAll(); }, [api, selected.length]);
  useEffect(() => { api?.redrawRows(); }, [api, inspected]);
  return <div data-scroll-table className="product-grid" aria-label="产品规格表">
    <AgGridProvider modules={[AllCommunityModule]}><AgGridReact<SpecRow>
      theme={gridTheme} rowData={rows} columnDefs={columnDefs} defaultColDef={{ resizable: true, sortable: true, filter: true, suppressMovable: false, getQuickFilterText: () => '' }}
      getRowId={params => params.data.id} headerHeight={44} rowHeight={48} animateRows={false} tooltipShowDelay={400}
      quickFilterText={search} isExternalFilterPresent={() => filters.current !== 'all'} doesExternalFilterPass={node => Boolean(node.data && matchesSpec(node.data, filters.current))}
      rowSelection={{ mode: 'multiRow', selectAll: 'filtered', enableClickSelection: false }} selectionColumnDef={{ pinned: 'left', lockPinned: true, width: 42, minWidth: 42, maxWidth: 42, resizable: false }}
      localeText={localeText} onGridReady={event => setApi(event.api)}
      onModelUpdated={event => onCount(event.api.getDisplayedRowCount())}
      onRowClicked={event => { if (event.data && !(event.event?.target as HTMLElement)?.closest('button, input, .ag-selection-checkbox')) onInspect(event.data.id); }}
      onCellKeyDown={event => { if ((event.event as KeyboardEvent).key === 'Enter' && event.data && 'column' in event && event.column?.getColId() !== 'ag-Grid-SelectionColumn') onInspect(event.data.id); }}
      getRowClass={params => params.data?.id === inspected ? 'spec-row-inspected' : undefined}
      onSelectionChanged={event => onSelection(event.api.getSelectedRows().map(row => row.id))}
      onColumnResized={event => { if (event.finished && event.source === 'uiColumnResized') onPreferences({ sizes: { ...preferences.sizes, ...Object.fromEntries((event.columns ?? []).filter(column => column.getColId() !== 'ag-Grid-SelectionColumn').map(column => [column.getColId(), column.getActualWidth()])) } }); }}
      onSortChanged={event => onPreferences({ sorting: event.api.getColumnState().filter(column => column.sort).sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0)).map(column => ({ id: column.colId, desc: column.sort === 'desc' })) })}
    /></AgGridProvider>
  </div>;
}
