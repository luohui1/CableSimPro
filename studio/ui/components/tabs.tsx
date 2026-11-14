// Tabs: different content in the same place. Flat text on a hairline with a sliding underline.
import { Tabs as Base } from '@base-ui/react/tabs';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface TabItem<T extends string> { value: T; label: ReactNode }

export function Tabs<T extends string>({ value, onChange, items, className, children }: {
  value: T;
  onChange: (value: T) => void;
  items: TabItem<T>[];
  className?: string;
  children: ReactNode;
}) {
  return <Base.Root value={value} onValueChange={next => onChange(next as T)} className={cn('flex min-h-0 flex-col', className)}>
    <Base.List className="relative flex shrink-0 gap-6 border-b border-line px-5">
      {items.map(item => <Base.Tab key={item.value} value={item.value}
        className="h-10 text-14 text-ink-2 transition-colors duration-fast ease-std select-none hover:text-ink data-[active]:text-ink">
        {item.label}
      </Base.Tab>)}
      <Base.Indicator className="absolute -bottom-px left-0 h-0.5 w-[var(--active-tab-width)] translate-x-[var(--active-tab-left)] bg-ink transition-[translate,width] duration-std ease-std" />
    </Base.List>
    {children}
  </Base.Root>;
}

export const TabPanel = ({ value, className, children }: { value: string; className?: string; children: ReactNode }) =>
  <Base.Panel value={value} className={cn('min-h-0 flex-1 outline-none', className)}>{children}</Base.Panel>;
