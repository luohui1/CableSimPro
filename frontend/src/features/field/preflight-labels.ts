import { optionalRecord, text } from '@/api/client';
import { pointerParts } from '@/lib/missing-input';
import { displayName } from '@/lib/display-names';
import { expand } from '@/lib/contract-schema';
const fieldNames: Record<string, string> = { electromagnetic_options: '电磁求解选项',
  external_material: '外域材料', material_temperatures: '材料温度状态', mesh: '网格',
  thermal_boundaries: '热边界', material_validity: '材料有效范围',
  initial_temperature_k: '初始绝对温度', section_id: '敷设截面', load_case_id: '负荷工况' };

/** Paths remain machine readable for navigation, while prose uses contract titles. */
export function preflightFieldLabel(path: string, schema: Record<string, unknown>) {
  const parts = pointerParts(path);
  if (parts[0] === 'parameters') parts.shift();
  let node = schema;
  const labels: string[] = [];
  for (const part of parts) {
    node = expand(node, schema);
    if (node.type === 'array') { node = optionalRecord(node.items); if (/^\d+$/.test(part)) continue; }
    node = optionalRecord(optionalRecord(node.properties)[part]);
    const label = fieldNames[part] || text(node.title) || displayName(part);
    if (/[\u3400-\u9fff]/.test(label)) labels.push(label);
  }
  return labels.join(' · ') || '方法参数';
}

export function readablePreflight(data: Record<string, unknown> | undefined, schema: Record<string, unknown>) {
  if (!data) return undefined;
  const transform = (raw: unknown) => {
    const item = optionalRecord(raw), error = optionalRecord(item.error);
    if (!item.error) return item;
    const issues = (Array.isArray(error.issues) && error.issues.length ? error.issues : [error]).map(rawIssue => {
      const issue = optionalRecord(rawIssue), path = text(issue.path) || text(error.path);
      const label = preflightFieldLabel(path, schema);
      const original = text(issue.message);
      const message = /required|必填|缺少/i.test(original) ? `${label}未填写，请补齐后重新预检。`
        : /INPUT_|\/parameters|契约|\b(?:type|enum|minimum|maximum)\b/.test(original) ? `${label}不符合方法要求，请核对单位、范围和选项。`
        : original || `${label}需要核对。`;
      return { ...issue, path, message };
    });
    return { ...item, error: { ...error, issues } };
  };
  const scopes = Array.isArray(data.method_scopes) ? data.method_scopes.map(raw => {
    const scope = optionalRecord(raw);
    return { ...scope, limitations: Array.isArray(scope.limitations)
      ? scope.limitations.map(value => typeof value === 'string' ? value.replace(/reference_only/g, '仅供参考，未经工程批准') : value)
      : scope.limitations };
  }) : data.method_scopes;
  return { ...data, method_scopes: scopes, cases: Array.isArray(data.cases) ? data.cases.map(transform) : data.cases,
    crosschecks: Array.isArray(data.crosschecks) ? data.crosschecks.map(transform) : data.crosschecks };
}
