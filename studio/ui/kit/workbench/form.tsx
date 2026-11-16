// Forms of the workbench: a titled section of rows, each row a label, its control and (only when it helps) a hint; numbers
// with their unit inside the field; a choice among a few options as cards; where a value came from as a tag.
import type { ComponentProps, ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { Icon } from '../icon';
import { Dot } from '../marks';

export function FormSection({ title, description, aside, children, className }: {
  title: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return <section className={cn('flex flex-col gap-4', className)}>
    <header className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <h2 className="m-0 text-h2 text-ink">{title}</h2>
        {description && <p className="m-0 text-sm text-ink-2">{description}</p>}
      </div>
      {aside}
    </header>
    <div className="flex flex-col gap-3">{children}</div>
  </section>;
}

/** One field: the label on the left, the control on the right; a dot when it changed since the last run. */
export function FormRow({ label, hint, changed, htmlFor, children, className }: {
  label: ReactNode;
  hint?: ReactNode;
  changed?: boolean;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn('grid grid-cols-label items-start gap-x-4 gap-y-1', className)}>
    <label htmlFor={htmlFor} className="flex min-h-8 min-w-0 items-center gap-2 text-sm text-ink-2">
      <span className="truncate">{label}</span>
      {changed && <Dot tone="attention" />}
    </label>
    <div className="min-w-0">{children}</div>
    {hint && <p className="col-start-2 m-0 text-sm text-ink-2">{hint}</p>}
  </div>;
}

/** A number with its unit inside the field, right-aligned in tabular figures; `prefix` names it when several share a row (U₀, U, Um). */
export function UnitInput({ unit, prefix, className, ...props }: { unit: string; prefix?: string } & Omit<ComponentProps<'input'>, 'prefix'>) {
  return <InputGroup className={cn('w-full', className)}>
    {prefix && <InputGroupAddon align="inline-start" className="pl-3 text-ink-2">{prefix}</InputGroupAddon>}
    <InputGroupInput inputMode="decimal" className="text-right tabular-nums" {...props} />
    <InputGroupAddon align="inline-end" className="w-16 justify-start pr-3 text-ink-2">{unit}</InputGroupAddon>
  </InputGroup>;
}

export interface Choice { value: string; title: string; detail?: string; icon?: string; disabled?: boolean }

/** A few mutually exclusive options as cards (Base UI radio group); the chosen one takes the selection colours. */
export function ChoiceCards({ value, onValueChange, options, columns = 'grid-cols-2', label }: {
  value: string;
  onValueChange?: (value: string) => void;
  options: Choice[];
  columns?: 'grid-cols-1' | 'grid-cols-2' | 'grid-cols-3';
  label: string;
}) {
  return <RadioGroup value={value} onValueChange={next => onValueChange?.(next as string)} aria-label={label} className={cn('grid gap-2', columns)}>
    {options.map(option => <label key={option.value} data-checked={option.value === value || undefined}
      className="flex min-w-0 cursor-pointer items-start gap-3 rounded-card border border-line bg-surface px-3 py-3 transition-colors duration-fast hover:bg-subtle data-checked:border-copper data-checked:bg-copper-fill">
      <RadioGroupItem value={option.value} disabled={option.disabled} className="mt-1" />
      {option.icon && <Icon name={option.icon} className="mt-1 text-ink-2" />}
      <span className="flex min-w-0 flex-col">
        <span className="text-sm font-medium text-ink">{option.title}</span>
        {option.detail && <span className="text-sm text-ink-2">{option.detail}</span>}
      </span>
    </label>)}
  </RadioGroup>;
}

export type SourceKind = 'standard' | 'derived' | 'given' | 'table' | 'manual';
const SOURCE: Record<SourceKind, { icon: string; word: string }> = {
  standard: { icon: 'source/from-standard', word: '标准' },
  derived: { icon: 'source/derived', word: '推算' },
  given: { icon: 'source/from-user', word: '给定' },
  table: { icon: 'source/from-document', word: '厂家表' },
  manual: { icon: 'action/edit', word: '人工填写' },
};

/** Where a value came from: the kind as an icon and a word, and the place (表 7 · PDF 第 15 页). */
export function SourceTag({ kind, place, className }: { kind: SourceKind; place?: string; className?: string }) {
  const source = SOURCE[kind];
  return <Badge variant="outline" className={cn('gap-1', className)} data-source={kind}>
    <Icon name={source.icon} data-icon="inline-start" />{source.word}{place && <span className="text-ink-2">{place}</span>}
  </Badge>;
}

/** One of a fixed list of values (a laying template, the bonding of the sheaths) in a field of the form's width. */
export function ChoiceSelect({ value, options, onValueChange, label, id }: {
  value: string;
  options: { value: string; label: string }[];
  onValueChange?: (value: string) => void;
  label: string;
  id?: string;
}) {
  return <Select value={value} items={options} onValueChange={next => onValueChange?.(next as string)}>
    <SelectTrigger id={id} aria-label={label} className="w-full"><SelectValue /></SelectTrigger>
    <SelectContent>{options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
  </Select>;
}

/**
 * What a form needs said before the engineer acts on it, as a block in the flow: what a proposal does not claim, a row the
 * table had that is not imported. Plain text at the reading size; the attention tone only for what can go wrong.
 */
export function FormNote({ tone = 'info', title, children, className }: { tone?: 'info' | 'attention'; title?: ReactNode; children: ReactNode; className?: string }) {
  return <div role="note" className={cn('flex gap-3 rounded-card border px-4 py-3 text-sm text-ink',
    tone === 'attention' ? 'border-attention bg-attention-fill' : 'border-line bg-subtle', className)}>
    <span className="flex h-5 shrink-0 items-center"><Icon name={tone === 'attention' ? 'status/warning' : 'status/info'} className={tone === 'attention' ? 'text-attention-ink' : 'text-ink-2'} /></span>
    <div className="flex min-w-0 flex-col gap-1">
      {title && <span className="font-medium">{title}</span>}
      {children}
    </div>
  </div>;
}

/** Where a file is dropped or chosen: what it takes, and the button for those who do not drag. Copper while a file is over it. */
export function DropZone({ title, formats, dragging, action = '选择文件', className }: { title: string; formats: string; dragging?: boolean; action?: string; className?: string }) {
  return <div data-dragging={dragging || undefined}
    className={cn('flex h-56 flex-col items-center justify-center gap-3 rounded-card border border-dashed border-line-strong bg-canvas px-6 text-center transition-colors duration-fast data-dragging:border-copper data-dragging:bg-copper-fill', className)}>
    <span className="flex size-12 items-center justify-center rounded-full bg-surface text-ink-2 shadow-menu"><Icon name="action/import" className="size-6" /></span>
    <span className="flex flex-col gap-1">
      <span className="text-h3 text-ink">{title}</span>
      <span className="text-sm text-ink-2">{formats}</span>
    </span>
    <Button variant="outline">{action}</Button>
  </div>;
}
