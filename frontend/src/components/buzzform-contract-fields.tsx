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
type Entry = { name: string; path: string; label: string; group: string; field: CoreField; source: Record<string, unknown>; spec?: NumericInput; integer?: boolean; json?: boolean };
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
function compile(schema: unknown, root: unknown, prefix: string, module: string, readOnly: boolean, references: Record<string, { value: string; label: string }[]> = {}, entries: Entry[] = [], parent = ''): Entry[] {
  const model = expand(schema, root);
  for (const [key, raw] of Object.entries(optionalRecord(model.properties))) {
    const source = expand(raw, root), path = prefix + '/' + key;
    // Release identities are fixed evidence, edited through the source picker rather than parameter text inputs.
    if (/_sha256$/.test(key) || key === 'run_id' || key === 'case_id' || key === 'artifact_type') continue;
    // 字段只显示自己的名称；上级层次作为分组标题（属性表式），不再拼成长串
    const ownLabel = displayName(key, text(source.title) || key), label = parent ? parent + ' · ' + ownLabel : ownLabel;
    if (source.type === 'object' && source.properties && path.split('/').length < 6) { compile(source, root, path, module, readOnly, references, entries, label); continue; }
    const name = module.replace(/[^a-zA-Z0-9_-]/g, '_') + '_parameter_' + entries.length;
    const required = Array.isArray(model.required) && model.required.includes(key);
    const description = text(source.description);
    const base = { name, label: ownLabel.split(' · ').pop() || ownLabel, required, readOnly: readOnly || source.const !== undefined, meta: {path}, description: /[\u4e00-\u9fff]/.test(description) ? description : '' };
    let field: CoreField, spec: NumericInput | undefined, integer = false, json = false;
    if (source.type === 'string' && references[key]?.length) {
      // 引用工程模型里的对象：从真实的截面、负荷、电缆结构中选，不手填编号
      field = { ...base, type: 'select', options: references[key] };
    } else if (Array.isArray(source.enum) && source.enum.every(value => typeof value === 'string')) {
      field = { ...base, type: 'select', options: source.enum.map(value => ({ value: String(value), label: displayName(String(value)) })) };
    } else if (source.type === 'number' || source.type === 'integer') {
      integer = source.type === 'integer';
      const unit = parameterUnit(key, source), display = engineeringQuantity(key, null, unit);
      spec = { path, label, unit: display.unit, scale: display.scale, offset: display.offset, required,
        min: engineeringQuantity(key, numeric(source.minimum) ?? numeric(source.exclusiveMinimum), unit).value ?? undefined,
        minExclusive: numeric(source.exclusiveMinimum) !== null,
        max: engineeringQuantity(key, numeric(source.maximum) ?? numeric(source.exclusiveMaximum), unit).value ?? undefined };
      // 取值范围作为输入框内的占位提示，超出时由校验给出错误，不在每个框下挂小字
      const range = [spec.min === undefined ? '' : `${spec.minExclusive ? '>' : '≥'} ${spec.min}`, spec.max === undefined ? '' : `${source.exclusiveMaximum !== undefined ? '<' : '≤'} ${spec.max}`].filter(Boolean).join('，');
      field = { ...base, type: 'number', min: spec.min, max: spec.max, placeholder: range || undefined, ui: {suffix: display.unit, hideSteppers: true} };
    } else if (source.type === 'boolean') field = {...base, type: 'switch'};
    else { json = source.type !== 'string'; field = {...base, type: 'text', ...(json ? { placeholder: 'JSON（按方法契约）' } : { minLength: numeric(source.minLength) ?? undefined, maxLength: numeric(source.maxLength) ?? undefined, pattern: text(source.pattern) || undefined })}; }
    const entry: Entry = { name, path, label, group: parent || '基本参数', source, spec, integer, json, field };
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
  const groups = [...new Set(entries.map(entry => entry.group))].map(group => ({ group, entries: entries.filter(entry => entry.group === group) }));
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
  // 按契约层次分组：每组一个标题 + 名称/数值两列的属性表
  return <div className="buzzform-contract" data-contract-form={module}>
    {groups.map(({ group, entries: items }) => <section key={group} className="parameter-group" aria-label={group}>
      <h4>{group}</h4>
      <Form schema={{fields: items.map(entry => entry.field)}} defaultValues={Object.fromEntries(items.map(entry => [entry.name, defaults[entry.name]]))} registries={registries} listeners={listeners}>
        <FormContent as="div"><FormFields className="parameter-fields" /></FormContent>
      </Form>
    </section>)}
  </div>;
}
