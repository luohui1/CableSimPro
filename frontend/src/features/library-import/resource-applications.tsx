import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { message } from '@/api/client';
import { DataTable } from '@/components/data-table';
import { ErrorState, LoadingState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ApplicationCapture } from './resource-application-capture';
import { ApplicationAdoption } from './resource-application-adopt';
import { ApplicationFrozenEvidence } from './resource-application-evidence';
import { type ApplicationAsset, type ApplicationEvidence, type ApplicationKind } from './resource-application-api';
import { assetStatusNames, referencePost, referenceRequest, type AssetSummary } from './reference-api';
import { LibraryDialog } from './dialog';
import { displayLibraryText } from './api';
import './reference-resources.css';

export function ResourceApplications() {
  const client = useQueryClient();
  const [operation, setOperation] = useState('capture');
  const [selected, setSelected] = useState('');
  const [kind, setKind] = useState<ApplicationKind>('component');
  function created(asset: ApplicationAsset) {
    client.setQueryData(['resource-application-asset', asset.id], asset);
    void client.invalidateQueries({ queryKey: ['resource-application-assets'] });
    setKind(asset.kind as ApplicationKind); setSelected(asset.id); setOperation('saved');
  }
  return <div className="library-import-stack reference-resources">
    <div className="library-import-fields library-import-fields-pair"><Select label="部件与模板操作" value={operation} onChange={setOperation}
      options={[{ value: 'capture', label: '从保存输入创建参考草稿' }, { value: 'saved', label: '查看固定版本并采用' }]} /></div>
    {operation === 'capture' ? <ApplicationCapture onCreated={created} /> : <ApplicationList kind={kind} onKindChange={setKind} selected={selected} onSelect={setSelected} />}
  </div>;
}

function ApplicationList({ kind, onKindChange, selected, onSelect }: {
  kind: ApplicationKind; onKindChange: (value: ApplicationKind) => void; selected: string; onSelect: (value: string) => void;
}) {
  const [filter, setFilter] = useState('');
  const [offset, setOffset] = useState(0);
  const assets = useQuery({ queryKey: ['resource-application-assets', kind, filter, offset],
    queryFn: ({ signal }) => referenceRequest<{ items: AssetSummary[]; total: number }>(`/api/foundation/assets?kind=${kind}&limit=20&offset=${offset}&q=${encodeURIComponent(filter)}`, { signal }) });
  if (selected) return <div className="library-import-stack"><div><Button onClick={() => onSelect('')}>返回部件与模板版本列表</Button></div><ApplicationDetail key={selected} id={selected} /></div>;
  return <section className="library-import-stack" aria-label="已保存部件与研究模板">
    <h2>已保存的固定参考版本</h2>
    <div className="library-import-fields library-import-fields-pair">
      <Select label="固定资料类别" value={kind} options={[{ value: 'component', label: '结构部件' }, { value: 'study_template', label: '研究模板' }]}
        onChange={value => { onKindChange(value as ApplicationKind); setOffset(0); }} />
      <label className="text-field">按名称查找固定资料<Input aria-label="按名称查找部件或模板" value={filter} onChange={event => { setFilter(event.target.value); setOffset(0); }} /></label>
    </div>
    {assets.isPending ? <LoadingState title="正在读取部件与模板版本" /> : assets.error ? <ErrorState description={message(assets.error)} action={<Button onClick={() => void assets.refetch()}>重新读取部件与模板版本</Button>} /> : assets.data && <>
      <DataTable label="部件与模板固定版本" showGroups={false} groups={[{ id: 'applications', label: '固定版本', rows: assets.data.items }]} rowLabel={row => `${row.name} ${row.version}`} columns={[
        { id: 'name', label: '资料名称', wrap: true, render: row => row.name },
        { id: 'version', label: '版本', render: row => row.version },
        { id: 'status', label: '状态', wrap: true, render: row => assetStatusNames[row.status] ?? '状态未识别' },
        { id: 'open', label: '查看', render: row => <Button size="compact" onClick={() => onSelect(row.id)}>查看部件或模板固定版本</Button> },
      ]} onActivate={row => onSelect(row.id)} />
      {!assets.data.items.length && <p role="status">没有匹配的固定版本，请先从真实保存输入创建参考草稿。</p>}
      <div className="reference-toolbar"><p className="muted">共 {assets.data.total} 个固定版本</p><div className="reference-navigation">
        <Button disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 20))}>上一页</Button>
        <Button disabled={offset + 20 >= assets.data.total} onClick={() => setOffset(offset + 20)}>下一页</Button>
      </div></div>
    </>}
  </section>;
}

