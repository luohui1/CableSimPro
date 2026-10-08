import { turbo } from '../field/colormap';

// Semantic endpoints supplied by the viewport's design tokens, shared by CPU legend and GLSL.
export function fieldColor(t: number, difference = false, negative: readonly number[] = [0, 0, 0], positive: readonly number[] = [1, 1, 1], neutral: readonly number[] = [.5, .5, .5]): number[] {
  if (!difference) return turbo(t);
  const v = Math.min(1, Math.max(0, t)), end = v < .5 ? negative : positive, weight = Math.abs(v * 2 - 1);
  return neutral.map((value, i) => value + (end[i] - value) * weight);
}
