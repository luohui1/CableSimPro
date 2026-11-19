'use client';

// 首页的产品截图窗口：标签自动轮播（当前标签下有进度条），鼠标移上去暂停，点标签直接切换。
import { motion, useReducedMotion } from 'motion/react';
import Image, { type StaticImageData } from 'next/image';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/cn';

import { windowFrame } from './window';

export interface TabShot {
  label: string;
  src: StaticImageData;
  alt: string;
}

const DWELL = 5.2; // 每张停留的秒数

export function ScreenshotTabs({ shots }: { shots: TabShot[] }) {
  const reduced = useReducedMotion();
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const playing = !paused && !reduced;

  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => setActive((current) => (current + 1) % shots.length), DWELL * 1000);
    return () => window.clearTimeout(timer);
  }, [active, playing, shots.length]);

  return (
    <div
      className={windowFrame}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div role="tablist" className="flex items-stretch overflow-x-auto whitespace-nowrap border-b border-fd-foreground/70 text-sm">
        {shots.map((shot, index) => (
          <button
            key={shot.label}
            type="button"
            role="tab"
            aria-selected={index === active}
            onClick={() => setActive(index)}
            className={cn(
              'relative border-r border-fd-foreground/70 px-3.5 py-1.5 transition-colors',
              index === active
                ? 'bg-brand-soft text-fd-foreground'
                : 'text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-foreground',
            )}
          >
            {shot.label}
            {index === active && playing && (
              <motion.span
                key={`progress-${active}`}
                className="absolute bottom-0 left-0 h-0.5 bg-brand"
                initial={{ width: '0%' }}
                animate={{ width: '100%' }}
                transition={{ duration: DWELL, ease: 'linear' }}
              />
            )}
          </button>
        ))}
        <span className="window-stripes mx-3 my-auto hidden h-2.5 flex-1 text-fd-foreground/30 sm:block" />
        <span className="my-auto hidden pr-3 font-mono text-xs text-fd-muted-foreground sm:block">
          {paused ? '已暂停' : `${active + 1} / ${shots.length}`}
        </span>
      </div>
      {/* 截图有横有竖，放进同一个画框里，切换时不跳动 */}
      <div className="relative aspect-[1366/768] overflow-hidden bg-fd-muted">
        {shots.map((shot, index) => (
          <motion.div
            key={shot.label}
            className="absolute inset-0"
            initial={false}
            animate={{ opacity: index === active ? 1 : 0, scale: index === active ? 1 : 1.015 }}
            transition={{ duration: 0.35, ease: [0.2, 0, 0, 1] }}
            style={{ pointerEvents: index === active ? 'auto' : 'none' }}
          >
            <Image src={shot.src} alt={shot.alt} className="h-full w-full object-contain" />
          </motion.div>
        ))}
      </div>
    </div>
  );
}
