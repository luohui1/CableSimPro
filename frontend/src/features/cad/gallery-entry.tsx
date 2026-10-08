import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { CadViewport } from './index';
import { demoDocument, demoModel, demoScene, envelopeModel, previewModel, updatedModel } from './gallery-fixtures';
import { inputScene } from './input-scene';
import { largeSceneDocument } from './tests/large-scene-fixture';
import { TemperatureComparisonGallery } from './temperature-comparison-gallery';
import { runtimeDiagnostics } from './occt-runtime';
import type { GalleryEntry } from './gallery-support';
import type { CadGeometry, CadSelection, CadTiming, CadViewportHandle, CanvasState } from './types';

export function CadGallery({ state }: { state: CanvasState }) {
  const [geometry, setGeometry] = useState<CadGeometry>(() => new URLSearchParams(location.search).get('kind') === 'large' ? inputScene(largeSceneDocument(demoDocument), demoDocument.sections[0].id) : new URLSearchParams(location.search).get('kind') === 'scene' ? demoScene : envelopeModel);
  const [selection, setSelection] = useState<CadSelection>(() => geometry.schema === 'cablesim.cad-scene/1'
    ? { kind: 'object', id: geometry.objects.find(object => object.kind === 'cable')!.id }
    : { kind: 'layer', id: demoModel.layers[1].entity! });
  const [mounted, setMounted] = useState(true);
  const [timings, setTimings] = useState<CadTiming[]>([]);
  const viewport = useRef<CadViewportHandle>(null);
  const mismatchExact = useRef(false);
  const latest = useRef({ geometry, selection, timings }); latest.current = { geometry, selection, timings };
  const scene = geometry.schema === 'cablesim.cad-scene/1';
  useEffect(() => {
    window.canvasGallery ||= {};
    window.canvasGallery.cad = {
      snapshot: () => ({ ...latest.current, info: viewport.current?.info(), runtime: runtimeDiagnostics() }),
      replace: kind => setGeometry(kind === 'envelope' ? envelopeModel : kind === 'preview' ? previewModel : kind === 'exact' ? demoModel
        : kind === 'unkeyed-preview' ? { ...previewModel, layers: previewModel.layers.map(({ geometry_key: _key, ...layer }) => layer) }
        : kind === 'invalid' ? { ...demoModel, length_m: -1 } : updatedModel),
      mount: setMounted,
      mismatchExact: value => { mismatchExact.current = value; },
      exportImage: async () => { const image = await viewport.current!.exportImage(); return { metadata: image.metadata, bytes: [...new Uint8Array(await image.blob.arrayBuffer())] }; },
      project: (x, y, z) => viewport.current?.project(x, y, z) || null,
    };
    return () => { delete window.canvasGallery?.cad; };
  }, []);
  return <section className="canvas-gallery-entry" data-gallery-entry="cad">
    <div className="canvas-gallery-controls">
      <Button size="compact" aria-pressed={!scene} onClick={() => { setGeometry(envelopeModel); setSelection({ kind: 'layer', id: demoModel.layers[1].entity! }); }}>型号单根</Button>
      <Button size="compact" aria-pressed={scene} onClick={() => { setGeometry(demoScene); setSelection({ kind: 'object', id: demoScene.objects.find(item => item.kind === 'cable')!.id }); }}>敷设场景</Button>
      {!scene && <><Button size="compact" onClick={() => setGeometry(envelopeModel)}>包络先行</Button>
        <Button size="compact" onClick={() => setGeometry(previewModel)}>精细替换</Button></>}
      <Select label="选中对象" value={selection?.id || 'none'} onChange={id => setSelection(id === 'none' ? null : { kind: scene ? 'object' : 'layer', id })}
        options={[{ value: 'none', label: '无选中' }, ...(scene && geometry.schema === 'cablesim.cad-scene/1' ? geometry.objects.map(item => ({ value: item.id, label: item.label || item.id }))
          : demoModel.layers.map(layer => ({ value: layer.entity || layer.role, label: layer.role })))]} />
    </div>
    <div className="canvas-gallery-stage">{mounted && <CadViewport ref={viewport} state={state} geometry={state === 'empty' ? null : geometry}
      selectedObject={selection} onSelectionChange={setSelection} error={state === 'error' ? '演示网络错误：几何工件仍保留。' : undefined}
      loadExact={async (model, signal) => {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const exact = model.layers.every(layer => !layer.geometry_key) ? { ...demoModel,
          layers: demoModel.layers.map(({ geometry_key: _key, ...layer }) => layer) } : demoModel;
        return mismatchExact.current ? { ...exact, length_m: .14 } : exact;
      }}
      onReady={timing => setTimings(previous => [...previous, timing])} />}</div>
  </section>;
}
export const galleryEntries: readonly GalleryEntry[] = [{ id: 'cad', title: 'CAD 视口', Component: CadGallery }, { id: 'cad-field', title: '保存场三维回归', Component: TemperatureComparisonGallery }];
