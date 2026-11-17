import { useMemo, type ComponentProps } from 'react';
import type { DataField as CoreField } from '@buildnbuzz/form-react';
import { Form, FormContent, FormFields } from './buzzform/form';
import { registry } from './buzzform/registry';
import { ContractFields } from './contract-fields';
import { optionalRecord, numeric, text } from '@/api/client';
import { displayName, displayUnit } from '@/lib/display-names';
import { engineeringQuantity, parameterUnit, significantNumber } from '@/lib/format';
import { parseInput, type NumericInput } from '@/lib/domain-fields';
import { EmptyState } from './states';
import { expand } from '@/lib/contract-schema';
import { KeyedMapEditor, NumberListEditor, ParameterSource, RowsEditor, TupleListEditor } from './structured-parameter';
import { RangeField, isRangeField } from './ui/range-field';
import { Select } from './ui/select';
import { clearParameterDrafts, declaredParameterDefaults, nullableParameter, reindexParameterDrafts } from '@/lib/study-parameter-form';
import { appendFieldPath, pointerParts } from '@/lib/missing-input';

type Props = ComponentProps<typeof ContractFields>;
type Entry = { name: string; path: string; label: string; ownLabel: string; group: string; groupOrder: number; level: 'basic' | 'advanced' | 'expert'; order: number; field?: CoreField; source: Record<string, unknown>; spec?: NumericInput; integer?: boolean; json?: boolean;
  /** 结构化参数：数值列表、对象数组、按模型对象分项的映射；不进入表单引擎，直接按 SI 写回。 */
  structure?: 'range' | 'list' | 'rows' | 'map' | 'object' | 'source' | 'tuples'; keys?: { value: string; label: string }[]; required?: boolean };
/**
 * 插件清单的参数界面元数据：x-group / x-order / x-level 决定分组、顺序与折叠，x-unit 给显示单位与换算，
 * x-bind 声明引用的工程模型对象，x-enum-labels 给选项中文名，x-default-basis 写默认值依据。
 * 没有声明时：同层分组、全部视为基本参数、单位按字段名推断。
 */
