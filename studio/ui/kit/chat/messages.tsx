// What people and the Agent say. The person's words sit on the right in a grey bubble; the Agent's words run in the
// column without a bubble, in 15 px prose, and its work appears as steps and cards between its sentences.
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

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
