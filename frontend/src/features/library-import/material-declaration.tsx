import { useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { IMPORT_MATERIAL_PROPERTIES, IMPORT_MATERIAL_ROLES, type SeriesDeclaration } from './api';

const ROLES = Object.entries(IMPORT_MATERIAL_ROLES);
const UNITS: Record<string, string> = { density: 'kg/m³', volumetric_heat_capacity: 'J/(m³·K)', thermal_resistivity: 'K·m/W',
  electrical_resistivity_20: 'Ω·m', temperature_coefficient_20: '1/K', relative_permittivity: '1', loss_tangent: '1',
  relative_permeability: '1', emissivity: '1', solar_absorptivity: '1' };
const PROPERTIES = Object.entries(IMPORT_MATERIAL_PROPERTIES).map(([key, label]) => [key, label, UNITS[key]]);
type Properties = SeriesDeclaration['material_properties'];
type Row = {
  id: string; role: string; property: string; number: string; unit: string; reference: string;
  saved: boolean; savedKey?: { role: string; property: string };
};

export function MaterialDeclarations({ value, onChange }: { value: Properties; onChange: (next: Properties) => void }) {
  const prefix = useId(), serial = useRef(0);
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const [rows, setRows] = useState<Row[]>(() => Object.entries(value ?? {}).flatMap(([role, properties]) =>
    Object.entries(properties).map(([property, item]) => ({ id: `${prefix}-${++serial.current}`, role, property,
      number: String(item.value), unit: item.unit, reference: item.reference, saved: true, savedKey: { role, property } }))));
  function issue(row: Row) {
    if (!ROLES.some(([key]) => key === row.role)) return '请选择这项物性对应的材料用途。';
    if (!PROPERTIES.some(([key]) => key === row.property)) return '请选择明确的材料物性。';
    if (rows.some(other => other.id !== row.id && !other.saved
        && other.savedKey?.role === row.role && other.savedKey.property === row.property))
      return '此用途与物性仍由尚未保存的原声明占用；请先保存或删除原声明，再复用。';
    if (rows.some(other => other.id !== row.id && other.role === row.role && other.property === row.property))
      return '同一材料用途的同一物性已有声明，请删除重复项或更正用途与物性。';
    if (!row.number.trim() || !Number.isFinite(Number(row.number))) return '请填写有限的物性数值；未知时删除此项并保留缺项。';
    if (!row.unit.trim()) return '请填写与物性匹配的 SI 单位。';
    if (!row.reference.trim() || row.reference.length > 2000) return '请填写不超过 2000 字符的完整出处与适用条件。';
    return '';
  }
  function edit(id: string, change: Partial<Row>) {
    setRows(current => current.map(row => row.id === id ? { ...row, ...change, saved: false } : row));
    onChange(value); // Invalidate any earlier preview without submitting partial row edits.
  }
  function without(next: NonNullable<Properties>, row: Row) {
    if (!row.savedKey) return;
    const properties = next[row.savedKey.role];
    if (!properties) return;
    delete properties[row.savedKey.property];
    if (!Object.keys(properties).length) delete next[row.savedKey.role];
  }
  function save(row: Row) {
    const problem = issue(row);
    if (problem) { inputs.current.get(row.id)?.reportValidity(); return; }
    const next = structuredClone(value ?? {});
    without(next, row);
    next[row.role] = { ...next[row.role], [row.property]: { value: Number(row.number), unit: row.unit, reference: row.reference } };
    onChange(next);
    setRows(current => current.map(item => item.id === row.id ? { ...item, saved: true,
      savedKey: { role: row.role, property: row.property } } : item));
  }
  function remove(row: Row) {
    const next = structuredClone(value ?? {});
    without(next, row);
    onChange(Object.keys(next).length ? next : undefined);
    setRows(current => current.filter(item => item.id !== row.id));
  }
  return <section className="library-import-stack" aria-label="明示材料物性">
    <h2>明示材料物性</h2>
    <p className="muted">仅填写本次明确采用的值、SI 单位、完整出处与适用条件。参考值与厂家实测分开，缺项保留为空；同一用途不得重复声明同一物性。</p>
    <p className="library-import-source">保存为参考、未人工审核，使用明示材料物性映射 1.0.0。共有材料按实际用途分开；与已有构造值不同的声明会拒绝，需按新物性重新构造。</p>
    {!rows.length && <p role="status">尚未声明材料物性；不会自动填入参考值。</p>}
    {rows.map((row, index) => {
      const problem = issue(row);
      const validity = problem || (!row.saved ? '请先保存此项声明，或删除此项后再预览。' : '');
      return <section key={row.id} className="library-import-stack" aria-label={`材料物性第 ${index + 1} 项`}>
        <h3>材料物性第 {index + 1} 项</h3>
        <div className="library-import-fields library-import-fields-pair">
          <Select label={`第 ${index + 1} 项材料用途`} value={row.role} options={[{ value: '', label: '选择实际材料用途' }, ...ROLES.map(([key, label]) => ({ value: key, label }))]} onChange={role => edit(row.id, { role })} />
          <Select label={`第 ${index + 1} 项材料物性`} value={row.property} options={[{ value: '', label: '选择材料物性' }, ...PROPERTIES.map(([key, label]) => ({ value: key, label }))]} onChange={property => edit(row.id, { property, unit: PROPERTIES.find(([key]) => key === property)?.[2] ?? '' })} />
          <label className="text-field">物性数值<Input ref={node => {
            if (node) { inputs.current.set(row.id, node); node.setCustomValidity(validity); }
            else inputs.current.delete(row.id);
          }} aria-label="物性数值" type="number" step="any" required placeholder="未提供" value={row.number} onChange={event => edit(row.id, { number: event.target.value })} /></label>
          <label className="text-field">物性单位<Input aria-label="物性单位" required value={row.unit} onChange={event => edit(row.id, { unit: event.target.value })} /></label>
        </div>
        <label className="text-field">物性出处与适用条件<Textarea aria-label="物性出处与适用条件" required maxLength={2000} rows={4} placeholder="原件名称、表页/记录、原件摘要、方法版本、适用材料与条件；文献参考须明确注明，不能作为厂家实测。" value={row.reference} onChange={event => edit(row.id, { reference: event.target.value })} /></label>
        {problem && <p className="field-error" role="alert">{problem}</p>}
        <p role="status">{row.saved ? '已保存到本次系列声明 · 参考，未人工审核。' : '编辑尚未保存；请先保存此项，未保存的编辑不能用于预览。'}</p>
        <div className="library-import-actions"><Button type="button" disabled={row.saved || !!problem} onClick={() => save(row)}>保存此项声明</Button><Button type="button" onClick={() => remove(row)}>删除此项声明</Button></div>
      </section>;
    })}
    <div><Button type="button" onClick={() => {
      setRows(current => [...current, { id: `${prefix}-${++serial.current}`, role: '', property: '', number: '', unit: '', reference: '', saved: false }]);
      onChange(value);
    }}>添加材料物性</Button></div>
  </section>;
}
