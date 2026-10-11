import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { indexInbox, type InboxItem } from "@/api/object-index";
import { message } from "@/api/client";
import { CatalogShell } from "@/components/catalog-shell";
import { InboxGroup } from '@/components/inbox-group';
import { groupInbox } from '@/lib/inbox-groups';
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
          {!shown.length ? <InlineEmpty title="这一类没有待办。" /> : CATEGORIES.map(category => {
            const groups = groupInbox(shown.filter(row => row.category === category.id));
            return groups.length ? <section className="inbox-category" key={category.id} aria-label={category.label}><h2>{category.label}</h2>{groups.map(group => <InboxGroup key={group.id} group={group} />)}</section> : null;
          })}
        </div>
      </>}
  </CatalogShell>;
}
