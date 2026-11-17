/** Installation diagnostics are preserved for administrators, outside the work surface. */
import { displayName, displayText } from '@/lib/display-names';
export function methodDiagnostic(error: unknown) { return error instanceof Error ? error.message : '请求失败，请重试读取。'; }
export function methodErrorText(value: string) {
  if (isStructureSourceError(value))
    return '型号结构来源待补：请核对三芯尺寸、成缆绞距、屏蔽电阻与铠装绕包的真实依据，在结构页录入出处后重新计算。';
  const field = /(?:^|[：:]\s*)\/parameters\/([^：:\s]+)[：:]\s*(.*)/.exec(value);
  if (field) {
    const label = field[1].split('/').map(key => displayName(key)).join(' · ');
    const prefix = value.slice(0, field.index).trim();
    return (prefix ? prefix + '：' : '') + (/[（(]required[）)]|必填|缺少/.test(field[2])
      ? '请填写' + label + '及其工程来源，再重新计算。'
      : label + '不符合方法要求，请核对数值、单位与适用范围。');
  }
  // Input evidence may be checked against a sealed rule while the installed
  // method itself is verified. Do not translate that rejection into reinstall.
  if (/标准依据快照与已封签的判据不一致/.test(value))
    return '当前标准依据与本次校核条件不一致，请在方法参数中重新核对并查询依据。';
  if (/(?:源(?:码|文件)|文件|目录|发行|清单|manifest|release_digest).{0,40}(?:摘要不一致|校验失败|被修改|不匹配)|(?:摘要不一致|校验失败|不匹配).{0,40}(?:源文件|文件|目录|发行|manifest|release_digest)/i.test(value)) {
    const name = /standard.check|产品标准尺寸核对/.test(value) ? '标准核对插件' : '计算方法';
    return name + '文件与发布记录不一致，请联系管理员重新安装。';
  }
  if (/\.(?:py|json)|cablesim\.|Traceback|\/src\//.test(value))
    return '计算方法暂时不可用，请重新读取；仍失败时联系管理员检查安装。';
  return displayText(value);
}
export function isStructureSourceError(value: string) {
  return /(?:^|[：:]\s*)provenance\/cable_types[：:]/.test(value)
    && /三芯尺寸、成缆绞距、屏蔽电阻与铠装绕包需可追溯来源/.test(value);
}
export function MethodErrorDetail({ value }: { value: string }) {
  return methodErrorText(value) === value ? null : <details className="type-method-error-detail">
    <summary>诊断详情</summary><p>{value}</p>
  </details>;
}
