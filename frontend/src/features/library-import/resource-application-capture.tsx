import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { message } from '@/api/client';
import { ErrorState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { formatDateTime } from '@/lib/format';
import { LibraryDialog } from './dialog';
import { methodText } from './api';
import { referencePost, referenceRequest } from './reference-api';
import { ApplicationFrozenEvidence } from './resource-application-evidence';
import {
  applicationPrefix, applicationProjects, applicationSnapshot, applicationTypes, applicationWorkspaceOptions, componentChoices,
  type ApplicationAsset, type ApplicationCapturePreview, type ApplicationKind, type ApplicationRunPage,
  type ApplicationStudy, type ComponentCaptureRequest, type StudyCaptureRequest,
} from './resource-application-api';

export function ApplicationWorkspacePicker({ kind, label, value, onChange, disabled = false }: {
  kind: ApplicationKind; label: string; value: string; onChange: (value: string) => void; disabled?: boolean;
}) {
  const query = useQuery({ queryKey: ['resource-application-workspaces', kind],
    queryFn: ({ signal }) => kind === 'component' ? applicationTypes(signal) : applicationProjects(signal) });
  return <div className="library-import-stack">
    <Select label={label} value={value} disabled={disabled || !!query.error} loading={query.isPending}
      options={[{ value: '', label: kind === 'component' ? '请选择已保存型号' : '请选择已保存工程' }, ...applicationWorkspaceOptions(query.data ?? [])]}
      onChange={onChange} />
    {query.error && <ErrorState description={message(query.error)} action={<Button disabled={disabled} onClick={() => void query.refetch()}>重新读取{kind === 'component' ? '型号' : '工程'}目录</Button>} />}
  </div>;
}

export function ApplicationCapture({ onCreated }: { onCreated: (asset: ApplicationAsset) => void }) {
  const [kind, setKind] = useState<ApplicationKind>('component');
  const [workspaceId, setWorkspaceId] = useState('');
  const [selectionKey, setSelectionKey] = useState('');
  const [studyId, setStudyId] = useState('');
  const [runId, setRunId] = useState('');
  const [cursors, setCursors] = useState([0]);
  const [name, setName] = useState('');
  const [assetId, setAssetId] = useState('');
  const [version, setVersion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<{ request: ComponentCaptureRequest | StudyCaptureRequest; response: ApplicationCapturePreview } | null>(null);
  const snapshot = useQuery({ queryKey: ['resource-application-snapshot', workspaceId], enabled: !!workspaceId,
    queryFn: ({ signal }) => applicationSnapshot(workspaceId, signal) });
  const studies = useQuery({ queryKey: ['resource-application-studies', workspaceId], enabled: kind === 'study_template' && !!workspaceId,
    queryFn: ({ signal }) => referenceRequest<ApplicationStudy[]>(`/api/workspaces/${encodeURIComponent(workspaceId)}/studies`, { signal }) });
  const cursor = cursors[cursors.length - 1];
  const runs = useQuery({ queryKey: ['resource-application-runs', workspaceId, studyId, cursor], enabled: kind === 'study_template' && !!workspaceId && !!studyId,
    queryFn: ({ signal }) => referenceRequest<ApplicationRunPage>(`/api/workspaces/${encodeURIComponent(workspaceId)}/studies/${encodeURIComponent(studyId)}/runs?view=summary&after=${cursor}&limit=20`, { signal }) });
  const choices = snapshot.data ? componentChoices(snapshot.data.domain) : [];
  const selection = choices.find(item => item.value === selectionKey)?.selection;
  const study = studies.data?.find(item => item.id === studyId);
  const run = runs.data?.items.find(item => item.id === runId);
  const runEligible = !!run && run.status === 'succeeded' && run.integrity === 'verified' && run.freshness === 'current' && (run.snapshot.module ?? null) === null;
  const sourceReady = !!snapshot.data && !snapshot.error && !snapshot.isFetching
    && (kind === 'component' ? !!selection : !!study && !studies.error && !runs.error && !runs.isFetching && runEligible);
  const ready = sourceReady && !!name.trim() && /^[a-z][a-z0-9.-]*\/[A-Za-z0-9_.-]+$/.test(assetId.trim()) && /^\d+\.\d+\.\d+$/.test(version.trim());
  function resetSelection() { setSelectionKey(''); setStudyId(''); setRunId(''); setCursors([0]); setPreview(null); setError(''); }
  useEffect(() => { setPreview(null); }, [snapshot.data?.revision, kind, name, assetId, version, selectionKey, studyId, runId]);
  async function readPreview() {
    if (!ready || !snapshot.data) return;
    setBusy(true); setError('');
    try {
      const common = { asset_id: assetId.trim(), version: version.trim(), name: name.trim(), workspace_id: workspaceId, expected_revision: snapshot.data.revision };
      const request = kind === 'component'
        ? { ...common, selection: selection! }
        : { ...common, study_id: study!.id, expected_study_revision: study!.revision, source_run_id: run!.id };
      const response = await referencePost<ApplicationCapturePreview>(applicationPrefix(kind) + '/capture-preview', request);
      setPreview({ request, response });
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  return <section className="library-import-stack" aria-label="从保存输入创建部件或研究模板">
    <h2>从保存输入创建参考草稿</h2>
    <p>选择实际保存的结构或成功研究运行。预览逐项来源、方法版本和缺项，再人工保存为参考草稿。</p>
    <div className="library-import-fields library-import-fields-pair">
      <Select label="捕获资料类别" value={kind} disabled={busy} onChange={value => { setKind(value as ApplicationKind); setWorkspaceId(''); resetSelection(); }}
        options={[{ value: 'component', label: '单个结构部件' }, { value: 'study_template', label: '保存研究模板' }]} />
      <ApplicationWorkspacePicker kind={kind} label={kind === 'component' ? '来源型号' : '来源工程'} value={workspaceId} disabled={busy}
        onChange={value => { setWorkspaceId(value); resetSelection(); }} />
    </div>
    {snapshot.error && <ErrorState description={message(snapshot.error)} action={<Button onClick={() => void snapshot.refetch()}>重新读取来源输入</Button>} />}
    {kind === 'component' && workspaceId && <Select label="来源部件" value={selectionKey} loading={snapshot.isPending} disabled={busy || !!snapshot.error}
      options={[{ value: '', label: '明确选择一个导体、芯层或公共层' }, ...choices]} onChange={setSelectionKey} />}
    {kind === 'study_template' && workspaceId && <div className="library-import-stack">
      <p className="muted">当前支持 IEC 60287 稳态载流量的工程输入、单工况研究。缺少显式定义、固定方法或当前成功运行时，不能创建可采用模板。</p>
      <Select label="来源保存研究" value={studyId} loading={studies.isPending} disabled={busy || !!studies.error}
        options={[{ value: '', label: '请选择已保存研究' }, ...(studies.data ?? []).map(item => {
          const same = (studies.data ?? []).filter(other => other.definition.title === item.definition.title && other.revision === item.revision);
          const distinction = same.length > 1 ? ` · ${item.created} · 同名条目 ${same.findIndex(other => other.id === item.id) + 1}` : '';
          return { value: item.id, label: `${item.definition.title} · 研究修订 ${item.revision} · ${methodText(item.definition.method)}${distinction}` };
        })]}
        onChange={value => { setStudyId(value); setRunId(''); setCursors([0]); setPreview(null); }} />
      {studies.error && <ErrorState description={message(studies.error)} action={<Button onClick={() => void studies.refetch()}>重新读取保存研究</Button>} />}
      {studyId && <>
        <Select label="来源成功运行" value={runId} loading={runs.isPending} disabled={busy || !!runs.error}
          options={[{ value: '', label: '明确选择当前输入的成功运行' }, ...(runs.data?.items ?? []).map(item => ({ value: item.id,
            label: `第 ${item.sequence} 次 · ${formatDateTime(item.created)} · ${item.status === 'succeeded' ? '计算成功' : '未成功完成'} · ${item.freshness === 'current' ? '当前输入' : '历史或未确认输入'}${item.integrity === 'verified' ? '' : ' · 完整性不可用'}`,
            disabled: item.status !== 'succeeded' || item.integrity !== 'verified' || item.freshness !== 'current' || (item.snapshot.module ?? null) !== null }))]}
          onChange={setRunId} />
        <div className="reference-navigation">
          <Button disabled={busy || cursors.length === 1 || runs.isFetching} onClick={() => { setCursors(previous => previous.slice(0, -1)); setRunId(''); }}>较早运行</Button>
          <Button disabled={busy || !runs.data?.next_cursor || runs.isFetching} onClick={() => { setCursors(previous => [...previous, runs.data!.next_cursor!]); setRunId(''); }}>较新运行</Button>
        </div>
        {runs.error && <ErrorState description={message(runs.error)} action={<Button onClick={() => void runs.refetch()}>重新读取保存运行</Button>} />}
      </>}
    </div>}
    <div className="library-import-fields">
      <label className="text-field">资料名称<Input aria-label="部件或模板名称" value={name} disabled={busy} onChange={event => setName(event.target.value)} maxLength={128} /></label>
      <label className="text-field">资料标识<Input aria-label="部件或模板资料标识" placeholder="component/copper-core" value={assetId} disabled={busy} onChange={event => setAssetId(event.target.value)} /></label>
      <label className="text-field">资料版本<Input aria-label="部件或模板资料版本" placeholder="1.0.0" value={version} disabled={busy} onChange={event => setVersion(event.target.value)} /></label>
    </div>
    <p className="muted">资料标识采用“分类/名称”，版本采用三个整数。资料名和版本不补全几何、物性或研究条件；结构化出处随原值一起冻结。</p>
    {error && <p role="alert" className="library-import-error">{error}</p>}
    <div className="library-import-actions"><Button variant="primary" disabled={!ready} loading={busy} onClick={() => void readPreview()}>预览固定来源与输入</Button></div>
    {preview && <CaptureConfirmation key={preview.response.preview_digest} kind={kind} value={preview} onClose={() => setPreview(null)} onCreated={onCreated} />}
  </section>;
}

function CaptureConfirmation({ kind, value, onClose, onCreated }: {
  kind: ApplicationKind; value: { request: ComponentCaptureRequest | StudyCaptureRequest; response: ApplicationCapturePreview };
  onClose: () => void; onCreated: (asset: ApplicationAsset) => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    if (!confirmed || busy) return;
    setBusy(true); setError('');
    try { onCreated(await referencePost<ApplicationAsset>(applicationPrefix(kind) + '/capture', {
      ...value.request, preview_digest: value.response.preview_digest, human_confirmed: true,
    })); } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  return <LibraryDialog open onOpenChange={open => { if (!open && !busy) onClose(); }} title="核对固定输入后保存草稿" busy={busy}
    description={`${value.request.name} · ${value.request.version}；保存后仍须逐步核对、发布和明确采用。`}
    actions={<Button variant="primary" disabled={!confirmed} loading={busy} onClick={() => void save()}>人工确认保存参考草稿</Button>}>
    <div className="library-import-stack">
      <ApplicationFrozenEvidence evidence={value.response} />
      <label className="library-import-confirm"><Checkbox checked={confirmed} disabled={busy} onCheckedChange={value => setConfirmed(value === true)} />我已逐项核对固定输入、出处、方法版本和缺项，确认只保存参考草稿。</label>
      {error && <p role="alert" className="library-import-error">{error}</p>}
    </div>
  </LibraryDialog>;
}
