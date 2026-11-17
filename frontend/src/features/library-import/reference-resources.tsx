import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { message } from '@/api/client';
import { DataTable } from '@/components/data-table';
import { ErrorState, LoadingState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { LibraryDialog } from './dialog';
import { ReferenceCatalogueBrowser } from './reference-catalogue';
import { EvidenceTable, quantityText, ReferenceSource } from './reference-evidence';
import { MaterialReferenceAdoption } from './reference-material';
import { EnvironmentReferenceAdoption } from './reference-environment';
import { assetStatusNames, parameterNames, referencePost, referenceRequest, type AssetSummary, type ReferenceAsset, type ReferenceCategory, type ReferenceChoice, type ReferenceEvidence } from './reference-api';
import './reference-resources.css';

export function ReferenceResources() {
  const client = useQueryClient();
  const [category, setCategory] = useState<ReferenceCategory>('materials');
  const [view, setView] = useState<'catalogue' | 'assets'>('catalogue');
  const [assetId, setAssetId] = useState('');
  const [choices, setChoices] = useState<Record<ReferenceCategory, ReferenceChoice[]>>({ materials: [], environment: [] });
  function created(asset: ReferenceAsset) {
    client.setQueryData(['library-reference-asset', asset.id], asset);
    void client.invalidateQueries({ queryKey: ['library-reference-assets'] });
    setAssetId(asset.id); setView('assets');
  }
  return <div className="library-import-stack reference-resources">
    <div className="reference-toolbar">
      <Select label="资料类别" value={category} onChange={next => { setCategory(next as ReferenceCategory); setAssetId(''); }} options={[{ value: 'materials', label: '材料物性' }, { value: 'environment', label: '敷设与环境' }]} />
      <div className="reference-navigation" aria-label="参考资料导航">
        <Button aria-pressed={view === 'catalogue'} onClick={() => setView('catalogue')}>浏览资料目录</Button>
        <Button aria-pressed={view === 'assets'} onClick={() => setView('assets')}>查看资料版本</Button>
      </div>
    </div>
    <p className="muted">资料记录保留原值、SI 值、页码、方法版本和参考分档。发布冻结资料版本；绑定只记录来源，实际采用须逐项预览并由人工确认。</p>
    {view === 'catalogue' ? <ReferenceCatalogueBrowser key={category} category={category} choices={choices[category]}
      onChoices={next => setChoices(previous => ({ ...previous, [category]: next }))} onCreated={created} />
      : <ReferenceAssetList key={category} category={category} selected={assetId} onSelect={setAssetId} />}
  </div>;
}

function ReferenceAssetList({ category, selected, onSelect }: { category: ReferenceCategory; selected: string; onSelect: (id: string) => void }) {
  const [filter, setFilter] = useState('');
  const [offset, setOffset] = useState(0);
  const assets = useQuery({ queryKey: ['library-reference-assets', category, filter, offset],
    queryFn: ({ signal }) => referenceRequest<{ items: AssetSummary[]; total: number }>(`/api/foundation/assets?kind=${category === 'materials' ? 'material' : 'installation'}&limit=50&offset=${offset}&q=${encodeURIComponent(filter)}`, { signal }) });
  return <div className="library-import-stack">
    {selected ? <><div><Button onClick={() => onSelect('')}>返回资料版本列表</Button></div><ReferenceAssetDetail key={selected} id={selected} /></> : <>
      <h2>已保存的{category === 'materials' ? '材料' : '敷设'}资料版本</h2>
      <label className="text-field">按名称查找资料<Input aria-label="按名称查找参考资料" value={filter} onChange={event => { setFilter(event.target.value); setOffset(0); }} /></label>
      {assets.isPending ? <LoadingState title="正在读取资料版本" /> : assets.error ? <ErrorState description={message(assets.error)} action={<Button onClick={() => void assets.refetch()}>重新读取资料版本</Button>} /> : assets.data && <>
        <DataTable label="参考资料版本" showGroups={false} groups={[{ id: 'assets', label: '资料版本', rows: assets.data.items }]}
          columns={[
            { id: 'name', label: '资料名称', wrap: true, render: row => row.name },
            { id: 'version', label: '版本', render: row => row.version },
            { id: 'status', label: '资料状态', wrap: true, render: row => assetStatusNames[row.status] ?? row.status },
            { id: 'open', label: '查看', render: row => <Button size="compact" onClick={() => onSelect(row.id)}>查看固定版本</Button> },
          ]} rowLabel={row => `${row.name} ${row.version}`} onActivate={row => onSelect(row.id)} />
        {!assets.data.items.length && <p role="status">尚无匹配资料。请从资料目录核对原值与条件，再创建参考草稿。</p>}
        <div className="reference-toolbar"><span className="muted">共 {assets.data.total} 个资料版本</span><div className="reference-navigation">
          <Button disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 50))}>上一页</Button>
          <Button disabled={offset + 50 >= assets.data.total} onClick={() => setOffset(offset + 50)}>下一页</Button>
        </div></div>
      </>}
    </>}
  </div>;
}

