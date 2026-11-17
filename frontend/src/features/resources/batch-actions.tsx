import { useEffect, useRef, useState } from 'react';
import { message } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { AssetEvidence } from './asset-actions';
import { downloadAssetDefinitions, getAsset, transitionAsset, transitionConfirmed, uncertainWrite, type TransitionRequest } from './api';
import { assetActions, transitionProblem, type Asset, type AssetAction } from './definitions';
import './resources.css';

export type ResourceOperation = AssetAction | 'export';
type Item = { id: string; name: string; asset?: Asset; selected: boolean; acknowledged: boolean; request?: TransitionRequest;
  state: 'loading' | 'ready' | 'blocked' | 'running' | 'success' | 'failed' | 'uncertain' | 'stopped'; reason: string; retryAllowed?: boolean };
type Receipt = { token: string; action: AssetAction; items: Item[]; note: string };
const RECEIPT = 'cablesim:resource-operation-pending';
export function pendingResourceOperation(): Receipt | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(RECEIPT) || 'null');
    if (!saved || typeof saved.token !== 'string' || !(saved.action in assetActions) || !Array.isArray(saved.items) || typeof saved.note !== 'string') return null;
    return { ...saved, items: saved.items.map((item: Item) => ({ ...item, state: item.state === 'running' ? 'uncertain' : item.state,
      reason: item.state === 'running' ? '上次请求的响应未确认；请先读取真实版本历史。' : item.reason })) };
  } catch { return null; }
}
const states: Record<Item['state'], string> = { loading: '正在预检', ready: '可操作', blocked: '条件不足', running: '正在执行', success: '已完成', failed: '失败', uncertain: '待核实', stopped: '未执行' };

