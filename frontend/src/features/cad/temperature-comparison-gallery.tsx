import { useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { savedDomain } from '@/lib/domain-fields';
import { temperatureView } from '@/lib/temperature-view';
import { CadViewport } from './cad-viewport';
import { inputScene } from './input-scene';
import { savedThermal } from './saved-thermal';
import { useSavedFieldControls } from './saved-field-controls';
import type { CadSelection, CadViewportHandle, CanvasState } from './types';

declare global { interface Window { cadSavedFixture?: { fem: Record<string, unknown>; iec: Record<string, unknown> } } }
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
function SavedGallery({ state }: { state: CanvasState }) {
  const run = window.cadSavedFixture?.fem;
  const document = useMemo(() => run ? savedDomain(run) : undefined, [run]);
  const sectionId = useMemo(() => run ? temperatureView(run)?.section?.id || '' : '', [run]);
  const [selected, setSelected] = useState<CadSelection>(null), ref = useRef<CadViewportHandle>(null);
  const fields = useSavedFieldControls(run, document!, sectionId);
  const thermal = fields.thermal || (!fields.comparisonRequested && run && document ? savedThermal(run, document, sectionId) : undefined);
  const geometry = useMemo(() => document && sectionId ? inputScene(document, sectionId) : null, [document, sectionId]);
  const latest = useRef({ thermal, geometry }); latest.current = { thermal, geometry };
  useEffect(() => {
    window.canvasGallery ||= {};
    window.canvasGallery.field = { snapshot: () => latest.current, exportImage: async () => { const image = await ref.current!.exportImage(); return { metadata: image.metadata, bytes: [...new Uint8Array(await image.blob.arrayBuffer())] }; } };
    return () => { delete window.canvasGallery?.field; };
  }, []);
  return <section className="canvas-gallery-entry" data-gallery-entry="cad-field"><span>已保存运行回放 · 不提交计算</span><div className="canvas-gallery-stage">
    <CadViewport ref={ref} geometry={state === 'empty' ? null : geometry} thermal={state === 'empty' ? undefined : thermal} controls={fields.controls} selectedObject={selected} onSelectionChange={setSelected}
      state={state} error={state === 'error' ? '保存场读取失败，请重试。' : undefined} resultStatus={!run ? '缺少保存运行回放数据' : '保存运行'} />
  </div></section>;
}
/** Isolated gallery replays supplied saved artifacts; no synthetic temperature fixture. */
export function TemperatureComparisonGallery(props: { state: CanvasState }) { return <QueryClientProvider client={queryClient}><SavedGallery {...props} /></QueryClientProvider>; }
