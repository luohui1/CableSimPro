// The laying as the run saw it, drawn to scale from the run record's own document: the soil, and each cable with its real layers.
// The cable that reaches its limit first has a ring.
import { CableGlyph } from '@/canvas/cable-glyph';
import { buildScene, lensBox } from '@/canvas/scene';
import type { RunRecord } from '@shared/types';

const WIDTH = 220;

export function SectionThumb({ record, className }: { record: RunRecord; className?: string }) {
  if (!record.document) return null;
  const scene = buildScene(record.document, record.summary?.operating?.cables, record.summary?.ampacity?.limiting_cable);
  const box = lensBox(scene, 'cluster');
  const scale = WIDTH / (box.right - box.left);
  const height = (box.top - box.bottom) * scale;
  const at = (x: number, z: number): [number, number] => [(x - box.left) * scale, (box.top - z) * scale];
  const ground = at(0, 0)[1];
  return <svg viewBox={`0 0 ${WIDTH} ${height}`} className={className} role="img" aria-label="断面缩略图">
    <rect x={0} y={ground} width={WIDTH} height={Math.max(0, height - ground)} fill="var(--cad-soil)" opacity={0.28} />
    <line x1={0} x2={WIDTH} y1={ground} y2={ground} stroke="var(--text-secondary)" strokeWidth={1} />
    {scene.cables.map(cable => {
      const [x, y] = at(cable.x, cable.z);
      return <g key={cable.id}>
        <CableGlyph shape={scene.shape} x={x} y={y} scale={scale} />
        {cable.limiting && <circle cx={x} cy={y} r={scene.shape.radius * scale + 2.5} fill="none" stroke="var(--copper)" strokeWidth={1.5} />}
      </g>;
    })}
  </svg>;
}
