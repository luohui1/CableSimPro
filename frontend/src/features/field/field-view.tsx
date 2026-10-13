import { useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { TEMPERATURE_GLSL, temperaturePalette, temperatureColor, type RGB } from './temperature-palette';
import { placeLabel, type Box } from './label-layout';
import { buildLocator, contourLevels, contourSegments, probe, type Point, type Triangle } from "./contours";
import "./field.css";

export type FieldCircle = { x: number; z: number; r: number; label?: string };
export type FieldViewProps = {
  /** 插件输出的三角网格（m，截面 x–z，z 向上）与节点温度（°C，由调用方从 K 换算）。 */
  points: Point[];
  triangles: Triangle[];
  values: number[];
  /** 允许温度等关键限值，画在色标上。 */
  limit?: { value: number; label: string };
  /** 叠加在场上的电缆、排管轮廓与地表线（只描边，不改变场值）。 */
  circles?: FieldCircle[];
  /** IEC 土壤场遮盖电缆内部；解析电缆内部的有限元场可显式关闭。 */
  maskObjects?: boolean;
  groundZ?: number;
  hotspot?: { point: Point; value: number; label: string };
  /** 色带分级数；0 为连续色带。 */
  bands?: number;
  label: string;
  /** Optional exact sampling of the saved full mesh (returns degrees C). */
  samplePoint?: (point: Point) => Promise<number | undefined>;
};

type View = { cx: number; cz: number; scale: number };
const MARGIN = 48, COLORBAR = 88;
const fixed = (value: number) => (Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1));

