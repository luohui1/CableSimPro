/** Presentation helpers for exact, installed parameter contracts. No engineering
 * values are inferred here: defaults and constants must exist in the contract. */
type ObjectValue = Record<string, unknown>;
export type ParameterReferences = Record<string, { value: string; label: string }[]>;
const object = (value: unknown): ObjectValue => value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
const list = (value: unknown): ObjectValue[] => Array.isArray(value) ? value.map(object) : [];
const pathPart = (value: string | number) => String(value).replace(/~/g, '~0').replace(/\//g, '~1');

export function parameterSchema(raw: unknown, root: unknown): ObjectValue {
  let field = object(raw);
  if (typeof field.$ref === 'string' && field.$ref.startsWith('#/')) {
    let target: unknown = root;
    for (const part of field.$ref.slice(2).split('/')) target = object(target)[part.replace(/~1/g, '/').replace(/~0/g, '~')];
    field = { ...object(target), ...field };
  }
  if (Array.isArray(field.anyOf)) field = { ...parameterSchema(field.anyOf.find(item => object(item).type !== 'null'), root), ...field };
  return field;
}

export const nullableParameter = (field: ObjectValue) => field.type === 'null' || Array.isArray(field.anyOf) && field.anyOf.some(item => object(item).type === 'null');

export function declaredParameterDefaults(schema: unknown, root: unknown = schema): ObjectValue {
  const field = parameterSchema(schema, root), required = Array.isArray(field.required) ? field.required : [];
  return Object.fromEntries(Object.entries(object(field.properties)).flatMap(([key, raw]) => {
    const child = parameterSchema(raw, root);
    if (Object.hasOwn(child, 'default')) return [[key, structuredClone(child.default)]];
    if (Object.hasOwn(child, 'const')) return [[key, structuredClone(child.const)]];
    if (required.includes(key) && child.type === 'object' && child.properties && !nullableParameter(child)) {
      const nested = declaredParameterDefaults(child, root);
      return Object.keys(nested).length ? [[key, nested]] : [];
    }
    return [];
  }));
}

/** Immutable JSON-pointer update, including escaped object IDs and array slots. */
export function setParameterValue(values: ObjectValue, path: string, value: unknown): ObjectValue {
  if (!path.startsWith('/') || /~(?:[^01]|$)/.test(path)) throw new Error('参数字段路径无效');
  const parts = path.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  const result = structuredClone(values);
  let target = result;
  for (let index = 0; index < parts.length - 1; index++) {
    const key = parts[index];
    if (!target[key] || typeof target[key] !== 'object') target[key] = /^\d+$/.test(parts[index + 1]) ? [] : {};
    target = target[key] as ObjectValue;
  }
  const key = parts.at(-1)!;
  if (value === undefined && Array.isArray(target)) target[Number(key)] = null;
  else if (value === undefined) delete target[key];
  else target[key] = value;
  return result;
}

type LocatedParameterDraft = { path: string; spec?: { path: string } };
const withinParameterPath = (candidate: string, path: string) => candidate === path || candidate.startsWith(path + '/');

/** The storage key keeps the form namespace even when a crosscheck rewrites
 * draft.module for the host. Reset only this exact form and pointer subtree. */
export function clearParameterDrafts<T extends LocatedParameterDraft>(fields: Record<string, T>, namespace: string, path: string): Record<string, T> {
  return Object.fromEntries(Object.entries(fields).filter(([key, field]) => key !== namespace + field.path || !withinParameterPath(field.path, path)));
}

/** After an array edit, each new row identifies its previous position (-1 for a
 * new row). Removed drafts disappear; surviving text and metadata move together.
 * JSON-pointer tokens in the remaining suffix are copied without decoding. */
export function reindexParameterDrafts<T extends LocatedParameterDraft>(fields: Record<string, T>, namespace: string, path: string, previousIndices: number[]): Record<string, T> {
  const result = clearParameterDrafts(fields, namespace, path);
  const nextIndices = new Map(previousIndices.flatMap((previous, next) => previous >= 0 ? [[previous, next] as const] : []));
  for (const [key, field] of Object.entries(fields)) {
    if (key !== namespace + field.path || !field.path.startsWith(path + '/')) continue;
    const relative = field.path.slice(path.length + 1), slash = relative.indexOf('/');
    const position = slash < 0 ? relative : relative.slice(0, slash);
    if (!/^(0|[1-9]\d*)$/.test(position)) continue;
    const previous = Number(position), next = nextIndices.get(previous);
    if (next === undefined) continue;
    if (next === previous) { result[key] = field; continue; }
    const oldRow = path + '/' + position, newRow = path + '/' + next;
    const relocated = newRow + field.path.slice(oldRow.length);
    result[namespace + relocated] = {
      ...field,
      path: relocated,
      ...(field.spec && withinParameterPath(field.spec.path, oldRow) ? { spec: { ...field.spec, path: newRow + field.spec.path.slice(oldRow.length) } } : {}),
    };
  }
  return result;
}

/** Local field feedback supplements, and never replaces, the host's validation. */
export function parameterErrors(schema: unknown, value: unknown, root: unknown = schema, path = '', required = true): Record<string, string> {
  const field = parameterSchema(schema, root), errors: Record<string, string> = {};
  const label = typeof field.title === 'string' && /[\u4e00-\u9fff]/.test(field.title) ? field.title : '此项';
  const fail = (message: string) => { errors[path] = message; return errors; };
  if (value === undefined) return required ? fail(`请填写${label}`) : errors;
  if (value === null) return nullableParameter(field) ? errors : fail(`请填写${label}`);
  if (Object.hasOwn(field, 'const') && value !== field.const) return fail(`${label}须使用方法声明的固定值`);
  if (Array.isArray(field.enum) && !field.enum.includes(value)) return fail(`请选择${label}的有效选项`);
  if (field.type === 'object') {
    if (typeof value !== 'object' || Array.isArray(value)) return fail(`${label}须逐项填写`);
    const properties = object(field.properties), supplied = object(value), mandatory = Array.isArray(field.required) ? field.required : [];
    for (const [key, child] of Object.entries(properties)) Object.assign(errors, parameterErrors(child, supplied[key], root, path + '/' + pathPart(key), mandatory.includes(key)));
    if (field.additionalProperties && typeof field.additionalProperties === 'object') for (const [key, child] of Object.entries(supplied)) {
      if (!(key in properties)) Object.assign(errors, parameterErrors(field.additionalProperties, child, root, path + '/' + pathPart(key)));
    }
    if (field.additionalProperties === false && Object.keys(supplied).some(key => !(key in properties))) fail(`${label}含有当前方法不接受的参数，请核对来源版本`);
  } else if (field.type === 'array') {
    if (!Array.isArray(value)) return fail(`${label}须逐项填写`);
    if (typeof field.minItems === 'number' && value.length < field.minItems) fail(`${label}至少需要 ${field.minItems} 项`);
    if (typeof field.maxItems === 'number' && value.length > field.maxItems) fail(`${label}最多允许 ${field.maxItems} 项`);
    value.forEach((item, index) => Object.assign(errors, parameterErrors(Array.isArray(field.prefixItems) ? field.prefixItems[index] : field.items, item, root, path + '/' + index)));
  } else if (field.type === 'number' || field.type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fail(`请填写${label}的有效数值`);
    if (field.type === 'integer' && !Number.isInteger(value)) return fail(`${label}须为整数`);
    if (typeof field.minimum === 'number' && value < field.minimum || typeof field.exclusiveMinimum === 'number' && value <= field.exclusiveMinimum || typeof field.maximum === 'number' && value > field.maximum || typeof field.exclusiveMaximum === 'number' && value >= field.exclusiveMaximum) fail(`${label}超出方法声明的范围`);
  } else if (field.type === 'boolean' && typeof value !== 'boolean') fail(`请明确选择${label}`);
  else if (field.type === 'string') {
    if (typeof value !== 'string') return fail(`请填写${label}`);
    if (required && !value.trim() || typeof field.minLength === 'number' && value.length < field.minLength) fail(`请填写${label}`);
    else if (typeof field.maxLength === 'number' && value.length > field.maxLength) fail(`${label}文字过长`);
    else if (typeof field.pattern === 'string' && !new RegExp(field.pattern).test(value)) fail(`${label}格式不符合方法契约`);
  }
  return errors;
}

/** References come only from the selected real workspace. */
export function parameterReferences(domain: unknown, label: (id: string) => string): ParameterReferences {
  const model = object(domain), options = (rows: ObjectValue[]) => rows.flatMap(row => typeof row.id === 'string' ? [{ value: row.id, label: label(row.id) }] : []);
  return {
    section_id: options(list(model.sections)), load_id: options(list(model.load_cases)), load_case_id: options(list(model.load_cases)),
    cable_type_id: options(list(model.cable_types)), material: options(list(model.materials)), circuit: options(list(model.circuits)),
    cable: options(list(model.circuits).flatMap(row => list(row.cables))),
    duct: options(list(model.sections).flatMap(row => list(row.enclosures).filter(item => item.type === 'duct'))),
  };
}

/** Scope focus to the active form; expand hidden groups before focusing. */
export function focusParameterField(root: HTMLElement | null, path?: string) {
  if (!root) return;
  const nodes = [...root.querySelectorAll<HTMLElement>('[data-field-path]')];
  const node = nodes.find(item => item.dataset.fieldPath === path) || nodes.find(item => path && item.dataset.fieldPath?.startsWith(path + '/'));
  const input = node?.matches('input,textarea,button,select') ? node : node?.querySelector<HTMLElement>('input,textarea,button,select');
  const target = input || root.querySelector<HTMLElement>('[aria-invalid="true"]');
  if (!target) return;
  for (let parent: HTMLElement | null = target; parent && root.contains(parent); parent = parent.parentElement) if (parent.tagName === 'DETAILS') parent.setAttribute('open', '');
  target.focus(); target.scrollIntoView({ block: 'center' });
}
