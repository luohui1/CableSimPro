import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { indexInbox, type InboxItem } from "@/api/object-index";
import { message } from "@/api/client";
import { CatalogShell } from "@/components/catalog-shell";
import { DataTable } from "@/components/data-table";
import { KIND_LABELS, ObjectLink } from "@/components/object-link";
import { StatusMark } from "@/components/status-mark";
import { ErrorState, InlineEmpty, LoadingState } from "@/components/states";
import { Toolbar } from "@/components/toolbar";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

const CATEGORIES = [
  { id: "review", label: "待审核", mark: "proposal" as const },
  { id: "stale", label: "过期待重算", mark: "historical" as const },
  { id: "missing", label: "资料缺项", mark: "draft" as const },
  { id: "running", label: "进行中", mark: "running" as const },
];
const ORIGINS: Record<InboxItem["origin"], string> = { agent: "Agent 方案", document: "厂家资料", asset: "资源", type: "型号设计", study: "研究", job: "超算作业" };
type Row = InboxItem & { id: string };

/**
 * 待办（FRONTEND_REQUIREMENTS §2.2 / §2.3）：四类审核、过期待重算、资料缺项、进行中的运行与作业汇成一个列表。
 * 数据来自统一索引；原来的位置保留入口，处理完下次读取即消失。
 */
export function InboxPage() {
  const [category, setCategory] = useState("all");
  const inbox = useQuery({ queryKey: ["index-inbox"], queryFn: ({ signal }) => indexInbox(signal), refetchInterval: 30_000 });
  const counts = inbox.data?.counts;
  const rows: Row[] = (inbox.data?.items || []).map((item, index) => ({ ...item, id: `${item.category}:${item.object.kind}:${item.object.id}:${index}` }));
  const shown = rows.filter((row) => category === "all" || row.category === category);
  const total = rows.length;
  return <CatalogShell title="待办" status={<span className="muted">{inbox.isPending ? "读取中" : `${total} 项`} · 处理后自动消失</span>}>
    {inbox.isPending ? <LoadingState title="正在汇总待办" />
      : inbox.error ? <ErrorState description={message(inbox.error)} action={<Button onClick={() => void inbox.refetch()}>重新读取</Button>} />
      : !total ? <InlineEmpty title="没有待办事项。" />
      : <>
        <Toolbar label="待办筛选">
          <Select label="类别" value={category} onChange={setCategory} options={[{ value: "all", label: `全部 ${total}` }, ...CATEGORIES.map((item) => ({ value: item.id, label: `${item.label} ${counts?.[item.id as keyof typeof counts] ?? 0}` }))]} />
        </Toolbar>
        <div data-page="inbox" data-state={shown.length ? "success" : "empty"}>
          {!shown.length ? <InlineEmpty title="这一类没有待办。" /> : <DataTable<Row>
            label="待办"
            rowLabel={(row) => row.title}
            groups={CATEGORIES.map((item) => ({ id: item.id, label: item.label, rows: shown.filter((row) => row.category === item.id) })).filter((group) => group.rows.length)}
            columns={[
              { id: "title", label: "事项", wrap: true, render: (row) => <ObjectLink card={row.object}>{row.title}</ObjectLink> },
              { id: "kind", label: "对象", render: (row) => KIND_LABELS[row.object.kind] || row.object.kind },
              { id: "state", label: "状态", render: (row) => <StatusMark kind={CATEGORIES.find((item) => item.id === row.category)?.mark || "draft"} label={row.object.status.label} /> },
              { id: "reason", label: "原因", wrap: true, render: (row) => row.reason || "—" },
              { id: "origin", label: "来源", render: (row) => ORIGINS[row.origin] || row.origin },
            ]}
          />}
        </div>
      </>}
  </CatalogShell>;
}
