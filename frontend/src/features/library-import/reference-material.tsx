import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { message } from '@/api/client';
import { DataTable } from '@/components/data-table';
import { ErrorState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select } from '@/components/ui/select';
import { LibraryDialog } from './dialog';
import { conditionName, quantityText, referenceReason, ReferenceSource, referenceUnit, referenceValue } from './reference-evidence';
import { parameterNames, referencePost, referenceRequest, type BindingPreview, type MaterialPreview, type MaterialPreviewRequest, type ReferenceAsset, type TypeResourceView } from './reference-api';

export function MaterialReferenceAdoption({ asset }: { asset: ReferenceAsset }) {
  const client = useQueryClient();
  const [workspaceId, setWorkspaceId] = useState('');
  const [materialId, setMaterialId] = useState('');
  const [property, setProperty] = useState('');
  const [binding, setBinding] = useState<BindingPreview | null>(null);
  const [preview, setPreview] = useState<{ request: MaterialPreviewRequest; response: MaterialPreview } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const noticeElement = useRef<HTMLParagraphElement>(null);
  const focusResultAfterClose = useRef(false);
  const [requiredRevision, setRequiredRevision] = useState<number | null>(null);
  const workspaces = useQuery({ queryKey: ['library-reference-type-targets'], queryFn: ({ signal }) => referenceRequest<{ id: string; name: string; revision: number }[]>('/api/design/type-workspaces', { signal }) });
  const resources = useQuery({ queryKey: ['library-reference-type-resources', workspaceId], enabled: !!workspaceId,
    queryFn: ({ signal }) => referenceRequest<TypeResourceView>(`/api/types/${encodeURIComponent(workspaceId)}/resources`, { signal }) });
  const targets = (resources.data?.targets ?? []).filter(item => item.role === 'material' && item.input_digest !== null);
  const target = targets.find(item => item.id === materialId);
  const bound = target?.binding?.resource_id === asset.id && target.binding.content_sha256 === asset.content_sha256;
  const properties = asset.release.reference_evidence ?? [];
  const awaitingRevision = requiredRevision !== null && (resources.data?.revision ?? 0) < requiredRevision;
  useEffect(() => { setPreview(null); setBinding(null); }, [workspaceId, materialId, property, resources.data?.revision]);
  const reset = () => { setPreview(null); setBinding(null); setError(''); setNotice(''); };
  async function read(bindingOnly: boolean) {
    if (!resources.data || !target || awaitingRevision) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (bindingOnly) setBinding(await referencePost<BindingPreview>(`/api/types/${encodeURIComponent(workspaceId)}/resources/material-preview`, {
        expected_revision: resources.data.revision, items: [{ target_id: materialId, resource_id: asset.id }],
      }));
      else {
        const request = { workspace_id: workspaceId, expected_revision: resources.data.revision, material_id: materialId, property,
          resource_id: asset.id, content_sha256: asset.content_sha256 };
        setPreview({ request, response: await referencePost<MaterialPreview>('/api/library/resources/materials/preview', request) });
      }
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  function boundDone(value: TypeResourceView) {
    focusResultAfterClose.current = true;
    client.setQueryData(['library-reference-type-resources', workspaceId], value);
    void client.invalidateQueries({ queryKey: ['library-reference-type-targets'] });
    setBinding(null); setPreview(null); setNotice('已绑定此参考版本的来源。下一步逐项预览设计物性与参考值，再决定是否采用。');
  }
  function adopted(revision: number) {
    focusResultAfterClose.current = true;
    setRequiredRevision(revision);
    setPreview(null); setNotice(`所选物性已写入型号输入修订 ${revision}，逐项来源与原值已保存，分档仍为参考。`);
    void client.invalidateQueries({ queryKey: ['library-reference-type-resources', workspaceId] });
    void client.invalidateQueries({ queryKey: ['library-reference-type-targets'] });
    void client.invalidateQueries({ queryKey: ['type-workspace', workspaceId] });
    void client.invalidateQueries({ queryKey: ['type-library'] });
  }
  function closeAutoFocus(event: Event) {
    if (!focusResultAfterClose.current) return;
    focusResultAfterClose.current = false;
    event.preventDefault();
    requestAnimationFrame(() => {
      const result = noticeElement.current;
      if (!result) return;
      result.focus({ preventScroll: true });
      result.scrollIntoView({ block: 'nearest' });
    });
  }
  return <section className="reference-section library-import-stack" aria-label="材料来源绑定与逐项采用">
    <h2>材料来源绑定与逐项采用</h2>
    <p className="muted">先将此固定参考版本绑定到目标材料，再逐项核对真实型号条件与数值差异。缺少材料类别、用途或适用温度事实时，保留拒绝原因。</p>
    <div className="library-import-fields library-import-fields-pair">
      <Select label="目标型号" value={workspaceId} loading={workspaces.isPending} disabled={busy || awaitingRevision} options={[{ value: '', label: '请选择已有型号' }, ...(workspaces.data ?? []).map(item => ({ value: item.id, label: `${item.name} · 输入修订 ${item.revision}` }))]}
        onChange={next => { setWorkspaceId(next); setMaterialId(''); setProperty(''); setRequiredRevision(null); reset(); }} />
      <Select label="目标设计材料" value={materialId} loading={!!workspaceId && resources.isPending} disabled={!workspaceId || busy || awaitingRevision}
        options={[{ value: '', label: '请选择实际使用的材料' }, ...targets.map(item => ({ value: item.id, label: item.name }))]}
        onChange={next => { setMaterialId(next); setProperty(''); reset(); }} />
    </div>
    {workspaces.error && <ErrorState description={message(workspaces.error)} action={<Button onClick={() => void workspaces.refetch()}>重新读取型号</Button>} />}
    {resources.error && <ErrorState description={message(resources.error)} action={<Button onClick={() => void resources.refetch()}>重新读取材料</Button>} />}
    {target && <>
      <p>当前来源：{target.binding ? `${target.binding.name} · ${target.binding.version}` : '尚未绑定'}。{target.reason}</p>
      <div><Button loading={busy} disabled={!resources.data || awaitingRevision} onClick={() => void read(true)}>预览来源绑定</Button></div>
      <Select label="待核对材料物性" value={property} disabled={busy || !bound || awaitingRevision} options={[{ value: '', label: bound ? '请选择一项物性' : '请先人工确认来源绑定' }, ...properties.map(item => ({ value: item.parameter, label: parameterNames[item.parameter] ?? item.parameter }))]}
        onChange={next => { setProperty(next); reset(); }} />
      <div><Button variant="primary" loading={busy || awaitingRevision} disabled={!bound || !property} onClick={() => void read(false)}>预览这一项物性</Button></div>
    </>}
    {awaitingRevision && <p role="status">正在读取采用后的输入修订 {requiredRevision}，读取完成后可继续核对下一项。</p>}
    {notice && <p ref={noticeElement} role="status" tabIndex={-1}>{notice}</p>}{error && <p role="alert">{error}</p>}
    {binding && <MaterialBindingDialog preview={binding} asset={asset} onClose={() => setBinding(null)} onCloseAutoFocus={closeAutoFocus} onDone={boundDone} />}
    {preview && <MaterialAdoptionDialog key={preview.response.preview_digest} preview={preview.response} request={preview.request} onClose={() => setPreview(null)} onCloseAutoFocus={closeAutoFocus} onDone={adopted} />}
  </section>;
}

function MaterialBindingDialog({ preview, asset, onClose, onCloseAutoFocus, onDone }: { preview: BindingPreview; asset: ReferenceAsset; onClose: () => void; onCloseAutoFocus: (event: Event) => void; onDone: (value: TypeResourceView) => void }) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(crypto.randomUUID());
  async function bind() {
    setBusy(true); setError('');
    try { onDone(await referencePost<TypeResourceView>(`/api/types/${encodeURIComponent(preview.workspace_id)}/resources/material-confirm`, {
      expected_revision: preview.revision, request_id: requestId.current, preview_digest: preview.digest,
      items: preview.rows.map(row => ({ target_id: row.id, resource_id: asset.id })), reviewed_targets: preview.rows.map(row => row.id), human_confirmed: true,
    })); } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  return <LibraryDialog open onOpenChange={open => { if (!open && !busy) onClose(); }} title="核对材料来源绑定" busy={busy}
    onCloseAutoFocus={onCloseAutoFocus}
    description="绑定固定资料版本和来源；参考数值的采用在下一步逐项决定。"
    actions={<Button variant="primary" loading={busy} disabled={!confirmed} onClick={() => void bind()}>确认仅绑定来源</Button>}>
    <div className="library-import-stack">{preview.rows.map(row => <section key={row.id} className="library-import-stack">
      <h3>{row.name} · 用于 {row.layer_count} 个结构层</h3>
      <p>此前来源：{row.before_resource ? `${row.before_resource.name} · ${row.before_resource.version}` : '无绑定'}；本次来源：{row.after_resource.name} · {row.after_resource.version}。</p>
      <DataTable label="材料绑定前的输入差异" showGroups={false} groups={[{ id: row.id, label: row.name, rows: row.differences.map(item => ({ ...item, id: item.field })) }]}
        columns={[
          { id: 'field', label: '材料字段', wrap: true, render: item => item.label },
          { id: 'before', label: '上次绑定时', wrap: true, render: item => `${referenceValue(item.before)} ${referenceUnit(item.unit)}` },
          { id: 'after', label: '当前设计', wrap: true, render: item => `${referenceValue(item.after)} ${referenceUnit(item.unit)}` },
        ]} rowLabel={item => item.label} />
    </section>)}
      <label className="library-import-confirm"><Checkbox checked={confirmed} disabled={busy} onCheckedChange={value => setConfirmed(value === true)} />我已查看当前材料差异，确认把此版本仅绑定为来源；物性采用另行预览确认。</label>
      {error && <p role="alert">{error}</p>}
    </div>
  </LibraryDialog>;
}

function MaterialAdoptionDialog({ preview, request, onClose, onCloseAutoFocus, onDone }: { preview: MaterialPreview; request: MaterialPreviewRequest; onClose: () => void; onCloseAutoFocus: (event: Event) => void; onDone: (revision: number) => void }) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(crypto.randomUUID());
  async function adopt() {
    setBusy(true); setError('');
    try {
      const response = await referencePost<{ revision: number }>('/api/library/resources/materials/adopt', { ...request, request_id: requestId.current,
        preview_digest: preview.preview_digest, human_confirmed: true, acknowledge_reference_limits: true });
      onDone(response.revision);
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  const item = preview.comparison, evidence = preview.evidence;
  return <LibraryDialog open onOpenChange={open => { if (!open && !busy) onClose(); }} title="核对并采用一项材料物性" busy={busy}
    onCloseAutoFocus={onCloseAutoFocus}
    description={`${preview.material_name} · ${item.label} · 输入修订 ${preview.revision}`}
    actions={<Button variant="primary" loading={busy} disabled={!preview.adoptable || !confirmed} onClick={() => void adopt()}>确认采用这一项物性</Button>}>
    <div className="library-import-stack">
      <dl className="reference-facts"><div><dt>当前设计值</dt><dd>{referenceValue(item.actual)} {referenceUnit(item.unit)}</dd></div>
        <div><dt>拟采用参考值</dt><dd>{quantityText(evidence.quantity)}</dd></div>
        <div><dt>设计值与参考值之差</dt><dd>{referenceValue(item.delta)} {referenceUnit(item.unit)}</dd></div>
        <div><dt>相对偏差</dt><dd>{referenceValue(item.percent)}{item.percent === null ? '' : ' %'}</dd></div></dl>
      <DataTable label="材料适用条件逐项核对" showGroups={false} groups={[{ id: 'checks', label: '适用条件', rows: item.condition_checks.map(check => ({ ...check, id: check.condition })) }]}
        columns={[
          { id: 'condition', label: '条件', wrap: true, render: row => conditionName(row.condition) },
          { id: 'required', label: '原文要求', wrap: true, render: row => referenceValue(row.required) },
          { id: 'selected', label: '选择条件', wrap: true, render: row => referenceValue(row.selected) },
          { id: 'actual', label: '型号现有事实', wrap: true, render: row => referenceValue(row.actual) },
          { id: 'result', label: '判定', wrap: true, render: row => row.status === 'matched' ? '相符' : referenceReason(row.reason) || '未确认' },
        ]} rowLabel={row => conditionName(row.condition)} />
      {!preview.adoptable && <p role="status">不可采用：{referenceReason(preview.reason) || '该值已一致，无需新建修订。'}</p>}
      <ReferenceSource record={evidence.receipt.record} method={evidence.receipt.method} quantity={evidence.quantity} actualConditions={evidence.selection.conditions} receipt={evidence.receipt} selection={evidence.selection} />
      <details className="library-import-details"><summary>当前设计值的原有出处</summary><p>{item.design_source.reference || '当前型号未记录此项出处。'}</p></details>
      {preview.limitations.map((limitation, index) => <p className="muted" key={index}>{limitation}</p>)}
      {preview.adoptable && <label className="library-import-confirm"><Checkbox checked={confirmed} disabled={busy} onCheckedChange={value => setConfirmed(value === true)} />我已查看数值差异、实际条件与限制，明确采用这一项参考值；不将其标为实测或工程批准。</label>}
      {error && <p role="alert">{error}</p>}
    </div>
  </LibraryDialog>;
}
