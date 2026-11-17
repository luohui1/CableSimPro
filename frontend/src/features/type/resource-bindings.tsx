import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, message, optionalRecord, text } from '@/api/client';
import type { ObjectCard } from '@/api/object-index';
import { ObjectLink } from '@/components/object-link';
import { StatusMark } from '@/components/status-mark';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Dialog } from '@/components/ui/dialog';
import { InlineEmpty, LoadingState, ErrorState } from '@/components/states';
import { standardVersionLabel } from './design-summary';
import { useTypeWorkspace } from './provider';

export type Resource = { id: string; resource_id?: string; asset_id: string; version: string; content_sha256: string; name: string; kind: string };
export type Target = { id: string; role: 'material' | 'standard'; name: string; state: string; reason: string; unique_match: string | null; match_reason: string; binding: Resource | null; declaration?: boolean; exact_name_match?: string | null; exact_name_reason?: string };
export type ResourceView = { revision: number; targets: Target[]; resources: Resource[]; changed?: string[] };
export async function resourceRequest<T>(wid: string, action = '', body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/types/${encodeURIComponent(wid)}/resources${action}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.any([AbortSignal.timeout(10000), ...(signal ? [signal] : [])]) });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(503, '资源服务未响应；可重试同一请求，或重新读取确认保存状态。');
  }
  const data = await response.json();
  if (!response.ok) throw new ApiError(response.status, typeof data.detail === 'string' ? data.detail : data.detail?.message || '资源绑定不可用，请重新读取');
  return data;
}
async function request(wid: string, action = '', body?: unknown, signal?: AbortSignal): Promise<ResourceView> {
  const data = await resourceRequest<ResourceView>(wid, action, body, signal);
  if (!Number.isInteger(data.revision) || !Array.isArray(data.targets) || !Array.isArray(data.resources)) throw new ApiError(502, '资源绑定响应缺少版本或目录');
  return data;
}
export function useResources() {
  const state = useTypeWorkspace();
  return useQuery({ queryKey: ['type-resource-bindings', state.workspace?.id, state.workspace?.revision], enabled: !!state.workspace && !state.readOnly,
    queryFn: ({ signal }) => request(state.workspace!.id, '', undefined, signal) });
}
function card(resource: Resource): ObjectCard { return { kind: 'asset', id: resource.resource_id || resource.id, name: resource.name, version: resource.version, subtype: resource.kind, status: { code: 'published', label: '已发布' } }; }
export function StandardResourceCell({ reference }: { reference: unknown }) {
  const resource = optionalRecord(reference);
  return text(resource.resource_id) ? <ObjectLink card={card(resource as Resource)}>{text(resource.name)} · {standardVersionLabel(text(resource.version))}</ObjectLink> : <span className="muted">未绑定资源</span>;
}
export function DeclaredStandardReferences() {
  const state = useTypeWorkspace(), query = useResources();
  const fixed = optionalRecord(optionalRecord(state.workspace?.raw.type_resource_bindings).standard);
  const targets = state.readOnly ? Object.entries(fixed).flatMap(([id, value]) => {
    const pin = optionalRecord(value);
    return text(pin.resource_id) ? [{ id, binding: pin as Resource, name: text(pin.name), reason: '所选输入修订保存的固定版本引用。' }] : [];
  }) : query.data?.targets.filter(t => t.role === 'standard' && t.declaration);
  if (!targets?.length) return null;
  return <div className="type-result-summary" aria-label="已声明执行标准">
    <StatusMark kind={state.readOnly ? 'historical' : 'draft'} label={state.readOnly ? '历史执行版本' : '执行版本已声明'} detail="固定标准来源版本；要求和计算结果仍需分别核对与批准。" />
    {targets.map(target => <span key={target.id} title={target.reason}><StandardResourceCell reference={target.binding} />{!target.binding && <span> · {target.name}</span>}</span>)}
  </div>;
}
export function MaterialResourceCell({ id, name }: { id: string; name: string }) {
  const state = useTypeWorkspace(), query = useResources();
  const target = query.data?.targets.find(t => t.role === 'material' && t.id === id);
  const saved = optionalRecord(optionalRecord(optionalRecord(state.workspace?.raw.type_resource_bindings).material)[id]);
  const resource = target?.binding || (text(saved.resource_id) ? saved as Resource : null);
  const materialChanged = JSON.stringify(state.document?.materials.find(m => m.id === id)) !== JSON.stringify(state.workspace?.document.materials.find(m => m.id === id));
  const bindingState = state.readOnly ? resource ? 'fixed' : 'unbound' : resource && materialChanged ? 'outdated' : target?.state;
  return <span className="type-resource-cell" data-resource-state={bindingState || (query.isPending ? 'loading' : 'error')}>
    {resource ? <ObjectLink card={card(resource)}>{resource.name} · {resource.version}</ObjectLink> : <span>{name}</span>}
    {bindingState === 'unbound' ? <span className="type-binding-mark is-unbound" aria-label="未绑定资源" title={target?.reason || '未绑定资源；历史输入没有保存资源引用'} />
      : bindingState === 'outdated' ? <span title={materialChanged ? '材料事实有未保存修改；请保存后重新核对绑定。' : target?.reason}><StatusMark kind="historical" label="绑定过期" /></span>
      : resource && bindingState ? <span className="type-binding-mark" title="已固定资源版本" aria-label="已绑定资源版本" /> : null}
  </span>;
}
export function ResourceBindings({ materialId, role = 'material' }: { materialId?: string; role?: 'material' | 'standard' }) {
  const state = useTypeWorkspace(), queries = useQueryClient(), query = useResources();
  const trigger = useRef<HTMLButtonElement>(null);
  const attempt = useRef<{ key: string; body: unknown } | null>(null), pending = useRef<Promise<ResourceView> | null>(null);
  const [open, setOpen] = useState(false), [chosen, setChosen] = useState(''), [resourceId, setResourceId] = useState(''), [notice, setNotice] = useState('');
  const targets = query.data?.targets.filter(t => t.role === role && (!materialId || t.id === materialId)) || [];
  const target = targets.find(t => t.id === chosen) || targets[0];
  const resources = (query.data?.resources || []).filter(resource => resource.kind === (role === 'material' ? 'material' : 'rule'));
  const fixed = target?.binding, fixedId = fixed?.resource_id || fixed?.id || '';
  const fixedUnavailable = !!fixedId && !resources.some(resource => resource.id === fixedId);
  const selectionUnavailable = !!resourceId && !resources.some(resource => resource.id === resourceId);
  const versionLabel = (resource: Resource) => resource.name + ' · ' + (role === 'standard' ? standardVersionLabel(resource.version) : resource.version);
  const mutation = useMutation({ mutationFn: async (migrate: boolean) => {
    if (pending.current) return pending.current;
    if (!state.workspace || state.readOnly || state.dirty || !query.data || query.data.revision !== state.workspace.revision) throw new Error('请先保存或撤销输入修改，再核对资源版本');
    const fields = { expected_revision: query.data.revision, ...(migrate ? {} : { role, target_id: target?.id, resource_id: resourceId || null }) };
    const key = JSON.stringify([state.workspace.id, migrate, fields]);
    if (attempt.current?.key !== key) attempt.current = { key, body: { ...fields, request_id: crypto.randomUUID() } };
    pending.current = request(state.workspace.id, migrate ? '/migrate' : '/bind', attempt.current.body);
    try { return await pending.current; } finally { pending.current = null; }
  }, onSuccess: async (result, migrate) => {
    attempt.current = null;
    setNotice(result.changed?.length ? `已更新 ${result.changed.length} 项绑定` : migrate ? '没有新增的唯一匹配；未绑定条目需人工选择' : '绑定未变化'); setOpen(false); state.reload();
    await queries.invalidateQueries({ queryKey: ['type-resource-bindings', state.workspace?.id] });
    await queries.invalidateQueries({ queryKey: ['type-specification', state.workspace?.id] });
    await queries.invalidateQueries({ queryKey: ['type-requirements', state.workspace?.id] });
    await queries.invalidateQueries({ queryKey: ['object-relations'] });
  } });
  useEffect(() => { if (!open && !mutation.isPending && mutation.isSuccess) trigger.current?.focus(); }, [open, mutation.isPending, mutation.isSuccess]);
  if (state.readOnly) return null;
  const disabled = state.dirty || state.busy || mutation.isPending || query.isPending || !!query.error;
  const unbound = targets.filter(t => t.state === 'unbound').length;
  return <div className="type-resource-controls">
    <Button ref={trigger} variant="outline" size="compact" disabled={disabled} onClick={() => { setChosen(materialId || targets[0]?.id || ''); setResourceId(targets[0]?.binding?.resource_id || ''); mutation.reset(); setOpen(true); }}>绑定{role === 'material' ? '材料' : '标准'}版本</Button>
    {!materialId && <Button variant="ghost" size="compact" disabled={disabled} loading={mutation.isPending} onClick={() => mutation.mutate(true)} title="只写入明确身份的唯一匹配；保留已有选择，不按名称猜测">核对唯一匹配</Button>}
    {query.isPending && <StatusMark kind="running" label="正在读取资源绑定" />}
    {!query.isPending && !query.error && unbound > 0 && <StatusMark kind="unknown" label={`${unbound} 项未绑定资源`} />}
    {query.error && <span role="alert" className="field-error">{message(query.error)} <Button variant="ghost" size="compact" onClick={() => void query.refetch()}>重试</Button></span>}
    {!open && mutation.error && <span role="alert" className="field-error">{message(mutation.error)}</span>}
    {notice && <span role="status">{notice}</span>}
    <Dialog open={open} onOpenChange={value => { if (!mutation.isPending) setOpen(value); }} title={role === 'material' ? '绑定材料资源版本' : '绑定执行标准版本'}
      actions={<Button variant="primary" disabled={disabled || !target || selectionUnavailable} loading={mutation.isPending} title={selectionUnavailable ? '当前固定版本已不可新选；请明确选择已发布版本，或关闭以保留原引用。' : undefined} onClick={() => mutation.mutate(false)}>确认绑定</Button>}>
      {query.isPending ? <LoadingState title="正在读取资源版本" /> : query.error ? <ErrorState title="资源不可用" description={message(query.error)} /> : !targets.length ? <InlineEmpty title="尚无已核对的执行版本或已批准要求；在要求清单里核对来源。" /> : <div className="type-create-fields">
        <Select label={role === 'material' ? '设计材料' : '执行标准'} value={target?.id || ''} options={targets.map(t => ({ value: t.id, label: t.name }))} onChange={id => { setChosen(id); setResourceId(targets.find(t => t.id === id)?.binding?.resource_id || ''); }} />
        {fixed && <div aria-label="当前固定版本">
          <p>当前固定版本：{versionLabel(fixed)}</p>
          {fixedUnavailable && <p className="muted">{target?.reason} 当前版本已不可新选，原引用仍保留。重新绑定请选择已发布版本；关闭弹窗会保留原引用。</p>}
        </div>}
        <Select label="资源版本" value={resourceId} options={[{ value: '', label: '未绑定资源' },
          ...(fixed && fixedUnavailable ? [{ value: fixedId, label: versionLabel(fixed) + '（当前固定，不能新选）', disabled: true }] : []),
          ...resources.map(resource => ({ value: resource.id, label: versionLabel(resource) }))]} onChange={setResourceId} />
        {fixed && !resourceId && <p className="muted">确认后将解除当前固定引用；设计材料参数保持当前保存值。</p>}
        {!resources.length && <InlineEmpty title="资源库尚无对应类别的已发布版本" />}
        <span className="muted">{target?.match_reason}</span>
        <span className="muted">固定来源引用；设计材料参数保持当前保存值。</span>
        {mutation.error && <p role="alert" className="field-error">{message(mutation.error)}</p>}
      </div>}
    </Dialog>
  </div>;
}
