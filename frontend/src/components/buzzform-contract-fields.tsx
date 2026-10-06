import { useMemo, type ComponentProps } from 'react';
import type { DataField as CoreField } from '@buildnbuzz/form-react';
import { Form, FormContent, FormFields } from './buzzform/form';
import { registry } from './buzzform/registry';
import { ContractFields } from './contract-fields';
import { optionalRecord, numeric, text } from '@/api/client';
import { displayName } from '@/lib/display-names';
import { engineeringQuantity, parameterUnit } from '@/lib/format';
import { parseInput, type NumericInput } from '@/lib/domain-fields';
import { EmptyState } from './states';

type Props = ComponentProps<typeof ContractFields>;
type Entry = { name: string; path: string; label: string; group: string; groupOrder: number; level: 'basic' | 'advanced' | 'expert'; order: number; field: CoreField; source: Record<string, unknown>; spec?: NumericInput; integer?: boolean; json?: boolean };
/**
 * 插件清单的参数界面元数据：x-group / x-order / x-level 决定分组、顺序与折叠，x-unit 给显示单位与换算，
 * x-bind 声明引用的工程模型对象，x-enum-labels 给选项中文名，x-default-basis 写默认值依据。
 * 没有声明时：同层分组、全部视为基本参数、单位按字段名推断。
 */
