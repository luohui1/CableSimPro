// The top of a workbench screen and the flat panels under it. A screen has one header with one primary button (the next
// step); under it, panels tile edge to edge and are separated by lines, never boxed inside one another.
import type { ReactNode } from 'react';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { cn } from '@/lib/utils';

export function PageHeader({ trail, title, marks, primary, actions, className }: {
  /** Where the object sits: 型号库 / 人民电缆集团 YJV22-8.7/15 kV 三芯. The title follows under it. */
  trail?: { label: string; onClick?: () => void }[];
  title: ReactNode;
  /** Marks beside the title: version, review state, trust. */
  marks?: ReactNode;
  /** The one copper button: the next step on this screen. */
  primary?: ReactNode;
  /** Quiet buttons before it. */
  actions?: ReactNode;
  className?: string;
}) {
  return <header className={cn('flex min-h-16 shrink-0 items-center gap-4 border-b border-line px-6 py-3', className)}>
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      {trail && trail.length > 0 && <Breadcrumb>
        <BreadcrumbList>
          {trail.map((step, index) => <span key={step.label} className="contents">
            {index > 0 && <BreadcrumbSeparator />}
            <BreadcrumbItem><BreadcrumbLink render={<button type="button" onClick={step.onClick} />}>{step.label}</BreadcrumbLink></BreadcrumbItem>
          </span>)}
        </BreadcrumbList>
      </Breadcrumb>}
      <div className="flex min-w-0 items-center gap-3">
        <h1 className="m-0 min-w-0 truncate text-h1 text-ink">{title}</h1>
        {marks && <div className="flex shrink-0 items-center gap-2">{marks}</div>}
      </div>
    </div>
    {(actions || primary) && <div className="flex shrink-0 items-center gap-2">{actions}{primary}</div>}
  </header>;
}

/** A flat region of the screen with its own header line (title, tabs or tools) and a scrolling body. */
export function Panel({ title, tools, children, className, bodyClassName }: {
  title?: ReactNode;
  tools?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return <section className={cn('flex min-h-0 min-w-0 flex-1 flex-col bg-surface', className)}>
    {(title || tools) && <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line px-4">
      {typeof title === 'string' ? <h2 className="m-0 min-w-0 flex-1 truncate text-h3 text-ink">{title}</h2> : <div className="min-w-0 flex-1">{title}</div>}
      {tools && <div className="flex shrink-0 items-center gap-1">{tools}</div>}
    </header>}
    <div className={cn('min-h-0 flex-1 overflow-auto', bodyClassName)}>{children}</div>
  </section>;
}

/** Panels side by side (or stacked) with a draggable line between them; sizes in percent of the row. */
export function Split({ panes, direction = 'horizontal', className }: {
  panes: { id: string; size: number; min?: number; children: ReactNode }[];
  direction?: 'horizontal' | 'vertical';
  className?: string;
}) {
  return <ResizablePanelGroup orientation={direction} className={cn('min-h-0 flex-1', className)}>
    {panes.map((pane, index) => <span key={pane.id} className="contents">
      {index > 0 && <ResizableHandle />}
      <ResizablePanel id={pane.id} defaultSize={`${pane.size}%`} minSize={pane.min ? `${pane.min}%` : undefined} className="flex min-h-0 min-w-0 flex-col">{pane.children}</ResizablePanel>
    </span>)}
  </ResizablePanelGroup>;
}

/** A row of filters and tools above a table. */
export function Toolbar({ children, end, className }: { children: ReactNode; end?: ReactNode; className?: string }) {
  return <div className={cn('flex h-12 shrink-0 items-center gap-2 border-b border-line px-4', className)}>
    {children}
    {end && <div className="ml-auto flex items-center gap-2">{end}</div>}
  </div>;
}
