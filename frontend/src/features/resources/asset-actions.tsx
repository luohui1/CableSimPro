import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { ApiError, message, optionalRecord, text } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { SourceBadge } from '@/components/source-badge';
import { publishedTypes } from '@/features/type/api';
import { propertyLabel, referenceCitation, referenceData, referenceNumber } from '@/lib/reference-data';
import { deriveAsset, findAssetVersion, uncertainWrite } from './api';
import { assetActions, assetStatuses, assetUnit, comparableRelease, sourceKinds, transitionProblem, validVersion, type Asset, type AssetAction } from './definitions';
import './resources.css';

export function AssetEvidence({ asset }: { asset: Asset }) {
  const references = referenceData(asset.release.sources);
  return <div className="resource-action-evidence">
    <p>{asset.name} · {asset.version} · {assetStatuses[asset.status]} · 第 {asset.revision} 次修订</p>
    <details><summary>参数、来源与固定版本依据</summary>
      <dl>{(asset.release.parameters || []).map(parameter => <div key={parameter.name}><dt>{propertyLabel(parameter.name)}</dt><dd>{referenceNumber(parameter.quantity.value)} {assetUnit(parameter.quantity.unit)}{parameter.overridable ? ' · 允许显式覆盖' : ''}</dd></div>)}</dl>
      {!asset.release.parameters?.length && <p>没有登记计算参数；来源摘录不自动填成计算输入。</p>}
      <ul>{references.values.map((value, i) => <li key={`value-${i}`}>{propertyLabel(value.property)}：{referenceNumber(value.value)} {assetUnit(value.unit)} · {referenceCitation(value)}{value.condition ? ` · ${value.condition}` : ''}</li>)}
        {references.editions.map((edition, i) => <li key={`edition-${i}`}>{edition.standard} · {edition.edition} · {edition.scope}</li>)}
        {references.gaps.map((gap, i) => <li key={`gap-${i}`}>{gap.properties.map(propertyLabel).join('、')}：{gap.reason}</li>)}
        {references.other.map((source, i) => { const kind = sourceKinds[source.kind as keyof typeof sourceKinds]; return <li key={`source-${i}`}>{kind ? <SourceBadge kind={kind.badge} /> : <span>未登记来源类别</span>} {source.reference}</li>; })}</ul>
      <p>来源核对只记录本地操作者的检查，不会改变厂家、标准或工程师输入的原始来源类别。</p>
      <p>版本内容摘要：{asset.content_sha256}</p>
      {!!asset.release.dependencies?.length && <p>固定版本依赖：{asset.release.dependencies.length} 项；发布前会检查依赖状态与摘要。</p>}
    </details>
    {!!asset.issues.length && <ul role="status">{asset.issues.map((issue, index) => <li key={index}>{issue.message}</li>)}</ul>}
  </div>;
}

export function AssetActionButtons({ asset, onEdit, onAction, onDerive, disabled = false }: {
  asset: Asset; onEdit: () => void; onAction: (action: AssetAction | 'export') => void; onDerive: () => void; disabled?: boolean;
}) {
  const actions: AssetAction[] = asset.status === 'draft' ? ['review'] : asset.status === 'reviewed' ? ['publish', 'return_to_draft'] : asset.status === 'published' ? ['deprecate'] : [];
  return <section aria-label="资源操作"><div className="resource-actions">
    {asset.status === 'draft' && <Button size="compact" disabled={disabled} onClick={onEdit}>编辑资源草稿</Button>}
    {actions.map(action => { const problem = transitionProblem(asset, action); return <Button key={action} size="compact" disabled={disabled || !!problem} title={problem || undefined} onClick={() => onAction(action)}>{assetActions[action]}</Button>; })}
    {['published', 'deprecated'].includes(asset.status) && <Button size="compact" disabled={disabled} onClick={onDerive}>派生新版本</Button>}
    <Button size="compact" disabled={disabled} onClick={() => onAction('export')}>导出资源定义</Button>
  </div>
    <p className="resource-actions-note">{asset.status === 'draft' ? '草稿可以修改；核对定义及来源后，再单独确认发布。' : asset.status === 'reviewed' ? '内容已核对。修改前须退回草稿，发布须再次明确确认。' : asset.status === 'published' ? '此版本内容固定。派生新版本保留旧引用；停用只阻止新的引用。' : '已停用版本保留历史记录与既有引用，可派生新草稿。'}</p>
    {asset.kind === 'material' && <p className="resource-actions-note">在型号设计的“结构”页选择材料，再使用“绑定材料版本”固定已发布版本。绑定来源后，设计物性仍需逐项核对。</p>}
    {asset.kind === 'rule' && <p className="resource-actions-note">在型号设计的“要求与标准”中打开执行标准，使用“绑定标准版本”选择已发布规则；须先核对执行标准的来源。</p>}
    {['component', 'assembly'].includes(asset.kind) && <p className="resource-actions-note">当前版本可管理部件与结构定义，暂不能将普通部件或结构版本直接应用到工程。已发布的型号版本请从型号设计继续建立方案。</p>}
    {actions.map(action => { const problem = transitionProblem(asset, action); return problem ? <p className="resource-actions-note" key={action}>{assetActions[action]}暂不可用：{problem}</p> : null; })}
    {disabled && <p className="resource-actions-note">正在处理资源操作，请先完成或关闭当前对话框。</p>}
  </section>;
}

