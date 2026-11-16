// The soil tint on a dark ground. The temperature ramp is made for white paper; on the dark ground the soil would be the
// brightest thing on the screen, so it is blended toward the ground at a quarter of its strength (the temperature scale
// beside the drawing is shown at the same strength, so a colour on the drawing can still be read off it).
import { RAMP_SIZE, type Ramp } from '@/lib/ramp';

export const DARK_SOIL = 0.24;

/** The ground colour of the theme as bytes; the dark theme's own value when the token cannot be read. */
function groundBytes(): [number, number, number] {
  const hex = getComputedStyle(document.documentElement).getPropertyValue('--ground').trim().replace('#', '');
  return /^[0-9a-f]{6}$/i.test(hex) ? [0, 2, 4].map(at => Number.parseInt(hex.slice(at, at + 2), 16)) as [number, number, number] : [24, 24, 24];
}

export function soilRamp(ramp: Ramp, dark: boolean): Ramp {
  if (!dark) return ramp;
  const ground = groundBytes();
  const fieldBytes = new Uint8Array(RAMP_SIZE * 4);
  for (let index = 0; index < RAMP_SIZE; index += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      fieldBytes[index * 4 + channel] = Math.round(ground[channel] * (1 - DARK_SOIL) + ramp.fieldBytes[index * 4 + channel] * DARK_SOIL);
    }
    fieldBytes[index * 4 + 3] = 255;
  }
  const slot = (position: number) => Math.round(Math.max(0, Math.min(1, position)) * (RAMP_SIZE - 1)) * 4;
  return { ...ramp, fieldBytes, field: position => `rgb(${fieldBytes[slot(position)]} ${fieldBytes[slot(position) + 1]} ${fieldBytes[slot(position) + 2]})` };
}
