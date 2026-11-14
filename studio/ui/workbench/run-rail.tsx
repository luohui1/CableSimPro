// The bottom rail: the run records of the project, in order, and where the pointer is on the section.
import { Tip } from '@/components/tooltip';
import { cn } from '@/lib/cn';
import { useView } from '@/state/view';
import { fixed, KIND_NAMES } from '@shared/format';
import type { RunHeader } from '@shared/types';

export function RunRail({ runs, active, current, draft, onOpen }: {
  runs: RunHeader[];
  active: string | undefined;
  /** Digest of the project's inputs now. */
  current: string;
  /** The unkept result for the present inputs, when that is what is shown. */
  draft: { label: string; computing: boolean } | null;
  onOpen: (run?: string) => void;
}) {
  const cursor = useView(state => state.cursor);
  const ordered = [...runs].sort((a, b) => a.sequence - b.sequence);
  return <div className="flex h-12 shrink-0 items-center gap-4 border-t border-line px-3">
    <span className="shrink-0 text-13 text-ink-2">运行记录</span>
    <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
      {ordered.length === 0 && !draft && <span className="text-14 text-ink-2">还没有</span>}
      {ordered.map(run => {
        const stale = run.inputs_sha256 !== current;
        // The title is "<kind> · <what>"; the kind is shown once, as a word.
        const what = run.title.includes(' · ') ? run.title.slice(run.title.indexOf(' · ') + 3) : run.title;
        return <Tip key={run.id} label={stale ? '算这条记录之后输入改过，它不代表现在的工程' : run.title}>
          <button type="button" onClick={() => onOpen(run.id)} aria-current={run.id === active}
            className={cn('flex h-8 max-w-72 shrink-0 items-center gap-2 rounded-field px-2.5 text-14 transition-colors duration-fast ease-std hover:bg-hover',
              run.id === active ? 'bg-fill text-ink shadow-[inset_0_0_0_1px_var(--control-border)]' : 'text-ink-2')}>
            <span className="shrink-0 font-mono text-13">#{run.sequence}</span>
            <span className="shrink-0 whitespace-nowrap">{KIND_NAMES[run.kind] ?? run.kind}</span>
            <span className={cn('truncate', run.id === active && 'font-strong')}>{what}</span>
            {run.by === 'agent' && <span className="size-1.5 shrink-0 rounded-full bg-agent" />}
            {stale && <span className="size-1.5 shrink-0 rounded-full bg-attention" />}
          </button>
        </Tip>;
      })}
      {draft && <Tip label="现在的输入算出来的结果，还没有存为记录">
        <span className="flex h-8 shrink-0 items-center gap-2 rounded-field border border-dashed border-control px-2.5 text-14 text-ink">
          <span className="text-ink-2">草算</span>
          <span className="font-strong">{draft.label}</span>
        </span>
      </Tip>}
    </div>
    {cursor && <div className="flex shrink-0 gap-4 font-mono text-13 text-ink-2">
      <span>x {fixed(cursor[0], 3)} m</span>
      <span>z {fixed(cursor[1], 3)} m</span>
    </div>}
  </div>;
}
