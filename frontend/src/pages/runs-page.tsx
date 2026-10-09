import { useQuery } from "@tanstack/react-query";
import { indexObjects, type ObjectCard } from "@/api/object-index";
import { message } from "@/api/client";
import { CatalogShell } from "@/components/catalog-shell";
import { DataTable } from "@/components/data-table";
import { ObjectChip, ObjectLink, statusMark } from "@/components/object-link";
import { StatusMark } from "@/components/status-mark";
import { ErrorState, InlineEmpty, LoadingState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { HpcJobList } from "@/features/field/hpc-job-list";

const short = (value?: string | null) => value ? new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

/**
 * 记录 › 运行与作业（FRONTEND_REQUIREMENTS §2.2）：跨对象的筛选视图，运行本身的家在所属研究或型号里。
 * 运行列表来自统一索引；超算作业沿用作业接口（取消、核对状态）。
 */
export function RunsPage() {
  const runs = useQuery({ queryKey: ["index-objects", "run"], queryFn: ({ signal }) => indexObjects({ kind: "run", limit: 100 }, signal) });
  const rows = (runs.data?.items || []) as (ObjectCard & { id: string })[];
  return (
    <CatalogShell title="运行与作业" status={<span className="muted">{runs.data ? `${runs.data.total} 次运行` : "读取中"} · 单次运行在所属研究或型号里查看</span>}>
      <section className="object-section" aria-label="运行">
        <header><h2>运行</h2></header>
        {runs.isPending ? <LoadingState title="正在读取运行" />
          : runs.error ? <ErrorState description={message(runs.error)} action={<Button onClick={() => void runs.refetch()}>重新读取</Button>} />
          : !rows.length ? <InlineEmpty title="还没有运行。在研究或型号里预检并运行后会出现在这里。" />
          : <DataTable<ObjectCard & { id: string }> label="运行" showGroups={false} groups={[{ id: "runs", label: "运行", rows }]} rowLabel={(row) => row.name}
            columns={[
              { id: "name", label: "运行", wrap: true, render: (row) => <ObjectLink card={row} /> },
              { id: "parent", label: "所属", wrap: true, render: (row) => row.parent ? <ObjectChip card={{ ...row.parent, status: { code: "", label: "" } }} status={false} /> : "—" },
              { id: "state", label: "状态", render: (row) => <StatusMark kind={statusMark(row.status.code)} label={row.status.label} detail={row.status.reason || undefined} /> },
              { id: "updated", label: "时间", render: (row) => short(row.updated) },
            ]} />}
      </section>
      <HpcJobList />
    </CatalogShell>
  );
}
