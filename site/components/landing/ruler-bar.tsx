'use client';

// 首屏下方的刻度尺与状态条：刻度尺上的游标跟着鼠标走，状态条实时显示光标坐标（像制图软件的读数）。
import Link from 'next/link';
import { useEffect, useState } from 'react';

const pad = (value: number) => String(Math.max(0, value)).padStart(4, '0');

export function RulerBar({ sections }: { sections: { label: string; href: string }[] }) {
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let frame = 0;
    let latest: PointerEvent | null = null;
    const flush = () => {
      frame = 0;
      if (latest) setPoint({ x: Math.round(latest.clientX), y: Math.round(latest.clientY + window.scrollY) });
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      latest = event;
      if (!frame) frame = requestAnimationFrame(flush);
    };
    window.addEventListener('pointermove', move, { passive: true });
    return () => {
      window.removeEventListener('pointermove', move);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <>
      <div className="ruler relative h-5 w-full border-b border-fd-foreground/60 text-fd-foreground/45">
        {point && (
          <span aria-hidden className="absolute bottom-0 h-full w-px bg-brand" style={{ left: point.x }}>
            <span className="absolute -left-[3px] -top-1 size-[7px] rotate-45 bg-brand" />
          </span>
        )}
      </div>
      <nav className="flex items-center justify-between gap-3 border-b border-fd-foreground/60 px-3 py-1.5">
        <span className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap font-mono text-xs text-fd-muted-foreground">
          <span className="size-2 animate-pulse rounded-full bg-brand" />
          就绪
          <span aria-hidden className="ml-3 hidden font-pixel text-[13px] tracking-wider text-fd-foreground/70 md:inline">
            X {point ? pad(point.x) : '----'}&nbsp;&nbsp;Y {point ? pad(point.y) : '----'}
          </span>
        </span>
        <div className="flex min-w-0 overflow-x-auto whitespace-nowrap text-[13px]">
          {sections.map((item, index) => (
            <Link
              key={item.label}
              href={item.href}
              className={
                index === 0
                  ? 'border border-fd-foreground/70 bg-brand-soft px-2.5 py-0.5'
                  : 'border border-l-0 border-fd-foreground/70 px-2.5 py-0.5 transition-colors hover:bg-brand-soft'
              }
            >
              {item.label}
            </Link>
          ))}
        </div>
      </nav>
    </>
  );
}
