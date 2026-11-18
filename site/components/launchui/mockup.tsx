// 取自 Launch UI（https://www.launchui.design，MIT 许可，Copyright (c) 2024 Mikolaj Dobrucki），许可全文见 site/THIRD_PARTY_NOTICES.md。
// 改动：去掉 class-variance-authority，只保留网页截图用的样式。
import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

export function Mockup({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="mockup"
      className={cn(
        'relative z-10 flex overflow-hidden rounded-md border border-fd-border/70 shadow-2xl dark:border-white/5 dark:border-t-white/15',
        className,
      )}
      {...props}
    />
  );
}

export function MockupFrame({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="mockup-frame"
      className={cn('relative z-10 flex overflow-hidden rounded-2xl bg-fd-border/50 p-2 dark:bg-white/10', className)}
      {...props}
    />
  );
}
