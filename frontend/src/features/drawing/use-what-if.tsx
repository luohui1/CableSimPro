import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { previewThermal } from '../cad/preview-thermal';
import type { CadThermal } from '../cad/types';
import { geometryChanges, PreviewQueue, replaceSection, type WhatIfProps } from './what-if';
import { validateSectionEdit } from './section-geometry';
import type { DomainDocument, DrawingCommand, Section, SectionEdit } from './types';
import './what-if.css';

export function useWhatIf(document: DomainDocument | null, sectionId: string, props: WhatIfProps, baseline?: CadThermal, readOnly = false) {
  if (baseline?.kind === 'difference') baseline = undefined;
  const [enabled, setEnabled] = useState(false), [draft, setDraft] = useState(document);
  const [result, setResult] = useState<{ status: 'idle' | 'pending' | 'success' | 'error'; result?: CadThermal; error?: string }>({ status: 'idle' });
  const [proposing, setProposing] = useState(false), [proposalError, setProposalError] = useState('');
  const history = useRef<DomainDocument[]>([]), future = useRef<DomainDocument[]>([]), proposalBusy = useRef(false);
  const queue = useRef<PreviewQueue<CadThermal> | null>(null), current = useRef(draft); current.current = draft;
  const latest = useRef(props); latest.current = props;
  const basis = useRef(document);
  const active = enabled && basis.current === document && !!props.preview && !readOnly;
  useEffect(() => {
    if (!props.preview) return;
    const worker = new PreviewQueue(input => latest.current.preview!(input), (response, input) => previewThermal(response, input, sectionId), setResult);
    queue.current = worker; return () => { worker.dispose(); queue.current = null; };
  }, [!!props.preview, sectionId]);
  useEffect(() => { basis.current = document; queue.current?.cancel(); setEnabled(false); setDraft(document); setResult({ status: 'idle' }); history.current = []; future.current = []; }, [document, sectionId, readOnly]);
  const changes = active && document && draft ? geometryChanges(document, draft, sectionId) : [];
  function adopt(next: DomainDocument, undo = true) {
    if (JSON.stringify(next) === JSON.stringify(current.current)) return;
    if (undo && current.current) { history.current.push(current.current); if (history.current.length > 30) history.current.shift(); future.current = []; }
    current.current = next; setDraft(next); setProposalError('');
    if (document && !geometryChanges(document, next, sectionId).length) { queue.current?.cancel(); setResult({ status: 'idle' }); }
    else queue.current?.schedule(next);
  }
  function commit(section: Section, edit: SectionEdit, isLocked?: (field: string) => boolean) {
    if (!active || !current.current) throw Error('请先开启试算模式。');
    validateSectionEdit(current.current, section, edit.fields, isLocked);
    adopt(replaceSection(current.current, section));
  }
  async function propose() {
    if (!props.onPropose || !changes.length || proposalBusy.current) return;
    proposalBusy.current = true; setProposing(true); setProposalError('');
    try { await props.onPropose(changes); }
    catch (error) { setProposalError(error instanceof Error ? error.message : String(error)); }
    finally { proposalBusy.current = false; setProposing(false); }
  }
  function command(value: DrawingCommand) {
    if (value === 'save') { void propose(); return; }
    const from = value === 'undo' ? history.current : future.current, to = value === 'undo' ? future.current : history.current;
    if (from.length && current.current) { to.push(current.current); adopt(from.pop()!, false); }
  }
  const rawThermal = active ? result.status === 'success' ? result.result : !changes.length ? baseline : undefined : baseline;
  // One trial legend covers saved and preview conductors as well as soil nodes.
  // Otherwise IEC soil maxima would clamp every hot conductor to the same color.
  const thermal = useMemo(() => active && rawThermal ? { ...rawThermal,
    minimum: Math.min(rawThermal.minimum, baseline?.minimum ?? Infinity, ...rawThermal.conductors.map(c => c.value), ...(baseline?.conductors.map(c => c.value) || [])),
    maximum: Math.max(rawThermal.maximum, baseline?.maximum ?? -Infinity, ...rawThermal.conductors.map(c => c.value), ...(baseline?.conductors.map(c => c.value) || [])) } : rawThermal, [active, rawThermal, baseline]);
  const deltas = result.result && result.status === 'success' && baseline ? result.result.conductors.flatMap(c => {
    const previous = baseline.conductors.find(v => v.id === c.id && v.coreId === c.coreId);
    return previous ? [{ id: `${c.id}/${c.coreId || ''}`, label: c.label.replace(/ · 导体$/, ''), value: c.value - previous.value }] : [];
  }) : [];
  const controls = props.preview ? <div className="geometry-what-if" role="toolbar" aria-label="几何试算" data-what-if-state={active ? result.status : 'off'}>
    <Button size="compact" disabled={readOnly || !document} aria-pressed={active} onClick={() => {
      queue.current?.cancel(); setEnabled(v => !v); setDraft(document); setResult({ status: 'idle' }); setProposalError(''); history.current = []; future.current = [];
    }}>试算模式</Button>
    {active && <>
      <span className="what-if-status" role="status" title={result.error || proposalError}>{result.status === 'pending' ? '试算中' : result.status === 'error' ? result.error : result.status === 'success' ? baseline ? '未保存 · 未批准' : '未保存 · 无保存温度可对照' : '拖动对象或编辑尺寸'}{proposalError && ` · ${proposalError}`}</span>
      {!!deltas.length && <span className="what-if-deltas" aria-label="相对保存结果温差">{deltas.map(d => <span key={d.id} data-what-if-delta={d.id}>{d.label} {d.value >= 0 ? '+' : ''}{d.value.toFixed(1)} K</span>)}</span>}
      {result.status === 'error' && <Button size="compact" onClick={() => { if (current.current) queue.current?.retry(current.current); }}>重试试算</Button>}
      {props.onPropose && <Button size="compact" disabled={!changes.length || proposing} loading={proposing} onClick={() => void propose()}>把这个布置写成方案</Button>}
    </>}
  </div> : undefined;
  return { enabled: active, document: active ? draft : document, thermal, controls, commit, command, changes, canUndo: !!history.current.length, canRedo: !!future.current.length };
}
