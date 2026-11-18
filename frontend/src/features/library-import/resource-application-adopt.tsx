import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { message } from '@/api/client';
import { studyContextQuery } from '@/lib/study-queries';
import { DataTable } from '@/components/data-table';
import { ErrorState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { LibraryDialog } from './dialog';
import { displayLibraryText } from './api';
import { referencePost } from './reference-api';
import { ApplicationWorkspacePicker } from './resource-application-capture';
import { ApplicationChanges, ApplicationFields } from './resource-application-evidence';
import {
  applicationDownload, applicationPrefix, applicationSnapshot, componentChoices,
  type ApplicationAsset, type ApplicationEvidence, type ApplicationKind, type ApplicationSnapshot, type ApplicationWorkspace,
  type ApplicationTargetPreview, type ComponentTargetRequest, type StudyAdoption, type StudyTargetRequest,
} from './resource-application-api';

type AdoptionPreview = {
  request: ComponentTargetRequest | StudyTargetRequest; response: ApplicationTargetPreview;
  intent: string; generation: number;
};

export function ApplicationAdoption({ asset, evidence }: { asset: ApplicationAsset; evidence: ApplicationEvidence }) {
  const client = useQueryClient();
  const kind = evidence.kind;
  const [workspaceId, setWorkspaceId] = useState('');
  const [selectionKey, setSelectionKey] = useState('');
  const [materialMode, setMaterialMode] = useState('');
  const [materialId, setMaterialId] = useState('');
  const [title, setTitle] = useState('');
  const [confirmedBindings, setConfirmedBindings] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ workspaceId: string; revision: number; studyId?: string; intent: string; generation: number } | null>(null);
  const [preview, setPreview] = useState<AdoptionPreview | null>(null);
  const generation = useRef(0), mounted = useRef(false);
  const intent = JSON.stringify([asset.id, asset.content_sha256, kind, workspaceId, selectionKey, materialMode, materialId, title, confirmedBindings]);
  const currentIntent = useRef(intent); currentIntent.current = intent;
  const noticeElement = useRef<HTMLDivElement>(null);
  const previewTrigger = useRef<HTMLButtonElement | null>(null);
  const focusResultAfterClose = useRef<{ intent: string; generation: number } | null>(null);
  const visibleNotice = notice?.intent === intent && notice.generation === generation.current ? notice : null;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current++; };
  }, []);
  const snapshot = useQuery({ queryKey: ['resource-application-snapshot', workspaceId], enabled: !!workspaceId,
    queryFn: ({ signal }) => applicationSnapshot(workspaceId, signal) });
  const document = snapshot.data?.domain;
  const choices = document ? componentChoices(document, evidence.selection?.part) : [];
  const selection = choices.find(item => item.value === selectionKey)?.selection;
  const existingMaterial = document?.materials.find(item => item.id === materialId);
  const bindingRows = evidence.bindings ? (['cable_type_ids', 'circuit_ids', 'cable_ids'] as const).flatMap(category => evidence.bindings![category].map((id, index) => {
    const frozen = evidence.source.snapshot.domain;
    const original = category === 'cable_type_ids' ? frozen.cable_types.find(item => item.id === id)
      : category === 'circuit_ids' ? frozen.circuits.find(item => item.id === id)
        : frozen.circuits.flatMap(item => item.cables.map(cable => ({ ...cable, label: `${item.label} · ${cable.phase} 相` }))).find(item => item.id === id);
    const target = category === 'cable_type_ids' ? document?.cable_types.find(item => item.id === id)
      : category === 'circuit_ids' ? document?.circuits.find(item => item.id === id)
        : document?.circuits.flatMap(item => item.cables.map(cable => ({ ...cable, label: `${item.label} · ${cable.phase} 相` }))).find(item => item.id === id);
    return { id: `${category}-${index}`, category, sourceId: id, index, found: !!target,
      sourceLabel: `${category === 'cable_type_ids' ? '型号' : category === 'circuit_ids' ? '回路' : '电缆'} ${index + 1}${original && 'label' in original ? `：${original.label}` : ''}`,
      targetLabel: target && 'label' in target ? target.label : '目标输入中没有相同固定身份' };
  })) : [];
  const bindingsReady = bindingRows.length > 0 && bindingRows.every(row => row.found && confirmedBindings[row.id] === true);
  const sourceReady = !!snapshot.data && !snapshot.error && !snapshot.isFetching;
  const materialReady = materialMode === 'new' ? /^material\/[A-Za-z0-9_-]+$/.test(materialId) && !existingMaterial : materialMode === 'reuse' && !!existingMaterial;
  const ready = sourceReady && (kind === 'component' ? !!selection && materialReady : !!title.trim() && bindingsReady);
  const createdMaterial = !!visibleNotice && !visibleNotice.studyId && materialMode === 'new'
    && !!existingMaterial && snapshot.data?.revision === visibleNotice.revision;
  useEffect(() => { setPreview(null); }, [workspaceId, snapshot.data?.revision, selectionKey, materialId, materialMode, title, confirmedBindings]);
  useEffect(() => { reset(); }, [asset.id, asset.content_sha256, kind]);
  function reset() {
    generation.current++; focusResultAfterClose.current = null;
    setPreview(null); setNotice(null); setError(''); setBusy(false);
  }
  function current(operation: { intent: string; generation: number }) {
    return mounted.current && currentIntent.current === operation.intent && generation.current === operation.generation;
  }
  function changeWorkspace(value: string) {
    reset(); setWorkspaceId(value); setSelectionKey(''); setMaterialMode(''); setMaterialId(''); setConfirmedBindings({});
  }
  async function readPreview(trigger: HTMLButtonElement) {
    if (!ready || !snapshot.data) return;
    reset(); previewTrigger.current = trigger;
    const operation = { intent, generation: generation.current };
    setBusy(true);
    try {
      const common = { resource_id: asset.id, content_sha256: asset.content_sha256, workspace_id: workspaceId, expected_revision: snapshot.data.revision };
      const request = kind === 'component' ? { ...common, target: selection!, target_material_id: materialId }
        : { ...common, title: title.trim(), bindings: evidence.bindings! };
      const response = await referencePost<ApplicationTargetPreview>(applicationPrefix(kind) + '/preview', request);
      if (current(operation)) setPreview({ request, response, ...operation });
    } catch (cause) { if (current(operation)) setError(message(cause)); }
    finally { if (current(operation)) setBusy(false); }
  }
  async function adopted(result: ApplicationSnapshot | StudyAdoption, operation: AdoptionPreview) {
    if (!current(operation)) return;
    const resultWorkspaceId = 'study' in result ? result.workspace_id : result.id;
    if (resultWorkspaceId !== operation.request.workspace_id) throw new Error('采用回执的目标与本次确认不一致。');
    const saved = await applicationSnapshot(resultWorkspaceId);
    if (!current(operation)) return;
    if (saved.id !== resultWorkspaceId || saved.revision !== result.revision)
      throw new Error('目标输入修订已变化，不能把本次回读当作刚才的采用结果。请关闭后重新读取目标。');
    const snapshotKey = ['resource-application-snapshot', resultWorkspaceId];
    const beforeCancel = client.getQueryData<ApplicationSnapshot>(snapshotKey);
    // Cancel only this target's older fetch before publishing the verified readback.
    // Revert preserves newer manual cache writes and returns the query to idle.
    await client.cancelQueries({ queryKey: snapshotKey, exact: true }, { revert: true });
    if (!current(operation)) return;
    const latest = client.getQueryData<ApplicationSnapshot>(snapshotKey);
    if ((beforeCancel && beforeCancel.revision > saved.revision) || (latest && latest.revision > saved.revision))
      throw new Error('目标已有更新的输入修订，不能把这份较早回读作为当前结果。请关闭后重新读取目标。');
    const studyId = 'study' in result ? result.study.id : undefined;
    client.setQueryData(snapshotKey, saved);
    client.setQueryData<ApplicationWorkspace[]>(['resource-application-workspaces', kind], items => items?.map(item =>
      item.id === saved.id ? { ...item, revision: saved.revision, updated_at: saved.updated_at } : item));
    focusResultAfterClose.current = { intent: operation.intent, generation: operation.generation };
    setNotice({ workspaceId: saved.id, revision: saved.revision, studyId, intent: operation.intent, generation: operation.generation }); setPreview(null);
    void client.invalidateQueries({ queryKey: ['resource-application-workspaces'] });
    void client.invalidateQueries({ queryKey: ['resource-application-studies', resultWorkspaceId] });
    void client.invalidateQueries({ queryKey: ['type-workspace', resultWorkspaceId] });
    void client.invalidateQueries({ queryKey: ['type-library'] });
  }
  function closeAutoFocus(event: Event) {
    const result = focusResultAfterClose.current, trigger = previewTrigger.current;
    if (!result && !trigger?.isConnected) return;
    focusResultAfterClose.current = null;
    event.preventDefault();
    requestAnimationFrame(() => {
      if (result) {
        const element = noticeElement.current;
        if (!current(result) || !element?.isConnected) return;
        element.focus({ preventScroll: true }); element.scrollIntoView({ block: 'center' });
      } else if (trigger?.isConnected && !trigger.disabled) trigger.focus({ preventScroll: true });
    });
  }
  return <section className="reference-section library-import-stack" aria-label="将固定参考采用到保存输入">
    <h2>{kind === 'component' ? '选择一个目标结构位置' : '采用为新的保存研究'}</h2>
    <p>{kind === 'component' ? '先明确目标槽位与材料处理方式，再逐字段核对前后值、清空项和来源。采用后可在原型号界面撤销。' : '逐项确认固定型号、回路和电缆身份。采用只创建研究定义，保留明确工况；计算需要在研究页面另行人工发起。'}</p>
    <ApplicationWorkspacePicker kind={kind} label={kind === 'component' ? '采用目标型号' : '采用目标工程'} value={workspaceId} disabled={busy} onChange={changeWorkspace} />
    {snapshot.error && <ErrorState description={message(snapshot.error)} action={<Button onClick={() => void snapshot.refetch()}>重新读取目标输入</Button>} />}
    {workspaceId && kind === 'component' && <div className="library-import-stack">
      <Select label="目标部件位置" value={selectionKey} loading={snapshot.isPending} disabled={busy || !!snapshot.error}
        options={[{ value: '', label: '请选择明确的目标槽位' }, ...choices]} onChange={value => { reset(); setSelectionKey(value); }} />
      <div className="library-import-fields library-import-fields-pair">
        <Select label="目标材料处理方式" value={materialMode} disabled={busy || !document} onChange={value => { reset(); setMaterialMode(value); setMaterialId(''); }}
          options={[{ value: '', label: '请明确材料处理方式' }, { value: 'new', label: '新建独立材料条目' }, { value: 'reuse', label: '复用内容完全相同的材料' }]} />
        {materialMode === 'new' && <label className="text-field">目标材料新标识<Input aria-label="目标材料新标识" placeholder="material/copper-reference" value={materialId} disabled={busy} onChange={event => { reset(); setMaterialId(event.target.value); }} /></label>}
        {materialMode === 'reuse' && <Select label="复用目标材料" value={materialId} disabled={busy} options={[{ value: '', label: '请选择已存在材料' }, ...(document?.materials ?? []).map(item => ({ value: item.id, label: item.label }))]} onChange={value => { reset(); setMaterialId(value); }} />}
      </div>
      {materialMode === 'new' && existingMaterial && <p role="status">{createdMaterial
        ? `此独立材料已在本次采用中创建，并已回读输入修订 ${visibleNotice!.revision}。再次采用仍需选择其他独立标识或明确复用。`
        : '此材料标识已存在。请另取独立标识，或明确选择复用并核对全部材料内容。'}</p>}
      {materialMode === 'reuse' && <p className="muted">仅允许复用全部物性相同的材料。复用保留目标材料原出处，捕获来源继续作为独立参考保存。</p>}
    </div>}
    {workspaceId && kind === 'study_template' && <>
      <label className="text-field">新研究名称<Input aria-label="采用后研究名称" value={title} disabled={busy} onChange={event => { reset(); setTitle(event.target.value); }} maxLength={120} /></label>
      <DataTable label="研究固定对象逐项映射" showGroups={false} groups={[{ id: 'bindings', label: '对象身份', rows: bindingRows }]} rowLabel={row => `${row.sourceLabel}，${row.targetLabel}`} columns={[
        { id: 'source', label: '来源对象', wrap: true, render: row => row.sourceLabel },
        { id: 'target', label: '目标中的同一固定身份', wrap: true, render: row => row.targetLabel },
        { id: 'confirm', label: '逐项确认', render: row => <Checkbox aria-label={`确认固定对象 ${row.sourceLabel}`} checked={confirmedBindings[row.id] === true} disabled={busy || !row.found} onCheckedChange={value => { reset(); setConfirmedBindings(previous => ({ ...previous, [row.id]: value === true })); }} /> },
      ]} />
      <p className="muted">对象身份必须完整一致；不会按名称猜测映射。服务端还会核对结构、材料、固定方法和目标预检。</p>
    </>}
    {error && <p role="alert" className="library-import-error">{error}</p>}
    <div className="library-import-actions"><Button variant="primary" disabled={!ready} loading={busy} onClick={event => void readPreview(event.currentTarget)}>预览目标采用变化</Button></div>
    {visibleNotice && <div ref={noticeElement} className="library-import-stack" role="status" aria-label="采用结果回执" tabIndex={-1}>
      <p>{visibleNotice.studyId ? `已创建保存研究，工程输入仍为修订 ${visibleNotice.revision}；没有启动计算。` : `已采用到型号输入修订 ${visibleNotice.revision}，固定来源与逐字段变化已保存。`}</p>
      {visibleNotice.studyId ? <OpenSavedStudy key={`${visibleNotice.workspaceId}:${visibleNotice.revision}:${visibleNotice.studyId}`} workspaceId={visibleNotice.workspaceId} studyId={visibleNotice.studyId} />
        : <div><Button asChild><a href={`/types/${encodeURIComponent(visibleNotice.workspaceId)}/structure/section`}>打开目标型号并核对或撤销</a></Button></div>}
    </div>}
    {preview && <AdoptionConfirmation key={preview.response.preview_digest} kind={kind} value={preview} onClose={() => setPreview(null)}
      onCloseAutoFocus={closeAutoFocus} onDone={result => adopted(result, preview)} />}
  </section>;
}