/** One shared workflow for single and bulk transitions; it never chains review into publication. */
export function ResourceOperationsDialog({ open, onClose, onChanged, onInspect, operation, ids, resume }: {
  open: boolean; onClose: () => void; onChanged: () => void; onInspect: (id: string) => void;
  operation: ResourceOperation; ids: { id: string; name: string }[]; resume?: Receipt | null;
}) {
  const mode = resume?.action || operation;
  const token = useRef(resume?.token || crypto.randomUUID());
  const [items, setItems] = useState<Item[]>(resume?.items || ids.map(row => ({ ...row, selected: true, acknowledged: false, state: 'loading', reason: '' })));
  const current = useRef(items), mounted = useRef(true), busyRef = useRef(false), stop = useRef(false), prepared = useRef(false);
  const [busy, setBusy] = useState(false), [note, setNote] = useState(resume?.note || ''), [error, setError] = useState(''), [started, setStarted] = useState(!!resume);
  const frozenNote = useRef(resume?.note || '');
  const unknown = items.some(item => item.state === 'uncertain' || item.state === 'running');
  const ready = items.filter(item => item.selected && item.state === 'ready');
  const actionLabel = mode === 'export' ? '导出定义' : assetActions[mode];

  function replace(next: Item[], persist = started) {
    if (!mounted.current) return;
    if (persist && mode !== 'export') {
      const record: Receipt = { token: token.current, action: mode, items: next.map(item => ({ ...item, asset: item.asset ? { ...item.asset, events: [] } : undefined })), note: frozenNote.current };
      sessionStorage.setItem(RECEIPT, JSON.stringify(record));
    }
    current.current = next; setItems(next);
  }
  function update(id: string, patch: Partial<Item>, persist = started) { replace(current.current.map(item => item.id === id ? { ...item, ...patch } : item), persist); }
  async function prepare(onlyFailed = false) {
    if (busyRef.current || current.current.some(item => item.state === 'uncertain')) return;
    busyRef.current = true; stop.current = false; setBusy(true); setError('');
    const candidates = current.current.filter(item => !onlyFailed || ['failed', 'blocked', 'stopped'].includes(item.state));
    // Read only selected records, never every full definition on the catalogue's first screen.
    try {
      for (const item of candidates) {
        if (!mounted.current) break;
        if (stop.current) { update(item.id, { state: 'stopped', reason: '已停止剩余预检；本项没有发送修改请求。' }); continue; }
        update(item.id, { state: 'loading', reason: '' });
        try {
          const asset = await getAsset(item.id);
          if (!mounted.current) break;
          const reason = mode === 'export' ? '' : transitionProblem(asset, mode);
          update(item.id, { asset, name: asset.name, state: reason ? 'blocked' : 'ready', reason, request: undefined, acknowledged: false });
        } catch (failure) { update(item.id, { state: 'failed', reason: message(failure) }); }
      }
    } catch (failure) { if (mounted.current) setError(`无法保留预检记录：${message(failure)}`); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }
  useEffect(() => {
    mounted.current = true;
    if (!prepared.current) { prepared.current = true; if (!resume) void prepare(); }
    return () => { mounted.current = false; stop.current = true; };
    // The parent keys the dialog by a new operation, preserving one frozen batch per instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function execute(retryUnknown = false) {
    if (busyRef.current || unknown && !retryUnknown) return;
    if (mode !== 'export' && (note.trim().length < 4 || note.length > 1000)) { setError('请填写 4 至 1000 个字符的操作说明；每条资源历史都会记录这段说明。'); return; }
    const chosen = current.current.filter(item => retryUnknown ? item.state === 'uncertain' && item.retryAllowed && item.request : item.selected && item.state === 'ready');
    if (!chosen.length) return;
    if (mode === 'review' && chosen.some(item => !item.acknowledged)) { setError('请逐项查看参数和来源，并明确勾选已核对。'); return; }
    busyRef.current = true; stop.current = false; setBusy(true); setError('');
    try {
      if (mode === 'export') {
        downloadAssetDefinitions(chosen.map(item => item.asset!));
        replace(current.current.map(item => chosen.some(row => row.id === item.id) ? { ...item, state: 'success', reason: '已下载固定版本 JSON；来源与版本摘要随文件保留。' } : item), false);
        setStarted(true); return;
      }
      frozenNote.current = note.trim();
      for (const item of chosen) {
        if (!mounted.current) break;
        if (stop.current) { update(item.id, item.state === 'uncertain' ? { reason: '本项没有重试，原请求仍待核实。' } : { state: 'stopped', reason: '本项尚未发送；已停止剩余操作。' }, true); continue; }
        const request = item.request || { action: mode, expected_revision: item.asset!.revision, content_sha256: item.asset!.content_sha256,
          note: frozenNote.current, acknowledge_sources: mode === 'review' && item.acknowledged };
        // Durable intent precedes every write. Failure here must not send a request.
        update(item.id, { request, state: 'running', reason: '', retryAllowed: false }, true); setStarted(true);
        try {
          const asset = await transitionAsset(item.id, request);
          if (!mounted.current) break;
          update(item.id, { asset, state: 'success', reason: `${actionLabel}已完成，记录在第 ${asset.revision} 次修订。` }, true);
          onChanged();
        } catch (failure) {
          if (!mounted.current) break;
          // A replay after an earlier timeout can receive 409 because the old
          // request just committed. Preserve that original request for history verification.
          const uncertain = uncertainWrite(failure) || !!item.request;
          update(item.id, { state: uncertain ? 'uncertain' : 'failed', reason: uncertain
            ? `${message(failure)}。结果尚未确认；已停止剩余项，请用原请求核实。` : message(failure) }, true);
          if (uncertain) stop.current = true;
        }
      }
    } catch (failure) { if (mounted.current) setError(`操作未继续：${message(failure)}。已发送的请求请先核实结果。`); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }
  async function verify() {
    if (busyRef.current || mode === 'export') return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      for (const item of current.current.filter(item => item.state === 'uncertain' || item.state === 'running')) {
        try {
          const asset = await getAsset(item.id);
          if (!mounted.current) break;
          if (item.request && transitionConfirmed(asset, item.request, mode)) {
            update(item.id, { asset, state: 'success', reason: '已从真实版本历史确认原操作完成。', retryAllowed: false }, true); onChanged();
          } else if (item.request && asset.revision === item.request.expected_revision && asset.content_sha256 === item.request.content_sha256) {
            update(item.id, { asset, state: 'uncertain', retryAllowed: true, reason: '目前尚未观察到原操作；原请求可能仍在处理中。可继续核实，或按保留的原请求重试，修订守卫会阻止重复操作。' }, true);
          } else update(item.id, { asset, retryAllowed: false, reason: '版本已有其他变化，尚不能确认原操作；请打开该资源核对历史，原请求仍保留。' }, true);
        } catch (failure) { update(item.id, { reason: `核实失败：${message(failure)}。原请求仍保留。` }, true); }
      }
    } catch (failure) { if (mounted.current) setError(message(failure)); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }
  function close() {
    stop.current = true;
    if (!busyRef.current && !current.current.some(item => item.state === 'uncertain' || item.state === 'running') && pendingResourceOperation()?.token === token.current)
      sessionStorage.removeItem(RECEIPT);
    onClose();
  }
  const disabledReason = busy ? '正在逐项读取或执行，请等待当前项完成。' : unknown ? '有待核实的原请求，请先核实结果。' : !ready.length ? '没有满足条件且已选中的资源，请查看每项原因。'
    : mode !== 'export' && note.trim().length < 4 ? '请填写至少四个字符的操作说明。' : mode === 'review' && ready.some(item => !item.acknowledged) ? '请逐项核对定义及来源并勾选确认。' : '';
  const counts = Object.entries(states).filter(([state]) => items.some(item => item.state === state)).map(([state, label]) => `${label} ${items.filter(item => item.state === state).length} 项`).join(' · ');
  return <Dialog open={open} onOpenChange={value => { if (!value) close(); }} title={`${ids.length > 1 ? '批量' : ''}${actionLabel}`} description="先读取真实版本预检，再按所选项逐条操作；每项显示结果和失败原因。" initialFocus="form"
    fallbackFocus={() => document.getElementById('resource-search')}
    actions={busy ? <Button onClick={() => { stop.current = true; setError('将在当前请求结束后停止；已发送的请求仍需核实实际结果。'); }}>停止剩余项</Button> : unknown ? <><Button variant="primary" onClick={() => void verify()}>核实原请求结果</Button>{items.some(item => item.state === 'uncertain' && item.retryAllowed) && <Button onClick={() => void execute(true)}>按原请求重试</Button>}</>
      : <Button variant="primary" disabled={!!disabledReason} onClick={() => void execute()}>{mode === 'export' ? `下载 ${ready.length} 项定义` : `确认${actionLabel} ${ready.length} 项`}</Button>}>
    <p role="status">共 {items.length} 项 · {counts}</p>
    {busy && <p className="muted">关闭会停止剩余项；已经发送的请求会保留原记录，稍后可核实实际结果。</p>}
    {error && <p className="field-error" role="alert">{error}</p>}
    <div className="resource-batch-body" data-resource-operation={mode}>
      {mode !== 'export' && <label className="text-field">操作说明<textarea aria-label="资源操作说明" value={note} maxLength={1000} disabled={busy || started} onChange={event => setNote(event.target.value)} placeholder="说明核对依据、发布范围或退回、停用原因" /></label>}
      {mode === 'publish' && <p>仅发布已经核对且依赖完整的版本。发布后可作为新引用；发布记录不等同于工程认证。</p>}
      {mode === 'return_to_draft' && <p>退回后需重新核对内容，再单独发布。</p>}
      {mode === 'deprecate' && <p>停用后不再允许新的引用，既有研究的固定版本记录仍保留。请确认停用范围。</p>}
      {items.map(item => <section className="resource-batch-item" key={item.id} data-resource-item={item.id} data-resource-state={item.state}>
        <div className="resource-form-row"><label><Checkbox checked={item.selected} aria-label={`选择操作资源 ${item.name}`} disabled={busy || started || !['ready', 'blocked', 'failed'].includes(item.state)} onCheckedChange={value => update(item.id, { selected: value === true }, false)} /> {item.name}</label><strong>{states[item.state]}</strong></div>
        {item.asset && <AssetEvidence asset={item.asset} />}
        {item.reason && <p role={item.state === 'failed' || item.state === 'uncertain' ? 'alert' : 'status'}>{item.reason}</p>}
        {mode === 'review' && item.state === 'ready' && <label className="resource-confirm"><Checkbox aria-label={`已核对资源 ${item.name}`} checked={item.acknowledged} disabled={busy || !!item.request} onCheckedChange={value => update(item.id, { acknowledged: value === true }, started)} /> 已核对这份定义及来源，理解原始资料的适用范围与缺项</label>}
        <Button size="compact" disabled={busy} onClick={() => { close(); onInspect(item.id); }}>打开此资源</Button>
      </section>)}
      {!busy && !unknown && items.some(item => ['failed', 'blocked', 'stopped'].includes(item.state)) && <Button onClick={() => void prepare(true)}>重新预检未完成项</Button>}
      {started && mode !== 'export' && <p className="muted">已开始的批次保留原说明和请求。核实后继续剩余项；如要填写新的说明，关闭后重新选择操作。</p>}
      {disabledReason && <p className="muted">{disabledReason}</p>}
    </div>
  </Dialog>;
}
