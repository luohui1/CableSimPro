import { useEffect, useId, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Cable, Result, Scenario } from './types';
import { fmt, layers, safe } from './utils';

export function CableScene({cable, exploded, resetKey}: {cable: Cable; exploded: boolean; resetKey: number}) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('loading');
  const geometry = useMemo(() => layers(cable), [cable]);
  useEffect(() => {
    if (!host.current) return;
    const container = host.current;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({antialias: true, alpha: true}); }
    catch { setStatus('unavailable'); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setClearColor(0xfafaf7, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    renderer.domElement.setAttribute('aria-label', '三维电缆模型');
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xfafaf7, 24, 45);
    const camera = new THREE.OrthographicCamera(-7, 7, 5.4, -5.4, 0.1, 100);
    camera.position.set(11, 6.5, 14);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.07;
    controls.target.set(0.2, exploded ? 0.5 : 0, 0);
    controls.minZoom = 0.45; controls.maxZoom = 3; controls.update();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x999989, 2.1));
    const key = new THREE.DirectionalLight(0xffefd8, 4.5); key.position.set(5, 9, 8); scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 1.8); rim.position.set(-7, 3, -6); scene.add(rim);
    const fill = new THREE.DirectionalLight(0xffffff, 1.2); fill.position.set(1, -3, 6); scene.add(fill);
    const grid = new THREE.GridHelper(40, 40, 0xdeddd4, 0xecebe4); grid.position.y = -2.1; scene.add(grid);
    const outer = geometry[5].radius_mm;
    geometry.forEach((layer, i) => {
      const ro = layer.radius_mm / outer, ri = i ? geometry[i - 1].radius_mm / outer : 0;
      const end = 4.9 - i * 0.72, start = -5, length = end - start;
      const shape = i === 0 ? new THREE.CylinderGeometry(ro * 0.96, ro * 0.96, length, 64) :
        new THREE.LatheGeometry([new THREE.Vector2(ri, -length / 2), new THREE.Vector2(ro, -length / 2), new THREE.Vector2(ro, length / 2), new THREE.Vector2(ri, length / 2), new THREE.Vector2(ri, -length / 2)], 80);
      const material = new THREE.MeshStandardMaterial({color: layer.color, metalness: i === 0 || i === 4 ? 0.8 : 0.08, roughness: i === 0 ? 0.32 : 0.52, side: THREE.DoubleSide});
      const mesh = new THREE.Mesh(shape, material); mesh.rotation.z = -Math.PI / 2;
      mesh.position.set((start + end) / 2, exploded ? (i - 2) * 0.65 : 0, 0); scene.add(mesh);
      if (i === 0) {
        const r = ro / 7.1;
        for (let row = -3; row <= 3; row++) for (let col = -3; col <= 3; col++) {
          const y = col * r * 2 + (row % 2) * r, z = row * r * Math.sqrt(3);
          if (Math.hypot(y, z) > ro - r) continue;
          const wire = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.94, r * 0.94, 0.95, 12), material);
          wire.rotation.z = -Math.PI / 2; wire.position.set(end + 0.35, mesh.position.y + y, z); scene.add(wire);
        }
      }
    });
    const resize = () => {
      const width = Math.max(container.clientWidth, 1), height = Math.max(container.clientHeight, 1);
      renderer.setSize(width, height); camera.left = -5.4 * width / height; camera.right = 5.4 * width / height; camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize); observer.observe(container); resize();
    let frame = 0;
    const render = () => { controls.update(); renderer.render(scene, camera); frame = requestAnimationFrame(render); };
    render(); setStatus('ready');
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); controls.dispose();
      const disposed = new Set<THREE.Material>();
      scene.traverse(object => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          (Array.isArray(object.material) ? object.material : [object.material]).forEach(m => { if (!disposed.has(m)) { m.dispose(); disposed.add(m); } });
        }
      });
      renderer.dispose(); renderer.domElement.remove();
    };
  }, [geometry, exploded, resetKey]);
  return <div className="scene" ref={host} data-webgl={status}>
    {status === 'unavailable' && <div className="webgl-fallback"><p>当前浏览器未启用 WebGL，已切换为二维结构。</p><CrossSection cable={cable}/></div>}
  </div>;
}

