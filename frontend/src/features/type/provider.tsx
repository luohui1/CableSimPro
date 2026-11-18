import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type SetStateAction } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useBlocker } from '@tanstack/react-router';
import { ApiError, message, optionalRecord } from '@/api/client';
import { at, change, commitFields, isLocked, parseInput, type DomainDocument, type DomainDraft, type NumericInput } from '@/lib/domain-fields';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { historyType, loadWorkspace, saveType, type Workspace } from './api';
import { fixedTypeEvidenceOptions, readTypeEvidenceForWorkspace } from './evidence-query';
import { useTypeNavigation } from './navigation';
import { isRatingDefinition, ratingBody, saveRating, typeStudies, type RatingDraft } from './rating-api';
import { saveMethod, type MethodDraft } from './method-draft';
import { committedParameter } from '@/lib/study-config';
import { domainDraftReducer, emptyDomainHistory, type DomainDraftHistory } from '@/lib/domain-draft-history';
import { countInputChanges, inputChangePaths } from '@/lib/input-changes';
import { restoreStudy } from '@/api/research';

type TypeContextValue = { workspace?: Workspace; document?: DomainDocument; dirty: boolean; changeCount: number; inputDirty: boolean; canUndo: boolean; canRedo: boolean; undoReason: string; redoReason: string; busy: boolean; loading: boolean; error: string; notice: string; readOnly: boolean; draft: DomainDraft | null;
  ratingDraft: RatingDraft | null; setRatingDraft: (draft: RatingDraft | null | ((current: RatingDraft | null) => RatingDraft | null)) => void;
  methodDrafts: Record<string, MethodDraft>; setMethodDraft: (module: string, draft: MethodDraft | null | ((current: MethodDraft | undefined) => MethodDraft | null)) => void;
  fieldError: { path: string; message: string } | null;
  setField: (spec: NumericInput, text: string | undefined) => void; edit: (path: string, value: unknown, source?: NonNullable<DomainDocument['provenance']>[string]) => void; save: () => Promise<void>; commitResourceValue: (action: () => Promise<unknown>,notice?:string) => Promise<void>; undo: () => Promise<void>; redo: () => Promise<void>; discard: () => void; reload: () => void; locked: (path: string) => boolean };
