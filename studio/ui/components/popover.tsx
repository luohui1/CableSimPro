import { Menu as BaseMenu } from '@base-ui/react/menu';
import { Popover as BasePopover } from '@base-ui/react/popover';
import type { ReactElement, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Icon } from './icon';

const surface = 'origin-[var(--transform-origin)] rounded-card border border-line bg-panel shadow-modal outline-none transition-[opacity,scale] duration-std ease-std data-[ending-style]:opacity-0 data-[starting-style]:scale-[.98] data-[starting-style]:opacity-0';

/** A panel that opens from the control it describes. */
export function Popover({ trigger, side = 'bottom', align = 'start', className, children }: {
  trigger: ReactElement;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  className?: string;
  children: ReactNode;
}) {
  return <BasePopover.Root>
    <BasePopover.Trigger render={trigger} />
    <BasePopover.Portal>
      <BasePopover.Positioner side={side} align={align} sideOffset={8} className="z-40">
        <BasePopover.Popup className={cn(surface, 'max-h-[min(560px,var(--available-height))] w-[380px] overflow-y-auto p-5', className)}>{children}</BasePopover.Popup>
      </BasePopover.Positioner>
    </BasePopover.Portal>
  </BasePopover.Root>;
}

/** A short list of choices that opens from a button. */
export function Menu({ trigger, align = 'start', children }: { trigger: ReactElement; align?: 'start' | 'center' | 'end'; children: ReactNode }) {
  return <BaseMenu.Root>
    <BaseMenu.Trigger render={trigger} />
    <BaseMenu.Portal>
      <BaseMenu.Positioner align={align} sideOffset={6} className="z-40">
        <BaseMenu.Popup className={cn(surface, 'min-w-56 p-1')}>{children}</BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  </BaseMenu.Root>;
}

export function MenuItem({ checked, onSelect, children }: { checked?: boolean; onSelect: () => void; children: ReactNode }) {
  return <BaseMenu.Item onClick={onSelect}
    className="flex h-9 items-center gap-2 rounded-field px-2.5 text-14 text-ink outline-none select-none data-[highlighted]:bg-hover">
    <span className="min-w-0 flex-1 truncate">{children}</span>
    {checked && <Icon name="action/check" className="text-ink-2" />}
  </BaseMenu.Item>;
}
