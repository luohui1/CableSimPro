import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useRef, type ReactNode } from 'react';
import { Button } from './button';
import { MotionReveal } from '@/components/motion';
import { canConfirmDialog, composing } from '@/lib/ui-interactions';

export function Dialog({ open, onOpenChange, title, description, children, actions, initialFocus = 'action', variant = 'dialog' }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string; children?: ReactNode; actions?: ReactNode; initialFocus?: 'action' | 'form'; variant?: 'dialog' | 'drawer';
}) {
  const previousFocus = useRef<HTMLElement | null>(null), content = useRef<HTMLDivElement | null>(null);
  return <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
    <DialogPrimitive.Portal forceMount>
      <MotionReveal open={open} kind="drawer" className="dialog-stage">
        <DialogPrimitive.Overlay className="dialog-overlay" forceMount />
        <DialogPrimitive.Content forceMount ref={content} data-ui-polish="true" {...(!description ? { 'aria-describedby': undefined } : {})} className={`dialog-content ${variant === 'drawer' ? 'record-drawer' : ''}`}
          onEscapeKeyDown={event => {
            // Radix handles Escape before React's bubbling field handler. Let a dirty
            // numeric editor cancel its own text first, instead of losing the dialog.
            const target = document.activeElement;
            if (composing(event) || target instanceof HTMLInputElement && !!target.closest('.number-input.is-dirty')) event.preventDefault();
          }}
          onKeyDown={event => {
            const target = event.target instanceof HTMLInputElement ? event.target : null;
            if (!canConfirmDialog({ key: event.key, defaultPrevented: event.defaultPrevented, composing: composing(event.nativeEvent), inputType: target?.type ?? null, insideForm: !!target?.closest('form') })) return;
            if (target?.getAttribute('aria-invalid') === 'true' || (target && !target.checkValidity())) { event.preventDefault(); return; }
            const confirm = content.current?.querySelector<HTMLButtonElement>('.dialog-actions .button-primary:not([disabled]),.dialog-actions .button-run:not([disabled])');
            if (confirm) { event.preventDefault(); confirm.click(); }
          }}
          onOpenAutoFocus={event => {
            previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            event.preventDefault();
            const selector = initialFocus === 'form'
              ? 'input:not([disabled]):not([readonly]):not([type="hidden"]),textarea:not([disabled]):not([readonly]),select:not([disabled]),[role="combobox"]:not([aria-disabled="true"]),.data-row button:not([disabled]),.dialog-actions button:not([disabled])'
              : '.dialog-actions button:not([disabled])';
            const first = Array.from(content.current?.querySelectorAll<HTMLElement>(selector) || []).find(element => element.getClientRects().length > 0 && !element.closest('[hidden],[inert],[aria-hidden="true"]'));
            (first || content.current)?.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={event => { event.preventDefault(); if (previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true }); }}>
          <header className="dialog-heading"><DialogPrimitive.Title className="dialog-title">{title}</DialogPrimitive.Title>{description && <DialogPrimitive.Description className="muted">{description}</DialogPrimitive.Description>}</header>
          <div className="dialog-body">{children}</div>
          <div className="dialog-actions">{actions}<DialogPrimitive.Close asChild><Button variant="ghost">关闭</Button></DialogPrimitive.Close></div>
        </DialogPrimitive.Content>
      </MotionReveal>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}
