import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useEffect, useState } from "react";
import { delivery, deliveryFile, deliveryPdf, type ReportAudience } from "@/api/delivery";
import { Select } from "./ui/select";
import {
  api,
  array,
  record,
  text,
  responseData,
  message,
  ApiError,
  optionalRecord,
} from "@/api/client";
import { Button } from "./ui/button";
import { EmptyState, ErrorState, LoadingState, StaleBanner } from "./states";
import { StatusMark } from "./status-mark";
import { Link, useSearch } from "@tanstack/react-router";
import type { ComponentProps } from "react";
import { downloadBlob } from "@/lib/download";
import { isVersionStale } from '@/lib/version-status';
import type { CadImage } from '@/features/cad/types';
import { hpcJson, savedRunLabel } from '@/features/field/run-label';
import { reportSectionImages } from './study-report-drawing';

export function StudyReport(props: ComponentProps<typeof CurrentReport>) {
  const search = useSearch({ strict: false });
  return <><div className="report-toolbar"><Link to="/deliveries" search={{ workspace: props.wid, delivery: props.did, theme: search.theme === "dark" ? "dark" : "light" }}>交付历史 · 计算书与规格书</Link></div><CurrentReport {...props} /></>;
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
  cadImage, runs = [],
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
  cadImage?: CadImage;
  runs?: Record<string, unknown>[];
}) {
  const queries = useQueryClient();
  const [audience, setAudience] = useState<ReportAudience>("customer");
  const [includeImage, setIncludeImage] = useState(true);
  const [femId, setFemId] = useState('');
  const [iecId, setIecId] = useState('');
  useEffect(() => { setFemId(''); setIecId(''); }, [run?.id]);
  const methodOf = (value: Record<string, unknown>) => optionalRecord(value.method || optionalRecord(optionalRecord(value.snapshot).definition).method);
  const primaryFem = methodOf(run || {}).capability === 'iec-thermal-field';
  const related = useQuery({
    queryKey: ['report-source-runs', wid], enabled: !did && !!run,
    queryFn: async ({signal}) => {
      const studies = await responseData(api.GET('/api/workspaces/{wid}/studies', {params:{path:{wid}}, signal}));
      const found: Record<string, unknown>[] = [];
      for (const study of array(studies).map(value => record(value))) {
        const page = await responseData(api.GET('/api/workspaces/{wid}/studies/{sid}/runs', {params:{path:{wid,sid:text(study.id)}, query:{view:'summary',limit:100}}, signal}));
        found.push(...array(record(page).items).map(value => ({...record(value), study_name:optionalRecord(study.definition).title || study.title})));
      }
      return found;
    },
  });
  const savedRuns = [...new Map([...runs, ...(related.data || [])].map(row => [text(row.id), row])).values()]
    .filter(row => row.integrity === 'verified' && row.freshness === 'current' && !isVersionStale(row) && ['succeeded','partial'].includes(text(row.status)));
  const chapterReference = primaryFem ? (iecId ? {fem_run_id:text(run?.id),iec_run_id:iecId} : undefined)
    : femId ? {fem_run_id:femId,iec_run_id:text(run?.id)} : undefined;
  const chapter = useQuery({queryKey:['report-fem-chapter',wid,chapterReference?.fem_run_id,chapterReference?.iec_run_id], enabled:!!chapterReference && !did,
    queryFn:({signal}) => hpcJson(`/workspaces/${encodeURIComponent(wid)}/chapters/${encodeURIComponent(chapterReference!.fem_run_id)}?iec_run_id=${encodeURIComponent(chapterReference!.iec_run_id)}`, {signal})});
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
  const [preview, setPreview] = useState('');
  const [previewError, setPreviewError] = useState<Error>();
  useEffect(() => {
    setPreview('');setPreviewError(undefined);
    if (!document.data) return;
    let url: string;
    try {
      // Preview the actual customer/internal PDF selected for export. The saved
      // HTML remains an evidence archive, including its diagnostic source keys.
      url = URL.createObjectURL(deliveryPdf(document.data, audience));
      setPreview(url);
    } catch (error) { setPreviewError(error as Error); }
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [document.data, audience]);
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
      if (primaryFem && !chapterReference) throw new ApiError(422, '请选择输入匹配的 IEC 对照运行。');
      if (chapterReference && (!chapter.data || chapter.error || chapter.isFetching)) throw new ApiError(422, '请先核对有限元章节；未收敛或输入不一致不能交付。');
      const cadImages = includeImage && cadImage ? [{metadata:cadImage.metadata,png_base64:await pngBase64(cadImage.blob)}] : [];
      const sectionImages = await reportSectionImages(source);
      const payload = {run_ids:[rid], request_id:'', cad_images:cadImages, section_images:sectionImages, fem_chapter:chapterReference || null};
      const identity = JSON.stringify({...payload,request_id:undefined});
      if (request.current.run !== identity) request.current = { run: identity, id: crypto.randomUUID() };
      payload.request_id = request.current.id;
      const book = record(await responseData(api.POST('/api/workspaces/{wid}/deliveries/current', {params:{path:{wid}},body:payload})), '计算书');
      verify(book, source);
      return book;
    },
    onSuccess: (value) => {
      queries.setQueryData(['delivery', wid, text(value.id)], value);
      onDelivery(text(value.id));
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
  const generated = useRef('');
  useEffect(() => {
    if (autoGenerate && current && !did && !primaryFem && generated.current !== text(run?.id)) {
      generated.current = text(run?.id);
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
      sources.length < 1 ||
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
  const error = create.error || download.error || document.error || previewError || chapter.error;
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
        <StatusMark kind={create.isPending ? 'running' : create.error ? 'error' : did ? 'current' : 'saved'} label={create.isPending ? '正在生成' : create.error ? '生成失败' : did ? '已生成 · 所选运行' : '所选运行'} />
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
            disabled={primaryFem && !chapterReference || !!chapterReference && (!chapter.data || chapter.isFetching || !!chapter.error || text(optionalRecord(chapter.data.convergence).status) !== 'converged')}
          >
            生成客户计算书
          </Button>
        )}
      </div>
      {!did && <section aria-label="计算书附图与章节" className="report-toolbar">
        {cadImage && <label><input type="checkbox" checked={includeImage} disabled={create.isPending} onChange={event => setIncludeImage(event.target.checked)} /> 插入三维导出图（含色标与来源）</label>}
        {primaryFem ? <Select label="IEC 对照运行" value={iecId} disabled={create.isPending || related.isFetching} onChange={setIecId}
          options={[{value:'',label:'选择保存的 IEC 运行'},...savedRuns.filter(row => methodOf(row).plugin_id === 'cablesim.iec60287').map(row => ({value:text(row.id),label:savedRunLabel(row)}))]} />
          : methodOf(run).plugin_id === 'cablesim.iec60287' && <Select label="有限元章节" value={femId} disabled={create.isPending || related.isFetching} onChange={setFemId}
            options={[{value:'',label:'仅所选 IEC 运行'},...savedRuns.filter(row => methodOf(row).capability === 'iec-thermal-field').map(row => ({value:text(row.id),label:savedRunLabel(row)}))]} />}
        {chapter.isFetching && <span role="status">正在核对保存章节</span>}
        {chapter.data && !chapter.isFetching && <span role="status">有限元章节已核对 · {text(optionalRecord(chapter.data.convergence).status) === 'converged' ? '已收敛' : '未收敛'}</span>}
      </section>}
      {!did && related.error && <ErrorState title="引用运行读取失败" description={message(related.error)} action={<Button size="compact" onClick={() => void related.refetch()}>重新读取</Button>} />}
      {(error || boundError) && (
        <ErrorState
          title="计算书不可用"
          description={message(error || boundError)}
          action={!boundError && create.error ? <Button disabled={create.isPending} onClick={() => create.mutate()}>重新生成</Button> : undefined}
        />
      )}
      {error || boundError ? null : create.isPending ? <LoadingState title="正在生成客户计算书" /> : document.isFetching ? (
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
            src={preview}
          />
        )
      ) : null}
    </div>
  );
}

function pngBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onerror = () => reject(Error('三维图读取失败；保存结果未改变。'));
    reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.readAsDataURL(blob);
  });
}
