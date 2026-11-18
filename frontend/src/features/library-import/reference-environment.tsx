import { useEffect, useRef, useState, type RefObject } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { message, optionalRecord, text } from '@/api/client';
import { DataTable } from '@/components/data-table';
import { ErrorState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select } from '@/components/ui/select';
import { libraryRequest, type LibrarySpec, type SeriesDetail, type SeriesSummary } from './api';
import { LibraryDialog } from './dialog';
import { emptyRating, RatingForm, ratingReady, ratingRequest, type RatingFormValue } from './rating-form';
import { ConditionFields, conditionName, conditionSummary, conditionsReady, EvidenceTable, quantityText, readConditions, referenceValue } from './reference-evidence';
import { parameterNames, referencePost, type Conditions, type EnvironmentPreview, type EnvironmentPreviewRequest, type ReferenceAsset, type ReferenceEvidence } from './reference-api';

interface SavedEnvironmentRow { name: string; value_a: number | null; reason?: string; environment_references?: EnvironmentPreview }
interface EnvironmentBatch {
  status: string; items: { spec_id: string; name: string; status: string; message?: string; error?: unknown;
    method_name?: string; method_version?: string; workspace_id?: string; rows?: SavedEnvironmentRow[] }[];
}
interface ReadyEnvironmentPreview {
  request: EnvironmentPreviewRequest; response: EnvironmentPreview; seriesId: string; spec: LibrarySpec;
  parameters: ReturnType<typeof ratingRequest>['parameters'];
}
function contextConditions(evidence: ReferenceEvidence[]) {
  const schema: Conditions = {}, conflicts: string[] = [];
  for (const entry of evidence) {
    const selected = { ...entry.selection.conditions };
    delete selected.reference_item;
    if (entry.parameter === 'ambient_temperature_c') selected.temperature_basis = entry.selection.quantity;
    for (const [key, value] of Object.entries(selected)) {
      if (key in schema && JSON.stringify(schema[key]) !== JSON.stringify(value)) conflicts.push(conditionName(key));
      else schema[key] = value;
    }
  }
  return { schema, conflicts };
}

