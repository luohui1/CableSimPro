import type { Cable, Layer } from './types';

export async function api<T>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
  const controller = new AbortController();
  // Provider tasks are bounded by the server; allow multiple tool/model turns.
  const timeoutMs = path.startsWith('/api/design/') ? 300000 : 30000;
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, {method, signal: controller.signal,
      headers: body === undefined ? {} : {'Content-Type': 'application/json'},
      body: body === undefined ? undefined : JSON.stringify(body)});
    if (!response.ok) {
      const payload = await response.json().catch(() => ({detail: `HTTP ${response.status}`}));
      const detail: unknown = payload.detail;
      const text = Array.isArray(detail) ? detail.map((e: {loc?: string[]; msg?: string}) => `${e.loc?.slice(1).join(' / ') ?? ''}: ${e.msg ?? '参数错误'}`).join('；') : String(detail ?? response.statusText);
      throw new Error(text);
    }
    if (response.status === 204) return undefined as T;
    if (response.headers.get('content-type')?.includes('text/html')) return await response.text() as T;
    return await response.json() as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('请求超时，请检查计算引擎连接。');
    if (error instanceof TypeError) throw new Error('无法连接计算引擎。请启动后端后重试。');
    throw error;
  } finally { window.clearTimeout(timer); }
}
export const errorText = (e: unknown) => e instanceof Error ? e.message : '发生未知错误';
export const fmt = (value: number | null | undefined, digits = 1) => value == null || !Number.isFinite(value) ? '—' : value.toLocaleString('zh-CN', {minimumFractionDigits: digits, maximumFractionDigits: digits});
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value);
}
export function download(name: string, data: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([data], {type: mime}));
  const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export const safe = (n: number, fallback: number) => Number.isFinite(n) && n > 0 ? n : fallback;
export function layers(c: Cable): Layer[] {
  // Only the preview has rendering fallbacks. Invalid inputs are never clamped by the API.
  let radius = Math.sqrt(safe(c.area_mm2, 240) / (Math.PI * safe(c.fill_factor, 0.92)));
  const result: Layer[] = [{name: '导体', radius_mm: radius, color: c.conductor === 'copper' ? '#ce9451' : '#b7c6d3'}];
  const thickness = [c.conductor_screen_mm, c.insulation_mm, c.insulation_screen_mm, c.metallic_screen_mm, c.jacket_mm];
  const names = ['导体屏蔽', 'XLPE 绝缘', '绝缘屏蔽', '金属屏蔽（等效层）', '外护套'];
  const colors = ['#434d5c', '#ece6d6', '#5a6572', '#b9cad1', '#293c55'];
  thickness.forEach((t, i) => { radius += safe(t, 0.1); result.push({name: names[i], radius_mm: radius, color: colors[i]}); });
  return result;
}