function ReferenceAssetDetail({ id }: { id: string }) {
  const client = useQueryClient();
  const asset = useQuery({ queryKey: ['library-reference-asset', id], queryFn: ({ signal }) => referenceRequest<ReferenceAsset>(`/api/foundation/assets/${encodeURIComponent(id)}`, { signal }) });
  const [inspecting, setInspecting] = useState<ReferenceEvidence | null>(null);
  const [transition, setTransition] = useState<'review' | 'publish' | null>(null);
  function updated(value: ReferenceAsset) {
    client.setQueryData(['library-reference-asset', id], value);
    void client.invalidateQueries({ queryKey: ['library-reference-assets'] });
    setTransition(null);
  }
  if (asset.isPending) return <LoadingState title="正在读取固定资料版本" />;
  if (asset.error || !asset.data) return <ErrorState description={message(asset.error)} action={<Button onClick={() => void asset.refetch()}>重新读取固定版本</Button>} />;
  const value = asset.data, evidence = value.release.reference_evidence ?? [];
  return <div className="library-import-stack">
    <div className="reference-toolbar"><div><h2>{value.name} · {value.version}</h2><p>{assetStatusNames[value.status] ?? value.status} · 修订 {value.revision}</p></div>
      {value.status === 'draft' && <Button variant="primary" disabled={!!value.issues.length || !evidence.length} onClick={() => setTransition('review')}>核对参考来源</Button>}
      {value.status === 'reviewed' && <Button variant="primary" disabled={!!value.issues.length || !evidence.length} onClick={() => setTransition('publish')}>发布参考版本</Button>}
    </div>
    {value.issues.map(issue => <p key={issue.code} role="alert">{issue.message}</p>)}
    {evidence.length ? <><EvidenceTable evidence={evidence} onInspect={setInspecting} /><p className="muted">选择一行查看原文限制、实际选值条件和来源摘要。资料发布始终保留“参考”分档。</p></>
      : <>
        <p role="status">此版本没有保存逐项资料查询回执。以下原有参数与来源保持可读；本页不能通过参考采用流程补写或推断物性。</p>
        <DataTable label="原有资料参数" showGroups={false} groups={[{ id: 'parameters', label: '已保存参数', rows: value.release.parameters.map(item => ({ ...item, id: item.name })) }]}
          columns={[{ id: 'name', label: '参数', wrap: true, render: row => parameterNames[row.name] ?? row.name }, { id: 'value', label: '保存值与单位', wrap: true, render: row => quantityText(row.quantity) }]}
          rowLabel={row => parameterNames[row.name] ?? row.name} />
        <DataTable label="原有资料来源" showGroups={false} groups={[{ id: 'sources', label: '已保存来源', rows: value.release.sources.map((item, index) => ({ ...item, id: String(index) })) }]}
          columns={[
            { id: 'kind', label: '来源类别', render: row => ({ manufacturer: '厂家资料', standard: '标准', literature: '文献', project_input: '项目输入', derived: '派生值' } as Record<string, string>)[row.kind] ?? row.kind },
            { id: 'reference', label: '保存出处', wrap: true, render: row => /^[\s]*[\[{]/.test(row.reference)
              ? <details><summary>查看此条原始出处（只读）</summary><Textarea aria-label={`原有资料出处 ${Number(row.id) + 1}`} readOnly value={row.reference} /></details>
              : row.reference },
            { id: 'reviewed', label: '出处状态', render: row => row.reviewed ? '已核对出处' : '出处未确认' },
          ]} rowLabel={row => row.reference} />
      </>}
    <details className="library-import-details"><summary>固定版本完整性</summary><p className="library-import-digest">{value.content_sha256}</p></details>
    {value.status === 'published' && evidence.length > 0 && !value.issues.length && (value.kind === 'material'
      ? <MaterialReferenceAdoption key={value.content_sha256} asset={value} />
      : value.kind === 'installation' ? <EnvironmentReferenceAdoption key={value.content_sha256} asset={value} /> : null)}
    {inspecting && <LibraryDialog open onOpenChange={open => { if (!open) setInspecting(null); }} title="固定资料的逐项来源" initialFocus="preserve">
      <ReferenceSource record={inspecting.receipt.record} method={inspecting.receipt.method} quantity={inspecting.quantity} actualConditions={inspecting.selection.conditions} receipt={inspecting.receipt} selection={inspecting.selection} />
    </LibraryDialog>}
    {transition && <ReferenceTransition key={transition} asset={value} action={transition} onClose={() => setTransition(null)} onDone={updated} />}
  </div>;
}

function ReferenceTransition({ asset, action, onClose, onDone }: { asset: ReferenceAsset; action: 'review' | 'publish'; onClose: () => void; onDone: (asset: ReferenceAsset) => void }) {
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    setBusy(true); setError('');
    try { onDone(await referencePost<ReferenceAsset>(`/api/foundation/assets/${encodeURIComponent(asset.id)}/transition`, {
      expected_revision: asset.revision, content_sha256: asset.content_sha256, action, note: note.trim(), acknowledge_sources: true,
    })); } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  return <LibraryDialog open onOpenChange={open => { if (!open && !busy) onClose(); }} busy={busy} title={action === 'review' ? '核对参考来源' : '发布参考版本'}
    description="此操作由本地资料管理人员确认，冻结资料内容和来源；不授予用户工程批准。"
    actions={<Button variant="primary" loading={busy} disabled={!confirmed || note.trim().length < 4} onClick={() => void save()}>{action === 'review' ? '确认已核对来源' : '确认发布参考版本'}</Button>}>
    <div className="library-import-stack"><EvidenceTable evidence={asset.release.reference_evidence ?? []} />
      <label className="text-field">核对说明（至少 4 字）<Input aria-label="参考资料核对说明" disabled={busy} value={note} onChange={event => setNote(event.target.value)} /></label>
      <label className="library-import-confirm"><Checkbox checked={confirmed} disabled={busy} onCheckedChange={value => setConfirmed(value === true)} />我已核对原文、版本、条件和限制；此操作仅确认参考资料版本，不等于材料实测或工程审批。</label>
      {error && <p role="alert">{error}</p>}
    </div>
  </LibraryDialog>;
}
