import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { LayingSection } from '../drawing/laying-section';
import type { DomainDocument, SectionSelection } from '../drawing/types';
import type { GeometryChange } from '../drawing/what-if';
import { SceneWhatIf } from './scene-what-if';
import { inputScene } from './input-scene';
import { savedThermal } from './saved-thermal';
import type { CadViewportHandle, CanvasState } from './types';

declare global { interface Window { cadWhatIfFixture?: { document: DomainDocument; run?: Record<string, unknown>; sectionId: string;
  preview: (document: DomainDocument) => Promise<Record<string, unknown>> } } }

/** Real host preview injected by browser regression; never invents temperatures. */
export function WhatIfGallery({ state }: { state: CanvasState }) {
  const fixture = window.cadWhatIfFixture;
  const [three, setThree] = useState(new URLSearchParams(location.search).get('kind') !== 'section');
  const [selected, setSelected] = useState<SectionSelection>(null), viewport = useRef<CadViewportHandle>(null);
  const proposals = useRef<readonly GeometryChange[][]>([]);
  const thermal = useMemo(() => fixture?.run ? savedThermal(fixture.run, fixture.document, fixture.sectionId) : undefined, [fixture]);
  const geometry = useMemo(() => fixture ? inputScene(fixture.document, fixture.sectionId) : null, [fixture]);
  const latest = useRef(selected); latest.current = selected;
  useEffect(() => {
    window.canvasGallery ||= {};
    window.canvasGallery.whatIf = { snapshot: () => ({ selected: latest.current, proposals: proposals.current }),
      project: (x, z) => viewport.current?.project(x * 1000, 0, z * 1000) || null };
    return () => { delete window.canvasGallery?.whatIf; };
  }, []);
  if (!fixture) return <section data-gallery-entry="cad-what-if">缺少真实试算输入</section>;
  const common = { state, document: fixture.document, sectionId: fixture.sectionId, thermal, preview: fixture.preview,
    onPropose: (changes: readonly GeometryChange[]) => { proposals.current = [...proposals.current, [...changes]]; },
    error: state === 'error' ? '输入读取失败；草稿保留。' : undefined };
  return <section className="canvas-gallery-entry" data-gallery-entry="cad-what-if">
    <div className="canvas-gallery-controls"><Button size="compact" aria-pressed={!three} onClick={() => setThree(false)}>二维试算</Button>
      <Button size="compact" aria-pressed={three} onClick={() => setThree(true)}>三维试算</Button></div>
    <div className="canvas-gallery-stage">{three ? <SceneWhatIf {...common} ref={viewport} geometry={state === 'empty' ? null : geometry}
      selectedObject={selected ? { kind: 'object', id: selected.id } : null} onSelectionChange={value => {
        const o = geometry?.objects.find(o => o.id === value?.id);
        setSelected(o && ['cable', 'enclosure'].includes(o.kind) ? { kind: o.kind as 'cable' | 'enclosure', id: o.id } : null);
      }} /> : <LayingSection {...common} document={state === 'empty' ? null : fixture.document} selectedObject={selected} onSelectionChange={setSelected} />}</div>
  </section>;
}
