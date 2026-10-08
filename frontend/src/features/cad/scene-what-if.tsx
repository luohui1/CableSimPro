import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { IconButton } from '@/components/ui/button';
import { useWhatIf } from '../drawing/use-what-if';
import { WhatIfDimensions } from '../drawing/what-if-dimensions';
import { drawingShortcut } from '../drawing/use-drawing-shortcuts';
import { moveSelection, validateSectionEdit } from '../drawing/section-geometry';
import { replaceSection, type WhatIfProps } from '../drawing/what-if';
import type { DomainDocument, SectionSelection } from '../drawing/types';
import { CadViewport } from './cad-viewport';
import { inputScene } from './input-scene';
import type { CadObjectMove, CadThermal, CadViewportHandle, CadViewportProps } from './types';

export interface SceneWhatIfProps extends CadViewportProps, WhatIfProps { document: DomainDocument; sectionId: string; baselineThermal?: CadThermal }
export const SceneWhatIf = forwardRef<CadViewportHandle, SceneWhatIfProps>(function SceneWhatIf(props, ref) {
  const trial = useWhatIf(props.document, props.sectionId, props, props.baselineThermal || props.thermal, props.state === 'historical' || props.state === 'empty' || props.state === 'error');
  const [dragDocument, setDragDocument] = useState<DomainDocument | null>(null), [error, setError] = useState('');
  const origin = useRef<DomainDocument | null>(null);
  useEffect(() => { origin.current = null; setDragDocument(null); setError(''); }, [props.document, props.sectionId, trial.enabled]);
  const draft = trial.enabled ? dragDocument || trial.document || props.document : props.document;
  const section = draft.sections.find(s => s.id === props.sectionId);
  const display = useMemo(() => {
    if (!trial.enabled) return { geometry: props.geometry, error: '' };
    try { return { geometry: inputScene(draft, props.sectionId), error: '' }; }
    catch (reason) { return { geometry: null, error: reason instanceof Error ? reason.message : String(reason) }; }
  }, [trial.enabled, draft, props.sectionId, props.geometry]);
  const object = display.geometry?.schema === 'cablesim.cad-scene/1' ? display.geometry.objects.find(o => o.id === props.selectedObject?.id) : undefined;
  const selected: SectionSelection = object && ['cable', 'enclosure'].includes(object.kind) ? { kind: object.kind as 'cable' | 'enclosure', id: object.id } : null;
  function move(value: CadObjectMove) {
    if (value.phase === 'cancel') { origin.current = null; setDragDocument(null); setError(value.error || ''); return; }
    const base = origin.current || trial.document;
    if (!base) return;
    origin.current = base;
    try {
      const before = base.sections.find(s => s.id === props.sectionId);
      const kind = before?.placements.some(p => p.cable === value.id) ? 'cable' : 'enclosure';
      if (!before) throw Error('试算截面不存在。');
      const selection = { kind, id: value.id } as const;
      const next = moveSelection(before, selection, { x: value.deltaXM, z: value.deltaZM }, true);
      validateSectionEdit(base, next.section, next.fields);
      setError('');
      if (value.phase === 'preview') setDragDocument(replaceSection(base, next.section));
      else trial.commit(next.section, { gestureId: crypto.randomUUID(), kind: 'move', selection, fields: next.fields });
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (value.phase === 'commit') { origin.current = null; setDragDocument(null); } }
  }
  return <div className="scene-what-if" onKeyDown={event => {
    if (trial.enabled) drawingShortcut(event, trial.command);
  }}>
    <CadViewport {...props} ref={ref} geometry={display.geometry} error={props.error || display.error}
      thermal={trial.enabled ? dragDocument ? undefined : trial.thermal : props.thermal}
      onObjectMove={trial.enabled ? move : undefined} resultStatus={trial.enabled ? null : props.resultStatus}
      controls={trial.controls ? <>{trial.controls}{trial.enabled ? <>
        <div className="what-if-edit-tools">
          {section && <WhatIfDimensions section={section} selected={selected} commit={trial.commit} />}
          <IconButton icon="action/undo" label="撤销试算 Ctrl+Z" disabled={!trial.canUndo} onClick={() => trial.command('undo')} />
          <IconButton icon="action/redo" label="重做试算 Ctrl+Y" disabled={!trial.canRedo} onClick={() => trial.command('redo')} />
          {error && <span className="what-if-field-error" role="alert">{error}</span>}
        </div></> : props.controls}</> : props.controls} />
  </div>;
});
