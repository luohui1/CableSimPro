import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { deliveries, delivery, deliveryFile, deliveryPdf, deliveryPreview, type DeliverySummary, type ReportAudience } from "@/api/delivery";
import { workspaces, typeIndex } from "@/api/research";
import { message, text, ApiError, optionalRecord } from "@/api/client";
import { CatalogShell, usePageTheme } from "@/components/catalog-shell";
import { DataTable } from "@/components/data-table";
import { Toolbar } from "@/components/toolbar";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { LoadingState, ErrorState, EmptyState } from "@/components/states";
import { VersionNotice } from '@/components/version-notice';
import { PropertyPanel } from "@/components/property-panel";
import { RelationPanel } from "@/components/relation-panel";
import { formatDateTime } from '@/lib/format';

type Row = DeliverySummary & { wid: string; owner: string };

/**
 * 记录 › 交付（FRONTEND_REQUIREMENTS §2.2）：全部工程与型号的计算书、规格书，默认全部列出，可按所属对象筛选。
 * 交付的家在产生它的研究或型号里；这里是跨对象的视图，下载使用存档，不重新计算。
 */
export function DeliveriesPage() {
  const { search, theme, navigate } = usePageTheme();
  const [audience, setAudience] = useState<ReportAudience>("customer");
  const [previewId, setPreviewId] = useState('');
  const filter = text(search.workspace), did = text(search.delivery);
  const spaces = useQuery({ queryKey: ["workspace-index"], queryFn: ({ signal }) => workspaces(signal) });
  const owners = (spaces.data || []).map(item => ({ wid: text(item.id), name: text(item.name) || text(item.title) || "未命名工程" }));
  const lists = useQueries({ queries: owners.filter(owner => !filter || owner.wid === filter).map(owner => ({
    queryKey: ["deliveries", owner.wid],
    queryFn: ({ signal }: { signal: AbortSignal }) => deliveries(owner.wid, signal),
    select: (items: DeliverySummary[]): Row[] => items.map(item => ({ ...item, wid: owner.wid, owner: owner.name })),
  })) });
  const pending = spaces.isPending || lists.some(list => list.isPending);
  const failure = spaces.error || lists.find(list => list.error)?.error;
  const rows = lists.flatMap(list => list.data || []).sort((a, b) => b.created.localeCompare(a.created));
  const filteredOwner = owners.find(owner => owner.wid === filter);
  // An empty filtered list needs the real owner kind before offering a next
  // step. A pending or failed type index must not turn a model into a project.
  const ownerTypes = useQuery({ queryKey: ["type-index"], queryFn: ({ signal }) => typeIndex(signal),
    enabled: !!filteredOwner && !pending && !failure && !rows.length });
  const selected = rows.find(item => item.id === did);
  function verify(book: Record<string, unknown>, row: Row, full = false) {
    if (book.id !== row.id || book.workspace !== row.wid || book.digest !== row.digest ||
      !Array.isArray(book.sources) || book.sources.length !== row.sources.length ||
      !row.sources.every((source, index) => ["run_id", "input_digest", "output_digest"].every(key => optionalRecord(book.sources instanceof Array ? book.sources[index] : null)[key] === optionalRecord(source)[key])) || full && typeof book.html !== "string")
      throw new ApiError(409, "交付存档与所选版本不一致，请刷新列表后重试");
    return book;
  }
  const receipt = useQuery({ queryKey: ["archived-delivery", selected?.wid, did, selected?.digest, 'summary'],
    queryFn: async ({ signal }) => verify(await delivery(selected!.wid, did, 'summary', signal), selected!), enabled: !!selected });
  const previewRequested = !!selected && previewId === selected.id;
  const document = useQuery({ queryKey: ["archived-delivery", selected?.wid, did, selected?.digest, 'full'],
    queryFn: async ({ signal }) => verify(await delivery(selected!.wid, did, 'full', signal), selected!, true), enabled: previewRequested && !!receipt.data });
  const preview = useMemo(() => document.data ? deliveryPreview(text(document.data.html)) : "", [document.data]);
  const download = useMutation({ retry: false, mutationFn: async ({row, format}: {row: Row; format: "pdf" | "html"}) => {
    const book = verify(await delivery(row.wid, row.id, 'full'), row, true);
    const blob = format === "pdf" ? deliveryPdf(book, audience) : await deliveryFile(row.wid, row.id, row.digest);
    const url = URL.createObjectURL(blob), link = window.document.createElement("a");
    link.href = url;
    link.download = `${row.kind === "specification" ? "规格书" : "计算书"}-第${row.version}版-${format === "html" ? "存档.html" : `${audience === "customer" ? "客户版" : "内部版"}.pdf`}`;
    link.click();setTimeout(() => URL.revokeObjectURL(url), 1000);
  } });
  const label = (row: Row) => `${row.owner} · ${row.kind === "specification" ? "规格书" : "计算书"} · 第 ${row.version} 版`;
  const go = (workspace: string, next: string) => { download.reset(); setPreviewId(''); void navigate({ to: "/deliveries", search: { theme, workspace, delivery: next } }); };
  function emptyList() {
    if (!filter) return <EmptyState title="还没有交付" description="在研究里生成计算书，或在型号里生成规格书。保存的文档会出现在这里。"
      action={<div className="report-toolbar"><Button variant="primary" onClick={() => void navigate({ to: "/studies", search: { theme } })}>选择研究</Button>
        <Button variant="outline" onClick={() => void navigate({ to: "/types", search: { theme } })}>选择型号</Button></div>} />;
    if (!filteredOwner) return <EmptyState title="筛选对象已不可用" description="当前目录中没有这个工程或型号。清除筛选后可重新选择。"
      action={<Button variant="primary" onClick={() => go('', '')}>清除筛选</Button>} />;
    if (ownerTypes.isPending || ownerTypes.isFetching) return <LoadingState title="正在确认交付所属对象" />;
    if (ownerTypes.error) return <ErrorState title="无法确认交付所属对象" description={message(ownerTypes.error)}
      action={<div className="report-toolbar"><Button variant="primary" onClick={() => void ownerTypes.refetch()}>重新确认</Button>
        <Button variant="outline" onClick={() => go('', '')}>清除筛选</Button></div>} />;
    const model = ownerTypes.data?.some(item => text(item.id) === filter);
    return <EmptyState title={model ? "这个型号还没有交付" : "这个工程还没有交付"}
      description={model ? `打开“${filteredOwner.name}”的规格书，核对并保存文档后会出现在这里。` : `打开“${filteredOwner.name}”中的研究，生成并保存计算书后会出现在这里。`}
      action={<Button variant="primary" onClick={() => void navigate(model
        ? { to: `/types/${filter}/specification/content`, search: { theme } }
        : { to: "/studies", search: { theme, workspace: filter } })}>{model ? '打开型号规格书' : '打开工程研究'}</Button>} />;
  }
  return <CatalogShell title="交付" status={<span className="muted">{pending ? "读取中" : `${rows.length} 份`} · 下载存档，不重新计算</span>}
    property={selected ? <PropertyPanel collapsed={false} title={label(selected)} onToggle={() => go(filter, "")}
      groups={[{ label: "名片", items: [
        { label: "所属", value: selected.owner },
        { label: "生成时间", value: formatDateTime(selected.created) },
        { label: "来源", value: `${selected.sources.length} 个固定运行` },
        { label: "存档摘要", value: selected.digest.slice(0, 12) },
      ] }]}
      extra={<section aria-label="关联"><h3>关联</h3><RelationPanel kind="delivery" id={selected.id} /></section>} /> : undefined}>
    <Toolbar label="交付筛选">
      <Select label="所属" value={filter || "all"} onChange={value => go(value === "all" ? "" : value, "")}
        options={[{ value: "all", label: "全部工程与型号" }, ...owners.map(owner => ({ value: owner.wid, label: owner.name }))]} />
      {/* 没有交付时不显示下载版本选择 */}
      {!!rows.length && <Select label="PDF 版本" value={audience} disabled={download.isPending} onChange={value => setAudience(value as ReportAudience)} options={[{value:"customer",label:"客户版"},{value:"internal",label:"内部审核版"}]} />}
      {selected && <Button variant="secondary" size="compact" disabled={!receipt.data || receipt.isError} loading={previewRequested && document.isPending} onClick={() => setPreviewId(previewRequested ? '' : selected.id)}>{previewRequested ? '收起预览' : '预览存档'}</Button>}
    </Toolbar>
    {pending ? <LoadingState title="正在读取交付" />
      : failure ? <ErrorState description={message(failure)} action={<Button onClick={() => { void spaces.refetch(); lists.forEach(list => void list.refetch()); }}>重新读取</Button>} />
      : !rows.length ? emptyList()
      : <DataTable<Row> label="计算书与规格书" showGroups={false} selectedId={did}
        groups={[{id:"deliveries",label:"交付版本",rows}]} rowLabel={label}
        onSelect={row => go(filter, row.id)}
        columns={[
          {id:"owner",label:"所属",wrap:true,render:row=>row.owner},
          {id:"kind",label:"文档",render:row=>row.kind === "specification" ? "规格书" : "计算书"},
          {id:"version",label:"版本",render:row=>`第 ${row.version} 版`},
          {id:"created",label:"生成时间",render:row=>formatDateTime(row.created)},
          {id:"sources",label:"来源",numeric:true,render:row=>`${row.sources.length} 个固定运行`},
          {id:"state",label:"结果状态",render:row=><VersionNotice value={row} target={{wid:row.wid,runId:row.sources[0]?.run_id}} />},
          {id:"download",label:"操作",render:row=><div className="report-toolbar"><Button size="compact" loading={download.isPending && download.variables?.row.id===row.id} disabled={download.isPending} onClick={event=>{event.stopPropagation();download.mutate({row,format:"pdf"});}}>下载 PDF</Button><Button variant="ghost" size="compact" disabled={download.isPending} onClick={event=>{event.stopPropagation();download.mutate({row,format:"html"});}}>HTML 存档</Button></div>},
        ]} />}
    {!!download.error && <ErrorState description={message(download.error)} />}
    {did && !pending && !failure && !selected && <ErrorState description="所选交付版本已不可用，或不属于当前筛选" />}
    {selected && (receipt.isPending ? <LoadingState title="正在核对交付版本" /> : receipt.error ? <ErrorState description={message(receipt.error)} action={<Button onClick={() => void receipt.refetch()}>重新读取</Button>} /> : !previewRequested ? null : document.isPending ? <LoadingState title="正在读取保存的正文" /> : document.error ? <ErrorState description={message(document.error)} action={<Button onClick={() => void document.refetch()}>重新读取</Button>} /> : document.data &&
      <section className="report-module" aria-label="交付存档预览"><VersionNotice value={document.data} target={{wid:selected.wid,runId:selected.sources[0]?.run_id}} /><iframe className="report-frame" title="交付存档预览" sandbox="" srcDoc={preview} /></section>)}
  </CatalogShell>;
}
