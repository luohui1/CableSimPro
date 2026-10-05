import { Fragment, useState, type ReactNode } from "react";
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
}) {
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
      <table
        className={cn("data-table", `density-${density}`)}
        aria-label={label}
        aria-busy={loading || undefined}
      >
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.id}
                scope="col"
                className={column.numeric ? "numeric" : undefined}
              >
                {displayText(column.label)}
                {column.unit && <span className="unit"> / {displayUnit(column.unit)}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={columns.length}>正在加载…</td>
            </tr>
          ) : error ? (
            <tr>
              <td colSpan={columns.length} className="field-error" role="alert">
                {error}
              </td>
            </tr>
          ) : !groups.some((group) => group.rows.length) ? (
            <tr>
              <td colSpan={columns.length} className="muted">
                暂无记录
              </td>
            </tr>
          ) : (
            groups.map((group) => (
              <Fragment key={group.id}>
                {showGroups && (
                  <tr className="group-row">
                    <th colSpan={columns.length} scope="rowgroup">
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
                    </th>
                  </tr>
                )}
                {!collapsed.has(group.id) &&
                  group.rows.map((row) => (
                    <tr
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
                      {columns.map((column) => (
                        <td
                          key={column.id}
                          className={cn(
                            column.numeric && "numeric",
                            column.wrap && "cell-wrap",
                          )}
                        >
                          {(() => { const value = column.render(row); return typeof value === 'string' ? displayText(value) : value; })()}
                        </td>
                      ))}
                    </tr>
                  ))}
              </Fragment>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
