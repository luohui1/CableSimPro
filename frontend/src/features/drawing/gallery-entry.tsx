import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CableSection } from './cable-section';
import { LayingSection } from './laying-section';
import { CompositionGallery } from './composition-gallery';
import { demoDocument, demoTemplate } from '../cad/gallery-fixtures';
import type { GalleryEntry } from '../cad/gallery-support';
import type { CanvasState } from '../cad/types';
import type { CableDimensionEdit, DomainDocument, LayerTarget, Section, SectionEdit, SectionSelection } from './types';

function changedCable(document: DomainDocument, edit: CableDimensionEdit) {
  const next = structuredClone(document), type = next.cable_types[0];
  if (edit.target.scope === 'common') type.common_layers.find(layer => layer.role === edit.target.role)!.thickness = edit.valueM;
  else {
    const target = edit.target;
    const core = type.cores.find(item => item.id === target.coreId)!;
    if (target.role === 'conductor') core.conductor.diameter = edit.valueM;
    else core.layers.find(layer => layer.role === target.role)!.thickness = edit.valueM;
  }
  return next;
}
export function CableGallery({ state }: { state: CanvasState }) {
  const [document, setDocument] = useState<DomainDocument>(() => structuredClone(demoDocument));
  const [selection, setSelection] = useState<LayerTarget | null>(null);
  const [locked, setLocked] = useState(false);
  const fail = useRef(false), edits = useRef<CableDimensionEdit[]>([]), commands = useRef<string[]>([]);
  const latest = useRef({ document, selection }); latest.current = { document, selection };
  useEffect(() => {
    window.canvasGallery ||= {};
    window.canvasGallery.cable = { snapshot: () => ({ ...latest.current, edits: edits.current, commands: commands.current }), lock: setLocked,
      construction: kind => { setDocument(demoTemplate(kind === 'three' ? 'three-core' : 'single', demoDocument).document); setSelection(null); },
      fail: value => { fail.current = value; } };
    return () => { delete window.canvasGallery?.cable; };
  }, []);
  return <section className="canvas-gallery-entry" data-gallery-entry="cable-section">
    <div className="canvas-gallery-controls"><Button size="compact" onClick={() => { setDocument(structuredClone(demoDocument)); setSelection(null); }}>单芯结构</Button>
      <Button size="compact" onClick={() => { setDocument(demoTemplate('three-core', demoDocument).document); setSelection(null); }}>三芯结构</Button></div>
    <div className="canvas-gallery-stage"><CableSection state={state} cableType={state === 'empty' ? null : document.cable_types[0]}
      materials={document.materials} selectedObject={selection} onSelectionChange={setSelection} isLocked={() => locked}
      error={state === 'error' ? '演示读取失败：输入仍保留。' : undefined} onRetry={() => {}} onCommand={command => commands.current.push(command)}
      onDimensionChange={async edit => {
        if (fail.current) throw new Error('演示提交失败；已保存结构未改变。');
        edits.current.push(edit); setDocument(current => changedCable(current, edit));
      }} /></div>
  </section>;
}

export function LayingGallery({ state }: { state: CanvasState }) {
  const [document, setDocument] = useState<DomainDocument>(() => structuredClone(demoDocument));
  const [selection, setSelection] = useState<SectionSelection>(null);
  const [locked, setLocked] = useState<string | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const past = useRef<DomainDocument[]>([]), future = useRef<DomainDocument[]>([]), fail = useRef(false);
  const edits = useRef<SectionEdit[]>([]), commands = useRef<string[]>([]), templates = useRef<string[]>([]);
  const latest = useRef({ document, selection }); latest.current = { document, selection };
  function adopt(next: DomainDocument) {
    past.current.push(latest.current.document); future.current = []; setDocument(next); setHistoryVersion(value => value + 1);
  }
  function change(nextSection: Section, edit: SectionEdit) {
    if (fail.current) throw new Error('演示提交失败；已保存位置未改变。');
    const next = structuredClone(latest.current.document); next.sections[0] = nextSection;
    edits.current.push(edit); adopt(next);
  }
  function command(value: 'undo' | 'redo' | 'save') {
    commands.current.push(value);
    if (value === 'undo' && past.current.length) { future.current.push(latest.current.document); setDocument(past.current.pop()!); }
    if (value === 'redo' && future.current.length) { past.current.push(latest.current.document); setDocument(future.current.pop()!); }
    setHistoryVersion(count => count + 1);
  }
  useEffect(() => {
    window.canvasGallery ||= {};
    window.canvasGallery.laying = { snapshot: () => ({ ...latest.current, edits: edits.current, commands: commands.current,
      templates: templates.current, undo: past.current.length, redo: future.current.length }), lock: setLocked, fail: value => { fail.current = value; } };
    return () => { delete window.canvasGallery?.laying; };
  }, []);
  return <section className="canvas-gallery-entry" data-gallery-entry="laying-section" data-history-revision={historyVersion}>
    <div className="canvas-gallery-stage"><LayingSection state={state} document={state === 'empty' ? null : document} sectionId="section/demo"
      selectedObject={selection} onSelectionChange={setSelection} onChange={change} isLocked={field => field === locked}
      onCommand={command} canUndo={!!past.current.length} canRedo={!!future.current.length}
      objectCommands={selection?.kind === 'cable' ? ['delete'] : []}
      error={state === 'error' ? '演示读取失败：保存的截面仍保留。' : undefined} onRetry={() => {}}
      onTemplateRequest={async id => { if (fail.current) throw new Error('演示模板请求失败。'); templates.current.push(id); adopt(demoTemplate(id, latest.current.document).document); setSelection(null); }}
      onObjectCommand={(value, selected) => {
        if (!selected || selected.kind !== 'cable') return;
        const next = structuredClone(latest.current.document);
        const section = next.sections[0];
        if (value === 'delete') {
          section.placements = section.placements.filter(item => item.cable !== selected.id);
          for (const enclosure of section.enclosures || []) enclosure.contains = enclosure.contains?.filter(id => id !== selected.id);
          adopt(next); setSelection(null);
        }
      }} /></div>
  </section>;
}
export const galleryEntries: readonly GalleryEntry[] = [
  { id: 'composition', title: '截面构图回归', Component: CompositionGallery },
  { id: 'cable-section', title: '电缆截面图', Component: CableGallery },
  { id: 'laying-section', title: '敷设截面编辑器', Component: LayingGallery },
];
