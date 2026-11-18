'use client';

// 首页的产品截图窗口：上方标签切换不同工作页面的真实截图
import Image, { type StaticImageData } from 'next/image';
import { useState } from 'react';

import { cn } from '@/lib/cn';

export interface TabShot {
  label: string;
  src: StaticImageData;
  alt: string;
}

export function ScreenshotTabs({ shots }: { shots: TabShot[] }) {
  const [active, setActive] = useState(0);
  return (
    <div className="border border-fd-foreground/70 bg-fd-card shadow-[6px_6px_0_0_rgb(28_26_23/0.1)] dark:shadow-[6px_6px_0_0_rgb(0_0_0/0.45)]">
      <div role="tablist" className="flex items-stretch overflow-x-auto whitespace-nowrap border-b border-fd-foreground/70 text-sm">
        {shots.map((shot, index) => (
          <button
            key={shot.label}
            type="button"
            role="tab"
            aria-selected={index === active}
            onClick={() => setActive(index)}
            className={cn(
              'border-r border-fd-foreground/70 px-3.5 py-1.5 transition-colors',
              index === active
                ? 'bg-brand-soft text-fd-foreground'
                : 'text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-foreground',
            )}
          >
            {shot.label}
          </button>
        ))}
        <span className="window-stripes mx-3 my-auto hidden h-2.5 flex-1 text-fd-foreground/30 sm:block" />
      </div>
      {shots.map((shot, index) => (
        <Image
          key={shot.label}
          src={shot.src}
          alt={shot.alt}
          className={cn('w-full', index === active ? 'block' : 'hidden')}
        />
      ))}
    </div>
  );
}
