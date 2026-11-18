import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { studyModuleRoute } from '@/router';
import { ApiError, message, optionalRecord, text } from '@/api/client';
import {
  exportFormalPdf, formalCalculationRequest, previewFormalCalculation, readFormalRun, readFormalWorkspace,
  type FormalCalculationRequest, type FormalDocumentDraft, type FormalPdf, type FormalPreview,
} from '@/api/formal-calculation';
import { selectionView } from '@/lib/selection-view';
import { downloadBlob } from '@/lib/download';
import { useStudy } from './study-provider';
import { savedCaseLabel, savedRunLabel } from './study-run-label';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { EmptyState, LoadingState } from './states';
import { StudyErrorState } from './study-error-state';
import { StatusMark } from './status-mark';
import { FormalExport } from './formal-export';

type Props = {
  wid: string; sid: string; run?: Record<string, unknown>; tab: string; dirty: boolean;
  calculationLabel: string; onReturnToCalculation: () => void;
  autoGenerate?: boolean; onGenerateConsumed?: () => void;
};
type Prepared = { scope: string; request: FormalCalculationRequest; preview: FormalPreview; file: FormalPdf };
const asError = (problem: unknown): Error => problem instanceof Error ? problem : new Error(message(problem));
const fields = [
  { key: 'organization', label: '单位名称', limit: 120, required: true },
  { key: 'number', label: '文件编号', limit: 80, required: true },
  { key: 'revision', label: '版次', limit: 32, required: true },
  { key: 'issued_on', label: '签发日期（可选）', type: 'date' },
  { key: 'header', label: '页眉（可选）', limit: 160 },
  { key: 'footer', label: '页脚（可选）', limit: 160 },
] as const;

