import { Fragment, useEffect, useState, type ReactNode } from "react";
import { numeric, optionalRecord, text } from "@/api/client";
import { displayName } from "@/lib/display-names";
import { declaredUnit, expand, rowUnit, scalarColumns, toDisplay, toSi, type DisplayUnit } from "@/lib/contract-schema";
import { formatNumber } from "@/lib/format";
import { Button, IconButton } from "./ui/button";
import { appendFieldPath } from '@/lib/missing-input';
import { declaredParameterDefaults } from '@/lib/study-parameter-form';
import { Textarea } from './ui/textarea';
import './study-method-form.css';

type Field = Record<string, unknown>;
type Options = { value: string; label: string }[];
type ObjectEditor = (schema: unknown, values: Record<string, unknown>, path: string) => ReactNode;

/** Evidence remains intact and can be read/edited in full without a narrow cell. */
export function ParameterSource({ value, label, readOnly, onChange, error }: { value: unknown; label: string; readOnly: boolean; onChange: (value: string) => void; error?: string }) {
  const [opened,setOpened]=useState(false);
  useEffect(()=>{if(error)setOpened(true);},[error]);
  return <details className="parameter-source" open={opened} onToggle={event=>setOpened(event.currentTarget.open)}>
    <summary>{value ? '已记录来源 · 查看或编辑' : '填写来源'}</summary>
    <label className="text-field">{label}<Textarea aria-label={label} value={typeof value === 'string' ? value : ''} readOnly={readOnly} aria-invalid={!!error} onChange={event => onChange(event.target.value)} /></label>
    {error && <p className="field-error" role="alert">{error}</p>}
  </details>;
}

/** 一个数值单元：显示单位下编辑，失焦或回车时按 SI 写回；空值写回 undefined。 */
function NumberCell({ value, unit, label, readOnly, onCommit }: { value: unknown; unit: DisplayUnit | null; label: string; readOnly: boolean; onCommit: (value: number | undefined) => void }) {
  const shown = numeric(value) === null ? "" : formatNumber(toDisplay(Number(value), unit), 6);
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const parsed = draft.trim() === "" ? undefined : Number(draft);
    if (parsed === undefined || Number.isFinite(parsed)) {setDraft(null);onCommit(parsed === undefined ? undefined : toSi(parsed, unit));}
  };
  return <span className="cell-number">
    <input aria-label={label} inputMode="decimal" value={draft ?? shown} readOnly={readOnly} aria-invalid={draft !== null && draft.trim() !== "" && !Number.isFinite(Number(draft))}
      onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") {event.preventDefault();commit();} }} />
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

/** Ordered coordinate pairs: each position remains explicit, including blanks. */
export function TupleListEditor({ field, root, value, readOnly, label, onChange, path }: { field: Field; root:unknown; value:unknown; readOnly:boolean; label:string; onChange:(value:unknown[])=>void; path:string }) {
  const item=expand(field.items,root), parts=Array.isArray(item.prefixItems)?item.prefixItems:[], rows=Array.isArray(value)?value:[];
  const unit=declaredUnit(item['x-unit']) || declaredUnit(field['x-unit']);
  return <div className="parameter-object-list" data-field-path={path}>{rows.map((row,index)=><div className="parameter-tuple" key={index}>{parts.map((_,position)=><label key={position} className="text-field" data-field-path={appendFieldPath(appendFieldPath(path,index),position)}>{label} {index+1} · {position===0?'水平坐标':'竖向坐标'}<NumberCell value={Array.isArray(row)?row[position]:undefined} unit={unit} label={`${label} ${index+1} ${position===0?'水平坐标':'竖向坐标'}`} readOnly={readOnly} onCommit={next=>onChange(rows.map((value,i)=>i===index?Array.from({length:parts.length},(_,j)=>j===position?next??null:Array.isArray(value)?value[j]:null):value))}/></label>)}{!readOnly && <IconButton size="compact" variant="ghost" icon="action/delete" label={`删除${label} ${index+1}`} onClick={()=>onChange(rows.filter((_,i)=>i!==index))}/>}</div>)}{!readOnly && <div className="source-line"><Button size="compact" onClick={()=>onChange([...rows,parts.map(()=>null)])}>添加坐标</Button>{value===undefined && <Button size="compact" onClick={()=>onChange([])}>明确不设置取样点</Button>}</div>}</div>;
}

