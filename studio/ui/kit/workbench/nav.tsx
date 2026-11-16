// The workbench's own column: the two workspaces (电缆型号, 载流量计算), each with its entry and the objects opened
// lately. Items take any props, so a router link can render them.
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Icon } from '../icon';

export function WorkbenchNav({ children, footer, className }: { children: ReactNode; footer?: ReactNode; className?: string }) {
  return <nav aria-label="工作台" className={cn('flex h-full min-h-0 flex-col', className)}>
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-2 pt-1 pb-4">{children}</div>
    {footer && <div className="border-t border-line px-2 py-2">{footer}</div>}
  </nav>;
}

/** A workspace: its name with its icon, then its entries and recent objects. */
export function NavSection({ icon, label, children }: { icon: string; label: string; children: ReactNode }) {
  return <section className="flex flex-col gap-1" aria-label={label}>
    <h2 className="m-0 flex h-8 items-center gap-2 px-3 text-xs font-medium text-ink-2"><Icon name={icon} />{label}</h2>
    <ul className="m-0 flex list-none flex-col gap-1 p-0">{children}</ul>
  </section>;
}

/** An entry (型号库) or an object (a series, a project). Objects sit one step in. Active: the selection fill. */
export function NavItem({ icon, label, count, active, nested, className, ...props }: {
  icon?: string;
  label: string;
  count?: number;
  active?: boolean;
  nested?: boolean;
} & ComponentProps<'button'>) {
  return <li className="list-none">
    <button type="button" data-active={active || undefined} aria-current={active ? 'page' : undefined} title={label}
      className={cn('flex min-h-8 w-full min-w-0 items-center gap-2 rounded-nav px-3 py-1 text-left text-sm text-ink transition-colors duration-fast outline-none hover:bg-hover focus-visible:ring-3 focus-visible:ring-ring data-active:bg-copper-fill data-active:font-medium', nested && 'pl-9', className)}
      {...props}>
      {icon && <Icon name={icon} className="text-ink-2" />}
      <span className="line-clamp-2 min-w-0 flex-1">{label}</span>
      {count !== undefined && <span className="text-xs text-ink-2 tabular-nums">{count}</span>}
    </button>
  </li>;
}
