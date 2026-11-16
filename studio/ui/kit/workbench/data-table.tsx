// The engineering table: the header stays while the body scrolls, 36 px rows, units in the header, numbers right-aligned in
// tabular figures, the selected row in the selection fill. Rows can be grouped (a series and its sizes) and the table can
// end in a summary row (范围). Sorting is shown here and decided by the caller.
import type { ReactNode } from 'react';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { Icon } from '../icon';

export interface Column<Row> {
  key: string;
  header: string;
  /** Shown after the header in the secondary colour: mm, kg/km, Ω/km. */
  unit?: string;
  numeric?: boolean;
  /** A width from the scale (w-24, w-32 …); without it the column takes what is left. */
  width?: string;
  cell: (row: Row) => ReactNode;
}

export interface RowGroup<Row> {
  key: string;
  header: ReactNode;
  /** What the group adds up to, on the right of its header row. */
  aside?: ReactNode;
  rows: Row[];
  open: boolean;
  onToggle?: () => void;
}

export function DataTable<Row>({ columns, rows, groups, rowKey, selected, onSelect, footer, sort, onSort, empty, className }: {
  columns: Column<Row>[];
  rows?: Row[];
  groups?: RowGroup<Row>[];
  rowKey: (row: Row) => string;
  selected?: string;
  onSelect?: (row: Row) => void;
  footer?: { label: string; cells: Partial<Record<string, ReactNode>> };
  sort?: { key: string; direction: 'asc' | 'desc' };
  onSort?: (key: string) => void;
  /** What an empty table says; an EmptyState usually. */
  empty?: ReactNode;
  className?: string;
}) {
  const body = (list: Row[]) => list.map(row => {
    const key = rowKey(row);
    // A row that can be selected takes focus and answers Enter and Space, like the click.
    return <TableRow key={key} data-state={key === selected ? 'selected' : undefined} aria-selected={onSelect ? key === selected : undefined}
      tabIndex={onSelect ? 0 : undefined} onClick={onSelect ? () => onSelect(row) : undefined}
      onKeyDown={onSelect ? event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(row); } } : undefined}
      className={cn(onSelect && 'cursor-pointer outline-none focus-visible:bg-subtle focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-inset')}>
      {columns.map(column => <TableCell key={column.key} numeric={column.numeric} className={column.width}>{column.cell(row)}</TableCell>)}
      {filler && <TableCell aria-hidden="true" />}
    </TableRow>;
  });
  const count = groups ? groups.reduce((sum, group) => sum + group.rows.length, 0) : rows?.length ?? 0;
  // When every column has a width, what is left over goes to an empty column at the end, not between the columns.
  const filler = columns.every(column => column.width);
  const span = columns.length + (filler ? 1 : 0);
  return <Table containerClassName={cn('min-h-0', className)}>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {columns.map(column => <TableHead key={column.key} numeric={column.numeric} className={cn('sticky top-0 z-1', column.width)}
            aria-sort={sort?.key === column.key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}>
            {onSort
              ? <button type="button" onClick={() => onSort(column.key)}
                className={cn('inline-flex items-center gap-1 rounded-sm outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring', column.numeric && 'flex-row-reverse')}>
                <HeadText column={column} />
                {sort?.key === column.key && <Icon name={sort.direction === 'asc' ? 'action/sort-ascending' : 'action/sort-descending'} className="size-3.5" />}
              </button>
              : <HeadText column={column} />}
          </TableHead>)}
          {filler && <TableHead aria-hidden="true" className="sticky top-0 z-1" />}
        </TableRow>
      </TableHeader>
      <TableBody>
        {count === 0 && empty && <tr><td colSpan={span} className="p-0">{empty}</td></tr>}
        {groups
          ? groups.map(group => <GroupRows key={group.key} group={group} span={span}>{group.open && body(group.rows)}</GroupRows>)
          : body(rows ?? [])}
      </TableBody>
      {footer && <TableFooter>
        <TableRow className="hover:bg-transparent">
          {columns.map((column, index) => <TableCell key={column.key} numeric={column.numeric} className={cn('text-ink-2', column.width)}>
            {index === 0 ? footer.label : footer.cells[column.key]}
          </TableCell>)}
          {filler && <TableCell aria-hidden="true" />}
        </TableRow>
      </TableFooter>}
  </Table>;
}

const HeadText = <Row,>({ column }: { column: Column<Row> }) =>
  <span>{column.header}{column.unit && <span className="ml-1 font-normal">{column.unit}</span>}</span>;

function GroupRows<Row>({ group, span, children }: { group: RowGroup<Row>; span: number; children: ReactNode }) {
  return <>
    <tr data-group={group.key} className="bg-canvas">
      <td colSpan={span} className="h-10 border-b border-line px-2">
        <button type="button" onClick={group.onToggle} aria-expanded={group.open}
          className="flex w-full min-w-0 items-center gap-2 rounded-sm px-1 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring">
          <Icon name="action/chevron-right" className={cn('text-ink-2 transition-transform duration-std', group.open && 'rotate-90')} />
          <span className="min-w-0 flex-1 truncate text-sm">{group.header}</span>
          {group.aside && <span className="flex shrink-0 items-center gap-3">{group.aside}</span>}
        </button>
      </td>
    </tr>
    {children}
  </>;
}