function OpenSavedStudy({ workspaceId, studyId }: { workspaceId: string; studyId: string }) {
  const client = useQueryClient(), navigate = useNavigate();
  const [opening, setOpening] = useState(false), [error, setError] = useState('');
  const mounted = useRef(false), pending = useRef(false), generation = useRef(0);
  // This control is keyed by the adoption notice. A changed target or an
  // unmounted page must not navigate when an earlier read eventually finishes.
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current++; };
  }, []);
  async function open() {
    if (pending.current) return;
    pending.current = true;
    const request = ++generation.current;
    const current = () => mounted.current && generation.current === request;
    setOpening(true); setError('');
    try {
      // Finish the existing, complete context query before mounting its
      // consumers. SPA navigation keeps the same verified query cache.
      const context = await client.fetchQuery(studyContextQuery(client, workspaceId, studyId));
      if (!current()) return;
      if (!context.some(study => study.id === studyId && study.workspace === workspaceId))
        throw new Error('保存研究与目标工程不一致，请重新读取。');
      await navigate({ to: '/studies/$sid', params: { sid: studyId },
        search: previous => ({ theme: previous.theme === 'dark' ? 'dark' : 'light', workspace: workspaceId, run: '', delivery: '' }) });
    } catch (cause) {
      if (current()) setError(`无法打开保存研究：${message(cause)} 请重试打开。`);
    } finally {
      if (current()) { pending.current = false; setOpening(false); }
    }
  }
  return <div className="library-import-stack">
    <div><Button disabled={opening} loading={opening} onClick={() => void open()}>打开新保存研究</Button></div>
    {error && <p role="alert" className="library-import-error">{error}</p>}
  </div>;
}