export function StudyFormalReport({ wid, sid, run, tab, dirty, calculationLabel, onReturnToCalculation,
  autoGenerate = false, onGenerateConsumed }: Props) {
  const context = useStudy();
  const search = studyModuleRoute.useSearch();
  const navigate = studyModuleRoute.useNavigate();
  const caseId = search.case || undefined, rid = text(run?.id);
  const workspace = useQuery({
    queryKey: ['formal-calculation-workspace', wid, context.workspace.revision],
    enabled: !!rid, retry: false, refetchOnWindowFocus: false,
    queryFn: ({ signal }) => readFormalWorkspace(wid, signal),
  });
  const revision = workspace.data?.revision;
  const full = useQuery({
    queryKey: ['formal-calculation-run', wid, sid, rid, run?.input_digest, run?.output_digest],
    enabled: !!rid, retry: false, staleTime: 30000, refetchOnWindowFocus: false,
    queryFn: ({ signal }) => readFormalRun(wid, sid, rid, signal),
  });
  const [document, setDocument] = useState<FormalDocumentDraft>({
    organization: '', number: '', revision: '', issued_on: '', header: '', footer: '',
  });
  const [prepared, setPrepared] = useState<Prepared>();
  const [pdfUrl, setPdfUrl] = useState<{ file: FormalPdf; url: string }>();
  const [error, setError] = useState<Error>();
  const [phase, setPhase] = useState<'idle' | 'preview' | 'pdf' | 'download'>('idle');
  const form = useRef<HTMLFormElement>(null);
  const controller = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const scope = JSON.stringify([wid, sid, rid, revision, run?.input_digest, run?.output_digest,
    run?.freshness, run?.status, caseId]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const invalidate = useCallback(() => {
    sequence.current += 1;
    controller.current?.abort();
    controller.current = null;
    setPrepared(undefined);
    setError(undefined);
    setPhase('idle');
  }, []);
  useEffect(() => { invalidate(); }, [scope, invalidate]);
  useEffect(() => () => { sequence.current += 1; controller.current?.abort(); }, []);
  useEffect(() => {
    if (!prepared) { setPdfUrl(undefined); return; }
    const url = URL.createObjectURL(prepared.file.blob);
    setPdfUrl({ file: prepared.file, url });
    return () => URL.revokeObjectURL(url);
  }, [prepared]);
  const consumed = useRef('');
  useEffect(() => {
    if (!autoGenerate) { consumed.current = ''; return; }
    if (rid && consumed.current !== rid) {
      consumed.current = rid;
      onGenerateConsumed?.();
      const input = form.current?.elements.namedItem('organization');
      if (input instanceof HTMLInputElement) input.focus();
    }
  }, [autoGenerate, rid, onGenerateConsumed]);

  const origin = useMemo<{ count: number; selection: boolean; label: string; error?: Error }>(() => {
    if (!full.data) return { count: 0, selection: false, label: '' };
    const snapshot = optionalRecord(full.data.snapshot);
    const inputs = (Array.isArray(snapshot.cases) ? snapshot.cases : []).map(optionalRecord);
    const selection = optionalRecord(optionalRecord(snapshot.definition).driver).kind === 'selection';
    try {
      if (text(run?.input_digest) && full.data.input_digest !== run?.input_digest
        || text(run?.output_digest) && full.data.output_digest !== run?.output_digest)
        throw new ApiError(409, '完整源运行摘要与页面所选运行不一致，请重新读取来源。');
      if (!caseId) return { count: inputs.length, selection, label: '' };
      const outputs = (Array.isArray(optionalRecord(full.data.output).cases)
        ? optionalRecord(full.data.output).cases as unknown[] : []).map(optionalRecord);
      if (inputs.filter(item => item.case_id === caseId).length !== 1
        || outputs.filter(item => item.case_id === caseId).length !== 1)
        throw new ApiError(409, '页面所选工况不存在于此保存运行，不能替换成另一候选。');
      const label = selection ? selectionView(full.data).rows.find(row => row.id === caseId)?.name
        : savedCaseLabel(full.data, caseId);
      if (!label) throw new ApiError(409, '所选候选身份无法核对，请返回结果重新选择。');
      return { count: inputs.length, selection, label };
    } catch (problem) { return { count: inputs.length, selection, label: '', error: asError(problem) }; }
  }, [full.data, caseId, run?.input_digest, run?.output_digest]);

  const sourceError = workspace.error || full.error || origin.error;
  const sourcePending = workspace.isPending || workspace.isFetching || full.isPending || full.isFetching;
  const formalSource = full.data && Number.isSafeInteger(revision) && !sourceError
    ? { workspace_id: wid, expected_revision: Number(revision),
        runs: [{ run_id: rid, input_digest: text(full.data.input_digest), output_digest: text(full.data.output_digest) }] }
    : null;
  const driver = optionalRecord(optionalRecord(optionalRecord(full.data?.snapshot).definition).driver);
  const ratingCases = Array.isArray(driver.cases) ? driver.cases : [];
  const formalRating = driver.kind === 'batch' && ratingCases.length > 0
    && ratingCases.every(value => optionalRecord(optionalRecord(value).metadata).kind === 'type-rating-table');
  const ready = prepared?.scope === scope && !sourceError ? prepared : undefined;
  const previewUrl = ready && pdfUrl?.file === ready.file ? pdfUrl.url : '';
  const busy = phase !== 'idle';
  const visibleError = sourceError || error;
  const invalidField = error instanceof ApiError ? text(optionalRecord(error.detail).field) : '';
  function update(field: keyof FormalDocumentDraft, value: string) {
    invalidate();
    setDocument(previous => ({ ...previous, [field]: value }));
  }
  function refreshSource() {
    invalidate();
    context.refresh();
    void workspace.refetch();
    void full.refetch();
  }
  function start() {
    controller.current?.abort();
    const active = new AbortController(), attempt = ++sequence.current;
    controller.current = active;
    return { signal: active.signal, valid: () => !active.signal.aborted
      && sequence.current === attempt && currentScope.current === scope };
  }
  async function prepare() {
    if (busy || !full.data || sourcePending || sourceError) return;
    const operation = start();
    setPrepared(undefined); setError(undefined); setPhase('preview');
    try {
      const request = formalCalculationRequest(wid, sid, revision, full.data, document);
      const preview = await previewFormalCalculation(request, sid, operation.signal);
      if (!operation.valid()) return;
      setPhase('pdf');
      const file = await exportFormalPdf(request, preview, operation.signal);
      if (operation.valid()) {
        setPrepared({ scope, request, preview, file });
        if (tab !== 'preview') void navigate({ params: { sid, module: 'report', tab: 'preview' },
          search: previous => ({ ...previous, generate: false }) });
      }
    } catch (problem) {
      if (operation.valid()) {
        setError(asError(problem));
        const field = problem instanceof ApiError ? text(optionalRecord(problem.detail).field) : '';
        const input = field && form.current?.elements.namedItem(field);
        if (input instanceof HTMLInputElement) input.focus();
      }
    } finally { if (operation.valid()) setPhase('idle'); }
  }
  async function download() {
    if (!ready || !previewUrl || busy) return;
    const operation = start();
    setError(undefined); setPhase('download');
    try {
      // Recheck current source identity, then download the exact bytes already shown.
      // Do not assume separate PDF renders have identical binary metadata.
      const checked = await previewFormalCalculation(ready.request, sid, operation.signal);
      if (checked.model_digest !== ready.preview.model_digest || checked.source_digest !== ready.preview.source_digest)
        throw new ApiError(409, '预览后的来源或文件模型已变化，请重新预览计算书。');
      if (operation.valid()) downloadBlob(ready.file.blob, ready.file.filename);
    } catch (problem) {
      if (operation.valid()) { setPrepared(undefined); setError(asError(problem)); }
    } finally { if (operation.valid()) setPhase('idle'); }
  }

  if (!run) return <EmptyState art="report" title="尚无可交付运行"
    description="计算书只引用已经保存的完整运行。先在计算模块运行，再回来填写文件信息。"
    action={<Button variant="primary" onClick={onReturnToCalculation}>返回{calculationLabel}</Button>} />;

  return <div className="report-module">
    <div className="report-toolbar">
      <StatusMark kind={busy ? 'running' : ready ? 'saved' : run.freshness === 'historical' ? 'historical' : 'saved'}
        label={phase === 'preview' ? '核对正式文件来源' : phase === 'pdf' ? '生成 PDF 预览'
          : phase === 'download' ? '重新核对下载来源' : ready ? '正式 PDF 已核对'
            : run.freshness === 'historical' ? '历史保存运行' : '所选保存运行'} />
      <span>{savedRunLabel(full.data || run)}</span>
      <div className="spacer" />
      <FormalExport kind="calculation" alternativeKinds={formalRating ? ['rating_table', 'research_report'] : ['research_report']}
        source={formalSource} triggerLabel="其他交付格式"
        disabledReason={sourceError ? message(sourceError) : sourcePending ? '正在读取完整保存来源' : undefined} />
      <Button type="button" size="compact" onClick={() => void download()}
        title={!ready ? '先预览并核对正式 PDF' : busy ? '等待当前读取完成' : undefined}
        disabled={!ready || !previewUrl || busy || !!sourceError} loading={phase === 'download'}>下载 PDF</Button>
    </div>
    <form ref={form} className="input-module" aria-label="正式计算书文件信息" noValidate
      onSubmit={event => { event.preventDefault(); void prepare(); }}>
      <section className="input-section" aria-label="文件信息">
        <h2>文件信息</h2>
        <div className="formal-export-fields">
          {fields.map(field => <div className="input-section" key={field.key}>
            <Label htmlFor={'formal-document-' + field.key}>{field.label}</Label>
            <Input id={'formal-document-' + field.key} name={field.key}
              type={'type' in field ? field.type : 'text'}
              required={'required' in field && field.required}
              maxLength={'limit' in field ? field.limit : undefined}
              autoComplete="off" value={document[field.key]}
              aria-invalid={invalidField === field.key || undefined}
              onChange={event => update(field.key, event.target.value)} />
          </div>)}
        </div>
      </section>
      <p className="muted">签发日期可留空。设计、校核、审核、批准只采用已有真实签核记录，没有记录时留空。</p>
      {full.data && <p role="status">本文件包含保存运行的全部 {origin.count} 个工况{origin.selection ? '，不只当前候选' : ''}。
        {origin.label && <> 当前查看：{origin.label}。</>}</p>}
      {dirty && <p className="muted">当前修改尚未保存；本文件只包含所选保存运行，草稿保留。</p>}
      <div className="report-toolbar">
        <Button type="submit" variant="primary" loading={phase === 'preview' || phase === 'pdf'}
          title={sourcePending ? '正在读取完整保存来源' : sourceError ? '先处理下方来源错误' : busy ? '等待当前文件处理完成' : undefined}
          disabled={busy || !full.data || sourcePending || !!sourceError}>预览计算书</Button>
        <span className="muted">文件直接下载，完整来源随文件保存。</span>
      </div>
    </form>
    {visibleError && <StudyErrorState title="正式计算书不可用" description={message(visibleError)}
      action={invalidField ? undefined : <Button type="button" disabled={busy} onClick={refreshSource}>重新读取来源</Button>} />}
    {full.isPending || workspace.isPending ? <LoadingState title="正在读取完整保存运行与当前工程修订" />
      : phase === 'preview' || phase === 'pdf' ? <LoadingState title={phase === 'preview' ? '正在核对文件信息与完整来源' : '正在生成实际 PDF 预览'} />
      : tab === 'sources' ? <dl className="report-sources">
        <div><dt>源运行</dt><dd>{savedRunLabel(full.data || run)}</dd></div>
        <div><dt>运行 ID</dt><dd className="cell-wrap">{rid}</dd></div>
        <div><dt>工程修订</dt><dd>{typeof revision === 'number' ? revision : '尚未读取'}</dd></div>
        <div><dt>完整输入摘要</dt><dd className="cell-wrap">{text(full.data?.input_digest) || '尚未读取'}</dd></div>
        <div><dt>完整输出摘要</dt><dd className="cell-wrap">{text(full.data?.output_digest) || '尚未读取'}</dd></div>
        {ready && <>
          <div><dt>来源集合摘要</dt><dd className="cell-wrap">{ready.file.sourceDigest}</dd></div>
          <div><dt>文件模型摘要</dt><dd className="cell-wrap">{ready.file.modelDigest}</dd></div>
          <div><dt>PDF 文件摘要</dt><dd className="cell-wrap">{ready.file.artifactDigest}</dd></div>
        </>}
      </dl> : tab === 'content' ? <section className="report-sources" aria-label="正式计算书内容">
        <h2>保存运行计算书</h2>
        {ready ? <ol>{(Array.isArray(ready.preview.sections) ? ready.preview.sections : []).map(optionalRecord)
          .map((section, index) => <li key={text(section.id) || index}>{text(section.heading)}</li>)}</ol>
          : <p>填写真实文件信息并预览后，这里显示本次正式文件的实际章节。</p>}
        <p>正式文件只采用完整保存来源；签栏与原有状态按来源保留。</p>
      </section> : previewUrl ? <>
        {optionalRecord(ready?.preview.state).purpose === 'demo' && <p className="muted">文件按保存来源标为演示用途。</p>}
        <iframe className="report-frame" title="计算书预览" src={previewUrl} />
      </> : ready ? <LoadingState title="正在打开 PDF 预览" />
        : !visibleError && <EmptyState title="尚未预览正式计算书" description="填写单位名称、文件编号与版次，再预览所选保存运行。" />}
  </div>;
}
