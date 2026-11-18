import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/cn';

// 复古窗口外框：标题栏两侧横纹、居中等宽标题、两端小方块（版式参照 fumadocs.dev 首页）
export const windowFrame =
  'border border-fd-foreground/70 bg-fd-card shadow-[6px_6px_0_0_rgb(28_26_23/0.1)] dark:shadow-[6px_6px_0_0_rgb(0_0_0/0.45)]';

export function TitleBar({ title, className, ...props }: { title: ReactNode } & Omit<HTMLAttributes<HTMLDivElement>, 'title'>) {
  return (
    <div
      className={cn(
        'box-border flex h-6 select-none items-center gap-2 border-b border-fd-foreground/70 px-1.5 text-fd-foreground/40',
        className,
      )}
      {...props}
    >
      <span className="size-3 shrink-0 border border-fd-foreground/70 bg-fd-card" />
      <span className="window-stripes h-2.5 flex-1" />
      <span className="shrink-0 px-1 font-mono text-xs text-fd-foreground">{title}</span>
      <span className="window-stripes h-2.5 flex-1" />
      <span className="size-3 shrink-0 border border-fd-foreground/70 bg-fd-card" />
    </div>
  );
}

export function Window({
  title,
  children,
  className,
  bodyClassName,
}: {
  title: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <div className={cn(windowFrame, className)}>
      <TitleBar title={title} />
      <div className={bodyClassName}>{children}</div>
    </div>
  );
}

// 制图用的十字对位标记，放在四角外侧
export function CornerMarks() {
  const mark =
    'pointer-events-none absolute size-4 before:absolute before:left-1/2 before:h-full before:w-px before:bg-fd-foreground/50 after:absolute after:top-1/2 after:h-px after:w-full after:bg-fd-foreground/50';
  return (
    <>
      <span aria-hidden className={cn(mark, '-left-6 -top-6')} />
      <span aria-hidden className={cn(mark, '-right-6 -top-6')} />
      <span aria-hidden className={cn(mark, '-bottom-6 -left-6')} />
      <span aria-hidden className={cn(mark, '-bottom-6 -right-6')} />
    </>
  );
}
