import type { ReactNode } from 'react';
import type { InboxItem } from '@/api/object-index';
import type { InboxGroup as Group } from '@/lib/inbox-groups';
import { statusLabel } from '@/lib/status-vocabulary';
import { KIND_LABELS, ObjectChip, ObjectLink, statusMark } from './object-link';
import { StatusMark } from './status-mark';
import { Icon } from './icon';
import { formatObjectVersion } from '@/lib/format';

/** 共性原因只展示一次；展开后每个对象保留独立入口、所属、版本和状态。 */
export function InboxGroup({ group, action }: { group: Group; action?: (item: InboxItem) => ReactNode }) {
  return <details className="inbox-group" data-inbox-count={group.items.length}>
    <summary><span className="inbox-group-heading"><b>{group.title}</b><span className="muted">{group.reason || '原因未提供'}</span></span><span className="inbox-group-open">逐个查看<Icon name="action/chevron-down" /></span></summary>
    <ul>{group.items.map((item, index) => <li key={`${item.object.kind}:${item.object.id}:${index}`}>
      <span className="inbox-group-object"><ObjectLink card={item.object}>{item.title}</ObjectLink><span className="muted">{KIND_LABELS[item.object.kind]}{item.object.parent && <> · <ObjectChip card={{ ...item.object.parent, status: { code: '', label: '' } }} status={false} /></>}</span></span>
      {item.object.version && <span className="muted">{formatObjectVersion(item.object.version, item.object.subtype === 'rule')}</span>}
      {action?.(item) ?? <StatusMark kind={statusMark(item.object.status.code)} label={statusLabel(item.object.status.code, item.object.status.label)} detail={item.object.status.reason || undefined} />}
    </li>)}</ul>
  </details>;
}