export function CrossSection({cable}: {cable: Cable}) {
  const id = useId(), ls = layers(cable), outer = ls[5].radius_mm, scale = 142 / outer;
  const rc = ls[0].radius_mm * scale, wire = rc / 7.1;
  const strands = [];
  for (let row = -3; row <= 3; row++) for (let col = -3; col <= 3; col++) {
    const x = col * wire * 2 + (row % 2) * wire, y = row * wire * Math.sqrt(3);
    if (Math.hypot(x, y) <= rc - wire) strands.push(<circle key={`${row}-${col}`} cx={285 + x} cy={221 + y} r={wire * 0.92} fill={cable.conductor === 'copper' ? '#dcaa6e' : '#d3dde5'} stroke="#243144" strokeWidth="0.7"/>);
  }
  return <svg viewBox="0 0 800 440" className="section-svg" role="img" aria-label="电缆二维截面">
    <defs><pattern id={id} width="24" height="24" patternUnits="userSpaceOnUse"><path d="M 24 0 L 0 0 0 24" fill="none" stroke="#dfdfd7" strokeWidth="0.6"/></pattern></defs>
    <rect width="800" height="440" fill="#fafaf7"/><rect width="800" height="440" fill={`url(#${id})`} opacity="0.5"/>
    <path d="M90 221H460 M285 35V407" stroke="#b7b7a9" strokeDasharray="4 6"/>
    {[...ls].reverse().map(layer => <circle key={layer.name} cx="285" cy="221" r={layer.radius_mm * scale} fill={layer.color} stroke="#64758d" strokeWidth="0.5"/>)}{strands}
    {ls.map((layer, i) => {
      const angle = (-66 + i * 27) * Math.PI / 180;
      const x = 285 + Math.cos(angle) * layer.radius_mm * scale, y = 221 + Math.sin(angle) * layer.radius_mm * scale, target = 71 + i * 58;
      return <g key={layer.name}><path d={`M${x} ${y} L520 ${target} H550`} stroke={layer.color} fill="none"/><circle cx={x} cy={y} r="2.5" fill="#fff"/><text x="565" y={target - 4} fill="#5f5f50" fontSize="13">{layer.name}</text><text x="565" y={target + 15} fill="#8e8e7c" fontSize="12">r = {fmt(layer.radius_mm, 2)} mm</text></g>;
    })}
    <path d="M120 79H104V363H120" fill="none" stroke="#a7a790"/><text x="92" y="235" transform="rotate(-90 92 235)" textAnchor="middle" fill="#75755e" fontSize="12">Ø {fmt(outer * 2, 2)} mm</text>
  </svg>;
}

export function InstallationView({scenario}: {scenario: Scenario}) {
  const env = scenario.installation, s = safe(env.spacing_m, 0.12), h = safe(env.depth_m, 0.8);
  const ps = env.arrangement === 'flat' ? [[-s, h], [0, h], [s, h]] : [[0, h - s / Math.sqrt(3)], [-s / 2, h + s / (2 * Math.sqrt(3))], [s / 2, h + s / (2 * Math.sqrt(3))]];
  const radius = layers(scenario.cable)[5].radius_mm / 1000;
  const scale = Math.min(310 / (Math.max(...ps.map(p => p[1])) + 0.2), 300 / Math.max(0.8, s * 1.5));
  return <svg viewBox="0 0 800 440" className="section-svg" role="img" aria-label="直埋敷设截面">
    <rect width="800" height="440" fill="#fafaf7"/><rect y="70" width="800" height="370" fill="#f0f0e7"/>
    <path d="M40 70H760" stroke="#969880" strokeWidth="2"/><text x="42" y="50" fill="#6e705b" fontSize="13">恒温地表 · {fmt(env.ambient_temperature_c)} °C</text><text x="552" y="50" fill="#91927b" fontSize="12">ρsoil = {fmt(env.soil_rho_k_m_w, 2)} K·m/W</text>
    {ps.map(([x, depth], i) => <g key={i}><line x1={400 + x * scale} y1="70" x2={400 + x * scale} y2={70 + depth * scale} stroke="#57728d" strokeDasharray="4 5"/><circle cx={400 + x * scale} cy={70 + depth * scale} r={radius * scale} fill="#243e58" stroke="#65d9c2" strokeWidth="1.5"/><circle cx={400 + x * scale} cy={70 + depth * scale} r={radius * scale * 0.44} fill="#ce9451"/><text x={400 + x * scale} y={70 + depth * scale + radius * scale + 24} textAnchor="middle" fill="#71735b" fontSize="13">{'ABC'[i]}</text></g>)}
    <path d={`M130 70H120V${70 + h * scale}H130`} stroke="#b7b7a1" fill="none"/><text x="109" y={75 + h * scale / 2} textAnchor="end" fill="#88896f" fontSize="12">{fmt(h, 2)} m</text>
    <text x="400" y="416" textAnchor="middle" fill="#93967b" fontSize="12">中心间距 {fmt(s * 1000, 0)} mm · 埋深为三相中心的平均深度 · 尺度一致</text>
  </svg>;
}

