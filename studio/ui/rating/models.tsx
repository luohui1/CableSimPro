// The cables of the product library to choose from: a search over a table, one row to a size, as the new-project screen and
// the dialog that changes the cable of a project both show it.
import { useEffect, useRef, useState } from 'react';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Icon } from '@/kit/icon';
import { ReviewMark } from '@/kit/marks';
import { DataTable, type Column } from '@/kit/workbench/data-table';
import { EmptyState } from '@/kit/workbench/premise';
import { cn } from '@/lib/utils';
import type { LibraryEntry } from '@shared/types';

// A long name ends in an ellipsis and is whole in the tooltip: the table is never wider than the room it has.
const COLUMNS: Column<LibraryEntry>[] = [
  { key: 'name', header: '规格', cell: entry => <span title={entry.name} className="block max-w-64 truncate font-medium">{entry.name}</span> },
  { key: 'family', header: '系列', cell: entry => <span title={entry.family} className="block max-w-56 truncate text-ink-2">{entry.family}</span> },
  { key: 'review', header: '最新版本', width: 'w-28', cell: entry => (entry.review ? <ReviewMark state={entry.review} /> : <span className="text-ink-2">—</span>) },
];

export function ModelTable({ entries, selected, onSelect, className }: {
  entries: LibraryEntry[];
  selected?: string;
  onSelect: (entry: LibraryEntry) => void;
  /** The table's own box: give it a height to make it scroll. */
  className?: string;
}) {
  const [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const reached = useRef(false);
  const needle = query.trim().toLowerCase();
  const shown = needle ? entries.filter(entry => `${entry.name} ${entry.family}`.toLowerCase().includes(needle)) : entries;
  // A cable that is already chosen when the table appears (it came with the address) is brought into view once: the table
  // scrolls to it, and nothing around the table does.
  useEffect(() => {
    if (reached.current || !selected || !entries.length) return;
    const row = root.current?.querySelector<HTMLElement>('[data-state="selected"]');
    const box = row?.closest<HTMLElement>('[data-slot="table-container"]');
    if (!row || !box) return;
    reached.current = true;
    const [at, around] = [row.getBoundingClientRect(), box.getBoundingClientRect()];
    box.scrollTop += at.top - around.top - (box.clientHeight - at.height) / 2;
  }, [entries.length, selected]);
  return <div ref={root} className="flex min-h-0 flex-col gap-3">
    <InputGroup className="w-72">
      <InputGroupAddon><Icon name="action/search" /></InputGroupAddon>
      {/* Enter in the search is not the form's submit: the screen that holds the table has a form of its own. */}
      <InputGroupInput value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }}
        placeholder="搜索规格或系列" aria-label="搜索型号" />
    </InputGroup>
    <DataTable framed className={cn('max-h-80', className)} columns={COLUMNS} rows={shown} rowKey={entry => entry.id} selected={selected} onSelect={onSelect}
      empty={<EmptyState icon="action/search" title="没有符合的型号" description="换个关键词，或到型号库导入结构表。" />} />
  </div>;
}
