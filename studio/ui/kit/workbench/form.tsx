// Forms of the workbench: a titled section of rows, each row a label, its control and (only when it helps) a hint; numbers
// with their unit inside the field; a choice among a few options as cards; where a value came from as a tag.
import type { ComponentProps, ReactNode } from 'react';
import { useDropzone } from 'react-dropzone';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { NumberField, NumberFieldAddon, NumberFieldGroup, NumberFieldInput } from '@/components/ui/number-field';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { Icon } from '../icon';
import { Dot } from '../marks';
import { Spinner } from '../icon';

export function FormSection({ title, description, aside, split, children, className }: {
  title: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  /** Title, description and aside in a column on the left, the fields on the right: a page of settings. */
  split?: boolean;
  children: ReactNode;
  className?: string;
}) {
  if (split) return <section className={cn('flex gap-10', className)}>
    <header className="flex w-64 shrink-0 flex-col items-start gap-2">
      <h2 className="m-0 text-h2 text-ink">{title}</h2>
      {description && <p className="m-0 text-sm text-ink-2">{description}</p>}
      {aside}
    </header>
    <div className="flex min-w-0 flex-1 flex-col gap-3">{children}</div>
  </section>;
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

/** One field: the label on the left, the control on the right; a dot when it changed since the last run. `wide` for long names. */
export function FormRow({ label, hint, changed, htmlFor, wide, children, className }: {
  label: ReactNode;
  hint?: ReactNode;
  changed?: boolean;
  htmlFor?: string;
  wide?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return <Field orientation="horizontal" className={cn('grid items-start gap-x-4 gap-y-1', wide ? 'grid-cols-label-wide' : 'grid-cols-label', className)}>
    <FieldLabel htmlFor={htmlFor} className="min-h-8 min-w-0 items-center font-normal text-ink-2">
      <span className="truncate">{label}</span>
      {changed && <Dot tone="attention" />}
    </FieldLabel>
    <div className="min-w-0">{children}</div>
    {hint && <FieldDescription className="col-start-2">{hint}</FieldDescription>}
  </Field>;
}

/**
 * A number with its unit inside the field (Base UI NumberField): the field parses and formats it, right-aligned in tabular
 * figures; `prefix` names it when several share a row (U₀, U, Um). Controlled with `value` / `onValueChange` (null when
 * empty), or left alone with `defaultValue`.
 */
export function UnitInput({ unit, prefix, value, defaultValue, onValueChange, min, max, step = 'any', id, name, disabled, className, ...input }: {
  /** Left out for a pure number (a coefficient); its place stays, so the numbers of a section still line up. */
  unit?: string;
  prefix?: string;
  value?: number | null;
  defaultValue?: number | string;
  onValueChange?: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number | 'any';
  id?: string;
  name?: string;
  disabled?: boolean;
  className?: string;
} & Pick<ComponentProps<'input'>, 'aria-label' | 'aria-invalid' | 'aria-describedby' | 'placeholder'>) {
  return <NumberField id={id} name={name} value={value} defaultValue={defaultValue === undefined ? undefined : Number(defaultValue)}
    onValueChange={next => onValueChange?.(next)} min={min} max={max} step={step} disabled={disabled} className={cn('w-full', className)}>
    <NumberFieldGroup>
      {prefix && <NumberFieldAddon className="pl-3">{prefix}</NumberFieldAddon>}
      <NumberFieldInput {...input} />
      <NumberFieldAddon className="w-16 pr-3" aria-hidden={unit ? undefined : true}>{unit}</NumberFieldAddon>
    </NumberFieldGroup>
  </NumberField>;
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
    {options.map(option => <label key={option.value} data-checked={option.value === value || undefined} data-disabled={option.disabled || undefined}
      className="flex min-w-0 cursor-pointer items-start gap-3 rounded-card border border-line bg-surface px-3 py-3 transition-colors duration-fast hover:bg-subtle data-checked:border-copper data-checked:bg-copper-fill data-disabled:cursor-not-allowed data-disabled:bg-subtle data-disabled:text-ink-2">
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

/** Where a value came from: the kind as an icon and a word, and the place (表 7 · PDF 第 15 页). A kind the page does not
 *  know yet is shown by its own name with a neutral icon. */
export function SourceTag({ kind, place, className }: { kind: SourceKind | (string & {}); place?: string; className?: string }) {
  const source = SOURCE[kind as SourceKind] ?? { icon: 'status/info', word: kind };
  return <Badge variant="outline" className={cn('gap-1', className)} data-source={kind}>
    <Icon name={source.icon} data-icon="inline-start" />{source.word}{place && <span className="text-ink-2">{place}</span>}
  </Badge>;
}

/** One of a fixed list of values (a laying template, the bonding of the sheaths) in a field of the form's width. */
export function ChoiceSelect({ value, options, onValueChange, label, id, size }: {
  value: string;
  options: { value: string; label: string }[];
  onValueChange?: (value: string) => void;
  label: string;
  id?: string;
  /** `sm` inside a table row. */
  size?: 'sm' | 'default';
}) {
  return <Select value={value} items={options} onValueChange={next => onValueChange?.(next as string)}>
    <SelectTrigger id={id} aria-label={label} size={size} className="w-full"><SelectValue /></SelectTrigger>
    <SelectContent>{options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
  </Select>;
}

/**
 * What a form needs said before the engineer acts on it, as a block in the flow: what a proposal does not claim, a row the
 * table had that is not imported. Plain text at the reading size; the attention tone only for what can go wrong.
 */
export function FormNote({ tone = 'info', title, children, className }: { tone?: 'info' | 'attention'; title?: ReactNode; children: ReactNode; className?: string }) {
  return <Alert role="note" variant={tone === 'attention' ? 'attention' : 'note'} className={cn('gap-y-1 rounded-card px-4 py-3 has-[>svg]:gap-x-3', className)}>
    <Icon name={tone === 'attention' ? 'status/warning' : 'status/info'} />
    {title && <AlertTitle>{title}</AlertTitle>}
    <AlertDescription className="text-ink">{children}</AlertDescription>
  </Alert>;
}

/** The structure tables the host reads (tables.py: .xlsx, .xlsm, .xls, .csv), as react-dropzone takes them. */
export const TABLE_FILES: Record<string, string[]> = {
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.ms-excel.sheet.macroEnabled.12': ['.xlsm'],
  'application/vnd.ms-excel': ['.xls'],
  'text/csv': ['.csv'],
};

/**
 * Where a file is dropped or chosen (react-dropzone): what it takes, and the button for those who do not drag. Copper
 * while a file is over it. `onFiles` gets what was accepted, `onRejected` the names of what was not; `dragging` forces
 * the look (the gallery shows the state with it). `compact`: one row under a composer, not a block.
 */
export function DropZone({ title, formats, accept = TABLE_FILES, onFiles, onRejected, dragging, action = '选择文件', compact, className }: {
  title: string;
  formats: string;
  accept?: Record<string, string[]>;
  onFiles?: (files: File[]) => void;
  onRejected?: (names: string[]) => void;
  dragging?: boolean;
  action?: string;
  compact?: boolean;
  className?: string;
}) {
  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    accept, multiple: false, noClick: true, noKeyboard: true,
    onDropAccepted: files => onFiles?.(files),
    onDropRejected: rejections => onRejected?.(rejections.map(rejection => rejection.file.name)),
  });
  return <div {...getRootProps()} data-dragging={(dragging ?? isDragActive) || undefined}
    className={cn(compact
      ? 'flex h-14 items-center gap-3 rounded-card border border-line bg-canvas px-4 transition-colors duration-fast data-dragging:border-copper data-dragging:bg-copper-fill'
      : 'flex h-56 flex-col items-center justify-center gap-3 rounded-card border border-dashed border-line-strong bg-canvas px-6 text-center transition-colors duration-fast data-dragging:border-copper data-dragging:bg-copper-fill', className)}>
    <input {...getInputProps()} />
    {compact
      ? <>
        <Icon name="action/import" className="shrink-0 text-ink-2" />
        <span className="flex min-w-0 flex-1 items-baseline gap-2"><span className="text-sm font-medium text-ink">{title}</span><span className="truncate text-sm text-ink-2">{formats}</span></span>
        <Button variant="outline" size="sm" onClick={open}>{action}</Button>
      </>
      : <>
        <span className="flex size-12 items-center justify-center rounded-full bg-surface text-ink-2 shadow-menu"><Icon name="action/import" className="size-6" /></span>
        <span className="flex flex-col gap-1">
          <span className="text-h3 text-ink">{title}</span>
          <span className="text-sm text-ink-2">{formats}</span>
        </span>
        <Button variant="outline" onClick={open}>{action}</Button>
      </>}
  </div>;
}

/** A few short, mutually exclusive words in one row (单芯 / 三芯, 从零填写 / 按标准生成): the segmented look of the theme. */
export function Segmented({ label, value, options, onValueChange, floating, className }: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onValueChange?: (value: string) => void;
  /** Over a drawing: with the menu shadow. */
  floating?: boolean;
  className?: string;
}) {
  return <ToggleGroup value={[value]} onValueChange={next => next[0] && onValueChange?.(next[0] as string)} aria-label={label}
    className={cn('rounded-lg border border-line bg-surface p-1', floating && 'shadow-menu', className)}>
    {options.map(option => <ToggleGroupItem key={option.value} value={option.value}>{option.label}</ToggleGroupItem>)}
  </ToggleGroup>;
}

/** A value the page shows but does not change (it comes from the environment): in a field's box, on the light fill. */
export function ReadonlyValue({ children, empty, className }: { children?: ReactNode; empty?: boolean; className?: string }) {
  return <div className={cn('flex h-9 min-w-0 items-center rounded-field bg-subtle px-3 text-sm', empty ? 'text-ink-2' : 'text-ink', className)}>
    <span className="truncate">{empty ? '—' : children}</span>
  </div>;
}

export type ConnectionState = 'idle' | 'checking' | 'ok' | 'failed';

/** Whether a service answers: the state in a word with its dot, the host's own message when it does not, and the check. */
export function ConnectionCheck({ state, when, error, onCheck, disabled }: {
  state: ConnectionState;
  /** When the last check was made, as the page writes times. */
  when?: string;
  /** The message the host gave when the check failed, word for word. */
  error?: string;
  onCheck?: () => void;
  disabled?: boolean;
}) {
  const word = { idle: '还没检查', checking: '正在检查', ok: '连通', failed: '连不上' }[state];
  return <div className="flex min-w-0 flex-col gap-2">
    <div className="flex min-h-9 flex-wrap items-center gap-3">
      <span className="flex items-center gap-2 text-sm text-ink" role="status">
        {state === 'checking' ? <Spinner /> : <Dot tone={state === 'ok' ? 'success' : state === 'failed' ? 'error' : 'ink'} />}
        {word}
        {when && state !== 'checking' && state !== 'idle' && <span className="text-ink-2 tabular-nums">{when}</span>}
      </span>
      <Button variant="outline" size="sm" onClick={onCheck} disabled={disabled || state === 'checking'}>{state === 'idle' ? '检查连通' : '再检查'}</Button>
    </div>
    {state === 'failed' && error && <p className="m-0 text-sm text-error">{error}</p>}
  </div>;
}
