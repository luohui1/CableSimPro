// The few form parts the rating screens share, made of the base controls: a number with its unit inside the field, a choice
// with its title, and the two shells a small form lives in: a popover under the given it changes, and a dialog for the long
// choices. Both apply one change and say in their own place why the host refused it.
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { reportFailure } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldLabel, FieldTitle } from '@/components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@/components/ui/input-group';
import { PopoverDescription, PopoverHeader, PopoverTitle } from '@/components/ui/popover';
import { Spinner } from '@/kit/icon';
import { compact } from '@shared/format';

/** A number as the engineer typed it: null when the field is empty, NaN when it is not a number. */
export function parseNumber(text: string): number | null {
  const trimmed = text.trim().replace(',', '.');
  return trimmed === '' ? null : Number(trimmed);
}

/** The text a number field starts with. */
export const textOf = (value: number | null | undefined, digits = 6): string => (value === null || value === undefined ? '' : compact(value, digits));

/** The texts of a form's number fields, and which of them the engineer has touched. */
export function useTexts<K extends string>(initial: Record<K, string>) {
  const [texts, setTexts] = useState(initial);
  return {
    texts,
    set: (key: K) => (text: string) => setTexts(current => ({ ...current, [key]: text })),
    changed: (key: K) => texts[key] !== initial[key],
  };
}

/** A set of choices (a toggle group, a list) under a title. */
export function ChoiceField({ label, children }: { label: ReactNode; children: ReactNode }) {
  return <Field>
    <FieldTitle>{label}</FieldTitle>
    {children}
  </Field>;
}

/** A number field with its unit inside the border. The text belongs to the caller, who parses it when the form is applied. */
export function NumberField({ label, unit, value, onChange, placeholder, hint, invalid, autoFocus }: {
  label: string;
  unit?: string;
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
  hint?: ReactNode;
  invalid?: boolean;
  autoFocus?: boolean;
}) {
  const id = useId();
  return <Field>
    <FieldLabel htmlFor={id}>{label}</FieldLabel>
    <InputGroup>
      <InputGroupInput id={id} inputMode="decimal" autoComplete="off" autoFocus={autoFocus} value={value} placeholder={placeholder}
        aria-invalid={invalid || undefined} onChange={event => onChange(event.target.value)} />
      {unit && <InputGroupAddon align="inline-end"><InputGroupText>{unit}</InputGroupText></InputGroupAddon>}
    </InputGroup>
    {hint && <FieldDescription>{hint}</FieldDescription>}
  </Field>;
}

/**
 * Applies changes from a form. `run` takes them in order and stops at the first the host refuses; the host's words stay in
 * the form. Nothing is asked of the host when there is nothing to change.
 */
export function useApply(onClose: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A form closed while its change was on its way has nowhere to say that the host refused it: the notice says it.
  const open = useRef(true);
  useEffect(() => () => { open.current = false; }, []);
  const run = async (steps: (() => Promise<string | null>)[]) => {
    setError(null);
    if (steps.length === 0) return onClose();
    setBusy(true);
    for (const step of steps) {
      const failure = await step();
      if (failure) {
        setBusy(false);
        if (open.current) setError(failure);
        else reportFailure(new Error(failure));
        return;
      }
    }
    setBusy(false);
    onClose();
  };
  return { busy, error, setError, run };
}

interface FormProps {
  title: string;
  description?: string;
  onClose: () => void;
  onSubmit: () => void;
  busy?: boolean;
  error?: string | null;
  applyLabel?: string;
  children: ReactNode;
}

const submitting = (onSubmit: () => void) => (event: FormEvent) => {
  event.preventDefault();
  onSubmit();
};

/** The inside of a popover that holds one small form: a title, its fields, what went wrong, and the two ways out. */
export function PopoverForm({ title, description, onClose, onSubmit, busy, error, applyLabel = '应用', children }: FormProps) {
  return <form onSubmit={submitting(onSubmit)} className="flex flex-col gap-4">
    <PopoverHeader>
      <PopoverTitle className="text-h3">{title}</PopoverTitle>
      {description && <PopoverDescription>{description}</PopoverDescription>}
    </PopoverHeader>
    {children}
    {error && <FieldError>{error}</FieldError>}
    <div className="flex justify-end gap-2">
      <Button type="button" variant="outline" size="sm" onClick={onClose}>取消</Button>
      <Button type="submit" size="sm" disabled={busy}>{busy && <Spinner />}{applyLabel}</Button>
    </div>
  </form>;
}

/** A dialog that holds one form: for what needs the room (a table of cables) or a run of its own (a sweep). */
export function FormDialog({ title, description, onClose, onSubmit, busy, error, applyLabel = '应用', wide, children }: FormProps & { wide?: boolean }) {
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className={wide ? 'max-w-2xl' : undefined}>
      <form onSubmit={submitting(onSubmit)} className="grid gap-4">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
        {error && <FieldError>{error}</FieldError>}
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>取消</DialogClose>
          <Button type="submit" disabled={busy}>{busy && <Spinner />}{applyLabel}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
