import { useState } from 'react';
import { CableSection } from './cable-section';
import { LayingSection } from './laying-section';
import type { DomainDocument, LayerTarget, ResultAnnotation, SectionSelection } from './types';
import type { CanvasState } from '../cad/types';
import '@/styles/workbench.css';

declare global { interface Window { cadCompositionDocuments?: Record<string, DomainDocument>; cadCompositionAnnotations?: Record<string, Record<string, ResultAnnotation>> } }
export function CompositionGallery({ state }: { state: CanvasState }) {
  const kind = new URLSearchParams(location.search).get('kind') || 'trefoil';
  const [document, setDocument] = useState(() => window.cadCompositionDocuments?.[kind] || null);
  const [selected, setSelected] = useState<SectionSelection>(null), [layer, setLayer] = useState<LayerTarget | null>(null);
  const cable = kind === 'single' || kind === 'three';
  return <section className="canvas-gallery-entry composition-gallery" data-gallery-entry="composition">
    <div className="canvas-gallery-controls"><span>保存输入回放 · {document?.sections[0]?.label || '型号结构'}</span></div>
    <div className="canvas-gallery-stage workbench-canvas">
      {cable ? <CableSection cableType={state === 'empty' ? null : document?.cable_types[0] || null} materials={document?.materials || []}
        selectedObject={layer} onSelectionChange={setLayer} state={state} error={state === 'error' ? '输入读取失败' : undefined} showDimensions />
        : <LayingSection document={state === 'empty' ? null : document} sectionId={document?.sections[0].id || ''} selectedObject={selected} onSelectionChange={setSelected}
          onChange={section => { if (document) setDocument({ ...document, sections: document.sections.map(s => s.id === section.id ? section : s) }); }}
          annotations={window.cadCompositionAnnotations?.[kind]} state={state} error={state === 'error' ? '输入读取失败' : undefined} />}
    </div>
  </section>;
}
