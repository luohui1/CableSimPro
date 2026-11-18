import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, array, message, numeric, optionalRecord, text } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { downloadBlob } from '@/lib/download';
import { loadWorkspace, type TypeRow } from './api';
import { cleanLabel } from './labels';
import { localTime, versionLabel } from './design-summary';
import { MethodErrorDetail, methodErrorText } from './method-error';
import { typePath, useTypeNavigation } from './navigation';
import { branchType, exportSpecification, generateSpecification, lifecycleAction, typeSpecification, type Specification, type SpecificationAudience } from './version-api';

type Action = 'generate' | 'download' | 'branch' | 'submit';
type State = 'checking' | 'ready' | 'blocked' | 'running' | 'success' | 'failed' | 'stopped';
type Attempt = { id: string; key: string; name: string; author: string; summary: string };
type BatchRow = Pick<TypeRow, 'id' | 'name' | 'version' | 'updated' | 'raw'>;
type Item = {
  row: BatchRow; revision: number; state: State; reason: string; included: boolean;
  name: string; author: string; summary: string; spec?: Specification;
  attempt?: Attempt; uncertain?: boolean; destination?: string; blob?: Blob; filename?: string; diagnostic?: string;
  steps?: { channel: string; status: string }[];
};
type Receipt = { version: 1; id: string; action: Action; audience: SpecificationAudience; items: Item[] };
const receiptKey = 'cablesim:type-batch:receipt';
const actions: Record<Action, string> = { generate: '生成规格书', download: '下载规格书', branch: '建立方案', submit: '提交审核' };
const stateLabels: Record<State, string> = { checking: '正在核对', ready: '可操作', blocked: '暂不可操作', running: '正在执行', success: '已完成', failed: '未完成', stopped: '已停止' };
const channels = [
  ['geometry', '结构与用料', 'structure', 'quantities'],
  ['electrical', '电气参数', 'electrical', 'parameters'],
  ['rating', '载流量表', 'rating-table', 'parameters'],
  ['short_circuit', '短路容量', 'short-circuit', 'parameters'],
  ['standards', '标准核对', 'standard-check', 'results'],
] as const;

