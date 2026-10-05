import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { deliveries, delivery, deliveryFile, deliveryPdf, deliveryPreview, type DeliverySummary, type ReportAudience } from "@/api/delivery";
import { workspaces } from "@/api/research";
import { message, text, ApiError, optionalRecord } from "@/api/client";
import { CatalogShell, usePageTheme } from "@/components/catalog-shell";
import { DataTable } from "@/components/data-table";
import { Toolbar } from "@/components/toolbar";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { LoadingState, ErrorState, EmptyState } from "@/components/states";
import { VersionNotice } from '@/components/version-notice';

export function DeliveriesPage() {
  const { search, theme, navigate } = usePageTheme();
  const [audience, setAudience] = useState<ReportAudience>("customer");
  const wid = text(search.workspace), did = text(search.delivery);
  const spaces = useQuery({ queryKey: ["delivery-workspaces"], queryFn: ({ signal }) => workspaces(signal) });
  const list = useQuery({ queryKey: ["deliveries", wid], queryFn: ({ signal }) => deliveries(wid, signal), enabled: !!wid });
  const selected = list.data?.find(item => item.id === did);
  function verify(book: Record<string, unknown>, row: DeliverySummary) {
    if (book.id !== row.id || book.workspace !== wid || book.digest !== row.digest ||
      !Array.isArray(book.sources) || book.sources.length !== row.sources.length ||
      !row.sources.every((source, index) => ["run_id", "input_digest", "output_digest"].every(key => optionalRecord(book.sources instanceof Array ? book.sources[index] : null)[key] === optionalRecord(source)[key])) || typeof book.html !== "string")
      throw new ApiError(409, "交付存档与所选版本不一致，请刷新列表后重试");
    return book;
  }
  const document = useQuery({ queryKey: ["archived-delivery", wid, did, selected?.digest],
    queryFn: async () => verify(await delivery(wid, did), selected!), enabled: !!selected });
  const preview = useMemo(() => document.data ? deliveryPreview(text(document.data.html)) : "", [document.data]);
  const download = useMutation({ retry: false, mutationFn: async ({row, format}: {row: DeliverySummary; format: "pdf" | "html"}) => {
    const book = verify(await delivery(wid, row.id), row);
    const blob = format === "pdf" ? deliveryPdf(book, audience) : await deliveryFile(wid, row.id, row.digest);
    const url = URL.createObjectURL(blob), link = window.document.createElement("a");
    link.href = url;
    link.download = `${row.kind === "specification" ? "规格书" : "计算书"}-第${row.version}版-${format === "html" ? "存档.html" : `${audience === "customer" ? "客户版" : "内部版"}.pdf`}`;
    link.click();setTimeout(() => URL.revokeObjectURL(url), 1000);
  } });
  return <CatalogShell title="交付历史" active="库" status={<span className="muted">已保存版本 · 下载不重新计算</span>}>
    <Toolbar label="交付历史筛选">
      <Select label="工程或型号" value={wid} onChange={workspace => { download.reset(); void navigate({ to: "/library/deliveries", search: { theme, workspace, delivery: "" } }); }}
        options={(spaces.data || []).map(item => ({ value: text(item.id), label: text(item.name) || text(item.title) || "未命名工程" }))} />
      <Button size="compact" disabled={!wid} onClick={() => { void list.refetch(); if (selected) void document.refetch(); }}>刷新</Button>
      <Select label="PDF 版本" value={audience} disabled={download.isPending} onChange={value => setAudience(value as ReportAudience)} options={[{value:"customer",label:"客户版"},{value:"internal",label:"内部审核版"}]} />
    </Toolbar>
    {spaces.error ? <ErrorState description={message(spaces.error)} action={<Button onClick={() => spaces.refetch()}>重新读取</Button>} />
      : !wid ? <EmptyState title="选择工程或型号查看交付历史" description="包含已保存的计算书与规格书；存档内容不会随当前输入变化。" />
      : list.isPending ? <LoadingState title="正在读取交付历史" />
      : list.error ? <ErrorState description={message(list.error)} action={<Button onClick={() => list.refetch()}>重新读取</Button>} />
      : !list.data?.length ? <EmptyState title="尚无交付存档" description="生成计算书或规格书后，可在这里查看和下载各版存档。" />
      : <DataTable<DeliverySummary> label="计算书与规格书历史" showGroups={false} selectedId={did}
        groups={[{id:"deliveries",label:"交付版本",rows:list.data}]} rowLabel={row => `${row.kind === "specification" ? "规格书" : "计算书"} · 第 ${row.version} 版`}
        onSelect={row => { download.reset(); void navigate({ to:"/library/deliveries", search:{theme,workspace:wid,delivery:row.id} }); }}
        columns={[
          {id:"kind",label:"文档",render:row=>row.kind === "specification" ? "规格书" : "计算书"},
          {id:"version",label:"版本",render:row=>`第 ${row.version} 版`},
          {id:"created",label:"生成时间",render:row=>new Date(row.created).toLocaleString("zh-CN")},
          {id:"sources",label:"来源",render:row=>`${row.sources.length} 个固定运行`},
          {id:"state",label:"结果状态",render:row=><VersionNotice value={row} target={{wid,runId:row.sources[0]?.run_id}} />},
          {id:"download",label:"操作",render:row=><div className="report-toolbar"><Button size="compact" loading={download.isPending && download.variables?.row.id===row.id} disabled={download.isPending} onClick={event=>{event.stopPropagation();download.mutate({row,format:"pdf"});}}>下载 PDF</Button><Button variant="ghost" size="compact" disabled={download.isPending} onClick={event=>{event.stopPropagation();download.mutate({row,format:"html"});}}>HTML 存档</Button></div>},
        ]} />}
    {!!download.error && <ErrorState description={message(download.error)} />}
    {did && !list.isPending && !list.error && !selected && <ErrorState description="所选交付版本不属于此工程或已不可用" />}
    {selected && (document.isPending ? <LoadingState title="正在读取保存的正文" /> : document.error ? <ErrorState description={message(document.error)} /> : document.data &&
      <section className="report-module" aria-label="交付存档预览"><p className="muted">第 {selected.version} 版存档，仅用于追溯；当前型号发布状态请在型号工作区核对。</p><VersionNotice value={document.data} target={{wid,runId:selected.sources[0]?.run_id}} /><iframe className="report-frame" title="交付存档预览" sandbox="" srcDoc={preview} /></section>)}
  </CatalogShell>;
}
