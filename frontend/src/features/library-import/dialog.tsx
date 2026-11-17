import { useRef, type ReactNode } from 'react';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

/** A source table must open at its first row, with its title and close action visible. */
export function LibraryDialog({ open, onOpenChange, title, description, children, actions, initialFocus = 'form' }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string;
  children: ReactNode; actions?: ReactNode; initialFocus?: 'form' | 'preserve';
}) {
  const previousFocus = useRef<HTMLElement | null>(null);
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="library-import-dialog" {...(!description ? { 'aria-describedby': undefined } : {})}
      onOpenAutoFocus={event => {
        previousFocus.current = document.activeElement as HTMLElement;
        event.preventDefault();
        if (!(event.target instanceof HTMLElement)) return;
        const first = initialFocus === 'form' ? event.target.querySelector<HTMLElement>('input, [role="combobox"]') : null;
        (first || event.target).focus({ preventScroll: true });
      }}
      onCloseAutoFocus={event => {
        event.preventDefault();
        if (previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true });
      }}>
      <DialogHeader className="library-import-stack">
        <DialogTitle className="dialog-title">{title}</DialogTitle>
        {description && <DialogDescription className="muted">{description}</DialogDescription>}
      </DialogHeader>
      <div className="library-import-dialog-body">{children}</div>
      <DialogFooter>{actions}<DialogClose asChild><Button variant="ghost">关闭</Button></DialogClose></DialogFooter>
    </DialogContent>
  </Dialog>;
}