const Context = createContext<TypeContextValue | null>(null);
export function useTypeWorkspace() { const value = useContext(Context); if (!value) throw new Error('型号工作区未挂载'); return value; }
function domainChanges(draft: DomainDraft | null) { return draft ? countInputChanges(draft.base, draft.document, Object.keys(draft.fields)) : 0; }
function methodChangesFor(draft: MethodDraft) {
  return countInputChanges(draft.study?.definition || { ...draft.definition, parameters: {}, input_sources: {} }, draft.definition,
    Object.values(draft.fields).map(field => '/parameters' + field.path));
}
function ratingChangesFor(draft: RatingDraft | null) {
  return draft ? countInputChanges(draft.study ? ratingBody(draft.study) : { rows: [], parameters: {}, selected_case_ids: null }, draft.body,
    [...Object.keys(draft.fields).map(key => { const split = key.lastIndexOf('/'), index = draft.body.rows.findIndex(row => row.case_id === key.slice(0, split)); return `/rows/${index}/${key.slice(split + 1)}`; }),
      ...Object.values(draft.parameterFields || {}).map(field => '/parameters' + field.path)]) : 0;
}
export function TypeProvider({ wid, children }: { wid: string; children: ReactNode }) {
  const queries = useQueryClient(), { location } = useTypeNavigation();
  // The route starts this read on entry. Mounting must not repeat a just-finished
  // prefetch; explicit reload/save/undo keep their existing refresh behavior.
  const query = useQuery({ queryKey: ['type-workspace', wid, location.revision, location.run], queryFn: ({ signal }) => {
    const fixed = location.run ? fixedTypeEvidenceOptions(queries, wid, location.run, location.module) : undefined;
    return loadWorkspace(wid, signal, location.revision, location.run, fixed
      ? readTypeEvidenceForWorkspace(fixed, () => queries.fetchQuery(fixed), signal, queries) : undefined);
  }, staleTime: 0, refetchOnMount: false });
  const [history, setHistory] = useState<DomainDraftHistory>(emptyDomainHistory), draft = history.present;
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const setDraft = (update: SetStateAction<DomainDraft | null>) => setHistory(current => domainDraftReducer(current, { type: 'set', update }));
  const [ratingDraft, setRatingDraft] = useState<RatingDraft | null>(null), ratingRef = useRef(ratingDraft); ratingRef.current = ratingDraft;
  const [methodDrafts, setMethodDrafts] = useState<Record<string, MethodDraft>>({}), methodsRef = useRef(methodDrafts); methodsRef.current = methodDrafts;
  const redoMethods = useRef<Record<string, MethodDraft>>({}), redoRating = useRef<RatingDraft | null>(null);
  const [fieldError, setFieldError] = useState<{ path: string; message: string } | null>(null);
  const pending = useRef(false), draftRef = useRef(draft); draftRef.current = draft;
  const workspace = query.data;
  const readOnly = !!location.revision || !!location.run || workspace?.raw.type_lifecycle && (workspace.raw.type_lifecycle as Record<string, unknown>).status === 'published' || false;
  const methodModule = ['electrical', 'short-circuit', 'rating-table'].includes(location.module);
  const studies = useQuery({ queryKey: ['type-studies', wid], queryFn: ({ signal }) => typeStudies(wid, signal), enabled: !!workspace && !readOnly && methodModule, staleTime: 15000 });
  const activeStudy = studies.data?.filter(study => location.module === 'rating-table' ? isRatingDefinition(study.definition)
    : optionalRecord(study.definition.method).capability === location.module).sort((a, b) => b.created.localeCompare(a.created))[0];
  const document = readOnly ? workspace?.document : draft?.document || workspace?.document;
  const structureChanges = domainChanges(draft);
  const methodCounts = Object.fromEntries(Object.entries(methodDrafts).map(([module, current]) => [module, methodChangesFor(current)]));
  const methodChanges = Object.values(methodCounts).reduce((total, count) => total + count, 0);
  const ratingChanges = ratingChangesFor(ratingDraft);
  const changeCount = structureChanges + methodChanges + ratingChanges, dirty = changeCount > 0;
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const localMethod = location.module === 'rating-table' ? ratingDraft : methodDrafts[location.module];
  const methodRedo = location.module === 'rating-table' ? redoRating.current : redoMethods.current[location.module];
  const otherChanges = methodModule ? structureChanges + methodChanges - (methodCounts[location.module] || 0)
    + (location.module === 'rating-table' ? 0 : ratingChanges) : methodChanges + ratingChanges;
  const savedHistoryReason = otherChanges > 0 ? '请先保存或撤销其他模块的修改，再恢复已保存版本。' : '';
  const localUndo = methodModule ? !!localMethod : !!draft || history.past.length > 0;
  const localRedo = methodModule ? !localMethod && !!methodRedo : history.future.length > 0;
  const undoReason = localUndo ? '' : savedHistoryReason, redoReason = localRedo ? '' : savedHistoryReason;
  const canUndo = !busy && !readOnly && (localUndo || !savedHistoryReason && (methodModule ? activeStudy?.can_undo === true : workspace?.raw.can_undo === true));
  const canRedo = !busy && !readOnly && (localRedo || !savedHistoryReason && (methodModule ? !localMethod && activeStudy?.can_redo === true : !draft && workspace?.raw.can_redo === true));
  const blocker = useBlocker({ withResolver: true, shouldBlockFn: ({ next }) => dirtyRef.current && !next.pathname.startsWith(`/types/${encodeURIComponent(wid)}/`) });
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (dirtyRef.current) event.preventDefault(); }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, []);
  function initial(): DomainDraft { if (!workspace) throw new ApiError(409, '型号仍在读取'); if (readOnly) throw new ApiError(409, '此型号版本保持只读，请建立新版本方案'); return { document: workspace.document, base: workspace.document, revision: workspace.revision, scope: 'type', fields: {} }; }
  function edit(path: string, value: unknown, source?: NonNullable<DomainDocument['provenance']>[string]) {
    setFieldError(null);
    if (isLocked(workspace?.raw.locks, path) || readOnly) { setError('此字段已锁定，请从型号列表建立独立草稿'); return; }
    setHistory(current => domainDraftReducer(current, { type: 'set', record: true, consumed: [path], update: previous => {
      const next = previous || initial(), original = at(next.document, path);
      const valueChanged = JSON.stringify(original) !== JSON.stringify(value);
      if (!valueChanged && !source) return previous;
      const updated = change(next.document, path, value), changed = updated === next.document ? structuredClone(updated) : updated;
      // change() supplies a generic source for its path. Preserve the original
      // parent source and attach provenance only to the actual edited inputs.
      const provenance = { ...next.document.provenance };
      const paths = value && typeof value === 'object' ? inputChangePaths(original, value).map(part => path + (part === '/' ? '' : part)) : [path];
      if (source && !paths.length) paths.push(path);
      if (valueChanged) for (const key of Object.keys(provenance)) if ((key === path || key.startsWith(path + '/')) && at(changed, key) === undefined) delete provenance[key];
      for (const key of paths) {
        if (at(changed, key) === undefined) continue;
        const originalSource = next.base.provenance?.[key];
        if (!source && JSON.stringify(at(changed, key)) === JSON.stringify(at(next.base, key))) {
          if (originalSource) provenance[key] = originalSource; else delete provenance[key];
        } else provenance[key] = source || { kind: 'user', reference: '工程师在型号工作区填写', reviewed: false };
      }
      changed.provenance = provenance; return { ...next, document: changed };
    } })); setError(''); setNotice('');
  }
  function setField(spec: NumericInput, value: string | undefined) {
    setFieldError(null);
    if (readOnly || isLocked(workspace?.raw.locks, spec.path)) return;
    setDraft(previous => {
      if (value === undefined) { if (!previous || !(spec.path in previous.fields)) return previous; const fields = { ...previous.fields }; delete fields[spec.path]; return !Object.keys(fields).length && previous.document === previous.base ? null : { ...previous, fields }; }
      const next = previous || initial(); return { ...next, fields: { ...next.fields, [spec.path]: { value, spec } } };
    }); setError(''); setNotice('');
  }
  async function refreshResults() {
    await Promise.all(['type-evidence', 'type-specification', 'type-comparison', 'type-studies', 'type-material-comparison', 'type-resource-bindings'].map(key => queries.invalidateQueries({ queryKey: [key, wid] })));
    await queries.invalidateQueries({ queryKey: ['object-relations'] });
  }
  async function refresh(next: Workspace) {
    const renamed = workspace?.document.name !== next.document.name;
    queries.setQueryData(['type-workspace', wid, undefined, undefined], next);
    await refreshResults();
    await Promise.all([
      queries.invalidateQueries({ queryKey: ['type-list'] }),
      ...(renamed ? [
        // The sidebar publishes the two real indexes as a complete pair.
        // Refresh names after a saved rename or history restore, not a draft edit.
        queries.invalidateQueries({ queryKey: ['type-index'], refetchType: 'all' }),
        queries.invalidateQueries({ queryKey: ['workspace-index'], refetchType: 'all' }),
        queries.invalidateQueries({ queryKey: ['index-objects', 'type'] }),
        queries.invalidateQueries({ queryKey: ['index-search'] }),
      ] : []),
    ]);
  }
  async function commitResourceValue(action: () => Promise<unknown>, notice='已采用资源值；受影响的保存结果为历史，请重算。') {
    if (pending.current || !workspace || readOnly || dirty) throw new Error('请先保存或撤销当前修改，再采用资源值。');
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); setDraft(null); redoMethods.current = {}; redoRating.current = null; await refresh(await loadWorkspace(wid)); setNotice(notice); }
    finally { pending.current = false; setBusy(false); }
  }
  async function save() {
    if (pending.current || !workspace || readOnly) return;
    // Method forms can stage their initial draft and save in the same click.
    // Read the current refs, rather than the preceding render's dirty flag.
    const savedDraft = draftRef.current, savedRating = ratingRef.current, savedMethods = methodsRef.current;
    if (!domainChanges(savedDraft) && !ratingChangesFor(savedRating) && !Object.values(savedMethods).some(methodChangesFor)) return;
    pending.current = true; setBusy(true); setError(''); setNotice(''); setFieldError(null);
    try {
      let next = workspace, ratingToSave = savedRating, methodsToSave = savedMethods;
      for (const [module, original] of Object.entries(savedMethods)) for (const field of Object.values(original.fields)) { try { committedParameter(field); } catch (failure) { setFieldError({ path: module + field.path, message: message(failure) }); requestAnimationFrame(() => { const label = field.spec?.label; if (label) (window.document.querySelector('input[aria-label="' + CSS.escape(label) + '"]') as HTMLInputElement | null)?.focus(); }); throw failure; } }
      if (savedDraft && domainChanges(savedDraft)) {
        for (const [path, field] of Object.entries(savedDraft.fields)) { try { parseInput(field.spec, field.value); } catch (failure) { setFieldError({ path, message: message(failure) }); throw failure; } }
        const checked = commitFields(savedDraft); next = await saveType({ ...workspace, revision: savedDraft.revision }, checked);
        redoMethods.current = {}; redoRating.current = null;
        if (draftRef.current === savedDraft) setDraft(null); else setDraft(current => current ? { ...current, revision: next.revision, base: next.document } : null);
        await refresh(next);
        if (savedRating) { ratingToSave = { ...savedRating, revision: next.revision }; ratingRef.current = ratingToSave; setRatingDraft(ratingToSave); }
        methodsToSave = Object.fromEntries(Object.entries(savedMethods).map(([module, original]) => [module, { ...original, revision: next.revision }]));
        methodsRef.current = methodsToSave; setMethodDrafts(methodsToSave);
      }
      if (ratingToSave && ratingChangesFor(ratingToSave)) { await saveRating(wid, ratingToSave, ratingToSave.revision); if (ratingRef.current === ratingToSave) setRatingDraft(null); await refreshResults(); }
      for (const [module, original] of Object.entries(methodsToSave)) {
        if (methodChangesFor(original)) await saveMethod(wid, original);
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
    if (methodModule) {
      if (location.module === 'rating-table' && ratingRef.current) {
        redoRating.current = ratingRef.current; ratingRef.current = null; setRatingDraft(null);
        setError(''); setNotice('已撤销未保存工况修改；可重做恢复'); return;
      }
      if (methodsRef.current[location.module]) {
        redoMethods.current[location.module] = methodsRef.current[location.module];
        const remaining = { ...methodsRef.current }; delete remaining[location.module]; methodsRef.current = remaining; setMethodDrafts(remaining);
        setError(''); setNotice('已撤销未保存方法条件；可重做恢复'); return;
      }
      await restoreSavedMethod('undo'); return;
    }
    if (draftRef.current && Object.keys(draftRef.current.fields).length) {
      setHistory(current => { const present = current.present!; const clean = countInputChanges(present.base, present.document) ? { ...present, fields: {} } : null;
        return { present: clean, past: current.past, future: [...current.future, present] }; });
      setError(''); setNotice('已撤销未提交的数值输入；可重做恢复'); return;
    }
    if (history.past.length) { setHistory(current => domainDraftReducer(current, { type: 'undo' })); setError(''); setNotice('已撤销上一处结构修改；可重做恢复'); return; }
    if (savedHistoryReason) { setError(savedHistoryReason); return; }
    if (workspace.raw.can_undo !== true) { setError('没有可撤销的已保存型号版本'); return; }
    pending.current = true; setBusy(true); setError('');
    try { setDraft(null); await refresh(await historyType(workspace, 'undo')); setNotice('已恢复上一份型号输入；可重做恢复'); } catch (error) { setError(message(error)); }
    finally { pending.current = false; setBusy(false); }
  }
  async function restoreSavedMethod(direction: 'undo' | 'redo') {
    if (savedHistoryReason) { setError(savedHistoryReason); return; }
    if (!workspace || !activeStudy || activeStudy[direction === 'undo' ? 'can_undo' : 'can_redo'] !== true) { setError(direction === 'undo' ? '当前方法没有可撤销的保存版本' : '当前方法没有可重做的保存版本'); return; }
    pending.current = true; setBusy(true); setError('');
    try { await restoreStudy(wid, activeStudy.id, direction, { expected_revision: workspace.revision, expected_study_revision: activeStudy.revision, request_id: crypto.randomUUID() });
      await refreshResults(); setNotice(direction === 'undo' ? '已恢复上一份方法条件；型号结构保持原状' : '已重做方法条件；型号结构保持原状'); }
    catch (error) { setError(message(error)); }
    finally { pending.current = false; setBusy(false); }
  }
  async function redo() {
    if (pending.current || !workspace || readOnly) return;
    setFieldError(null); setError('');
    if (methodModule) {
      if (localMethod) return;
      if (location.module === 'rating-table' && redoRating.current) { const next = redoRating.current; redoRating.current = null; ratingRef.current = next; setRatingDraft(next); setNotice('已重做未保存工况修改'); return; }
      const method = redoMethods.current[location.module];
      if (method) { const next = { ...methodsRef.current, [location.module]: method }; delete redoMethods.current[location.module]; methodsRef.current = next; setMethodDrafts(next); setNotice('已重做未保存方法条件'); return; }
      await restoreSavedMethod('redo'); return;
    }
    if (history.future.length) { setHistory(current => domainDraftReducer(current, { type: 'redo' })); setNotice('已重做结构修改'); return; }
    if (savedHistoryReason) { setError(savedHistoryReason); return; }
    if (draftRef.current || workspace.raw.can_redo !== true) return;
    pending.current = true; setBusy(true);
    try { await refresh(await historyType(workspace, 'redo')); setNotice('已重做保存的型号输入'); } catch (error) { setError(message(error)); }
    finally { pending.current = false; setBusy(false); }
  }
  function discard() { setDraft(null); ratingRef.current = null; setRatingDraft(null); methodsRef.current = {}; setMethodDrafts({}); redoMethods.current = {}; redoRating.current = null; setError(''); setFieldError(null); }
  return <Context.Provider value={{ workspace, document, dirty, changeCount, inputDirty: structureChanges > 0, canUndo: !!canUndo, canRedo: !!canRedo, undoReason, redoReason, busy, loading: query.isPending, error: error || (query.error ? message(query.error) : ''), notice, readOnly: !!readOnly, draft,
    ratingDraft, methodDrafts, setMethodDraft: (module, value) => { if (!readOnly && !busy) { const next = { ...methodsRef.current }, draft = typeof value === 'function' ? value(next[module]) : value; if (draft) next[module] = draft; else delete next[module]; delete redoMethods.current[module]; methodsRef.current = next; setMethodDrafts(next); setError(''); setNotice(''); setFieldError(null); } }, fieldError, setRatingDraft: value => { if (!readOnly && !busy) { const next = typeof value === 'function' ? value(ratingRef.current) : value; redoRating.current = null; ratingRef.current = next; setRatingDraft(next); setError(''); setNotice(''); setFieldError(null); } },
    setField, edit, save, commitResourceValue, undo, redo, discard, reload: () => { void query.refetch(); }, locked: path => !!readOnly || isLocked(workspace?.raw.locks, path) }}>{children}
    <Dialog open={blocker.status === 'blocked'} onOpenChange={open => { if (!open) blocker.reset?.(); }} title="型号有未保存修改" description="保存后再离开，或放弃本次草稿。"
      actions={<Button onClick={() => { discard(); blocker.proceed?.(); }}>放弃修改并离开</Button>} />
  </Context.Provider>;
}
