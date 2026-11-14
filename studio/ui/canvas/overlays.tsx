// What floats on the drawing besides tools: the temperature scale and the whole-section inset.
import { rampPosition, type Ramp } from '@/lib/ramp';
import { frame, toScreen, toWorld, type Camera, type Size } from './camera';
import { lensBox, type Scene } from './scene';

export function Legend({ ramp, ambient, limit, soil, lines }: {
  ramp: Ramp;
  ambient: number;
  limit: number;
  /** Whether the soil is coloured by its temperature (otherwise only the conductors are). */
  soil: boolean;
  /** Isotherm interval in kelvin, when isotherms are drawn. */
  lines: number | null;
}) {
  const ticks = [ambient, limit];
  for (let value = Math.ceil((ambient + 8) / 20) * 20; value <= limit - 8; value += 20) ticks.push(value);
  ticks.sort((a, b) => a - b);
  const gradient = Array.from({ length: 12 }, (_, index) => ramp.field(index / 11)).join(', ');
  const width = 196;
  return <div className="rounded-card border border-line bg-panel px-3 pt-2 pb-1.5 shadow-lift">
    <div className="mb-1.5 flex items-baseline justify-between text-13">
      <span className="text-ink">{lines === null && !soil ? '导体的颜色是温度' : '颜色是温度'}</span>
      <span className="text-ink-2">°C</span>
    </div>
    <div className="h-2 rounded-full" style={{ width, background: `linear-gradient(to right, ${gradient})`, boxShadow: 'inset 0 0 0 1px color-mix(in oklab, var(--text) 12%, transparent)' }} />
    <div className="relative mt-1 h-5 text-13 text-ink-2" style={{ width }}>
      {ticks.map((value, index) => {
        const at = rampPosition(value, ambient, limit) * width;
        return <span key={value} className="absolute top-0" style={index === 0 ? { left: 0 } : index === ticks.length - 1 ? { right: 0 } : { left: at, translate: '-50% 0' }}>
          {Number(value.toFixed(1))}
        </span>;
      })}
    </div>
    {lines !== null && <div className="mt-0.5 flex items-center gap-2 border-t border-line pt-1.5 text-13 text-ink-2">
      <span className="h-px w-6 bg-ink-2" />细线是等温线，每 {lines} °C 一条
    </div>}
  </div>;
}

const MINI: Size = { width: 168, height: 104 };

/** The whole section from the ground down, with the part the main view shows. */
export function Minimap({ scene, camera, size, paper }: { scene: Scene; camera: Camera; size: Size; paper: string }) {
  const mini = frame(lensBox(scene, 'overview'), MINI, { top: 22, right: 8, bottom: 8, left: 8 });
  const point = (x: number, z: number) => toScreen(mini, MINI, x, z);
  const ground = point(0, 0)[1];
  const [left, top] = toWorld(camera, size, 0, 0);
  const [right, bottom] = toWorld(camera, size, size.width, size.height);
  const [x0, y0] = point(left, top);
  const [x1, y1] = point(right, bottom);
  const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
  const view = { x: clamp(x0, 1, MINI.width - 1), y: clamp(y0, 1, MINI.height - 1), x2: clamp(x1, 1, MINI.width - 1), y2: clamp(y1, 1, MINI.height - 1) };
  return <div className="overflow-hidden rounded-card border border-line bg-panel shadow-lift">
    <svg width={MINI.width} height={MINI.height} className="block">
      <rect x={0} y={ground} width={MINI.width} height={MINI.height - ground} fill={paper} />
      <line x1={0} x2={MINI.width} y1={ground} y2={ground} stroke="var(--text)" strokeWidth={1} />
      {scene.cables.map(cable => {
        const [x, y] = point(cable.x, cable.z);
        return <circle key={cable.id} cx={x} cy={y} r={Math.max(1.6, cable.radius * mini.scale)} fill="var(--text)" />;
      })}
      <rect x={view.x} y={view.y} width={Math.max(2, view.x2 - view.x)} height={Math.max(2, view.y2 - view.y)}
        fill="color-mix(in oklab, var(--text) 7%, transparent)" stroke="var(--text)" strokeWidth={1.25} rx={2} />
      <text x={8} y={15} fontSize={13} fill="var(--text-secondary)">全图</text>
    </svg>
  </div>;
}
