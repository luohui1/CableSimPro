// 取自 Launch UI（https://www.launchui.design，MIT 许可，Copyright (c) 2024 Mikolaj Dobrucki），许可全文见 site/THIRD_PARTY_NOTICES.md。
// 改动：去掉 class-variance-authority，只保留用到的两种位置；浅色主题下光晕加强。
import type { ComponentProps } from 'react';

import { cn } from '@/lib/cn';

const positions = {
  top: 'top-0',
  bottom: 'bottom-0',
} as const;

export function Glow({
  className,
  variant = 'top',
  ...props
}: ComponentProps<'div'> & { variant?: keyof typeof positions }) {
  return (
    <div data-slot="glow" className={cn('pointer-events-none absolute w-full', positions[variant], className)} {...props}>
      <div className="absolute left-1/2 h-[256px] w-[60%] -translate-x-1/2 scale-[2.5] rounded-[50%] bg-radial from-brand-foreground/50 from-10% to-brand-foreground/0 to-60% opacity-60 sm:h-[512px] dark:opacity-100" />
      <div className="absolute left-1/2 h-[128px] w-[40%] -translate-x-1/2 scale-200 rounded-[50%] bg-radial from-brand/30 from-10% to-brand-foreground/0 to-60% opacity-60 sm:h-[256px] dark:opacity-100" />
    </div>
  );
}
