import { useState } from "react";
import { numeric, optionalRecord, text } from "@/api/client";
import { displayName } from "@/lib/display-names";
import { declaredUnit, expand, rowUnit, scalarColumns, toDisplay, toSi, type DisplayUnit } from "@/lib/contract-schema";
import { formatNumber } from "@/lib/format";
import { Button, IconButton } from "./ui/button";
import { appendFieldPath } from '@/lib/missing-input';

type Field = Record<string, unknown>;
type Options = { value: string; label: string }[];

/** 一个数值单元：显示单位下编辑，失焦或回车时按 SI 写回；空值写回 undefined。 */
function NumberCell({ value, unit, label, readOnly, onCommit }: { value: unknown; unit: DisplayUnit | null; label: string; readOnly: boolean; onCommit: (value: number | undefined) => void }) {
  const shown = numeric(value) === null ? "" : formatNumber(toDisplay(Number(value), unit), 6);
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const parsed = draft.trim() === "" ? undefined : Number(draft);
    setDraft(null);
    if (parsed === undefined || Number.isFinite(parsed)) onCommit(parsed === undefined ? undefined : toSi(parsed, unit));
  };
  return <span className="cell-number">
    <input aria-label={label} inputMode="decimal" value={draft ?? shown} readOnly={readOnly} aria-invalid={draft !== null && draft.trim() !== "" && !Number.isFinite(Number(draft))}
      onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") commit(); }} />
    {unit?.unit && <span className="unit">{unit.unit}</span>}
  </span>;
}

/** 标量单元：数值、枚举（中文选项名）、开关、文本。 */
function ScalarCell({ field, value, unit, label, readOnly, onCommit }: { field: Field; value: unknown; unit: DisplayUnit | null; label: string; readOnly: boolean; onCommit: (value: unknown) => void }) {
  if (field.type === "number" || field.type === "integer") return <NumberCell value={value} unit={unit} label={label} readOnly={readOnly} onCommit={onCommit} />;
  if (Array.isArray(field.enum)) {
    const labels = optionalRecord(field["x-enum-labels"]);
    return <select className="cell-select" aria-label={label} value={value === undefined ? "" : String(value)} disabled={readOnly} onChange={(event) => onCommit(event.target.value === "" ? undefined : event.target.value)}>
      <option value="">请选择</option>
      {field.enum.map((item) => <option key={String(item)} value={String(item)}>{text(labels[String(item)]) || displayName(String(item))}</option>)}
    </select>;
  }
  if (field.type === "boolean") return <input type="checkbox" aria-label={label} checked={value === true} disabled={readOnly} onChange={(event) => onCommit(event.target.checked)} />;
  return <input className="cell-text" aria-label={label} defaultValue={value === undefined ? "" : String(value)} readOnly={readOnly} onBlur={(event) => onCommit(event.target.value === "" ? undefined : event.target.value)} />;
}

const titleOf = (key: string, field: Field) => text(field.title) || displayName(key);
const defaultsOf = (columns: [string, Field][]) => Object.fromEntries(columns.flatMap(([key, field]) => "default" in field && field.default !== null ? [[key, field.default]] : []));

/** 数值列表（如输出时刻、网格尺度）：每个值一个标签，回车追加，单位来自清单。 */
export function NumberListEditor({ field, value, readOnly, label, onChange, path }: { field: Field; value: unknown; readOnly: boolean; label: string; onChange: (value: number[]) => void; path?: string }) {
  const items = (Array.isArray(value) ? value : []).filter((item): item is number => typeof item === "number");
  const unit = declaredUnit(field["x-unit"]) || declaredUnit(optionalRecord(field.items)["x-unit"]);
  const [draft, setDraft] = useState("");
  const add = () => {
    const parsed = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(parsed)) return;
    onChange([...items, toSi(parsed, unit)].sort((a, b) => a - b));
    setDraft("");
  };
  return <div className="number-list" role="group" aria-label={label} data-field-path={path}>
    {items.map((item, index) => <span key={index} className="number-chip" data-field-path={path ? appendFieldPath(path, index) : undefined}>{formatNumber(toDisplay(item, unit), 6)}{unit?.unit && <span className="unit">{unit.unit}</span>}
      {!readOnly && <button type="button" aria-label={`删除 ${formatNumber(toDisplay(item, unit), 6)}`} onClick={() => onChange(items.filter((_, position) => position !== index))}>×</button>}</span>)}
    {!readOnly && <input aria-label={`添加${label}`} inputMode="decimal" placeholder={"添加" + (unit?.unit ? `（${unit.unit}）` : "")} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }} onBlur={add} />}
    {!items.length && readOnly && <span className="muted">—</span>}
  </div>;
}

