// The frame around the section drawing: tools float at the top left, the view switch at the top right, the temperature
// scale at the bottom left, and a status line under the drawing. The drawing itself is the canvas's own (ui/canvas).
import { Toolbar } from '@base-ui/react/toolbar';
import type { ComponentProps, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Icon } from '../icon';

export function CanvasFrame({ tools, view, legend, status, children, className }: {
  tools?: ReactNode;
  view?: ReactNode;
  legend?: ReactNode;
  /** The status line: scale, what is shown, the method. */
  status?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col', className)}>
    <div className="relative min-h-0 flex-1 overflow-hidden bg-canvas">
      {children}
      {tools && <div className="absolute top-3 left-3 flex items-center gap-2">{tools}</div>}
      {view && <div className="absolute top-3 right-3">{view}</div>}
      {legend && <div className="absolute bottom-3 left-3">{legend}</div>}
    </div>
    {status && <footer className="flex h-8 shrink-0 items-center gap-6 overflow-hidden border-t border-line bg-surface px-4 text-xs whitespace-nowrap text-ink-2 tabular-nums">{status}</footer>}
  </div>;
}

/** A floating group of tools (Base UI Toolbar: one tab stop, arrow keys between tools). */
export function CanvasToolbar({ label, children }: { label: string; children: ReactNode }) {
  return <Toolbar.Root aria-label={label} className="flex items-center gap-1 rounded-lg border border-line bg-surface p-1 shadow-menu">{children}</Toolbar.Root>;
}

export const CanvasToolbarSeparator = () => <Toolbar.Separator className="mx-1 h-5 w-px bg-line" />;

/** A tool that acts once: zoom, fit. */
export function CanvasTool({ icon, label, ...props }: { icon: string; label: string } & Omit<ComponentProps<typeof Button>, 'children'>) {
  return <Tooltip>
    <TooltipTrigger render={<Toolbar.Button render={<Button variant="ghost" size="icon-sm" className="rounded-md" aria-label={label} {...props} />} />}>
      <Icon name={icon} />
    </TooltipTrigger>
    <TooltipContent side="bottom">{label}</TooltipContent>
  </Tooltip>;
}

/** A layer that stays on or off: the temperature field, isotherms, dimensions. */
export function CanvasLayer({ icon, label, pressed, onPressedChange }: { icon: string; label: string; pressed: boolean; onPressedChange?: (pressed: boolean) => void }) {
  return <Tooltip>
    <TooltipTrigger render={<Toolbar.Button render={<Toggle size="default" aria-label={label} pressed={pressed} onPressedChange={onPressedChange} />} />}>
      <Icon name={icon} />
    </TooltipTrigger>
    <TooltipContent side="bottom">{label}</TooltipContent>
  </Tooltip>;
}

/**
 * The temperature scale: the ramp from the ambient to the conductor limit (the --temperature-* tokens), its two ends and
 * the middle, and what the colour is on.
 */
export function TemperatureLegend({ title, ambient, limit, lines }: {
  title: string;
  ambient: number;
  limit: number;
  /** The isotherm step, when isotherms are drawn. */
  lines?: number;
}) {
  const ticks = [ambient, (ambient + limit) / 2, limit];
  return <div className="flex w-56 flex-col gap-2 rounded-lg border border-line bg-surface px-3 py-2 shadow-menu">
    <div className="flex items-baseline justify-between text-xs">
      <span className="text-ink">{title}</span>
      <span className="text-ink-2">°C</span>
    </div>
    <svg viewBox="0 0 100 8" preserveAspectRatio="none" className="h-2 w-full overflow-visible" aria-hidden="true">
      <defs>
        <linearGradient id="temperature-ramp">
          {[1, 2, 3, 4, 5, 6].map((index, at) => <stop key={index} offset={at / 5} stopColor={`var(--temperature-${index})`} />)}
        </linearGradient>
      </defs>
      <rect width="100" height="8" rx="4" fill="url(#temperature-ramp)" stroke="var(--line)" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
    </svg>
    <div className="flex justify-between text-xs text-ink-2 tabular-nums">{ticks.map(value => <span key={value}>{Number(value.toFixed(1))}</span>)}</div>
    {lines && <div className="flex items-center gap-2 border-t border-line pt-2 text-xs text-ink-2"><span className="h-px w-5 bg-ink-2" />等温线每 {lines} °C 一条</div>}
  </div>;
}
