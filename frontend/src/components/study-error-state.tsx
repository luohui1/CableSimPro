import type { ComponentProps } from 'react';
import { ErrorState } from './states';
import { StudyDetailGroup } from './study-detail-group';

/** Installation diagnostics remain available for administrators, outside L1. */
export function studyErrorDescription(raw: string) {
  const sealFailure = /PLUGIN_SEAL_INVALID|PACKAGE_DIGEST_MISMATCH|与清单摘要不一致|封签.*(?:失配|不一致|失败)|seal.*(?:invalid|mismatch)/i.test(raw);
  if (!sealFailure) return raw;
  const name = raw.split(/[：:]/)[0].trim();
  const label = name && !/[\/\\]|PLUGIN_|cablesim\./.test(name) && name.length < 40 ? name.replace(/插件$/, '') + '插件' : '计算插件';
  return `${label}校验失败，请联系管理员重新安装或校验插件。保存的输入和运行记录不变。`;
}
export function StudyErrorState(props: ComponentProps<typeof ErrorState>) {
  const raw=props.description,description=studyErrorDescription(raw);
  if(description===raw)return <ErrorState {...props} />;
  return <>
    <ErrorState {...props} description={description} />
    <StudyDetailGroup id="plugin-failure-trace" title="插件校验追溯"><p className="cell-wrap">{raw}</p></StudyDetailGroup>
  </>;
}
