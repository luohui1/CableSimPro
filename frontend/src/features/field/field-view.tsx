import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { TURBO_GLSL, turbo } from "./colormap";
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
};

type View = { cx: number; cz: number; scale: number };
const MARGIN = 48, COLORBAR = 72;
const hex = (t: number) => "#" + turbo(t).map((channel) => Math.round(channel * 255).toString(16).padStart(2, "0")).join("");
const fixed = (value: number) => (Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1));

function shader(gl: WebGL2RenderingContext, type: number, source: string) {
  const handle = gl.createShader(type)!;
  gl.shaderSource(handle, source);
  gl.compileShader(handle);
  if (!gl.getShaderParameter(handle, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(handle) || "着色器编译失败");
  return handle;
}

/**
 * 温度场视图：WebGL2 逐像素按 Turbo 色带着色（可分级），SVG 叠加等温线、电缆轮廓、热点与取点读数。
 * 数值全部来自插件工件；这里只做显示（插值、取色、等值线），不计算物理量。
 */
export function FieldView({ points, triangles, values, limit, circles = [], maskObjects = true, groundZ, hotspot, bands = 14, label }: FieldViewProps) {
  const host = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<View | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number; value?: number; world: Point } | null>(null);
  const drag = useRef<{ x: number; y: number; view: View } | null>(null);
  const gl = useRef<{ context: WebGL2RenderingContext; program: WebGLProgram; count: number } | null>(null);

  const range = useMemo(() => {
    let minimum = Infinity, maximum = -Infinity;
    for (const value of values) { minimum = Math.min(minimum, value); maximum = Math.max(maximum, value); }
    if (limit) maximum = Math.max(maximum, limit.value);
    return { minimum, maximum: maximum > minimum ? maximum : minimum + 1 };
  }, [values, limit]);
  const bounds = useMemo(() => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of points) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    return { x0, x1, z0, z1 };
  }, [points]);
  const levels = useMemo(() => contourLevels(range.minimum, range.maximum, 8), [range]);
  const contours = useMemo(() => levels.map((level) => ({ level, segments: contourSegments(points, triangles, values, level) })), [levels, points, triangles, values]);
  const locator = useMemo(() => buildLocator(points, triangles), [points, triangles]);

  // 视图：默认全览（四周留边，右侧给色标）；滚轮缩放、拖动平移、双击复位。
  const plotWidth = Math.max(1, size.width - COLORBAR);
  const fit: View = {
    cx: (bounds.x0 + bounds.x1) / 2, cz: (bounds.z0 + bounds.z1) / 2,
    scale: Math.min((plotWidth - MARGIN * 2) / Math.max(1e-9, bounds.x1 - bounds.x0), (size.height - MARGIN * 2) / Math.max(1e-9, bounds.z1 - bounds.z0)),
  };
  const camera = view || fit;
  const toScreen = (x: number, z: number): [number, number] => [plotWidth / 2 + (x - camera.cx) * camera.scale, size.height / 2 - (z - camera.cz) * camera.scale];
  const toWorld = (sx: number, sy: number): Point => [camera.cx + (sx - plotWidth / 2) / camera.scale, camera.cz - (sy - size.height / 2) / camera.scale];

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: Math.round(entry.contentRect.width), height: Math.round(entry.contentRect.height) }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // 上传网格：位置、节点值、索引（WebGL2 支持 32 位索引）。
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("webgl2", { antialias: true });
    if (!element || !context) return;
    const program = context.createProgram()!;
    context.attachShader(program, shader(context, context.VERTEX_SHADER, `#version 300 es
in vec2 a_pos; in float a_value; uniform vec2 u_center; uniform float u_scale; uniform vec2 u_size; out float v_value;
void main() { vec2 p = (a_pos - u_center) * u_scale; gl_Position = vec4(p.x / (u_size.x * 0.5), p.y / (u_size.y * 0.5), 0.0, 1.0); v_value = a_value; }`));
    context.attachShader(program, shader(context, context.FRAGMENT_SHADER, `#version 300 es
precision highp float; in float v_value; uniform float u_min; uniform float u_max; uniform float u_bands; out vec4 o;
${TURBO_GLSL}
void main() { float t = clamp((v_value - u_min) / (u_max - u_min), 0.0, 1.0); if (u_bands > 0.5) t = (floor(min(t, 0.9999) * u_bands) + 0.5) / u_bands; o = vec4(turbo(t), 1.0); }`));
    context.linkProgram(program);
    const upload = (name: string, data: Float32Array, components: number) => {
      const buffer = context.createBuffer();
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
    context.bindBuffer(context.ELEMENT_ARRAY_BUFFER, indices);
    context.bufferData(context.ELEMENT_ARRAY_BUFFER, new Uint32Array(triangles.flat()), context.STATIC_DRAW);
    gl.current = { context, program, count: triangles.length * 3 };
    return () => { context.deleteProgram(program); gl.current = null; };
  }, [points, triangles, values]);

  // 每次视图或尺寸变化重画（只改 uniform，不重新上传网格）。
  useEffect(() => {
    const state = gl.current, element = canvas.current;
    if (!state || !element || !size.width || !size.height) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    element.width = Math.round(plotWidth * ratio); element.height = Math.round(size.height * ratio);
    const { context, program, count } = state;
    context.viewport(0, 0, element.width, element.height);
    context.clearColor(0, 0, 0, 0); context.clear(context.COLOR_BUFFER_BIT);
    context.useProgram(program);
    context.uniform2f(context.getUniformLocation(program, "u_center"), camera.cx, camera.cz);
    context.uniform1f(context.getUniformLocation(program, "u_scale"), camera.scale);
    context.uniform2f(context.getUniformLocation(program, "u_size"), plotWidth, size.height);
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
        const wx = base.cx + (sx - plotWidth / 2) / base.scale, wz = base.cz - (sy - size.height / 2) / base.scale;
        const scale = base.scale * factor;
        return { scale, cx: wx - (sx - plotWidth / 2) / scale, cz: wz + (sy - size.height / 2) / scale };
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
    if (sx > plotWidth) { setPointer(null); return; }
    const world = toWorld(sx, sy);
    setPointer({ x: sx, y: sy, world, value: probe(locator, triangles, values, world[0], world[1]) });
  };

  const scaleBar = { x: plotWidth + 20, top: MARGIN, height: Math.max(40, size.height - MARGIN * 2) };
  const yOf = (value: number) => scaleBar.top + scaleBar.height * (1 - (value - range.minimum) / (range.maximum - range.minimum));
  const bandCount = bands || 48;
  const hot = hotspot && toScreen(hotspot.point[0], hotspot.point[1]);
  const screenCircles = circles.map((circle) => ({ center: toScreen(circle.x, circle.z), r: Math.max(2, circle.r * camera.scale) }));
  const spacing = screenCircles.reduce((closest, a, i) => Math.min(closest, ...screenCircles.slice(i + 1).map((b) => Math.hypot(a.center[0] - b.center[0], a.center[1] - b.center[1]))), Infinity);
  const objectsRight = screenCircles.reduce((right, item) => Math.max(right, item.center[0] + item.r), -Infinity);

  return <div ref={host} className="field-view" role="img" aria-label={label}
    onPointerDown={(event) => { const [x, y] = local(event); drag.current = { x, y, view: camera }; event.currentTarget.setPointerCapture(event.pointerId); }}
    onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerLeave={() => { drag.current = null; setPointer(null); }}
    onDoubleClick={() => setView(null)}>
    <canvas ref={canvas} className="field-canvas" />
    {size.width > 0 && <svg className="field-overlay" width={size.width} height={size.height}>
      {contours.map(({ level, segments }) => {
        if (!segments.length) return null;
        const d = segments.map(([a, b]) => { const [x1, y1] = toScreen(a[0], a[1]), [x2, y2] = toScreen(b[0], b[1]); return `M${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}`; }).join("");
        const [mx, my] = toScreen(...segments[Math.floor(segments.length / 3)][0]);
        return <g key={level} className="field-contour"><path d={d} /><text x={mx} y={my}>{fixed(level)}</text></g>;
      })}
      {groundZ !== undefined && (() => { const [, y] = toScreen(bounds.x0, groundZ); return <line className="field-ground" x1={0} x2={plotWidth} y1={y} y2={y} />; })()}
      {[...circles].sort((a, b) => a.x - b.x).map((circle, index) => {
        // 电缆本体实心显示（内部不属于土壤场）；相邻标签上下交替；挤在一起时不画标签，放大后再显示
        const [x, y] = toScreen(circle.x, circle.z), r = Math.max(2, circle.r * camera.scale), above = index % 2 === 0;
        return <g key={index} className={maskObjects ? "field-object" : "field-object field-object-outline"}><circle cx={x} cy={y} r={r} />{circle.label && spacing >= 36 && <text x={x} y={above ? y - r - 6 : y + r + 14} textAnchor="middle">{circle.label}</text>}</g>;
      })}
      {(() => {
        // 比例尺：取 1/2/5×10ⁿ m，长度约为画面宽度的 1/6
        const target = plotWidth / 6 / camera.scale, power = 10 ** Math.floor(Math.log10(target));
        const metres = [1, 2, 5, 10].map((factor) => factor * power).filter((value) => value <= target).pop() || power;
        const length = metres * camera.scale, y = size.height - 18;
        return <g className="field-scale"><path d={`M16 ${y - 5}V${y}H${16 + length}V${y - 5}`} /><text x={16 + length + 6} y={y + 4}>{metres >= 1 ? `${metres} m` : `${Math.round(metres * 1000)} mm`}</text></g>;
      })()}
      {hot && hotspot && <g className="field-hotspot"><circle cx={hot[0]} cy={hot[1]} r={5} />
        {/* 热点在电缆群里时，标签引到电缆群右侧，避免压住电缆 */}
        {objectsRight > hot[0] ? <><line x1={hot[0]} y1={hot[1]} x2={objectsRight + 16} y2={hot[1] - 18} /><text x={objectsRight + 20} y={hot[1] - 14}>{hotspot.label} {fixed(hotspot.value)} °C</text></>
          : <text x={hot[0] + 10} y={hot[1] - 8}>{hotspot.label} {fixed(hotspot.value)} °C</text>}</g>}
      <g className="field-colorbar" aria-label="温度色标">
        {Array.from({ length: bandCount }, (_, index) => <rect key={index} x={scaleBar.x} width={14} y={scaleBar.top + scaleBar.height * (1 - (index + 1) / bandCount)} height={scaleBar.height / bandCount + 0.5} fill={hex((index + 0.5) / bandCount)} />)}
        <text className="field-colorbar-unit" x={scaleBar.x} y={scaleBar.top - 12}>°C</text>
        {[range.minimum, ...levels, range.maximum].map((value, index) => <text key={index} x={scaleBar.x + 20} y={yOf(value) + 4}>{fixed(value)}</text>)}
        {limit && <g className="field-limit"><line x1={scaleBar.x - 4} x2={scaleBar.x + 18} y1={yOf(limit.value)} y2={yOf(limit.value)} /><text x={scaleBar.x - 8} y={yOf(limit.value) + 4} textAnchor="end">{limit.label}</text></g>}
      </g>
      {pointer && !drag.current && <g className="field-probe">
        <line x1={pointer.x} x2={pointer.x} y1={pointer.y - 8} y2={pointer.y + 8} /><line x1={pointer.x - 8} x2={pointer.x + 8} y1={pointer.y} y2={pointer.y} />
        <rect x={pointer.x + 12} y={pointer.y + 10} width={168} height={44} rx={8} />
        <text x={pointer.x + 22} y={pointer.y + 29}>{pointer.value === undefined ? "网格外" : `${fixed(pointer.value)} °C`}</text>
        <text className="field-probe-coords" x={pointer.x + 22} y={pointer.y + 46}>x {pointer.world[0].toFixed(3)} m · z {pointer.world[1].toFixed(3)} m</text>
      </g>}
    </svg>}
  </div>;
}
