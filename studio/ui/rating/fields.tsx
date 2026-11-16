// The one form shell the rating screens share: a dialog that holds a form (a table of cables to choose from, a sweep to set
// up), says in its own place why the host refused it, and has the two ways out.
import type { FormEvent, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FieldError } from '@/components/ui/field';
import { Spinner } from '@/kit/icon';

export function FormDialog({ title, description, onClose, onSubmit, busy, error, applyLabel = '应用', wide, children }: {
  title: string;
  description?: string;
  onClose: () => void;
  onSubmit: () => void;
  busy?: boolean;
  error?: string | null;
  applyLabel?: string;
  /** Room for a table. */
  wide?: boolean;
  children: ReactNode;
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className={wide ? 'max-w-3xl' : undefined}>
      <form onSubmit={submit} className="grid gap-4">
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
