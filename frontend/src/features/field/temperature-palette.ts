/** Token-derived sequential temperature colours; no physical values are changed. */
export type RGB = [number, number, number];
export function temperaturePalette(element: Element): RGB[] {
  const style = getComputedStyle(element);
  return Array.from({ length: 6 }, (_, index) => {
    const hex = style.getPropertyValue(`--temperature-${index + 1}`).trim();
    if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error('温度色阶配置不完整');
    return [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16) / 255) as RGB;
  });
}
export function temperatureColor(palette: RGB[], value: number): string {
  const position = Math.max(0, Math.min(1, value)) * (palette.length - 1), index = Math.min(palette.length - 2, Math.floor(position));
  return '#' + palette[index].map((channel, c) => Math.round(255 * (channel + (palette[index + 1][c] - channel) * (position - index))).toString(16).padStart(2, '0')).join('');
}
export const TEMPERATURE_GLSL = `
uniform vec3 u_palette[6];
vec3 temperatureColor(float t) {
  float p = clamp(t, 0., 1.) * 5.; int i = min(4, int(floor(p)));
  return mix(u_palette[i], u_palette[i + 1], p - float(i));
}`;
