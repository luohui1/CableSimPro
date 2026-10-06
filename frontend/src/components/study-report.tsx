import { useMutation, useQuery } from "@tanstack/react-query";
import { useRef, useEffect, useState, useMemo } from "react";
import { createCurrentDelivery, delivery, deliveryFile, deliveryPdf, deliveryPreview, type ReportAudience } from "@/api/delivery";
import { Select } from "./ui/select";
import {
  api,
  array,
  record,
  text,
  responseData,
  message,
  ApiError,
} from "@/api/client";
import { Button } from "./ui/button";
import { EmptyState, ErrorState, LoadingState, StaleBanner } from "./states";
import { StatusMark } from "./status-mark";
import { Link, useSearch } from "@tanstack/react-router";
import type { ComponentProps } from "react";
import { downloadBlob } from "@/lib/download";
import { isVersionStale } from '@/lib/version-status';

export function StudyReport(props: ComponentProps<typeof CurrentReport>) {
  const search = useSearch({ strict: false });
  return <><div className="report-toolbar"><Link to="/library/deliveries" search={{ workspace: props.wid, delivery: props.did, theme: search.theme === "dark" ? "dark" : "light" }}>交付历史 · 计算书与规格书</Link></div><CurrentReport {...props} /></>;
}
function CurrentReport({
  wid,
  sid,
  run,
  did,
  tab,
  dirty,
  onDelivery,
  autoGenerate = false,
  onGenerateConsumed,
}: {
  wid: string;
  sid: string;
  run?: Record<string, unknown>;
  did: string;
  tab: string;
  dirty: boolean;
  onDelivery: (id: string) => void;
  autoGenerate?: boolean;
  onGenerateConsumed?: () => void;
}) {
  const [audience, setAudience] = useState<ReportAudience>("customer");
  const current =
    !!run &&
    run.freshness === "current" &&
    run.integrity === "verified" &&
    !isVersionStale(run) &&
    !dirty;
  const document = useQuery({
    queryKey: ["delivery", wid, did],
    queryFn: () => delivery(wid, did),
    enabled: !!did && !!run,
  });
  const request = useRef({ run: "", id: "" });
  const preview = useMemo(() => document.data ? deliveryPreview(text(document.data.html)) : "", [document.data]);
  async function fresh() {
    if (!run || dirty)
      throw new ApiError(409, "未保存修改或缺少源运行，不能交付");
    const saved = record(
      await responseData(
        api.GET("/api/workspaces/{wid}/studies/{sid}/runs/{rid}", {
          params: { path: { wid, sid, rid: text(run.id) } },
        }),
      ),
      "源运行",
    );
    if (saved.freshness !== "current" || saved.integrity !== "verified" || isVersionStale(saved))
      throw new ApiError(
        409,
        "源运行已经变为历史或完整性失败，请重新选择当前运行",
      );
    return saved;
  }
  const create = useMutation({
    retry: false,
    mutationFn: async () => {
      const source = await fresh();
      const rid = text(source.id);
      if (request.current.run !== rid)
        request.current = { run: rid, id: crypto.randomUUID() };
      const book = await createCurrentDelivery(wid, rid, request.current.id);
      verify(book, source);
      return book;
    },
    onSuccess: (value) => {
      onDelivery(text(value.id));
      downloadBlob(deliveryPdf(value, "customer"), "客户计算书.pdf");
    },
  });
  const download = useMutation({
    retry: false,
    mutationFn: async ({format, audience}: {format: "pdf" | "html"; audience: ReportAudience}) => {
      const source = await fresh();
      const book = await delivery(wid, did);
      verify(book, source);
      return format === "pdf" ? deliveryPdf(book, audience) : deliveryFile(wid, did, text(book.digest));
    },
    onSuccess: (blob, {format, audience}) => {
      downloadBlob(blob, format === "html" ? "计算书存档.html" : `${audience === "customer" ? "客户" : "内部"}计算书.pdf`);
    },
  });
  const generated = useRef(false);
  useEffect(() => {
    if (autoGenerate && current && !did && !generated.current) {
      generated.current = true;
      create.mutate();
      onGenerateConsumed?.();
    }
  }, [autoGenerate, current, did]);
  function verify(
    book: Record<string, unknown>,
    source: Record<string, unknown>,
  ) {
    const sources = array(book.sources, "计算书来源").map((value) =>
      record(value, "源运行"),
    );
    if (
      sources.length !== 1 ||
      sources[0].run_id !== source.id ||
      sources[0].input_digest !== source.input_digest ||
      sources[0].output_digest !== source.output_digest
    )
      throw new ApiError(409, "计算书与所选运行不一致，拒绝预览和导出");
    if (typeof book.html !== "string")
      throw new ApiError(502, "计算书没有正文");
  }
  if (!run)
    return (
      <EmptyState
        art="report"
        title="尚无可交付运行"
        description="计算书只从一次成功的运行生成。先在计算模块运行，再回到这里生成。"
      />
    );
  if (!current)
    return (
      <StaleBanner
        description={
          dirty
            ? "请先保存研究；计算书不能纳入未保存输入。"
            : "所选运行是历史或完整性未通过，不能生成当前计算书。"
        }
      />
    );
  const error = create.error || download.error || document.error;
  let boundError: Error | undefined;
  if (document.data)
    try {
      verify(document.data, run);
    } catch (problem) {
      boundError = problem as Error;
    }
  return (
    <div className="report-module">
      <div className="report-toolbar">
        <StatusMark kind="current" label="仅当前运行" />
        <div className="spacer" />
        {did ? (
          <>
          <Select label="PDF 版本" value={audience} disabled={download.isPending} onChange={value => setAudience(value as ReportAudience)} options={[{value:"customer",label:"客户版"},{value:"internal",label:"内部审核版"}]} />
          <Button
            variant="primary"
            size="compact"
            onClick={() => download.mutate({format:"pdf",audience})}
            loading={download.isPending}
          >
            下载 PDF
          </Button>
          <Button variant="ghost" size="compact" disabled={download.isPending} onClick={() => download.mutate({format:"html",audience})}>HTML 存档</Button>
          </>
        ) : (
          <Button
            variant="run"
            size="compact"
            onClick={() => create.mutate()}
            loading={create.isPending}
          >
            生成客户计算书
          </Button>
        )}
      </div>
      {(error || boundError) && (
        <ErrorState
          title="计算书不可用"
          description={message(error || boundError)}
        />
      )}
      {error || boundError ? null : document.isFetching ? (
        <LoadingState title="正在读取计算书" />
      ) : !did ? (
        <EmptyState
          title="尚未生成计算书"
          description="计算书只引用所选当前运行，不重新计算。"
        />
      ) : document.data && !boundError ? (
        tab === "sources" ? (
          <dl className="report-sources">
            <div>
              <dt>源运行</dt>
              <dd>{new Date(text(run.finished)).toLocaleString("zh-CN")}</dd>
            </div>
            <div>
              <dt>结果一致性</dt>
              <dd>已由宿主校验</dd>
            </div>
          </dl>
        ) : (
          <iframe
            className="report-frame"
            title="计算书预览"
            sandbox=""
            srcDoc={preview}
          />
        )
      ) : null}
    </div>
  );
}
