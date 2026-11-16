// The run records of a project, in a row under its header: number, kind and what was asked, oldest first, so a new run
// appears at the end. The one shown is selected. A project collects runs without end, so the row scrolls sideways and
// fades at its edge rather than wrapping; a run the agent made carries the agent's dot, a run made before the inputs last
// changed carries the attention dot, and its tooltip says why.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Dot } from '../marks';

export interface RunItem {
  id: string;
  sequence: number;
  /** The run's title as the host writes it: "<kind> · <what>", e.g. 扫描 · 土壤热阻率 0.8–3 K·m/W. */
  title: string;
  by?: 'human' | 'agent';
  /** The project's inputs changed after this run was made: it no longer stands for the project as it is. */
  stale?: boolean;
  /** The method gave no result: the run is kept, with its error, and marked. */
  status?: 'succeeded' | 'failed';
}

function split(title: string) {
  const at = title.indexOf(' · ');
  return at < 0 ? { kind: '', what: title } : { kind: title.slice(0, at), what: title.slice(at + 3) };
}

export function RunRail({ runs, active, onOpen, end, className }: {
  runs: RunItem[];
  active?: string;
  onOpen?: (id: string) => void;
  /** After the row: the way to the whole list or to a new run. */
  end?: ReactNode;
  className?: string;
}) {
  const ordered = [...runs].sort((a, b) => a.sequence - b.sequence);
  const list = useRef<HTMLOListElement>(null);
  const [more, setMore] = useState(false);
  // The selected run in view, or the newest one (at the end) when none is; the fade only while runs are hidden beyond it.
  useEffect(() => {
    const node = list.current;
    if (!node) return;
    const update = () => setMore(node.scrollLeft + node.clientWidth < node.scrollWidth - 1);
    const current = node.querySelector<HTMLElement>('[aria-current="true"]');
    if (current) node.scrollLeft = Math.max(0, current.offsetLeft + current.offsetWidth - node.clientWidth);
    else node.scrollLeft = node.scrollWidth;
    update();
    node.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => { node.removeEventListener('scroll', update); observer.disconnect(); };
  }, [active, runs.length]);
  return <nav aria-label="运行记录" className={cn('flex h-12 shrink-0 items-center gap-3 border-b border-line px-6', className)}>
    <span className="shrink-0 text-sm text-ink-2">运行记录</span>
    <ol ref={list} className={cn('m-0 flex min-w-0 flex-1 list-none items-center gap-1 overflow-x-auto p-0 scrollbar-none', more && 'fade-end')}>
      {ordered.map(run => {
        const { kind, what } = split(run.title);
        const current = run.id === active;
        const chip = <button type="button" onClick={() => onOpen?.(run.id)} aria-current={current ? 'true' : undefined}
          className={cn('flex h-8 max-w-80 shrink-0 items-center gap-2 rounded-field px-3 text-sm whitespace-nowrap outline-none transition-colors duration-fast hover:bg-hover focus-visible:ring-3 focus-visible:ring-ring',
            current ? 'bg-subtle text-ink ring-1 ring-line-strong ring-inset' : 'text-ink-2')}>
          <span className="shrink-0 tabular-nums">#{run.sequence}</span>
          {kind && <span className="shrink-0">{kind}</span>}
          <span className={cn('truncate', current && 'font-medium')}>{what}</span>
          {run.status === 'failed' && <Dot tone="error" />}
          {run.by === 'agent' && <Dot tone="agent" />}
          {run.stale && <Dot tone="attention" />}
        </button>;
        const notes = [run.status === 'failed' && '方法没有给出结果', run.by === 'agent' && 'Agent 算的', run.stale && '算这条记录之后输入改过，它不代表现在的工程'].filter(Boolean);
        return <li key={run.id} className="shrink-0">
          {notes.length
            ? <Tooltip>
              <TooltipTrigger render={chip} />
              <TooltipContent>{notes.join('；')}</TooltipContent>
            </Tooltip>
            : chip}
        </li>;
      })}
    </ol>
    {end && <div className="flex shrink-0 items-center gap-2">{end}</div>}
  </nav>;
}
