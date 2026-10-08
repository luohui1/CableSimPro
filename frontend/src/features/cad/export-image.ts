import type { ViewportController } from './cad-controller';
import type { CadCamera, CadGeometry, CadImage, CadThermal } from './types';

const captures = new WeakMap<HTMLCanvasElement, () => Promise<Blob>>();
export function registerCanvasCapture(canvas: HTMLCanvasElement, capture: () => Promise<Blob>) {
  captures.set(canvas, capture); return () => captures.delete(canvas);
}
const blobOf = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('三维图像编码失败。')), 'image/png'));
export async function exportCadImage(stage: HTMLElement, controller: ViewportController, geometry: CadGeometry, camera: CadCamera, thermal?: CadThermal): Promise<CadImage> {
  const width = Math.round(stage.clientWidth), height = Math.round(stage.clientHeight), ratio = 2, footer = 96;
  if (!width || !height) throw Error('视口尚不可见，无法导出。');
  if (stage.querySelectorAll('.cad-canvas-host canvas').length !== 1) throw Error('视口正在替换，请完成后再导出。');
  if (thermal?.triangles.length && stage.querySelector('[data-cad-field-ready]')?.getAttribute('data-cad-field-ready') !== 'true') throw Error('温度切片尚未完成，请出图后再导出。');
  const output = document.createElement('canvas'); output.width = width * ratio; output.height = (height + footer) * ratio;
  const context = output.getContext('2d'); if (!context) throw Error('图片导出环境不可用。');
  context.scale(ratio, ratio);
  const tokens = getComputedStyle(stage), background = tokens.getPropertyValue('--panel').trim(), foreground = tokens.getPropertyValue('--text').trim();
  context.fillStyle = background; context.fillRect(0, 0, width, height + footer);
  for (const element of stage.querySelectorAll<HTMLCanvasElement>('.cad-canvas-host canvas, .cad-temperature-slice')) {
    const blob = element.closest('.cad-canvas-host') && controller.capture ? await controller.capture() : captures.has(element) ? await captures.get(element)!() : await blobOf(element);
    const bitmap = await createImageBitmap(blob); context.drawImage(bitmap, 0, 0, width, height); bitmap.close();
  }
  // SVG overlays retain readable screen-sized dimensions and carry resolved theme styles into PNG.
  for (const element of stage.querySelectorAll<SVGSVGElement>('svg.cad-overlay')) {
    const clone = element.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); clone.setAttribute('width', String(width)); clone.setAttribute('height', String(height));
    const originals = [element, ...element.querySelectorAll('*')], copies = [clone, ...clone.querySelectorAll('*')];
    originals.forEach((node, i) => {
      const style = getComputedStyle(node);
      for (const key of ['fill', 'stroke', 'stroke-width', 'font-family', 'font-size', 'font-weight', 'font-variant-numeric', 'paint-order', 'text-anchor']) copies[i].setAttribute(key, style.getPropertyValue(key));
    });
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
    try { const image = new Image(); image.src = url; await image.decode(); context.drawImage(image, 0, 0, width, height); } finally { URL.revokeObjectURL(url); }
  }
  const p = controller.project(0, 0, 0), axes = [[1000, 0, 0], [0, 1000, 0], [0, 0, 1000]].map(([x, y, z]) => controller.project(x, y, z));
  const scaleMmPerPixel = 1000 / Math.hypot(...axes.map(a => a.x - p.x));
  if (!Number.isFinite(scaleMmPerPixel) || scaleMmPerPixel <= 0) throw Error('当前视角比例尺不可用；请适应窗口后导出。');
  const target = scaleMmPerPixel * Math.min(120, width / 4), power = 10 ** Math.floor(Math.log10(target)), n = target / power;
  const scaleMm = (n >= 5 ? 5 : n >= 2 ? 2 : 1) * power, length = scaleMm / scaleMmPerPixel;
  context.font = `${tokens.getPropertyValue('--text-note').trim()} ${tokens.getPropertyValue('--font-ui') || 'sans-serif'}`; context.fillStyle = foreground; context.strokeStyle = foreground; context.lineWidth = 1;
  context.fillRect(0, height, width, footer);
  context.fillStyle = background; context.fillRect(0, height + 1, width, footer - 1); context.fillStyle = foreground;
  const y = height + 22; context.beginPath(); context.moveTo(16, y - 4); context.lineTo(16, y + 4); context.moveTo(16, y); context.lineTo(16 + length, y); context.lineTo(16 + length, y + 4); context.stroke();
  context.fillText(`${scaleMm.toLocaleString()} mm`, 16, y + 22);
  const names = { iso: '轴测', front: '正视', end: '截面', top: '俯视', free: '自由视角' };
  context.fillText(`${names[camera.view]} · 方位 ${(camera.heading * 180 / Math.PI).toFixed(1)}° · 仰角 ${(camera.elevation * 180 / Math.PI).toFixed(1)}° · 展示段 ${geometry.length_m} m`, Math.max(160, length + 40), y);
  context.fillText(thermal ? `${thermal.kind === 'difference' ? '有限元 − IEC · 温差 K' : thermal.kind === 'fem' ? '有限元 · °C' : thermal.kind === 'iec' ? 'IEC · °C' : '导体温度 · °C'} · 工况 ${thermal.caseId}${thermal.notice ? ` · ${thermal.notice}` : ''}` : '尚无结果 · 输入几何', Math.max(160, length + 40), y + 22);
  const refs = thermal?.references || (thermal ? [{ runId: thermal.runId, caseId: thermal.caseId }] : []);
  context.fillText(refs.length ? refs.map(r => `运行 ${r.runId}`).join(' / ') : '尺寸来自同一敷设输入；表面量测为显示网格（弦差 ≤ 0.08 mm）', 16, height + 76, width - 32);
  let inputSha256 = geometry.input_sha256;
  if (!inputSha256 && typeof geometry.display_input === 'string') inputSha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(geometry.display_input)))).map(v => v.toString(16).padStart(2, '0')).join('');
  return { blob: await blobOf(output), metadata: { schema: 'cablesim.cad-image/1', mime: 'image/png', width: output.width, height: output.height, camera: { ...camera }, geometryInputSha256: inputSha256,
    displayLengthM: geometry.length_m, scaleMmPerPixel: scaleMmPerPixel / ratio, field: thermal ? { runId: thermal.runId, caseId: thermal.caseId, source: thermal.source, kind: thermal.kind, minimum: thermal.minimum, maximum: thermal.maximum, references: thermal.references } : undefined } };
}
