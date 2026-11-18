import { Icon } from './icon';
import { displayText } from '@/lib/display-names';
import { Tooltip } from './ui/tooltip';
import './source-badge.css';

export const sourceKinds = {
  demo: { label: '教学', icon: 'source/from-document' },
  user: { label: '工程师填写', icon: 'source/from-user' },
  calculation: { label: '计算', icon: 'run/run' },
  document: { label: '厂家', icon: 'source/from-document' },
  standard: { label: '标准', icon: 'source/from-standard' },
  literature: { label: '文献', icon: 'source/from-document' },
  derived: { label: '推导', icon: 'source/derived' },
  library: { label: '引用', icon: 'source/from-library' },
  measurement: { label: '实测', icon: 'source/from-document' },
} as const;
export type SourceKind = keyof typeof sourceKinds;

export function SourceBadge({ kind, detail }: { kind: SourceKind; detail?: string }) {
  const source = sourceKinds[kind];
  return <Tooltip content={<span className="source-badge-detail">{displayText(detail || source.label)}</span>}><button type="button" className="source-badge" aria-label={`来源：${source.label}`}><Icon name={source.icon} /><span>{source.label}</span></button></Tooltip>;
}
