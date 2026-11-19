import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useEffect, useState } from "react";
import { displayName } from '@/lib/display-names';
import { delivery, deliveryFile, deliveryPdf, type ReportAudience } from "@/api/delivery";
import { Select } from "./ui/select";
import {
  api,
  array,
  record,
  text,
  responseData,
  message,
  numeric,
  ApiError,
  optionalRecord,
} from "@/api/client";
import { Button } from "./ui/button";
import { EmptyState, LoadingState, StaleBanner } from '@/components/states';
import { StudyErrorState as ErrorState } from '@/components/study-error-state';
import { StatusMark } from "./status-mark";
import { Link, useSearch } from "@tanstack/react-router";
import type { ComponentProps } from "react";
import { downloadBlob } from "@/lib/download";
import { isVersionStale } from '@/lib/version-status';
import type { CadImage } from '@/features/cad/types';
import { hpcJson } from '@/features/field/run-label';
import { savedRunLabel } from './study-run-label';
import { reportSectionImages } from './study-report-drawing';
import { useFemEvidence } from './study-fem-conclusion';
import { FormalExport } from './formal-export';
import type { FormalSource } from '@/api/formal-deliveries';

export function StudyReport(props: ComponentProps<typeof CurrentReport>) {
  const search = useSearch({ strict: false });
  return <><div className="report-toolbar"><Link to="/deliveries" search={{ workspace: props.wid, delivery: props.did, theme: search.theme === "dark" ? "dark" : "light" }}>交付历史 · 计算书与规格书</Link></div><CurrentReport {...props} /></>;
}
function CurrentReport({
  wid,
  sid,
  run,
  did: requestedDelivery,
  tab,
  dirty,
  onDelivery,
  calculationLabel,
  onReturnToCalculation,
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
  calculationLabel: string;
  onReturnToCalculation: () => void;
  autoGenerate?: boolean;
  onGenerateConsumed?: () => void;
  cadImage?: CadImage;
  runs?: Record<string, unknown>[];
}) {
  const queries = useQueryClient();
  const [createdDelivery,setCreatedDelivery]=useState('');
  const did=createdDelivery || requestedDelivery;
  useEffect(()=>setCreatedDelivery(''),[run?.id,requestedDelivery]);
  const [audience, setAudience] = useState<ReportAudience>("customer");
  const [includeImage, setIncludeImage] = useState(true);
  const [femId, setFemId] = useState('');
  const [iecId, setIecId] = useState('');
  const generating = useRef(false);
  useEffect(() => { setFemId(''); setIecId(''); }, [run?.id]);
  const methodOf = (value: Record<string, unknown>) => optionalRecord(value.method || optionalRecord(optionalRecord(value.snapshot).definition).method);
  const primaryFem = methodOf(run || {}).capability === 'iec-thermal-field';
  // Formal deliveries require the *current* optimistic workspace revision,
  // alongside the immutable run input/output hashes. Never reuse a draft or
  // silently fall back to a revision embedded in an old run snapshot.
  const formalWorkspace = useQuery({
    queryKey: ['formal-delivery-workspace', wid], enabled: !!run && !dirty,
    queryFn: async ({signal}) => record(await responseData(api.GET('/api/workspaces/{wid}', {
      params: { path: { wid } }, signal,
    })), '正式交付工程'),
  });
  const formalRevision = numeric(formalWorkspace.data?.revision);
  const formalSource: FormalSource | null = !dirty && run?.integrity === 'verified'
    && (run.status === 'succeeded' || run.status === 'partial')
    && typeof run.id === 'string' && typeof run.input_digest === 'string'
    && typeof run.output_digest === 'string' && formalRevision !== null
      ? { workspace_id: wid, expected_revision: formalRevision,
          runs: [{run_id: run.id, input_digest: run.input_digest, output_digest: run.output_digest}] } : null;
  const ratingDriver = optionalRecord(optionalRecord(optionalRecord(run?.snapshot).definition).driver);
  const ratingCases = Array.isArray(ratingDriver.cases) ? ratingDriver.cases : [];
  const formalRating = ratingDriver.kind === 'batch' && ratingCases.length > 0
    && ratingCases.every(item => optionalRecord(optionalRecord(item).metadata).kind === 'type-rating-table');
  const related = useQuery({
    queryKey: ['report-source-runs', wid], enabled: !did && !!run && !autoGenerate && !generating.current,
    queryFn: async ({signal}) => {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(wid)}/studies?view=summary`,{signal});
      if (!response.ok) throw new ApiError(response.status,'引用研究读取失败，请重试。');
      const studies = await response.json();
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
  // Share the already read conclusion. The delivery worker authenticates proof
  // and formats the saved field once; a separate image-preparation request must
  // not queue another rendering job ahead of the user's generation task.
  const femEvidence=useFemEvidence(primaryFem ? run : savedRuns.find(row=>text(row.id)===femId));
  const defaultReference=optionalRecord(femEvidence.data?.reference);
  const selectedIec=iecId || text(defaultReference.iec_run_id);
  const chapterReference = primaryFem ? (selectedIec ? {fem_run_id:text(run?.id),iec_run_id:selectedIec,convergence_id:text(defaultReference.convergence_id) || undefined} : undefined)
    : femId ? {fem_run_id:femId,iec_run_id:text(run?.id),convergence_id:text(defaultReference.convergence_id) || undefined} : undefined;
  const summaryReference = primaryFem && selectedIec === text(defaultReference.iec_run_id);
  const chapter = useQuery({queryKey:['report-fem-chapter',wid,chapterReference?.fem_run_id,chapterReference?.iec_run_id,chapterReference?.convergence_id], enabled:!!chapterReference && !did && !!femEvidence.data && !summaryReference,
    queryFn:({signal}) => hpcJson(`/workspaces/${encodeURIComponent(wid)}/chapters/${encodeURIComponent(chapterReference!.fem_run_id)}?iec_run_id=${encodeURIComponent(chapterReference!.iec_run_id)}${chapterReference!.convergence_id ? '&convergence_id='+encodeURIComponent(chapterReference!.convergence_id) : ''}`, {signal})});
  const convergence=optionalRecord(chapter.data?.convergence);
  const chapterConverged=summaryReference ? femEvidence.data?.status==='converged' : text(optionalRecord(convergence.verdict).status || convergence.status)==='converged';
  const current =
    !!run &&
    run.freshness === "current" &&
    run.integrity === "verified" &&
    !isVersionStale(run) &&
    !dirty;
  const document = useQuery({
    queryKey: ["delivery", wid, did],
    queryFn: () => jobRequest(`/api/workspaces/${encodeURIComponent(wid)}/deliveries/${encodeURIComponent(did)}?view=summary`),
    enabled: !!did && !!run,
    // Generation has already fetched and verified this immutable archive.
    // Reuse that response when opening preview; export rechecks source freshness.
    staleTime:30000,
  });
  const request = useRef({ run: "", id: "" });
  const [generation, setGeneration] = useState<Record<string,unknown>>();
  const cancelRequested = useRef(false);
  const progressLabels: Record<string,string> = {source:'读取保存运行',drawing:'导出敷设截面',evidence:'核验收敛与来源',field_image:'绘制保存场图',pdf:'准备计算书',html:'整理保存结果',consistency:'核对摘要与候选',layout_customer:'排版客户版',layout_internal:'排版内部审核版',pdf_customer:'生成客户版 PDF',pdf_internal:'生成内部审核版 PDF',archive:'附入审核证据',save:'保存交付',done:'已生成'};
  async function jobRequest(path: string, init?: RequestInit) {
    const response=await fetch(path,init);let data:unknown;
    try {data=await response.json();}
    catch {throw new ApiError(response.ok ? 502 : response.status,'计算书服务未返回有效状态，请重试；保存的运行不变。');}
    const payload=optionalRecord(data);
    if(!response.ok)throw new ApiError(response.status,text(optionalRecord(payload.detail).message) || text(payload.detail) || '计算书任务不可用');
    return record(data);
  }
  async function cancelGeneration() {
    cancelRequested.current=true;
    if(generation?.id)setGeneration(await jobRequest(`/api/workspaces/${wid}/delivery-jobs/${text(generation.id)}/cancel`,{method:'POST'}));
  }
  const [preview, setPreview] = useState('');
  const [previewError, setPreviewError] = useState<Error>();
  const pdfCache=useRef(new Map<string,Blob>());
  async function savedPdf(book:Record<string,unknown>,edition:ReportAudience) {
    const key=text(book.id)+':'+text(book.digest)+':'+edition;
    const cached=pdfCache.current.get(key);if(cached)return cached;
    const response=await fetch(`/api/workspaces/${wid}/deliveries/${text(book.id)}/pdf?audience=${edition}`);
    if(!response.ok)throw new ApiError(response.status,'保存 PDF 读取失败，请重试；计算书与运行记录保持不变。');
    const bytes=await response.arrayBuffer();
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
    if(response.headers.get('X-Delivery-SHA256')!==book.digest || response.headers.get('X-Artifact-SHA256')!==hash || new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw new ApiError(409,'保存 PDF 与所选交付摘要不一致，拒绝预览。');
    const blob=new Blob([bytes],{type:'application/pdf'});pdfCache.current.set(key,blob);
    while(pdfCache.current.size>4)pdfCache.current.delete(pdfCache.current.keys().next().value!);
    return blob;
  }
  useEffect(() => {
    setPreview('');setPreviewError(undefined);
    if (!document.data) return;
    let url: string;let disposed=false;
    void (async()=>{try {
      // Preview the actual customer/internal PDF selected for export. The saved
      // HTML remains an evidence archive, including its diagnostic source keys.
      const blob=typeof document.data.html==='string' ? deliveryPdf(document.data,audience) : await savedPdf(document.data,audience);
      if(disposed)return;
      url = URL.createObjectURL(blob);
      setPreview(url);
    } catch (error) { if(!disposed)setPreviewError(error as Error); }})();
    return () => { disposed=true;if (url) URL.revokeObjectURL(url); };
  }, [document.data, audience]);
  async function fresh() {
    if (!run || dirty)
      throw new ApiError(409, "未保存修改或缺少源运行，不能交付");
    const saved = primaryFem ? await hpcJson(`/workspaces/${wid}/fields/${text(run.id)}/view`) : record(
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
      if(generating.current)throw new ApiError(409,'计算书正在生成，请等待当前任务。');
      generating.current=true;cancelRequested.current=false;setGeneration({state:'running',stage:'source'});
      try {
      // The host revalidates integrity, freshness and source revisions before
      // committing. Use the already saved run for drawing; avoid a duplicate
      // multi-megabyte detail request on the generation critical path.
      if (!run || dirty) throw new ApiError(409, '请先保存研究并选择完整的保存运行。');
      const source = run;
      const rid = text(source.id);
      if (primaryFem && !chapterReference) throw new ApiError(422, '请选择输入匹配的 IEC 对照运行。');
      if (chapterReference && (!chapterConverged || chapter.error || chapter.isFetching)) throw new ApiError(422, '请先核对有限元章节；未收敛或输入不一致不能交付。');
      const cadImages = includeImage && cadImage ? [{metadata:cadImage.metadata,png_base64:await pngBase64(cadImage.blob)}] : [];
      setGeneration({state:'running',stage:'drawing'});
      const sectionImages = await reportSectionImages(source);
      if(cancelRequested.current)throw new ApiError(499,'已取消生成，保存运行未改变。');
      const payload = {run_ids:[rid], request_id:'', cad_images:cadImages, section_images:sectionImages, fem_chapter:chapterReference || null};
      const identity = JSON.stringify({...payload,request_id:undefined});
      if (request.current.run !== identity) request.current = { run: identity, id: crypto.randomUUID() };
      payload.request_id = request.current.id;
      let job=await jobRequest(`/api/workspaces/${wid}/delivery-jobs`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      setGeneration(job);
      while(['queued','running'].includes(text(job.state))) {
        if(cancelRequested.current && job.stage!=='save')job=await jobRequest(`/api/workspaces/${wid}/delivery-jobs/${text(job.id)}/cancel`,{method:'POST'});
        else {
          await new Promise(resolve=>window.setTimeout(resolve,150));
          job=await jobRequest(`/api/workspaces/${wid}/delivery-jobs/${text(job.id)}`);
        }
        setGeneration(job);
      }
      if(job.state==='cancelled'){request.current={run:'',id:''};throw new ApiError(499,'已取消生成，保存运行未改变。');}
      if(job.state!=='succeeded')throw new ApiError(422,text(optionalRecord(job.error).message) || '计算书生成失败，保存运行未改变。');
      const book = optionalRecord(job.delivery_receipt);
      verify(book, source);
      await savedPdf(book,'customer');
      return book;
      } finally {generating.current=false;}
    },
    onSuccess: (value) => {
      queries.setQueryData(['delivery', wid, text(value.id)], value);
      setCreatedDelivery(text(value.id));
      void queries.invalidateQueries({queryKey:['deliveries',wid]});
      onDelivery(text(value.id));
    },
  });
  const download = useMutation({
    retry: false,
    mutationFn: async ({format, audience}: {format: "pdf" | "html"; audience: ReportAudience}) => {
      const source = await fresh();
      const book = document.data || await delivery(wid, did);
      verify(book, source);
      return format === "pdf" ? savedPdf(book,audience) : deliveryFile(wid, did, text(book.digest));
    },
    onSuccess: (blob, {format, audience}) => {
      downloadBlob(blob, format === "html" ? "计算书存档.html" : `${audience === "customer" ? "客户" : "内部"}计算书.pdf`);
    },
  });
  const generated = useRef('');
  useEffect(() => {
    if (autoGenerate && current && !did && (!primaryFem || chapterConverged && !chapter.isFetching && !chapter.error) && generated.current !== text(run?.id)) {
      generated.current = text(run?.id);
      create.mutate();
      onGenerateConsumed?.();
    }
  }, [autoGenerate, current, did, primaryFem, chapterConverged, chapter.isFetching, chapter.error]);
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
    if (typeof book.renderer !== 'string' || !/^[a-f0-9]{64}$/.test(text(book.digest)))
      throw new ApiError(502, "计算书没有有效的保存回执");
  }
  if (!run)
    return (
      <EmptyState
        art="report"
        title="尚无可交付运行"
        description="计算书只从一次成功的运行生成。先在计算模块运行，再回到这里生成。"
        action={<Button variant="primary" onClick={onReturnToCalculation}>返回{calculationLabel}</Button>}
      />
    );
  if (!current && !did)
    return (
      <StaleBanner
        description={
          dirty
            ? "请先保存研究；计算书不能纳入未保存输入。"
            : "所选运行是历史或完整性未通过，不能生成当前计算书。"
        }
      />
    );
  const cancelled = create.error instanceof ApiError && create.error.status === 499;
  const error = (!cancelled && create.error) || download.error || document.error || previewError || chapter.error || ((primaryFem || femId) ? femEvidence.error : undefined);
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
        <StatusMark kind={create.isPending ? 'running' : create.error && !cancelled ? 'error' : did ? 'current' : 'saved'} label={create.isPending ? '正在生成' : cancelled ? '已取消' : create.error ? '生成失败' : did ? '已生成 · 所选运行' : '所选运行'} />
        {create.isPending && <><span role="status">{progressLabels[text(generation?.stage)] || '正在准备'}</span><Button variant="ghost" size="compact" disabled={generation?.stage==='save' || generation?.state==='cancelled'} onClick={()=>void cancelGeneration().catch(error=>setPreviewError(error as Error))}>取消生成</Button></>}
        <div className="spacer" />
        <FormalExport kind="calculation" alternativeKinds={formalRating ? ['rating_table', 'research_report'] : ['research_report']}
          source={formalSource}
          disabledReason={dirty ? '请先保存当前研究。' : create.isPending ? '当前计算书正在生成。' :
            formalWorkspace.error ? message(formalWorkspace.error) : ''} />
        {!create.isPending && did ? (
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
        ) : !create.isPending ? (
          <Button
            variant="run"
            size="compact"
            onClick={() => create.mutate()}
            loading={create.isPending}
            disabled={primaryFem && !chapterReference || !!chapterReference && (!chapterConverged || chapter.isFetching || !!chapter.error)}
          >
            生成客户计算书
          </Button>
        ) : null}
      </div>
      {!did && <section aria-label="计算书附图与章节" className="report-toolbar">
        {cadImage && <label><input type="checkbox" checked={includeImage} disabled={create.isPending} onChange={event => setIncludeImage(event.target.checked)} /> 插入三维导出图（含色标与来源）</label>}
        {primaryFem ? <Select label="IEC 对照运行" value={selectedIec} disabled={create.isPending || related.isFetching} onChange={setIecId}
          options={[{value:'',label:'选择保存的 IEC 运行'},...savedRuns.filter(row => methodOf(row).plugin_id === 'cablesim.iec60287').map(row => ({value:text(row.id),label:savedRunLabel(row,'保存运行',text(row.study_name) || text(optionalRecord(optionalRecord(row.snapshot).definition).title))}))]} />
          : methodOf(run).plugin_id === 'cablesim.iec60287' && <Select label="有限元章节" value={femId} disabled={create.isPending || related.isFetching} onChange={setFemId}
            options={[{value:'',label:'仅所选 IEC 运行'},...savedRuns.filter(row => methodOf(row).capability === 'iec-thermal-field').map(row => ({value:text(row.id),label:savedRunLabel(row,'保存运行',text(row.study_name) || text(optionalRecord(optionalRecord(row.snapshot).definition).title))}))]} />}
        {(chapter.isFetching || femEvidence.isFetching) && <span role="status">正在核对保存章节与收敛证明</span>}
        {chapter.data && !chapter.isFetching && <span role="status">有限元章节已核对 · {chapterConverged ? '已收敛' : '未收敛'}</span>}
      </section>}
      {!did && related.error && <ErrorState title="引用运行读取失败" description={message(related.error)} action={<Button size="compact" onClick={() => void related.refetch()}>重新读取</Button>} />}
      {(error || boundError) && (
        <ErrorState
          title="计算书不可用"
          description={message(error || boundError)}
          action={!boundError && create.error ? <Button disabled={create.isPending} onClick={() => create.mutate()}>重新生成</Button> : undefined}
        />
      )}
      {create.isPending && did && <p className="muted">上一份计算书仍可查看；本次生成完成后切换到新版本。</p>}
      {error || boundError ? null : create.isPending ? (did && preview ? <iframe className="report-frame" title="上一份计算书预览" src={preview} /> : <div aria-busy="true" className="report-generating-placeholder" />) : document.isFetching ? (
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
              <dd>{savedRunLabel(run)}</dd>
            </div>
            <div>
              <dt>结果一致性</dt>
              <dd>已由宿主校验</dd>
            </div>
            <div><dt>所用方法</dt><dd>{displayName(text(methodOf(run).plugin_id))} {text(methodOf(run).version)}</dd></div>
            <div><dt>输入来源</dt><dd>按所选保存运行的输入快照与逐项来源生成；完整输入与诊断见内部审核版。</dd></div>
          </dl>
        ) : tab === 'content' ? <section aria-label="计算书内容" className="report-sources">
          <h2>{text(optionalRecord(optionalRecord(run.snapshot).definition).title) || '计算书'}</h2>
          <p>{audience==='customer'?'客户版：结论、敷设图、分组结果与方法依据。':'内部审核版：另含完整输入、诊断与验证证据。'}</p>
          <ol>{Array.from(new DOMParser().parseFromString(text(document.data.html),'text/html').querySelectorAll('h2')).map(node=>node.textContent?.trim()).filter(Boolean).slice(0,12).map((title,index)=><li key={index}>{title}</li>)}</ol>
          <p>在“来源”核对保存运行，在“预览”查看并下载纸面计算书。</p>
        </section> : (
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