function ApplicationDetail({ id }: { id: string }) {
  const client = useQueryClient();
  const asset = useQuery({ queryKey: ['resource-application-asset', id], queryFn: ({ signal }) => referenceRequest<ApplicationAsset>(`/api/foundation/assets/${encodeURIComponent(id)}`, { signal }) });
  const evidence = useQuery({ queryKey: ['resource-application-evidence', id, asset.data?.content_sha256], enabled: !!asset.data?.release.application,
    queryFn: ({ signal }) => referenceRequest<ApplicationEvidence>(`/api/library/resources/applications/${encodeURIComponent(id)}/evidence`, { signal }) });
  const [transition, setTransition] = useState<'review' | 'publish' | null>(null);
  function updated(value: ApplicationAsset) {
    client.setQueryData(['resource-application-asset', id], value);
    void client.invalidateQueries({ queryKey: ['resource-application-assets'] });
    void client.invalidateQueries({ queryKey: ['resource-application-evidence', id] });
    setTransition(null);
  }
  if (asset.isPending) return <LoadingState title="正在读取部件或模板固定版本" />;
  if (asset.error || !asset.data) return <ErrorState description={message(asset.error)} action={<Button onClick={() => void asset.refetch()}>重新读取固定版本</Button>} />;
  const value = asset.data;
  // A refetch error can leave old data in the query cache. It must not enable a write.
  const canConfirm = !!evidence.data && !evidence.error && !evidence.isFetching && !value.issues.length && !evidence.data.issues?.length;
  return <section className="library-import-stack" aria-label="部件与模板固定来源详情">
    <div className="reference-toolbar"><div><h2>{value.name} · {value.version}</h2><p>{assetStatusNames[value.status] ?? '状态未识别'} · 资料修订 {value.revision}</p></div>
      {value.status === 'draft' && <Button variant="primary" disabled={!canConfirm} onClick={() => setTransition('review')}>核对部件或模板来源</Button>}
      {value.status === 'reviewed' && <Button variant="primary" disabled={!canConfirm} onClick={() => setTransition('publish')}>发布部件或模板参考版本</Button>}
    </div>
    {value.issues.map((issue, index) => <p key={`${issue.code}-${index}`} role="alert">{displayLibraryText(issue.message)}</p>)}
    {!value.release.application ? <p role="status">此旧资料只有摘要，没有完整冻结应用载荷。本页保留它的身份，不推测成可采用的部件或研究定义。</p> : evidence.isPending ? <LoadingState title="正在核对冻结来源证据" /> : <>
      {evidence.error && <ErrorState description={message(evidence.error)} action={<Button onClick={() => void evidence.refetch()}>重新读取冻结来源证据</Button>} />}
      {evidence.data && <>
        <ApplicationFrozenEvidence evidence={evidence.data} />
        {evidence.data.issues?.map((issue, index) => <p key={`${issue.code}-${index}`} role="alert">{displayLibraryText(issue.message)}</p>)}
        <div><Button disabled={evidence.isFetching} onClick={() => void evidence.refetch()}>重新核对固定来源</Button></div>
        {value.status === 'published' && canConfirm && <ApplicationAdoption key={value.content_sha256} asset={value} evidence={evidence.data} />}
      </>}
    </>}
    {transition && canConfirm && evidence.data && <ApplicationTransition key={transition} asset={value} evidence={evidence.data} action={transition} onClose={() => setTransition(null)} onDone={updated} />}
  </section>;
}

function ApplicationTransition({ asset, evidence, action, onClose, onDone }: {
  asset: ApplicationAsset; evidence: ApplicationEvidence; action: 'review' | 'publish'; onClose: () => void; onDone: (asset: ApplicationAsset) => void;
}) {
  const [confirmed, setConfirmed] = useState(false), [note, setNote] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function save() {
    if (!confirmed || note.trim().length < 4 || busy) return;
    setBusy(true); setError('');
    try { onDone(await referencePost<ApplicationAsset>(`/api/foundation/assets/${encodeURIComponent(asset.id)}/transition`, {
      expected_revision: asset.revision, content_sha256: asset.content_sha256, action, note: note.trim(), acknowledge_sources: true, human_confirmed: true,
    })); } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  return <LibraryDialog open onOpenChange={open => { if (!open && !busy) onClose(); }} busy={busy} title={action === 'review' ? '核对部件或模板固定来源' : '发布部件或模板固定版本'}
    description="人工核对只确认此资料版本和固定出处，可信分档仍为参考。"
    actions={<Button variant="primary" disabled={!confirmed || note.trim().length < 4} loading={busy} onClick={() => void save()}>{action === 'review' ? '确认已核对固定来源' : '确认发布固定参考版本'}</Button>}>
    <div className="library-import-stack">
      <ApplicationFrozenEvidence evidence={evidence} />
      <label className="text-field">核对说明（至少 4 字）<Input aria-label="部件或模板核对说明" value={note} disabled={busy} onChange={event => setNote(event.target.value)} /></label>
      <label className="library-import-confirm"><Checkbox checked={confirmed} disabled={busy} onCheckedChange={value => setConfirmed(value === true)} />我已核对固定输入、来源和限制；发布仍保留参考分档，不等于制造实测或工程批准。</label>
      {error && <p role="alert" className="library-import-error">{error}</p>}
    </div>
  </LibraryDialog>;
}