const levelOf = (source: Record<string, unknown>): Entry['level'] => source['x-level'] === 'advanced' || source['x-level'] === 'expert' ? source['x-level'] : 'basic';
/** x-bind 绑定类型 → 宿主提供的模型对象选项键（兼容早期的字符串写法）。 */
const BIND_KEYS: Record<string, string> = { section: 'section_id', load: 'load_case_id', cable_type: 'cable_type_id', material: 'material', cable: 'cable', circuit: 'circuit', duct: 'duct', layer:'layer', region:'region', 'domain.section': 'section_id', 'domain.load_case': 'load_case_id', 'domain.cable_type': 'cable_type_id' };
const bindKey = (value: unknown) => BIND_KEYS[typeof value === 'string' ? value : text(optionalRecord(value).type)];
/** 分组标题与顺序：x-groups 可以是 [{id, title, order}] 或 {id: {title, order}}。 */
function groupTable(value: unknown): Map<string, { title: string; order: number }> {
  const rows = Array.isArray(value) ? value.map(optionalRecord).map((row, index) => [text(row.id), { title: text(row.title), order: numeric(row.order) ?? index }] as const)
    : Object.entries(optionalRecord(value)).map(([id, row], index) => [id, { title: text(optionalRecord(row).title), order: numeric(optionalRecord(row).order) ?? index }] as const);
  return new Map(rows.filter(([id]) => id));
}
function compile(schema: unknown, root: unknown, prefix: string, module: string, readOnly: boolean, references: Record<string, { value: string; label: string }[]> = {}, entries: Entry[] = [], parent = '', declared = groupTable(optionalRecord(schema)['x-groups'] ?? optionalRecord(root)['x-groups'])): Entry[] {
  const model = expand(schema, root);
  for (const [key, raw] of Object.entries(optionalRecord(model.properties))) {
    const source = expand(raw, root), path = appendFieldPath(prefix,key);
    // Release identities are fixed evidence, edited through the source picker rather than parameter text inputs.
    if (/_sha256$/.test(key) || key === 'run_id' || key === 'case_id' || key === 'artifact_type') continue;
    // 字段只显示自己的名称；上级层次作为分组标题（属性表式），不再拼成长串
    const ownLabel = displayName(key, text(source.title) || key), label = parent ? parent + ' · ' + ownLabel : ownLabel;
    const required = Array.isArray(model.required) && model.required.includes(key);
    if (source.type === 'object' && source.properties && required && !nullableParameter(source) && path.split('/').length < 12) { compile(source, root, path, module, readOnly, references, entries, label, declared); continue; }
    const name = module.replace(/[^a-zA-Z0-9_-]/g, '_') + '_parameter_' + Array.from(path).map(letter=>letter.codePointAt(0)!.toString(16)).join('_');
    const basis = optionalRecord(source['x-default-basis']), reason = text(source['x-editor-reason']);
    const description = [text(source.description), text(basis.reference) && '默认值依据：' + text(basis.reference), reason].filter((line) => /[\u4e00-\u9fff]/.test(line)).join('\n');
    const binding = optionalRecord(source['x-bind']);
    const base = { name, label: ownLabel.split(' · ').pop() || ownLabel, required, readOnly: readOnly || source.const !== undefined || binding.read_only === true, meta: {path}, description };
    let field: CoreField | undefined, spec: NumericInput | undefined, integer = false, json = false, structure: Entry['structure'], keys: Entry['keys'];
    const bound = references[bindKey(source['x-bind']) || key];
    const enumLabels = optionalRecord(source['x-enum-labels']), declaredUnit = optionalRecord(source['x-unit']);
    const items = source.type === 'array' ? expand(source.items, root) : {}, mapped = source.type === 'object' && !source.properties ? expand(source.additionalProperties, root) : {};
    if (source.type==='object' && source.properties) structure='object';
    // A presentation group does not change a declared enum or object binding
    // into free text (for example IEC reference_basis in the evidence group).
    else if (source.type==='string' && !Array.isArray(source.enum) && bound===undefined && !source['x-bind'] && (key==='source' || source['x-group']==='evidence')) structure='source';
    else if (isRangeField(key, source, root)) structure = 'range';
    else if (source.type === 'array' && (items.type === 'number' || items.type === 'integer')) structure = 'list';
    else if (source.type === 'array' && items.type === 'object' && items.properties) structure = 'rows';
    else if (source.type === 'array' && items.type === 'array' && Array.isArray(items.prefixItems) && items.prefixItems.every(raw=>expand(raw,root).type==='number')) structure='tuples';
    else if (source.type === 'object' && !source.properties && Object.keys(mapped).length) { structure = 'map'; keys = bound || []; }
    if (structure) { /* 结构化编辑器在分组里单独渲染 */ }
    else if (source.type === 'string' && bound !== undefined) {
      // 引用工程模型里的对象：从真实的截面、负荷、电缆结构中选，不手填编号
      field = { ...base, type: 'select', options: [...(nullableParameter(source) ? [{value:'__none__',label:'明确不指定'}] : []),...bound], description: bound.length ? description : '当前工程没有可引用的对象，请先完善工程模型。' };
    } else if (Array.isArray(source.enum) && source.enum.every(value => typeof value === 'string')) {
      field = { ...base, type: 'select', options: [...(nullableParameter(source) ? [{value:'__none__',label:'明确不指定'}] : []), ...source.enum.map(value => ({ value: String(value), label: text(enumLabels[String(value)]) || displayName(String(value)) }))] };
    } else if (source.type === 'number' || source.type === 'integer') {
      integer = source.type === 'integer';
      // 清单声明了显示单位就按它换算（显示值 = SI × scale + offset），否则按字段名推断
      const unit = parameterUnit(key, source), hasUnit = 'display' in declaredUnit;
      const display = hasUnit ? { unit: displayUnit(text(declaredUnit.display) || text(declaredUnit.si)), scale: numeric(declaredUnit.scale) ?? 1, offset: numeric(declaredUnit.offset) ?? 0 } : engineeringQuantity(key, null, unit);
      const shown = (value: number | null) => value === null ? undefined : hasUnit ? value * display.scale + display.offset : engineeringQuantity(key, value, unit).value ?? undefined;
      spec = { path, label, unit: display.unit, scale: display.scale, offset: display.offset, required: required && !nullableParameter(source),
        min: shown(numeric(source.minimum) ?? numeric(source.exclusiveMinimum)),
        minExclusive: numeric(source.exclusiveMinimum) !== null,
        max: shown(numeric(source.maximum) ?? numeric(source.exclusiveMaximum)) };
      // Full constraints remain visible and wrap; a narrow input cannot carry the range.
      // SI offsets can introduce binary tails; format the hint without rounding stored limits.
      const rangeValue = (value: number) => {
        const rounded = Number(value.toPrecision(12));
        return rounded !== 0 && (Math.abs(rounded) < 0.0001 || Math.abs(rounded) >= 10000000)
          ? significantNumber(rounded, 4) : String(rounded).replace('-', '−');
      };
      const range = [spec.min === undefined ? '' : `${spec.minExclusive ? '>' : '≥'} ${rangeValue(spec.min)}`, spec.max === undefined ? '' : `${source.exclusiveMaximum !== undefined ? '<' : '≤'} ${rangeValue(spec.max)}`].filter(Boolean).join('，');
      field = { ...base, type: 'number', min: spec.min, max: spec.max, ui: {suffix: display.unit, hideSteppers: true, rangeHint:range ? `允许范围：${range}${display.unit && display.unit!=='1' ? ' '+display.unit : ''}` : undefined} };
    } else if (source.type === 'boolean') field = {...base, type: 'switch'};
    else { json = source.type !== 'string'; field = {...base, type: 'text', ...(json ? { placeholder: 'JSON（按方法契约）' } : { minLength: numeric(source.minLength) ?? undefined, maxLength: numeric(source.maxLength) ?? undefined, pattern: text(source.pattern) || undefined })}; }
    const declaredGroup = text(source['x-group']), group = declared.get(declaredGroup);
    const entry: Entry = { name, path, label, ownLabel: base.label, group: group?.title || declaredGroup || parent || '基本参数', groupOrder: group?.order ?? Number.MAX_SAFE_INTEGER, level: levelOf(source), order: numeric(source['x-order']) ?? entries.length, source, spec, integer, json, field, structure, keys, required };
    if (field) field.validate = { onChange: { checks: [{type: 'hostParameter', args: {index: entries.length}, message: `${label}不符合参数契约，请检查必填项、范围或格式。`}] } };
    entries.push(entry);
  }
  return entries;
}
function stored(entry: Entry, value: unknown): unknown {
  if (nullableParameter(entry.source) && (value==='__none__' || value===null || value===undefined || value==='')) return null;
  if (entry.spec) {
    const result = parseInput(entry.spec, value === undefined || value === null ? '' : String(value));
    if (entry.integer && result !== null && !Number.isInteger(result)) throw new Error('请输入整数');
    if (entry.source.exclusiveMaximum !== undefined && result !== null && result >= Number(entry.source.exclusiveMaximum)) throw new Error('超出范围');
    return result === null && !entry.spec.required ? undefined : result;
  }
  if (entry.json) return value === '' || value === undefined ? undefined : JSON.parse(String(value));
  if (entry.field?.required && (value === undefined || value === '')) throw new Error('必填');
  if (entry.source.const !== undefined && value !== entry.source.const) throw new Error('固定值');
  if (Array.isArray(entry.source.enum) && value !== undefined && value !== '' && !entry.source.enum.includes(value)) throw new Error('请选择契约中的选项');
  if (typeof value === 'string' && (entry.source.minLength !== undefined && value.length < Number(entry.source.minLength) || entry.source.maxLength !== undefined && value.length > Number(entry.source.maxLength))) throw new Error('文本长度不符合契约');
  if (entry.source.pattern && typeof value === 'string' && !new RegExp(String(entry.source.pattern)).test(value)) throw new Error('格式');
  return value;
}
export function BuzzformContractFields(props: Props) {
  const { module, schema, root, prefix, values, readOnly, onChange, onDraftChange = () => {}, draftFields = {}, references, fieldErrors = {} } = props;
  const entries = useMemo(() => compile(schema, root, prefix, module, readOnly, references), [schema, root, prefix, module, readOnly, references]);
  const valueAt = (entry: Entry) => { let value: unknown = values; for (const part of pointerParts(entry.path.slice(prefix.length))) value = optionalRecord(value)[part]; return value; };
  const defaults = Object.fromEntries(entries.filter(entry => entry.field).map(entry => {
    const value = valueAt(entry);
    const draft = draftFields[module + entry.path]?.text;
    return [entry.name, draft !== undefined ? entry.spec ? draft === '' ? undefined : Number(draft) : draft : entry.spec ? numeric(value) === null ? undefined : Number(value) * (entry.spec.scale ?? 1) + (entry.spec.offset ?? 0) : entry.json ? (value === undefined || value === null ? '' : JSON.stringify(value)) : value === null && entry.field?.type==='select' ? '__none__' : value];
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
    else onChange(entry.path, value==='__none__' && nullableParameter(entry.source) ? null : value);
  }, onBlur: ({fieldApi}: { fieldApi: { name: string; state: { value: unknown } } }) => {
    const entry = entries.find(entry => entry.name === fieldApi.name);
    if (!entry || readOnly || (!entry.spec && !entry.json)) return;
    if (!draftFields[module + entry.path]) return;
    try { onChange(entry.path, stored(entry, fieldApi.state.value)); onDraftChange(undefined, module + entry.path); } catch { /* Keep invalid text in the formal draft; Save also validates it. */ }
  } };
  // 一组参数 = 标题 + 名称/数值两列的属性表；高级与专家参数收进折叠区（普通渲染函数，避免每次重绘重新挂载表单）
  const structured = (entry: Entry) => {
    const props = { field: entry.source, root, value: valueAt(entry), readOnly: readOnly || optionalRecord(entry.source['x-bind']).read_only === true, label: entry.ownLabel };
    const renderObject = (schema:unknown, values:Record<string,unknown>, prefix:string) => <BuzzformContractFields module={module} schema={schema} root={root} values={values} prefix={prefix} readOnly={readOnly} onChange={onChange} onDraftChange={onDraftChange} draftFields={draftFields} references={references} fieldErrors={fieldErrors} />;
    const replaceDrafts = (next: typeof draftFields) => {
      // Delete all changed keys before inserting shifted rows: a new /0 must not
      // be removed while clearing the previous /0 or /1 from the same batch.
      for (const [key, field] of Object.entries(draftFields)) if (next[key] !== field) onDraftChange(undefined, key);
      for (const [key, field] of Object.entries(next)) if (draftFields[key] !== field) onDraftChange(field, key);
    };
    const replaceObject = (value: unknown) => {
      replaceDrafts(clearParameterDrafts(draftFields, module, entry.path));
      onChange(entry.path, value);
    };
    const changeRows = (value: Record<string, unknown>[]) => {
      const previous = Array.isArray(props.value) ? props.value : [];
      if (value.length !== previous.length) replaceDrafts(reindexParameterDrafts(draftFields, module, entry.path, value.map(row => previous.indexOf(row))));
      onChange(entry.path, value);
    };
    const changeMap = (value: Record<string, unknown>) => {
      let next = draftFields;
      for (const key of Object.keys(optionalRecord(props.value))) if (!Object.hasOwn(value, key)) next = clearParameterDrafts(next, module, appendFieldPath(entry.path, key));
      replaceDrafts(next);
      onChange(entry.path, value);
    };
    return <div key={entry.name} className="parameter-structured" data-field-path={entry.path}>
      <span className="parameter-structured-label" title={text(entry.source.description) || undefined}>{entry.ownLabel}</span>
      {entry.structure === 'object' ? <><Select label={`${entry.ownLabel} · 配置`} value={props.value===null ? 'none' : props.value===undefined ? 'unset' : 'set'} disabled={readOnly} error={fieldErrors[entry.path]} options={[{value:'unset',label:entry.required ? '请选择' : '未单独设置'},...(nullableParameter(entry.source) ? [{value:'none',label:'明确不指定'}] : []),{value:'set',label:'逐项配置'}]} onChange={value=>replaceObject(value==='set' ? declaredParameterDefaults(entry.source,root) : value==='none' ? null : undefined)} />{props.value && typeof props.value==='object' ? renderObject(entry.source,optionalRecord(props.value),entry.path) : null}</>
        : entry.structure==='source' ? <ParameterSource {...props} error={fieldErrors[entry.path]} onChange={value=>onChange(entry.path,value)} />
        : entry.structure === 'range' ? <RangeField {...props} module={module} path={entry.path} draftFields={draftFields} onDraftChange={onDraftChange} onChange={value => onChange(entry.path, value)} />
        : entry.structure === 'list' ? <NumberListEditor {...props} path={entry.path} onChange={value => onChange(entry.path, value)} />
          : entry.structure === 'rows' ? <RowsEditor {...props} path={entry.path} renderObject={renderObject} onChange={changeRows} />
            : entry.structure==='tuples' ? <TupleListEditor {...props} path={entry.path} onChange={value=>onChange(entry.path,value)} />
            : <KeyedMapEditor {...props} path={entry.path} keys={entry.keys || []} renderObject={renderObject} onChange={changeMap} />}
      {fieldErrors[entry.path] && entry.structure!=='source' && entry.structure!=='object' && <p className="field-error" role="alert">{fieldErrors[entry.path]}</p>}
    </div>;
  };
  const parameterGroup = ({ group, entries: items }: { group: string; entries: Entry[] }) => {
    const plain = items.filter(entry => entry.field);
    const fields = plain.map(entry => {
      let error=fieldErrors[entry.path];
      if(draftFields[module+entry.path])try{stored(entry,defaults[entry.name]);}catch{error=`请填写有效的${entry.ownLabel}；请核对必填项和范围。`;}
      return {...entry.field!,meta:{...entry.field!.meta,...(error?{error}:{})}};
    });
    return <section key={group} className="parameter-group" aria-label={group}>
      <h4>{group}</h4>
      {plain.length > 0 && <Form schema={{fields}} defaultValues={Object.fromEntries(plain.map(entry => [entry.name, defaults[entry.name]]))} registries={registries} listeners={listeners}>
        <FormContent as="div"><FormFields className="parameter-fields" /></FormContent>
      </Form>}
      {items.filter(entry => entry.structure).map(structured)}
    </section>;
  };
  // 按契约层次分组：每组一个标题 + 名称/数值两列的属性表
  return <div className="buzzform-contract" data-contract-form={module}>
    {groups.map(parameterGroup)}
    {advanced.length > 0 && <details className="parameter-advanced">
      <summary>高级参数 <span>{advanced.length}</span></summary>
      {groupsOf(advanced).map(parameterGroup)}
    </details>}
  </div>;
}
