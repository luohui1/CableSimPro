import { useDeferredValue, useState } from "react";
import { keepPreviousData, useInfiniteQuery, useQueries, useQuery } from "@tanstack/react-query";
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
import { formatDateTime } from '@/lib/format';
import { statusLabel } from '@/lib/status-vocabulary';
import { studyIndex, studyRuns } from '@/api/research';
import { indexedRunName, runPresentation } from '@/lib/run-presentation';

const PAGE = 50;
const short = formatDateTime;

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
  const studies = useQuery({ queryKey: ['study-index'], queryFn: ({ signal }) => studyIndex(signal) });
  const parents = [...new Set(rows.filter(row => row.parent?.kind === 'study').map(row => row.parent!.id))];
  const summaries = useQueries({ queries: parents.map(sid => {
    const study = studies.data?.find(row => row.id === sid);
    return { queryKey: ['run-list-summary', study?.workspace, sid], queryFn: ({ signal }: { signal: AbortSignal }) => studyRuns(study!.workspace, sid, signal, 'summary'), enabled: !!study, retry: false };
  }) });
  const saved = new Map(summaries.flatMap(query => query.data || []).map(run => [String(run.id), runPresentation(run)]));
  const readingSummaries = studies.isPending || summaries.some(query => query.isFetching);
  const pendingSummary = (row: ObjectCard) => {
    if (row.parent?.kind !== 'study') return '此类运行未提供摘要';
    const query = summaries[parents.indexOf(row.parent.id)];
    return studies.isError || query?.isError ? '摘要读取失败' : studies.data && !studies.data.some(study => study.id === row.parent?.id) ? '所属研究未找到' : '摘要读取中';
  };
  return (
    <CatalogShell title="运行与作业" status={<span className="muted">{total === undefined ? "读取中" : `${total} 次运行`} · 单次运行在所属研究或型号里查看</span>}>
      <section className="object-section" aria-label="运行">
        <header><h2>运行</h2></header>
        {!!rows.length && readingSummaries && <span className="muted" role="status">正在读取方法与结论</span>}
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
                { id: "name", label: "运行", wrap: true, render: (row) => <ObjectLink card={row}>{saved.get(row.id)?.name || (row.parent?.kind === 'study' ? indexedRunName(row.name) : row.name)}</ObjectLink> },
                { id: "parent", label: "所属", wrap: true, render: (row) => row.parent ? <ObjectChip card={{ ...row.parent, status: { code: "", label: "" } }} status={false} /> : "—" },
                { id: "state", label: "状态", render: (row) => <StatusMark kind={statusMark(row.status.code)} label={statusLabel(row.status.code, row.status.label)} detail={row.status.reason || undefined} /> },
                { id: 'method', label: '方法', wrap: true, render: row => saved.get(row.id)?.method || '—' },
                { id: 'conclusion', label: '结论摘要', wrap: true, render: row => <span title={saved.get(row.id)?.conclusion}>{saved.get(row.id)?.conclusion || (pendingSummary(row) === '摘要读取中' ? '—' : pendingSummary(row))}</span> },
                { id: "updated", label: "时间", render: (row) => short(row.updated) },
              ]} />
            {(studies.isError || summaries.some(query => query.isError)) && <Button size="compact" onClick={() => { void studies.refetch(); for (const query of summaries) if (query.isError) void query.refetch(); }}>重新读取摘要</Button>}
            {runs.error ? <ErrorState description={message(runs.error)} action={<Button onClick={() => void runs.fetchNextPage()}>重新读取</Button>} />
              : runs.hasNextPage ? <div className="list-more"><Button size="compact" disabled={runs.isFetchingNextPage} onClick={() => void runs.fetchNextPage()}>{runs.isFetchingNextPage ? "读取中" : `加载更多（已显示 ${rows.length} / ${total}）`}</Button></div> : null}
          </>}
      </section>
      <HpcJobList />
    </CatalogShell>
  );
}
