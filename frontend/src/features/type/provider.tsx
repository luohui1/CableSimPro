import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useBlocker } from '@tanstack/react-router';
import { ApiError, message } from '@/api/client';
import { at, change, commitFields, isLocked, parseInput, type DomainDocument, type DomainDraft, type NumericInput } from '@/lib/domain-fields';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { historyType, loadWorkspace, saveType, type Workspace } from './api';
import { useTypeNavigation } from './navigation';
import { saveRating, type RatingDraft } from './rating-api';
import { saveMethod, type MethodDraft } from './method-draft';
import { committedParameter } from '@/lib/study-config';

type TypeContextValue = { workspace?: Workspace; document?: DomainDocument; dirty: boolean; busy: boolean; loading: boolean; error: string; notice: string; readOnly: boolean; draft: DomainDraft | null;
  ratingDraft: RatingDraft | null; setRatingDraft: (draft: RatingDraft | null | ((current: RatingDraft | null) => RatingDraft | null)) => void;
  methodDrafts: Record<string, MethodDraft>; setMethodDraft: (module: string, draft: MethodDraft | null | ((current: MethodDraft | undefined) => MethodDraft | null)) => void;
  fieldError: { path: string; message: string } | null;
  setField: (spec: NumericInput, text: string | undefined) => void; edit: (path: string, value: unknown) => void; save: () => Promise<void>; commitResourceValue: (action: () => Promise<unknown>) => Promise<void>; undo: () => Promise<void>; discard: () => void; reload: () => void; locked: (path: string) => boolean };
