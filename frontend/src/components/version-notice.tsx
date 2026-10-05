import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, array, message, numeric, optionalRecord, record, responseData, text } from '@/api/client';
import type { components } from '@/api/generated/schema';
import { studyRuns } from '@/api/research';
import { isVersionStale, versionReasons } from '@/lib/version-status';
import { StatusMark } from './status-mark';
import { Dialog } from './ui/dialog';
import { Button } from './ui/button';

type Target = { wid: string; sid?: string; module?: string; runId?: string; revision?: number; studyRevision?: number; title?: string };
type Prepared = { wid: string; sid: string; title: string; body: components['schemas']['RecalculateStudy'] };
export function VersionNotice({ value, target, disabledReason, onComplete }: {
  value: unknown; target: Target; disabledReason?: string; onComplete?: (run: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState(false), [ack, setAck] = useState(false), [running, setRunning] = useState(false);
  const queries = useQueryClient(), controller = useRef<AbortController | null>(null), pending = useRef(false);
  const callback = useRef(onComplete); callback.current = onComplete;
  useEffect(() => () => controller.current?.abort(), []);
  const prepare = useMutation({ retry: false, mutationFn: async (): Promise<Prepared> => {
    if (target.sid && target.revision !== undefined && target.studyRevision !== undefined && target.title) return { wid: target.wid, sid: target.sid, title: target.title, body: { expected_revision: target.revision, expected_study_revision: target.studyRevision, request_id: crypto.randomUUID(), scope_acknowledged: true, ...(target.module ? {module: target.module} : {}) } };
    let sid = target.sid, module = target.module;
    if (!sid && target.runId) {
      const studies = array(await responseData(api.GET('/api/workspaces/{wid}/studies', { params: { path: { wid: target.wid } } })), '研究');
      for (const item of studies) {
        const study = record(item), candidate = text(study.id);
        const run = (await studyRuns(target.wid, candidate)).find(run => run.id === target.runId);
        if (run) { sid = candidate; module = text(optionalRecord(run.snapshot).module) || undefined; break; }
      }
    }
    if (!sid) throw new ApiError(422, '未找到此结果对应的研究，请从研究列表核对。');
    const [workspace, study] = await Promise.all([
      responseData(api.GET('/api/workspaces/{wid}', { params: { path: { wid: target.wid } } })),
      responseData(api.GET('/api/workspaces/{wid}/studies/{sid}', { params: { path: { wid: target.wid, sid } } })),
    ]);
    const revision = numeric(optionalRecord(workspace).revision);
    if (revision === null) throw new ApiError(502, '工程状态不完整，请刷新');
    return { wid: target.wid, sid, title: study.definition.title, body: { expected_revision: revision, expected_study_revision: study.revision, request_id: crypto.randomUUID(), scope_acknowledged: true, ...(module ? { module } : {}) } };
  } });
  const execute = useMutation({ retry: false, mutationFn: async () => {
    if (!ack || !prepare.data || disabledReason) throw new ApiError(409, '请先保存修改并确认适用范围');
    pending.current = true; setRunning(true);
    const source = prepare.data, abort = new AbortController(); controller.current = abort;
    try {
      let run = record(await responseData(api.POST('/api/workspaces/{wid}/studies/{sid}/recalculate', { params: { path: { wid: source.wid, sid: source.sid } }, body: source.body, signal: abort.signal })), '重算结果');
      for (let count = 0; ['accepted', 'queued', 'running', 'validating'].includes(text(run.status)); count++) {
        if (count >= 180) throw new ApiError(504, '计算仍在执行，请稍后从运行记录查看。');
        await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => { abort.signal.removeEventListener('abort', cancel); resolve(); }, 1500); function cancel() { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); } abort.signal.addEventListener('abort', cancel, { once: true }); });
        run = record(await responseData(api.GET('/api/workspaces/{wid}/studies/{sid}/runs/{rid}', { params: { path: { wid: source.wid, sid: source.sid, rid: text(run.id) } }, signal: abort.signal })), '重算进度');
      }
      if (!['succeeded', 'partial'].includes(text(run.status))) throw new ApiError(422, '重算未完成，请在运行记录查看失败原因。');
      if (run.integrity !== 'verified') throw new ApiError(409, '重算结果完整性未通过，请在运行记录核对。');
      return run;
    } finally { pending.current = false; setRunning(false); }
  }, onSettled: () => { pending.current = false; }, onSuccess: async run => {
    setOpen(false);
    callback.current?.(run);
    await Promise.all(['study-index', 'study-context', 'workspace', 'runs', 'run-history', 'deliveries', 'delivery', 'archived-delivery'].map(key => queries.invalidateQueries({ queryKey: [key] })));
  } });
  function errorText(error: unknown) {
    if (error instanceof ApiError && optionalRecord(error.detail).code === 'MODEL_REBASE_REQUIRED') return '请先合并型号新版本';
    if (error instanceof ApiError && error.status === 409) return '数据已被修改，请刷新';
    const detail = message(error);
    return /cablesim\.|[a-f0-9]{32,}|\/[a-z_]+\//i.test(detail) ? '重算失败，请查看运行记录并核对适用范围。' : detail;
  }
  if (!isVersionStale(value) && !open) return null;
  const reasons = versionReasons(value), error = prepare.error || execute.error;
  return <>
    <span className="version-notice" onClick={event => event.stopPropagation()}>
      <StatusMark kind="historical" label="结果已过期" detail={<ul>{(reasons.length ? reasons : ['请核对输入与方法的新版本。']).map(reason => <li key={reason}>{reason}</li>)}</ul>} />
      <span aria-hidden="true">·</span><Button variant="ghost" size="compact" disabled={!!disabledReason || running} title={disabledReason} onClick={() => { setOpen(true); setAck(false); execute.reset(); prepare.mutate(); }}>重算</Button>
      {disabledReason && <span className="muted">{disabledReason}</span>}
    </span>
    <Dialog open={open} onOpenChange={value => { if (!running) setOpen(value); }} title="按当前版本重算" description="采用当前已保存输入和当前方法版本，宿主会重新预检；旧结果与存档保留。" actions={<Button variant="run" disabled={!prepare.data || prepare.isPending || !ack || !!disabledReason || running} loading={running} onClick={() => { if (!pending.current) { pending.current = true; execute.mutate(); } }}>确认范围并重算</Button>}>
      {prepare.isPending ? <StatusMark kind="running" label="正在读取重算条件" /> : prepare.data && <div className="input-section"><p>{prepare.data.title}</p><ul>{reasons.map(reason => <li key={reason}>{reason}</li>)}</ul><label className="scope-ack"><input type="checkbox" checked={ack} disabled={running} onChange={event => setAck(event.target.checked)} />已核对已保存输入、型号变更与方法适用范围</label></div>}
      {running && <StatusMark kind="running" label="正在重算，旧结果保留" />}
      {error && <p role="alert" className="field-error">{errorText(error)}</p>}
    </Dialog>
  </>;
}
