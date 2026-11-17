import { useDeferredValue, useMemo, useState } from "react";
import { useInfiniteQuery, useQueries, useQuery } from "@tanstack/react-query";
import type { ObjectCard } from "@/api/object-index";
import { message, text } from "@/api/client";
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
import { studyRuns } from '@/api/research';
import { runOwnerCardsQuery, runRecordsQuery, runTypeIndexQuery } from '@/lib/catalog-queries';
import { runOwnerName, runPresentation, scopedRunOrdinals } from '@/lib/run-presentation';

const short = formatDateTime;

// Full integrity/currentness checks are CPU work on the real host. Avoid sending
// a burst of every history at once while retaining parallel reads and Query cache.
function summaryReader() {
  let active = 0;
  const waiting: (() => void)[] = [];
  const drain = () => { while (active < 4 && waiting.length) waiting.shift()!(); };
  return (workspace: string, study: string, signal: AbortSignal) => new Promise<Awaited<ReturnType<typeof studyRuns>>>((resolve, reject) => {
    waiting.push(() => {
      active++;
      Promise.resolve().then(() => {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        return studyRuns(workspace, study, signal, 'summary');
      }).then(resolve, reject).finally(() => { active--; drain(); });
    });
    drain();
  });
}

/**
 * 记录 › 运行与作业（FRONTEND_REQUIREMENTS §2.2）：跨对象的筛选视图，运行本身的家在所属研究或型号里。
 * 运行列表来自统一索引；超算作业沿用作业接口（取消、核对状态）。
 */
export function RunsPage() {
  const readSummary = useMemo(summaryReader, []);
  const [q, setQ] = useState("");
  const query = useDeferredValue(q.trim());
  const runs = useInfiniteQuery(runRecordsQuery(query));
  const rows = (runs.data?.pages.flatMap((page) => page.items) || []) as (ObjectCard & { id: string })[];
  const total = runs.data?.pages[0]?.total;
  // Ownership needs saved study cards, not every study's full input and latest result.
  // Keep the same card query as the sidebar; result summaries are still read from
  // their authoritative per-study endpoint before numbering or displaying headlines.
  const studies = useQuery({ ...runOwnerCardsQuery(),
    select: result => result.items.filter(card => !!card.parent).map(card => ({ id: card.id, name: card.name, workspace: card.parent!.id })) });
  const types = useQuery(runTypeIndexQuery());
  const typeIds = new Set((types.data || []).map(row => String(row.id)));
  const visibleParents = new Set(rows.filter(row => row.parent?.kind === 'study').map(row => row.parent!.id));
  const typeWorkspaces = new Set((studies.data || []).filter(study => visibleParents.has(study.id) && typeIds.has(study.workspace)).map(study => study.workspace));
  // When the unfiltered index already contains every run, its parents contain
  // every non-empty history. Empty sibling modules cannot change type numbering.
  // A partial/filtered page still reads all siblings to keep scoped numbering exact.
  const allRunsLoaded = !query && total !== undefined && rows.length >= total && !runs.hasNextPage;
  const parents = [...new Set([...visibleParents, ...(allRunsLoaded ? [] : (studies.data || []).filter(study => typeWorkspaces.has(study.workspace)).map(study => study.id))])];
  const summaries = useQueries({ queries: parents.map(sid => {
    const study = studies.data?.find(row => row.id === sid);
    return { queryKey: ['run-list-summary', study?.workspace, sid], queryFn: ({ signal }: { signal: AbortSignal }) => readSummary(study!.workspace, sid, signal), enabled: !!study, retry: false };
  }) });
  const history = summaries.flatMap(query => query.data || []);
  const ordinals = scopedRunOrdinals(history, typeIds);
  const readyOrdinal = (run: Record<string, unknown>) => !types.isPending && !types.isError && (!typeIds.has(String(run.workspace)) || parents.every((sid, index) => studies.data?.find(study => study.id === sid)?.workspace !== run.workspace || summaries[index].isSuccess));
  const saved = new Map(history.map(run => [String(run.id), runPresentation(run, readyOrdinal(run) ? ordinals.get(String(run.id)) : undefined)]));
  const readingSummaries = studies.isPending || types.isPending || summaries.some(query => query.isFetching);
  const owner = (row: ObjectCard) => {
    const study = studies.data?.find(study => study.id === row.parent?.id);
    const type = types.data?.find(type => type.id === study?.workspace);
    return type && row.parent ? { ...row.parent, name: runOwnerName(text(type.name), row.parent.name) } : row.parent;
  };
  const pendingSummary = (row: ObjectCard) => {
    if (row.parent?.kind !== 'study') return '此类运行未提供摘要';
    const query = summaries[parents.indexOf(row.parent.id)];
    return studies.isError || query?.isError ? '摘要读取失败' : studies.data && !studies.data.some(study => study.id === row.parent?.id) ? '所属研究未找到' : '摘要读取中';
  };
  return (
    <CatalogShell title="运行与作业" status={<span className="muted">{total === undefined ? "读取中" : `${total} 次运行`} · 单次运行在所属研究或型号里查看</span>}>
      <section className="object-section run-record-list" aria-label="运行">
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
                { id: "name", label: "运行", wrap: true, render: (row) => {
                  const name = saved.get(row.id)?.name || (row.parent?.kind === 'study' ? '保存运行' : row.name);
                  const [number, ...task] = name.split(' · ');
                  return <ObjectLink card={row}><span className="run-name-part">{number}</span>{task.length > 0 && <> · <span className="run-name-part">{task.join(' · ')}</span></>}</ObjectLink>;
                } },
                { id: "parent", label: "所属", wrap: true, render: (row) => owner(row) ? <ObjectChip card={{ ...owner(row)!, status: { code: "", label: "" } }} status={false} /> : "—" },
                { id: "state", label: "状态", render: (row) => <StatusMark kind={statusMark(row.status.code)} label={statusLabel(row.status.code, row.status.label)} detail={row.status.reason || undefined} /> },
                { id: 'method', label: '方法', wrap: true, render: row => saved.get(row.id)?.method || '—' },
                { id: 'conclusion', label: '结论摘要', wrap: true, render: row => saved.get(row.id)?.conclusion ? <span title={saved.get(row.id)?.conclusion}>{saved.get(row.id)?.conclusion}</span> : saved.has(row.id) || row.parent?.kind !== 'study' ? <ObjectLink card={row}>查看结果</ObjectLink> : <span>{pendingSummary(row) === '摘要读取中' ? '—' : pendingSummary(row)}</span> },
                { id: "updated", label: "时间", render: (row) => short(row.updated) },
              ]} />
            {(studies.isError || types.isError || summaries.some(query => query.isError)) && <Button size="compact" onClick={() => { void studies.refetch(); if (types.isError) void types.refetch(); for (const query of summaries) if (query.isError) void query.refetch(); }}>重新读取摘要</Button>}
            {runs.error ? <ErrorState description={message(runs.error)} action={<Button onClick={() => void runs.fetchNextPage()}>重新读取</Button>} />
              : runs.hasNextPage ? <div className="list-more"><Button size="compact" disabled={runs.isFetchingNextPage} onClick={() => void runs.fetchNextPage()}>{runs.isFetchingNextPage ? "读取中" : `加载更多（已显示 ${rows.length} / ${total}）`}</Button></div> : null}
          </>}
      </section>
      <HpcJobList />
    </CatalogShell>
  );
}