function AdoptionConfirmation({ kind, value, onClose, onCloseAutoFocus, onDone }: {
  kind: ApplicationKind; value: { request: ComponentTargetRequest | StudyTargetRequest; response: ApplicationTargetPreview };
  onClose: () => void; onCloseAutoFocus: (event: Event) => void; onDone: (result: ApplicationSnapshot | StudyAdoption) => Promise<void>;
}) {
  const [confirmed, setConfirmed] = useState(false), [limits, setLimits] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const requestId = useRef(crypto.randomUUID());
  const savedResult = useRef<ApplicationSnapshot | StudyAdoption | null>(null);
  const pending = useRef(false);
  async function adopt() {
    if (!confirmed || !limits || busy || pending.current) return;
    pending.current = true;
    setBusy(true); setError('');
    try {
      const result = savedResult.current ?? await referencePost<ApplicationSnapshot | StudyAdoption>(applicationPrefix(kind) + '/adopt', {
        ...value.request, request_id: requestId.current, preview_digest: value.response.preview_digest,
        human_confirmed: true, acknowledge_reference_limits: true,
      });
      savedResult.current = result;
      await onDone(result);
    } catch (cause) { setError(`${savedResult.current ? '采用已保存，但结果回读未完成。重新读取不会再次提交采用。' : ''}${message(cause)}`); }
    finally { pending.current = false; setBusy(false); }
  }
  return <LibraryDialog open onOpenChange={open => { if (!open && !busy) onClose(); }} title={kind === 'component' ? '核对部件采用变化' : '核对新研究的固定定义'} busy={busy}
    onCloseAutoFocus={onCloseAutoFocus}
    description={`目标输入修订 ${value.request.expected_revision}；参考分档和适用限制随本次采用保存。`}
    actions={<Button variant="primary" disabled={!confirmed || !limits} loading={busy} onClick={() => void adopt()}>{savedResult.current ? '重新读取已保存结果' : kind === 'component' ? '人工确认采用该部件' : '人工确认创建保存研究'}</Button>}>
    <div className="library-import-stack">
      {kind === 'component' ? <>
        <p>{value.response.material_action === 'reuse_identical' ? '复用内容完全相同的材料，目标材料原出处保持不变。' : '建立明确命名的独立材料条目，不覆盖已有共用材料。'}</p>
        <ApplicationChanges changes={value.response.changes ?? []} />
      </> : <>
        <p>{value.response.source_run_status === 'verified_local_run' ? '来源成功运行已在本库核验。目标新研究尚未运行。' : '原运行不在本库，只作为外部声明的输入参考；本库没有独立核验原成功历史。'}</p>
        <ApplicationFields fields={value.response.fields} label="新研究固定参数与出处" />
      </>}
      <ul className="reference-limitations">{value.response.limitations.map((item, index) => <li key={index}>{displayLibraryText(item)}</li>)}</ul>
      <Button onClick={() => applicationDownload('resource-application-preview.json', { request: value.request, response: value.response })}>下载完整目标预览与来源</Button>
      <label className="library-import-confirm"><Checkbox checked={confirmed} disabled={busy} onCheckedChange={value => setConfirmed(value === true)} />我已核对明确目标、完整变化和固定来源，确认本次写入。</label>
      <label className="library-import-confirm"><Checkbox checked={limits} disabled={busy} onCheckedChange={value => setLimits(value === true)} />我理解这些内容仍为参考，缺项不补值，此操作不授予工程批准。</label>
      {error && <p role="alert" className="library-import-error">{error}</p>}
    </div>
  </LibraryDialog>;
}
