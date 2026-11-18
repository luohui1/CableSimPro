import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Children, isValidElement, useRef, type ReactNode, type ComponentProps } from "react";
import { Button, IconButton } from "./button";
import { MotionReveal } from "@/components/motion";
import { ErrorState } from '@/components/states';
import { InformationNotice } from '@/components/information-notice';
import { isResultInformation } from '@/lib/notice-level';

function availableFocus(node: HTMLElement | null): node is HTMLElement {
  return !!node?.isConnected && !node.matches(':disabled,[aria-disabled="true"],[type="hidden"]')
    && !node.closest('[hidden],[inert],[aria-hidden="true"]') && node.getClientRects().length > 0
    && !['hidden', 'collapse'].includes(getComputedStyle(node).visibility)
    && getComputedStyle(node).opacity !== '0';
}

function AppDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  actions,
  initialFocus = "action",
  fallbackFocus,
  variant = "dialog",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  actions?: ReactNode;
  initialFocus?: "action" | "form" | "preserve";
  fallbackFocus?: () => HTMLElement | null;
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
                // Enter can confirm an IME candidate before it is a form action.
                // Some engines report the final composition key as 229 after
                // isComposing has already cleared; leave both events to the IME.
                event.nativeEvent.isComposing ||
                event.nativeEvent.keyCode === 229 ||
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
              // A deferred dialog's loading shell retains the opener until the real
              // form mounts, so swapping shells does not capture a discarded button.
              if (initialFocus === "preserve") return;
              const candidates = content.current
                ?.querySelectorAll<HTMLElement>(
                  initialFocus === "form"
                    ? 'input, textarea, select, [role="combobox"], .data-row button, .dialog-actions button'
                    : ".dialog-actions button:not([disabled])",
                );
              const first = [...(candidates || [])].find(node => node.tabIndex >= 0 && availableFocus(node));
              (first || content.current?.querySelector<HTMLElement>('.drawer-close') || content.current)?.focus();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const target = availableFocus(previousFocus.current) ? previousFocus.current : fallbackFocus?.();
              if (target && availableFocus(target)) target.focus();
            }}
          >
            {variant === 'drawer' && <DialogPrimitive.Close asChild><IconButton variant="ghost" icon="action/close" label="关闭运行记录" className="drawer-close" /></DialogPrimitive.Close>}
            <DialogPrimitive.Title className="dialog-title">
              {title}
            </DialogPrimitive.Title>
            {description && <DialogPrimitive.Description className="muted">
              {description}
            </DialogPrimitive.Description>}
            {children}
            <div className="dialog-actions">
              {actions}
              {variant !== 'drawer' && <DialogPrimitive.Close asChild>
                <Button variant="ghost">关闭</Button>
              </DialogPrimitive.Close>}
            </div>
          </DialogPrimitive.Content>
        </MotionReveal>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function Dialog(props: ComponentProps<typeof AppDialog> | ComponentProps<typeof DialogPrimitive.Root>) {
  // Compatibility for existing notice wrappers. Only this verified informational
  // message, without an action, becomes non-modal; genuine errors stay blocking.
  if ('title' in props && !props.actions) {
    const children = Children.toArray(props.children);
    const child = children.length === 1 ? children[0] : null;
    if (isValidElement<ComponentProps<typeof ErrorState>>(child) && child.type === ErrorState &&
        !child.props.action && isResultInformation(child.props.description))
      return props.open ? <InformationNotice title="方法说明更新" description={child.props.description}
        floating onDismiss={() => props.onOpenChange(false)} /> : null;
  }
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
