// A number with its unit. The value is committed on Enter or when the field is left, never on each key.
// The label can be dragged sideways to change the value (scrubbing), as in CAD property fields.
import { NumberField as Base } from '@base-ui/react/number-field';
import { useEffect, useId, useState } from 'react';
import { cn } from '@/lib/cn';

export function NumberField({ label, value, unit, onCommit, onLeave, min, max, step = 1, digits = 3, placeholder, autoFocus, className }: {
  label?: string;
  /** In the unit shown. null means "not set". */
  value: number | null;
  unit?: string;
  onCommit: (value: number | null) => void;
  /** The field was left (blur or Escape), whether or not the value changed. For editors that open in place. */
  onLeave?: () => void;
  min?: number;
  max?: number;
  step?: number;
  digits?: number;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const id = useId();
  const [typed, setTyped] = useState(value);
  useEffect(() => setTyped(value), [value]);
  return <Base.Root value={typed} min={min} max={max} step={step} format={{ maximumFractionDigits: digits, useGrouping: false }}
    onValueChange={setTyped} onValueCommitted={next => { if (next !== value) onCommit(next); }}
    className={cn('flex items-center justify-between gap-4', className)}>
    {label && <Base.ScrubArea className="cursor-ew-resize select-none">
      <label htmlFor={id} className="cursor-ew-resize text-13 text-ink-2">{label}</label>
      <Base.ScrubAreaCursor className="text-ink">↔</Base.ScrubAreaCursor>
    </Base.ScrubArea>}
    <Base.Group className="flex h-8 w-40 shrink-0 items-center rounded-field border border-control bg-panel transition-colors duration-fast ease-std focus-within:border-ink">
      <Base.Input id={id} autoFocus={autoFocus} placeholder={placeholder} onBlur={onLeave}
        onKeyDown={event => { if (event.key === 'Escape' || event.key === 'Enter') event.currentTarget.blur(); }} className="h-full min-w-0 flex-1 bg-transparent px-2.5 text-right text-14 text-ink outline-none placeholder:text-ink-3" />
      {unit && <span className="flex h-full shrink-0 items-center border-l border-line px-2.5 text-13 text-ink-2">{unit}</span>}
    </Base.Group>
  </Base.Root>;
}
