import { useDeferredValue, useState } from "react";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { indexObjects, type ObjectCard } from "@/api/object-index";
import { message } from "@/api/client";
import { CatalogShell } from "@/components/catalog-shell";
import { DataTable } from "@/components/data-table";
import { ObjectChip, ObjectLink, statusMark } from "@/components/object-link";
import { StatusMark } from "@/components/status-mark";
import { ErrorState, InlineEmpty, LoadingState } from "@/components/states";
import { Toolbar } from "@/components/toolbar";
import { Button } from "@/components/ui/button";
import { HpcJobList } from "@/features/field/hpc-job-list";

const PAGE = 50;
const short = (value?: string | null) => value ? new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

/**
 * 记录 › 运行与作业（FRONTEND_REQUIREMENTS §2.2）：跨对象的筛选视图，运行本身的家在所属研究或型号里。
 * 运行列表来自统一索引；超算作业沿用作业接口（取消、核对状态）。
 */
export function RunsPage() {
  const [q, setQ] = useState("");
  const query = useDeferredValue(q.trim());
  const runs = useInfiniteQuery({
    queryKey: ["index-objects", "run", query],
    queryFn: ({ signal, pageParam }) => indexObjects({ kind: "run", q: query, limit: PAGE, offset: pageParam }, signal),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => { const loaded = pages.reduce((sum, page) => sum + page.items.length, 0); return loaded < last.total ? loaded : undefined; },
    placeholderData: keepPreviousData,
  });
  const rows = (runs.data?.pages.flatMap((page) => page.items) || []) as (ObjectCard & { id: string })[];
  const total = runs.data?.pages[0]?.total;
  return (
    <CatalogShell title="运行与作业" status={<span className="muted">{total === undefined ? "读取中" : `${total} 次运行`} · 单次运行在所属研究或型号里查看</span>}>
      <section className="object-section" aria-label="运行">
        <header><h2>运行</h2></header>
        {(total || query) ? <Toolbar label="运行筛选">
          <label className="search-field">
            检索
            <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="研究、型号或方法" />
          </label>
        </Toolbar> : null}
        {runs.isPending ? <LoadingState title="正在读取运行" />
          : runs.error && !rows.length ? <ErrorState description={message(runs.error)} action={<Button onClick={() => void runs.refetch()}>重新读取</Button>} />
          : !rows.length ? <InlineEmpty title={query ? "没有匹配的运行" : "还没有运行。在研究或型号里预检并运行后会出现在这里。"} />
          : <>
            <DataTable<ObjectCard & { id: string }> label="运行" showGroups={false} groups={[{ id: "runs", label: "运行", rows }]} rowLabel={(row) => row.name}
              columns={[
                { id: "name", label: "运行", wrap: true, render: (row) => <ObjectLink card={row} /> },
                { id: "parent", label: "所属", wrap: true, render: (row) => row.parent ? <ObjectChip card={{ ...row.parent, status: { code: "", label: "" } }} status={false} /> : "—" },
                { id: "state", label: "状态", render: (row) => <StatusMark kind={statusMark(row.status.code)} label={row.status.label} detail={row.status.reason || undefined} /> },
                { id: "updated", label: "时间", render: (row) => short(row.updated) },
              ]} />
            {runs.error ? <ErrorState description={message(runs.error)} action={<Button onClick={() => void runs.fetchNextPage()}>重新读取</Button>} />
              : runs.hasNextPage ? <div className="list-more"><Button size="compact" disabled={runs.isFetchingNextPage} onClick={() => void runs.fetchNextPage()}>{runs.isFetchingNextPage ? "读取中" : `加载更多（已显示 ${rows.length} / ${total}）`}</Button></div> : null}
          </>}
      </section>
      <HpcJobList />
    </CatalogShell>
  );
}
