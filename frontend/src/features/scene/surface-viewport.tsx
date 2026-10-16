import { useEffect, useRef, useState } from 'react';
import { useViewState } from '@/lib/use-view-state';
import { createSurfaceRenderer, type SurfaceFrame, type SurfaceHandle } from './surface-renderer';
import type { SurfaceCamera, SurfaceModel, SurfacePalette, Vec3 } from './surface-model';
import './surface.css';

const noHidden: readonly string[] = [];
const initialView = { slice: 1, ghost: true, camera: undefined as SurfaceCamera | undefined };
function readPalette(element: HTMLElement): SurfacePalette {
  const css = getComputedStyle(element);
  function read(name: string): Vec3 {
    const value = css.getPropertyValue(name).trim();
    const hex = value.match(/^#([\da-f]{6})$/i);
    if (hex) return [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16) / 255) as Vec3;
    const numbers = value.match(/[\d.]+/g);
    if (value.startsWith('rgb') && numbers && numbers.length >= 3) return numbers.slice(0, 3).map(v => Number(v) / 255) as Vec3;
    throw new Error(`缺少场景显示令牌 ${name}。`);
  }
  return { background: read('--background'), line: read('--border'), selected: read('--copper'), temperatures: [1, 2, 3, 4, 5, 6].map(i => read(`--temperature-${i}`)), materials: {
    conductor: read('--conductor'), metal: read('--material-metal'), semiconductor: read('--material-semi'),
    insulation: read('--material-insulation'), polymer: read('--material-sheath'),
    filler: read('--text-secondary'), soil: read('--text-weak'), unknown: read('--material-metal'),
  } };
}
export function SurfaceViewport({ model, selected = null, hidden = noHidden, onSelect, viewKey, caption, labels }: {
  model: SurfaceModel; selected?: string | null; hidden?: readonly string[];
  onSelect: (id: string | null) => void; viewKey: string; caption: string; labels?: Readonly<Record<string, string>>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null), controller = useRef<SurfaceHandle | null>(null);
  const callback = useRef(onSelect); callback.current = onSelect;
  const [view, setView] = useViewState(viewKey + ':surface', initialView);
  const initialCamera = useRef(view.camera); initialCamera.current = view.camera;
  const [frame, setFrame] = useState<SurfaceFrame | null>(null), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let alive = true, renderer: SurfaceHandle | undefined;
    setError(''); setFrame(null);
    const observer = new MutationObserver(() => {
      try { renderer?.palette(readPalette(element)); } catch (problem) { if (alive) setError(problem instanceof Error ? problem.message : '场景配色不可用'); }
    });
    try {
      renderer = createSurfaceRenderer(element, model, readPalette(element), {
        pick: id => callback.current(id), frame: value => { if (alive) setFrame(value); },
        camera: camera => { if (alive) setView(previous => ({ ...previous, camera })); },
        error: value => { if (alive) setError(value); },
      }, initialCamera.current);
      controller.current = renderer;
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    } catch (problem) { setError(problem instanceof Error ? problem.message : '场景视口无法启动'); }
    return () => { alive = false; observer.disconnect(); renderer?.destroy(); controller.current = null; };
  }, [model, viewKey, attempt, setView]);
  useEffect(() => { controller.current?.update({ selected, hidden, slice: view.slice, ghost: view.ghost }); }, [model, selected, hidden, view.slice, view.ghost, attempt]);
  return <div className="surface-view" data-surface-state={error ? 'error' : frame ? 'ready' : 'loading'}>
    <div className="surface-toolbar" role="toolbar" aria-label="场景查看工具">
      <button type="button" disabled={!!error} onClick={() => controller.current?.fit()}>适应 F</button>
      <button type="button" disabled={!!error} onClick={() => controller.current?.view('iso')}>轴测</button>
      <button type="button" disabled={!!error} onClick={() => controller.current?.view('end')}>端面</button>
      <button type="button" disabled={!!error} onClick={() => controller.current?.view('top')}>俯视</button>
      <button type="button" aria-label="放大场景" disabled={!!error} onClick={() => controller.current?.zoom(1.2)}>＋</button>
      <button type="button" aria-label="缩小场景" disabled={!!error} onClick={() => controller.current?.zoom(1 / 1.2)}>－</button>
      <label className="surface-slice">剖切<input aria-label="场景剖切位置" type="range" min="2" max="100" value={Math.round(view.slice * 100)} onChange={e => { const slice = Number(e.target.value) / 100; setView(previous => ({ ...previous, slice })); }} /></label>
      <label><input type="checkbox" checked={view.ghost} onChange={e => { const ghost = e.target.checked; setView(previous => ({ ...previous, ghost })); }} />环境透视</label>
    </div>
    <div className="surface-stage">
      <canvas key={attempt} ref={canvas} tabIndex={0} aria-label="三维场景：拖动旋转，Shift 拖动平移，滚轮缩放；方向键旋转，F 适应" />
      {!error && frame && <svg className="surface-labels" viewBox={`0 0 ${frame.width} ${frame.height}`} aria-hidden="true">
        {frame.projections.map(p => <g key={p.id} className={p.id === selected ? 'surface-label is-selected' : 'surface-label'}>
          <circle cx={p.x} cy={p.y} r="3" /><path d={`M${p.x} ${p.y}v-16`} />
          <text x={Math.max(12, Math.min(frame.width - 140, p.x + 7))} y={Math.max(24, p.y - 20)}>{labels?.[p.id] || p.label}</text>
        </g>)}
      </svg>}
      {error && <div className="surface-error" role="alert"><strong>场景暂不可用</strong><p>{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>重载场景</button></div>}
      {!error && !frame && <p className="surface-loading" role="status">正在建立显示网格…</p>}
    </div>
    <footer className="surface-status"><span>{caption}</span><span>{frame ? `网格 ${Number(frame.gridStep.toPrecision(3))} m` : '米制坐标'} · Z 向上</span></footer>
  </div>;
}
