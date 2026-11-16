// A panel docked at the right of a workbench screen for editing what the screen shows (the givens of a calculation): it
// takes the place of the panel there, keeps the drawing in view, and ends in the one action that applies the edit.
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Icon } from '../icon';

export function SideEditor({ title, tools, onClose, children, footer, className }: {
  title: ReactNode;
  /** Header tools before the close: undo and redo of the edits not yet applied. */
  tools?: ReactNode;
  onClose?: () => void;
  children: ReactNode;
  footer: ReactNode;
  className?: string;
}) {
  return <section aria-label={typeof title === 'string' ? title : undefined} className={cn('flex w-96 flex-none flex-col border-l border-line bg-surface', className)}>
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line pr-2 pl-4">
      <h2 className="m-0 min-w-0 flex-1 truncate text-h3 text-ink">{title}</h2>
      {tools}
      <Button variant="ghost" size="icon-sm" aria-label="关闭" onClick={onClose}><Icon name="action/close" /></Button>
    </header>
    <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-4 py-4">{children}</div>
    <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-4 py-3">{footer}</footer>
  </section>;
}

/** A group of fields in the side editor: its name, then its rows. */
export function SideEditorSection({ title, children }: { title: ReactNode; children: ReactNode }) {
  return <section className="flex flex-col gap-3">
    <h3 className="m-0 text-h3 text-ink">{title}</h3>
    <div className="flex flex-col gap-3">{children}</div>
  </section>;
}
