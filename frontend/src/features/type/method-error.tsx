/** Installation diagnostics are preserved for administrators, outside the work surface. */
import { displayText } from '@/lib/display-names';
export function methodDiagnostic(error: unknown) { return error instanceof Error ? error.message : '请求失败，请重试读取。'; }
export function methodErrorText(value: string) {
  if (/摘要不一致|封签|release_digest|manifest|SHA256/i.test(value)) {
    const name = /standard.check|产品标准尺寸核对/.test(value) ? '标准核对插件' : '计算方法';
    return name + '文件与发布记录不一致，请联系管理员重新安装。';
  }
  if (/\.(?:py|json)|cablesim\.|Traceback|\/src\//.test(value))
    return '计算方法暂时不可用，请重新读取；仍失败时联系管理员检查安装。';
  return displayText(value);
}
export function MethodErrorDetail({ value }: { value: string }) {
  return methodErrorText(value) === value ? null : <details className="type-method-error-detail">
    <summary>诊断详情</summary><p>{value}</p>
  </details>;
}
