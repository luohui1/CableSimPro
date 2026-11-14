import { Tooltip } from '@base-ui/react/tooltip';
import type { ReactElement, ReactNode } from 'react';

export const TipProvider = ({ children }: { children: ReactNode }) => <Tooltip.Provider delay={350} closeDelay={60}>{children}</Tooltip.Provider>;

/** A short name for a control that shows only an icon, or the full text of something cut short. */
export function Tip({ label, side = 'top', children }: { label: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right'; children: ReactElement }) {
  return <Tooltip.Root>
    <Tooltip.Trigger render={children} />
    <Tooltip.Portal>
      <Tooltip.Positioner side={side} sideOffset={8} className="z-50">
        <Tooltip.Popup className="max-w-80 origin-[var(--transform-origin)] rounded-field bg-ink px-2.5 py-1 text-13 text-panel shadow-lift transition-[opacity,scale] duration-fast ease-std data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
          {label}
        </Tooltip.Popup>
      </Tooltip.Positioner>
    </Tooltip.Portal>
  </Tooltip.Root>;
}