const levelOf = (source: Record<string, unknown>): Entry['level'] => source['x-level'] === 'advanced' || source['x-level'] === 'expert' ? source['x-level'] : 'basic';
/** x-bind 绑定类型 → 宿主提供的模型对象选项键（兼容早期的字符串写法）。 */
const BIND_KEYS: Record<string, string> = { section: 'section_id', load: 'load_case_id', cable_type: 'cable_type_id', 'domain.section': 'section_id', 'domain.load_case': 'load_case_id', 'domain.cable_type': 'cable_type_id' };
const bindKey = (value: unknown) => BIND_KEYS[typeof value === 'string' ? value : text(optionalRecord(value).type)];
/** 分组标题与顺序：x-groups 可以是 [{id, title, order}] 或 {id: {title, order}}。 */
function groupTable(value: unknown): Map<string, { title: string; order: number }> {
  const rows = Array.isArray(value) ? value.map(optionalRecord).map((row, index) => [text(row.id), { title: text(row.title), order: numeric(row.order) ?? index }] as const)
    : Object.entries(optionalRecord(value)).map(([id, row], index) => [id, { title: text(optionalRecord(row).title), order: numeric(optionalRecord(row).order) ?? index }] as const);
  return new Map(rows.filter(([id]) => id));
}
function expand(raw: unknown, root: unknown): Record<string, unknown> {
  let field = optionalRecord(raw);
  const ref = text(field.$ref);
  if (ref.startsWith('#/')) {
    let value = root;
    for (const key of ref.slice(2).split('/')) value = optionalRecord(value)[key];
    field = { ...optionalRecord(value), ...field };
  }
  if (Array.isArray(field.anyOf)) field = { ...expand(field.anyOf.find(item => optionalRecord(item).type !== 'null'), root), ...field };
  return field;
}
function compile(schema: unknown, root: unknown, prefix: string, module: string, readOnly: boolean, references: Record<string, { value: string; label: string }[]> = {}, entries: Entry[] = [], parent = '', declared = groupTable(optionalRecord(schema)['x-groups'] ?? optionalRecord(root)['x-groups'])): Entry[] {
  const model = expand(schema, root);
  for (const [key, raw] of Object.entries(optionalRecord(model.properties))) {
    const source = expand(raw, root), path = prefix + '/' + key;
    // Release identities are fixed evidence, edited through the source picker rather than parameter text inputs.
    if (/_sha256$/.test(key) || key === 'run_id' || key === 'case_id' || key === 'artifact_type') continue;
    // 字段只显示自己的名称；上级层次作为分组标题（属性表式），不再拼成长串
    const ownLabel = displayName(key, text(source.title) || key), label = parent ? parent + ' · ' + ownLabel : ownLabel;
    if (source.type === 'object' && source.properties && path.split('/').length < 6) { compile(source, root, path, module, readOnly, references, entries, label, declared); continue; }
    const name = module.replace(/[^a-zA-Z0-9_-]/g, '_') + '_parameter_' + entries.length;
    const required = Array.isArray(model.required) && model.required.includes(key);
    const basis = optionalRecord(source['x-default-basis']), reason = text(source['x-editor-reason']);
    const description = [text(source.description), text(basis.reference) && '默认值依据：' + text(basis.reference), reason].filter((line) => /[\u4e00-\u9fff]/.test(line)).join('\n');
    const binding = optionalRecord(source['x-bind']);
    const base = { name, label: ownLabel.split(' · ').pop() || ownLabel, required, readOnly: readOnly || source.const !== undefined || binding.read_only === true, meta: {path}, description };
    let field: CoreField, spec: NumericInput | undefined, integer = false, json = false;
    const bound = references[bindKey(source['x-bind']) || key];
    const enumLabels = optionalRecord(source['x-enum-labels']), declaredUnit = optionalRecord(source['x-unit']);
    if (source.type === 'string' && bound?.length) {
      // 引用工程模型里的对象：从真实的截面、负荷、电缆结构中选，不手填编号
      field = { ...base, type: 'select', options: bound };
    } else if (Array.isArray(source.enum) && source.enum.every(value => typeof value === 'string')) {
      field = { ...base, type: 'select', options: source.enum.map(value => ({ value: String(value), label: text(enumLabels[String(value)]) || displayName(String(value)) })) };
    } else if (source.type === 'number' || source.type === 'integer') {
      integer = source.type === 'integer';
      // 清单声明了显示单位就按它换算（显示值 = SI × scale + offset），否则按字段名推断
      const unit = parameterUnit(key, source), hasUnit = 'display' in declaredUnit;
      const display = hasUnit ? { unit: text(declaredUnit.display) || text(declaredUnit.si), scale: numeric(declaredUnit.scale) ?? 1, offset: numeric(declaredUnit.offset) ?? 0 } : engineeringQuantity(key, null, unit);
      const shown = (value: number | null) => value === null ? undefined : hasUnit ? value * display.scale + display.offset : engineeringQuantity(key, value, unit).value ?? undefined;
      spec = { path, label, unit: display.unit, scale: display.scale, offset: display.offset, required,
        min: shown(numeric(source.minimum) ?? numeric(source.exclusiveMinimum)),
        minExclusive: numeric(source.exclusiveMinimum) !== null,
        max: shown(numeric(source.maximum) ?? numeric(source.exclusiveMaximum)) };
      // 取值范围作为输入框内的占位提示，超出时由校验给出错误，不在每个框下挂小字
      const range = [spec.min === undefined ? '' : `${spec.minExclusive ? '>' : '≥'} ${spec.min}`, spec.max === undefined ? '' : `${source.exclusiveMaximum !== undefined ? '<' : '≤'} ${spec.max}`].filter(Boolean).join('，');
      field = { ...base, type: 'number', min: spec.min, max: spec.max, placeholder: range || undefined, ui: {suffix: display.unit, hideSteppers: true} };
    } else if (source.type === 'boolean') field = {...base, type: 'switch'};
    else { json = source.type !== 'string'; field = {...base, type: 'text', ...(json ? { placeholder: 'JSON（按方法契约）' } : { minLength: numeric(source.minLength) ?? undefined, maxLength: numeric(source.maxLength) ?? undefined, pattern: text(source.pattern) || undefined })}; }
    const declaredGroup = text(source['x-group']), group = declared.get(declaredGroup);
    const entry: Entry = { name, path, label, group: group?.title || declaredGroup || parent || '基本参数', groupOrder: group?.order ?? Number.MAX_SAFE_INTEGER, level: levelOf(source), order: numeric(source['x-order']) ?? entries.length, source, spec, integer, json, field };
    field.validate = { onChange: { checks: [{type: 'hostParameter', args: {index: entries.length}, message: `${label}不符合参数契约，请检查必填项、范围或格式。`}] } };
    entries.push(entry);
  }
  return entries;
}
function stored(entry: Entry, value: unknown): unknown {
  if (entry.spec) {
    const result = parseInput(entry.spec, value === undefined || value === null ? '' : String(value));
    if (entry.integer && result !== null && !Number.isInteger(result)) throw new Error('请输入整数');
    if (entry.source.exclusiveMaximum !== undefined && result !== null && result >= Number(entry.source.exclusiveMaximum)) throw new Error('超出范围');
    return result === null && !entry.spec.required ? undefined : result;
  }
  if (entry.json) return value === '' || value === undefined ? undefined : JSON.parse(String(value));
  if (entry.field.required && (value === undefined || value === '')) throw new Error('必填');
  if (entry.source.const !== undefined && value !== entry.source.const) throw new Error('固定值');
  if (Array.isArray(entry.source.enum) && value !== undefined && value !== '' && !entry.source.enum.includes(value)) throw new Error('请选择契约中的选项');
  if (typeof value === 'string' && (entry.source.minLength !== undefined && value.length < Number(entry.source.minLength) || entry.source.maxLength !== undefined && value.length > Number(entry.source.maxLength))) throw new Error('文本长度不符合契约');
  if (entry.source.pattern && typeof value === 'string' && !new RegExp(String(entry.source.pattern)).test(value)) throw new Error('格式');
  return value;
}
export function BuzzformContractFields(props: Props) {
  const { module, schema, root, prefix, values, readOnly, onChange, onDraftChange = () => {}, draftFields = {}, references } = props;
  const entries = useMemo(() => compile(schema, root, prefix, module, readOnly, references), [schema, root, prefix, module, readOnly, references]);
  const defaults = Object.fromEntries(entries.map(entry => {
    let value: unknown = values;
    for (const part of entry.path.slice(prefix.length).split('/').filter(Boolean)) value = optionalRecord(value)[part];
    const draft = draftFields[module + entry.path]?.text;
    return [entry.name, draft !== undefined ? entry.spec ? draft === '' ? undefined : Number(draft) : draft : entry.spec ? numeric(value) === null ? undefined : Number(value) * (entry.spec.scale ?? 1) + (entry.spec.offset ?? 0) : entry.json ? (value === undefined || value === null ? '' : JSON.stringify(value)) : value];
  }));
  if (!entries.length) return <EmptyState title="该能力没有单独的方法参数" description="" />;
  const sorted = [...entries].sort((a, b) => a.groupOrder - b.groupOrder || a.order - b.order);
  const groupsOf = (items: Entry[]) => [...new Set(items.map(entry => entry.group))].map(group => ({ group, entries: items.filter(entry => entry.group === group) }));
  const groups = groupsOf(sorted.filter(entry => entry.level === 'basic'));
  const advanced = sorted.filter(entry => entry.level !== 'basic');
  const registries = { fields: registry, validators: {hostParameter: (value: unknown, args?: unknown) => { try { stored(entries[Number(optionalRecord(args).index)], value); return true; } catch { return false; } }} };
  const listeners = { onChange: ({fieldApi}: { fieldApi: { name: string; state: { value: unknown } } }) => {
    const entry = entries.find(entry => entry.name === fieldApi.name);
    if (!entry || readOnly) return;
    const value = fieldApi.state.value;
    if (entry.spec || entry.json) onDraftChange({module, path: entry.path, text: value === undefined ? '' : String(value), kind: entry.json ? 'json' : entry.integer ? 'integer' : 'number', spec: entry.spec}, module + entry.path);
    else onChange(entry.path, value);
  }, onBlur: ({fieldApi}: { fieldApi: { name: string; state: { value: unknown } } }) => {
    const entry = entries.find(entry => entry.name === fieldApi.name);
    if (!entry || readOnly || (!entry.spec && !entry.json)) return;
    if (!draftFields[module + entry.path]) return;
    try { onChange(entry.path, stored(entry, fieldApi.state.value)); onDraftChange(undefined, module + entry.path); } catch { /* Keep invalid text in the formal draft; Save also validates it. */ }
  } };
  // 一组参数 = 标题 + 名称/数值两列的属性表；高级与专家参数收进折叠区（普通渲染函数，避免每次重绘重新挂载表单）
  const parameterGroup = ({ group, entries: items }: { group: string; entries: Entry[] }) => <section key={group} className="parameter-group" aria-label={group}>
    <h4>{group}</h4>
    <Form schema={{fields: items.map(entry => entry.field)}} defaultValues={Object.fromEntries(items.map(entry => [entry.name, defaults[entry.name]]))} registries={registries} listeners={listeners}>
      <FormContent as="div"><FormFields className="parameter-fields" /></FormContent>
    </Form>
  </section>;
  // 按契约层次分组：每组一个标题 + 名称/数值两列的属性表
  return <div className="buzzform-contract" data-contract-form={module}>
    {groups.map(parameterGroup)}
    {advanced.length > 0 && <details className="parameter-advanced">
      <summary>高级参数 <span>{advanced.length}</span></summary>
      {groupsOf(advanced).map(parameterGroup)}
    </details>}
  </div>;
}
