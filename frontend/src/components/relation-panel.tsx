import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { objectRelations, type ObjectKind, type Relation } from "@/api/object-index";
import { message } from "@/api/client";
import { KIND_LABELS, ObjectChip } from "./object-link";
import { StatusMark } from "./status-mark";
import { ErrorState, InlineEmpty, LoadingState } from "./states";
import { useInView } from "@/lib/use-deferred-start";
import { Icon } from './icon';
import { Button } from './ui/button';

const ROLES: Record<string, string> = {
  workspace: "所属工程", method: "方法", cable_version: "型号版本", study: "研究", input_snapshot: "输入快照", delivery: "交付",
  source_run: "来源运行", specification: "规格书", source_design: "来源设计", published_cable_version: "发布版本",
  source_document: "厂家资料", source_proposal: "来源方案", dependency: "依赖", validation: "验证", agent_task: "Agent 任务",
  material: "材料", standard: "标准", source: "来源", source_specification: "来源规格书",
};
const SHOWN = 3;

/** 一条关联只占一行：小名片；正常时的说明放在悬停提示里，只有引用变了或无法核实才在行上标出。 */
function Row({ row }: { row: Relation }) {
  return <li className="relation-row is-plain">
    <span className="relation-target" title={row.reason || undefined}>
      <ObjectChip card={row.target} status={false} standard={row.role === 'standard' ? true : undefined} />
      {row.freshness === "outdated" && <StatusMark kind="historical" label="已变化" detail={row.reason || undefined} />}
      {row.freshness === "unknown" && <StatusMark kind="unknown" label="未核实" detail={row.reason || undefined} />}
    </span>
  </li>;
}

/** “用到了”按角色分组（来源、材料、标准……），每组先列几条，其余展开看。 */
function Uses({ rows }: { rows: Relation[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const roles = [...new Set(rows.map((row) => row.role))];
  return <ul className="relation-list">{roles.map((role) => {
    const group = rows.filter((row) => row.role === role);
    const changed = group.filter((row) => row.freshness !== "current").length;
    const all = open.has(role);
    return <li key={role} className="relation-group">
      <span className="relation-role">{ROLES[role] || role} {group.length}{changed ? ` · ${changed} 个需注意` : ""}</span>
      <ul className="relation-list">{(all ? group : group.slice(0, SHOWN)).map((row, index) => <Row key={row.target.id + index} row={row} />)}</ul>
      {group.length > SHOWN && <button type="button" className="relation-more" aria-expanded={all}
        onClick={() => setOpen((current) => { const next = new Set(current); if (all) next.delete(role); else next.add(role); return next; })}>
        {all ? "收起" : `另有 ${group.length - SHOWN} 个，展开`}</button>}
    </li>;
  })}</ul>;
}

/** “被用于”按引用者类别合并：每类先列最近几条，“另有 N 个”可以展开看全部。 */
function UsedBy({ rows }: { rows: Relation[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const kinds = [...new Set(rows.map((row) => row.target.kind))];
  return <ul className="relation-list">{kinds.map((kind) => {
    const group = rows.filter((row) => row.target.kind === kind).sort((a, b) => (b.target.updated || "").localeCompare(a.target.updated || ""));
    const changed = group.filter((row) => row.freshness === "outdated").length;
    const all = open.has(kind);
    return <li key={kind} className="relation-group">
      <span className="relation-role">{KIND_LABELS[kind] || kind} {group.length}{changed ? ` · ${changed} 个已变化` : ""}</span>
      <ul className="relation-list">{(all ? group : group.slice(0, SHOWN)).map((row, index) => <li key={row.target.id + index} className="relation-row is-plain"><span className="relation-target"><ObjectChip card={row.target} status={false} /></span></li>)}</ul>
      {group.length > SHOWN && <button type="button" className="relation-more" aria-expanded={all}
        onClick={() => setOpen((current) => { const next = new Set(current); if (all) next.delete(kind); else next.add(kind); return next; })}>
        {all ? "收起" : `另有 ${group.length - SHOWN} 个，展开`}</button>}
    </li>;
  })}</ul>;
}

/**
 * 关联面板（FRONTEND_REQUIREMENTS §2.3）：“用到了 / 被用于”，每项是一张小名片；引用变了就标“已变化”并写原因。
 * 数据来自统一索引，不在页面里各自拼关系。
 */
export function RelationPanel({ kind, id, hideRoles = [] }: { kind: ObjectKind; id: string; hideRoles?: string[] }) {
  // 滚到可见时才读：关联是次要信息，不和首屏的主要数据抢宿主
  const [anchor, visible] = useInView<HTMLDivElement>();
  const relations = useQuery({ queryKey: ["object-relations", kind, id], queryFn: ({ signal }) => objectRelations(kind, id, signal), enabled: !!id && visible });
  if (!visible || relations.isPending) return <div ref={anchor}><LoadingState title="正在读取关联" description="" /></div>;
  if (relations.error) return <ErrorState title="关联读取失败" description={message(relations.error)} action={<Button onClick={() => void relations.refetch()}>重新读取</Button>} />;
  // 已在别处成表的关联（例如插件的验证算例在“验证”页签）不在这里重复
  const uses = relations.data.uses.filter((row) => !hideRoles.includes(row.role));
  const unresolved = relations.data.unresolved.filter((row) => !hideRoles.includes(row.role));
  const usedBy = relations.data.used_by;
  return <details key={`${kind}:${id}`} className="relation-panel">
    <summary className="relation-summary">用到了 {uses.length} · 被用于 {usedBy.length}{unresolved.length ? ` · 未建立 ${unresolved.length}` : ''}<Icon name="action/chevron-down" /></summary>
    <div className="relation-body">
    <section aria-label="用到了"><h3>用到了</h3>{uses.length ? <Uses rows={uses} /> : <InlineEmpty title="没有引用其他对象" />}</section>
    <section aria-label="被用于"><h3>被用于</h3>{usedBy.length ? <UsedBy rows={usedBy} /> : <InlineEmpty title="还没有被引用" />}</section>
    {!!unresolved.length && <section aria-label="未建立的关联"><h3>未建立</h3><ul className="relation-list">{unresolved.map((row, index) => <li key={row.role + index} className="relation-row"><span className="relation-role">{ROLES[row.role] || row.role}</span><small className="relation-note">{row.reason}</small></li>)}</ul></section>}
    </div>
  </details>;
}
