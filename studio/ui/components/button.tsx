// Two button shapes with two different jobs.
// Button: a pill, for actions on the project (run, export, switch project).
// ToolButton: a rounded square, for tools that act on the drawing.
import { Toggle } from '@base-ui/react/toggle';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Icon } from './icon';
import { Tip } from './tooltip';

const button = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-full whitespace-nowrap select-none transition-colors duration-fast ease-std disabled:pointer-events-none disabled:opacity-45',
  {
    variants: {
      variant: {
        primary: 'bg-copper font-strong text-on-copper hover:bg-[color-mix(in_oklab,var(--copper),black_9%)] active:bg-[color-mix(in_oklab,var(--copper),black_16%)]',
        outline: 'border border-control bg-panel text-ink hover:bg-hover active:bg-fill',
        ghost: 'text-ink hover:bg-hover active:bg-fill',
      },
      size: { compact: 'h-8 px-3 text-13', standard: 'h-9 px-4 text-14' },
    },
    defaultVariants: { variant: 'outline', size: 'standard' },
  },
);

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> {
  icon?: string;
  /** Shows the spinner in place of the icon and blocks further presses. */
  busy?: boolean;
}

export function Button({ variant, size, icon, busy, className, children, disabled, ...props }: ButtonProps) {
  return <button type="button" className={cn(button({ variant, size }), className)} disabled={disabled || busy} {...props}>
    {busy ? <Icon name="status/spinner" className="animate-spin" /> : icon ? <Icon name={icon} /> : null}
    {children}
  </button>;
}

const tool = 'inline-flex size-8 shrink-0 items-center justify-center rounded-field text-ink-2 transition-colors duration-fast ease-std hover:bg-hover hover:text-ink disabled:pointer-events-none disabled:opacity-40';

/** A drawing tool that runs once when pressed. */
export function ToolButton({ icon, label, className, ...props }: { icon: string; label: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <Tip label={label}>
    <button type="button" aria-label={label} className={cn(tool, className)} {...props}><Icon name={icon} /></button>
  </Tip>;
}

/** A drawing tool that stays on: a layer switch. */
export function ToolToggle({ icon, label, pressed, onChange }: { icon: string; label: string; pressed: boolean; onChange: (pressed: boolean) => void }) {
  return <Tip label={label}>
    <Toggle aria-label={label} pressed={pressed} onPressedChange={onChange}
      className={cn(tool, 'data-[pressed]:bg-fill data-[pressed]:text-ink data-[pressed]:shadow-[inset_0_0_0_1px_var(--control-border)]')}>
      <Icon name={icon} />
    </Toggle>
  </Tip>;
}

/** The white floating group that holds drawing tools. */
export function ToolGroup({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('flex items-center gap-0.5 rounded-card border border-line bg-panel p-1 shadow-lift', className)}>{children}</div>;
}
