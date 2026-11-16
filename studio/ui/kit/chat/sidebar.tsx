// The conversation list of Agent mode: a new conversation, a search, and the conversations grouped by when they were last
// used (今天, 昨天, 近 7 天, 更早). Parts take any props, so assistant-ui's list primitives can render them.
import type { ComponentProps, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { cn } from '@/lib/utils';
import { Icon, Spinner } from '../icon';

export function ChatSidebar({ header, children, className }: { header: ReactNode; children: ReactNode; className?: string }) {
  return <nav aria-label="对话" className={cn('flex h-full min-h-0 flex-col', className)}>
    <div className="flex flex-col gap-2 px-3 pt-1 pb-3">{header}</div>
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pb-4">{children}</div>
  </nav>;
}

export function NewChatButton(props: ComponentProps<typeof Button>) {
  return <Button variant="outline" className="w-full justify-start bg-surface" {...props}>
    <Icon name="action/add" data-icon="inline-start" />新对话
  </Button>;
}

export function ChatSearch({ className, ...props }: ComponentProps<'input'>) {
  return <InputGroup className={cn('h-8 bg-transparent', className)}>
    <InputGroupAddon><Icon name="action/search" /></InputGroupAddon>
    <InputGroupInput type="search" placeholder="搜索对话" aria-label="搜索对话" {...props} />
  </InputGroup>;
}

export function ChatGroup({ label, children }: { label: string; children: ReactNode }) {
  return <section className="flex flex-col gap-1" aria-label={label}>
    <h2 className="m-0 px-3 py-1 text-xs font-medium text-ink-2">{label}</h2>
    <ul className="m-0 flex list-none flex-col gap-1 p-0">{children}</ul>
  </section>;
}

/** One conversation. The open one takes the selection fill (copper, faint). Running: a spinner at the end. */
export function ChatItem({ title, active, running, className, ...props }: { title: string; active?: boolean; running?: boolean } & ComponentProps<'button'>) {
  return <li className="list-none">
    <button type="button" data-active={active || undefined} aria-current={active ? 'page' : undefined} title={title}
      className={cn('flex h-9 w-full min-w-0 items-center gap-2 rounded-nav px-3 text-left text-sm text-ink transition-colors duration-fast outline-none hover:bg-hover focus-visible:ring-3 focus-visible:ring-ring data-active:bg-copper-fill data-active:font-medium', className)}
      {...props}>
      <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap fade-end">{title}</span>
      {running && <Spinner className="text-ink-2" />}
    </button>
  </li>;
}
