'use client';

// 首屏的点阵背景：光标附近的点会变大并染成铜色。系统要求减少动效时只画静态点阵。
import { useEffect, useRef } from 'react';

const GAP = 22;
const RADIUS = 1.1;
const REACH = 160;

export function DotField({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let width = 0;
    let height = 0;
    let frame = 0;
    const pointer = { x: -9999, y: -9999 };
    const target = { x: -9999, y: -9999 };

    const draw = () => {
      const style = getComputedStyle(canvas);
      const base = style.color;
      const hot = style.getPropertyValue('--color-brand').trim() || base;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      for (let y = GAP / 2; y < height; y += GAP) {
        for (let x = GAP / 2; x < width; x += GAP) {
          const near = Math.max(0, 1 - Math.hypot(x - pointer.x, y - pointer.y) / REACH);
          context.globalAlpha = 0.28 + near * 0.72;
          context.fillStyle = near > 0.02 ? hot : base;
          context.beginPath();
          context.arc(x, y, RADIUS + near * near * 3.4, 0, Math.PI * 2);
          context.fill();
        }
      }
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      draw();
    };

    const tick = () => {
      pointer.x += (target.x - pointer.x) * 0.2;
      pointer.y += (target.y - pointer.y) * 0.2;
      draw();
      frame = Math.abs(target.x - pointer.x) + Math.abs(target.y - pointer.y) > 0.5 ? requestAnimationFrame(tick) : 0;
    };

    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      const rect = canvas.getBoundingClientRect();
      target.x = event.clientX - rect.left;
      target.y = event.clientY - rect.top;
      if (!frame) frame = requestAnimationFrame(tick);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    // 明暗主题切换后按新颜色重画
    const theme = new MutationObserver(draw);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    if (!still) window.addEventListener('pointermove', move, { passive: true });
    return () => {
      observer.disconnect();
      theme.disconnect();
      window.removeEventListener('pointermove', move);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return <canvas ref={ref} aria-hidden className={className} />;
}