const DERIVE_RECEIPT = 'cablesim:resource-derive-pending';
type DeriveReceipt = { token: string; asset: Asset; version: string };
export function pendingAssetDerivation(): DeriveReceipt | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(DERIVE_RECEIPT) || 'null');
    return value && typeof value.token === 'string' && value.asset?.release && validVersion(value.version) ? value : null;
  } catch { return null; }
}
export function DeriveAssetDialog({ open, onClose, onSaved, asset, resume }: {
  open: boolean; onClose: () => void; onSaved: (asset: Asset) => void; asset: Asset; resume?: DeriveReceipt | null;
}) {
  const source = useRef(resume?.asset || asset);
  const navigate = useNavigate(), search = useSearch({ strict: false });
  const [version, setVersion] = useState(resume?.version || ''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [typeWorkflow, setTypeWorkflow] = useState(false);
  const [receipt, setReceipt] = useState<DeriveReceipt | null>(resume || null), [retryAllowed, setRetryAllowed] = useState(false);
  const pending = useRef(false), mounted = useRef(true);
  const typeOrigin = useQuery({ queryKey: ['resource-type-origin', source.current.id], enabled: typeWorkflow || source.current.kind === 'assembly', retry: false,
    queryFn: ({ signal }) => publishedTypes(AbortSignal.any([signal, AbortSignal.timeout(15000)])) });
  const managedType = typeOrigin.data?.find(item => item.id === source.current.id && item.asset_id === source.current.asset_id
    && item.version === source.current.version && item.content_sha256 === source.current.content_sha256 && item.status === 'published'
    && !!text(item.workspace_id) && optionalRecord(item.source_design).id === item.workspace_id);
  const needsTypeWorkflow = typeWorkflow || !!managedType;
  const checkingType = source.current.kind === 'assembly' && typeOrigin.isPending;
  function openTypeWorkflow() {
    const path = managedType ? `/types/${encodeURIComponent(text(managedType.workspace_id))}/comparison/matrix` : '/types';
    onClose(); void navigate({ to: path, search: () => ({ theme: search.theme === 'dark' ? 'dark' : 'light' }) });
  }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function done(saved: Asset, attempt: DeriveReceipt) {
    if (!mounted.current) return;
    if (pendingAssetDerivation()?.token === attempt.token) sessionStorage.removeItem(DERIVE_RECEIPT);
    setReceipt(null); onSaved(saved);
  }
  async function execute(frozen?: DeriveReceipt) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    const attempt = frozen || { token: crypto.randomUUID(), asset: source.current, version: version.trim() };
    let sent = false;
    try {
      if (!validVersion(attempt.version) || attempt.version === attempt.asset.version) throw new Error('请填写不同于原版本的三段版本号，例如 1.1.0。');
      sessionStorage.setItem(DERIVE_RECEIPT, JSON.stringify(attempt)); setReceipt(attempt); setRetryAllowed(false);
      sent = true; const result = await deriveAsset(attempt.asset, attempt.version); done(result, attempt);
    } catch (problem) {
      if (!mounted.current) return;
      if (problem instanceof ApiError && optionalRecord(problem.detail).code === 'TYPE_VERSION_WORKFLOW_REQUIRED') setTypeWorkflow(true);
      if (sent && (uncertainWrite(problem) || !!frozen)) setError(`${message(problem)}。派生结果尚待核实；原版本和目标版本号已保留。`);
      else { if (pendingAssetDerivation()?.token === attempt.token) sessionStorage.removeItem(DERIVE_RECEIPT); setReceipt(null); setError(message(problem)); }
    } finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  async function verify() {
    if (!receipt || pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const saved = await findAssetVersion(receipt.asset.asset_id, receipt.version);
      if (!mounted.current) return;
      if (saved && comparableRelease(saved.release) === comparableRelease({ ...receipt.asset.release, version: receipt.version })) done(saved, receipt);
      else if (!saved) { setRetryAllowed(true); setError('尚未找到目标版本。可继续核实或用同一个版本号重试；不会分配另一个版本号。'); }
      else { setRetryAllowed(false); setError('目标版本已存在，但内容与原请求不同。请核对该版本，不能覆盖。'); }
    } catch (problem) { if (mounted.current) setError(`核实失败：${message(problem)}。原派生请求仍保留。`); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={value => { if (!value) onClose(); }} title="派生新版本" description="按当前固定内容建立新草稿；原版本及既有引用保持固定。" initialFocus={receipt ? 'action' : 'form'}
    fallbackFocus={() => document.getElementById('resource-search')}
    actions={receipt ? <><Button variant="primary" loading={busy} onClick={() => void verify()}>核实派生结果</Button>{retryAllowed && <Button disabled={busy} onClick={() => void execute(receipt)}>按原版本号重试</Button>}</>
      : needsTypeWorkflow ? <Button variant="primary" disabled={typeOrigin.isPending} title={typeOrigin.isPending ? '正在核对来源型号，请稍候。' : undefined} onClick={openTypeWorkflow}>{managedType ? '打开型号并建立方案' : '打开型号列表'}</Button>
      : <Button variant="primary" loading={busy} disabled={checkingType || !validVersion(version.trim()) || version.trim() === source.current.version} title={checkingType ? '正在核对来源型号，请稍候。' : undefined} onClick={() => void execute()}>建立新版本草稿</Button>}>
    {error && <p className="field-error" role="alert">{error}</p>}
    {busy && <p className="muted">正在处理当前请求。关闭后保留目标版本号，可从资源页核实结果。</p>}
    {checkingType && !needsTypeWorkflow && <p role="status" className="muted">正在核对结构版本是否由型号方案管理，请稍候。</p>}
    {typeOrigin.error && !needsTypeWorkflow && <p role="status" className="muted">暂未读到来源型号目录。普通资源仍可派生；型号版本须从原方案继续。<Button size="compact" onClick={() => void typeOrigin.refetch()}>重新核对来源型号</Button></p>}
    {needsTypeWorkflow && <section aria-label="型号改版路径" className="resource-action-body">
      <p>此资源版本由型号方案管理。请从原型号的方案对比页建立新方案，核对后再按型号流程审核与发布。</p>
      {typeOrigin.isPending ? <p role="status">正在核对来源型号，请稍候。</p> : managedType ? <p>来源型号：{text(managedType.name)} · {text(managedType.version)}。打开后选择“建立方案”。</p>
        : <p>当前已发布型号目录未能定位该资源的来源型号。请打开型号列表，核对原设计后建立方案。</p>}
      {typeOrigin.error && <p role="alert">来源型号读取失败：{message(typeOrigin.error)} <Button size="compact" onClick={() => void typeOrigin.refetch()}>重新核对来源型号</Button></p>}
      {receipt && <Button disabled={typeOrigin.isPending} onClick={openTypeWorkflow}>{managedType ? '打开型号并建立方案' : '打开型号列表'}</Button>}
    </section>}
    <div className="resource-action-body"><AssetEvidence asset={source.current} />
      {!needsTypeWorkflow && <><label className="text-field">新版本号<Input aria-label="新版本号" value={version} maxLength={64} disabled={busy || !!receipt || checkingType} placeholder="例如 1.1.0" onChange={event => setVersion(event.target.value)} /></label>
        <p className="muted">填写尚未存在的三段版本号。派生草稿需要单独编辑、核对和发布；不会自动升级研究中的旧引用。</p></>}
      {receipt && <p className="muted">正在核实同一个版本号，暂不可更改。关闭后可从资源页恢复本次派生。</p>}
    </div>
  </Dialog>;
}
