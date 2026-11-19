import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, message } from '@/api/client';
import { indexObjects } from '@/api/object-index';
import { DataTable } from '@/components/data-table';
import { ErrorState, LoadingState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { formatDateTime } from '@/lib/format';
import { LibraryDialog } from './dialog';
import { EvidenceTable, ReferenceSource, quantityText } from './reference-evidence';
import { assetStatusNames, parameterNames, referenceRequest, type AssetSummary, type ReferenceAsset, type ReferenceEvidence } from './reference-api';
import { downloadResourceExchange, exchangeKindNames, type ExchangeFormat, type ExchangeWorkspace, type PublishedModelProofSummary, type ResourceExchangePreview, type ResourceExchangeReceipt } from './resource-exchange-api';

export function ResourceExchange() {
  const [operation, setOperation] = useState('export');
  return <section className="library-import-stack" aria-label="材料环境与工程交换">
    <div className="library-import-fields library-import-fields-pair"><Select label="交换操作" value={operation} onChange={setOperation}
      options={[{ value: 'export', label: '导出本机数据' }, { value: 'import', label: '导入交换文件' }]} /></div>
    <p>资料完整保留数值、原始来源和固定查询回执。工程搬运已保存输入，在目标机器建立独立副本。</p>
    <p className="muted">新资料须在本机重新核对、发布；导入不采用参数。工程固定的发布证明仅作为外部来源，不继承本机运行或审批。完整运行、审核、原始文件和交付历史请使用整库备份恢复。</p>
    {operation === 'export' ? <ResourceExport /> : <ResourceImport />}
  </section>;
}

function ResourceExport() {
  const [kind, setKind] = useState('material');
  const [filter, setFilter] = useState('');
  const [offset, setOffset] = useState(0);
  const [selectedAssets, setSelectedAssets] = useState<Record<string, AssetSummary>>({});
  const [selectedProjects, setSelectedProjects] = useState<Record<string, ExchangeWorkspace>>({});
  const [format, setFormat] = useState<ExchangeFormat>('xlsx');
  const [inspecting, setInspecting] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [downloaded, setDownloaded] = useState<Awaited<ReturnType<typeof downloadResourceExchange>> | null>(null);
  const assets = useQuery({ queryKey: ['library-exchange-assets', kind, filter, offset], enabled: kind !== 'project',
    queryFn: ({ signal }) => referenceRequest<{ items: AssetSummary[]; total: number }>(`/api/foundation/assets?kind=${kind}&limit=20&offset=${offset}&q=${encodeURIComponent(filter)}`, { signal }) });
  const projects = useQuery({ queryKey: ['library-exchange-projects', filter, offset], enabled: kind === 'project',
    queryFn: async ({ signal }) => {
      const page = await indexObjects({ kind: 'project', q: filter, limit: 20, offset }, signal);
      return { total: page.total, items: page.items.map(item => {
        if (item.kind !== 'project' || typeof item.revision !== 'number' || !item.updated) throw new ApiError(502, '工程索引缺少明确类别、修订或保存时间，请重新读取。');
        return { id: item.id, name: item.name, revision: item.revision, updated_at: item.updated };
      }) };
    } });
  const assetCount = Object.keys(selectedAssets).length, projectCount = Object.keys(selectedProjects).length;
  const selected = [...Object.values(selectedAssets).map(item => ({ id: item.id, name: item.name, kind: exchangeKindNames[item.kind] ?? '资料', version: item.version, project: false })),
    ...Object.values(selectedProjects).map(item => ({ id: item.id, name: item.name, kind: '工程输入', version: `修订 ${item.revision}`, project: true }))];
  function chooseAsset(item: AssetSummary, checked: boolean) {
    setSelectedAssets(previous => { const next = { ...previous }; if (checked) next[item.id] = item; else delete next[item.id]; return next; });
    setDownloaded(null);
  }
  function chooseProject(item: ExchangeWorkspace, checked: boolean) {
    setSelectedProjects(previous => { const next = { ...previous }; if (checked) next[item.id] = item; else delete next[item.id]; return next; });
    setDownloaded(null);
  }
  async function download() {
    if (busy || !selected.length) return;
    setBusy(true); setError(''); setDownloaded(null);
    try { setDownloaded(await downloadResourceExchange({ asset_ids: Object.keys(selectedAssets), workspace_ids: Object.keys(selectedProjects), format })); }
    catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  const total = kind === 'project' ? projects.data?.total ?? 0 : assets.data?.total ?? 0;
  return <div className="library-import-stack">
    <h2>选择要带走的资料与工程</h2>
    <div className="library-import-fields library-import-fields-pair">
      <Select label="导出内容类别" value={kind} disabled={busy} onChange={value => { setKind(value); setOffset(0); setFilter(''); }}
        options={[{ value: 'material', label: '材料资料' }, { value: 'installation', label: '敷设与环境' }, { value: 'project', label: '工程输入' }]} />
      <label className="text-field">按名称查找交换内容<Input aria-label="按名称查找交换内容" disabled={busy} value={filter} onChange={event => { setFilter(event.target.value); setOffset(0); }} /></label>
    </div>
    {kind === 'project' && <p className="muted">按现有工程索引选择已保存输入。固定已发布型号的工程会携带该版本的完整发布证明及准确依赖；目标工程绑定独立草稿，不关联目标库同名型号。独立型号请使用型号系列交换。</p>}
    {kind === 'project' ? projects.isPending ? <LoadingState title="正在读取已保存工程" /> : projects.error ? <ErrorState description={message(projects.error)} action={<Button onClick={() => void projects.refetch()}>重新读取工程</Button>} /> : <DataTable label="可导出的工程输入" showGroups={false}
      groups={[{ id: 'projects', label: '工程输入', rows: projects.data?.items ?? [] }]} rowLabel={row => row.name} columns={[
        { id: 'select', label: '选择', render: row => <Checkbox aria-label={`选择工程 ${row.name}`} checked={!!selectedProjects[row.id]} disabled={busy || (!selectedProjects[row.id] && projectCount >= 20)} onCheckedChange={value => chooseProject(row, value === true)} /> },
        { id: 'name', label: '工程名称', wrap: true, render: row => row.name },
        { id: 'revision', label: '保存修订', numeric: true, render: row => row.revision },
        { id: 'updated', label: '保存时间', wrap: true, render: row => formatDateTime(row.updated_at) },
        { id: 'open', label: '查看输入', render: row => <Button size="compact" asChild><a href={`/studies?workspace=${encodeURIComponent(row.id)}`}>查看工程</a></Button> },
      ]} /> : assets.isPending ? <LoadingState title="正在读取资料版本" /> : assets.error ? <ErrorState description={message(assets.error)} action={<Button onClick={() => void assets.refetch()}>重新读取资料</Button>} /> : <DataTable label="可导出的资料版本" showGroups={false}
      groups={[{ id: 'assets', label: '资料版本', rows: assets.data?.items ?? [] }]} rowLabel={row => `${row.name} ${row.version}`} columns={[
        { id: 'select', label: '选择', render: row => <Checkbox aria-label={`选择资料 ${row.name} ${row.version}`} checked={!!selectedAssets[row.id]} disabled={busy || (!selectedAssets[row.id] && assetCount >= 100)} onCheckedChange={value => chooseAsset(row, value === true)} /> },
        { id: 'name', label: '资料名称', wrap: true, render: row => row.name },
        { id: 'version', label: '版本', render: row => row.version },
        { id: 'status', label: '本机状态', wrap: true, render: row => assetStatusNames[row.status] ?? '状态未识别' },
        { id: 'source', label: '来源', render: row => <Button size="compact" disabled={busy} onClick={() => setInspecting(row.id)}>核对资料来源</Button> },
      ]} />}
    <div className="library-import-series-heading"><span className="muted">共 {total} 项 · 已选择 {assetCount} 个资料版本、{projectCount} 个工程</span><div className="library-import-series-actions">
      <Button disabled={busy || !offset} onClick={() => setOffset(Math.max(0, offset - 20))}>上一页</Button>
      <Button disabled={busy || offset + 20 >= total} onClick={() => setOffset(offset + 20)}>下一页</Button>
    </div></div>
    {selected.length > 0 && <DataTable label="已选择的交换内容" showGroups={false} groups={[{ id: 'selected', label: '已选内容', rows: selected }]} rowLabel={row => row.name} columns={[
      { id: 'name', label: '已选对象', wrap: true, render: row => row.name },
      { id: 'kind', label: '类别', render: row => row.kind },
      { id: 'version', label: '保存版本', render: row => row.version },
      { id: 'remove', label: '移出本次范围', render: row => <Button size="compact" disabled={busy} aria-label={`移出交换范围 ${row.name}`} onClick={() => row.project ? chooseProject(selectedProjects[row.id], false) : chooseAsset(selectedAssets[row.id], false)}>移出</Button> },
    ]} />}
    {!!selected.length && <div><Button disabled={busy} onClick={() => { setSelectedAssets({}); setSelectedProjects({}); setDownloaded(null); }}>清空本次选择</Button></div>}
    <p className="muted">单次最多 100 个资料版本及 20 个工程，完整依赖计入资料数量。每个工程的普通输入限 1 MiB、4096 条锁定记录；经完整校验的固定发布证明单独限 8 MiB，完整交换包和文件仍各限 8 MiB。超限时拒绝整包，不删减来源或锁；单工程超限请使用整库备份，多个对象合计超限可减少本次选择。</p>
    <div className="library-import-fields library-import-fields-pair"><Select label="交换文件格式" value={format} disabled={busy} onChange={value => { setFormat(value as ExchangeFormat); setDownloaded(null); }}
      options={[{ value: 'xlsx', label: 'Excel 交换文件' }, { value: 'json', label: 'JSON 交换文件' }]} /></div>
    <div><Button variant="primary" loading={busy} disabled={!selected.length} onClick={() => void download()}>导出已选资料与工程</Button></div>
    {error && <p role="alert" className="field-error">{error}</p>}
    {downloaded && <div className="library-import-stack"><p role="status">已下载 {downloaded.filename}。请在目标机器的数据交换页上传并核对。</p>
      <details className="library-import-details"><summary>本次下载完整性</summary><p className="library-import-digest">文件 SHA-256：{downloaded.file_sha256 ?? '服务器未返回'}</p><p className="library-import-digest">内容 SHA-256：{downloaded.bundle_sha256 ?? '服务器未返回'}</p></details>
    </div>}
    {inspecting && <ExchangeAssetDetail id={inspecting} onClose={() => setInspecting('')} />}
  </div>;
}

function ResourceImport() {
  const client = useQueryClient();
  const picker = useRef<HTMLInputElement>(null);
  const requestId = useRef('');
  const generation = useRef(0);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ResourceExchangePreview | null>(null);
  const [receipt, setReceipt] = useState<ResourceExchangeReceipt | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [inspecting, setInspecting] = useState('');
  async function upload(next: File) {
    const current = ++generation.current;
    setFile(next); setPreview(null); setReceipt(null); setConfirmed(false); setError(''); requestId.current = '';
    setBusy('正在核对交换文件与完整来源');
    try {
      if (!/\.(json|xlsx)$/i.test(next.name)) throw new Error('请选择资料与工程导出的 JSON 或 Excel 交换文件；厂家结构表请使用“导入结构表”。');
      if (!next.size || next.size > 8 * 1024 * 1024) throw new Error('请选择非空且不超过 8 MiB 的交换文件。');
      const body = new FormData(); body.append('file', next);
      const result = await referenceRequest<ResourceExchangePreview>('/api/library/exchange/preview', { method: 'POST', body });
      if (current !== generation.current) return;
      setPreview(result); requestId.current = crypto.randomUUID();
    } catch (cause) { if (current === generation.current) setError(message(cause)); }
    finally { if (current === generation.current) setBusy(''); }
  }
  async function save() {
    if (!preview || !file || !confirmed || busy) return;
    setBusy('正在保存资料与独立工程输入'); setError('');
    try {
      const body = new FormData(); body.append('file', file); body.append('reviewed_sha256', preview.sha256);
      body.append('confirmed', 'true'); body.append('request_id', requestId.current);
      const result = await referenceRequest<ResourceExchangeReceipt>('/api/library/exchange/import', {
        method: 'POST', headers: { 'X-CableSim-Actor': 'human' }, body,
      });
      setReceipt(result);
      await Promise.all([['library-reference-assets'], ['library-exchange-assets'], ['library-exchange-projects'], ['workspace-index']].map(queryKey => client.invalidateQueries({ queryKey })));
    } catch (cause) {
      setError(message(cause));
      if (cause instanceof ApiError && cause.status === 409) { setPreview(null); setConfirmed(false); requestId.current = ''; }
    } finally { setBusy(''); }
  }
  return <div className="library-import-stack">
    <h2>导入资料与工程交换文件</h2>
    <p>先核对文件中的对象范围，再人工确认。本机已有相同内容的资料会复用；同版本内容不一致时整包拒绝。</p>
    <div><Button variant={preview ? 'secondary' : 'primary'} disabled={!!busy} onClick={() => picker.current?.click()}>选择资料与工程交换文件</Button></div>
    <Input ref={picker} type="file" hidden tabIndex={-1} aria-label="资料与工程交换文件" accept=".json,.xlsx" disabled={!!busy} onChange={event => { const next = event.target.files?.[0]; event.target.value = ''; if (next) void upload(next); }} />
    {file && <p className="library-import-file">{file.name}</p>}
    {busy && <p role="status">{busy}…</p>}
    {error && <p role="alert" className="field-error">{error}</p>}
    {receipt && preview ? <div className="library-import-stack">
      <h2>资料与工程已导入</h2>
      <p>新建 {receipt.assets.filter(item => item.action === 'create_draft').length} 个资料草稿，复用 {receipt.assets.filter(item => item.action === 'reuse').length} 个本机资料版本，建立 {receipt.projects.length} 个独立工程输入副本。</p>
      <p className="muted">未继承来源方审批。复用资料保持本机已有状态；新增草稿的来源分档保持原样，使用前仍须核对适用条件。</p>
      {!!receipt.assets.length && <DataTable label="资料交换结果" showGroups={false} groups={[{ id: 'assets', label: '资料', rows: receipt.assets.map(item => ({ ...item, name: preview.assets.find(source => source.origin_id === item.origin_id)?.name ?? '资料' })) }]} rowLabel={row => row.name} columns={[
        { id: 'name', label: '资料名称', wrap: true, render: row => row.name },
        { id: 'result', label: '本机处理', wrap: true, render: row => row.action === 'create_draft' ? '新建草稿，须本机核对' : '复用相同内容，保持本机状态' },
        { id: 'open', label: '逐项来源', render: row => <Button size="compact" aria-label={`查看导入资料：${row.name}`} onClick={() => setInspecting(row.id)}>查看完整来源</Button> },
      ]} />}
      {preview.projects.map(item => item.published_model && <PublishedProjectEvidence key={item.origin_id} name={item.name} value={item.published_model} />)}
      {receipt.projects.map(item => <div key={item.id}><Button asChild><a href={`/studies?workspace=${encodeURIComponent(item.id)}`}>打开工程：{preview.projects.find(source => source.origin_id === item.origin_id)?.name ?? '独立输入副本'}</a></Button></div>)}
    </div> : preview && <div className="library-import-stack">
      <h2>核对资料与工程交换预览</h2>
      <p>{preview.assets.length} 个资料版本，{preview.projects.length} 个独立工程输入副本。</p>
      {!!preview.assets.length && <DataTable label="资料交换预览" showGroups={false} groups={[{ id: 'assets', label: '资料版本', rows: preview.assets.map(item => ({ ...item, id: item.origin_id })) }]} rowLabel={row => row.name} columns={[
        { id: 'name', label: '资料名称', wrap: true, render: row => row.name },
        { id: 'kind', label: '类别', render: row => exchangeKindNames[row.kind] ?? '资料' },
        { id: 'action', label: '导入后处理', wrap: true, render: row => row.action === 'reuse' ? '复用相同内容，保持本机状态' : '新建未发布草稿' },
      ]} />}
      {!!preview.projects.length && <DataTable label="工程交换预览" showGroups={false} groups={[{ id: 'projects', label: '工程输入', rows: preview.projects.map(item => ({ ...item, id: item.origin_id })) }]} rowLabel={row => row.name} columns={[
        { id: 'name', label: '工程名称', wrap: true, render: row => row.name },
        { id: 'action', label: '导入后处理', wrap: true, render: () => '建立独立输入副本，不继承本机运行或审批' },
      ]} />}
      {preview.projects.map(item => item.published_model && <PublishedProjectEvidence key={item.origin_id} name={item.name} value={item.published_model} />)}
      <ul>{preview.limitations.map(item => <li key={item}>{item}</li>)}</ul>
      <label className="library-import-confirm"><Checkbox aria-label="确认资料与工程交换范围" checked={confirmed} disabled={!!busy} onCheckedChange={value => setConfirmed(value === true)} /><span>我已核对文件及以上范围，确认新资料以草稿保存、工程建立独立输入副本，不继承来源方审批。</span></label>
      <div><Button variant="primary" loading={!!busy} disabled={!confirmed} onClick={() => void save()}>确认导入资料与工程</Button></div>
    </div>}
    {inspecting && <ExchangeAssetDetail id={inspecting} onClose={() => setInspecting('')} />}
  </div>;
}

function PublishedProjectEvidence({ name, value }: { name: string; value: PublishedModelProofSummary }) {
  return <section className="reference-evidence library-import-stack" aria-label={`${name}的已发布型号来源`}>
    <h3>固定已发布型号来源</h3>
    <p>{name} · 固定发行版本 {value.version}</p>
    <p>完整证明 {value.proof_bytes.toLocaleString('zh-CN')} 字节；准确依赖 {value.dependency_count} 个；来源运行记录 {value.source_run_count} 条。</p>
    <p>本次交换不创建本机运行记录；来源运行仅按外部声明保存。原批准回执作为来源保存，目标型号绑定为草稿，不构成本机批准。</p>
    <p>来源记录的核对人：{value.source_approval.reviewer}；原确认时间：{formatDateTime(value.source_approval.approved_at)}。导入不会提升来源可信分档。</p>
    <details className="library-import-details">
      <summary>固定发布来源完整性</summary>
      <div className="library-import-issues">
        <span className="library-import-digest">发行内容 SHA-256：{value.asset_sha256}</span>
        <span className="library-import-digest">冻结规格书 SHA-256：{value.specification_sha256}</span>
      </div>
    </details>
  </section>;
}

function ExchangeAssetDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const asset = useQuery({ queryKey: ['library-reference-asset', id], staleTime: 0,
    queryFn: ({ signal }) => referenceRequest<ReferenceAsset>(`/api/foundation/assets/${encodeURIComponent(id)}`, { signal }) });
  const [evidence, setEvidence] = useState<ReferenceEvidence | null>(null);
  return <LibraryDialog open onOpenChange={open => { if (!open) onClose(); }} title="交换资料的完整来源" initialFocus="preserve">
    {asset.isPending ? <LoadingState title="正在读取已保存资料" /> : asset.error || !asset.data ? <ErrorState description={message(asset.error)} action={<Button onClick={() => void asset.refetch()}>重新读取资料</Button>} /> : <div className="library-import-stack">
      <h2>{asset.data.name} · {asset.data.version}</h2><p>{assetStatusNames[asset.data.status] ?? '状态未识别'} · 修订 {asset.data.revision}</p>
      {evidence ? <><div><Button onClick={() => setEvidence(null)}>返回资料参数</Button></div><ReferenceSource record={evidence.receipt.record} method={evidence.receipt.method} quantity={evidence.quantity}
        actualConditions={evidence.selection.conditions} receipt={evidence.receipt} selection={evidence.selection} /></> : (asset.data.release.reference_evidence ?? []).length ? <>
        <EvidenceTable evidence={asset.data.release.reference_evidence ?? []} onInspect={setEvidence} />
        <p className="muted">选择一项查看原文条件、页码、方法版本和完整来源。来源可信分档不会因交换而提升。</p>
      </> : <>
        <p className="muted">此资料沿用原有参数和出处，没有逐项资料查询回执；交换不会补造回执。</p>
        <DataTable label="交换资料原有参数" showGroups={false} groups={[{ id: 'parameters', label: '参数', rows: asset.data.release.parameters.map(item => ({ ...item, id: item.name })) }]} rowLabel={row => parameterNames[row.name] ?? row.name}
          columns={[{ id: 'name', label: '参数', wrap: true, render: row => parameterNames[row.name] ?? row.name }, { id: 'value', label: '保存值与单位', wrap: true, render: row => quantityText(row.quantity) }]} />
        <ul>{asset.data.release.sources.map((item, index) => <li key={index}>{/^[\s]*[\[{]/.test(item.reference)
          ? <details><summary>查看此条原始出处（只读）</summary><Textarea aria-label={`交换资料原有出处 ${index + 1}`} readOnly value={item.reference} /></details>
          : item.reference}</li>)}</ul>
      </>}
      <details className="library-import-details"><summary>固定资料内容完整性</summary><p className="library-import-digest">{asset.data.content_sha256}</p></details>
    </div>}
  </LibraryDialog>;
}