export function EnvironmentReferenceAdoption({ asset }: { asset: ReferenceAsset }) {
  const client = useQueryClient();
  const [seriesId, setSeriesId] = useState('');
  const [specId, setSpecId] = useState('');
  const [selectedParameters, setSelectedParameters] = useState<string[]>([]);
  const [conditions, setConditions] = useState<Record<string, string>>({});
  const [rating, setRating] = useState<RatingFormValue>(() => ({ ...emptyRating(1), layout: '' }));
  const [preview, setPreview] = useState<ReadyEnvironmentPreview | null>(null);
  const [batch, setBatch] = useState<EnvironmentBatch | null>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const focusResultAfterClose = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const seriesList = useQuery({ queryKey: ['type-library', 'series'], queryFn: ({ signal }) => libraryRequest<{ items: SeriesSummary[] }>('/series', { signal }) });
  const series = useQuery({ queryKey: ['type-library', 'series', seriesId], enabled: !!seriesId,
    queryFn: ({ signal }) => libraryRequest<SeriesDetail>(`/series/${encodeURIComponent(seriesId)}`, { signal }) });
  const spec = series.data?.specs.find(item => item.id === specId);
  const cores = series.data?.series.cores;
  const evidence = (asset.release.reference_evidence ?? []).filter(item => selectedParameters.includes(item.parameter));
  const context = contextConditions(evidence);
  useEffect(() => { setPreview(null); }, [seriesId, specId, spec?.workspace_revision, spec?.version]);
  const invalidate = () => { setPreview(null); setBatch(null); setError(''); };
  async function readPreview() {
    if (!spec?.workspace_id || !spec.workspace_revision || !selectedParameters.length) return;
    setBusy(true); setError('');
    try {
      const entered = ratingRequest(rating);
      const request: EnvironmentPreviewRequest = { workspace_id: spec.workspace_id, expected_revision: spec.workspace_revision,
        row: entered.rows[0], resources: evidence.map(item => ({ resource_id: asset.id, content_sha256: asset.content_sha256, parameter: item.parameter })),
        conditions: readConditions(context.schema, conditions) };
      const response = await referencePost<EnvironmentPreview>('/api/library/resources/environment/preview', request);
      setPreview({ request, response, seriesId, spec: structuredClone(spec), parameters: entered.parameters });
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  function executed(value: EnvironmentBatch) {
    focusResultAfterClose.current = true;
    setBatch(value); setPreview(null);
    void client.invalidateQueries({ queryKey: ['type-library', 'series', seriesId] });
  }
  function closeAutoFocus(event: Event) {
    if (!focusResultAfterClose.current) return;
    focusResultAfterClose.current = false;
    event.preventDefault();
    requestAnimationFrame(() => {
      const heading = resultHeading.current;
      if (!heading) return;
      heading.focus({ preventScroll: true });
      heading.scrollIntoView({ block: 'center' });
    });
  }
  return <section className="reference-section library-import-stack" aria-label="环境参考预览与工况采用">
    <h2>环境参考预览与工况采用</h2>
    <p className="muted">选择型号库中的真实规格，填写本次实际条件。此处使用现有单芯、三芯直埋批量计算流程；服务端逐项检查介质、埋深、温度口径和固定版本。</p>
    <div className="library-import-fields library-import-fields-pair">
      <Select label="环境参考目标系列" value={seriesId} disabled={busy} loading={seriesList.isPending}
        options={[{ value: '', label: '请选择已有系列' }, ...(seriesList.data?.items ?? []).map(item => ({ value: item.id, label: item.name }))]}
        onChange={next => { setSeriesId(next); setSpecId(''); setConditions({}); setRating({ ...emptyRating(1), layout: '' }); invalidate(); }} />
      <Select label="环境参考目标规格" value={specId} disabled={!seriesId || busy} loading={!!seriesId && series.isPending}
        options={[{ value: '', label: '请选择当前规格版本' }, ...(series.data?.specs ?? []).filter(item => !!item.workspace_id).map(item => ({ value: item.id, label: `${item.name} · 规格版本 ${item.version} · 输入修订 ${item.workspace_revision ?? '未返回'}` }))]}
        onChange={next => { setSpecId(next); setConditions({}); setRating({ ...emptyRating(cores ?? 1), layout: '' }); invalidate(); }} />
    </div>
    {seriesList.error && <ErrorState description={message(seriesList.error)} action={<Button onClick={() => void seriesList.refetch()}>重新读取系列</Button>} />}
    {series.error && <ErrorState description={message(series.error)} action={<Button onClick={() => void series.refetch()}>重新读取规格</Button>} />}
    <h3>本次拟采用的参考字段</h3>
    {(asset.release.reference_evidence ?? []).map(item => <label className="library-import-confirm" key={item.parameter}>
      <Checkbox aria-label={`环境参考字段 · ${parameterNames[item.parameter] ?? item.parameter}`} checked={selectedParameters.includes(item.parameter)} disabled={busy || item.parameter === 'depth_m'}
        onCheckedChange={checked => { setSelectedParameters(previous => checked === true ? [...previous, item.parameter] : previous.filter(value => value !== item.parameter)); setConditions({}); invalidate(); }} />
      {parameterNames[item.parameter] ?? item.parameter} · {quantityText(item.quantity)} · 参考
      {item.parameter === 'depth_m' && <span>原文没有明确中心埋深测量基准，不能采用到当前工况；请补充可核对的测量依据。</span>}
    </label>)}
    {selectedParameters.length > 0 && <>
      <h3>本次实际适用条件</h3>
      <p className="muted">以下字段须重新按项目明确填写。资料中的选值条件只说明参考范围，不自动证明本项目具备该条件。</p>
      <ConditionFields schema={context.schema} values={conditions} onChange={next => { setConditions(next); invalidate(); }} label="当前工况条件" disabled={busy} fieldNames={{ u_v: '实际运行线电压 U / V' }} />
      {context.conflicts.length > 0 && <p role="alert">所选参考的 {context.conflicts.join('、')} 条件不一致，请调整参考字段，不能合并成一组工况。</p>}
    </>}
    {spec?.workspace_id && <p className="muted">实际交流频率、电压及逐字段来源须先保存在型号中。缺少事实时请先<a className="object-link" href={`/types/${encodeURIComponent(spec.workspace_id)}/structure/section`}>打开型号查看与补充输入</a>，再刷新目标修订；不以额定电压代填运行电压。</p>}
    {spec && cores !== undefined && <fieldset className="reference-rating-fields" disabled={busy}>
      <RatingForm value={rating} cores={cores} onChange={next => { setRating(next); invalidate(); }} />
    </fieldset>}
    {spec && <div className="reference-toolbar"><Button disabled={busy} onClick={() => { invalidate(); void series.refetch(); }}>刷新目标修订</Button>
      <Button variant="primary" loading={busy} disabled={!spec.workspace_revision || !selectedParameters.length || !!context.conflicts.length || !conditionsReady(context.schema, conditions) || !ratingReady(rating)} onClick={() => void readPreview()}>预览环境字段变化</Button></div>}
    {error && <p role="alert">{error}</p>}
    {batch && <EnvironmentBatchResult batch={batch} headingRef={resultHeading} />}
    {preview && <EnvironmentAdoptionDialog key={preview.response.preview_digest} preview={preview} onClose={() => setPreview(null)} onCloseAutoFocus={closeAutoFocus} onDone={executed} />}
  </section>;
}

function EnvironmentAdoptionDialog({ preview, onClose, onCloseAutoFocus, onDone }: { preview: ReadyEnvironmentPreview; onClose: () => void; onCloseAutoFocus: (event: Event) => void; onDone: (batch: EnvironmentBatch) => void }) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(crypto.randomUUID());
  async function execute() {
    setBusy(true); setError('');
    try {
      const spec = preview.spec;
      const response = await referencePost<EnvironmentBatch>(`/api/type-library/series/${encodeURIComponent(preview.seriesId)}/batch`, {
        request_id: requestId.current, operation: 'calculate', spec_ids: [spec.id],
        expected_versions: { [spec.id]: spec.version }, expected_revisions: { [spec.id]: spec.workspace_revision },
        human_confirmed: true, scope_acknowledged: true, parameters: preview.parameters,
        rows: [preview.response.proposed], environment_references: [{ ...preview.request, preview_digest: preview.response.preview_digest, human_confirmed: true }],
      });
      onDone(response);
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  const { response, request } = preview;
  return <LibraryDialog open onOpenChange={open => { if (!open && !busy) onClose(); }} busy={busy} title="核对环境字段并用于本次计算"
    onCloseAutoFocus={onCloseAutoFocus}
    description={`${preview.spec.name} · ${request.row.name}；预览尚未改变工程或保存计算。`}
    actions={<Button variant="primary" disabled={!confirmed} loading={busy} onClick={() => void execute()}>确认采用并计算这一规格</Button>}>
    <div className="library-import-stack">
      <DataTable label="环境字段逐项变化" showGroups={false} groups={[{ id: 'changes', label: '字段变化', rows: response.changes.map(item => ({ ...item, id: item.parameter })) }]}
        columns={[
          { id: 'field', label: '字段', wrap: true, render: row => parameterNames[row.parameter] },
          { id: 'before', label: '原工况值', wrap: true, render: row => `${row.before} ${row.parameter === 'ambient_temperature_c' ? '°C' : row.parameter === 'depth_m' ? 'm' : 'K·m/W'}` },
          { id: 'after', label: '拟采用工况值', wrap: true, render: row => `${row.after} ${row.parameter === 'ambient_temperature_c' ? '°C' : row.parameter === 'depth_m' ? 'm' : 'K·m/W'}` },
          { id: 'si', label: '固定参考 SI 值', wrap: true, render: row => quantityText(row.quantity) },
        ]} rowLabel={row => parameterNames[row.parameter]} />
      <p>实际条件：{conditionSummary(request.conditions)}</p>
      <EvidenceTable evidence={response.changes.map(item => item.reference_evidence)} label="环境字段的固定来源" />
      <details className="library-import-details"><summary>本次工况与方法输入</summary><dl className="reference-facts">
        {Object.entries(response.proposed).filter(([key]) => !['case_id', 'duct_inner_m', 'duct_outer_m', 'duct_rho_k_m_w'].includes(key)).map(([key, value]) => <div key={key}><dt>{({ name: '工况名称', layout: '敷设排列', depth_m: '用户明确的中心埋深 / m', soil_rho_k_m_w: '土壤热阻率 / K·m/W', ambient_temperature_c: '环境温度 / °C', frequency_hz: '频率 / Hz', spacing_m: '中心距 / m', bonding: '金属套接地', rating_basis: '载流量口径', source: '工况来源' } as Record<string, string>)[key] ?? parameterNames[key] ?? key}</dt><dd>{referenceValue(value)}</dd></div>)}
        <div><dt>方法参数来源</dt><dd>{preview.parameters.source}</dd></div>
      </dl></details>
      {response.limitations.map((item, index) => <p key={index} className="muted">{item}</p>)}
      <label className="library-import-confirm"><Checkbox checked={confirmed} disabled={busy} onCheckedChange={value => setConfirmed(value === true)} />我已核对字段变化、实际条件和来源限制，确认将这些参考用于本次载流量计算；不视作现场测量或工程批准。</label>
      {error && <p role="alert">{error}</p>}
    </div>
  </LibraryDialog>;
}

function EnvironmentBatchResult({ batch, headingRef }: { batch: EnvironmentBatch; headingRef: RefObject<HTMLHeadingElement | null> }) {
  return <div className="library-import-stack" aria-label="环境参考计算回执">
    <h3 ref={headingRef} tabIndex={-1}>本次计算回执</h3>
    {batch.items.map(item => <section key={item.spec_id} className="library-import-stack">
      <p role="status">{item.name}：{({ succeeded: '已完成', partial: '部分完成', refused: '拒算', failed: '失败', error: '失败' } as Record<string, string>)[item.status] ?? item.status}。
        {item.message || text(optionalRecord(item.error).message) || (typeof item.error === 'string' ? item.error : '')}</p>
      {item.method_name && <p>计算方法：{item.method_name} · {item.method_version}</p>}
      {item.rows?.map((row, index) => <div key={index} className="library-import-stack">
        <p>{row.name}：{typeof row.value_a === 'number' ? `${row.value_a} A` : '拒算'}{row.reason ? `；${row.reason}` : ''}</p>
        {row.environment_references && <details className="library-import-details"><summary>查看本次保存的环境来源</summary>
          <p>分档：参考。该来源固定在本次运行中；资料的新版本不回写这次计算。</p>
          <EvidenceTable evidence={row.environment_references.changes.map(change => change.reference_evidence)} label="保存运行的环境来源" />
        </details>}
      </div>)}
      {item.workspace_id && <a className="object-link" href={`/types/${encodeURIComponent(item.workspace_id)}/structure/section`}>查看型号与运行</a>}
    </section>)}
  </div>;
}
