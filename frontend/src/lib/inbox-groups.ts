import type { InboxItem } from '../api/object-index';

export const INBOX_ORIGINS: Record<InboxItem['origin'], string> = { agent: 'Agent 方案', document: '厂家资料', asset: '资源', type: '型号设计', study: '研究', job: '超算作业' };
export type InboxGroup = { id: string; title: string; reason: string; origin: string; category: InboxItem['category']; items: InboxItem[] };
/** 只合并同类别、同来源标记、同完整原因的事项；原始对象和原因仍保留。 */
export function groupInbox(items: InboxItem[]): InboxGroup[] {
  const groups = new Map<string, InboxGroup>();
  for (const item of items) {
    const source = item.object.source;
    const id = JSON.stringify([item.category, item.origin, source?.kind || '', source?.label || '', item.reason.trim(), item.reason.trim() ? '' : `${item.object.kind}:${item.object.id}`]);
    const group = groups.get(id);
    if (group) group.items.push(item);
    else groups.set(id, { id, title: item.title, reason: item.reason, origin: INBOX_ORIGINS[item.origin], category: item.category, items: [item] });
  }
  return [...groups.values()].map(group => {
    const count = group.items.length;
    if (count > 1) group.title = group.category === 'stale'
      ? `${/方法/.test(group.reason) ? '方法更新 · ' : ''}${count} 项结果需重算`
      : `${group.origin} · ${count} 项${{ review: '待审核', missing: '资料缺项', running: '进行中' }[group.category]}`;
    return group;
  });
}