export function typePlanName(row: Pick<TypeRow, 'raw'>) { return text(optionalRecord(row.raw.type_lifecycle).name); }
export function typeRowLabel(row: Pick<TypeRow, 'raw' | 'name'>) { return cleanLabel(row.name) + (typePlanName(row) ? ' · ' + typePlanName(row) : ''); }
function checks(spec?: Specification) { return spec ? array(spec.payload.checks, '规格书校核').map(optionalRecord) : []; }
function sources(spec?: Specification) { return spec ? array(spec.payload.sources, '规格书来源').map(optionalRecord) : []; }
function submissionReason(spec: Specification) {
  if (spec.lifecycle.status === 'published') return '已发布版本不可再次提交；需要修改时请先建立方案。';
  if (['submitted', 'approved'].includes(text(spec.lifecycle.status)) && !spec.lifecycle.stale) return spec.lifecycle.status === 'approved' ? '当前内容已批准，请在规格书页由人工处理后续发布。' : '当前内容已经提交审核，无需重复提交。';
  if (optionalRecord(spec.payload.plan_reference).status !== 'version_draft') return '请先在方案对比中采纳为新版本草稿。';
  const blocking = checks(spec).filter(check => check.blocking === true);
  if (!spec.ready || blocking.length) return '当前有 ' + blocking.length + ' 项阻止发布的校核问题，请在规格书页处理后再提交。';
  if (sources(spec).some(source => source.freshness !== 'current')) return '规格书引用了历史结果，请生成当前规格书后再提交。';
  return '';
}
function formReason(item: Item, action: Action) {
  if (action === 'branch' && (!item.name.trim() || item.name.trim().length > 80)) return '请填写 1～80 个字符的新方案名称。';
  if (action === 'submit' && (!item.author.trim() || !item.summary.trim())) return '请填写编制人与变更摘要。';
  if (action === 'submit' && (item.author.trim().length > 120 || item.summary.trim().length > 500)) return '编制人不得超过 120 个字符，变更摘要不得超过 500 个字符。';
  return '';
}
function pdfName(item: Item, audience: SpecificationAudience, index: number) {
  return String(index + 1).padStart(2, '0') + '-' + typeRowLabel(item.row).replace(/[\\/:*?"<>|]/g, '-') + '-' + (audience === 'customer' ? '客户版' : '内部审核版') + '.pdf';
}
function rememberedAttempt(item: Item, action: Action, audience: SpecificationAudience): Attempt {
  if (item.attempt) return item.attempt;
  const identity = { action, workspace: item.row.id, revision: item.revision, audience,
    digest: action === 'submit' ? item.spec?.digest : undefined,
    name: action === 'branch' ? item.name.trim() : undefined,
    author: action === 'submit' ? item.author.trim() : undefined,
    summary: action === 'submit' ? item.summary.trim() : undefined };
  const key = 'cablesim:type-batch:' + JSON.stringify(identity);
  let id: string;
  try {
    id = sessionStorage.getItem(key) || crypto.randomUUID();
    sessionStorage.setItem(key, id);
  } catch { throw new ApiError(503, '浏览器无法保存请求标识，请允许本站使用会话存储后重试。'); }
  return { id, key, name: item.name.trim(), author: item.author.trim(), summary: item.summary.trim() };
}
function forgetAttempt(attempt: Attempt) {
  try { sessionStorage.removeItem(attempt.key); } catch { /* A confirmed server result remains successful if local cleanup fails. */ }
}
async function within<T>(request: Promise<T>, seconds: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([request, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ApiError(504, label + '超过 ' + seconds + ' 秒，当前页面已停止等候。')), seconds * 1000);
    })]);
  } finally { clearTimeout(timer); }
}
function savedItems(items: Item[]): Item[] {
  // Keep the original validated specification for exact request replay. Domain
  // documents and PDF blobs are not needed to recover the operation.
  return items.map(({ blob: _blob, row, ...item }) => ({ ...item, row: { id: row.id, name: row.name, version: row.version, updated: row.updated,
    raw: { revision: row.raw.revision, type_lifecycle: row.raw.type_lifecycle } } }));
}
function readReceipt(): { receipt?: Receipt; error: string } {
  try {
    const saved = sessionStorage.getItem(receiptKey);
    if (!saved) return { error: '' };
    const value = optionalRecord(JSON.parse(saved));
    if (value.version !== 1 || !text(value.id) || !Object.hasOwn(actions, text(value.action)) || !['customer', 'internal'].includes(text(value.audience)) || !Array.isArray(value.items) || !value.items.length) throw new Error('批次格式不完整');
    const items = value.items.map((entry): Item => {
      const item = optionalRecord(entry), row = optionalRecord(item.row), attempt = optionalRecord(item.attempt), spec = optionalRecord(item.spec), payload = optionalRecord(spec.payload);
      if (!text(row.id) || typeof row.name !== 'string' || typeof row.version !== 'string' || typeof row.updated !== 'string' || !row.raw || !Number.isInteger(item.revision) || Number(item.revision) < 0
        || !Object.hasOwn(stateLabels, text(item.state)) || typeof item.included !== 'boolean' || typeof item.reason !== 'string' || !['name', 'author', 'summary'].every(key => typeof item[key] === 'string')) throw new Error('条目缺少原有身份或填写内容');
      if (item.diagnostic !== undefined && typeof item.diagnostic !== 'string') throw new Error('条目诊断格式不完整');
      if (item.attempt && (!text(attempt.id) || !text(attempt.key) || !['name', 'author', 'summary'].every(key => typeof attempt[key] === 'string'))) throw new Error('条目缺少原请求标识');
      if ((item.uncertain || item.state === 'running') && value.action !== 'download' && !item.attempt) throw new Error('待核实条目缺少原请求标识');
      if ((item.uncertain || item.state === 'running') && !['branch', 'download'].includes(text(value.action)) && !item.spec) throw new Error('待核实条目缺少原规格书');
      if (item.spec && (payload.workspace_id !== row.id || payload.revision !== item.revision || !Array.isArray(payload.checks) || !Array.isArray(payload.sources)
        || !/^[a-f0-9]{64}$/.test(text(spec.digest)) || typeof spec.html !== 'string' || typeof spec.ready !== 'boolean' || !['customer', 'internal'].includes(text(spec.audience)))) throw new Error('规格书恢复内容不完整');
      const restored = entry as Item;
      if (restored.state === 'running') return { ...restored, state: 'failed', uncertain: value.action !== 'download', included: true,
        reason: value.action === 'download' ? '上次下载未确认，可重新下载。' : '上次页面在等候结果时关闭；请使用原请求核实，服务端操作可能已经完成。' };
      if (restored.state === 'checking') return { ...restored, state: 'blocked', included: false, reason: '上次核对未完成，请重新核对未完成项。' };
      return restored.uncertain ? { ...restored, included: true } : restored;
    });
    if (new Set(items.map(item => item.row.id)).size !== items.length) throw new Error('批次型号身份重复');
    return { receipt: { version: 1, id: text(value.id), action: value.action as Action, audience: value.audience as SpecificationAudience, items }, error: '' };
  } catch (error) { return { error: '无法读取上次批量操作记录：' + message(error) + '。为避免丢失待核实请求，暂不能覆盖批次；请恢复本站会话存储后重新读取。' }; }
}

