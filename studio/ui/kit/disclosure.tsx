// A group that opens and closes in place: a heading row with a chevron, and the content under it sliding open in 200 ms.
// Used for the less-asked parts of a panel (损耗, 热阻, 已通过的核对项) so the panel shows its answer first.
import type { ReactNode } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { Icon } from './icon';

export function Disclosure({ title, aside, defaultOpen = false, children, className }: {
  title: ReactNode;
  /** A count or a mark at the end of the heading row. */
  aside?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return <Collapsible defaultOpen={defaultOpen} className={cn('border-b border-line last:border-b-0', className)}>
    <CollapsibleTrigger className="group flex h-11 w-full items-center gap-2 px-4 text-left text-h3 text-ink outline-none hover:bg-subtle focus-visible:ring-3 focus-visible:ring-ring">
      <span className="min-w-0 flex-1">{title}</span>
      {aside}
      <Icon name="action/chevron-right" className="text-ink-2 transition-transform duration-std group-data-panel-open:rotate-90" />
    </CollapsibleTrigger>
    <DisclosurePanel>{children}</DisclosurePanel>
  </Collapsible>;
}

/** The sliding part alone, for a trigger placed elsewhere (其余 15 项 under a list). */
export function DisclosurePanel({ children }: { children: ReactNode }) {
  return <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-height data-ending-style:h-0 data-starting-style:h-0">{children}</CollapsibleContent>;
}

/** A quiet text button that opens the rest of a list and then offers to close it again. */
export function DisclosureMore({ more }: { more: number }) {
  return <CollapsibleTrigger className="group/more mt-1 flex h-8 items-center gap-1 rounded-nav px-2 text-sm text-ink-2 outline-none hover:bg-subtle hover:text-ink focus-visible:ring-3 focus-visible:ring-ring">
    <span className="group-data-panel-open/more:hidden">其余 {more} 项</span>
    <span className="hidden group-data-panel-open/more:inline">收起</span>
  </CollapsibleTrigger>;
}

export { Collapsible as DisclosureRoot };
