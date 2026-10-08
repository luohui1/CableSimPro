import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, array, message, optionalRecord, record, responseData, text } from '@/api/client';
import { studyRuns } from '@/api/research';
import { temperatureView } from '@/lib/temperature-view';
import { compareSavedFields } from '../field/saved-comparison';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { savedThermal } from './saved-thermal';
import type { DomainDocument } from '../drawing/types';
import type { CadThermal } from './types';

/** Display-case selection preserves the original saved input and artifact provenance. */
export function caseRun(run: Record<string, unknown>, caseId?: string) {
  if (!caseId) return run;
  const cases = array(optionalRecord(run.output).cases).map(optionalRecord).filter(c => c.case_id === caseId);
  if (!cases.length) throw Error('所选保存工况不存在；请重新选择工况。');
  return { ...run, output: { ...optionalRecord(run.output), cases }, convergence: { ...optionalRecord(run.convergence), reference_case_id: caseId } };
}
export async function hydrateCaseInputs(run: Record<string, unknown>, signal: AbortSignal) {
  const snapshot = optionalRecord(run.snapshot), ids = array(optionalRecord(run.output).cases).map(c => text(optionalRecord(c).case_id));
  const cases = [];
  for (const value of array(snapshot.cases)) {
    const row = optionalRecord(value), ref = optionalRecord(row.input_ref);
    if (row.input || !ids.includes(text(row.case_id))) { cases.push(row); continue; }
    const expected = `/api/workspaces/${encodeURIComponent(text(run.workspace))}/studies/${encodeURIComponent(text(run.study))}/runs/${encodeURIComponent(text(run.id))}/cases/${encodeURIComponent(text(row.case_id))}/input`;
    if (ref.url !== expected || !/^[a-f0-9]{64}$/.test(text(ref.sha256))) throw Error('保存工况输入引用不完整，拒绝对照。');
    const response = await fetch(expected, { signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]), credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw Error(`保存工况输入读取失败（${response.status}），请重试。`);
    const saved = record(await response.json());
    if (saved.integrity !== 'verified' || saved.run_id !== run.id || saved.case_id !== row.case_id || saved.input_digest !== ref.sha256 || saved.run_input_digest !== run.input_digest)
      throw Error('保存工况输入身份或摘要不匹配，拒绝对照。');
    cases.push({ ...row, input: record(saved.input, '保存工况输入') });
  }
  return { ...run, snapshot: { ...snapshot, cases } };
}
export function savedFieldPair(femRun: Record<string, unknown>, iecRun: Record<string, unknown>, document: DomainDocument, sectionId: string) {
  const comparison = compareSavedFields(femRun, iecRun);
  const fem = savedThermal(caseRun(femRun, comparison.femCase), document, sectionId, comparison.femCase);
  const iec = savedThermal(caseRun(iecRun, comparison.iecCase), document, sectionId, comparison.iecCase);
  if (fem?.kind !== 'fem' || iec?.kind !== 'iec' || !fem.triangles.length || !iec.triangles.length) throw Error('缺少有限元或 IEC 保存节点场；差值未覆盖。');
  const minimum = Math.min(fem.minimum, iec.minimum), maximum = Math.max(fem.maximum, iec.maximum);
  const references = [fem, iec].map(({ runId, caseId, source }) => ({ runId, caseId, source }));
  return { fem: { ...fem, minimum, maximum, references }, iec: { ...iec, minimum, maximum, references } };
}
function difference(fem: CadThermal, iec: CadThermal, signal: AbortSignal): Promise<CadThermal> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./field-comparison-worker.ts', import.meta.url), { type: 'module' });
    const end = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); worker.terminate(); };
    const abort = () => { end(); reject(new DOMException('Aborted', 'AbortError')); };
    const timer = window.setTimeout(() => { end(); reject(Error('差值切片处理超时；保存结果仍保留，请选择较小网格。')); }, 10000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = event => { end(); event.data.error ? reject(Error(event.data.error)) : resolve(event.data.value); };
    worker.onerror = event => { end(); reject(Error(event.message || '差值切片后台处理失败。')); };
    if (signal.aborted) abort(); else worker.postMessage({ fem, iec });
  });
}
export function useSavedFieldControls(run: Record<string, unknown> | undefined, document: DomainDocument, sectionId: string, preferredCase?: string) {
  const [mode, setMode] = useState<'current' | 'iec' | 'fem' | 'difference'>('current');
  const [selected, setSelected] = useState('');
  useEffect(() => { setMode('current'); setSelected(''); }, [run?.id, preferredCase]);
  const active = useMemo(() => { try { return run ? temperatureView(caseRun(run, preferredCase), preferredCase) : undefined; } catch { return undefined; } }, [run, preferredCase]);
  const wid = text(run?.workspace), enabled = !!active && !!wid;
  const candidates = useQuery({ queryKey: ['cad-field-runs', wid, active?.kind], enabled, retry: false, queryFn: async ({ signal }) => {
    const studies = array(await responseData(api.GET('/api/workspaces/{wid}/studies', { params: { path: { wid } }, signal }))).map(optionalRecord);
    const values: { id: string; study: string; created: string; title: string }[] = [];
    for (const study of studies) {
      const plugin = text(optionalRecord(optionalRecord(study.definition).method).plugin_id);
      if (active!.kind === 'fem' ? plugin !== 'cablesim.iec60287' : plugin !== 'cablesim.simulation') continue;
      for (const item of await studyRuns(wid, text(study.id), signal, 'summary')) if (['succeeded', 'partial'].includes(text(item.status))) values.push({ id: text(item.id), study: text(study.id), created: text(item.created), title: text(optionalRecord(study.definition).title) });
    }
    return values.sort((a, b) => b.created.localeCompare(a.created));
  } });
  const pair = useQuery({ queryKey: ['cad-field-pair', run?.id, preferredCase, selected, candidates.data, document, sectionId], enabled: enabled && !!candidates.data?.length, retry: false, queryFn: async ({ signal }) => {
    const read = async (study: string, id: string) => {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(wid)}/studies/${encodeURIComponent(study)}/runs/${encodeURIComponent(id)}?view=full`, { signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]), credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw Error(`保存场读取失败（${response.status}），请重试。`);
      return record(await response.json());
    };
    const own = await hydrateCaseInputs(caseRun(run!, text(active!.case.case_id)), signal);
    let last = '尚无同工况的另一侧保存运行。';
    for (const candidate of candidates.data!.filter(c => !selected || selected === 'auto' || c.id === selected)) {
      const loaded = await read(candidate.study, candidate.id);
      const cases = array(optionalRecord(loaded.output).cases).map(optionalRecord);
      if (!cases.length) { last = '另一侧保存运行没有温度场。'; continue; }
      // A sweep's reference case need not be the case currently shown in 3D.
      // Match each saved case independently; never substitute a neighbouring case.
      for (const row of cases) {
        try {
          const focused = caseRun(loaded, text(row.case_id));
          if (!temperatureView(focused)) continue;
          const other = await hydrateCaseInputs(focused, signal);
          const result = active!.kind === 'fem' ? savedFieldPair(own, other, document, sectionId) : savedFieldPair(other, own, document, sectionId);
          return { ...result, referenceId: candidate.id };
        } catch (error) { signal.throwIfAborted(); last = message(error); }
      }
    }
    throw Error(last);
  } });
  const delta = useQuery({ queryKey: ['cad-field-difference', pair.data], enabled: mode === 'difference' && !!pair.data, retry: false, queryFn: ({ signal }) => difference(pair.data!.fem, pair.data!.iec, signal) });
  const thermal = mode === 'difference' ? delta.data : mode === 'iec' ? pair.data?.iec : mode === 'fem' ? pair.data?.fem : active ? pair.data?.[active.kind] : undefined;
  const reason = !enabled ? '' : candidates.error ? message(candidates.error) : candidates.isPending ? '读取对照运行' : !candidates.data?.length ? `尚无${active!.kind === 'fem' ? ' IEC' : '有限元'}保存场；差值未覆盖` : pair.error ? message(pair.error) : pair.isPending ? '核对同工况保存场' : mode === 'difference' && delta.error ? message(delta.error) : mode === 'difference' && delta.isPending ? '生成差值切片' : '';
  const controls = enabled ? <>
    <Select label="三维温度场" value={mode === 'current' ? active!.kind : mode} onChange={value => setMode(value as typeof mode)} options={[
      { value: 'iec', label: 'IEC', disabled: !pair.data && active!.kind !== 'iec' }, { value: 'fem', label: '有限元', disabled: !pair.data && active!.kind !== 'fem' }, { value: 'difference', label: '有限元 − IEC', disabled: !pair.data },
    ]} />
    {!!candidates.data?.length && <Select label={active!.kind === 'fem' ? 'IEC 参考运行' : '有限元参考运行'} value={selected || pair.data?.referenceId || 'auto'} onChange={setSelected} options={[{ value: 'auto', label: '最新同工况' }, ...candidates.data.map(c => ({ value: c.id, label: `${c.title} · ${c.created}` }))]} />}
    {reason && <span className="cad-field-notice" role="status" title={reason}>{reason}</span>}
    {!!(candidates.error || pair.error || delta.error) && <Button size="compact" onClick={() => { void candidates.refetch(); if (candidates.data?.length) void pair.refetch(); if (mode === 'difference' && pair.data) void delta.refetch(); }}>重试对照</Button>}
  </> : undefined;
  return { thermal, controls, mode, reason, comparisonRequested: mode === 'difference' || mode !== 'current' && mode !== active?.kind };
}
