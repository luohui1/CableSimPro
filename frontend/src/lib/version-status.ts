import { optionalRecord, text } from '@/api/client';
import { displayName } from './display-names';

export function isVersionStale(value: unknown): boolean {
  return optionalRecord(optionalRecord(value).version_status).status === 'stale';
}
export function versionReasons(value: unknown): string[] {
  const status = optionalRecord(optionalRecord(value).version_status);
  const reasons = Array.isArray(status.reasons) ? status.reasons : [];
  return [...new Set(reasons.map(value => {
    const reason = optionalRecord(value), id = text(reason.id), name = displayName(id);
    const method = name && name !== id && !name.includes('cablesim.') ? name : '计算方法';
    if (reason.code === 'METHOD_VERSION_CHANGED') return `${method}已更新，现有结果使用的是旧方法版本。`;
    if (reason.code === 'METHOD_UNAVAILABLE') return `${method}当前不可用，请核对已安装的方法。`;
    if (reason.code === 'MODEL_VERSION_CHANGED') return '引用型号已更新，现有结果使用的是旧型号版本。';
    return '输入或方法版本已变化，请核对后重算。';
  }))];
}