function shader(gl: WebGL2RenderingContext, type: number, source: string) {
  const handle = gl.createShader(type)!;
  gl.shaderSource(handle, source);
  gl.compileShader(handle);
  if (!gl.getShaderParameter(handle, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(handle) || "着色器编译失败");
  return handle;
}

/**
 * 温度场视图：WebGL2 按令牌温度色阶着色，SVG 叠加等温线、轮廓、避让标注与取点读数。
 * 数值全部来自插件工件；这里只做显示（插值、取色、等值线），不计算物理量。
 */
export function FieldView({ points, triangles, values, limit, circles = [], maskObjects = true, groundZ, hotspot, bands = 14, label, samplePoint }: FieldViewProps) {
  const host = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [visible, setVisible] = useState(false);
  const [view, setView] = useState<View | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number; value?: number; world: Point; pending?: boolean; failed?: boolean } | null>(null);
  const drag = useRef<{ x: number; y: number; view: View } | null>(null);
  const gl = useRef<{ context: WebGL2RenderingContext; program: WebGLProgram; count: number } | null>(null);
  const sampling = useRef<Promise<unknown>>(Promise.resolve());
  const clipId = useId().replace(/:/g, '');
  const textContext = useMemo(() => document.createElement('canvas').getContext('2d'), []);
  const [, refreshFont] = useState(false);
  useEffect(() => {
    let alive = true;
    void document.fonts.ready.then(() => { if (alive) refreshFont(true); });
    return () => { alive = false; };
  }, []);
  const [palette, setPalette] = useState<RGB[]>([]);
  useEffect(() => {
    const update = () => { if (host.current) { const next = temperaturePalette(host.current); setPalette(old => JSON.stringify(old) === JSON.stringify(next) ? old : next); } };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'], subtree: true });
    return () => observer.disconnect();
  }, []);

  const range = useMemo(() => {
    let minimum = Infinity, maximum = -Infinity;
    for (const value of values) { minimum = Math.min(minimum, value); maximum = Math.max(maximum, value); }
    if (limit) maximum = Math.max(maximum, limit.value);
    return { minimum, maximum: maximum > minimum ? maximum : minimum + 1 };
  }, [values, limit?.value]);
  const bounds = useMemo(() => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of points) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    return { x0, x1, z0, z1 };
  }, [points]);
  const levels = useMemo(() => contourLevels(range.minimum, range.maximum, 8), [range]);
  const contours = useMemo(() => visible ? levels.map((level) => ({ level, segments: contourSegments(points, triangles, values, level) })) : [], [visible, levels, points, triangles, values]);
  const locator = useMemo(() => buildLocator(points, triangles), [points, triangles]);
  useEffect(() => {
    if (!samplePoint || !pointer) return;
    let alive = true; const world = pointer.world;
    const timer = window.setTimeout(() => {
      // A moving pointer must not queue concurrent full-field decodes on the host.
      sampling.current = sampling.current.catch(() => {}).then(async () => {
        if (!alive) return;
        try {
          const value = await samplePoint(world);
          if (alive) setPointer(current => current && current.world === world ? { ...current, value, pending: false } : current);
        } catch {
          if (alive) setPointer(current => current && current.world === world ? { ...current, pending: false, failed: true } : current);
        }
      });
    }, 180);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [pointer?.world, samplePoint]);

  // 视图：默认全览（四周留边，右侧给色标）；滚轮缩放、拖动平移、双击复位。
  const horizontal = size.width < 620 || size.height < 360;
  const plotWidth = Math.max(1, size.width - (horizontal ? 0 : COLORBAR));
  const plotHeight = Math.max(1, size.height - (horizontal ? COLORBAR : 0));
  // A short FEM workbench canvas must not spend almost all its height on the
  // 48 px margins. Keep IEC framing and physical aspect ratio unchanged.
  const fitMargin = maskObjects ? MARGIN : Math.min(MARGIN, Math.max(12, Math.min(plotWidth, plotHeight) * .12));
  const fit: View = {
    cx: (bounds.x0 + bounds.x1) / 2, cz: (bounds.z0 + bounds.z1) / 2,
    scale: Math.max(1e-9, Math.min(Math.max(1, plotWidth - fitMargin * 2) / Math.max(1e-9, bounds.x1 - bounds.x0), Math.max(1, plotHeight - fitMargin * 2) / Math.max(1e-9, bounds.z1 - bounds.z0))),
  };
  const camera = view || fit;
  const toScreen = (x: number, z: number): [number, number] => [plotWidth / 2 + (x - camera.cx) * camera.scale, plotHeight / 2 - (z - camera.cz) * camera.scale];
  const toWorld = (sx: number, sy: number): Point => [camera.cx + (sx - plotWidth / 2) / camera.scale, camera.cz - (sy - plotHeight / 2) / camera.scale];

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const visibility = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    visibility.observe(element);
    // 尺寸没变就不更新状态：否则旁边属性栏内容变化引起的回流会让场图反复重绘，整页卡死
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width), height = Math.round(entry.contentRect.height);
      setSize(current => current.width === width && current.height === height ? current : { width, height });
    });
    observer.observe(element);
    return () => { observer.disconnect(); visibility.disconnect(); };
  }, []);

  // 上传网格：位置、节点值、索引（WebGL2 支持 32 位索引）。
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("webgl2", { antialias: true });
    if (!element || !context) return;
    const program = context.createProgram()!, buffers: WebGLBuffer[] = [];
    context.attachShader(program, shader(context, context.VERTEX_SHADER, `#version 300 es
in vec2 a_pos; in float a_value; uniform vec2 u_center; uniform float u_scale; uniform vec2 u_size; out float v_value;
void main() { vec2 p = (a_pos - u_center) * u_scale; gl_Position = vec4(p.x / (u_size.x * 0.5), p.y / (u_size.y * 0.5), 0.0, 1.0); v_value = a_value; }`));
    context.attachShader(program, shader(context, context.FRAGMENT_SHADER, `#version 300 es
precision highp float; in float v_value; uniform float u_min; uniform float u_max; uniform float u_bands; out vec4 o;
${TEMPERATURE_GLSL}
void main() { float t = clamp((v_value - u_min) / (u_max - u_min), 0.0, 1.0); if (u_bands > 0.5) t = (floor(min(t, 0.9999) * u_bands) + 0.5) / u_bands; o = vec4(temperatureColor(t), 1.0); }`));
    context.linkProgram(program);
    const upload = (name: string, data: Float32Array, components: number) => {
      const buffer = context.createBuffer();
      if (buffer) buffers.push(buffer);
      context.bindBuffer(context.ARRAY_BUFFER, buffer);
      context.bufferData(context.ARRAY_BUFFER, data, context.STATIC_DRAW);
      const location = context.getAttribLocation(program, name);
      context.enableVertexAttribArray(location);
      context.vertexAttribPointer(location, components, context.FLOAT, false, 0, 0);
    };
    const vao = context.createVertexArray();
    context.bindVertexArray(vao);
    upload("a_pos", new Float32Array(points.flatMap(([x, z]) => [x, z])), 2);
    upload("a_value", new Float32Array(values), 1);
    const indices = context.createBuffer();
    if (indices) buffers.push(indices);
    context.bindBuffer(context.ELEMENT_ARRAY_BUFFER, indices);
    context.bufferData(context.ELEMENT_ARRAY_BUFFER, new Uint32Array(triangles.flat()), context.STATIC_DRAW);
    gl.current = { context, program, count: triangles.length * 3 };
    return () => { buffers.forEach(buffer => context.deleteBuffer(buffer)); context.deleteVertexArray(vao);
      context.getAttachedShaders(program)?.forEach(shader => context.deleteShader(shader)); context.deleteProgram(program); gl.current = null; };
  }, [visible, points, triangles, values]);

  // 每次视图或尺寸变化重画（只改 uniform，不重新上传网格）。
  useEffect(() => {
    const state = gl.current, element = canvas.current;
    if (!state || !element || !size.width || !size.height || !palette.length) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    element.width = Math.round(plotWidth * ratio); element.height = Math.round(plotHeight * ratio);
    const { context, program, count } = state;
    context.viewport(0, 0, element.width, element.height);
    context.clearColor(0, 0, 0, 0); context.clear(context.COLOR_BUFFER_BIT);
    context.useProgram(program);
    context.uniform2f(context.getUniformLocation(program, "u_center"), camera.cx, camera.cz);
    context.uniform1f(context.getUniformLocation(program, "u_scale"), camera.scale);
    context.uniform2f(context.getUniformLocation(program, "u_size"), plotWidth, plotHeight);
    context.uniform3fv(context.getUniformLocation(program, 'u_palette[0]'), palette.flat());
    context.uniform1f(context.getUniformLocation(program, "u_min"), range.minimum);
    context.uniform1f(context.getUniformLocation(program, "u_max"), range.maximum);
    context.uniform1f(context.getUniformLocation(program, "u_bands"), bands);
    context.drawElements(context.TRIANGLES, count, context.UNSIGNED_INT, 0);
  });

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect(), sx = event.clientX - rect.left, sy = event.clientY - rect.top;
      setView((current) => {
        const base = current || fit, factor = event.deltaY > 0 ? 1 / 1.15 : 1.15;
        if (sx > plotWidth || sy > plotHeight) return current;
        const wx = base.cx + (sx - plotWidth / 2) / base.scale, wz = base.cz - (sy - plotHeight / 2) / base.scale;
        const scale = base.scale * factor;
        return { scale, cx: wx - (sx - plotWidth / 2) / scale, cz: wz + (sy - plotHeight / 2) / scale };
      });
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  });

  const local = (event: ReactPointerEvent) => { const rect = host.current!.getBoundingClientRect(); return [event.clientX - rect.left, event.clientY - rect.top] as const; };
  const move = (event: ReactPointerEvent) => {
    const [sx, sy] = local(event);
    if (drag.current) {
      const { x, y, view: start } = drag.current;
      setView({ ...start, cx: start.cx - (sx - x) / start.scale, cz: start.cz + (sy - y) / start.scale });
      return;
    }
    if (sx > plotWidth || sy > plotHeight) { setPointer(null); return; }
    const world = toWorld(sx, sy);
    setPointer({ x: sx, y: sy, world, pending: !!samplePoint, value: samplePoint ? undefined : probe(locator, triangles, values, world[0], world[1]) });
  };

  const scaleBar = horizontal ? { x: 40, top: plotHeight + 32, length: Math.max(1, plotWidth - 80) }
    : { x: plotWidth + 16, top: MARGIN, length: Math.max(1, plotHeight - MARGIN * 2) };
  const fraction = (value: number) => (value - range.minimum) / (range.maximum - range.minimum);
  const yOf = (value: number) => scaleBar.top + scaleBar.length * (1 - fraction(value));
  const xOf = (value: number) => scaleBar.x + scaleBar.length * fraction(value);
  const bandCount = bands || 48;
  if (textContext && host.current) textContext.font = `600 13px ${getComputedStyle(host.current).fontFamily}`;
  const hot = hotspot && toScreen(hotspot.point[0], hotspot.point[1]);
  const screenCircles = circles.map(circle => ({ ...circle, center: toScreen(circle.x, circle.z), r: Math.max(2, circle.r * camera.scale) }));
  const measure = (value: string) => {
    return Math.ceil(textContext?.measureText(value).width ?? value.length * 13) + 12;
  };
  const target = plotWidth / 6 / camera.scale, power = 10 ** Math.floor(Math.log10(target));
  const metres = [1, 2, 5, 10].map(factor => factor * power).filter(value => value <= target).pop() || power;
  const scaleText = metres >= 1 ? `${metres} m` : `${Math.round(metres * 1000)} mm`, scaleLength = metres * camera.scale;
  const occupied: Box[] = [{ x: 8, y: plotHeight - 38, w: scaleLength + measure(scaleText) + 24, h: 34 }];
  if (groundZ !== undefined) {
    const [, y] = toScreen(0, groundZ);
    // The ground line is part of the model, not free space for annotation text.
    if (y >= 0 && y <= plotHeight) occupied.push({ x: 0, y: y - 5, w: plotWidth, h: 10 });
  }
  const probeBox = pointer && !drag.current ? { x: Math.max(6, Math.min(pointer.x + 12, plotWidth - 272)), y: Math.max(6, Math.min(pointer.y + 10, plotHeight - 60)), w: Math.min(260, plotWidth - 12), h: 48 } : undefined;
  if (probeBox) occupied.push(probeBox);
  // Also keep text clear of object outlines. Hotspot has priority, then objects,
  // then contour labels; an omitted contour label still retains its isoline.
  occupied.push(...screenCircles.map(({center: [x,y],r}) => ({x:x-r-3,y:y-r-3,w:r*2+6,h:r*2+6})));
  const hotText = hotspot ? `${hotspot.label} ${fixed(hotspot.value)} °C` : '';
  const hotWidth = measure(hotText);
  const hotBox = hot && placeLabel([
    { x: hot[0] + 16, y: hot[1] - 32, w: hotWidth, h: 24 },
    { x: hot[0] - hotWidth - 16, y: hot[1] - 32, w: hotWidth, h: 24 },
    { x: hot[0] - hotWidth / 2, y: hot[1] + 24, w: hotWidth, h: 24 },
    { x: 8, y: 8, w: hotWidth, h: 24 },
  ], occupied, plotWidth, plotHeight);
  const objectLabels = screenCircles.map((circle,index) => {
    if (!circle.label) return undefined;
    const [x,y] = circle.center, w = measure(circle.label);
    return placeLabel([{x:x-w/2,y:y-circle.r-32,w,h:24},{x:x-w/2,y:y+circle.r+8,w,h:24},
      {x:x+circle.r+8,y:y-12,w,h:24},{x:x-circle.r-w-8,y:y-12,w,h:24},
      {x:8,y:8+index*32,w,h:24},{x:plotWidth-w-8,y:8+index*32,w,h:24}], occupied, plotWidth, plotHeight);
  });
  const contourLabels = contours.map(({ segments, level }) => {
    const w = measure(fixed(level));
    for (let i = 0; i < 12 && segments.length; i++) {
      const [x, y] = toScreen(...segments[Math.floor(segments.length * i / 12)][0]);
      const box = placeLabel([{x,y:y-12,w,h:24}], occupied, plotWidth, plotHeight);
      if (box) return box;
    }
    return undefined;
  });
  const ticks: number[] = [];
  // End points and the engineering limit take priority; thin out intervening
  // ticks in screen coordinates so short canvases never stack their numbers.
  for (const value of [...(limit ? [limit.value] : []), range.minimum, range.maximum, ...levels]) {
    if (!ticks.some(other => Math.abs((fraction(value) - fraction(other)) * scaleBar.length) < (horizontal ? 36 : 24))) ticks.push(value);
  }
  const annotation = (box: Box | undefined, value: string, key: string) => box && <g key={key} className="field-annotation" data-field-label={key}>
    <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={4} />
    <text x={box.x + 6} y={box.y + 17}>{value}</text>
  </g>;

  return <div ref={host} className="field-view" role="img" aria-label={label}
    data-colorbar-position={horizontal ? 'bottom' : 'right'}
    onPointerDown={(event) => { const [x, y] = local(event); if (x > plotWidth || y > plotHeight) return; drag.current = { x, y, view: camera }; event.currentTarget.setPointerCapture(event.pointerId); }}
    onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerLeave={() => { drag.current = null; setPointer(null); }}
    onDoubleClick={() => setView(null)}>
    {visible && <canvas ref={canvas} className="field-canvas" />}
    {visible && size.width > 0 && <svg className="field-overlay" width={size.width} height={size.height}>
      <defs><clipPath id={clipId}><rect width={plotWidth} height={plotHeight} /></clipPath></defs>
      <g clipPath={`url(#${clipId})`}>
      {contours.map(({ level, segments }) => {
        if (!segments.length) return null;
        const d = segments.map(([a, b]) => { const [x1, y1] = toScreen(a[0], a[1]), [x2, y2] = toScreen(b[0], b[1]); return `M${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}`; }).join("");
        return <g key={level} className="field-contour"><path d={d} /></g>;
      })}
      {groundZ !== undefined && (() => { const [, y] = toScreen(bounds.x0, groundZ); return <line className="field-ground" x1={0} x2={plotWidth} y1={y} y2={y} />; })()}
      {screenCircles.map((circle, index) => {
        const [x,y] = circle.center;
        return <g key={index} className={maskObjects ? "field-object" : "field-object field-object-outline"}><title>{circle.label}</title><circle cx={x} cy={y} r={circle.r} /></g>;
      })}
      {(() => {
        // 比例尺：取 1/2/5×10ⁿ m，长度约为画面宽度的 1/6
        const y = plotHeight - 18;
        return <g className="field-scale"><path d={`M16 ${y - 5}V${y}H${16 + scaleLength}V${y - 5}`} /><text x={16 + scaleLength + 6} y={y + 4}>{scaleText}</text></g>;
      })()}
      {hot && hotspot && <g className="field-hotspot"><circle cx={hot[0]} cy={hot[1]} r={5} />
        <title>{hotText}</title>{hotBox && <line x1={hot[0]} y1={hot[1]} x2={hotBox.x + hotBox.w / 2} y2={hotBox.y + 12} />}
        </g>}
      {contours.map(({level},index) => annotation(contourLabels[index], fixed(level), `contour-${index}`))}
      {screenCircles.map((circle,index) => annotation(objectLabels[index], circle.label || '', `object-${index}`))}
      {annotation(hotBox || undefined, hotText, 'hotspot')}
      {pointer && probeBox && !drag.current && <g className="field-probe" data-field-label="probe">
        <line x1={pointer.x} x2={pointer.x} y1={pointer.y - 8} y2={pointer.y + 8} /><line x1={pointer.x - 8} x2={pointer.x + 8} y1={pointer.y} y2={pointer.y} />
        <rect x={probeBox.x} y={probeBox.y} width={probeBox.w} height={probeBox.h} rx={8} />
        <text x={probeBox.x + 10} y={probeBox.y + 19}>{pointer.pending ? "读取全网格…" : pointer.failed ? "全网格取样失败" : pointer.value === undefined ? "网格外" : `${fixed(pointer.value)} °C`}</text>
        <text className="field-probe-coords" x={probeBox.x + 10} y={probeBox.y + 38}>x {pointer.world[0].toFixed(3)} m · z {pointer.world[1].toFixed(3)} m</text>
      </g>}
      </g>
      {palette.length > 0 && <g className="field-colorbar" aria-label="温度色标">
        {Array.from({ length: bandCount }, (_, index) => <rect key={index}
          x={horizontal ? scaleBar.x + scaleBar.length * index / bandCount : scaleBar.x}
          y={horizontal ? scaleBar.top : scaleBar.top + scaleBar.length * (1 - (index + 1) / bandCount)}
          width={horizontal ? scaleBar.length / bandCount + .5 : 14} height={horizontal ? 14 : scaleBar.length / bandCount + .5}
          fill={temperatureColor(palette, (index + .5) / bandCount)} />)}
        <text className="field-colorbar-unit" x={scaleBar.x} y={scaleBar.top - 10}>°C</text>
        {ticks.map(value => <text key={value} x={horizontal ? xOf(value) : scaleBar.x + 20} y={horizontal ? scaleBar.top + 34 : yOf(value) + 4} textAnchor={horizontal ? 'middle' : 'start'}>{fixed(value)}</text>)}
        {limit && <g className="field-limit"><title>{limit.label} {fixed(limit.value)} °C</title><line
          x1={horizontal ? xOf(limit.value) : scaleBar.x - 4} x2={horizontal ? xOf(limit.value) : scaleBar.x + 18}
          y1={horizontal ? scaleBar.top - 4 : yOf(limit.value)} y2={horizontal ? scaleBar.top + 18 : yOf(limit.value)} /></g>}
      </g>}
    </svg>}
  </div>;
}
