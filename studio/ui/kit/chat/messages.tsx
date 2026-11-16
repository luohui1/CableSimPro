// What people and the Agent say. The person's words sit on the right in a grey bubble; the Agent's words run in the
// column without a bubble, in 15 px prose, and its work appears as steps and cards between its sentences.
import { useLayoutEffect, useRef, type ComponentProps, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** The scrolling area of a conversation: what scrolls under its top edge fades in. For ThreadPrimitive.Viewport's className. */
export const threadViewportClass = 'flex min-h-0 flex-1 flex-col overflow-y-auto fade-top';

/**
 * A finished conversation opens with its last turn at the top of the view: the ask, then what came of it, nothing cut off
 * above. Mark where each turn starts with `data-turn-start`; put `TurnSpacer` after the last turn, so a short last turn can
 * still reach the top. The ref goes on the scrolling element (with assistant-ui, the Viewport), which must be positioned.
 */
export function useLastTurnAtTop<T extends HTMLElement>() {
  const viewport = useRef<T>(null);
  useLayoutEffect(() => {
    const node = viewport.current;
    const starts = node?.querySelectorAll<HTMLElement>('[data-turn-start]');
    const last = starts?.[starts.length - 1];
    if (node && last) node.scrollTop = Math.max(0, last.offsetTop - 24);
  }, []);
  return viewport;
}

/** The room after the last turn that lets it sit at the top of the view; it grows and shrinks with the view. */
export function TurnSpacer() {
  const spacer = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = spacer.current;
    const viewport = node?.offsetParent as HTMLElement | null;
    if (!node || !viewport) return;
    const fit = () => {
      const starts = viewport.querySelectorAll<HTMLElement>('[data-turn-start]');
      const last = starts[starts.length - 1];
      node.style.height = last ? `${Math.max(0, viewport.clientHeight - (node.offsetTop - last.offsetTop) - 48)}px` : '0px';
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);
  return <div ref={spacer} aria-hidden="true" />;
}

/** The conversation column: one measure for messages, cards and the composer. */
export function ThreadColumn({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('mx-auto flex w-full max-w-thread flex-col px-6', className)} {...props} />;
}

export function UserMessage({ children, attachments, className }: { children: ReactNode; attachments?: ReactNode; className?: string }) {
  return <div data-role="user" className={cn('flex flex-col items-end gap-2 pl-16', className)}>
    {attachments && <div className="flex flex-wrap justify-end gap-2">{attachments}</div>}
    <div className="rounded-2xl bg-subtle px-4 py-2 text-prose wrap-break-word text-ink">{children}</div>
  </div>;
}

/** The Agent's turn: text, steps and cards in the order they happened. */
export function AssistantMessage({ children, className }: { children: ReactNode; className?: string }) {
  return <div data-role="assistant" className={cn('flex min-w-0 flex-col gap-4', className)}>{children}</div>;
}

/** The Agent is still writing: three dots that breathe in turn, at the end of what has come so far. */
export function Typing({ className }: { className?: string }) {
  return <span role="status" aria-label="Agent 正在回答" className={cn('inline-flex h-6 items-center gap-1', className)}>
    {['', 'animation-delay-150', 'animation-delay-300'].map(delay => <span key={delay} className={cn('size-1.5 animate-pulse rounded-full bg-ink-2 motion-reduce:animate-none', delay)} />)}
  </span>;
}

/** The end of an answer that is still arriving: a caret after the last word. Inline, inside the last paragraph. */
export function StreamCaret({ className }: { className?: string }) {
  return <span aria-hidden="true"
    className={cn('ml-1 inline-block h-4 w-0.5 animate-pulse rounded-full bg-ink align-middle motion-reduce:animate-none', className)} />;
}

/**
 * Markdown as the Agent writes it. Paragraphs and lists only; numbers in tabular figures. Wrap assistant-ui's
 * MarkdownTextPrimitive in it, or any rendered markdown.
 */
export function Prose({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn(
    'text-prose wrap-break-word text-ink',
    '[&_p]:m-0 [&_p+p]:mt-3 [&_p+ul]:mt-2 [&_ul+p]:mt-3 [&_ol]:my-0 [&_ul]:my-0 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5',
    '[&_li]:pl-1 [&_li+li]:mt-1 [&_li::marker]:text-ink-3 [&_strong]:font-semibold [&_a]:text-copper [&_a]:underline-offset-4 [&_a:hover]:underline',
    '[&_code]:rounded-sm [&_code]:bg-subtle [&_code]:px-1 [&_code]:font-mono [&_code]:text-sm',
    className,
  )} {...props} />;
}
