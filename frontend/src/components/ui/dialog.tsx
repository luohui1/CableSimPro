import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useRef, type ReactNode, type ComponentProps } from "react";
import { Button } from "./button";
import { MotionReveal } from "@/components/motion";

function AppDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  actions,
  initialFocus = "action",
  variant = "dialog",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  actions?: ReactNode;
  initialFocus?: "action" | "form";
  variant?: "dialog" | "drawer";
}) {
  const previousFocus = useRef<HTMLElement | null>(null);
  const content = useRef<HTMLDivElement | null>(null);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal forceMount>
        <MotionReveal open={open} kind="drawer" className="dialog-stage">
          <DialogPrimitive.Overlay className="dialog-overlay" forceMount />
          <DialogPrimitive.Content
            forceMount
            ref={content}
            {...(!description ? { "aria-describedby": undefined } : {})}
            className={`dialog-content ${variant === "drawer" ? "record-drawer" : ""}`}
            onKeyDown={(event) => {
              const target =
                event.target instanceof HTMLElement ? event.target : null;
              if (
                event.key !== "Enter" ||
                event.defaultPrevented ||
                !target ||
                target.closest(
                  "button,textarea,[role=combobox],[role=option],form",
                )
              )
                return;
              const confirm = content.current?.querySelector<HTMLButtonElement>(
                ".dialog-actions .button-primary:not([disabled]),.dialog-actions .button-run:not([disabled])",
              );
              if (confirm) {
                event.preventDefault();
                confirm.click();
              }
            }}
            onOpenAutoFocus={(event) => {
              previousFocus.current = document.activeElement as HTMLElement;
              event.preventDefault();
              content.current
                ?.querySelector<HTMLElement>(
                  initialFocus === "form"
                    ? 'input, [role="combobox"], .data-row button:not([disabled]), .dialog-actions button:not([disabled])'
                    : ".dialog-actions button:not([disabled])",
                )
                ?.focus();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (previousFocus.current?.isConnected)
                previousFocus.current.focus();
            }}
          >
            <DialogPrimitive.Title className="dialog-title">
              {title}
            </DialogPrimitive.Title>
            {description && <DialogPrimitive.Description className="muted">
              {description}
            </DialogPrimitive.Description>}
            {children}
            <div className="dialog-actions">
              {actions}
              <DialogPrimitive.Close asChild>
                <Button variant="ghost">关闭</Button>
              </DialogPrimitive.Close>
            </div>
          </DialogPrimitive.Content>
        </MotionReveal>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function Dialog(props: ComponentProps<typeof AppDialog> | ComponentProps<typeof DialogPrimitive.Root>) {
  return 'title' in props ? <AppDialog {...props} /> : <DialogPrimitive.Root {...props} />;
}
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;
export function DialogContent({ className = '', children, ...props }: ComponentProps<typeof DialogPrimitive.Content> & { showCloseButton?: boolean }) {
  return <DialogPrimitive.Portal><div className="dialog-stage"><DialogPrimitive.Overlay className="dialog-overlay" /><DialogPrimitive.Content className={`dialog-content ${className}`} {...props}>{children}</DialogPrimitive.Content></div></DialogPrimitive.Portal>;
}
export function DialogHeader(props: ComponentProps<'div'>) { return <div {...props} />; }
export function DialogFooter(props: ComponentProps<'div'>) { return <div className="dialog-actions" {...props} />; }
