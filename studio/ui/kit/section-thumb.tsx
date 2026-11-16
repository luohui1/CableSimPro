// A run's laying as a 4:3 thumbnail, for a result card: the soil coloured by the temperature the method states for the run
// (its mirror line sources, evaluated per pixel), each cable to scale with its layers and its conductor in the colour of its
// temperature, the cable that reaches its limit first ringed in copper, and the ground line when it is in view. Built from
// the run record alone (`thumbOf`). When the run states no closed-form field, or its published nodes disagree with it, the
// soil is drawn untinted: no temperature is invented. The dark theme lays the warmth over the dark soil instead of dimming
// the light ramp, which would turn it muddy.
import { useMemo } from 'react';
import { CableGlyph } from '@/canvas/cable-glyph';
import { fieldModel, temperatureAt, type FieldSource } from '@/canvas/field-model';
import { buildScene, lensBox, type Scene } from '@/canvas/scene';
import { RAMP_SIZE, rampPosition, readRamp, type Ramp } from '@/lib/ramp';
import { cn } from '@/lib/utils';
import { useTheme } from '@/state/theme';
import type { RunRecord } from '@shared/types';

/** The soil field of a run in closed form: the ambient temperature and the mirror line sources. */
export interface ThumbField { ambient: number; sources: FieldSource[] }

/** What the thumbnail needs from a run record; null when the record carries no section document. */
export function thumbOf(record: RunRecord): { scene: Scene; field: ThumbField | null } | null {
  if (!record.document) return null;
  const summary = record.summary;
  const scene = buildScene(record.document, summary?.operating?.cables, summary?.ampacity?.limiting_cable ?? undefined);
  const model = fieldModel(record);
  return { scene, field: model?.kind === 'analytic' ? { ambient: model.ambient, sources: model.sources } : null };
}

const WIDTH = 240;
const HEIGHT = 180;
/** The field is evaluated on a grid half the drawing's size and smoothed when drawn. */
const COLUMNS = WIDTH / 2;
const ROWS = HEIGHT / 2;

interface Frame { left: number; top: number; width: number; height: number; scale: number }

/** The cluster lens of the canvas, widened to 4:3 about its centre. */
function frameOf(scene: Scene): Frame {
  const box = lensBox(scene, 'cluster');
  let width = box.right - box.left;
  let height = box.top - box.bottom;
  if (width / height < WIDTH / HEIGHT) width = (height * WIDTH) / HEIGHT;
  else height = (width * HEIGHT) / WIDTH;
  const middle = { x: (box.left + box.right) / 2, z: (box.top + box.bottom) / 2 };
  return { left: middle.x - width / 2, top: middle.z + height / 2, width, height, scale: WIDTH / width };
}

const rgbOf = (css: string) => css.match(/\d+/g)!.slice(0, 3).map(Number);

/** The soil in the colours of its temperature, as a PNG data URL; the air above the ground stays clear. */
function paint(frame: Frame, field: ThumbField, ambient: number, limit: number, ramp: Ramp, dark: boolean): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = COLUMNS;
  canvas.height = ROWS;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const image = context.createImageData(COLUMNS, ROWS);
  for (let row = 0; row < ROWS; row += 1) {
    const z = frame.top - ((row + 0.5) / ROWS) * frame.height;
    for (let column = 0; column < COLUMNS; column += 1) {
      const at = (row * COLUMNS + column) * 4;
      if (z > 0) continue;
      const x = frame.left + ((column + 0.5) / COLUMNS) * frame.width;
      const position = Math.max(0, Math.min(1, rampPosition(temperatureAt(field.ambient, field.sources, x, z), ambient, limit)));
      if (dark) {
        // The ramp at full strength, more opaque the warmer: the far soil keeps the theme's dark soil under it.
        const [red, green, blue] = rgbOf(ramp.css(position));
        image.data.set([red, green, blue, Math.round(Math.min(0.85, position * 1.8) * 255)], at);
      } else {
        const slot = Math.round(position * (RAMP_SIZE - 1)) * 4;
        image.data.set([ramp.fieldBytes[slot], ramp.fieldBytes[slot + 1], ramp.fieldBytes[slot + 2], 255], at);
      }
    }
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

export function SectionThumb({ scene, field, label, crop, className }: {
  scene: Scene;
  field: ThumbField | null;
  /** Fill a box of another shape (give it a size), cutting the drawing's edges instead of shrinking it. */
  crop?: boolean;
  /** What the drawing shows, for assistive technology: 敷设断面：三芯电缆直埋，埋深 1.2 m. */
  label: string;
  className?: string;
}) {
  const dark = useTheme(state => state.theme) === 'dark';
  const frame = useMemo(() => frameOf(scene), [scene]);
  // The ramp comes from the theme's tokens: read again, and the soil painted again, when the theme changes.
  const { ramp, heat } = useMemo(() => {
    const ramp = readRamp();
    return { ramp, heat: field && paint(frame, field, scene.ambient, scene.limit, ramp, dark) };
  }, [frame, field, scene, dark]);
  const x = (metres: number) => (metres - frame.left) * frame.scale;
  const y = (metres: number) => (frame.top - metres) * frame.scale;
  const ground = y(0);
  return <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio={crop ? 'xMidYMid slice' : undefined}
    className={cn('block', crop ? 'h-full w-full' : 'h-auto w-full', className)} role="img" aria-label={label}>
    <rect y={Math.max(0, ground)} width={WIDTH} height={Math.max(0, HEIGHT - Math.max(0, ground))} fill={heat && !dark ? 'none' : 'var(--soil)'} />
    {heat && <image href={heat} width={WIDTH} height={HEIGHT} preserveAspectRatio="none" />}
    {ground > 0 && <line x1={0} x2={WIDTH} y1={ground} y2={ground} stroke="var(--text-secondary)" strokeWidth={1} />}
    {scene.cables.map(cable => <g key={cable.id}>
      <CableGlyph shape={scene.shape} x={x(cable.x)} y={y(cable.z)} scale={frame.scale}
        conductor={cable.state ? ramp.css(rampPosition(cable.state.conductor_c, scene.ambient, scene.limit)) : undefined} />
      {cable.limiting && <circle cx={x(cable.x)} cy={y(cable.z)} r={scene.shape.radius * frame.scale + 3} fill="none" stroke="var(--copper)" strokeWidth={1.5} />}
    </g>)}
  </svg>;
}
