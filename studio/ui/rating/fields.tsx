// The few form parts the rating screens share, made of the base controls: a number with its unit inside the field, and a
// dialog that applies one change and says in its own place why it was refused.
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@/components/ui/input-group';
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

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return <div className="flex min-w-0 flex-col gap-1">
    <span className="text-sm text-ink-2">{label}</span>
    {children}
    {hint && <span className="text-sm text-ink-2">{hint}</span>}
  </div>;
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
  return <div className="flex min-w-0 flex-col gap-1">
    <label htmlFor={id} className="text-sm text-ink-2">{label}</label>
    <InputGroup>
      <InputGroupInput id={id} inputMode="decimal" autoComplete="off" autoFocus={autoFocus} value={value} placeholder={placeholder}
        aria-invalid={invalid || undefined} onChange={event => onChange(event.target.value)} />
      {unit && <InputGroupAddon align="inline-end"><InputGroupText>{unit}</InputGroupText></InputGroupAddon>}
    </InputGroup>
    {hint && <span className="text-sm text-ink-2">{hint}</span>}
  </div>;
}

/**
 * Applies one change from a dialog. `run` takes the changes in order and stops at the first the host refuses; the host's
 * words stay in the dialog. Nothing is asked of the host when there is nothing to change.
 */
export function useApply(onClose: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (steps: (() => Promise<string | null>)[]) => {
    setError(null);
    if (steps.length === 0) return onClose();
    setBusy(true);
    for (const step of steps) {
      const failure = await step();
      if (failure) {
        setBusy(false);
        setError(failure);
        return;
      }
    }
    setBusy(false);
    onClose();
  };
  return { busy, error, setError, run };
}

/** A dialog that holds one small form: a title, its fields, what went wrong, and the two ways out. */
export function FormDialog({ title, description, onClose, onSubmit, busy, error, applyLabel = '应用', wide, children }: {
  title: string;
  description?: string;
  onClose: () => void;
  onSubmit: () => void;
  busy?: boolean;
  error?: string | null;
  applyLabel?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className={wide ? 'max-w-2xl' : undefined}>
      <form onSubmit={submit} className="grid gap-4">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
        {error && <p role="alert" className="m-0 rounded-field bg-error-fill px-3 py-2 text-sm text-error">{error}</p>}
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>取消</DialogClose>
          <Button type="submit" disabled={busy}>{busy && <Spinner />}{applyLabel}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