const Context = createContext<TypeContextValue | null>(null);
export function useTypeWorkspace() { const value = useContext(Context); if (!value) throw new Error('型号工作区未挂载'); return value; }
export function TypeProvider({ wid, children }: { wid: string; children: ReactNode }) {
  const queries = useQueryClient(), { location } = useTypeNavigation();
  const query = useQuery({ queryKey: ['type-workspace', wid, location.revision, location.run], queryFn: ({ signal }) => loadWorkspace(wid, signal, location.revision, location.run), staleTime: 0 });
  const [draft, setDraft] = useState<DomainDraft | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [ratingDraft, setRatingDraft] = useState<RatingDraft | null>(null), ratingRef = useRef(ratingDraft); ratingRef.current = ratingDraft;
  const [methodDrafts, setMethodDrafts] = useState<Record<string, MethodDraft>>({}), methodsRef = useRef(methodDrafts); methodsRef.current = methodDrafts;
  const [fieldError, setFieldError] = useState<{ path: string; message: string } | null>(null);
  const pending = useRef(false), draftRef = useRef(draft); draftRef.current = draft;
  const workspace = query.data;
  const readOnly = !!location.revision || !!location.run || workspace?.raw.type_lifecycle && (workspace.raw.type_lifecycle as Record<string, unknown>).status === 'published' || false;
  const document = readOnly ? workspace?.document : draft?.document || workspace?.document;
  const dirty = !!draft || !!ratingDraft || Object.keys(methodDrafts).length > 0;
  const blocker = useBlocker({ withResolver: true, shouldBlockFn: ({ next }) => (!!draftRef.current || !!ratingRef.current || Object.keys(methodsRef.current).length > 0) && !next.pathname.startsWith(`/types/${encodeURIComponent(wid)}/`) });
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (draftRef.current || ratingRef.current || Object.keys(methodsRef.current).length) event.preventDefault(); }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, []);
  function initial(): DomainDraft { if (!workspace) throw new ApiError(409, '型号仍在读取'); if (readOnly) throw new ApiError(409, '此型号版本保持只读，请建立新版本方案'); return { document: workspace.document, base: workspace.document, revision: workspace.revision, scope: 'type', fields: {} }; }
  function edit(path: string, value: unknown) {
    setFieldError(null);
    if (isLocked(workspace?.raw.locks, path) || readOnly) { setError('此字段已锁定，请从型号列表建立独立草稿'); return; }
    setDraft(previous => { const next = previous || initial(); if (at(next.document, path) === value) return previous; const changed = change(next.document, path, value); changed.provenance = { ...changed.provenance, [path]: { kind: 'user', reference: '工程师在型号工作区填写', reviewed: false } }; const fields = value && typeof value === 'object' ? Object.fromEntries(Object.entries(next.fields).filter(([key]) => !key.startsWith(path + '/'))) : next.fields; return { ...next, document: changed, fields }; }); setError(''); setNotice('');
  }
  function setField(spec: NumericInput, value: string | undefined) {
    setFieldError(null);
    if (readOnly || isLocked(workspace?.raw.locks, spec.path)) return;
    setDraft(previous => {
      if (value === undefined) { if (!previous) return null; const fields = { ...previous.fields }; delete fields[spec.path]; return !Object.keys(fields).length && previous.document === previous.base ? null : { ...previous, fields }; }
      const next = previous || initial(); return { ...next, fields: { ...next.fields, [spec.path]: { value, spec } } };
    }); setError(''); setNotice('');
  }
  async function refreshResults() {
    await Promise.all(['type-evidence', 'type-specification', 'type-comparison', 'type-studies', 'type-material-comparison', 'type-resource-bindings'].map(key => queries.invalidateQueries({ queryKey: [key, wid] })));
    await queries.invalidateQueries({ queryKey: ['object-relations'] });
  }
  async function refresh(next: Workspace) { queries.setQueryData(['type-workspace', wid, undefined, undefined], next); await refreshResults(); await queries.invalidateQueries({ queryKey: ['type-list'] }); }
  async function commitResourceValue(action: () => Promise<unknown>) {
    if (pending.current || !workspace || readOnly || dirty) throw new Error('请先保存或撤销当前修改，再采用资源值。');
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); await refresh(await loadWorkspace(wid)); setNotice('已采用资源值；受影响的保存结果为历史，请重算。'); }
    finally { pending.current = false; setBusy(false); }
  }
  async function save() {
    if (pending.current || (!draftRef.current && !ratingRef.current && !Object.keys(methodsRef.current).length) || !workspace || readOnly) return;
    pending.current = true; setBusy(true); setError(''); setNotice(''); setFieldError(null);
    const savedDraft = draftRef.current, savedRating = ratingRef.current, savedMethods = methodsRef.current;
    try {
      let next = workspace, ratingToSave = savedRating, methodsToSave = savedMethods;
      for (const [module, original] of Object.entries(savedMethods)) for (const field of Object.values(original.fields)) { try { committedParameter(field); } catch (failure) { setFieldError({ path: module + field.path, message: message(failure) }); requestAnimationFrame(() => { const label = field.spec?.label; if (label) (window.document.querySelector('input[aria-label="' + CSS.escape(label) + '"]') as HTMLInputElement | null)?.focus(); }); throw failure; } }
      if (savedDraft) {
        for (const [path, field] of Object.entries(savedDraft.fields)) { try { parseInput(field.spec, field.value); } catch (failure) { setFieldError({ path, message: message(failure) }); throw failure; } }
        const checked = commitFields(savedDraft); next = await saveType({ ...workspace, revision: savedDraft.revision }, checked);
        if (draftRef.current === savedDraft) setDraft(null); else setDraft(current => current ? { ...current, revision: next.revision, base: next.document } : null);
        await refresh(next);
        if (savedRating) { ratingToSave = { ...savedRating, revision: next.revision }; ratingRef.current = ratingToSave; setRatingDraft(ratingToSave); }
        methodsToSave = Object.fromEntries(Object.entries(savedMethods).map(([module, original]) => [module, { ...original, revision: next.revision }]));
        methodsRef.current = methodsToSave; setMethodDrafts(methodsToSave);
      }
      if (ratingToSave) { await saveRating(wid, ratingToSave, ratingToSave.revision); if (ratingRef.current === ratingToSave) setRatingDraft(null); await refreshResults(); }
      for (const [module, original] of Object.entries(methodsToSave)) {
        await saveMethod(wid, original);
        setMethodDrafts(current => { if (current[module] !== original) return current; const remaining = { ...current }; delete remaining[module]; methodsRef.current = remaining; return remaining; });
        await refreshResults();
      }
      setNotice(savedRating || Object.keys(savedMethods).length ? '已保存型号与方法条件' : '已保存型号草稿');
    } catch (error) { setError(message(error)); }
    finally { pending.current = false; setBusy(false); }
  }
  async function undo() {
    setFieldError(null);
    if (pending.current || !workspace || readOnly) return;
    if (location.module === 'electrical' || location.module === 'short-circuit') { if (methodsRef.current[location.module]) { setMethodDrafts(current => { const remaining = { ...current }; delete remaining[location.module]; methodsRef.current = remaining; return remaining; }); setError(''); setNotice('已撤销未保存方法条件'); } else setError('宿主尚未提供已保存方法配置的撤销接口'); return; }
    if (location.module === 'rating-table') { if (ratingRef.current) { setRatingDraft(null); setError(''); setNotice('已撤销未保存工况修改'); await queries.invalidateQueries({ queryKey: ['type-studies', wid] }); } else { setError('宿主尚未提供已保存方法配置的撤销接口；型号结构保持原状'); } return; }
    if (draftRef.current || ratingRef.current || Object.keys(methodsRef.current).length) { setDraft(null); setRatingDraft(null); setMethodDrafts({}); setError(''); setNotice('已撤销未保存修改'); return; }
    if (workspace.raw.can_undo !== true) { setError('没有可撤销的已保存型号版本'); return; }
    pending.current = true; setBusy(true); setError('');
    try { await refresh(await historyType(workspace, 'undo')); setNotice('已恢复上一份型号输入'); } catch (error) { setError(message(error)); }
    finally { pending.current = false; setBusy(false); }
  }
  return <Context.Provider value={{ workspace, document, dirty, busy, loading: query.isPending, error: error || (query.error ? message(query.error) : ''), notice, readOnly: !!readOnly, draft,
    ratingDraft, methodDrafts, setMethodDraft: (module, value) => { if (!readOnly && !busy) { const next = { ...methodsRef.current }, draft = typeof value === 'function' ? value(next[module]) : value; if (draft) next[module] = draft; else delete next[module]; methodsRef.current = next; setMethodDrafts(next); setError(''); setNotice(''); setFieldError(null); } }, fieldError, setRatingDraft: value => { if (!readOnly && !busy) { const next = typeof value === 'function' ? value(ratingRef.current) : value; ratingRef.current = next; setRatingDraft(next); setError(''); setNotice(''); setFieldError(null); } },
    setField, edit, save, commitResourceValue, undo, discard: () => { setDraft(null); setRatingDraft(null); setMethodDrafts({}); setError(''); }, reload: () => { void query.refetch(); }, locked: path => !!readOnly || isLocked(workspace?.raw.locks, path) }}>{children}
    <Dialog open={blocker.status === 'blocked'} onOpenChange={open => { if (!open) blocker.reset?.(); }} title="型号有未保存修改" description="保存后再离开，或放弃本次草稿。"
      actions={<Button onClick={() => { setDraft(null); setRatingDraft(null); setMethodDrafts({}); blocker.proceed?.(); }}>放弃修改并离开</Button>} />
  </Context.Provider>;
}