/** 对象数组（如热边界条件）：一行一项，列为该项的标量字段；单位可随同行类型字段变化。 */
export function RowsEditor({ field, root, value, readOnly, label, onChange, path }: { field: Field; root: unknown; value: unknown; readOnly: boolean; label: string; onChange: (value: Record<string, unknown>[]) => void; path?: string }) {
  const item = expand(field.items, root), columns = scalarColumns(item, root);
  const rows = (Array.isArray(value) ? value : []).map(optionalRecord);
  const set = (index: number, key: string, next: unknown) => onChange(rows.map((row, position) => position === index ? Object.fromEntries(Object.entries({ ...row, [key]: next }).filter(([, cell]) => cell !== undefined)) : row));
  return <div className="structured-table" data-field-path={path}>
    <table aria-label={label}>
      <thead><tr>{columns.map(([key, column]) => <th key={key} scope="col">{titleOf(key, column)}</th>)}{!readOnly && <th aria-label="操作" />}</tr></thead>
      <tbody>{rows.map((row, index) => <tr key={index} data-field-path={path ? appendFieldPath(path, index) : undefined}>
        {columns.map(([key, column]) => <td key={key} data-field-path={path ? appendFieldPath(appendFieldPath(path, index), key) : undefined}><ScalarCell field={column} value={row[key]} unit={rowUnit(column, row)} label={`${label} 第 ${index + 1} 行 ${titleOf(key, column)}`} readOnly={readOnly} onCommit={(next) => set(index, key, next)} /></td>)}
        {!readOnly && <td><IconButton variant="ghost" icon="action/delete" label={`删除第 ${index + 1} 行`} onClick={() => onChange(rows.filter((_, position) => position !== index))} /></td>}
      </tr>)}</tbody>
    </table>
    {!readOnly && <Button size="compact" variant="ghost" onClick={() => onChange([...rows, defaultsOf(columns)])}>添加一行</Button>}
  </div>;
}

/** 按模型对象分项（如逐材料热阻率、逐电缆损耗）：一个对象一行，只能从工程模型里已有的对象中添加。 */
export function KeyedMapEditor({ field, root, value, keys, readOnly, label, onChange, path }: { field: Field; root: unknown; value: unknown; keys: Options; readOnly: boolean; label: string; onChange: (value: Record<string, unknown>) => void; path?: string }) {
  const item = expand(field.additionalProperties, root);
  const scalar = ["number", "integer", "string", "boolean"].includes(text(item.type));
  const columns: [string, Field][] = scalar ? [["", { ...item, title: item.title || "值" }]] : scalarColumns(item, root);
  const map = optionalRecord(value), present = Object.keys(map);
  const nameOf = (key: string) => keys.find((option) => option.value === key)?.label || key;
  const set = (key: string, column: string, next: unknown) => onChange({ ...map, [key]: scalar ? next : Object.fromEntries(Object.entries({ ...optionalRecord(map[key]), [column]: next }).filter(([, cell]) => cell !== undefined)) });
  const available = keys.filter((option) => !present.includes(option.value));
  return <div className="structured-table" data-field-path={path}>
    <table aria-label={label}>
      <thead><tr><th scope="col">对象</th>{columns.map(([key, column]) => <th key={key || "value"} scope="col">{titleOf(key, column)}</th>)}{!readOnly && <th aria-label="操作" />}</tr></thead>
      <tbody>{present.map((key) => <tr key={key} data-field-path={path ? appendFieldPath(path, key) : undefined}>
        <th scope="row">{nameOf(key)}</th>
        {columns.map(([column, spec]) => { const row = scalar ? {} : optionalRecord(map[key]); return <td key={column || "value"} data-field-path={path ? scalar ? appendFieldPath(path, key) : appendFieldPath(appendFieldPath(path, key), column) : undefined}><ScalarCell field={spec} value={scalar ? map[key] : row[column]} unit={rowUnit(spec, row)} label={`${nameOf(key)} ${titleOf(column, spec)}`} readOnly={readOnly} onCommit={(next) => set(key, column, next)} /></td>; })}
        {!readOnly && <td><IconButton variant="ghost" icon="action/delete" label={`删除 ${nameOf(key)}`} onClick={() => onChange(Object.fromEntries(Object.entries(map).filter(([entry]) => entry !== key)))} /></td>}
      </tr>)}</tbody>
    </table>
    {!readOnly && (available.length ? <select className="cell-select structured-add" aria-label={`为${label}添加对象`} value="" onChange={(event) => { if (event.target.value) onChange({ ...map, [event.target.value]: scalar ? undefined : defaultsOf(columns) }); }}>
      <option value="">添加对象…</option>
      {available.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select> : !keys.length && <span className="muted">工程模型里没有可绑定的对象。</span>)}
  </div>;
}
