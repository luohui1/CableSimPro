import { useEffect, useRef, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { newType } from "@/features/type/creation-api";
import { matchesOriginal, printedValue, specificationKey, specificationLabel } from '@/features/documents/evidence';
import { Link } from "@tanstack/react-router";
import * as documents from "@/api/documents";
import {
  api,
  ApiError,
  message,
  optionalRecord,
  responseData,
  text,
} from "@/api/client";
import { CatalogShell, usePageTheme } from "@/components/catalog-shell";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { StatusMark } from "@/components/status-mark";
import { displayName, displayText, displayUnit } from "@/lib/display-names";
import { downloadJson } from "@/lib/download";
import { engineeringQuantity, formatDateTime } from '@/lib/format';
import { deferredView } from '@/components/deferred-view';
const SourcePage = deferredView(() => import('@/features/documents/source-page').then(m => ({ default: m.SourcePage })));
import { ReviewField } from "@/features/documents/review-field";
import { ProposalForm } from "@/features/documents/proposal-form";
import { BatchProposals, type QueuedProposal } from '@/features/documents/batch-proposals';
import { requestErrorPointer, requestFieldLabel, focusRequestField } from '@/features/documents/request-fields';
import "@/styles/documents.css";

const statusLabels = {
  accepted: "等待提取",
  running: "提取中",
  succeeded: "提取完成",
  failed: "提取失败",
  interrupted: "提取已中断",
};
const methodLabels = {
  rules: "规则优先 · 自动离线识别",
  offline_ocr: "离线文字识别",
  hybrid: "规则与云端补充",
};
const isRunning = (run?: documents.Extraction) =>
  !!run && ["accepted", "running"].includes(run.status);

export function DocumentsPage() {
  const { theme, search, navigate } = usePageTheme(),
    queryClient = useQueryClient();
  const did = text(search.document),
    fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false),
    [uploadError, setUploadError] = useState<unknown>(null);
  const uploadLock = useRef(false);
  const catalog = useQuery({
    queryKey: ["documents"],
    queryFn: ({ signal }) => documents.documents(signal),
  });
  async function upload(file?: File) {
    if (!file || uploadLock.current) return;
    uploadLock.current = true;
    setUploading(true);
    setUploadError(null);
    try {
      const saved = await documents.uploadDocument(file);
      await queryClient.invalidateQueries({ queryKey: ["documents"] });
      await navigate({
        to: "/resources/cables/imports",
        search: { theme, document: saved.id },
      });
    } catch (error) {
      setUploadError(error);
    } finally {
      uploadLock.current = false;
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  return (
    <CatalogShell
      title="厂家资料导入"
      path="电缆型号版本"
      status={
        uploading ? (
          <StatusMark kind="running" label="正在上传原件" />
        ) : !did && catalog.error && catalog.data ? <StatusMark kind="historical" label="上次资料目录" detail={message(catalog.error)} /> : undefined
      }
      actions={
        <>
        {!did && <Button size="compact" disabled={catalog.isFetching} onClick={() => catalog.refetch()}>刷新目录</Button>}
        <Button
          variant={did ? "default" : "primary"}
          size="compact"
          loading={uploading}
          onClick={() => fileInput.current?.click()}
        >
          上传 PDF
        </Button>
        </>
      }
    >
      <input
        className="visually-hidden"
        tabIndex={-1}
        ref={fileInput}
        type="file"
        accept="application/pdf,.pdf"
        aria-label="上传 PDF 文件"
        onChange={(event) => void upload(event.target.files?.[0])}
      />
      {!!uploadError && (
        <ErrorState title="上传未完成" description={message(uploadError)} />
      )}
      {did ? (
        <DocumentWorkspace key={did} did={did} />
      ) : (
        <div
          data-page="documents"
          data-state={
            catalog.isPending
              ? "loading"
              : catalog.error
                ? catalog.data ? "historical" : "error"
                : catalog.data?.length
                  ? "success"
                  : "empty"
          }
        >
          {catalog.isPending ? (
            <LoadingState title="正在读取资料目录" />
          ) : catalog.error && !catalog.data ? (
            <ErrorState
              title="资料目录读取失败"
              description={message(catalog.error)}
              action={
                <Button onClick={() => catalog.refetch()}>重试读取</Button>
              }
            />
          ) : !catalog.data?.length ? (
            <EmptyState
              title="本机尚未导入厂家原件"
              description="电缆型号版本里标为“厂家资料”的数值来自随附的公开规格摘录，厂家原件不随软件分发；出处在各型号版本的“来源”里。导入原件后可在这里逐项核对、生成型号草稿。"
            />
          ) : (
            <table className="document-catalog">
              <thead>
                <tr>
                  <th>资料名称</th>
                  <th>页数</th>
                  <th>大小</th>
                  <th>上传时间</th>
                </tr>
              </thead>
              <tbody>
                {catalog.data.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <Link
                        to="/resources/cables/imports"
                        search={{ theme, document: item.id }}
                      >
                        {item.name}
                      </Link>
                    </td>
                    <td>{item.page_count}</td>
                    <td>{(item.size_bytes / 1024 / 1024).toFixed(2)} MiB</td>
                    <td>{formatDateTime(item.created)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </CatalogShell>
  );
}

function DocumentWorkspace({ did }: { did: string }) {
  const { theme, search, navigate } = usePageTheme(),
    cache = useQueryClient();
  const eid = text(search.extraction),
    pid = text(search.proposal);
  const [queued,setQueued] = useState<QueuedProposal[]>(() => {
    try { const value:unknown = JSON.parse(sessionStorage.getItem('document-queue:'+did) || '[]');
      return Array.isArray(value) ? value.filter(item=>typeof item?.extraction_id==='string' && item?.new_model && Number.isInteger(item?.expected_review_revision)) : [];
    } catch { return []; }
  });
  useEffect(()=>{try{sessionStorage.setItem('document-queue:'+did,JSON.stringify(queued));}catch{/* The active queue remains available when storage is full. */}},[did,queued]);
  const [page, setPage] = useState(1),
    [selected, setSelected] = useState(""),
    [operator, setOperator] = useState("");
  const [method, setMethod] = useState<documents.Scope["method"]>("rules"),
    [selections, setSelections] = useState<documents.Scope["selections"]>([]);
  const [designation, setDesignation] = useState(""),
    [specification, setSpecification] = useState(""),
    [identity, setIdentity] = useState("");
  const [busy, setBusy] = useState(""),
    [error, setError] = useState<unknown>(null),
    [showProposal, setShowProposal] = useState(false);
  const [disclosure, setDisclosure] = useState<documents.Disclosure | null>(
      null,
    ),
    [confirmed, setConfirmed] = useState(false),
    [approvalOpen, setApprovalOpen] = useState(false),
    [approvalAck, setApprovalAck] = useState(false),
    [approver, setApprover] = useState("");
  const lock = useRef(false),
    ids = useRef(new Map<string, string>());
  const doc = useQuery({
    queryKey: ["document", did],
    queryFn: ({ signal }) => documents.documentInfo(did, signal),
  });
  const source = useQuery({
    queryKey: ["document-page", did, page],
    queryFn: ({ signal }) => documents.pageInfo(did, page, signal),
  });
  const history = useQuery({
    queryKey: ["document-history", did],
    queryFn: ({ signal }) => documents.extractionHistory(did, signal),
  });
  const runId = eid || history.data?.[0]?.id || "";
  const extraction = useQuery({
    queryKey: ["document-extraction", did, runId],
    queryFn: ({ signal }) => documents.extractionInfo(did, runId, signal),
    enabled: !!runId,
    refetchInterval: (query) => (isRunning(query.state.data) ? 1200 : false),
  });
  const createDesign = useMutation({
    retry: false,
    mutationFn: async () => {
      const value = proposal.data!;
      const created = await newType({ request_id: crypto.randomUUID(), name: value.draft.name, origin: "import", proposal_id: value.id, content_sha256: value.sha256 });
      await navigate({ to: "/types/$wid/$module/$tab", params: { wid: created.id, module: "structure", tab: "section" }, search: { theme } });
    },
  });
  const proposal = useQuery({
    queryKey: ["document-proposal", did, pid],
    queryFn: ({ signal }) => documents.proposalInfo(did, pid, signal),
    enabled: !!pid,
  });
  const models = useQuery({
    queryKey: ["document-models"],
    queryFn: ({ signal }) => documents.cableModels(signal),
    enabled: showProposal,
  });
  const run = extraction.data,
    candidates = run?.result?.candidates || [],
    candidate =
      candidates.find((item) => item.id === selected) || candidates[0];
  const latestSpecs = [...new Map((history.data || []).slice().reverse().map(item => [specificationKey(item), item])).values()].reverse();
  const sameSpecHistory = run ? history.data?.filter(item => specificationKey(item) === specificationKey(run)) : history.data;
  const evidencePages = [...new Set(candidates.map(item => item.page))];
  const evidence = useQueries({ queries: evidencePages.map(page => ({ queryKey: ['document-page', did, page], queryFn: ({signal}: {signal:AbortSignal}) => documents.pageInfo(did, page, signal) })) });
  const evidenceReady = !!evidence.length && evidence.every(item=>item.isSuccess);
  const [command, setCommand] = useState<{ action: 'accept' | 'reject'; id: number }>();
  const historical =
    !!run &&
    ((!!sameSpecHistory?.[0] && run.id !== sameSpecHistory[0].id) ||
      run.snapshot_integrity === "unsealed");
  const reviewed = new Map(
    (run?.reviews || []).map((item) => [text(item.candidate_id), item]),
  );
  const reviewComplete =
    !!candidates.length && candidates.every((item) => reviewed.has(item.id));
  const readOnly =
    historical ||
    run?.status !== "succeeded" ||
    proposal.data?.status === "approved";
  const eligible = candidates.filter(item => !reviewed.has(item.id) && candidates.filter(other => other.field === item.field).length === 1
    && JSON.stringify(item.model) === JSON.stringify(run?.result?.model)
    && run?.document_sha256 === doc.data?.sha256 && run?.snapshot_integrity === 'verified'
    && matchesOriginal(item, evidence[evidencePages.indexOf(item.page)]?.data));
  const scope: documents.Scope = {
    method,
    model: {
      designation: designation.trim(),
      specification: specification.trim(),
      identity_note: identity.trim(),
    },
    selections,
  };
  const state =
    error || doc.error || extraction.error || source.error
      ? "error"
      : doc.isPending || (!!runId && extraction.isPending) || isRunning(run)
        ? "loading"
        : historical
          ? "historical"
          : run?.status === "failed" || run?.status === "interrupted"
            ? "error"
            : run
              ? "success"
              : "empty";
  useEffect(() => {
    if (candidate) setPage(candidate.page);
  }, [candidate?.id]);
  useEffect(() => {
    if (run && !isRunning(run)) void cache.invalidateQueries({ queryKey: ['document-history', did] });
  }, [run?.status, run?.id, cache, did]);
  useEffect(() => {
    setDisclosure(null);
    setConfirmed(false);
  }, [method, designation, specification, identity, selections]);
  function requestId(action: string, body: unknown) {
    const key = action + JSON.stringify(body);
    if (!ids.current.has(key)) ids.current.set(key, crypto.randomUUID());
    return ids.current.get(key)!;
  }
  async function action(name: string, execute: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(name);
    setError(null);
    try {
      await execute();
    } catch (problem) {
      setError(problem instanceof TypeError ? Error('连接中断，已填写的核对内容保留；可重试同一操作。') : problem);
    } finally {
      lock.current = false;
      setBusy("");
    }
  }
  async function refresh() {
    await Promise.all([
      doc.refetch(),
      source.refetch(),
      history.refetch(),
      ...(runId ? [extraction.refetch()] : []),
      ...(pid ? [proposal.refetch()] : []),
    ]);
  }
  async function startExtraction(confirmedDisclosure?: documents.Disclosure) {
    const body = {
      ...scope,
      ...(confirmedDisclosure
        ? {
            disclosure_id: confirmedDisclosure.id,
            disclosure_sha256: confirmedDisclosure.disclosure_sha256,
            outbound_confirmed: true as const,
          }
        : {}),
    };
    const saved = await documents.extract(did, {
      ...body,
      request_id: requestId("extract", body),
    });
    cache.setQueryData(["document-extraction", did, saved.id], saved);
    setDisclosure(null);
    setConfirmed(false);
    setShowProposal(false);
    setSelected("");
    await history.refetch();
    await navigate({
      to: "/resources/cables/imports",
      search: { theme, document: did, extraction: saved.id },
    });
  }
  async function saveDecision(decisions: documents.Decision[]) {
    if (!run || readOnly) return;
    setCommand(undefined);
    await action("review", async () => {
      const body = {
        expected_revision: run.revision,
        reviewer: operator.trim(),
        decisions,
      };
      const saved = await documents.review(did, run.id, {
        ...body,
        request_id: requestId("review", body),
      });
      cache.setQueryData(["document-extraction", did, run.id], saved);
      await cache.invalidateQueries({queryKey:['document-history',did]});
      setQueued(items=>items.filter(item=>item.extraction_id!==run.id));
      setShowProposal(false);
      if (pid)
        await navigate({
          to: "/resources/cables/imports",
          search: { theme, document: did, extraction: run.id },
        });
    });
  }
  function choose(item: documents.Candidate) {
    setCommand(undefined);
    setSelected(item.id);
    setPage(item.page);
  }
  function acceptEligible() {
    if (!evidenceReady || !eligible.length || readOnly || busy) return;
    if (!operator.trim()) { document.querySelector<HTMLInputElement>('[name=reviewer]')?.focus(); return; }
    void saveDecision(eligible.map(item => ({ candidate_id:item.id, action:'accept', reason:'人工执行当前规格批量确认；原件高亮文字与候选引用一致，无歧义。' })));
  }
  function reviewKey(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || (event.target as HTMLElement).closest('input,textarea,select,[contenteditable=true],[role=dialog],[role=combobox]')) return;
    if (showProposal || proposal.data || !candidate || busy) return;
    const key = event.key.toLowerCase();
    const ordered = [...candidates.filter(item=>item.ambiguities.length), ...candidates.filter(item=>!item.ambiguities.length)];
    if (key === 'j' || key === 'k') {
      event.preventDefault(); const next = ordered[Math.max(0,Math.min(ordered.length-1,ordered.findIndex(item=>item.id===candidate.id)+(key==='j'?1:-1)))];
      choose(next); requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>('[data-candidate-id="'+CSS.escape(next.id)+'"]')?.focus());
    } else if (key === 'a') { event.preventDefault(); acceptEligible(); }
    else if ((key === 'enter' || key === 'x') && !readOnly && (!(event.target as HTMLElement).closest('button,a,summary') || (event.target as HTMLElement).closest('[data-candidate-id]'))) {
      event.preventDefault(); setCommand({action:key==='x'?'reject':'accept',id:Date.now()});
    }
  }
  function candidateTable(items: documents.Candidate[], title: string) {
    return (
      !!items.length && (
        <section className="document-candidates">
          <h2>
            {title} <span className="muted">{items.length}</span>
          </h2>
          <table>
            <thead>
              <tr>
                <th>参数</th>
                <th>原始值</th>
                <th>核对</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} data-selected={candidate?.id === item.id}>
                  <td>
                    <button
                      type="button"
                      className="text-button"
                      data-candidate-id={item.id}
                      aria-pressed={candidate?.id === item.id}
                      onClick={() => choose(item)}
                    >
                      {displayName(item.field)}
                    </button>
                  </td>
                  <td>
                    {printedValue(item)} {displayUnit(item.raw_unit)}
                  </td>
                  <td>
                    {reviewed.has(item.id)
                      ? reviewed.get(item.id)?.action === "accept"
                        ? "已接受"
                        : reviewed.get(item.id)?.action === "modify"
                          ? "已修改"
                          : "已拒绝"
                      : "待核对"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )
    );
  }
  const problem =
    error || doc.error || extraction.error || source.error || proposal.error;
  const fieldErrors =
    problem instanceof ApiError
      ? (Array.isArray(problem.detail) ? problem.detail : [problem.detail]).flatMap(raw => {
          const item = optionalRecord(raw); return Array.isArray(item.issues) && item.issues.length ? item.issues.map(optionalRecord) : [item];
        })
      : [];
  const problemDescription = problem instanceof ApiError && Array.isArray(problem.detail)
    ? fieldErrors.map(issue => requestFieldLabel(requestErrorPointer(issue)) + '：' + (/[\u3400-\u9fff]/.test(text(issue.msg)) ? displayText(text(issue.msg)) : '请检查必填项、数值范围和单位。')).join('；')
    : message(problem);
  return (
    <div
      className="documents-workspace"
      data-page="document-review"
      data-state={state}
      onKeyDown={reviewKey}
    >
      <div className="document-toolbar">
        <Link to="/resources/cables/imports" search={{ theme }}>
          资料目录
        </Link>
        <strong>{doc.data?.name || "读取原件"}</strong>
        {run && (
          <StatusMark
            kind={
              historical
                ? "historical"
                : run.status === "succeeded"
                  ? "current"
                  : isRunning(run)
                    ? "running"
                    : "error"
            }
            label={historical ? "历史提取" : statusLabels[run.status]}
          />
        )}
        <Button size="compact" onClick={() => void refresh()} disabled={!!busy}>
          刷新
        </Button>
        {run?.status === "succeeded" && !historical && !proposal.data && !showProposal && (
          <Button
            variant="primary"
            size="compact"
            disabled={!reviewComplete || !!busy}
            onClick={() => setShowProposal((value) => !value)}
          >
            准备提案
          </Button>
        )}
        {proposal.data?.status === "proposed" && (
          <Button
            variant="primary"
            size="compact"
            onClick={() => {
              setApprovalOpen(true);
              setApprovalAck(false);
            }}
          >
            核对并批准
          </Button>
        )}
      </div>
      {!!problem && (
        <div className="document-error" role="alert">
          <span>{problemDescription}</span>
          <Button
            size="compact"
            onClick={() => {
              setError(null);
              void refresh();
            }}
          >
            重新读取
          </Button>
          {fieldErrors.filter(issue => requestErrorPointer(issue)).map((issue, index) => (
            <Button
              key={index}
              size="compact"
              variant="ghost"
              onClick={() => focusRequestField(requestErrorPointer(issue))}
            >
              定位{requestFieldLabel(requestErrorPointer(issue))}
            </Button>
          ))}
        </div>
      )}
      {doc.isPending ? (
        <LoadingState title="正在读取原件" />
      ) : !doc.data ? null : (
        <>
          <details className="document-extraction-config" open={!run}>
            <summary>提取范围与方法</summary>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!selections.length) {
                  setError(Error("请至少选择一页或一个片段。"));
                  return;
                }
                void action("extract", async () => {
                  if (method === "hybrid") {
                    const value = await documents.disclose(did, scope);
                    setDisclosure(value);
                    setConfirmed(false);
                  } else await startExtraction();
                });
              }}
            >
              <fieldset disabled={!!busy || isRunning(run)}>
                <div className="document-form-grid">
                  <label>
                    型号系列
                    <input
                      name="designation"
                      data-request-path="/model/designation"
                      value={designation}
                      required
                      maxLength={80}
                      placeholder="如 YJLW03"
                      onChange={(event) => setDesignation(event.target.value)}
                    />
                  </label>
                  <label>
                    规格行／列
                    <input
                      name="specification"
                      data-request-path="/model/specification"
                      value={specification}
                      required
                      maxLength={40}
                      placeholder="如 800 或 3×300"
                      onChange={(event) => setSpecification(event.target.value)}
                    />
                  </label>
                  <label>
                    识别方法
                    <select
                      name="method"
                      data-request-path="/method"
                      aria-label="识别方法"
                      value={method}
                      onChange={(event) =>
                        setMethod(
                          event.target.value as documents.Scope["method"],
                        )
                      }
                    >
                      {Object.entries(methodLabels).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    厂家、电压、导体与护套分支
                    <input
                      name="identity_note"
                      data-request-path="/model/identity_note"
                      value={identity}
                      required
                      maxLength={300}
                      onChange={(event) => setIdentity(event.target.value)}
                    />
                  </label>
                </div>
                <div className="document-selections" data-request-path="/selections" tabIndex={-1}>
                  <label>
                    原文页码
                    <input
                      aria-label="原文页码"
                      type="number"
                      min={1}
                      max={doc.data.page_count}
                      value={page}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (
                          Number.isInteger(value) &&
                          value >= 1 &&
                          value <= doc.data!.page_count
                        )
                          setPage(value);
                      }}
                    />
                  </label>
                  <Button
                    disabled={
                      selections.length >= 4 ||
                      selections.some(
                        (item) => item.page === page && !item.region,
                      )
                    }
                    onClick={() =>
                      setSelections((current) => [...current, { page }])
                    }
                  >
                    加入整页
                  </Button>
                  <span className="muted">
                    已选 {selections.length}/4 · 也可在原文上框选
                  </span>
                  {selections.map((selection, index) => (
                    <Button
                      key={index}
                      data-request-path={'/selections/' + index}
                      size="compact"
                      aria-label={`移除第 ${selection.page} 页${selection.region ? "片段" : "整页"}`}
                      onClick={() =>
                        setSelections((current) =>
                          current.filter((_, i) => i !== index),
                        )
                      }
                    >
                      第 {selection.page} 页{selection.region ? " · 片段" : ""}{" "}
                      ×
                    </Button>
                  ))}
                </div>
                <Button
                  type="submit"
                  variant={run ? "default" : "primary"}
                  loading={busy === "extract"}
                >
                  {method === "hybrid" ? "查看外发说明" : "开始离线提取"}
                </Button>
              </fieldset>
            </form>
          </details>
          <div className="document-history">
            {!!latestSpecs.length && <label>规格<select aria-label="规格" value={run ? specificationKey(run) : ''} disabled={!!busy} onChange={event => {
              const next = latestSpecs.find(item=>specificationKey(item)===event.target.value); if (!next) return;
              setSelected(''); setCommand(undefined); setShowProposal(false);
              void navigate({to:'/resources/cables/imports',search:{...search,theme,document:did,extraction:next.id,proposal:''}});
            }}>{latestSpecs.map(item=><option key={item.id} value={specificationKey(item)}>{specificationLabel(item)} · {item.reviews.length}/{item.result?.candidates.length || 0}</option>)}</select></label>}
            <label>
              提取记录
              <select
                aria-label="提取记录"
                value={runId}
                disabled={!!busy}
                onChange={(event) => {
                  setSelected("");
                  setShowProposal(false);
                  void navigate({
                    to: "/resources/cables/imports",
                    search: {
                      theme,
                      document: did,
                      extraction: event.target.value,
                    },
                  });
                }}
              >
                <option value="">尚无提取</option>
                {sameSpecHistory?.map((item) => (
                  <option key={item.id} value={item.id}>
                    {formatDateTime(item.created)} ·{" "}
                    {statusLabels[item.status]}
                  </option>
                ))}
              </select>
            </label>
            {run && (
              <span className="muted">
                已核对 {reviewed.size}/{candidates.length}
              </span>
            )}
            <Button
              size="compact"
              onClick={() =>
                void action("download", async () => {
                  const reply = await api.GET("/api/documents/{did}/file", {
                    params: { path: { did } },
                    parseAs: "arrayBuffer",
                  });
                  const data = await responseData(Promise.resolve(reply));
                  const hash = Array.from(
                    new Uint8Array(await crypto.subtle.digest("SHA-256", data)),
                    (value) => value.toString(16).padStart(2, "0"),
                  ).join("");
                  if (
                    hash !== doc.data!.sha256 ||
                    reply.response.headers.get("X-Original-SHA256") !== hash
                  )
                    throw Error("原件摘要不一致，已停止下载。");
                  const url = URL.createObjectURL(
                    new Blob([data], { type: "application/pdf" }),
                  );
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = doc.data!.name;
                  link.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                })
              }
            >
              下载原件
            </Button>
          </div>
          <BatchProposals did={did} batchId={text(search.batch)} items={queued} onRemove={id=>setQueued(items=>items.filter(item=>item.extraction_id!==id))} onCreated={batch=>void navigate({to:'/resources/cables/imports',search:{...search,theme,document:did,batch}})}/>
          {isRunning(run) && (
            <div role="status" className="document-progress">
              <progress aria-label="资料提取进度" />
              <span>
                {source.data?.requires_ocr || method === "offline_ocr"
                  ? "正在识别并提取所选页面"
                  : "正在提取所选页面"}{" "}
                · 原件已保存
              </span>
            </div>
          )}
          <div className="document-review-layout">
            {source.data ? (
              <SourcePage
                key={did + page}
                did={did}
                page={source.data}
                candidate={candidate}
                onRegion={(region) => {
                  if (busy || isRunning(run)) return;
                  if (selections.length >= 4)
                    setError(
                      Error("最多选择四个页或片段，请先移除不需要的范围。"),
                    );
                  else
                    setSelections((current) => [...current, { page, region }]);
                }}
              />
            ) : source.isPending ? (
              <LoadingState title="正在读取原文页" />
            ) : (
              <ErrorState
                title="原文页读取失败"
                description={message(source.error)}
                action={
                  <Button onClick={() => source.refetch()}>重试原文</Button>
                }
              />
            )}
            <section className="document-review-panel" aria-label="候选与提案">
              {proposal.data ? (
                <section className="document-proposal">
                  <Button size="compact" variant="ghost" onClick={() => { setShowProposal(false); void navigate({ to: '/resources/cables/imports', search: { theme, document: did, extraction: runId } }); }}>返回逐项核对</Button>
                  <h2>
                    {proposal.data.status === "approved"
                      ? "型号草稿已生成"
                      : "核对变更提案"}
                  </h2>
                  <StatusMark
                    kind={
                      proposal.data.status === "approved"
                        ? "current"
                        : "proposal"
                    }
                    label={
                      proposal.data.status === "approved"
                        ? "草稿 · 尚未发布"
                        : "等待人工批准"
                    }
                  />
                  <table>
                    <thead>
                      <tr>
                        <th>参数</th>
                        <th>原值</th>
                        <th>提案值</th>
                      </tr>
                    </thead>
                    <tbody>
                      {proposal.data.changes.map((change, index) => {
                        const before = optionalRecord(change.before),
                          after = optionalRecord(change.after);
                        const from = engineeringQuantity(text(change.field), typeof before.value === 'number' ? before.value : null, text(before.unit));
                        const to = engineeringQuantity(text(change.field), typeof after.value === 'number' ? after.value : null, text(after.unit));
                        return (
                          <tr key={index}>
                            <td>{displayName(text(change.field))}</td>
                            <td>
                              {before.value === undefined
                                ? "未填写"
                                : from.text + ' ' + from.unit}
                            </td>
                            <td>
                              <span title={to.complete}>{to.text} {to.unit}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <details>
                    <summary>提案摘要与来源</summary>
                    <p className="digest">{proposal.data.sha256}</p>
                    <p>
                      基准型号：{proposal.data.draft.name} ·{" "}
                      {proposal.data.draft.version}
                    </p>
                    <Button
                      onClick={() =>
                        downloadJson(proposal.data, "资料核对提案.json")
                      }
                    >
                      下载完整提案
                    </Button>
                  </details>
                  {proposal.data.status === "approved" && (
                    <div className="report-toolbar">
                      {/* 批准的资料提案直接建成型号设计（§4.2 第 3 个起点），来源固定为本提案与资料页码 */}
                      <Button variant="primary" loading={createDesign.isPending} onClick={() => createDesign.mutate()}>
                        新建型号设计
                      </Button>
                      <Button onClick={() => downloadJson(proposal.data!.draft, '型号资料草稿.json')}>
                        下载型号草稿
                      </Button>
                    </div>
                  )}
                  {createDesign.error && <p role="alert" className="field-error">{message(createDesign.error)}</p>}
                </section>
              ) : showProposal && run ? (
                models.isPending ? (
                  <LoadingState title="正在读取目标型号" />
                ) : models.error ? (
                  <ErrorState
                    description={message(models.error)}
                    action={
                      <Button onClick={() => models.refetch()}>重试型号</Button>
                    }
                  />
                ) : (
                  <ProposalForm
                    key={run.id}
                    extraction={run}
                    models={models.data || []}
                    busy={!!busy}
                    onQueue={body=>{setQueued(items=>[...items.filter(item=>item.extraction_id!==body.extraction_id),body]);setShowProposal(false);}}
                    onSubmit={(body) =>
                      void action("propose", async () => {
                        const saved = await documents.propose(did, {
                          ...body,
                          request_id: requestId("proposal", body),
                        });
                        cache.setQueryData(
                          ["document-proposal", did, saved.id],
                          saved,
                        );
                        await navigate({
                          to: "/resources/cables/imports",
                          search: {
                            theme,
                            document: did,
                            extraction: run.id,
                            proposal: saved.id,
                          },
                        });
                      })
                    }
                  />
                )
              ) : (
                <>
                  {!!candidates.length && <div className="document-batch-controls">
                    <Button size="compact" disabled={!evidenceReady || readOnly || !!busy || !eligible.length} onClick={acceptEligible}>{evidence.some(item=>item.isPending) ? '正在核验跨页原文' : `确认本规格 ${eligible.length} 项（A）`}</Button>
                    {evidence.some(item=>item.isError) && <Button size="compact" onClick={()=>void Promise.all(evidence.filter(item=>item.isError).map(item=>item.refetch()))}>重试批量原文核验</Button>}
                    <span className="muted" title="J、K 切换；Enter 接受；X 拒绝。逐项操作需填写核对人与理由。A 仅接受原件高亮文字一致、无歧义、尚未核对的项；OCR 与重复字段保留逐项核对。">J、K 切换 · Enter 确认 · X 拒绝</span>
                  </div>}
                  {run?.error && (
                    <ErrorState
                      title={statusLabels[run.status]}
                      description={displayText(
                        text(run.error.message) ||
                          "提取未完成。原件及已有证据保留，请检查后明确重试。",
                      )}
                    />
                  )}
                  {!run && (
                    <EmptyState
                      title="选择型号与原文范围"
                      description="先填写提取条件，再逐项核对候选。"
                    />
                  )}
                  {run?.status === "succeeded" && !candidates.length && (
                    <EmptyState
                      title="未找到有依据的候选值"
                      description="检查型号、规格行、单位及选定范围后重新提取。"
                    />
                  )}
                  {candidateTable(
                    candidates.filter((item) => item.ambiguities.length),
                    "待消歧",
                  )}
                  {candidateTable(
                    candidates.filter((item) => !item.ambiguities.length),
                    "候选参数",
                  )}
                  {candidate && (
                    <ReviewField
                      key={
                        runId +
                        candidate.id +
                        String(reviewed.get(candidate.id)?.reviewed_at || "")
                      }
                      candidate={candidate}
                      busy={!!busy}
                      readOnly={readOnly}
                      saved={reviewed.get(candidate.id)}
                      operator={operator}
                      command={command}
                      onOperator={setOperator}
                      onSave={(decision) => void saveDecision([decision])}
                    />
                  )}
                  {!!run?.result?.issues.length && (
                    <details>
                      <summary>提取诊断 · {run.result.issues.length}</summary>
                      <ul>
                        {run.result.issues.map((issue, index) => (
                          <li key={index}>
                            {displayText(
                              text(issue.message) || text(issue.code),
                            )}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {!!run?.result?.ocr_evidence?.length && (
                    <details>
                      <summary>
                        识别证据 · {run.result.ocr_evidence.length} 页／片段
                      </summary>
                      <p>识别结果独立保存，原件文字层保持原样。</p>
                      <Button
                        onClick={() =>
                          downloadJson(
                            run.result!.ocr_evidence,
                            "识别证据.json",
                          )
                        }
                      >
                        下载识别证据
                      </Button>
                    </details>
                  )}
                </>
              )}
            </section>
          </div>
        </>
      )}
      <Dialog
        open={!!disclosure}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setDisclosure(null);
            setConfirmed(false);
          }
        }}
        title="确认外发所选内容"
        actions={
          <Button
            variant="primary"
            disabled={!confirmed || !disclosure?.available}
            loading={!!busy}
            onClick={() =>
              void action("extract", async () => {
                if (disclosure && confirmed) await startExtraction(disclosure);
              })
            }
          >
            确认并开始提取
          </Button>
        }
      >
        {!!error && <p className="field-error" role="alert">{message(error)}</p>}
        {disclosure && (
          <>
            <dl className="document-evidence">
              <dt>服务</dt>
              <dd>{disclosure.service}</dd>
              <dt>字段提取地址</dt>
              <dd>{disclosure.endpoint}</dd>
              <dt>字段模型</dt>
              <dd>{disclosure.provider_model}</dd>
              <dt>文字识别地址</dt>
              <dd>{disclosure.ocr_endpoint || "本次不调用"}</dd>
              <dt>文字识别模型</dt>
              <dd>{disclosure.ocr_model || "本次不调用"}</dd>
              <dt>发送内容</dt>
              <dd>
                {
                  {
                    selected_text_tables: "选定文字与表格",
                    selected_page_images: "选定页／片段图像",
                    selected_text_and_images: "选定文字、表格与图像",
                  }[disclosure.content_kind]
                }
              </dd>
              <dt>发送范围</dt>
              <dd>
                {disclosure.scope.selections
                  .map(
                    (item) =>
                      `第 ${item.page} 页${item.region ? "片段（" + item.region.join("，") + "）" : "整页"}`,
                  )
                  .join("；")}
              </dd>
              <dt>内容摘要</dt>
              <dd className="digest">{disclosure.payload_sha256}</dd>
            </dl>
            {!disclosure.available && (
              <p className="field-error">
                服务尚未配置，不能外发。可关闭后选择离线方式。
              </p>
            )}
            <label className="document-checkbox">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                disabled={!!busy}
              />
              我已核对目的地址、模型与范围，同意外发所选内容
            </label>
          </>
        )}
      </Dialog>
      <Dialog
        open={approvalOpen}
        onOpenChange={(open) => {
          if (!busy) setApprovalOpen(open);
        }}
        title="批准型号草稿提案"
        actions={
          <Button
            variant="primary"
            disabled={!approvalAck || !approver.trim() || !proposal.data}
            loading={!!busy}
            onClick={() =>
              void action("approve", async () => {
                const body = {
                  proposal_sha256: proposal.data!.sha256,
                  approver: approver.trim(),
                  human_approved: true as const,
                };
                const saved = await documents.approve(did, pid, {
                  ...body,
                  request_id: requestId("approve", body),
                });
                cache.setQueryData(["document-proposal", did, pid], saved);
                setApprovalOpen(false);
              })
            }
          >
            批准并生成草稿
          </Button>
        }
      >
        {!!error && <p className="field-error" role="alert">{message(error)}</p>}
        <p>
          {proposal.data?.draft.name} · {proposal.data?.draft.version}
        </p>
        <p className="digest">{proposal.data?.sha256}</p>
        <label>
          批准人
          <input
            value={approver}
            data-request-path="/approver"
            onChange={(event) => setApprover(event.target.value)}
            maxLength={100}
          />
        </label>
        <label className="document-checkbox">
          <input
            type="checkbox"
            checked={approvalAck}
            data-request-path="/human_approved"
            onChange={(event) => setApprovalAck(event.target.checked)}
          />
          我已核对本提案的逐项变更，批准生成新版本草稿
        </label>
      </Dialog>
    </div>
  );
}