function heatColor(t: number): string {
  const stops = [[20, 37, 66], [26, 87, 123], [27, 162, 150], [170, 208, 117], [250, 188, 83], [224, 83, 60]];
  const scaled = Math.max(0, Math.min(0.99999, t)) * (stops.length - 1), index = Math.floor(scaled), f = scaled - index;
  return `rgb(${stops[index].map((v, i) => Math.round(v + (stops[index + 1][i] - v) * f)).join(',')})`;
}
export function HeatField({result}: {result: Result}) {
  const ref = useRef<HTMLCanvasElement>(null), field = result.field;
  const values = field.temperature_c.flat().filter((n): n is number => n !== null);
  const low = result.input.installation.ambient_temperature_c, high = Math.max(low + 1, ...values);
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    canvas.width = 1600; canvas.height = 800; ctx.scale(2, 2);
    ctx.fillStyle = '#fafaf7'; ctx.fillRect(0, 0, 800, 400);
    const cols = field.x_m.length, rows = field.depth_m.length;
    const xr = field.x_m[cols - 1] - field.x_m[0], yr = field.depth_m[rows - 1];
    const scale = Math.min(670 / xr, 290 / yr), w = xr * scale, h = yr * scale, left = (800 - w) / 2, top = 30;
    field.temperature_c.forEach((row, j) => row.forEach((v, i) => {
      ctx.fillStyle = v == null ? '#111e2d' : heatColor((v - low) / (high - low));
      ctx.fillRect(left + i * w / cols, top + j * h / rows, w / cols + 0.5, h / rows + 0.5);
    }));
    ctx.strokeStyle = '#b8b9a4'; ctx.strokeRect(left, top, w, h);
    ctx.font = '12px system-ui'; ctx.fillStyle = '#797b64'; ctx.textAlign = 'center';
    for (let i = 0; i <= 4; i++) ctx.fillText((field.x_m[0] + xr * i / 4).toFixed(2), left + w * i / 4, top + h + 24);
    ctx.fillText('水平距离 / m', 400, top + h + 47); ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) ctx.fillText((yr * i / 4).toFixed(2), left - 12, top + h * i / 4 + 4);
    ctx.fillText('埋深 / m', left - 8, 16);
    result.geometry.positions_m.forEach(([x, y], i) => {
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText('ABC'[i], left + (x - field.x_m[0]) * scale, top + y * scale - 13);
    });
  }, [result, field, low, high]);
  return <div className="heat-field"><canvas ref={ref} aria-label="土壤解析温度分布"/><div className="heat-legend"><span>{fmt(low)} °C</span><i/><span>{fmt(high)} °C</span></div><p>{fmt(field.current_a)} A · {field.method}</p></div>;
}

export function LineChart({data, xLabel, yLabel, threshold, label}: {data: {x: number; y: number}[]; xLabel: string; yLabel: string; threshold?: number; label: string}) {
  const id = useId();
  if (data.length < 2) return <div className="chart-empty">暂无有效曲线数据</div>;
  const xMin = Math.min(...data.map(p => p.x)), xMax = Math.max(...data.map(p => p.x)), yMin = Math.min(0, ...data.map(p => p.y));
  const yMax = Math.max(...data.map(p => p.y), threshold ?? -Infinity) * 1.12;
  const X = (x: number) => 54 + (x - xMin) / Math.max(xMax - xMin, 1e-9) * 490;
  const Y = (y: number) => 191 - (y - yMin) / Math.max(yMax - yMin, 1e-9) * 156;
  const path = data.map((p, i) => `${i ? 'L' : 'M'}${X(p.x)},${Y(p.y)}`).join(' ');
  return <svg viewBox="0 0 580 240" className="line-chart" role="img" aria-label={label}>
    <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#565e47" stopOpacity="0.2"/><stop offset="1" stopColor="#565e47" stopOpacity="0.01"/></linearGradient></defs>
    {[0, 1, 2, 3, 4].map(i => <g key={i}><line x1="54" y1={35 + i * 39} x2="544" y2={35 + i * 39} stroke="#e4e4d9" strokeDasharray="3 4"/><text x="43" y={39 + i * 39} textAnchor="end" fill="#8f9280" fontSize="11">{fmt(yMax - (yMax - yMin) * i / 4, 0)}</text><text x={54 + i * 122.5} y="214" textAnchor="middle" fill="#8f9280" fontSize="11">{fmt(xMin + (xMax - xMin) * i / 4, xMax < 10 ? 1 : 0)}</text></g>)}
    <path d={`${path} L${X(data[data.length - 1].x)},191 L${X(data[0].x)},191 Z`} fill={`url(#${id})`}/><path d={path} fill="none" stroke="#565e47" strokeWidth="2.5"/>
    {data.map((p, i) => <circle key={i} cx={X(p.x)} cy={Y(p.y)} r="3" fill="#fff" stroke="#565e47" strokeWidth="1.4"><title>{fmt(p.x, 2)} / {fmt(p.y, 2)}</title></circle>)}
    {threshold !== undefined && <g><line x1="54" x2="544" y1={Y(threshold)} y2={Y(threshold)} stroke="#d38d45" strokeDasharray="5 4"/><text x="540" y={Y(threshold) - 7} textAnchor="end" fill="#b67c3f" fontSize="10">温度上限 {threshold} °C</text></g>}
    <text x="54" y="17" fill="#8f9280" fontSize="11">{yLabel}</text><text x="544" y="235" textAnchor="end" fill="#8f9280" fontSize="11">{xLabel}</text>
  </svg>;
}
