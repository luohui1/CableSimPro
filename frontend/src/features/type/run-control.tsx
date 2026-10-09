import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, array, message, optionalRecord, record, responseData, text } from '@/api/client';
import { methodCatalog } from '@/api/research';
import type { components } from '@/api/generated/schema';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { useTypeWorkspace } from './provider';
import { methodLabel } from './evidence';
import { missingTypeInputs } from './missing';

type Definition = Omit<components['schemas']['CreateStudy'], 'expected_revision'>;
type Prepared = { study: components['schemas']['StudyResponse']; preflight: components['schemas']['PreflightResponse']; revision: number };
type Attempt = { workspace: string; study: string; request: components['schemas']['RunStudy'] };
export async function methodForArtifact(artifact: string, signal?: AbortSignal, analysis?: string): Promise<components['schemas']['Method']> {
  for (const item of await methodCatalog(signal)) {
    if (item.platform_supported === false) continue;
    for (const value of array(item.capabilities, '方法能力')) {
      const capability = record(value, '方法能力');
      if (analysis && capability.analysis !== analysis || capability.input_schema !== 'cablesim.domain/1' || !Array.isArray(capability.artifacts) || !capability.artifacts.some(value => optionalRecord(value).type === artifact)) continue;
      const pin = record(item.method, '方法发行');
      if (!text(pin.plugin_id) || !text(pin.version) || !text(pin.release_digest) || !text(capability.id)) throw new ApiError(502, '已安装方法缺少精确发行身份');
      return { ...pin, capability: text(capability.id) } as components['schemas']['Method'];
    }
  }
  throw new ApiError(501, '尚未安装支持当前平台与本模块的计算方法');
}
export function TypeRunControl({ channel, label, definition, onBusy, unavailable, primary = true, locateIssue }: { channel: string; label: string; definition: () => Promise<Definition>; onBusy?: (busy: boolean) => void; unavailable?: string; primary?: boolean; locateIssue?: (message: string) => React.ReactNode }) {
  const state = useTypeWorkspace(), queries = useQueryClient();
  const [prepared, setPrepared] = useState<Prepared | null>(null), [open, setOpen] = useState(false), [ack, setAck] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef(false), attempt = useRef<Attempt | null>(null), mounted = useRef(true);
  const key = `cablesim:type-attempt:${state.workspace?.id}:${channel}`;
  useEffect(() => { mounted.current = true; try { const value = JSON.parse(sessionStorage.getItem(key) || 'null'); if (value?.workspace === state.workspace?.id && typeof value.study === 'string' && typeof value.request?.request_id === 'string') { attempt.current = value; setError('前次运行连接中断，可查询同一请求。'); } } catch { /* Storage failure does not change host data. */ } return () => { mounted.current = false; }; }, [key, state.workspace?.id]);
  function running(value: boolean) { if (mounted.current) setBusy(value); onBusy?.(value); }
  async function finished(run: components['schemas']['RunResponse'], study: string) {
    if (['accepted', 'running', 'validating', 'queued'].includes(run.status)) await queries.invalidateQueries({ queryKey: ['type-evidence', state.workspace!.id] });
    for (let iteration = 0; ['accepted', 'running', 'validating', 'queued'].includes(run.status); iteration++) {
      if (iteration >= 180) throw new ApiError(504, '运行仍在执行，可稍后查询同一请求');
      await new Promise(resolve => setTimeout(resolve, 2000));
      const next = await responseData(api.GET('/api/workspaces/{wid}/studies/{sid}/runs/{rid}', { params: { path: { wid: state.workspace!.id, sid: study, rid: run.id } } }));
      if (!next) throw new ApiError(502, '运行查询未返回记录'); run = next;
    }
    await queries.invalidateQueries({ queryKey: ['type-evidence', state.workspace!.id] });
    if (!['succeeded', 'partial'].includes(run.status)) throw new ApiError(422, text(optionalRecord(run.error).message) || '本次运行未取得有效结果');
    if (run.integrity !== 'verified') throw new ApiError(409, '本次运行完整性未通过，未采用结果');
    await queries.invalidateQueries({ queryKey: ['type-studies', state.workspace!.id] });
    await Promise.all(['type-specification', 'type-comparison'].map(key => queries.invalidateQueries({ queryKey: [key, state.workspace!.id] })));
    await queries.invalidateQueries({ queryKey: ['object-relations', 'type', state.workspace!.id] });
    sessionStorage.removeItem(key); attempt.current = null; if (mounted.current) setOpen(false);
  }
  async function execute(retry = false) {
    if (pending.current || !state.workspace || state.dirty || state.readOnly) return;
    if (!retry && (!prepared?.preflight.ready || !ack || prepared.revision !== state.workspace.revision)) return;
    if (!retry) {
      attempt.current = { workspace: state.workspace.id, study: prepared!.study.id, request: { request_id: crypto.randomUUID(), expected_revision: prepared!.revision, expected_study_revision: prepared!.study.revision, lock_digest: prepared!.preflight.lock_digest, scope_acknowledged: true } };
      try { sessionStorage.setItem(key, JSON.stringify(attempt.current)); } catch { /* The in-memory identity still protects this attempt. */ }
    }
    const active = attempt.current; if (!active) return;
    if (active.request.expected_revision !== state.workspace.revision) { setError('型号输入已变化，不能重试旧请求；先查看原运行记录。'); return; }
    pending.current = true; running(true); setError('');
    try {
      const run = await responseData(api.POST('/api/workspaces/{wid}/studies/{sid}/runs', { params: { path: { wid: active.workspace, sid: active.study } }, body: active.request }));
      if (!run) throw new ApiError(502, '运行响应未返回身份'); await finished(run, active.study);
    } catch (error) {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) { attempt.current = null; sessionStorage.removeItem(key); }
      if (mounted.current) setError(message(error));
    } finally { pending.current = false; running(false); }
  }
  async function prepare() {
    if (pending.current || !state.workspace || state.dirty || state.readOnly) return;
    if (attempt.current) { await execute(true); return; }
    pending.current = true; running(true); setError(''); setAck(false);
    try {
      const body = await definition();
      const study = await responseData(api.POST('/api/workspaces/{wid}/studies', { params: { path: { wid: state.workspace.id } }, body: { ...body, expected_revision: state.workspace.revision } }));
      if (!study) throw new ApiError(502, '方法配置未返回研究身份');
      const preflight = await responseData(api.GET('/api/workspaces/{wid}/studies/{sid}/preflight', { params: { path: { wid: state.workspace.id, sid: study.id }, query: { expected_revision: state.workspace.revision, expected_study_revision: study.revision } } }));
      if (!preflight) throw new ApiError(502, '预检未返回结果');
      if (mounted.current) { setPrepared({ study, preflight, revision: state.workspace.revision }); setOpen(true); }
    } catch (error) { if (mounted.current) setError(message(error)); } finally { pending.current = false; running(false); }
  }
  const reason = unavailable || (state.document && missingTypeInputs(state.document).length ? '结构缺项 · 先补齐型号名片中的字段' : state.dirty ? '请先保存型号输入' : state.readOnly ? state.workspace?.raw.fixed_run ? '运行快照保持只读' : '历史或已发布型号保持只读' : '');
  return <div className="type-run-control"><Button variant={primary ? 'primary' : 'default'} size="compact" loading={busy} disabled={!!reason || !state.workspace} onClick={() => void prepare()}>{attempt.current ? '查询同一运行' : label}</Button>
    {reason && <span className="muted">{reason}</span>}{error && <p className="field-error" role="alert">{error}</p>}
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }} title={label + ' · 预检'} description={prepared?.preflight.ready ? '保存输入已通过预检，确认范围后运行。' : '当前输入未通过预检，修正后重新提交。'}
      actions={<Button variant="primary" loading={busy} disabled={!ack || !prepared?.preflight.ready || state.dirty || state.workspace?.revision !== prepared?.revision} onClick={() => void execute()}>确认并运行</Button>}>
      <div className="type-create-fields">{prepared?.preflight.cases.filter(item => item.status !== 'succeeded').map(item => { const reason = text(optionalRecord(item.error).message) || item.status; return <div key={item.case_id}><p className="field-error">{reason}</p>{locateIssue?.(reason)}</div>; })}
        {prepared && <p className="type-meta" title={[prepared.study.definition.method.plugin_id, prepared.study.definition.method.release_digest].join(' · ')}>{methodLabel({ snapshot: { definition: prepared.study.definition } })}</p>}
        <ul>{prepared?.preflight.limitations.map(item => <li key={item}>{item}</li>)}</ul>{prepared?.preflight.ready && <label><input type="checkbox" checked={ack} onChange={event => setAck(event.target.checked)} /> 已核对输入来源与方法适用范围</label>}</div>
    </Dialog>
  </div>;
}
