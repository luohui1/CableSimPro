// What floats on the drawing besides the frame's tools and temperature scale: the whole-section inset.
import { frame, toScreen, toWorld, type Camera, type Size } from './camera';
import { lensBox, type Scene } from './scene';

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
