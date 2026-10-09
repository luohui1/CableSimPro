import { useQuery } from "@tanstack/react-query";
import { objectRelations, type ObjectKind, type Relation } from "@/api/object-index";
import { message } from "@/api/client";
import { KIND_LABELS, ObjectChip } from "./object-link";
import { StatusMark } from "./status-mark";
import { ErrorState, InlineEmpty, LoadingState } from "./states";
import { useInView } from "@/lib/use-deferred-start";

const ROLES: Record<string, string> = {
  workspace: "所属工程", method: "方法", cable_version: "型号版本", study: "研究", input_snapshot: "输入快照", delivery: "交付",
  source_run: "来源运行", specification: "规格书", source_design: "来源设计", published_cable_version: "发布版本",
  source_document: "厂家资料", source_proposal: "来源方案", dependency: "依赖", validation: "验证", agent_task: "Agent 任务",
  material: "材料", standard: "标准", source: "来源", source_specification: "来源规格书",
};
const SHOWN = 3;

/** 一条关联：角色、小名片；引用变了标“已变化”，当前引用的说明（如来源页码）直接写出。 */
function Row({ row, label }: { row: Relation; label: string }) {
  return <li className="relation-row">
    <span className="relation-role">{label}</span>
    <span className="relation-target">
      <ObjectChip card={row.target} status={false} />
      {row.freshness === "outdated" && <StatusMark kind="historical" label="已变化" detail={row.reason || undefined} />}
      {row.freshness === "unknown" && <StatusMark kind="unknown" label="未核实" detail={row.reason || undefined} />}
      {row.freshness === "current" && row.reason && <small className="relation-note">{row.reason}</small>}
    </span>
  </li>;
}

/** “被用于”按引用者类别合并：每类最近几条，其余只给数量，避免几十个运行把面板撑满。 */
function UsedBy({ rows }: { rows: Relation[] }) {
  const kinds = [...new Set(rows.map((row) => row.target.kind))];
  return <ul className="relation-list">{kinds.map((kind) => {
    const group = rows.filter((row) => row.target.kind === kind).sort((a, b) => (b.target.updated || "").localeCompare(a.target.updated || ""));
    const changed = group.filter((row) => row.freshness === "outdated").length;
    return <li key={kind} className="relation-group">
      <span className="relation-role">{KIND_LABELS[kind] || kind} {group.length}{changed ? ` · ${changed} 个已变化` : ""}</span>
      <ul className="relation-list">{group.slice(0, SHOWN).map((row, index) => <li key={row.target.id + index} className="relation-row is-plain"><span className="relation-target"><ObjectChip card={row.target} status={false} /></span></li>)}</ul>
      {group.length > SHOWN && <small className="relation-note">另有 {group.length - SHOWN} 个</small>}
    </li>;
  })}</ul>;
}

/**
 * 关联面板（FRONTEND_REQUIREMENTS §2.3）：“用到了 / 被用于”，每项是一张小名片；引用变了就标“已变化”并写原因。
 * 数据来自统一索引，不在页面里各自拼关系。
 */
export function RelationPanel({ kind, id }: { kind: ObjectKind; id: string }) {
  // 滚到可见时才读：关联是次要信息，不和首屏的主要数据抢宿主
  const [anchor, visible] = useInView<HTMLDivElement>();
  const relations = useQuery({ queryKey: ["object-relations", kind, id], queryFn: ({ signal }) => objectRelations(kind, id, signal), enabled: !!id && visible });
  if (!visible || relations.isPending) return <div ref={anchor}><LoadingState title="正在读取关联" description="" /></div>;
  if (relations.error) return <ErrorState title="关联读取失败" description={message(relations.error)} />;
  const { uses, used_by: usedBy, unresolved } = relations.data;
  return <div className="relation-panel">
    <section aria-label="用到了"><h3>用到了</h3>{uses.length ? <ul className="relation-list">{uses.map((row, index) => <Row key={row.role + row.target.id + index} row={row} label={ROLES[row.role] || row.role} />)}</ul> : <InlineEmpty title="没有引用其他对象" />}</section>
    <section aria-label="被用于"><h3>被用于</h3>{usedBy.length ? <UsedBy rows={usedBy} /> : <InlineEmpty title="还没有被引用" />}</section>
    {!!unresolved.length && <section aria-label="未建立的关联"><h3>未建立</h3><ul className="relation-list">{unresolved.map((row, index) => <li key={row.role + index} className="relation-row"><span className="relation-role">{ROLES[row.role] || row.role}</span><small className="relation-note">{row.reason}</small></li>)}</ul></section>}
  </div>;
}
