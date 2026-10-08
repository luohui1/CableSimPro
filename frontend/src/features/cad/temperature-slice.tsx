import { useEffect, useRef, useState } from 'react';
import { turbo } from '../field/colormap';
import { SceneWorkerClient } from './scene-worker-client';
import { formatNumber } from '@/lib/format';
import type { ViewportController as CadController } from './cad-controller';
import type { CadCamera, CadThermal } from './types';

const hex = (t: number) => '#' + turbo(t).map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
export function TemperatureSlice({ thermal, controller, camera, width, height, visible, onSelect }: {
  thermal: CadThermal; controller: CadController; camera: CadCamera; width: number; height: number; visible: boolean;
  onSelect: (id: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const render = useRef<(() => void) | null>(null);
  const upload = useRef<(() => Promise<void>) | null>(null);
  const projected = useRef({ controller, camera, width, height, thermal });
  projected.current = { controller, camera, width, height, thermal };
  const hasField = thermal.triangles.length > 0;
  useEffect(() => {
    const element = canvas.current;
    setReady(false);
    if (!element || !visible || !hasField) return;
    if (!element.transferControlToOffscreen) { setError('当前浏览器缺少后台温度切片环境。'); return; }
    let alive = true;
    const fail = (reason: Error) => { if (alive) { setReady(false); setError(reason.message); } };
    const worker = new SceneWorkerClient(fail), offscreen = element.transferControlToOffscreen();
    const deadline = window.setTimeout(() => { fail(new Error('温度切片初始化超时；请重载视口。')); worker.dispose(); }, 3000);
    const viewData = () => {
      const { controller: view, width: w, height: h } = projected.current;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      // Both viewport renderers are orthographic. Three projections suffice for every saved node.
      const o = view.project(0, 0, 0), x = view.project(1000, 0, 0), z = view.project(0, 0, 1000);
      return { width: Math.max(1, Math.round(w * dpr)), height: Math.max(1, Math.round(h * dpr)),
        origin: [o.x, o.y], dx: [x.x - o.x, x.y - o.y], dz: [z.x - o.x, z.y - o.y], size: [w, h] };
    };
    void worker.request('init', { canvas: offscreen, kind: 'field' }, [offscreen]).then(async () => {
      if (!alive) return;
      render.current = () => worker.draw(viewData());
      upload.current = async () => {
        setReady(false);
        await worker.request('field', { thermal: projected.current.thermal, view: viewData() });
        if (alive) { window.clearTimeout(deadline); setReady(true); setError(''); }
      };
      await upload.current();
    }).catch(fail);
    return () => {
      alive = false; window.clearTimeout(deadline); render.current = null; upload.current = null; worker.dispose();
    };
  }, [hasField, visible]);
  useEffect(() => { void upload.current?.().catch(reason => { setReady(false); setError(String(reason)); }); }, [thermal]);
  useEffect(() => { render.current?.(); }, [camera, width, height]);
  const hottest = thermal.conductors.find(c => c.hottest);
  const hot = hottest && controller.project(hottest.x * 1000, 0, hottest.z * 1000);
  const labelX = hot ? Math.max(16, Math.min(width - 180, hot.x + 28)) : 16;
  const labelY = hot ? Math.max(44, Math.min(height - 84, hot.y - 32)) : 44;
  return <>
    {visible && thermal.triangles.length > 0 && <canvas ref={canvas} className="cad-temperature-slice" aria-label="保存温度场垂直切片" data-cad-field-ready={ready} />}
    <svg className="cad-overlay cad-thermal-overlay" viewBox={`0 0 ${width} ${height}`} aria-label="导体温度与共享温度色标"
      data-run-id={thermal.runId} data-case-id={thermal.caseId} data-minimum={thermal.minimum} data-maximum={thermal.maximum}>
      {hot && hottest && <g className="cad-hot-conductor" role="button" tabIndex={0} aria-label={`选择最热导体 ${hottest.label} ${formatNumber(hottest.value, 1)} °C`}
        onClick={() => onSelect(hottest.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(hottest.id); } }} data-cad-hottest={hottest.id}>
        <circle cx={hot.x} cy={hot.y} r="8" /><path d={`M${hot.x} ${hot.y}L${labelX} ${labelY}`} />
        <text x={labelX} y={labelY - 6}>最热导体 {formatNumber(hottest.value, 1)} °C</text>
      </g>}
      <g className="cad-thermal-legend" transform={`translate(${Math.max(16, width - 104)}, 148)`} aria-label="温度色标">
        <text x="0" y="-10">°C</text>
        {Array.from({ length: 32 }, (_, i) => <rect key={i} x="0" y={i * 4} width="12" height="4.5" fill={hex(1 - i / 31)} />)}
        <text x="18" y="10">{formatNumber(thermal.maximum, 1)}</text><text x="18" y="128">{formatNumber(thermal.minimum, 1)}</text>
      </g>
    </svg>
    {error && <span className="cad-slice-error" role="status">{error}</span>}
  </>;
}
