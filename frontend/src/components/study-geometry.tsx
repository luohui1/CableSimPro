import { useEffect, useMemo, useState, type Ref } from 'react';
import { studyModuleRoute } from '@/router';
import { message } from '@/api/client';
import { prewarmCad } from '@/features/cad';
import { SceneWhatIf } from '@/features/cad/scene-what-if';
import type { WhatIfProps } from '@/features/drawing/what-if';
import { inputScene } from '@/features/cad/input-scene';
import { colorScene, latestSavedRun, savedThermal } from '@/features/cad/saved-thermal';
import type { CanvasState, CadViewportHandle, CadViewportProps } from '@/features/cad/types';
import { caseRun, useSavedFieldControls } from '@/features/cad/saved-field-controls';
import type { SectionSelection } from '@/features/drawing';
import { commitFields, type DomainDocument } from '@/lib/domain-fields';
import { useStudy } from './study-provider';

export function StudyGeometry({ document, sectionId, historical, selected, onSelect, run, fieldCase, viewportRef, onExport, preview, onPropose }: {
  document: DomainDocument; sectionId: string; historical: boolean; selected: SectionSelection;
  onSelect: (selection: SectionSelection) => void; run?: Record<string, unknown>; fieldCase?: string;
  viewportRef?: Ref<CadViewportHandle>; onExport?: CadViewportProps['onExport'];
} & WhatIfProps) {
  const context = useStudy();
  const search = studyModuleRoute.useSearch();
  const navigate = studyModuleRoute.useNavigate();
  const [stable, setStable] = useState(document);
  const [draftError, setDraftError] = useState('');
  useEffect(() => { prewarmCad(); }, []);
  useEffect(() => {
    if (historical || !context.domainDraft) { setStable(document); setDraftError(''); return; }
    const timer = window.setTimeout(() => {
      try { setStable(commitFields(context.domainDraft!)); setDraftError(''); }
      catch (error) { setDraftError(message(error)); }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [document, context.domainDraft, historical]);
  const active = run || latestSavedRun(context.runs, search.run);
  const fields = useSavedFieldControls(context.dirty ? undefined : active, stable, sectionId, fieldCase);
  const previewBaseline = useMemo(() => { try { return active && !context.dirty ? savedThermal(caseRun(active, fieldCase), stable, sectionId, fieldCase) : undefined; } catch { return undefined; } }, [active, context.dirty, stable, sectionId, fieldCase]);
  const display = useMemo(() => {
    if (!sectionId) return { geometry: null, status: '尚无结果', resultState: 'empty' as CanvasState };
    try {
      const scene = inputScene(stable, sectionId);
      let status = context.loadingRuns ? '读取保存结果' : context.runError ? '结果读取失败 · 仅几何' : '尚无结果';
      let resultState: CanvasState = context.loadingRuns ? 'loading' : context.runError ? 'error' : 'empty';
      try {
        if (active && !context.dirty) {
          const thermal = fields.thermal || (fields.comparisonRequested ? undefined : savedThermal(caseRun(active, fieldCase), stable, sectionId, fieldCase));
          if (thermal) {
            const old = historical || active.freshness === 'historical';
            return { geometry: colorScene(scene, thermal), thermal, status: old ? '历史运行' : '保存运行', resultState: (old ? 'historical' : 'success') as CanvasState };
          }
          status = fields.reason || '尚无有效温度结果';
        } else if (active) { status = '输入待保存 · 未叠加历史温度'; resultState = 'historical'; }
      } catch (error) { status = message(error); resultState = 'error'; }
      return { geometry: scene, status, resultState };
    } catch (error) { return { geometry: null, status: '几何不可用', error: message(error), resultState: 'error' as CanvasState }; }
  }, [stable, sectionId, context.loadingRuns, context.runError, context.dirty, active, fieldCase, historical, fields.thermal, fields.comparisonRequested, fields.reason]);
  return <SceneWhatIf document={stable} sectionId={sectionId} preview={preview} onPropose={onPropose} baselineThermal={previewBaseline} ref={viewportRef} onExport={onExport} geometry={display.geometry} thermal={display.thermal} controls={fields.controls} resultStatus={fields.reason === display.status ? undefined : display.status} resultState={display.resultState}
    state={!sectionId ? 'empty' : display.error || draftError ? 'error' : historical ? 'historical' : 'success'}
    error={display.error || draftError} onFallback={() => void navigate({ search: previous => ({ ...previous, view: 'section' }) })}
    selectedObject={selected ? { kind: 'object', id: selected.id } : null}
    onSelectionChange={value => {
      const object = display.geometry?.objects.find(o => o.id === value?.id);
      onSelect(object && ['cable', 'enclosure', 'backfill', 'soil'].includes(object.kind)
        ? { kind: object.kind as NonNullable<SectionSelection>['kind'], id: object.id } : null);
    }} />;
}
