import type { ReactNode } from "react";
import { Link, useSearch } from "@tanstack/react-router";
import type { ObjectCard, ObjectKind } from "@/api/object-index";
import { Icon } from "./icon";
import { StatusMark, type StatusKind } from "./status-mark";

/** 每类东西的“家”（FRONTEND_REQUIREMENTS §2.2 / §2.3）：引用只放链接，点了回到这里。地址只在此处按 kind 换算。 */
const ICONS: Record<ObjectKind, string> = {
  project: "object/folder", study: "object/study", type: "nav/cable-type", cable_version: "resource/cable-type", asset: "resource/material",
  run: "run/run", input_snapshot: "result/snapshot", job: "run/run", delivery: "object/delivery", plugin: "nav/plugin",
  validation: "result/evidence", document: "source/from-document", proposal: "agent/proposal", agent_task: "agent/agent",
};
export const KIND_LABELS: Record<ObjectKind, string> = {
  project: "工程", study: "研究", type: "型号设计", cable_version: "电缆型号版本", asset: "资源", run: "运行", input_snapshot: "输入快照",
  job: "超算作业", delivery: "交付", plugin: "插件", validation: "验证算例", document: "厂家资料", proposal: "方案", agent_task: "Agent 任务",
};
const ASSET_GROUP: Record<string, "materials" | "templates" | "standards"> = {
  material: "materials", component: "materials", assembly: "materials", installation: "templates", study_template: "templates", rule: "standards",
};
/** 索引状态码 → 状态标记的样式；文字用索引给的 label，不另写一套。 */
const MARKS: Record<string, StatusKind> = {
  current: "current", outdated: "historical", not_run: "draft", running: "running", failed: "error", incomplete: "draft", draft: "draft",
  reviewed: "saved", published: "saved", submitted: "proposal", approved: "saved", pending: "proposal", installed: "saved", unknown: "unknown",
};
export const statusMark = (code: string): StatusKind => MARKS[code] || "draft";
/** 版本串里的内部后缀换成读得懂的写法，不露出“+engineering”“public-sample”这类内部标识。 */
export const versionLabel = (version: string) => version.replace(/^public-sample/, "公开样本").replace(/\+engineering$/, "（工程版）");

export function ObjectLink({ card, children, className = "object-link" }: { card: ObjectCard; children?: ReactNode; className?: string }) {
  const search = useSearch({ strict: false }) as { theme?: string };
  const theme = search.theme === "dark" ? "dark" as const : "light" as const;
  const body = children ?? card.name;
  const parent = card.parent;
  switch (card.kind) {
    case "project": return <Link className={className} to="/studies" search={{ theme, workspace: card.id }}>{body}</Link>;
    case "study": return <Link className={className} to="/studies/$sid" params={{ sid: card.id }} search={{ theme, workspace: parent?.kind === "project" ? parent.id : "", run: "", delivery: "" }}>{body}</Link>;
    case "run":
    case "input_snapshot": return parent?.kind === "study"
      ? <Link className={className} to="/studies/$sid" params={{ sid: parent.id }} search={{ theme, workspace: "", run: card.id, delivery: "" }}>{body}</Link>
      : <Link className={className} to="/runs" search={{ theme }}>{body}</Link>;
    case "type": return <Link className={className} to="/types/$wid/$module/$tab" params={{ wid: card.id, module: "structure", tab: "section" }} search={{ theme }}>{body}</Link>;
    case "cable_version": return <Link className={className} to="/resources/cables" search={{ theme, item: card.id }}>{body}</Link>;
    case "asset": return <Link className={className} to="/resources/$group" params={{ group: ASSET_GROUP[card.subtype || ""] || "materials" }} search={{ theme, item: card.id }}>{body}</Link>;
    case "job": return <Link className={className} to="/runs" search={{ theme }}>{body}</Link>;
    case "delivery": return <Link className={className} to="/deliveries" search={{ theme, workspace: "", delivery: card.id }}>{body}</Link>;
    case "plugin": return <Link className={className} to="/plugins/$pid" params={{ pid: card.id }} search={{ theme }}>{body}</Link>;
    case "validation": return parent?.kind === "plugin"
      ? <Link className={className} to="/plugins/$pid" params={{ pid: parent.id }} search={{ theme }}>{body}</Link>
      : <Link className={className} to="/validation" search={{ theme, snapshot: "" }}>{body}</Link>;
    case "document": return <Link className={className} to="/resources/cables/imports" search={{ theme, document: card.id }}>{body}</Link>;
    case "agent_task": return <Link className={className} to="/agent" search={{ theme, task: card.id }}>{body}</Link>;
    default: return <Link className={className} to="/inbox" search={{ theme }}>{body}</Link>;
  }
}

/** 小名片：图标、名称、版本、状态。列表、关联面板、待办都用它显示引用。 */
export function ObjectChip({ card, status = true }: { card: ObjectCard; status?: boolean }) {
  return <span className="object-chip" title={card.name}>
    <Icon name={ICONS[card.kind] || "object/file"} />
    <ObjectLink card={card}>{card.name}</ObjectLink>
    {card.version && <span className="muted">{versionLabel(card.version)}</span>}
    {status && <StatusMark kind={statusMark(card.status.code)} label={card.status.label} detail={card.status.reason || undefined} />}
  </span>;
}
