/**
 * 温度色带：Google Turbo 的多项式近似（Mikhailov 2019，Apache-2.0），感知均匀度优于 jet，
 * 工程软件里常见的“蓝—青—黄—红”读法保持不变。输入 t ∈ [0,1]，输出 0–1 的 RGB。
 * 同一份系数也写进 WebGL 片元着色器，保证色标与画面一致。
 */
export const TURBO_GLSL = `
vec3 turbo(float x) {
  x = clamp(x, 0.0, 1.0);
  const vec4 kRedVec4 = vec4(0.13572138, 4.61539260, -42.66032258, 132.13108234);
  const vec4 kGreenVec4 = vec4(0.09140261, 2.19418839, 4.84296658, -14.18503333);
  const vec4 kBlueVec4 = vec4(0.10667330, 12.64194608, -60.58204836, 110.36276771);
  const vec2 kRedVec2 = vec2(-152.94239396, 59.28637943);
  const vec2 kGreenVec2 = vec2(4.27729857, 2.82956604);
  const vec2 kBlueVec2 = vec2(-89.90310912, 27.34824973);
  vec4 v4 = vec4(1.0, x, x * x, x * x * x);
  vec2 v2 = v4.zw * v4.z;
  return vec3(dot(v4, kRedVec4) + dot(v2, kRedVec2), dot(v4, kGreenVec4) + dot(v2, kGreenVec2), dot(v4, kBlueVec4) + dot(v2, kBlueVec2));
}`;

export function turbo(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t));
  const v = [1, x, x * x, x * x * x], v2 = [v[2] * v[2], v[3] * v[2]];
  const dot = (a: number[], b: number[]) => a.reduce((sum, value, index) => sum + value * b[index], 0);
  const r = dot(v, [0.13572138, 4.6153926, -42.66032258, 132.13108234]) + dot(v2, [-152.94239396, 59.28637943]);
  const g = dot(v, [0.09140261, 2.19418839, 4.84296658, -14.18503333]) + dot(v2, [4.27729857, 2.82956604]);
  const b = dot(v, [0.1066733, 12.64194608, -60.58204836, 110.36276771]) + dot(v2, [-89.90310912, 27.34824973]);
  return [r, g, b].map((channel) => Math.min(1, Math.max(0, channel))) as [number, number, number];
}
