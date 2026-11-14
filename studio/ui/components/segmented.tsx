// A segmented switch: one of a few mutually exclusive states of the same view (load / rated, cluster / overview).
// A recessed track with a sliding white thumb, so it never reads as a row of buttons or as tabs.
import { Toggle } from '@base-ui/react/toggle';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import { motion } from 'motion/react';
import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface SegmentedOption<T extends string> { value: T; label: ReactNode }

export function Segmented<T extends string>({ value, onChange, options, label, stretch, className }: {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  label: string;
  stretch?: boolean;
  className?: string;
}) {
  const thumb = useId();
  return <ToggleGroup aria-label={label} value={[value]} onValueChange={next => { if (next[0]) onChange(next[0] as T); }}
    className={cn('inline-flex h-8 items-center gap-0.5 rounded-field bg-fill p-0.5', stretch && 'flex w-full', className)}>
    {options.map(option => <Toggle key={option.value} value={option.value}
      className={cn('relative inline-flex h-7 items-center justify-center rounded-chip px-3 text-13 whitespace-nowrap text-ink-2 transition-colors duration-fast ease-std select-none hover:text-ink data-[pressed]:text-ink',
        stretch && 'flex-1')}>
      {option.value === value && <motion.span layoutId={thumb} transition={{ type: 'spring', stiffness: 520, damping: 42 }}
        className="absolute inset-0 rounded-chip bg-panel shadow-[0_0_0_1px_var(--control-border),var(--shadow-float)]" />}
      <span className="relative">{option.label}</span>
    </Toggle>)}
  </ToggleGroup>;
}