export function TypeBatchActions({ selected, hiddenCount, inactive = false, onClear }: { selected: TypeRow[]; hiddenCount: number; inactive?: boolean; onClear: () => void }) {
  const navigation = useTypeNavigation(), queries = useQueryClient();
  const [recovery] = useState(readReceipt);
  const [action, setAction] = useState<Action>(recovery.receipt?.action || 'generate'), [audience, setAudience] = useState<SpecificationAudience>(recovery.receipt?.audience || 'customer');
  const [open, setOpen] = useState(false), [items, setItems] = useState<Item[]>(recovery.receipt?.items || []), [ack, setAck] = useState(false);
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [stopping, setStopping] = useState(false), [started, setStarted] = useState(!!recovery.receipt);
  const [batchAction, setBatchAction] = useState<Action>(recovery.receipt?.action || 'generate'), [batchAudience, setBatchAudience] = useState<SpecificationAudience>(recovery.receipt?.audience || 'customer');
  const [commonAuthor, setCommonAuthor] = useState(''), [commonSummary, setCommonSummary] = useState('');
  const [recoveryError, setRecoveryError] = useState(recovery.error), [storageWarning, setStorageWarning] = useState('');
  const read = useRef<AbortController | null>(null), stop = useRef(false), running = useRef(false), mounted = useRef(true);
  const opener = useRef<HTMLElement | null>(null), previewButton = useRef<HTMLButtonElement | null>(null), resultButton = useRef<HTMLButtonElement | null>(null);
  const currentItems = useRef(items), receipt = useRef<Receipt | null>(recovery.receipt || null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; stop.current = true; read.current?.abort(); }; }, []);
  function replaceItems(next: Item[], required = false) {
    // Leave the persisted running request for the next page to resolve. A late
    // response from this instance must not overwrite a restored page's progress,
    // even when both pages refer to the same batch.
    if (!mounted.current) return;
    currentItems.current = next;
    setItems(next);
    if (receipt.current) {
      receipt.current = { ...receipt.current, items: next };
      try {
        sessionStorage.setItem(receiptKey, JSON.stringify({ ...receipt.current, items: savedItems(next) }));
        if (mounted.current) setStorageWarning('');
      } catch {
        const reason = '浏览器无法保存本批次的恢复记录。请释放本站会话存储空间后重试；尚未发送的请求不会发出。';
        if (mounted.current) setStorageWarning(reason);
        if (required) throw new ApiError(503, reason);
      }
    }
  }
  function patch(id: string, value: Partial<Item>, required = false) { replaceItems(currentItems.current.map(item => item.row.id === id ? { ...item, ...value } : item), required); }
  function edit(id: string, value: Partial<Item>) { setAck(false); patch(id, value); }
  function show() {
    if (!open) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setAck(false); setOpen(true);
  }
  function retryRecovery() {
    const next = readReceipt(); setRecoveryError(next.error);
    if (!next.receipt) return;
    receipt.current = next.receipt; replaceItems(next.receipt.items); setStarted(true);
    setAction(next.receipt.action); setAudience(next.receipt.audience); setBatchAction(next.receipt.action); setBatchAudience(next.receipt.audience);
    show();
  }
  function close(value: boolean) {
    if (!value && running.current) return;
    if (!value) { read.current?.abort(); setLoading(false); setAck(false); }
    setOpen(value);
  }
  async function prepare(onlyUnfinished = false) {
    if (recoveryError || running.current) return;
    if (currentItems.current.some(item => item.uncertain)) { show(); return; }
    const candidates = onlyUnfinished ? currentItems.current.filter(item => item.state !== 'success').map(item => item.row) : selected;
    const operation = onlyUnfinished ? batchAction : action, documentAudience = onlyUnfinished ? batchAudience : audience;
    if (!candidates.length) return;
    read.current?.abort();
    const controller = new AbortController(); read.current = controller;
    show(); setLoading(true); if (!onlyUnfinished) { receipt.current = null; setStarted(false); } setStopping(false);
    setBatchAction(operation); setBatchAudience(documentAudience); setCommonAuthor(''); setCommonSummary('');
    const initial: Item[] = candidates.map((row, index) => {
      const previous = onlyUnfinished ? currentItems.current.find(item => item.row.id === row.id) : undefined;
      if (previous?.attempt && !previous.uncertain) forgetAttempt(previous.attempt);
      return { row, revision: numeric(row.raw.revision) || 0, state: 'checking', reason: '', included: true,
        name: previous?.name || (typePlanName(row) || '新') + '方案 ' + (index + 1), author: previous?.author || '', summary: previous?.summary || '' };
    });
    replaceItems(onlyUnfinished ? currentItems.current.map(item => initial.find(next => next.row.id === item.row.id) || item) : initial);
    for (let offset = 0; offset < initial.length && !controller.signal.aborted; offset += 4) {
      await Promise.all(initial.slice(offset, offset + 4).map(async item => {
        try {
          const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]);
          const workspace = await loadWorkspace(item.row.id, signal);
          const row = { ...item.row, name: workspace.document.name, document: workspace.document, raw: workspace.raw, updated: text(workspace.raw.updated_at) };
          let spec: Specification | undefined, reason = '';
          if (operation !== 'branch') {
            spec = await typeSpecification(row.id, signal, operation === 'submit' ? 'customer' : documentAudience);
            if (numeric(spec.payload.revision) !== workspace.revision) throw new ApiError(409, '读取期间型号已变化，请重新核对。');
            if (operation === 'generate') {
              if (spec.lifecycle.status === 'published') reason = '已发布版本内容固定，请使用“下载规格书”。';
              else if (!spec.generationEndpoint) reason = '当前服务未提供规格书生成操作。';
            } else if (operation === 'download') {
              if (!spec.exportEndpoint) reason = '当前服务未提供 PDF 导出。';
              else if (documentAudience === 'customer' && (!sources(spec).length || sources(spec).some(source => source.freshness !== 'current'))) reason = '尚无当前有效的规格书结果；请先生成，或选择内部审核版查看真实缺项。';
            } else reason = submissionReason(spec);
          }
          if (!controller.signal.aborted) patch(row.id, { row, revision: workspace.revision, spec, state: reason ? 'blocked' : 'ready', reason, included: !reason,
            author: item.author || text(spec?.revisionDraft.author), summary: item.summary || text(spec?.revisionDraft.summary) });
        } catch (error) {
          if (!controller.signal.aborted) patch(item.row.id, { state: 'blocked', reason: error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name) ? '读取超过 30 秒，请重新核对该型号。' : methodErrorText(message(error)), diagnostic: message(error), included: false });
        }
      }));
    }
    if (!controller.signal.aborted && mounted.current) setLoading(false);
  }
  function refresh(wid: string) {
    // A background read must not change a confirmed mutation into a failed one.
    void Promise.allSettled([['type-specification', wid], ['type-evidence', wid], ['type-studies', wid], ['type-workspace', wid],
      ['type-comparison'], ['type-list'], ['object-relations'], ['inbox']].map(queryKey => queries.invalidateQueries({ queryKey })));
  }
  async function execute() {
    if (running.current || loading || !ack || recoveryError) return;
    const resolving = currentItems.current.some(item => item.uncertain);
    const chosen = currentItems.current.filter(item => item.included && ['ready', 'failed', 'stopped'].includes(item.state) && (!resolving || item.uncertain));
    if (chosen.some(item => !!formReason(item, batchAction))) return;
    const queue = chosen;
    if (!queue.length) return;
    receipt.current ||= { version: 1, id: crypto.randomUUID(), action: batchAction, audience: batchAudience, items: currentItems.current };
    running.current = true; stop.current = false; setBusy(true); setStarted(true); setStopping(false); setAck(false);
    let stopReason = '尚未执行；可重新确认后继续。';
    for (const original of queue) {
      if (stop.current || !mounted.current) {
        patch(original.row.id, { state: original.uncertain ? 'failed' : 'stopped', reason: original.uncertain ? original.reason : stopReason }); continue;
      }
      let item = original;
      let dispatched = false;
      try {
        if (batchAction === 'download') {
          if (!item.spec) throw new ApiError(409, '规格书尚未读取，请重新核对。');
          patch(item.row.id, { state: 'running', diagnostic: undefined, reason: '正在核验并下载 PDF，最多等候 90 秒。' }, true);
          const blob = await within(exportSpecification(item.row.id, item.spec), 90, 'PDF 下载'), filename = pdfName(item, batchAudience, currentItems.current.findIndex(value => value.row.id === item.row.id));
          if (mounted.current) downloadBlob(blob, filename);
          patch(item.row.id, { state: 'success', reason: 'PDF 已核验并发起下载。浏览器若拦截多文件下载，可使用此项的下载按钮。', blob, filename });
          continue;
        }
        if (batchAction !== 'branch' && !item.spec) throw new ApiError(409, '规格书尚未读取，请重新核对。');
        const attempt = rememberedAttempt(item, batchAction, batchAudience);
        item = { ...item, attempt };
        // Persist the complete, frozen request before allowing the write to leave
        // the browser. A timed-out write may still finish on the server.
        patch(item.row.id, { attempt, state: 'running', diagnostic: undefined, reason: '正在' + actions[batchAction] + '，本项最多等候 ' + (batchAction === 'generate' ? '240' : '60') + ' 秒。' }, true);
        dispatched = true;
        if (batchAction === 'branch') {
          const wid = await within(branchType(item.row.id, { expected_revision: item.revision, request_id: attempt.id, name: attempt.name }), 60, '建立方案');
          forgetAttempt(attempt);
          patch(item.row.id, { state: 'success', uncertain: false, reason: '已建立独立草稿方案：' + attempt.name + '。', destination: typePath(wid, 'structure', 'section', navigation.location.theme) });
        } else if (batchAction === 'submit') {
          const result = optionalRecord(await within(lifecycleAction(item.row.id, 'submissions', { expected_revision: item.revision, request_id: attempt.id,
            specification_digest: item.spec!.digest, acknowledge_checks: true, author: attempt.author, change_summary: attempt.summary }), 60, '提交审核'));
          if (result.status !== 'submitted' || !text(result.submission_id) || result.digest !== item.spec!.digest) throw new ApiError(502, '服务未返回与原规格书一致的审核提交记录，请重试同一请求核实。');
          forgetAttempt(attempt);
          patch(item.row.id, { state: 'success', uncertain: false, reason: '已提交，等待人工审核。', destination: typePath(item.row.id, 'specification', 'review', navigation.location.theme) });
        } else {
          const result = await within(generateSpecification(item.row.id, item.spec!, item.revision, attempt.id), 240, '生成规格书');
          const steps = array(result.steps, '生成步骤').map(value => { const step = optionalRecord(value); return { channel: text(step.channel), status: text(step.status) }; });
          if (result.status === 'blocked') {
            const target = channels.find(([channel]) => channel === result.channel);
            forgetAttempt(attempt);
            patch(item.row.id, { state: 'failed', uncertain: false, attempt: undefined, steps, reason: methodErrorText(text(result.message)) || '预检未通过，已完成结果保留。', diagnostic: text(result.message),
              destination: typePath(item.row.id, target?.[2] || 'specification', target?.[3] || 'review', navigation.location.theme) });
          } else {
            if (!/^[a-f0-9]{64}$/.test(text(result.digest))) throw new ApiError(502, '生成结果缺少规格书内容摘要，请重试同一请求核实。');
            forgetAttempt(attempt);
            patch(item.row.id, { state: 'success', uncertain: false, steps, spec: undefined, reason: '生成已确认，正在读取最新规格书…',
              destination: typePath(item.row.id, 'specification', 'preview', navigation.location.theme) });
            try {
              const fresh = await within(typeSpecification(item.row.id, AbortSignal.timeout(30000), batchAudience), 30, '读取生成后的规格书');
              if (numeric(fresh.payload.revision) !== item.revision || fresh.digest !== result.digest) {
                patch(item.row.id, { reason: '原修订的规格书生成已确认；型号随后发生变化，请打开规格书查看当前内容。已完成的计算保留。' });
              } else patch(item.row.id, { spec: fresh, reason: fresh.ready ? '规格书已生成；审核与发布仍需分别处理。' : '规格书已生成，仍有阻止发布的校核事项，请查看清单。' });
            } catch (error) {
              patch(item.row.id, { reason: '规格书生成已确认，后续读取未完成：' + methodErrorText(message(error)) + '。请打开规格书查看已保存内容。', diagnostic: message(error) });
            }
          }
        }
        refresh(item.row.id);
      } catch (error) {
        const uncertain = !!item.uncertain || dispatched && (!(error instanceof ApiError) || error.status >= 500
          || batchAction === 'generate' && error.status === 409 && error.message.includes('已有规格书正在生成'));
        patch(item.row.id, { state: 'failed', uncertain, diagnostic: message(error),
          reason: methodErrorText(message(error)) + (uncertain ? ' 服务端操作未被取消，结果仍待核实。将保留原请求、修订与填写内容；重试可返回已保存结果或继续同一操作。无法确认时请打开型号核实保存记录。'
            : !dispatched && batchAction !== 'download' ? ' 本项请求尚未发送，请处理原因后重试。'
              : error instanceof ApiError && error.status === 409 ? ' 请重新核对未完成项，已完成项会保留。' : '') });
        if (uncertain) { stop.current = true; stopReason = '尚未发送；请先核实前项原请求，再继续此项。'; }
      }
    }
    running.current = false;
    if (mounted.current) { setBusy(false); setStopping(false); }
  }
  const unresolved = items.some(item => item.uncertain);
  const eligible = items.filter(item => item.included && ['ready', 'failed', 'stopped'].includes(item.state) && (!unresolved || item.uncertain) && !formReason(item, batchAction));
  const selectedCount = items.filter(item => item.included && ['ready', 'failed', 'stopped'].includes(item.state) && (!unresolved || item.uncertain)).length;
  const summary = [
    ['已完成', items.filter(item => item.state === 'success').length], ['待核实', items.filter(item => item.uncertain).length],
    ['失败', items.filter(item => item.state === 'failed' && !item.uncertain).length], ['已停止', items.filter(item => item.state === 'stopped' && !item.uncertain).length],
    ['暂不可操作', items.filter(item => item.state === 'blocked').length], ['待执行', items.filter(item => item.state === 'ready').length],
    ['核对中', items.filter(item => item.state === 'checking').length], ['执行中', items.filter(item => item.state === 'running' && !item.uncertain).length],
  ].filter(([, count]) => Number(count) > 0).map(([label, count]) => label + ' ' + count + ' 项').join('，');
  const allComplete = items.length > 0 && items.every(item => item.state === 'success');
  const disabledReason = recoveryError || (loading ? '正在读取所选型号的当前状态。' : busy ? '正在逐项执行，可停止尚未开始的条目；当前请求超过等候时间后会结束等候并保留原请求。' : allComplete ? '本批次已全部完成，可打开结果或关闭窗口。' : !eligible.length ? '没有可执行项，请查看每项原因或补齐表单。' : eligible.length !== selectedCount ? '请补齐所有勾选项的必填内容，或取消该项。' : !ack ? '请先核对清单并勾选确认。' : '');
  const scopeText = batchAction === 'generate'
    ? '将依次核对结构与用料、电气参数、载流量表、短路容量、标准核对。缺少或过期的结果只有通过实际预检后才补算；已有完整结果由服务核对后复用。计算只采用已保存的型号与方法条件，缺项会停止该型号并保留已完成结果。'
    : batchAction === 'branch' ? '每项建立一个基于所示已保存版本的独立方案，保留原型号名称、原方案与历史结果。请核对各项新方案名称。'
      : batchAction === 'submit' ? '只提交下列已采纳的新版本草稿，保留当前规格书校核清单、编制人和变更摘要，交由人工审核。'
        : batchAudience === 'internal' ? '依次下载所示内容的内部审核 PDF，文件保留缺项、来源与校核记录。' : '依次下载所示内容的客户版 PDF；服务会再次核对已保存结果、内容版本与文件完整性。';
  function openItem(item: Item) {
    const adoption = batchAction === 'submit' && optionalRecord(item.spec?.payload.plan_reference).status !== 'version_draft';
    const fallback = batchAction === 'branch' ? typePath(item.row.id, 'structure', 'section', navigation.location.theme)
      : adoption ? typePath(item.row.id, 'comparison', 'matrix', navigation.location.theme)
        : typePath(item.row.id, 'specification', 'review', navigation.location.theme);
    close(false); navigation.navigate(item.destination || fallback);
  }
  function itemLinkLabel(item: Item) {
    if (batchAction === 'branch') return item.state === 'success' ? '打开新方案' : '打开原型号';
    if (batchAction === 'submit' && optionalRecord(item.spec?.payload.plan_reference).status !== 'version_draft') return '查看方案对比';
    if (batchAction === 'generate' && item.state === 'failed' && item.destination) return '查看相关输入';
    return '查看规格书与校核';
  }
  return <>
    <div className="type-batch-toolbar" role="group" aria-label="型号批量操作">
      <span id="type-batch-selection" role="status">已选择 {selected.length} 项{hiddenCount > 0 ? '，其中 ' + hiddenCount + ' 项不在当前筛选结果中' : ''}</span>
      <Select label="批量操作" value={action} disabled={busy || unresolved || !!recoveryError} onChange={value => setAction(value as Action)}
        options={Object.entries(actions).map(([value, label]) => ({ value, label }))} />
      {(action === 'generate' || action === 'download') && <Select label="批量文档版本" value={audience} disabled={busy || unresolved || !!recoveryError} onChange={value => setAudience(value as SpecificationAudience)}
        options={[{ value: 'customer', label: '客户版' }, { value: 'internal', label: '内部审核版' }]} />}
      <Button ref={previewButton} variant={selected.length && !open && !inactive ? 'primary' : 'outline'} disabled={(!selected.length && !unresolved) || busy || !!recoveryError} aria-describedby="type-batch-selection" onClick={() => void prepare()}>{unresolved ? '恢复待核实批次' : '预览批量操作'}</Button>
      {!!selected.length && <Button variant="ghost" disabled={busy} onClick={onClear}>清除选择</Button>}
      {unresolved ? <span className="muted">上次批次有待核实请求，请先恢复原批次；操作和文档版本暂不能更换。</span> : !selected.length && <span className="muted">先勾选列表中的型号，再预览操作。</span>}
    </div>
    {recoveryError && <div className="type-batch-receipt" role="alert"><span>{recoveryError}</span><Button onClick={retryRecovery}>重新读取批次</Button></div>}
    {started && !open && <div className="type-batch-receipt" role="status"><span>{actions[batchAction]}：共 {items.length} 项，{summary}。</span><Button ref={resultButton} onClick={show}>查看批量结果</Button></div>}
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="type-batch-dialog" onCloseAutoFocus={event => { event.preventDefault(); (opener.current?.isConnected && !opener.current.matches(':disabled') ? opener.current : resultButton.current || previewButton.current)?.focus(); }}
        onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onInteractOutside={event => { if (busy) event.preventDefault(); }}>
        <DialogTitle className="dialog-title">{actions[batchAction]} · {started ? '执行结果' : '操作预览'}</DialogTitle>
        <DialogDescription className="type-batch-description">{scopeText}</DialogDescription>
        <div className="type-batch-progress" role="status" aria-live="polite">{loading ? '正在核对 ' + items.length + ' 项型号…' : '共 ' + items.length + ' 项，' + summary + '。'}{busy && (stopping ? ' 当前项结束等候后停止，不会撤销已经完成的操作。' : ' 正在逐项执行。')}</div>
        <div className="type-batch-body">
          {batchAction === 'submit' && !unresolved && items.some(item => item.state === 'ready' && !item.attempt) && <fieldset className="type-batch-shared" disabled={loading || busy}>
            <legend>统一填写（可选，应用后仍可逐项修改）</legend>
            <label>统一编制人<Input value={commonAuthor} maxLength={120} onChange={event => setCommonAuthor(event.target.value)} /></label>
            <label>统一变更摘要<Input value={commonSummary} maxLength={500} onChange={event => setCommonSummary(event.target.value)} /></label>
            <Button disabled={!commonAuthor.trim() && !commonSummary.trim()} onClick={() => { setAck(false); replaceItems(currentItems.current.map(item => item.state === 'ready' ? { ...item, author: commonAuthor.trim() || item.author, summary: commonSummary.trim() || item.summary } : item)); }}>应用到可提交项</Button>
            {!commonAuthor.trim() && !commonSummary.trim() && <p className="muted">填写任一项后可应用；各项原有编制信息显示在下面。</p>}
          </fieldset>}
          <div className="type-batch-items" role="list" aria-label="批量操作清单">
            {items.map((item, index) => <section key={item.row.id} role="listitem" className="type-batch-item" data-batch-state={item.state} data-batch-workspace={item.row.id}>
              <div className="type-batch-item-title">
                <Checkbox id={'type-batch-item-' + index} checked={item.included} disabled={busy || loading || unresolved || ['checking', 'blocked', 'success'].includes(item.state)}
                  aria-describedby={'type-batch-reason-' + index} onCheckedChange={value => edit(item.row.id, { included: value === true })} />
                <label htmlFor={'type-batch-item-' + index}>{typeRowLabel(item.row)}</label><strong>{item.uncertain ? '待核实' : stateLabels[item.state]}</strong>
              </div>
              <p className="muted">基准版本 {versionLabel(item.row.version)} · 保存于 {localTime(item.row.updated)}{item.revision > 0 ? ' · 修订 ' + item.revision : ''}</p>
              <p id={'type-batch-reason-' + index} className={item.state === 'failed' || item.state === 'blocked' ? 'type-batch-problem' : undefined}>
                {item.reason || (item.state === 'checking' ? '正在读取当前版本与操作资格。' : batchAction === 'generate' ? '可发起预检；是否能补算以实际预检结果为准。' : '请核对以下内容。')}
                {formReason(item, batchAction) && !['checking', 'blocked', 'success'].includes(item.state) && ' ' + formReason(item, batchAction)}
              </p>
              {item.diagnostic && <MethodErrorDetail value={item.diagnostic} />}
              {item.uncertain && item.attempt && <details className="type-batch-checks"><summary>原请求核实信息</summary><p>请求标识：{item.attempt.id} · 原修订：{item.revision}。重试保留此标识、原修订和填写内容，不会自动改成新的请求。</p></details>}
              {batchAction === 'branch' && item.state !== 'checking' && <label className="type-batch-field">新方案名称
                <Input aria-label={'新方案名称：' + typeRowLabel(item.row)} maxLength={80} value={item.name} disabled={busy || unresolved || !!item.attempt || item.state === 'success'} onChange={event => edit(item.row.id, { name: event.target.value })} />
              </label>}
              {batchAction === 'submit' && ['ready', 'failed', 'stopped'].includes(item.state) && !item.attempt && <div className="type-batch-fields">
                <label>编制人<Input aria-label={'编制人：' + typeRowLabel(item.row)} value={item.author} maxLength={120} disabled={busy || unresolved} onChange={event => edit(item.row.id, { author: event.target.value })} /></label>
                <label>变更摘要<Input aria-label={'变更摘要：' + typeRowLabel(item.row)} value={item.summary} maxLength={500} disabled={busy || unresolved} onChange={event => edit(item.row.id, { summary: event.target.value })} /></label>
              </div>}
              {batchAction === 'submit' && started && <p>编制人：{item.attempt?.author || item.author || '未填写'} · 变更摘要：{item.attempt?.summary || item.summary || '未填写'}</p>}
              {batchAction === 'generate' && item.spec && <details open className="type-batch-scope"><summary>核对补算范围与已保存结果</summary><ul>{channels.map(([channel, label]) => {
                const source = sources(item.spec).find(source => source.channel === channel), pending = checks(item.spec).filter(check => check.channel === channel && check.blocking === true);
                return <li key={channel}><strong>{label}</strong>：{!source ? '没有保存结果，待预检后补算。' : source.freshness !== 'current' ? '已有结果为历史，待预检后补算。' : pending.length ? '有当前结果，仍有 ' + pending.length + ' 项校核问题；服务将核对能否复用或补算。' : '已有当前结果，服务核对完整性后可复用。'}</li>;
              })}</ul></details>}
              {!!checks(item.spec).length && <details className="type-batch-checks"><summary>所选内容的校核清单（{checks(item.spec).length} 项）</summary><ul>{checks(item.spec).map((check, position) => <li key={text(check.id) || position}>{text(check.message) || '请在规格书页查看此项校核。'}{check.blocking === true ? '（阻止发布）' : ''}</li>)}</ul></details>}
              {!!item.steps?.length && <ul className="type-batch-steps">{item.steps.map((step, position) => <li key={position}>{channels.find(([key]) => key === step.channel)?.[1] || '计算步骤'}：{step.status === 'reused' ? '复用已保存结果' : step.status === 'calculated' ? '已完成计算并保存' : '请查看保存记录'}</li>)}</ul>}
              <div className="type-batch-item-actions">
                {item.blob && item.filename && <Button size="compact" onClick={() => downloadBlob(item.blob!, item.filename!)}>下载 PDF</Button>}
                <Button size="compact" disabled={busy} onClick={() => openItem(item)}>{itemLinkLabel(item)}</Button>
              </div>
            </section>)}
          </div>
        </div>
        <div className="type-batch-confirm">
          {storageWarning && <p role="alert">{storageWarning}</p>}
          {unresolved && <p>请先核实待确认项。关闭窗口或返回列表会保留原批次；确认前不会开始其他条目，也不会用新的选择覆盖原请求。</p>}
          {started && (batchAction === 'branch' || batchAction === 'submit') && <p className="muted">已开始的请求保留原有填写内容。需要修改时，请重新核对未完成项；结果未确认的条目应先重试同一请求。</p>}
          {!busy && !!eligible.length && <label><Checkbox checked={ack} onCheckedChange={value => setAck(value === true)} />{unresolved ? '同意使用原请求重试并核实；服务可能返回已有结果或继续原操作，其他条目继续暂停。' : batchAction === 'generate' ? '已核对各型号的补算范围与保存条件，同意预检通过后计算。' : batchAction === 'submit' ? '已核对各项当前版本、校核清单、编制人与变更摘要，同意提交人工审核。' : '已核对所选对象与操作内容，同意执行勾选项。'}</label>}
          <p id="type-batch-execute-reason" className="muted">{disabledReason || (unresolved ? '本次只重试待核实的原请求；核实后可重新确认剩余项。' : '将依次执行 ' + eligible.length + ' 项；失败项保留原因。若结果待核实，将暂停后续条目；已完成项不会重复执行。')}</p>
        </div>
        <DialogFooter>
          {!busy && !loading && !unresolved && items.some(item => item.state !== 'success') && <Button onClick={() => void prepare(true)}>重新核对未完成项</Button>}
          {busy ? <Button disabled={stopping} onClick={() => { stop.current = true; setStopping(true); }}>{stopping ? '等待当前项完成' : '停止剩余项'}</Button>
            : <Button variant="primary" disabled={!!disabledReason} aria-describedby="type-batch-execute-reason" onClick={() => void execute()}>{unresolved ? '重试并核实原请求' : started ? '继续未完成项' : '确认' + actions[batchAction]}{eligible.length ? '（' + eligible.length + ' 项）' : ''}</Button>}
          <Button variant="ghost" disabled={busy} aria-describedby={busy ? 'type-batch-execute-reason' : undefined} onClick={() => close(false)}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
