import { useQuery } from "@tanstack/react-query";
import { objectRelations, type ObjectKind, type Relation } from "@/api/object-index";
import { message } from "@/api/client";
import { ObjectChip } from "./object-link";
import { StatusMark } from "./status-mark";
import { ErrorState, InlineEmpty, LoadingState } from "./states";

const ROLES: Record<string, string> = {
  workspace: "所属工程", method: "方法", cable_version: "电缆型号版本", study: "研究", input_snapshot: "输入快照", delivery: "交付",
  source_run: "来源运行", specification: "规格书", source_design: "来源设计", published_cable_version: "发布版本",
  source_document: "厂家资料", source_proposal: "来源方案", dependency: "依赖", validation: "验证", agent_task: "Agent 任务",
};

function Rows({ rows }: { rows: Relation[] }) {
  return <ul className="relation-list">{rows.map((row, index) => <li key={row.role + row.target.kind + row.target.id + index}>
    <span className="relation-role">{ROLES[row.role] || row.role}</span>
    <ObjectChip card={row.target} status={false} />
    {row.freshness === "outdated" && <StatusMark kind="historical" label="已变化" detail={row.reason || undefined} />}
    {row.freshness === "unknown" && <StatusMark kind="unknown" label="未核实" detail={row.reason || undefined} />}
  </li>)}</ul>;
}

/**
 * 关联面板（FRONTEND_REQUIREMENTS §2.3）：“用到了 / 被用于”，每项是一张小名片；引用变了就标“已变化”并写原因。
 * 数据来自统一索引，不在页面里各自拼关系。
 */
export function RelationPanel({ kind, id }: { kind: ObjectKind; id: string }) {
  const relations = useQuery({ queryKey: ["object-relations", kind, id], queryFn: ({ signal }) => objectRelations(kind, id, signal), enabled: !!id });
  if (relations.isPending) return <LoadingState title="正在读取关联" description="" />;
  if (relations.error) return <ErrorState title="关联读取失败" description={message(relations.error)} />;
  const { uses, used_by: usedBy, unresolved } = relations.data;
  return <div className="relation-panel">
    <section aria-label="用到了"><h3>用到了</h3>{uses.length ? <Rows rows={uses} /> : <InlineEmpty title="没有引用其他对象" />}</section>
    <section aria-label="被用于"><h3>被用于</h3>{usedBy.length ? <Rows rows={usedBy} /> : <InlineEmpty title="还没有被引用" />}</section>
    {!!unresolved.length && <section aria-label="未建立的关联"><h3>未建立</h3><ul className="relation-list">{unresolved.map((row, index) => <li key={row.role + index}><span className="relation-role">{ROLES[row.role] || row.role}</span><span className="muted">{row.reason}</span></li>)}</ul></section>}
  </div>;
}
