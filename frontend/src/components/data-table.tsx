import { Fragment, useMemo, useState, type ReactNode } from "react";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './ui/table';
import { Icon } from "./icon";
import { cn } from "@/lib/cn";
import { displayText, displayUnit } from "@/lib/display-names";

export type Column<T> = {
  id: string;
  label: string;
  unit?: string;
  numeric?: boolean;
  wrap?: boolean;
  render: (row: T) => ReactNode;
};
export type RowGroup<T> = {
  id: string;
  label: string;
  rows: T[];
  defaultCollapsed?: boolean;
};

export function DataTable<T extends { id: string }>({
  label,
  columns,
  groups,
  selectedId,
  onSelect,
  onActivate,
  rowLabel,
  density = "compact",
  loading,
  error,
  showGroups = true,
  rowClassName,
  historical = false,
}: {
  label: string;
  columns: Column<T>[];
  groups: RowGroup<T>[];
  selectedId?: string;
  onSelect?: (row: T) => void;
  onActivate?: (row: T) => void;
  rowLabel: (row: T) => string;
  density?: "compact" | "standard";
  loading?: boolean;
  error?: string;
  showGroups?: boolean;
  rowClassName?: (row: T) => string | undefined;
  historical?: boolean;
}) {
  const data = useMemo(() => groups.flatMap(group => group.rows), [groups]);
  const tableColumns = useMemo<ColumnDef<T>[]>(() => columns.map(column => ({
    id: column.id,
    cell: ({ row }) => { const value = column.render(row.original); return typeof value === 'string' ? displayText(value) : value; },
  })), [columns]);
  const table = useReactTable({ data, columns: tableColumns, getCoreRowModel: getCoreRowModel() });
  const tableRows = new Map(table.getRowModel().rows.map(row => [row.original, row]));
  const [collapsed, setCollapsed] = useState(
    () =>
      new Set(
        groups
          .filter((group) => group.defaultCollapsed)
          .map((group) => group.id),
      ),
  );
  const visible = groups.flatMap((group) =>
    collapsed.has(group.id) ? [] : group.rows,
  );
  function selectNeighbor(id: string, direction: number) {
    const index = visible.findIndex((row) => row.id === id);
    const next =
      visible[Math.max(0, Math.min(visible.length - 1, index + direction))];
    if (next) {
      onSelect?.(next);
      document.getElementById(`row-${label}-${next.id}`)?.focus();
    }
  }
  return (
    <div className="table-scroll">
      <Table
        className={cn("data-table", `density-${density}`, historical && 'table-history')}
        aria-label={label}
        aria-busy={loading || undefined}
      >
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead
                key={column.id}
                scope="col"
                className={column.numeric ? "numeric" : undefined}
              >
                {displayText(column.label)}
                {column.unit && <span className="unit"> / {displayUnit(column.unit)}</span>}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={columns.length}>正在加载…</TableCell>
            </TableRow>
          ) : error ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="field-error" role="alert">
                {error}
              </TableCell>
            </TableRow>
          ) : !groups.some((group) => group.rows.length) ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="muted">
                暂无记录
              </TableCell>
            </TableRow>
          ) : (
            groups.map((group) => (
              <Fragment key={group.id}>
                {showGroups && (
                  <TableRow className="group-row">
                    <TableHead colSpan={columns.length} scope="rowgroup">
                      <button
                        type="button"
                        aria-label={`${collapsed.has(group.id) ? "展开" : "收起"}${group.label}`}
                        aria-expanded={!collapsed.has(group.id)}
                        onClick={() =>
                          setCollapsed((previous) => {
                            const next = new Set(previous);
                            if (next.has(group.id)) next.delete(group.id);
                            else next.add(group.id);
                            return next;
                          })
                        }
                      >
                        <Icon
                          name={
                            collapsed.has(group.id)
                              ? "action/chevron-right"
                              : "action/chevron-down"
                          }
                        />
                        <strong>{displayText(group.label)}</strong>
                        <span className="muted">{group.rows.length} 项</span>
                      </button>
                    </TableHead>
                  </TableRow>
                )}
                {!collapsed.has(group.id) &&
                  group.rows.map((row) => (
                    <TableRow
                      key={row.id}
                      id={`row-${label}-${row.id}`}
                      className={cn("data-row", rowClassName?.(row))}
                      data-selected={selectedId === row.id || undefined}
                      aria-label={rowLabel(row)}
                      aria-selected={
                        onSelect ? selectedId === row.id : undefined
                      }
                      tabIndex={onSelect || onActivate ? 0 : undefined}
                      onClick={() => onActivate ? onActivate(row) : onSelect?.(row)}
                      onKeyDown={(event) => {
                        if (!onSelect && !onActivate) return;
            if(event.target instanceof HTMLElement && event.target!==event.currentTarget && event.target.closest("input,button,select,textarea,[role=combobox]"))return;
                        if (["Enter", " "].includes(event.key)) {
                          event.preventDefault();
                          if (onActivate) onActivate(row); else onSelect?.(row);
                        }
                        if (["ArrowDown", "ArrowUp"].includes(event.key)) {
                          event.preventDefault();
                          selectNeighbor(
                            row.id,
                            event.key === "ArrowDown" ? 1 : -1,
                          );
                        }
                      }}
                    >
                      {columns.map((column, index) => (
                        <TableCell
                          key={column.id}
                          className={cn(
                            column.numeric && "numeric",
                            column.wrap && "cell-wrap",
                          )}
                        >
                          {(() => { const cell = tableRows.get(row)?.getVisibleCells()[index]; return cell ? flexRender(cell.column.columnDef.cell, cell.getContext()) : null; })()}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
              </Fragment>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