/** 数值列表（如输出时刻、网格尺度）：每个值一个标签，回车追加，单位来自清单。 */
export function NumberListEditor({ field, value, readOnly, label, onChange, path }: { field: Field; value: unknown; readOnly: boolean; label: string; onChange: (value: number[]) => void; path?: string }) {
  const items = (Array.isArray(value) ? value : []).filter((item): item is number => typeof item === "number");
  const unit = declaredUnit(field["x-unit"]) || declaredUnit(optionalRecord(field.items)["x-unit"]);
  const [draft, setDraft] = useState("");
  const add = () => {
    const parsed = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(parsed)) return;
    // Order belongs to the contract (mesh_scales is decreasing); never sort it.
    onChange([...items, toSi(parsed, unit)]);
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
export function RowsEditor({ field, root, value, readOnly, label, onChange, path, renderObject }: { field: Field; root: unknown; value: unknown; readOnly: boolean; label: string; onChange: (value: Record<string, unknown>[]) => void; path?: string; renderObject?: ObjectEditor }) {
  const item = expand(field.items, root), columns = scalarColumns(item, root);
  const rows = (Array.isArray(value) ? value : []).map(optionalRecord);
  const nested = Object.values(optionalRecord(item.properties)).some(raw => ['array','object'].includes(text(expand(raw,root).type)));
  if (nested && renderObject) return <div className="parameter-object-list" data-field-path={path}>
    {rows.map((row,index)=><section key={index} className="parameter-object-item"><div className="parameter-object-heading"><h4>{label} · 第 {index+1} 项</h4>{!readOnly && <IconButton size="compact" variant="ghost" icon="action/delete" label={`删除第 ${index+1} 项`} onClick={()=>onChange(rows.filter((_,position)=>position!==index))}/>}</div>{renderObject(item,row,appendFieldPath(path || '',index))}</section>)}
    {!readOnly && <Button size="compact" onClick={()=>onChange([...rows,declaredParameterDefaults(item,root)])}>添加一项</Button>}
  </div>;
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
export function KeyedMapEditor({ field, root, value, keys, readOnly, label, onChange, path, renderObject }: { field: Field; root: unknown; value: unknown; keys: Options; readOnly: boolean; label: string; onChange: (value: Record<string, unknown>) => void; path?: string; renderObject?: ObjectEditor }) {
  const [newKey,setNewKey] = useState('');
  const item = expand(field.additionalProperties, root);
  const scalar = ["number", "integer", "string", "boolean"].includes(text(item.type));
  const allColumns: [string, Field][] = scalar ? [["", { ...item, 'x-unit':item['x-unit'] || field['x-unit'], title: item.title || "值" }]] : scalarColumns(item, root);
  const sources=allColumns.filter(([key,spec])=>key==='source' || spec['x-group']==='evidence');
  const columns=allColumns.filter(column=>!sources.includes(column));
  const map = optionalRecord(value), present = Object.keys(map);
  const nested = !scalar && Object.values(optionalRecord(item.properties)).some(raw => ['array','object'].includes(text(expand(raw,root).type)));
  const nameOf = (key: string) => keys.find((option) => option.value === key)?.label || key;
  const set = (key: string, column: string, next: unknown) => onChange({ ...map, [key]: scalar ? next : Object.fromEntries(Object.entries({ ...optionalRecord(map[key]), [column]: next }).filter(([, cell]) => cell !== undefined)) });
  const available = keys.filter((option) => !present.includes(option.value));
  const add = (key: string) => { if(key && !present.includes(key)) {onChange({...map,[key]:scalar ? undefined : declaredParameterDefaults(item,root)});setNewKey('');} };
  const remove = (key:string) => onChange(Object.fromEntries(Object.entries(map).filter(([entry])=>entry!==key)));
  return <div className="structured-table" data-field-path={path}>
    {nested && renderObject ? <div className="parameter-object-list">{present.map(key=><section key={key} className="parameter-object-item"><div className="parameter-object-heading"><h4>{nameOf(key)}</h4>{!readOnly && <IconButton size="compact" variant="ghost" icon="action/delete" label={`删除 ${nameOf(key)}`} onClick={()=>remove(key)}/>}</div>{renderObject(item,optionalRecord(map[key]),appendFieldPath(path || '',key))}</section>)}</div> : <table aria-label={label}>
      <thead><tr><th scope="col">对象</th>{columns.map(([key, column]) => <th key={key || "value"} scope="col">{titleOf(key, column)}</th>)}{!readOnly && <th aria-label="操作" />}</tr></thead>
      <tbody>{present.map((key) => <Fragment key={key}><tr data-field-path={path ? appendFieldPath(path, key) : undefined}>
        <th scope="row">{nameOf(key)}</th>
        {columns.map(([column, spec]) => { const row = scalar ? {} : optionalRecord(map[key]); return <td key={column || "value"} data-field-path={path ? scalar ? appendFieldPath(path, key) : appendFieldPath(appendFieldPath(path, key), column) : undefined}><ScalarCell field={spec} value={scalar ? map[key] : row[column]} unit={rowUnit(spec, row)} label={`${nameOf(key)} ${titleOf(column, spec)}`} readOnly={readOnly} onCommit={(next) => set(key, column, next)} /></td>; })}
        {!readOnly && <td><IconButton variant="ghost" icon="action/delete" label={`删除 ${nameOf(key)}`} onClick={() => remove(key)} /></td>}
      </tr>{sources.map(([column,spec])=><tr key={column}><td colSpan={columns.length+(readOnly?1:2)} data-field-path={appendFieldPath(appendFieldPath(path || '',key),column)}><ParameterSource label={`${nameOf(key)} ${titleOf(column,spec)}`} value={optionalRecord(map[key])[column]} readOnly={readOnly} onChange={next=>set(key,column,next)} /></td></tr>)}</Fragment>)}</tbody>
    </table>}
    {!readOnly && (available.length ? <select className="cell-select structured-add" aria-label={`为${label}添加对象`} value="" onChange={(event) => add(event.target.value)}>
      <option value="">添加对象…</option>
      {available.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select> : !keys.length && (field['x-bind'] ? <span className="muted">工程模型里没有可绑定的对象；请先完善工程模型。</span> : <div className="parameter-map-add"><label className="text-field">{label} · 项目名称<input value={newKey} onChange={event=>setNewKey(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();add(newKey.trim());}}}/></label><Button size="compact" disabled={!newKey.trim() || present.includes(newKey.trim())} title={!newKey.trim() ? '先填写方法要求的项目名称' : present.includes(newKey.trim()) ? '该项目已存在' : undefined} onClick={()=>add(newKey.trim())}>添加项目</Button></div>))}
    {!readOnly && value === undefined && <Button size="compact" onClick={()=>onChange({})}>明确不提供此组分项</Button>}
  </div>;
}
