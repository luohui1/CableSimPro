import { pointerParts } from '../../lib/missing-input.ts';

export function requestErrorPointer(issue: Record<string, unknown>): string {
  if (typeof issue.path === 'string' && pointerParts(issue.path).length) return issue.path;
  if (!Array.isArray(issue.loc)) return '';
  const parts = issue.loc[0] === 'body' ? issue.loc.slice(1) : issue.loc;
  return parts.length ? '/' + parts.map(part => String(part).replaceAll('~', '~0').replaceAll('/', '~1')).join('/') : '';
}

export function requestFieldMatch(path: string, available: string[]): string | undefined {
  const wanted = pointerParts(path);
  if (!wanted.length) return undefined;
  // Match a full pointer or its closest explicitly declared group; never a leaf
  // name shared by another model, candidate, or array element.
  return available.map(path => ({ path, parts: pointerParts(path) }))
    .filter(item => item.parts.length > 0 && item.parts.length <= wanted.length && item.parts.every((part, index) => part === wanted[index]))
    .sort((a, b) => b.parts.length - a.parts.length)[0]?.path;
}

export const requestFieldNames: Record<string, string> = {
  '/model/designation': '型号系列', '/model/specification': '规格行／列', '/model/identity_note': '型号分支',
  '/method': '识别方法', '/selections': '提取范围', '/reviewer': '核对人',
  '/decisions/0/action': '核对决定', '/decisions/0/value': '修订值', '/decisions/0/unit': '修订单位', '/decisions/0/reason': '核对理由',
  '/new_model': '新型号身份', '/new_model/name': '型号名称', '/new_model/manufacturer': '厂家',
  '/new_model/u0_v': '相对地电压', '/new_model/voltage_v': '额定电压', '/new_model/cores': '芯数', '/new_model/area_m2': '每芯截面', '/new_model/conductor': '导体材料', '/new_model/identity_reference': '身份信息原文依据',
  '/target_model_id': '目标型号', '/version': '新版本名称', '/field_bindings': '目标结构字段', '/approver': '批准人', '/human_approved': '批准确认',
};

export function requestFieldLabel(path: string): string {
  return requestFieldNames[requestFieldMatch(path, Object.keys(requestFieldNames)) || ''] || '输入字段';
}

export function focusRequestField(path: string) {
  const fields = Array.from(document.querySelectorAll<HTMLElement>('[data-request-path]'));
  const match = requestFieldMatch(path, fields.map(node => node.dataset.requestPath || ''));
  const field = fields.find(node => match !== undefined && node.dataset.requestPath === match);
  if (!field) return;
  field.closest('details')?.setAttribute('open', ''); field.focus(); field.scrollIntoView({ block: 'center' });
}
